import fetch from "node-fetch";
import { parse, HTMLElement } from "node-html-parser";
import fs from "fs";
import pRetry from "p-retry";
import dotenv from "dotenv";

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
let concurrentLimit = 0;
let totalRequests = 0;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanup(text?: string) {
  return text
    ?.trim()
    .replace(/\n/gi, " ")
    .replace(/\s{2,}/gi, " ");
}

function parseProductInfo(dom: HTMLElement, key: string): product {
  const price = parseInt(dom.querySelector(".price")?.attributes.content ?? "");
  const name =
    cleanup(dom.querySelector('[itemprop="name"]')?.innerText) ??
    key.slice(key.indexOf("-") + 1).replaceAll("-", " ");
  const brand = cleanup(dom.querySelector('[itemprop="brand"]')?.innerText);
  const unitPrice = cleanup(dom.querySelector(".unit-price")?.innerText);
  const description = cleanup(
    dom.querySelector('[itemprop="description"]')?.innerText
  );
  return { price, name, brand, unitPrice, description };
}

async function request(url: string) {
  while (concurrentLimit >= 20) {
    await sleep(2000);
  }
  try {
    concurrentLimit++;
    totalRequests++;
    const response = await fetch(url);
    if (response.status > 399 && response.status < 500) {
      if (response.status === 404) {
        brokenLinks.add(url);
      }
      throw new pRetry.AbortError(response.statusText);
    }
    if (response.status > 299) {
      throw new Error(response.statusText);
    }
    const body = await response.text();
    return parse(body);
  } catch (error) {
    console.log(error);
    return;
  } finally {
    concurrentLimit--;
  }
}

async function crawl(href: string, depth: number) {
  if (visitedHrefs.has(href)) return;
  visitedHrefs.add(href);
  if (depth > 2) return;

  const response = await pRetry(() => request(baseUrl + href), {
    retries: 4,
    minTimeout: 1000,
    factor: 2,
    maxRetryTime: 30000,
  });

  if (!response) return;
  console.log("finish:  ", href);
  try {
    if (href.search(/products\/\d+/g) !== -1) {
      const match = href.match(/products\/(\d+)/);
      const key = match ? match[1] : href;
      products[key] = parseProductInfo(response, key);
    }

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
    await Promise.all(requests);
  } catch (error) {
    console.log(error);
  }
}
const startTime = Date.now();

crawl("/no", 0)
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
