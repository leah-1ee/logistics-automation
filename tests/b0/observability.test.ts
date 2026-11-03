import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Recorder, recorder, candidate, committed, observe, measure, observedSql } from '../../src/observability/b0.js';
import { connection, transaction } from '../../src/server/db.js';
import { ingestPage } from '../../src/ingestion/ingest.js';

test('transaction candidates survive successful resolution only; original return/error identities survive',async()=>{
  const original=recorder.emit,enabled=recorder.options.enabled;const events:any[]=[];
  recorder.options.enabled=true;recorder.emit=e=>{events.push(e);};
  try{
    const failure=new Error('synthetic rollback'),value={answer:42};
    await assert.rejects(committed('ingestion.page',async()=>{
      candidate('task_created','job.process',{taskId:randomUUID()});throw failure;
    }),error=>error===failure);
    assert.equal(events.filter(e=>e.kind==='task_created').length,0);
    assert.equal(await committed('ingestion.page',async done=>{candidate('task_created','job.process',{taskId:randomUUID()});done();return value;}),value);
    assert.equal(events.filter(e=>e.kind==='task_created').length,1);
    await assert.rejects(committed('ingestion.page',async done=>{candidate('task_created','job.process',{taskId:randomUUID()});done();throw failure;}),error=>error===failure);
    assert.equal(events.filter(e=>e.kind==='task_created').length,1);
    assert.ok(events.some(e=>e.outcome==='commit_outcome_unknown'));
    await measure('ingestion.status',()=>observedSql('SELECT status,COUNT(*) FROM orders',async()=>7));
    assert.equal(events.at(-1).sqlCount,1);
    recorder.emit=()=>{throw Error('sink fault');};
    assert.equal(await committed('job.process',async done=>{candidate('task_created','job.process',{taskId:randomUUID()});done();return value;}),value);
    assert.doesNotThrow(()=>observe('span','job.process'));
  }finally{recorder.emit=original;recorder.options.enabled=enabled;}
});

test('bounded asynchronous sink: overflow and failed writes are visible; records never contain arbitrary strings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'b0-recorder-'));
  try{
    const r=new Recorder({enabled:true,directory:dir,experimentId:'unit',service:'runner',maxRecords:1,maxBufferBytes:4096,maxFileBytes:1024});
    r.emit({kind:'span',label:'source.fetch',count:1});r.emit({kind:'span',label:'source.fetch',count:2});
    assert.equal(r.stats.dropped,1);await r.close();
    const health=JSON.parse(await readFile(join(dir,`${r.processIdentity}.health.json`),'utf8'));
    assert.equal(health.coverage,'INVALID');assert.equal(health.cleanClose,true);
    const row=JSON.parse((await readFile(join(dir,`${r.processIdentity}.jsonl`),'utf8')).trim());
    assert.equal(row.version,1);assert.equal(row.sequence,1);assert.ok(row.monotonicNs);assert.ok(row.wallTime);
    const bad=new Recorder({enabled:true,directory:dir,experimentId:'unit',service:'runner',maxRecords:2,maxBufferBytes:4096,maxFileBytes:4096});
    await writeFile(join(dir,`${bad.processIdentity}.jsonl`),'occupied');
    bad.emit({kind:'span',label:'source.fetch'});await bad.close();assert.ok(bad.stats.errors>0);assert.equal(bad.stats.dropped,1);
    const off=new Recorder({enabled:false,directory:join(dir,'must-not-exist'),experimentId:'off',service:'runner',maxRecords:1,maxBufferBytes:1,maxFileBytes:1});
    off.emit({kind:'span',label:'source.fetch'});await off.close();assert.equal(off.stats.attempted,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('ON/OFF preserve DB wrapper arguments, connection methods, values and product exceptions',async()=>{
  const enabled=recorder.options.enabled,emit=recorder.emit;
  recorder.emit=()=>{};
  const errors:any[]=[];
  try{for(const on of [false,true]){
    recorder.options.enabled=on;
    const context={},rows=[{value:7}],client={},calls:any[]=[];
    const native={execute:async(...args:any[])=>{calls.push(args);return rows;},getNativeClient(){assert.equal(this,native);return client;}};
    const inner={getConnection:()=>native,getTransactionContext:()=>context};
    const db:any={em:{fork:()=>({getConnection:()=>native,transactional:async(fn:any)=>fn(inner)})}};
    assert.equal((connection(db) as any).getNativeClient(),client);
    assert.equal(await transaction(db,tx=>tx.execute('SELECT 1',[7])),rows);
    assert.deepEqual(calls,[['SELECT 1',[7],'all',context]]);
    const sentinel=new Error('callback failure');
    await assert.rejects(transaction(db,async()=>{throw sentinel;}),e=>e===sentinel);
    try{await ingestPage(db,randomUUID(),{datasetRunId:randomUUID()},null);}catch(e:any){errors.push({name:e.name,code:e.code,status:e.status,message:e.message});}
  }
  assert.deepEqual(errors[0],errors[1]);assert.equal(errors.length,2);
  }finally{recorder.options.enabled=enabled;recorder.emit=emit;}
});
