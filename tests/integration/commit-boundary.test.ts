import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connectDb,connection } from '../../src/server/db.js';
import { httpApp } from '../../src/server/http.js';
import { deviceAuth } from '../../src/server/device-auth.js';
import { applyBatch } from '../../src/sync/events.js';
import { LocalStore } from '../../src/device/store.js';
import { assigned } from './helpers.js';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const latch=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};

async function endpoint(db:Awaited<ReturnType<typeof connectDb>>){
  const app=await httpApp('/api/v1',{device_events:req=>applyBatch(db,req.deviceId,req.body)},async req=>{req.deviceId=await deviceAuth(db,req.headers.authorization);});
  await app.listen(0,'127.0.0.1');const port=app.getHttpServer().address().port;
  return {app,post:async(token:string,events:any[])=>{
    const r=await fetch('http://127.0.0.1:'+port+'/api/v1/device/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({batchId:randomUUID(),events})});assert.equal(r.status,200);return r.json();
  }};
}

test('T14/T16 HTTP success waits for COMMIT; concurrent duplicate deliveries apply once',{timeout:20000},async()=>{
  const db=await connectDb(),observer=await connectDb(),a=await assigned(db);
  const pool:any=await db.em.getConnection().getNativeClient();pool.config.connectionLimit=1;
  const physical=await pool.promise().getConnection(),native=physical.connection,original=native.query;physical.release();
  const reached=latch(),release=latch();let armed=true,responded=false;
  native.query=function(sql:any,...args:any[]){
    if(armed&&typeof sql==='string'&&sql.trim().toLowerCase()==='commit'){
      armed=false;reached.resolve();void release.promise.then(()=>{original.call(this,sql,...args);});return;
    }return original.call(this,sql,...args);
  };
  const {app,post}=await endpoint(db);
  const event:any={eventId:randomUUID(),taskId:a.snapshot.taskId,deviceId:a.deviceId,assignmentVersion:1,seq:1,type:'SCAN_ITEM',occurredAt:new Date().toISOString(),payload:{productId:'a'.repeat(32),quantity:1}};
  let inFlight:Promise<any>|undefined;
  try{
    inFlight=post(a.token,[event]).then(v=>{responded=true;return v;});
    await Promise.race([reached.promise,wait(5000).then(()=>{throw new Error('Commit barrier not reached');})]);
    await wait(50);assert.equal(responded,false,'HTTP ACK must remain pending while COMMIT is held');
    const c=connection(observer);
    assert.equal((await c.execute('SELECT event_id FROM device_events WHERE event_id=?',[event.eventId])).length,0);
    assert.equal(Number((await c.execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[event.taskId]))[0].n),0);
    release.resolve();assert.equal((await inFlight).results[0].result,'APPLIED');
    assert.equal((await c.execute('SELECT event_id FROM device_events WHERE event_id=?',[event.eventId])).length,1);
    const gap={...event,eventId:randomUUID(),seq:3,payload:{productId:'b'.repeat(32),quantity:1}};
    assert.equal((await post(a.token,[gap])).results[0].result,'DEFERRED');
    const second={...event,eventId:randomUUID(),seq:2};
    const replies=await Promise.all(Array.from({length:8},()=>post(a.token,[second])));
    assert.equal(replies.filter(r=>r.results[0].result==='APPLIED').length,1);
    assert.equal(replies.filter(r=>r.results[0].result==='DUPLICATE').length,7);
    assert.equal(Number((await c.execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[event.taskId]))[0].n),2);
    assert.equal((await post(a.token,[gap])).results[0].result,'APPLIED');
    assert.equal((await c.execute('SELECT last_processed_seq FROM tasks WHERE id=?',[event.taskId]))[0].last_processed_seq,3);
  }finally{release.resolve();await inFlight?.catch(()=>{});native.query=original;await app.close();await observer.close(true);await db.close(true);}
});

test('T23 failed COMMIT gives no successful receipt and preserves local pending input',{timeout:20000},async()=>{
  const db=await connectDb(),observer=await connectDb(),a=await assigned(db);
  const local=new LocalStore(mkdtempSync(tmpdir()+'/logistics-commit-loss-')+'/local.sqlite',a.deviceId);local.download(a.snapshot);
  const event=local.scan(a.snapshot.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32)).event;
  const pool:any=await db.em.getConnection().getNativeClient();pool.config.connectionLimit=1;
  const physical=await pool.promise().getConnection(),native=physical.connection,original=native.query;physical.release();let armed=true;
  native.query=function(sql:any,...args:any[]){
    if(armed&&typeof sql==='string'&&sql.trim().toLowerCase()==='commit'){
      armed=false;this.destroy();queueMicrotask(()=>args.at(-1)(new Error('Test: connection lost before COMMIT')));return;
    }return original.call(this,sql,...args);
  };
  const {app,post}=await endpoint(db);
  try{
    const result=(await post(a.token,[event])).results[0];assert.equal(result.result,'DEFERRED');local.accept(result);
    assert.equal(local.events(event.taskId)[0].status,'PENDING');assert.equal(local.syncStatus().pendingCount,1);
    assert.equal((await connection(observer).execute('SELECT event_id FROM device_events WHERE event_id=?',[event.eventId])).length,0);
    assert.equal(Number((await connection(observer).execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[event.taskId]))[0].n),0);
    assert.equal((await post(a.token,[event])).results[0].result,'APPLIED');
  }finally{native.query=original;local.close();await app.close();await observer.close(true);await db.close(true);}
});
