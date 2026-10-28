/** Verification cannot start from an empty queue while source ingestion is still active. */
export function drained(sourceStatus:string,jobs:{status:string;n?:number}[]):boolean {
  if(sourceStatus==='FAILED'||jobs.some(j=>j.status==='FAILED'))throw new Error('Source or job failed; evidence retained; no PASS');
  return sourceStatus==='DONE'&&jobs.every(j=>j.status==='DONE');
}
