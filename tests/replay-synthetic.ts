// Supplementary software experiment. This does NOT satisfy F1/T27 actual Olist input.
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connectDb,connection } from '../src/server/db.js';
import { register,raw,sourcePage } from './integration/helpers.js';
import { ingestPage } from '../src/ingestion/ingest.js';
import { processJob } from '../src/jobs/jobs.js';
import { assign } from '../src/fulfillment/tasks.js';
import { applyBatch } from '../src/sync/events.js';
import { LocalStore } from '../src/device/store.js';
import { dailyReport } from '../src/operations/api.js';
import { businessDate,parseJson,sha256 } from '../src/shared/contracts.js';
const start=performance.now(),db=await connectDb();
const {runId,deviceId}=await register(db),path=mkdtempSync(tmpdir()+'/logistics-1000-')+'/d.sqlite';let local=new LocalStore(path,deviceId);
let delivered=0,duplicates=0;const count=1000;
try{
  for(let offset=0;offset<count;offset+=200){
    const rows=Array.from({length:Math.min(200,count-offset)},(_,i)=>({...structuredClone(raw),sourceOrderId:(offset+i+1).toString(16).padStart(32,'0'),sourceRecordId:(offset+i+1).toString(16).padStart(32,'0')}));
    await ingestPage(db,runId,{...sourcePage(runId,rows,offset+200>=count),nextCursor:offset+200>=count?null:String(offset+200)},offset?String(offset):null);
  }
  const jobs=await connection(db).execute('SELECT id FROM outbox_jobs WHERE run_id=?',[runId]);for(const j of jobs)await processJob(db,j.id);
  const tasks=await connection(db).execute('SELECT id FROM tasks WHERE run_id=? ORDER BY id',[runId]);assert.equal(tasks.length,count);
  for(const [index,task] of tasks.entries()){
    const snapshot=await assign(db,'synthetic-replay',task.id,{requestId:randomUUID(),deviceId,reason:'supplementary synthetic 1000 software experiment'});local.download(snapshot);
    for(const id of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)])local.scan(task.id,'LOPS1:PRODUCT:'+id);
    local.action(task.id,'COMPLETE',{});assert.equal(local.get(task.id).localStatus,'LOCAL_COMPLETED');
    if(index%100===0){local.close();local=new LocalStore(path,deviceId);}
    const events=local.events(task.id).map(e=>e.event),batch={batchId:randomUUID(),events};
    if(index%10===0){await applyBatch(db,deviceId,batch);delivered+=events.length;} // Drop first response.
    const result=await applyBatch(db,deviceId,batch);delivered+=events.length;duplicates+=result.results.filter(r=>r.result==='DUPLICATE').length;
    for(const receipt of result.results)local.accept(receipt);
    assert.equal(local.get(task.id).localStatus,'SERVER_CONFIRMED');
    if((index+1)%200===0)console.log('SYNTHETIC confirmed',index+1);
  }
  const reports=await connection(db).execute("SELECT * FROM outbox_jobs WHERE run_id=? AND type='REBUILD_REPORT_DAY'",[runId]);
  // Each COMPLETE has its own durable job; all are safely recomputed.
  for(const job of reports)await processJob(db,job.id);
  const days=[...new Set(reports.map((j:any)=>parseJson(j.payload).businessDate))];let tasksTotal=0,itemsTotal=0;
  for(const day of days){const report=await dailyReport(db,runId,day as string);tasksTotal+=report.taskCount;itemsTotal+=report.itemCount;assert.equal(report.rebuildPending,false);}
  assert.equal(tasksTotal,count);assert.equal(itemsTotal,count*3);assert.equal(local.syncStatus().pendingCount,0);
  const [events]=await connection(db).execute('SELECT COUNT(*) n FROM device_events e JOIN tasks t ON t.id=e.task_id WHERE t.run_id=?',[runId]);assert.equal(Number(events.n),count*4);
  const [invalid]=await connection(db).execute("SELECT COUNT(*) n FROM task_items i JOIN tasks t ON t.id=i.task_id WHERE t.run_id=? AND (t.status<>'CONFIRMED' OR i.required_qty<>i.applied_qty)",[runId]);assert.equal(Number(invalid.n),0);
  const report={status:'PASS',scope:'SUPPLEMENTARY_SYNTHETIC_SOFTWARE_ONLY',officialT27:'BLOCKED_ACTUAL_OLIST_REQUIRED',officialT28:'BLOCKED_ACTUAL_OLIST_REQUIRED',hardware:'BLOCKED',datasetRunId:runId,seed:42,taskCount:tasksTotal,itemCount:itemsTotal,uniqueEvents:Number(events.n),deliveries:delivered,duplicateReceipts:duplicates,duplicateEffects:0,lostAcknowledgedEvents:0,localPending:local.syncStatus().pendingCount,elapsedSeconds:(performance.now()-start)/1000,peakRssBytes:process.resourceUsage().maxRSS*1024,codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),lockfileSha256:sha256(readFileSync('package-lock.json')),at:new Date().toISOString(),limitations:'Fixture domain replay uses actual MySQL/SQLite, no webcam; not a production throughput test or actual Olist F1.'};
  writeFileSync('reports/synthetic-1000.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{local.close();await db.close(true);}
