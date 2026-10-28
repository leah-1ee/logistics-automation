import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { processJob } from '../../src/jobs/jobs.js';
import { correct,orderDetail,retryJob,dailyReport,apiHandlers } from '../../src/operations/api.js';
import { applyEvent } from '../../src/sync/events.js';
import { register,sourcePage,raw,assigned } from './helpers.js';
import { validate,parseJson,Problem } from '../../src/shared/contracts.js';
test('T30/T33 correction revision, immutable raw, superseded job and bounded job failures',async()=>{
  const db=await connectDb();try{
    const {runId}=await register(db);const source=structuredClone(raw);source.items[0].productId='f'.repeat(32);
    await ingestPage(db,runId,sourcePage(runId,[source]),null);
    const [o]=await connection(db).execute('SELECT id FROM orders WHERE run_id=?',[runId]);const before=await orderDetail(connection(db),o.id);
    const body={requestId:randomUUID(),expectedRevision:1,reason:'synthetic fixture correction evidence',items:[{productId:'a'.repeat(32),sellerId:'d'.repeat(32),requiredQty:3}]};
    const after=await correct(db,'test-admin',o.id,body);validate('OrderDetail',after);assert.equal(after.order.revision,2);assert.deepEqual(after.raw,before.raw);assert.equal(after.order.status,'READY');assert.equal(after.audit.length,1);
    assert.deepEqual(await correct(db,'test-admin',o.id,body),after);
    const [job]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=?',[runId]);
    for(let i=0;i<5;i++){
      await connection(db).execute('UPDATE outbox_jobs SET available_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',job.id]);
      await assert.rejects(processJob(db,job.id,()=>{throw new Error('transient test failure');}));
    }
    const [failed]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE id=?',[job.id]);assert.equal(failed.status,'FAILED');assert.equal(failed.attempts,5);
    const retried=await retryJob(db,'test-admin',job.id,{requestId:randomUUID(),reason:'transient cause fixed'});assert.equal(retried.status,'PENDING');await processJob(db,job.id);
    const tasks=await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId]);assert.equal(tasks.length,1);
    await assert.rejects(correct(db,'test-admin',o.id,{...body,requestId:randomUUID(),expectedRevision:2}));
    const api=apiHandlers(db);const note=await api.handlers.tasks_note({actorId:'test-admin',body:{requestId:randomUUID(),reason:'hold reviewed; no force completion'}},{taskId:tasks[0].id});validate('Note',note);
    const details=await api.handlers.tasks_get({}, {taskId:tasks[0].id});assert.equal(details.notes[0].reason,note.reason);await api.close();
    const permanentRun=await register(db);await ingestPage(db,permanentRun.runId,sourcePage(permanentRun.runId),null);const [pj]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=?',[permanentRun.runId]);
    await assert.rejects(processJob(db,pj.id,()=>{throw new Problem('PERMANENT_INPUT_ERROR');}));
    await assert.rejects(retryJob(db,'test-admin',pj.id,{requestId:randomUUID(),reason:'must not bypass permanent domain error'}));
  }finally{await db.close(true);}
});
test('T24/T25 reporting recomputes only confirmed tasks and deduplicates completion',async()=>{
  const db=await connectDb();try{
    const {runId,deviceId,snapshot}=await assigned(db);
    let seq=0;let last:any;
    for(const productId of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)])last=await applyEvent(db,deviceId,{eventId:randomUUID(),taskId:snapshot.taskId,deviceId,assignmentVersion:1,seq:++seq,occurredAt:'2026-10-28T00:00:00Z',type:'SCAN_ITEM',payload:{productId,quantity:1}});
    const complete:any={eventId:randomUUID(),taskId:snapshot.taskId,deviceId,assignmentVersion:1,seq:++seq,occurredAt:'2026-10-26T00:00:00Z',type:'COMPLETE',payload:{}};
    await applyEvent(db,deviceId,complete);await applyEvent(db,deviceId,complete);
    const jobs=await connection(db).execute("SELECT * FROM outbox_jobs WHERE run_id=? AND type='REBUILD_REPORT_DAY'",[runId]);assert.equal(jobs.length,1);
    const date=parseJson(jobs[0].payload).businessDate;assert((await dailyReport(db,runId,date)).rebuildPending);
    await processJob(db,jobs[0].id);await processJob(db,jobs[0].id);
    const report=await dailyReport(db,runId,date);validate('DailyReport',report);assert.equal(report.taskCount,1);assert.equal(report.itemCount,3);assert.equal(report.rebuildPending,false);assert.deepEqual(report.products.map((p:any)=>Number(p.quantity)),[2,1]);
  }finally{await db.close(true);}
});
