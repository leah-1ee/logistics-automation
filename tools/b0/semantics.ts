/** Runs only against the newly provisioned B0 sandbox, after its workers are stopped. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectDb,connection,transaction } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { processJob } from '../../src/jobs/jobs.js';
import { Source } from '../../src/source/source.js';
import { recorder } from '../../src/observability/b0.js';
if(!/^e1b0_[a-z0-9_]+$/.test(process.env.MYSQL_DATABASE||'')||process.env.MYSQL_HOST!=='mysql')throw Error('Isolated B0 target required');
const db=await connectDb(),c=connection(db),run=process.env.DATASET_RUN_ID!;
const cases:{name:string;status:string}[]=[];
const events:any[]=[],emit=recorder.emit.bind(recorder);
recorder.emit=e=>{events.push(e);emit(e);};
try{
  const rollbackRun=randomUUID();
  await transaction(db,async tx=>{
    await tx.execute("INSERT INTO dataset_runs SELECT ?,dataset_version,manifest,status,created_at FROM dataset_runs WHERE id=?",[rollbackRun,run]);
    await tx.execute("INSERT INTO source_checkpoints VALUES(?,'olist',NULL,'PAUSED','2026-11-03T00:00:00Z')",[rollbackRun]);
    await tx.execute('INSERT INTO products SELECT ?,product_id,category,attributes FROM products WHERE run_id=?',[rollbackRun,run]);
    await tx.execute('INSERT INTO sellers SELECT ?,seller_id FROM sellers WHERE run_id=?',[rollbackRun,run]);
  });
  const source=new Source(process.env.PREPARED_DB!,rollbackRun),page=source.page(undefined,200);source.close();
  const failure=new Error('SYNTHETIC_ROLLBACK_SENTINEL');
  await assert.rejects(ingestPage(db,rollbackRun,page,null,stage=>{if(stage==='before_commit')throw failure;}),e=>e===failure);
  const [rolled]=await c.execute('SELECT COUNT(*) count FROM raw_orders WHERE run_id=?',[rollbackRun]);
  assert.equal(Number(rolled.count),0);assert.equal(events.filter(e=>e.runId===rollbackRun&&['raw_order_created','outbox_write_resolved','task_created'].includes(e.kind)).length,0);
  cases.push({name:'page rollback discards durable candidates and preserves exception identity',status:'PASS'});
  const [task]=await c.execute('SELECT id,order_id FROM tasks WHERE run_id=? ORDER BY id LIMIT 1',[run]);
  const [before]=await c.execute('SELECT COUNT(*) count FROM tasks WHERE run_id=?',[run]);
  let newTaskEvents=events.filter(e=>e.kind==='task_created').length;
  async function addJob(revision:number){
    const id=randomUUID();await c.execute("INSERT INTO outbox_jobs(id,run_id,type,aggregate_id,dedupe_key,payload,status,available_at) VALUES(?,?,'CREATE_TASK',?,?,?,'PENDING','2020-01-01T00:00:00Z')",[id,run,task.order_id,'b0-regression-'+id,JSON.stringify({orderId:task.order_id,revision})]);return id;
  }
  const duplicate=await addJob(1);await processJob(db,duplicate);await processJob(db,duplicate);
  const superseded=await addJob(999);await processJob(db,superseded);
  assert.equal(events.filter(e=>e.kind==='task_created').length,newTaskEvents);
  cases.push({name:'existing-task, superseded-revision, DONE redelivery do not count new tasks',status:'PASS'});
  const originalDir=recorder.options.directory;
  await recorder.flush();
  const sinkFailure=await addJob(1);
  const directory=originalDir+'/sink-unavailable';await writeFile(directory,'blocks mkdir');recorder.options.directory=directory;
  await processJob(db,sinkFailure);await recorder.flush();assert.ok(recorder.stats.errors>0);
  const [successful]=await c.execute('SELECT status,attempts,error_code FROM outbox_jobs WHERE id=?',[sinkFailure]);
  assert.deepEqual([successful.status,successful.attempts,successful.error_code],['DONE',1,null]);
  recorder.options.directory=originalDir;
  cases.push({name:'asynchronous sink failure leaves committed job DONE/attempt1/errorNULL',status:'PASS'});
  await recorder.flush();recorder.options.maxRecords=1;
  const saturated=await addJob(1);const drops=recorder.stats.dropped;
  await processJob(db,saturated);await recorder.flush();assert.ok(recorder.stats.dropped>drops);
  const [afterJob]=await c.execute('SELECT status,attempts,error_code FROM outbox_jobs WHERE id=?',[saturated]);
  assert.deepEqual([afterJob.status,afterJob.attempts,afterJob.error_code],['DONE',1,null]);
  const [after]=await c.execute('SELECT COUNT(*) count FROM tasks WHERE run_id=?',[run]);assert.equal(after.count,before.count);
  cases.push({name:'bounded buffer saturation does not fail/retry business success',status:'PASS'});
  const inputRunPage={...page,datasetRunId:run};assert.equal(await ingestPage(db,run,inputRunPage,null),false);
  cases.push({name:'DONE checkpoint repeated page remains no-op',status:'PASS'});
  console.log(JSON.stringify({status:'PASS',input:'SYNTHETIC_ONLY',maxFixtureOrders:4,cases,
    taskCount:Number(after.count),observerLossIsExpected:true,observerStats:recorder.stats,
    note:'Observer loss is deliberately injected; this runner sidecar is INVALID and excluded from smoke coverage.'}));
}catch{
  console.log(JSON.stringify({status:'FAIL',cases,error:'SEMANTIC_ASSERTION_FAILED',observerStats:recorder.stats}));process.exitCode=1;
}finally{await db.close(true);await recorder.close();}
