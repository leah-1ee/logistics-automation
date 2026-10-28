/** F1: actual Olist order inputs, explicitly simulated warehouse actions. Never uses fixture inputs. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { connectDb,connection } from '../src/server/db.js';
import { LocalStore } from '../src/device/store.js';
import { Sync } from '../src/device/sync.js';
import { hash,parseJson,sha256,now } from '../src/shared/contracts.js';
const prepared=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
const manifest=JSON.parse((prepared.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);prepared.close();
if(manifest.synthetic||manifest.datasetVersion!=='olist-v2'){console.error('F1 BLOCKED: actual Olist v2 manifest required; synthetic input refused');process.exit(2);}
const db=await connectDb(),runId=process.env.DATASET_RUN_ID!,deviceId=process.env.DEVICE_ID!,root=process.env.SERVER_URL!;
const trial=process.env.F1_TRIAL||'';
if(trial&&!/^[a-zA-Z0-9_-]{1,64}$/.test(trial))throw new Error('F1_TRIAL must be a safe 1..64 character label');
const artifactKey=runId+(trial?'-'+trial:'');
mkdirSync('var',{recursive:true});mkdirSync('reports',{recursive:true});
const planPath=`var/f1-${artifactKey}.json`,local=new LocalStore(`var/f1-${artifactKey}.sqlite`,deviceId);
const started=performance.now();let deliveries=0,droppedResponses=0;
async function admin(path:string,body:any) {
  const r=await fetch(new URL('/api/v1/'+path,root),{method:'POST',headers:{Authorization:'Bearer '+process.env.ADMIN_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('F1 admin HTTP '+r.status);return r.json();
}
try {
  const c=connection(db);const [run]=await c.execute('SELECT * FROM dataset_runs WHERE id=?',[runId]);
  if(!run||hash(parseJson(run.manifest))!==hash(manifest))throw new Error('F1 BLOCKED: registered manifest does not match actual input');
  let plan:any;
  if(existsSync(planPath))plan=JSON.parse(readFileSync(planPath,'utf8'));
  else {
    const [checkpoint]=await c.execute("SELECT status FROM source_checkpoints WHERE run_id=? AND source='olist'",[runId]);
    const [pending]=await c.execute("SELECT COUNT(*) n FROM outbox_jobs WHERE run_id=? AND type='CREATE_TASK' AND status<>'DONE'",[runId]);
    if(checkpoint?.status!=='DONE'||Number(pending.n)!==0)throw new Error('F1 BLOCKED: ingestion and task generation must drain before deterministic selection');
    const tasks=await c.execute("SELECT t.id,o.source_order_id FROM tasks t JOIN orders o ON o.id=t.order_id WHERE t.run_id=? AND t.status='CREATED' ORDER BY o.source_order_id LIMIT 1000",[runId]);
    if(tasks.length!==1000)throw new Error('F1 BLOCKED: 1000 eligible unassigned actual orders required; do not relax filters');
    plan={datasetRunId:runId,deviceId,trial,manifestHash:hash(manifest),seed:42,selection:'sourceOrderId lexical ascending',actions:'SIMULATED_WAREHOUSE_NOT_PHYSICAL',createdAt:now(),tasks:tasks.map((t:any,index:number)=>({taskId:t.id,sourceOrderId:t.source_order_id,requestId:randomUUID(),dropResponse:index%10===0}))};
    writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  if(plan.datasetRunId!==runId||plan.deviceId!==deviceId||(plan.trial||'')!==trial||plan.manifestHash!==hash(manifest)||plan.tasks.length!==1000)throw new Error('F1 plan mismatch; refusing reset');
  const dropTasks=new Set(plan.tasks.filter((t:any)=>t.dropResponse).map((t:any)=>t.taskId));
  const transport:typeof fetch=async(url,init)=>{
    const events=init?.body?JSON.parse(String(init.body)).events:undefined;
    const result=await fetch(url,init);
    if(events){deliveries+=events.length;const task=events[0].taskId,key='f1-dropped:'+task;
      if(result.ok&&dropTasks.has(task)&&!local.db.prepare('SELECT 1 FROM sync_meta WHERE key=?').get(key)){
        await result.arrayBuffer();local.db.prepare('INSERT INTO sync_meta VALUES(?,?)').run(key,now());droppedResponses++;throw new Error('F1 injected response loss after server commit');
      }
    }return result;
  };
  const sync=new Sync(local,root,process.env.DEVICE_TOKEN!,runId,transport);
  for(const [index,task] of plan.tasks.entries()) {
    const snapshot=await admin('tasks/'+task.taskId+'/assignment',{requestId:task.requestId,deviceId,reason:'F1 actual Olist input / simulated software warehouse replay'});
    if(!local.download(snapshot))throw new Error('F1 snapshot conflict');
    let state=local.get(task.taskId);
    if(!['LOCAL_COMPLETED','SERVER_CONFIRMED'].includes(state.localStatus)){
      for(const item of state.items)for(let n=item.appliedQty;n<item.requiredQty;n++)local.scan(task.taskId,'LOPS1:PRODUCT:'+item.productId);
      local.action(task.taskId,'COMPLETE',{});
    }
    const deadline=Date.now()+120000;
    while(local.get(task.taskId).localStatus!=='SERVER_CONFIRMED'){
      if(local.get(task.taskId).syncStatus==='BLOCKED')throw new Error('F1 task blocked; evidence retained: '+task.taskId);
      if(Date.now()>deadline)throw new Error('F1 sync timeout; SQLite and plan retained for resume');
      await sync.tick();await new Promise(r=>setTimeout(r,100));
    }
    if((index+1)%100===0)console.log('F1 actual-input / simulated-actions confirmed',index+1);
  }
  for(let i=0;i<120;i++){
    const [j]=await c.execute("SELECT COUNT(*) n FROM outbox_jobs WHERE run_id=? AND status<>'DONE'",[runId]);if(!Number(j.n))break;
    if(i===119)throw new Error('F1 report worker did not drain; not PASS');await new Promise(r=>setTimeout(r,500));
  }
  let selectedItems=0,events=0;
  for(const task of plan.tasks){
    const [t]=await c.execute('SELECT status FROM tasks WHERE id=?',[task.taskId]);if(t.status!=='CONFIRMED')throw new Error('F1 task not confirmed');
    const serverItems=await c.execute('SELECT product_id,required_qty,applied_qty FROM task_items WHERE task_id=?',[task.taskId]);
    for(const item of serverItems)if(item.required_qty!==item.applied_qty||!local.get(task.taskId).items.some((i:any)=>i.productId===item.product_id&&i.appliedQty===item.applied_qty))throw new Error('F1 server/local quantity mismatch');
    for(const item of local.get(task.taskId).items){if(item.appliedQty!==item.requiredQty)throw new Error('F1 local quantity mismatch');selectedItems+=item.appliedQty;}
    for(const e of local.events(task.taskId)){
      const [saved]=await c.execute('SELECT canonical_hash FROM device_events WHERE device_id=? AND event_id=?',[deviceId,e.event.eventId]);
      if(e.status!=='ACKED'||saved?.canonical_hash!==e.hash)throw new Error('F1 acknowledged event mismatch');events++;
    }
  }
  const days=await c.execute("SELECT t.business_date,COUNT(DISTINCT t.id) task_count,SUM(i.applied_qty) item_count FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date",[runId]);
  for(const day of days){
    const [report]=await c.execute('SELECT * FROM report_daily WHERE run_id=? AND business_date=?',[runId,day.business_date]);
    if(!report||report.task_count!==Number(day.task_count)||report.item_count!==Number(day.item_count))throw new Error('F1 daily report reconciliation failed');
  }
  const report={status:'PASS',test:'T27',input:'ACTUAL_OLIST_V2',actions:'SIMULATED_SOFTWARE_WAREHOUSE',hardware:'BLOCKED_UNTIL_T29',datasetRunId:runId,trial,manifestHash:hash(manifest),planSha256:sha256(readFileSync(planPath)),taskCount:1000,itemCount:selectedItems,uniqueEvents:events,deliveriesThisInvocation:deliveries,droppedResponsesThisInvocation:droppedResponses,localPending:local.syncStatus().pendingCount,elapsedSeconds:(performance.now()-started)/1000,codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),lockfileSha256:sha256(readFileSync('package-lock.json')),replayScriptSha256:sha256(readFileSync('tools/replay-actual.ts')),at:now()};
  writeFileSync('reports/f1-'+artifactKey+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{local.close();await db.close(true);}
