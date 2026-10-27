import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { assign } from '../../src/fulfillment/tasks.js';
import { processJob } from '../../src/jobs/jobs.js';
import { validate,snapshotHash } from '../../src/shared/contracts.js';
import { register,sourcePage } from './helpers.js';
test('T05/T06/T07/T22 real MySQL task job replay, rollback and immutable assignment',async()=>{
  const db=await connectDb();try {
    const {runId,deviceId}=await register(db);await ingestPage(db,runId,sourcePage(runId),null);
    const [job]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=?',[runId]);
    await assert.rejects(processJob(db,job.id,s=>{if(s==='after_work')throw new Error('injected rollback');}));
    assert.equal((await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId])).length,0);
    await connection(db).execute('UPDATE outbox_jobs SET available_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',job.id]);
    await Promise.all([processJob(db,job.id),processJob(db,job.id)]);
    const tasks=await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId]);assert.equal(tasks.length,1);
    const body={requestId:randomUUID(),deviceId,reason:'synthetic test assignment'};
    const snapshot=await assign(db,'test-operator',tasks[0].id,body);validate('TaskSnapshot',snapshot);assert.equal(snapshotHash(snapshot),snapshot.snapshotHash);
    assert.deepEqual(await assign(db,'test-operator',tasks[0].id,body),snapshot);
    await assert.rejects(assign(db,'test-operator',tasks[0].id,{...body,requestId:randomUUID()}));
    await assert.rejects(assign(db,'test-operator',tasks[0].id,{...body,reason:'changed content'}));
  } finally{await db.close(true);}
});
