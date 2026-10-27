import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transaction, type Db } from '../../src/server/db.js';
import { now, sha256 } from '../../src/shared/contracts.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { assign } from '../../src/fulfillment/tasks.js';
import { processJob } from '../../src/jobs/jobs.js';
import { connection } from '../../src/server/db.js';
export const raw=JSON.parse(readFileSync('docs/examples.json','utf8')).sourcePage.items[0];
export async function register(db:Db) {
  const runId=randomUUID(),deviceId='test-'+randomUUID(),token=randomUUID()+randomUUID();
  await transaction(db,async tx=>{
    await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?)',[runId,'SYNTHETIC-TEST',JSON.stringify({synthetic:true}),'REGISTERED',now()]);
    await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?)',[runId,'olist',null,'PAUSED',now()]);
    for(const id of new Set(raw.items.map((i:any)=>i.productId)))await tx.execute('INSERT INTO products VALUES(?,?,?,?)',[runId,id,'synthetic','{}']);
    await tx.execute('INSERT INTO sellers VALUES(?,?)',[runId,raw.items[0].sellerId]);
    await tx.execute('INSERT INTO devices(id,token_hash,enabled) VALUES(?,?,true)',[deviceId,sha256(token)]);
  });
  return {runId,deviceId,token};
}
export function sourcePage(runId:string,items:any[]=[raw],exhausted=true) {return {datasetRunId:runId,items,nextCursor:exhausted?null:'next',exhausted,nextPollAfterMs:0};}
export async function assigned(db:Db) {
  const {runId,deviceId,token}=await register(db);await ingestPage(db,runId,sourcePage(runId),null);
  const [job]=await connection(db).execute('SELECT id FROM outbox_jobs WHERE run_id=?',[runId]);await processJob(db,job.id);
  const [task]=await connection(db).execute('SELECT id FROM tasks WHERE run_id=?',[runId]);
  const snapshot=await assign(db,'test-operator',task.id,{requestId:randomUUID(),deviceId,reason:'synthetic test'});
  return {runId,deviceId,token,snapshot};
}
