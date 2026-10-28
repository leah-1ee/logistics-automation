// Explicitly invoked service interruption test; only this project's mysql/redis are stopped.
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Queue,Worker } from 'bullmq';
import { connectDb,connection } from '../src/server/db.js';
import { ingestPage,ingestionStatus } from '../src/ingestion/ingest.js';
import { dispatch,processJob,redisOptions } from '../src/jobs/jobs.js';
import { LocalStore } from '../src/device/store.js';
import { assigned,register,sourcePage } from './integration/helpers.js';
const docker=(...args:string[])=>{const r=spawnSync('docker',['compose',...args],{encoding:'utf8',timeout:60000});if(r.status!==0)throw new Error(r.stderr||'Docker operation failed');};
const results:any[]=[];const db=await connectDb(),prefix='fault-'+randomUUID(),port=39000+process.pid%1000;
const server=spawn(process.execPath,['--import','tsx','src/server/main.ts'],{env:{...process.env,API_PORT:String(port)},stdio:'ignore'});
const queue=new Queue('ops-jobs',{connection:{...redisOptions(),maxRetriesPerRequest:0,enableOfflineQueue:false},prefix});queue.on('error',()=>{});
let worker:Worker|undefined,local:LocalStore|undefined;
const root='http://127.0.0.1:'+port;
async function ready(expected:number,redis?:string) {for(let i=0;i<100;i++){try{const r=await fetch(root+'/api/v1/ready'),v=await r.json();if(r.status===expected&&(!redis||v.redis===redis))return v;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Readiness did not reach '+expected+'/'+redis);}
try {
  await ready(200,'up');await queue.waitUntilReady();
  const a=await assigned(db);local=new LocalStore(mkdtempSync(tmpdir()+'/logistics-service-fault-')+'/device.sqlite',a.deviceId);local.download(a.snapshot);
  docker('stop','redis');await ready(200,'down');
  const ingestion=await register(db);await ingestPage(db,ingestion.runId,sourcePage(ingestion.runId),null);assert.equal((await ingestionStatus(db,ingestion.runId)).receivedCount,1);
  const event=local.scan(a.snapshot.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32)).event;
  const r=await fetch(root+'/api/v1/device/events',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({batchId:randomUUID(),events:[event]})});const body=await r.json();assert.equal(body.results[0].result,'APPLIED');local.accept(body.results[0]);
  results.push({test:'T20',status:'PASS',evidence:'Redis stopped; source page committed and real HTTP event ACK after MySQL commit; ready degraded'});
  docker('start','--wait','redis');await ready(200,'up');
  worker=new Worker('ops-jobs',j=>processJob(db,j.data.outboxJobId),{connection:redisOptions(),prefix,concurrency:1});worker.on('error',()=>{});
  await dispatch(db,queue,1000,ingestion.runId);
  for(let i=0;i<100;i++){if((await connection(db).execute('SELECT id FROM tasks WHERE run_id=?',[ingestion.runId])).length)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal((await connection(db).execute('SELECT id FROM tasks WHERE run_id=?',[ingestion.runId])).length,1);
  results.push({test:'T21',status:'PASS',evidence:'Redis restarted; DB outbox dispatched through real BullMQ worker and exactly one task created'});
  await worker.close();worker=undefined;
  docker('stop','mysql');await ready(503);
  const pending=local.scan(a.snapshot.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32)).event;
  const failed=await fetch(root+'/api/v1/device/events',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({batchId:randomUUID(),events:[pending]})});assert.equal(failed.status,503);assert.equal(local.syncStatus().pendingCount,1);
  const path=local.db.location()!;local.close();local=new LocalStore(path,a.deviceId);assert.equal(local.get(a.snapshot.taskId).items[0].appliedQty,2);
  docker('start','--wait','mysql');await ready(200,'up');
  const recovered=await fetch(root+'/api/v1/device/events',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({batchId:randomUUID(),events:[pending]})});const receipt=await recovered.json();assert.equal(receipt.results[0].result,'APPLIED');local.accept(receipt.results[0]);assert.equal(local.syncStatus().pendingCount,0);
  results.push({test:'T23/T31',status:'PASS',evidence:'MySQL stopped: ready503, no success ACK, SQLite restart preserves scan; after restart real HTTP sync agrees'});
  writeFileSync(process.env.SERVICE_FAULT_REPORT||'reports/service-faults.json',JSON.stringify({at:new Date().toISOString(),data:'SYNTHETIC fixtures',hardware:'BLOCKED',results},null,2)+'\n');console.log(JSON.stringify(results));
}finally {
  // Always restore availability; never remove containers or volumes.
  docker('start','--wait','mysql','redis');if(worker)await worker.close();local?.close();await queue.close();server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,3000))]);if(server.exitCode===null)server.kill('SIGKILL');await db.close(true);
}
