import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../src/device/store.js';
import { Sync,retryDelay } from '../src/device/sync.js';
import { snapshotHash } from '../src/shared/contracts.js';
import { localAuthorize } from '../src/device/security.js';
const fixture=JSON.parse(readFileSync('docs/examples.json','utf8')).taskSnapshot;
test('T19/T33 device task isolation, bounded retries and Retry-After',async()=>{
  const store=new LocalStore(mkdtempSync(tmpdir()+'/logistics-retry-')+'/d.sqlite','pi-01');const a=structuredClone(fixture),b={...structuredClone(fixture),taskId:randomUUID()};b.snapshotHash=snapshotHash(b);
  store.download(a);store.download(b);store.scan(a.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32));store.scan(b.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32));
  const calls:string[]=[];
  const transport:any=async(_url:any,init:any)=>{const body=JSON.parse(init.body),e=body.events[0];calls.push(e.taskId);return Response.json({batchId:body.batchId,serverTime:new Date().toISOString(),results:[e.taskId===a.taskId?{eventId:e.eventId,taskId:e.taskId,result:'BLOCKED',code:'TASK_ON_HOLD',retryable:false}:{eventId:e.eventId,taskId:e.taskId,result:'APPLIED',code:'OK',retryable:false,receipt:{committedAt:new Date().toISOString(),processedSeq:1,taskStatus:'IN_PROGRESS',confirmedAt:null,appliedItems:[]}}]});};
  await new Sync(store,'http://localhost','unused',a.datasetRunId,transport).tick();assert.equal(calls.length,2);assert.equal(store.get(a.taskId).syncStatus,'BLOCKED');assert.equal(store.get(b.taskId).syncStatus,'SYNCED');
  const c={...structuredClone(fixture),taskId:randomUUID()};c.snapshotHash=snapshotHash(c);store.download(c);store.scan(c.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32));
  const sync=new Sync(store,'http://localhost','unused',a.datasetRunId,async()=>new Response('',{status:429,headers:{'Retry-After':'7'}}));
  await sync.tick();assert(store.retryMeta(c.taskId).nextAt-Date.now()>6000);
  for(let i=1;i<5;i++){store.db.prepare('UPDATE sync_meta SET value=? WHERE key=?').run(JSON.stringify({...store.retryMeta(c.taskId),nextAt:0}),'retry:'+c.taskId);await sync.tick();}
  assert.equal(store.retryMeta(c.taskId).attempt,5);assert.equal(store.retryMeta(c.taskId).code,'RETRY_BUDGET_EXHAUSTED');store.retryNow();assert.equal(store.retryMeta(c.taskId),null);assert.equal(store.get(a.taskId).syncStatus,'BLOCKED');
  assert.equal(retryDelay(99,()=>0.5),60000);store.close();
});
test('T26 local origin, host, remote address and missing mutation origin',()=>{
  const req={headers:{host:'127.0.0.1:3200',origin:'http://127.0.0.1:3200'},method:'POST',socket:{remoteAddress:'127.0.0.1'}};
  localAuthorize(req,'http://127.0.0.1:3200');
  assert.throws(()=>localAuthorize({...req,headers:{...req.headers,origin:'http://evil.example'}},'http://127.0.0.1:3200'));
  assert.throws(()=>localAuthorize({...req,headers:{host:'127.0.0.1:3200'}},'http://127.0.0.1:3200'));
  assert.throws(()=>localAuthorize({...req,socket:{remoteAddress:'192.168.0.3'}},'http://127.0.0.1:3200'));
});
