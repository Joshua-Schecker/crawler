import parse from "node-html-parser";
import fs from "fs";
import pRetry from "p-retry";
import dotenv from "dotenv";
import { parseRetryTime, RetryAfterError } from "requests";

dotenv.config();

type product = {
  name: string;
  price?: number;
  brand?: string;
  unitPrice?: string;
  description?: string;
};

const baseUrl = process.env.BASE_URL ?? "https://oda.com";
const products: Record<string, product> = {};
const visitedHrefs: Set<string> = new Set();
const brokenLinks: Set<string> = new Set();
let totalRequests = 0;

async function sleep(ms: number) {
// if retry-after time is less than exponential backoff, then don't wait
  if(ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url: string) {
  totalRequests++;
  const response = await fetch(url);
  if (response.status > 399 && response.status < 500) {
    if (response.status === 429) {
      const retryTime = parseRetryTime(response)
      if(retryTime!=0) throw new RetryAfterError(retryTime)
    }
    if (response.status === 404) {
      brokenLinks.add(url);
    }
    throw new pRetry.AbortError(response.statusText);
  }
  if (response.status > 299) {
    throw new Error(response.statusText);
  }
  return parse(await response.text());
}

async function crawl(href: string, depth: number) {
  if (visitedHrefs.has(href)) return;
  visitedHrefs.add(href);
  if (depth > 2) return;

  const response = await pRetry(() => request(baseUrl + href), {
    retries: 4,
    minTimeout: 1000,
    factor: 2,
    maxRetryTime: 60000,
    onFailedAttempt: async error => {
      if(error instanceof RetryAfterError && error.attemptNumber < 4){
        // take exponential backoff time into account when waiting for rate limit
        await sleep(error.retryAfter - error.attemptNumber**2);
      }
    }
  });

  if (!response) return;
  console.log("finish:  ", href);
  try {
    const hrefs = response
      .querySelectorAll("a")
      .map((anchor) => anchor.attributes.href)
      .filter(
        (href) => href && href.startsWith("/") && !visitedHrefs.has(href)
      );
    if (hrefs.length === 0) {
      return;
    }
    depth++;
    const requests = hrefs.map((href) => crawl(href, depth));
    await Promise.allSettled(requests);
  } catch (error) {
    console.log(error);
  }
}
const startTime = Date.now();

crawl("/", 0)
  .then(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    fs.writeFileSync("output.json", JSON.stringify(products));
    fs.writeFileSync("brokenLinks.json", JSON.stringify([...brokenLinks]));

    console.log(`elapsed time (seconds):  ${elapsed}`);
    console.log(`total requests:  ${totalRequests}`);
    console.log(`requests per second:  ${totalRequests / elapsed}`);
  })
  .catch((error) => {
    console.log("catch", error);
  });
