import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Recorder} from '../../src/observability/b0.js';

test('2GiB default/environment/clamp preserve existing memory buffer limits',()=>{
  for(const value of [undefined,'2147483648','3221225472','-1','not-a-number']){
    const env:NodeJS.ProcessEnv={...process.env,B0_OBSERVE:'0'};if(value===undefined)delete env.B0_FILE_BYTES;else env.B0_FILE_BYTES=value;
    const child=spawnSync(process.execPath,['--input-type=module','-e',"const {recorder}=await import('./dist/src/observability/b0.js');console.log(JSON.stringify(recorder.options));"],{env,encoding:'utf8'});
    assert.equal(child.status,0);const options=JSON.parse(child.stdout);
    assert.equal(options.maxFileBytes,2*1024**3);assert.equal(options.maxBufferBytes,8*1024**2);assert.equal(options.maxRecords,8192);
  }
});

test('file byte budget remains cumulative across flushes without writing a multi-GiB test file',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'b0-file-limit-'));
  const r=new Recorder({enabled:true,directory,experimentId:'limit-only',service:'runner',maxRecords:8192,maxBufferBytes:8*1024**2,maxFileBytes:600});
  try{
    r.emit({kind:'span',label:'source.fetch',count:1});await r.flush();assert.equal(r.stats.written,1);
    const size=(await stat(join(directory,`${r.processIdentity}.jsonl`))).size;assert.ok(size>0&&size<=600);
    for(let i=0;i<20;i++){r.emit({kind:'span',label:'source.fetch',count:1});await r.flush();}
    assert.ok(r.stats.dropped>0);assert.ok(r.stats.written<21);
    const finalSize=(await stat(join(directory,`${r.processIdentity}.jsonl`))).size;assert.ok(finalSize>=size&&finalSize<=600);
  }finally{await r.close();await rm(directory,{recursive:true,force:true});}
});
