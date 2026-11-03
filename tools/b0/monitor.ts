/** Isolated B0 observer/validator. No business writes; SQL output is never printed. */
import { createRequire } from 'node:module';
import { Queue } from 'bullmq';
import { readdirSync,openSync,readSync,closeSync,statSync } from 'node:fs';
const mysql=createRequire(import.meta.url)('mysql2');
if(!/^e1b0_[a-z0-9_]+$/.test(process.env.MYSQL_DATABASE||'')||process.env.MYSQL_HOST!=='mysql'||process.env.REDIS_HOST!=='redis')throw Error('B0 isolated target required');
const db=mysql.createConnection({host:'mysql',user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,dateStrings:true}).promise();
const queue=new Queue('ops-jobs',{connection:{host:'redis',port:6379,maxRetriesPerRequest:0},prefix:'bull'});
queue.on('error',()=>{});
const run=process.env.DATASET_RUN_ID!;
let stopped=false;process.once('SIGTERM',()=>{stopped=true;});process.once('SIGINT',()=>{stopped=true;});
const query=async(sql:string,params:any[]=[])=>{const [rows]=await db.query(sql,params);return rows;};
const enqueued=new Map<string,number>(),tails=new Map<string,{offset:number;partial:string}>();
function enqueueTimes(){
  let lag=false;
  try{for(const name of readdirSync('/api-observations').filter(n=>n.endsWith('.jsonl'))){
    const path='/api-observations/'+name,state=tails.get(path)||{offset:0,partial:''};const fd=openSync(path,'r');
    try{const buffer=Buffer.alloc(65536);let budget=16*1024*1024;
      while(budget>0){const n=readSync(fd,buffer,0,Math.min(buffer.length,budget),state.offset);if(!n)break;budget-=n;state.offset+=n;
        const lines=(state.partial+buffer.toString('utf8',0,n)).split('\n');state.partial=lines.pop()!;
        for(const line of lines){try{const row=JSON.parse(line);if(row.kind==='outbox_write_resolved'&&!enqueued.has(row.jobId)&&enqueued.size<100000)enqueued.set(row.jobId,Date.parse(row.wallTime));}catch{lag=true;}}
      }
      lag ||=statSync(path).size>state.offset;
    }finally{closeSync(fd);tails.set(path,state);}
  }}catch{lag=true;}
  return lag;
}
export async function snapshot(){
  const t=performance.now();
  const [checkpoint]=await query('SELECT status FROM source_checkpoints WHERE run_id=?',[run]);
  const classifications=await query('SELECT status,COUNT(*) count FROM orders WHERE run_id=? GROUP BY status',[run]);
  const jobs=await query('SELECT status,COUNT(*) count FROM outbox_jobs WHERE run_id=? GROUP BY status',[run]);
  const enqueueReadLag=enqueueTimes();
  const pending=await query("SELECT id FROM outbox_jobs WHERE run_id=? AND status<>'DONE' ORDER BY id LIMIT 100001",[run]);
  let known=0,unknown=0,oldest:number|null=null,negative=0;const ageAt=Date.now();
  for(const job of pending){const created=enqueued.get(job.id);if(created===undefined){unknown++;continue;}known++;const age=(ageAt-created)/1000;if(age<0)negative++;oldest=oldest===null?age:Math.max(oldest,age);}
  const oldestAge={seconds:oldest,knownPending:known,unknownPending:unknown,enqueueReadLag,
    coverage:pending.length>100000||enqueueReadLag||unknown||negative?'UNKNOWN':'OBSERVED',negativeAgeCount:negative,
    definition:'first post-commit enqueue-write observation; available_at is not substituted; sidecar is not atomic'};
  const [counts]=await query(`SELECT (SELECT COUNT(*) FROM raw_orders WHERE run_id=?) rawCount,
    (SELECT COUNT(*) FROM tasks WHERE run_id=?) taskCount,
    (SELECT COUNT(*) FROM tasks WHERE run_id=? AND (status<>'CREATED' OR device_id IS NOT NULL OR assignment_version<>0 OR confirmed_at IS NOT NULL)) badTasks,
    (SELECT COUNT(*) FROM device_events) eventCount,(SELECT COUNT(*) FROM report_daily WHERE run_id=?) reports,
    (SELECT COALESCE(SUM(required_qty),0) FROM task_items i JOIN tasks t ON t.id=i.task_id WHERE t.run_id=?) requiredQty,
    (SELECT COALESCE(SUM(applied_qty),0) FROM task_items i JOIN tasks t ON t.id=i.task_id WHERE t.run_id=?) appliedQty`,[run,run,run,run,run,run]);
  let lockSnapshot:any='UNKNOWN';
  try{const [row]=await query('SELECT COUNT(*) count FROM performance_schema.data_lock_waits');lockSnapshot={count:Number(row.count),scope:'instantaneous server snapshot; not lock duration'};}catch{}
  return {version:1,wallTime:new Date().toISOString(),monotonicNs:process.hrtime.bigint().toString(),runId:run,
    checkpoint:checkpoint?.status||null,classifications,jobs,counts,oldestAge,queue:await queue.getJobCounts('waiting','active','delayed','failed'),
    observerDurationMs:performance.now()-t,poolWait:'UNKNOWN',lockDuration:'UNKNOWN',lockSnapshot};
}
async function validate(){
  const state=await snapshot();
  // Canonical business data keyed by original source ID. No internal IDs or timestamps.
  const orders=await query(`SELECT o.source_order_id sourceId,o.source_status sourceStatus,o.status,o.revision,
    o.hold_reasons holdReasons,o.quality_flags qualityFlags,t.status taskStatus,t.device_id deviceId,
    t.assignment_version assignmentVersion,t.last_processed_seq lastProcessedSeq
    FROM orders o LEFT JOIN tasks t ON t.order_id=o.id WHERE o.run_id=? ORDER BY o.source_order_id`,[run]);
  const items=await query(`SELECT o.source_order_id sourceId,i.product_id productId,i.required_qty requiredQty,
    t.required_qty taskRequiredQty,t.applied_qty appliedQty FROM orders o JOIN order_items i ON i.order_id=o.id
    LEFT JOIN tasks task ON task.order_id=o.id LEFT JOIN task_items t ON t.task_id=task.id AND t.product_id=i.product_id
    WHERE o.run_id=? ORDER BY o.source_order_id,i.product_id`,[run]);
  const [variables]=await query('SELECT @@innodb_buffer_pool_size bufferPoolBytes,@@innodb_flush_log_at_trx_commit flushCommit,@@sync_binlog syncBinlog');
  const migrations=await query('SELECT version,sha256 FROM schema_migrations ORDER BY version');
  const jobIds=await query('SELECT id FROM outbox_jobs WHERE run_id=? ORDER BY id',[run]);
  const taskIds=await query('SELECT id FROM tasks WHERE run_id=? ORDER BY id',[run]);
  const rawIds=await query('SELECT id FROM raw_orders WHERE run_id=? ORDER BY id',[run]);
  return {state,orders,items,variables,migrations,jobIds:jobIds.map((r:any)=>r.id),taskIds:taskIds.map((r:any)=>r.id),rawIds:rawIds.map((r:any)=>r.id)};
}
try{
  if(process.argv.includes('--validate'))console.log(JSON.stringify(await validate()));
  else do{
    try{console.log(JSON.stringify(await snapshot()));}catch{console.log(JSON.stringify({version:1,wallTime:new Date().toISOString(),error:'OBSERVER_QUERY_FAILED'}));}
    if(process.argv.includes('--once'))break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }while(!stopped);
}finally{await queue.close();await db.end();}
