
export class RetryAfterError extends Error {
	readonly retryAfter: number;

  constructor(retryAfter: number){
    super('retry-after');
    this.retryAfter=retryAfter;
  }
}

export function parseRetryTime(response: Response){
  let retryTime=0;
    const retryAfter= response.headers.get('Retry-After');
    if(retryAfter){
      const retryMs = Number(retryAfter);
      if(!isNaN(retryMs)){
        retryTime = retryMs - Date.now();
      }else{
        const retryDate = Date.parse(retryAfter);
        if(!isNaN(retryDate)){
          retryTime = retryDate - Date.now();
        }
    }
  }
  return retryTime;
}

