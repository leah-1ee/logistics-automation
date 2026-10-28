import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connectDb } from '../../src/server/db.js';
import { apiHandlers } from '../../src/operations/api.js';
import { applyEvent,applyBatch } from '../../src/sync/events.js';
import { LocalStore } from '../../src/device/store.js';
import { Sync } from '../../src/device/sync.js';
import { assigned } from './helpers.js';

test('T07/T13/T14 confirmed tasks are not offered as new work; lost COMPLETE ACK still recovers',async()=>{
  const db=await connectDb(),a=await assigned(db),api=apiHandlers(db);
  const store=new LocalStore(mkdtempSync(tmpdir()+'/logistics-snapshot-lifecycle-')+'/device.sqlite',a.deviceId);
  const list=()=>api.handlers.device_tasks({deviceId:a.deviceId,query:{datasetRunId:a.runId,limit:'200'}},{});
  try{
    assert.equal((await list()).items.length,1);store.download(a.snapshot);
    for(const product of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)]){
      const e=store.scan(a.snapshot.taskId,'LOPS1:PRODUCT:'+product).event;store.accept(await applyEvent(db,a.deviceId,e));
    }
    const complete=store.action(a.snapshot.taskId,'COMPLETE',{}).event;await applyEvent(db,a.deviceId,complete); // Lose only the successful response.
    assert.equal((await list()).items.length,0,'a new download must not present server-confirmed work as DOWNLOADED');
    const sync=new Sync(store,'http://127.0.0.1','unused',a.runId,async(url,init)=>{
      if(new URL(String(url)).pathname.endsWith('/device/tasks'))return Response.json(await list());
      const request=JSON.parse(String(init?.body));return Response.json(await applyBatch(db,a.deviceId,{batchId:request.batchId||randomUUID(),events:request.events}));
    });
    await sync.download();assert.equal(store.get(a.snapshot.taskId).localStatus,'LOCAL_COMPLETED');assert.equal(store.syncStatus().pendingCount,1);
    await sync.tick();assert.equal(store.get(a.snapshot.taskId).localStatus,'SERVER_CONFIRMED');assert.equal(store.syncStatus().pendingCount,0);
    assert.equal(store.events(a.snapshot.taskId).at(-1).receipt.result,'DUPLICATE');assert.equal(store.events(a.snapshot.taskId).length,4);
  }finally{store.close();await api.close();await db.close(true);}
});
