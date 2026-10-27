import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { assigned } from './helpers.js';
test('T26/T31 real Nest HTTP roles, bounded pages, stale observation, CSV, input rejection',async()=>{
  const db=await connectDb();const apiPort=35000+process.pid%1000;
  const child=spawn(process.execPath,['--import','tsx','src/server/main.ts'],{env:{...process.env,API_PORT:String(apiPort)},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',d=>logs+=d.toString());
  const root='http://127.0.0.1:'+apiPort;
  try{
    for(let i=0;i<100;i++){try{if((await fetch(root+'/api/v1/health')).ok)break;}catch{}if(child.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,50));}
    const {runId,token,snapshot,deviceId}=await assigned(db);
    const get=(path:string,t?:string)=>fetch(root+'/api/v1/'+path,{headers:t?{Authorization:'Bearer '+t}:{}});
    const post=(path:string,body:any,t=process.env.ADMIN_TOKEN!)=>fetch(root+'/api/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await get('orders?datasetRunId='+runId)).status,401);
    assert.equal((await get('orders?datasetRunId='+runId,token)).status,403);
    assert.equal((await get('device/tasks?datasetRunId='+runId,process.env.ADMIN_TOKEN)).status,403);
    assert.equal((await get('orders?datasetRunId='+runId+'&limit=201',process.env.ADMIN_TOKEN)).status,400);
    const orders=await (await get('orders?datasetRunId='+runId+'&query='+snapshot.externalOrderId,process.env.ADMIN_TOKEN)).json();assert.equal(orders.items.length,1);
    assert.equal((await post('device/events',{batchId:randomUUID(),events:[]},token)).status,400);
    assert.equal((await post('tasks/'+snapshot.taskId+'/notes',{requestId:randomUUID(),reason:'x'.repeat(270000)})).status,413);
    assert.equal((await post('tasks/'+snapshot.taskId+'/notes',{requestId:randomUUID(),reason:'http test'})).status,201);
    assert.equal((await get('reports/daily.csv?datasetRunId='+runId+'&businessDate=2026-10-27',process.env.ADMIN_TOKEN)).headers.get('content-type')?.startsWith('text/csv'),true);
    assert.equal((await post('device/status',{appVersion:'test',observedAt:'2000-01-01T00:00:00Z',pendingCount:4,blockedTaskCount:0,oldestPendingAt:null},token)).status,200);
    await connection(db).execute('UPDATE devices SET report_received_at=? WHERE id=?',['2000-01-01T00:00:00.000Z',deviceId]);
    const devices=await (await get('devices?limit=200',process.env.ADMIN_TOKEN)).json();const d=devices.items.find((i:any)=>i.id===deviceId);assert.equal(d?.stale,true);assert.equal(d.lastReport.pendingCount,4);
    assert.equal((await get('ready')).status,200);
    assert.equal((await fetch(root+'/admin')).status,200);
  }finally{child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');await db.close(true);}
});
