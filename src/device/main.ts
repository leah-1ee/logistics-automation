import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { httpApp } from '../server/http.js';
import { pageLimit,Problem } from '../shared/contracts.js';
import { LocalStore } from './store.js';
import { Sync } from './sync.js';
import { localAuthorize } from './security.js';
const express=createRequire(import.meta.url)('express');
const store=new LocalStore(process.env.DEVICE_DB||'var/device.sqlite',process.env.DEVICE_ID!);
const sync=new Sync(store,process.env.SERVER_URL||'http://127.0.0.1:3000',process.env.DEVICE_TOKEN!,process.env.DATASET_RUN_ID!);
const origin=process.env.LOCAL_ORIGIN||'http://127.0.0.1:3200';
const app=await httpApp('/local/v1',{
  local_health:async()=>{store.db.prepare('SELECT 1').get();return {status:'ok',database:'up',redis:'not_checked',version:process.env.APP_VERSION||'0.1.0'};},
  local_list:async req=>store.list(pageLimit(req.query.limit),req.query.cursor||''),
  local_get:async(_req,p)=>store.get(p.taskId),
  local_scan:async(req,p)=>store.scan(p.taskId,req.body.qrText),
  local_reverse:async(req,p)=>store.action(p.taskId,'REVERSE_SCAN',req.body),
  local_complete:async(_req,p)=>store.action(p.taskId,'COMPLETE',{}),
  local_history:async(_req,p)=>{store.get(p.taskId);const r=store.db.prepare('SELECT value FROM sync_meta WHERE key=?').get('blocked:'+p.taskId) as any;return {events:store.events(p.taskId).map(({event,status,receipt})=>({event,status,receipt})),syncError:r?.value||store.retryMeta(p.taskId)?.code||null};},
  local_sync_status:async()=>store.syncStatus(),
  local_retry:async()=>{store.retryNow();void sync.tick();return {accepted:true,requestId:randomUUID()};}
},async req=>localAuthorize(req,origin));
const bundle=resolve('dist/web');
if(existsSync(bundle)) {app.use(express.static(bundle));app.use('/device',(_req:any,res:any)=>res.sendFile(resolve(bundle,'index.html')));}
await app.listen(Number(process.env.DEVICE_PORT||3200),'127.0.0.1');
let refreshBusy=false;
const syncTimer=setInterval(()=>void sync.tick(),1000);
const downloadTimer=setInterval(async()=>{if(refreshBusy)return;refreshBusy=true;try{await sync.download();await sync.report();}catch(e:any){console.error('Device connection delayed',e.message);}finally{refreshBusy=false;}},5000);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{clearInterval(syncTimer);clearInterval(downloadTimer);await app.close();while(sync.busy||refreshBusy)await new Promise(r=>setTimeout(r,50));store.close();});
