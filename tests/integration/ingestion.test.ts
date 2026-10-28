import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb, connection } from '../../src/server/db.js';
import { ingestPage, ingestionStatus } from '../../src/ingestion/ingest.js';
import { register,raw,sourcePage } from './helpers.js';
test('T01/T02/T03/T04/T32 MySQL page replay, rollback, checkpoint and conflict evidence',async()=>{
  const db=await connectDb();try {
    for(const trigger of ['before','during','before_commit']) {
      const {runId}=await register(db);const page=sourcePage(runId);
      await assert.rejects(ingestPage(db,runId,page,null,s=>{if(s===trigger)throw new Error('injected rollback');}));
      assert.equal((await ingestionStatus(db,runId)).receivedCount,0);
      await ingestPage(db,runId,page,null);await ingestPage(db,runId,page,null);
      assert.equal((await ingestionStatus(db,runId)).receivedCount,1);
    }
    const {runId}=await register(db);const page=sourcePage(runId,[raw],false);
    await connection(db).execute("UPDATE dataset_runs SET status='PREPARING' WHERE id=?",[runId]);
    await assert.rejects(ingestPage(db,runId,page,null),{code:'PRODUCT_MASTER_NOT_READY'});
    assert.equal((await ingestionStatus(db,runId)).receivedCount,0);
    await connection(db).execute("UPDATE dataset_runs SET status='REGISTERED' WHERE id=?",[runId]);
    await ingestPage(db,runId,page,null);
    const changed=structuredClone(raw);changed.items[0].productId='b'.repeat(32);
    await ingestPage(db,runId,sourcePage(runId,[changed]),'next');
    const [r]=await connection(db).execute('SELECT payload FROM raw_orders WHERE run_id=?',[runId]);
    assert.equal((typeof r.payload==='string'?JSON.parse(r.payload):r.payload).items[0].productId,'a'.repeat(32));
    assert.equal((await ingestionStatus(db,runId)).holdCount,1);
    const conflicts=await connection(db).execute('SELECT * FROM source_conflicts c JOIN raw_orders r ON r.id=c.raw_order_id WHERE r.run_id=?',[runId]);assert.equal(conflicts.length,1);
    const aliasRun=await register(db);const second={...structuredClone(raw),sourceRecordId:'e'.repeat(32),sourceOrderId:'e'.repeat(32)};
    await ingestPage(db,aliasRun.runId,sourcePage(aliasRun.runId,[raw,second],false),null);
    const alias={...structuredClone(raw),sourceOrderId:second.sourceOrderId};
    await ingestPage(db,aliasRun.runId,sourcePage(aliasRun.runId,[alias]),'next');
    assert.equal((await ingestionStatus(db,aliasRun.runId)).receivedCount,2);
    assert.equal((await ingestionStatus(db,aliasRun.runId)).holdCount,2);
    const both=await connection(db).execute('SELECT c.id FROM source_conflicts c JOIN raw_orders r ON r.id=c.raw_order_id WHERE r.run_id=?',[aliasRun.runId]);assert.equal(both.length,2);
  }finally{await db.close(true);}
});
