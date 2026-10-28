/** Persistent, isolated browser acceptance fixture. Never resets existing data. */
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { connectDb,connection,transaction } from '../src/server/db.js';
import { now,sha256,Problem,businessDate,validate } from '../src/shared/contracts.js';
import { ingestPage } from '../src/ingestion/ingest.js';
import { processJob } from '../src/jobs/jobs.js';
import { assign } from '../src/fulfillment/tasks.js';
import { applyEvent } from '../src/sync/events.js';

if(process.env.MYSQL_DATABASE!=='logistics_test')throw Error('Browser fixture requires logistics_test');
const path=process.env.BROWSER_PLAN||'var/admin-ui-plan.json',db=await connectDb(),c=connection(db);
try{
  if(existsSync(path)){
    const plan=JSON.parse(readFileSync(path,'utf8'));
    const [row]=await c.execute('SELECT id FROM dataset_runs WHERE id=?',[plan.runId]);
    if(!row)throw Error('Saved browser plan no longer exists; choose a new BROWSER_PLAN');
    console.log(JSON.stringify({scope:'EXISTING_SYNTHETIC_BROWSER_FIXTURE',runId:plan.runId}));
  }else{
    const runId=randomUUID(),deviceId='browser-ui-'+runId.slice(0,8);
    const statusReport={appVersion:'synthetic-browser',observedAt:'2000-01-01T00:00:00.000Z',pendingCount:7,blockedTaskCount:0,oldestPendingAt:'2000-01-01T00:00:00.000Z'};
    validate('DeviceStatusReport',statusReport);
    const raw=JSON.parse(readFileSync('docs/examples.json','utf8')).sourcePage.items[0];
    const rows=Array.from({length:54},(_,i)=>({...structuredClone(raw),sourceRecordId:sha256(runId+':'+i).slice(0,32),sourceOrderId:sha256(runId+':'+i).slice(0,32)}));
    rows[51].items[0].productId='f'.repeat(32); // original retained; UI will correct this synthetic row
    await transaction(db,async tx=>{
      await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?)',[runId,'SYNTHETIC-BROWSER',JSON.stringify({synthetic:true,purpose:'Actual headless browser acceptance'}),'REGISTERED',now()]);
      await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?)',[runId,'olist',null,'PAUSED',now()]);
      for(const id of ['a'.repeat(32),'b'.repeat(32)])await tx.execute('INSERT INTO products VALUES(?,?,?,?)',[runId,id,'synthetic','{}']);
      await tx.execute('INSERT INTO sellers VALUES(?,?)',[runId,'d'.repeat(32)]);
      await tx.execute('INSERT INTO devices(id,token_hash,enabled,last_seen_at,report_received_at,last_report) VALUES(?,?,true,?,?,?)',
        [deviceId,sha256(randomUUID()+randomUUID()),'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z',JSON.stringify(statusReport)]);
    });
    await ingestPage(db,runId,{datasetRunId:runId,items:rows,nextCursor:null,exhausted:true,nextPollAfterMs:0},null);
    const orders=await c.execute('SELECT id,source_order_id FROM orders WHERE run_id=?',[runId]);
    const orderId=(i:number)=>orders.find((o:any)=>o.source_order_id===rows[i].sourceOrderId).id;
    const jobs=await c.execute('SELECT id,aggregate_id FROM outbox_jobs WHERE run_id=?',[runId]);
    const jobId=(i:number)=>jobs.find((j:any)=>j.aggregate_id===orderId(i)).id;
    for(let i=0;i<51;i++)await processJob(db,jobId(i));
    for(let attempt=0;attempt<5;attempt++){
      await c.execute('UPDATE outbox_jobs SET available_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',jobId(52)]);
      try{await processJob(db,jobId(52),()=>{throw Error('Synthetic browser transient failure');});}catch{}
    }
    try{await processJob(db,jobId(53),()=>{throw new Problem('PERMANENT_INPUT_ERROR');});}catch{}
    const [confirmed]=await c.execute('SELECT id FROM tasks WHERE order_id=?',[orderId(0)]);
    await assign(db,'browser-fixture',confirmed.id,{requestId:randomUUID(),deviceId,reason:'Synthetic report fixture'});
    let seq=0;
    for(const productId of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)])await applyEvent(db,deviceId,{eventId:randomUUID(),taskId:confirmed.id,deviceId,assignmentVersion:1,seq:++seq,occurredAt:now(),type:'SCAN_ITEM',payload:{productId,quantity:1}});
    await applyEvent(db,deviceId,{eventId:randomUUID(),taskId:confirmed.id,deviceId,assignmentVersion:1,seq:++seq,occurredAt:now(),type:'COMPLETE',payload:{}});
    for(const j of await c.execute("SELECT id FROM outbox_jobs WHERE run_id=? AND type='REBUILD_REPORT_DAY'",[runId]))await processJob(db,j.id);
    const [target]=await c.execute('SELECT id FROM tasks WHERE order_id=?',[orderId(1)]);
    const [heldRaw]=await c.execute('SELECT r.payload_hash FROM raw_orders r JOIN orders o ON o.raw_order_id=r.id WHERE o.id=?',[orderId(51)]);
    const plan={scope:'SYNTHETIC_BROWSER_FIXTURE_NOT_OLIST',runId,deviceId,totalOrders:54,initialTasks:51,
      assignmentTaskId:target.id,confirmedTaskId:confirmed.id,searchOrderId:orderId(1),searchSourceOrderId:rows[1].sourceOrderId,
      holdOrderId:orderId(51),holdRawHash:heldRaw.payload_hash,transientJobId:jobId(52),permanentJobId:jobId(53),businessDate:businessDate(now())};
    writeFileSync(path,JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({scope:plan.scope,runId,orders:54,tasks:51,failedJobs:2,confirmedTasks:1,confirmedItems:3}));
  }
}finally{await db.close(true);}
