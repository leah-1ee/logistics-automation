import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connectDb } from '../../src/server/db.js';
import { LocalStore } from '../../src/device/store.js';
import { assigned } from './helpers.js';
test('T08/T11/T26 local HTTP loopback/origin gates and durable QR action contract',async()=>{
  const db=await connectDb(),port=41000+process.pid%1000,root='http://127.0.0.1:'+port;let child:any;
  try{
    const a=await assigned(db),path=mkdtempSync(tmpdir()+'/logistics-local-http-')+'/d.sqlite';const store=new LocalStore(path,a.deviceId);store.download(a.snapshot);store.close();
    child=spawn(process.execPath,['--import','tsx','src/device/main.ts'],{env:{...process.env,DEVICE_DB:path,DEVICE_ID:a.deviceId,DEVICE_TOKEN:a.token,DEVICE_PORT:String(port),LOCAL_ORIGIN:root,SERVER_URL:'http://127.0.0.1:9'},stdio:'ignore'});
    for(let i=0;i<100;i++){try{if((await fetch(root+'/local/v1/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
    const pathApi='/local/v1/tasks/'+a.snapshot.taskId;
    const post=(suffix:string,body:any,origin=root)=>fetch(root+pathApi+suffix,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('/scans',{qrText:'LOPS1:PRODUCT:'+'a'.repeat(32)},'http://untrusted.example')).status,403);
    assert.equal((await post('/scans',{qrText:'bad qr'})).status,400);
    assert.equal((await (await fetch(root+pathApi)).json()).nextSeq,1);
    const result=await post('/scans',{qrText:'LOPS1:PRODUCT:'+'a'.repeat(32)});assert(result.ok);const body=await result.json();assert.equal(body.task.nextSeq,2);
    assert.equal((await post('/complete',{})).status,409);
    const history=await (await fetch(root+pathApi+'/history')).json();assert.equal(history.events.length,1);assert.equal(history.events[0].event.eventId,body.event.eventId);
    assert.equal((await fetch(root+'/device')).status,200);
  }finally{if(child){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}await db.close(true);}
});
