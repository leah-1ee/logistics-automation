// Test-only process. There are no production fault-injection endpoints.
import { readFileSync } from 'node:fs';
import { connectDb } from '../src/server/db.js';
import { ingestPage } from '../src/ingestion/ingest.js';
import { processJob } from '../src/jobs/jobs.js';
import { LocalStore } from '../src/device/store.js';
import { httpApp } from '../src/server/http.js';
import { applyBatch } from '../src/sync/events.js';
import { deviceAuth } from '../src/server/device-auth.js';
const [mode,file]=process.argv.slice(2),input=JSON.parse(readFileSync(file,'utf8'));
const die=()=>process.kill(process.pid,'SIGKILL');
if(mode==='sqlite') {
  const store=new LocalStore(input.path,input.deviceId);
  store.scan(input.taskId,'LOPS1:PRODUCT:'+'a'.repeat(32),stage=>{if(stage===input.stage)die();});
  if(input.stage==='after_commit')die();store.close();
}else {
  const db=await connectDb();
  if(mode==='ingestion') {
    await ingestPage(db,input.runId,input.page,null,stage=>{if(stage===input.stage)die();});
    if(input.stage==='after_commit')die();await db.close(true);
  }else if(mode==='worker') {
    await processJob(db,input.jobId,stage=>{if(stage===input.stage)die();});
    if(input.stage==='after_commit')die();await db.close(true);
  }else if(mode==='api') {
    const app=await httpApp('/api/v1',{device_events:async req=>applyBatch(db,req.deviceId,req.body,i=>{if(i===0)die();})},async req=>{req.deviceId=await deviceAuth(db,req.headers.authorization);});
    await app.listen(input.port,'127.0.0.1');console.log('READY');
  }
}
