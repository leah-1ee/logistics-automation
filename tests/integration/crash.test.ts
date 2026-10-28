import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { ingestPage,ingestionStatus } from '../../src/ingestion/ingest.js';
import { processJob } from '../../src/jobs/jobs.js';
import { applyBatch } from '../../src/sync/events.js';
import { LocalStore } from '../../src/device/store.js';
import { assigned,register,sourcePage } from './helpers.js';
async function child(mode:string,input:any) {
  const file=mkdtempSync(tmpdir()+'/logistics-fault-')+'/input.json';writeFileSync(file,JSON.stringify(input),{mode:0o600});
  const p=spawn(process.execPath,['--import','tsx','tests/fault-child.ts',mode,file],{env:process.env,stdio:['ignore','pipe','pipe']});
  return p;
}
test('T02/T12/T22 actual SIGKILL around MySQL and SQLite commit boundaries',async()=>{
  const db=await connectDb();try{
    const a=await assigned(db);const path=mkdtempSync(tmpdir()+'/logistics-crash-sqlite-')+'/d.sqlite';let local=new LocalStore(path,a.deviceId);local.download(a.snapshot);local.close();
    for(const stage of ['before_event','after_event','before_commit','after_commit']){
      const p=await child('sqlite',{path,deviceId:a.deviceId,taskId:a.snapshot.taskId,stage});const [,signal]=await once(p,'exit');assert.equal(signal,'SIGKILL');
      local=new LocalStore(path,a.deviceId);assert.equal(local.events(a.snapshot.taskId).length,stage==='after_commit'?1:0);assert.equal(local.get(a.snapshot.taskId).nextSeq,stage==='after_commit'?2:1);local.close();
    }
    for(const stage of ['before','during','before_commit','after_commit']){
      const {runId}=await register(db),page=sourcePage(runId);const p=await child('ingestion',{runId,page,stage});const [,signal]=await once(p,'exit');assert.equal(signal,'SIGKILL');
      assert.equal((await ingestionStatus(db,runId)).receivedCount,stage==='after_commit'?1:0);
      await ingestPage(db,runId,page,null);assert.equal((await ingestionStatus(db,runId)).receivedCount,1);
      const [job]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=?',[runId]);
      const w=await child('worker',{jobId:job.id,stage:stage==='after_commit'?'after_commit':'after_work'});const [,sig]=await once(w,'exit');assert.equal(sig,'SIGKILL');
      await processJob(db,job.id);assert.equal((await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId])).length,1);
    }
  }finally{await db.close(true);}
});
test('T14/T18 real HTTP connection loss from killed API after first event commit',async()=>{
  const db=await connectDb();let p:any;try{
    const a=await assigned(db),port=37000+process.pid%1000;p=await child('api',{port});
    let stderr='';p.stderr.on('data',(d:any)=>stderr+=d.toString());
    await new Promise<void>((resolve,reject)=>{p.stdout.on('data',(d:any)=>{if(d.toString().includes('READY'))resolve();});p.once('exit',()=>reject(new Error(stderr)));});
    const event=(seq:number,productId:string):any=>({eventId:randomUUID(),deviceId:a.deviceId,taskId:a.snapshot.taskId,assignmentVersion:1,seq,occurredAt:new Date().toISOString(),type:'SCAN_ITEM',payload:{productId,quantity:1}});
    const batch={batchId:randomUUID(),events:[event(1,'a'.repeat(32)),event(2,'a'.repeat(32)),event(3,'b'.repeat(32))]};
    await assert.rejects(fetch('http://127.0.0.1:'+port+'/api/v1/device/events',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify(batch)}));
    const result=await applyBatch(db,a.deviceId,batch);assert.equal(result.results[0].result,'DUPLICATE');assert.equal(result.results[1].result,'APPLIED');assert.equal(result.results[2].result,'APPLIED');
    const [counts]=await connection(db).execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[a.snapshot.taskId]);assert.equal(Number(counts.n),3);
  }finally{if(p&&p.exitCode===null)p.kill('SIGKILL');await db.close(true);}
});
