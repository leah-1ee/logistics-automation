import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue,Worker } from 'bullmq';
import { connectDb,connection } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { dispatch,processJob,redisOptions } from '../../src/jobs/jobs.js';
import { register,sourcePage } from './helpers.js';
test('T21 DB expired outbox reconstructs missing Redis delivery; BullMQ worker applies once',async()=>{
  const db=await connectDb(),prefix='test-'+randomUUID();const queue=new Queue('ops-jobs',{connection:redisOptions(),prefix});
  const worker=new Worker('ops-jobs',async j=>processJob(db,j.data.outboxJobId),{connection:redisOptions(),prefix,concurrency:1});queue.on('error',()=>{});worker.on('error',()=>{});
  try{
    const {runId}=await register(db);await ingestPage(db,runId,sourcePage(runId),null);
    const [job]=await connection(db).execute('SELECT * FROM outbox_jobs WHERE run_id=?',[runId]);
    // Simulate delivery already lost from Redis, without deleting any queue or original records.
    await connection(db).execute("UPDATE outbox_jobs SET status='DISPATCHED',lease_until=? WHERE id=?",['2000-01-01T00:00:00.000Z',job.id]);
    await dispatch(db,queue,1000,runId);
    for(let i=0;i<100;i++){const [j]=await connection(db).execute('SELECT status FROM outbox_jobs WHERE id=?',[job.id]);if(j.status==='DONE')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal((await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId])).length,1);
    assert.equal((await connection(db).execute('SELECT status FROM outbox_jobs WHERE id=?',[job.id]))[0].status,'DONE');
    await processJob(db,job.id);assert.equal((await connection(db).execute('SELECT * FROM tasks WHERE run_id=?',[runId])).length,1);
  }finally{await worker.close();await queue.close();await db.close(true);}
});
