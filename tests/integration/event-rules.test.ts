import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { applyEvent } from '../../src/sync/events.js';
import { assigned,register,sourcePage,raw } from './helpers.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { correct,dailyReport } from '../../src/operations/api.js';
import { processJob } from '../../src/jobs/jobs.js';
import { assign } from '../../src/fulfillment/tasks.js';
test('T10/T15/T16 server reversal, double reversal, sequence reuse and over quantity hold',async()=>{
  const db=await connectDb();try{
    const a=await assigned(db);const make=(seq:number,type:any,payload:any):any=>({eventId:randomUUID(),taskId:a.snapshot.taskId,deviceId:a.deviceId,assignmentVersion:1,seq,type,payload,occurredAt:new Date().toISOString()});
    const scan=make(1,'SCAN_ITEM',{productId:'a'.repeat(32),quantity:1});assert.equal((await applyEvent(db,a.deviceId,scan)).result,'APPLIED');
    assert.equal((await applyEvent(db,a.deviceId,make(1,'SCAN_ITEM',{productId:'a'.repeat(32),quantity:1}))).code,'SEQ_ALREADY_USED');
    const reverse=make(2,'REVERSE_SCAN',{targetEventId:scan.eventId});assert.equal((await applyEvent(db,a.deviceId,reverse)).result,'APPLIED');
    assert.equal((await applyEvent(db,a.deviceId,reverse)).result,'DUPLICATE');
    const failed=await applyEvent(db,a.deviceId,make(3,'REVERSE_SCAN',{targetEventId:scan.eventId}));assert.equal(failed.result,'REJECTED');assert.equal(failed.code,'INVALID_REVERSAL');
    const [count]=await connection(db).execute('SELECT SUM(applied_qty) n FROM task_items WHERE task_id=?',[a.snapshot.taskId]);assert.equal(Number(count.n),0);
    const b=await assigned(db);for(let i=1;i<=3;i++){const r=await applyEvent(db,b.deviceId,{...scan,eventId:randomUUID(),deviceId:b.deviceId,taskId:b.snapshot.taskId,seq:i});assert.equal(r.result,i<3?'APPLIED':'REJECTED');}
  }finally{await db.close(true);}
});
test('T30 old revision job is superseded after a source conflict and audited correction',async()=>{
  const db=await connectDb();try{
    const {runId}=await register(db);await ingestPage(db,runId,sourcePage(runId,[raw],false),null);
    const changed=structuredClone(raw);changed.items[0].productId='b'.repeat(32);await ingestPage(db,runId,sourcePage(runId,[changed]),'next');
    const [o]=await connection(db).execute('SELECT id FROM orders WHERE run_id=?',[runId]);
    await correct(db,'revision-test',o.id,{requestId:randomUUID(),expectedRevision:1,reason:'synthetic source conflict reviewed',items:[{productId:'a'.repeat(32),sellerId:'d'.repeat(32),requiredQty:2}]});
    const jobs=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=? ORDER BY dedupe_key',[runId]);assert.equal(jobs.length,2);
    await processJob(db,jobs[0].id);assert.equal((await connection(db).execute('SELECT id FROM tasks WHERE run_id=?',[runId])).length,0);
    await processJob(db,jobs[1].id);assert.equal((await connection(db).execute('SELECT id FROM tasks WHERE run_id=?',[runId])).length,1);
  }finally{await db.close(true);}
});
test('T24 later completion on an already rebuilt day gets a distinct durable report job',async()=>{
  const db=await connectDb();try{
    const {runId,deviceId}=await register(db);const second={...structuredClone(raw),sourceRecordId:'e'.repeat(32),sourceOrderId:'e'.repeat(32)};
    await ingestPage(db,runId,sourcePage(runId,[raw,second]),null);
    for(const j of await connection(db).execute('SELECT id FROM outbox_jobs WHERE run_id=?',[runId]))await processJob(db,j.id);
    const tasks=await connection(db).execute('SELECT id FROM tasks WHERE run_id=? ORDER BY id',[runId]);let index=0;
    for(const task of tasks){
      await assign(db,'daily-test',task.id,{requestId:randomUUID(),deviceId,reason:'same-day report test'});let seq=0;
      for(const productId of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)])await applyEvent(db,deviceId,{eventId:randomUUID(),taskId:task.id,deviceId,assignmentVersion:1,seq:++seq,occurredAt:new Date().toISOString(),type:'SCAN_ITEM',payload:{productId,quantity:1}});
      await applyEvent(db,deviceId,{eventId:randomUUID(),taskId:task.id,deviceId,assignmentVersion:1,seq:++seq,occurredAt:new Date().toISOString(),type:'COMPLETE',payload:{}});
      const jobs=await connection(db).execute("SELECT * FROM outbox_jobs WHERE run_id=? AND type='REBUILD_REPORT_DAY'",[runId]);for(const j of jobs)await processJob(db,j.id);
      const [t]=await connection(db).execute('SELECT business_date FROM tasks WHERE id=?',[task.id]);const report=await dailyReport(db,runId,t.business_date);assert.equal(report.taskCount,++index);assert.equal(report.itemCount,index*3);
    }
  }finally{await db.close(true);}
});
