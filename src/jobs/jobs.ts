import { Queue,Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { type Db,type Tx,transaction,connection } from '../server/db.js';
import { now,parseJson,Problem } from '../shared/contracts.js';
import { createTask } from '../fulfillment/tasks.js';
export const redisOptions=()=>({host:process.env.REDIS_HOST||'127.0.0.1',port:Number(process.env.REDIS_PORT||6380),maxRetriesPerRequest:null});
export async function rebuildReport(tx:Tx,job:any) {
  const {businessDate}=parseJson(job.payload);
  // Serialize same-day rebuilds even if another process is accidentally started.
  await tx.execute('INSERT INTO report_daily VALUES(?,?,0,0,?) ON DUPLICATE KEY UPDATE run_id=run_id',[job.run_id,businessDate,now()]);
  await tx.execute('SELECT * FROM report_daily WHERE run_id=? AND business_date=? FOR UPDATE',[job.run_id,businessDate]);
  const [totals]=await tx.execute("SELECT COUNT(DISTINCT t.id) task_count,COALESCE(SUM(i.applied_qty),0) item_count FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.business_date=? AND t.status='CONFIRMED'",[job.run_id,businessDate]);
  const computed=now();
  await tx.execute('UPDATE report_daily SET task_count=?,item_count=?,computed_at=? WHERE run_id=? AND business_date=?',[Number(totals.task_count),Number(totals.item_count),computed,job.run_id,businessDate]);
  // Replace only this derived report day, never original or event records.
  await tx.execute('DELETE FROM report_daily_product WHERE run_id=? AND business_date=?',[job.run_id,businessDate]);
  const products=await tx.execute("SELECT i.product_id,SUM(i.applied_qty) quantity FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.business_date=? AND t.status='CONFIRMED' GROUP BY i.product_id",[job.run_id,businessDate]);
  for(const p of products)await tx.execute('INSERT INTO report_daily_product VALUES(?,?,?,?,?)',[job.run_id,businessDate,p.product_id,Number(p.quantity),computed]);
}
export async function processJob(db:Db,id:string,fault?:(stage:string)=>void) {
  try {
    return await transaction(db,async tx=>{
      const [job]=await tx.execute('SELECT * FROM outbox_jobs WHERE id=? FOR UPDATE',[id]);
      if(!job||job.status==='DONE'||job.status==='FAILED')return;
      if(Date.parse(job.available_at)>Date.now())return;
      const started=now();fault?.('before_work');
      if(job.type==='CREATE_TASK')await createTask(tx,job);
      else if(job.type==='REBUILD_REPORT_DAY')await rebuildReport(tx,job);
      else throw new Problem('UNSUPPORTED_JOB');
      fault?.('after_work');
      await tx.execute("UPDATE outbox_jobs SET status='DONE',attempts=attempts+1,error_code=NULL,lease_until=NULL WHERE id=?",[id]);
      await tx.execute('INSERT INTO job_attempts VALUES(?,?,?,?,?,?)',[randomUUID(),id,job.attempts+1,started,now(),null]);
      fault?.('before_commit');
    });
  }catch(error:any) {
    await transaction(db,async tx=>{
      const [job]=await tx.execute('SELECT * FROM outbox_jobs WHERE id=? FOR UPDATE',[id]);
      if(!job||['DONE','FAILED'].includes(job.status))return;
      const attempts=job.attempts+1,permanent=error instanceof Problem;
      const failed=permanent||attempts>=5;
      const available=new Date(Date.now()+Math.min(60000,1000*2**(attempts-1))+Math.floor(Math.random()*500)).toISOString();
      await tx.execute('UPDATE outbox_jobs SET status=?,attempts=?,error_code=?,available_at=?,lease_until=NULL WHERE id=?',[failed?'FAILED':'PENDING',attempts,permanent?error.code:'TRANSIENT_ERROR',available,id]);
      await tx.execute('INSERT INTO job_attempts VALUES(?,?,?,?,?,?)',[randomUUID(),id,attempts,now(),now(),permanent?error.code:'TRANSIENT_ERROR']);
    });
    throw error;
  }
}
export async function dispatch(db:Db,queue:Queue,leaseMs=Number(process.env.OUTBOX_LEASE_MS||30000),runId?:string) {
  const jobs=await connection(db).execute("SELECT id FROM outbox_jobs WHERE ((status='PENDING' AND available_at<=?) OR (status='DISPATCHED' AND lease_until<=?))"+(runId?' AND run_id=?':'')+' ORDER BY available_at LIMIT 100',[now(),now(),...(runId?[runId]:[])]);
  for(const {id} of jobs)await transaction(db,async tx=>{
    const [job]=await tx.execute('SELECT * FROM outbox_jobs WHERE id=? FOR UPDATE',[id]);
    if(!job||['DONE','FAILED'].includes(job.status))return;
    if(job.status==='DISPATCHED'&&Date.parse(job.lease_until)>Date.now())return;
    const old=await queue.getJob(id);
    if(old) {const state=await old.getState();if(state==='completed'||state==='failed')await old.remove();}
    await queue.add(job.type,{outboxJobId:id,type:job.type},{jobId:id,attempts:1,removeOnComplete:true,removeOnFail:true});
    await tx.execute("UPDATE outbox_jobs SET status='DISPATCHED',lease_until=? WHERE id=?",[new Date(Date.now()+leaseMs).toISOString(),id]);
  });
  return jobs.length;
}
export function startJobs(db:Db,prefix='bull') {
  const queue=new Queue('ops-jobs',{connection:{...redisOptions(),maxRetriesPerRequest:0,enableOfflineQueue:false},prefix});
  const worker=new Worker('ops-jobs',async job=>processJob(db,job.data.outboxJobId),{connection:redisOptions(),concurrency:1,prefix});
  queue.on('error',()=>{});worker.on('error',()=>{});worker.on('failed',(_job,e)=>console.error('Job failed',e.message));
  let busy=false;
  const timer=setInterval(async()=>{if(busy)return;busy=true;try{await dispatch(db,queue);}catch(e:any){console.error('Outbox dispatch delayed',e.code||e.message);}finally{busy=false;}},1000);
  return {queue,worker,async close(){clearInterval(timer);await worker.close();await queue.close();}};
}
