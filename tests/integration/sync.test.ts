import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connectDb,connection } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { assign } from '../../src/fulfillment/tasks.js';
import { processJob } from '../../src/jobs/jobs.js';
import { applyEvent,applyBatch } from '../../src/sync/events.js';
import { LocalStore } from '../../src/device/store.js';
import { register,sourcePage,assigned } from './helpers.js';
test('T14~T18/T25 real MySQL ACK loss, dedupe before status, ordering, fencing, partial batch',async()=>{
  const db=await connectDb();try{
    const {deviceId,snapshot}=await assigned(db);const store=new LocalStore(mkdtempSync(tmpdir()+'/logistics-sync-')+'/d.sqlite',deviceId);store.download(snapshot);
    const a=store.scan(snapshot.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32)).event;
    const b=store.scan(snapshot.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32)).event;
    const c=store.scan(snapshot.taskId,'LOPS1:PRODUCT:'+'b'.repeat(32)).event;
    const end=store.action(snapshot.taskId,'COMPLETE',{}).event;end.occurredAt='2026-10-26T00:00:00Z';
    assert.equal((await applyEvent(db,deviceId,b)).result,'DEFERRED');
    await assert.rejects(applyEvent(db,deviceId,a,()=>{throw new Error('response lost after commit');}));
    const dup=await applyEvent(db,deviceId,a);assert.equal(dup.result,'DUPLICATE');
    assert.equal((await applyEvent(db,deviceId,{...a,type:'SCAN_ITEM',payload:{productId:'b'.repeat(32),quantity:1}})).code,'EVENT_ID_REUSED');
    assert.equal((await connection(db).execute("SELECT id FROM audit_logs WHERE target_id=? AND reason='EVENT_ID_REUSED'",[snapshot.taskId])).length,1);
    assert.equal((await applyEvent(db,deviceId,{...b,eventId:randomUUID(),assignmentVersion:2})).result,'BLOCKED');
    const {deviceId:other}=await register(db);assert.equal((await applyEvent(db,other,{...b,deviceId:other})).result,'BLOCKED');
    const batch={batchId:randomUUID(),events:[b,c,end]};
    await assert.rejects(applyBatch(db,deviceId,batch,i=>{if(i===0)throw new Error('API terminated after first result');}));
    const reply=await applyBatch(db,deviceId,batch);assert.equal(reply.results[0].result,'DUPLICATE');assert.equal(reply.results[2].receipt?.taskStatus,'CONFIRMED');
    assert.equal((await applyEvent(db,deviceId,end)).result,'DUPLICATE');
    const [task]=await connection(db).execute('SELECT * FROM tasks WHERE id=?',[snapshot.taskId]);assert.equal(task.status,'CONFIRMED');assert.notEqual(task.confirmed_at,end.occurredAt);
    const [counts]=await connection(db).execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[snapshot.taskId]);assert.equal(Number(counts.n),3);
    assert.equal((await applyEvent(db,deviceId,{...a,eventId:randomUUID(),seq:5})).code,'TASK_ALREADY_CONFIRMED');store.close();
  }finally{await db.close(true);}
});
test('T11/T19 business rejection consumes seq and holds only its own task',async()=>{
  const db=await connectDb();try{
    const {deviceId,snapshot}=await assigned(db);
    const event:any={eventId:randomUUID(),deviceId,taskId:snapshot.taskId,assignmentVersion:1,seq:1,occurredAt:new Date().toISOString(),type:'COMPLETE',payload:{}};
    const r=await applyEvent(db,deviceId,event);assert.equal(r.result,'REJECTED');assert.equal(r.receipt?.taskStatus,'HOLD');
    const duplicate=await applyEvent(db,deviceId,event);assert.equal(duplicate.result,'DUPLICATE');assert.equal(duplicate.originalResult,'REJECTED');
    assert.equal((await applyEvent(db,deviceId,{...event,eventId:randomUUID(),seq:2})).code,'TASK_ON_HOLD');
    const healthy=await assigned(db);assert.equal((await applyEvent(db,healthy.deviceId,{...event,eventId:randomUUID(),taskId:healthy.snapshot.taskId,deviceId:healthy.deviceId,type:'SCAN_ITEM',payload:{productId:'a'.repeat(32),quantity:1}})).result,'APPLIED');
  }finally{await db.close(true);}
});
