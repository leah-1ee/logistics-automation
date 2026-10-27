import { connectDb, connection } from './db.js';
import { requireSecrets } from './auth.js';
import { httpApp } from './http.js';
import { Redis } from 'ioredis';
import { apiHandlers } from '../operations/api.js';
import { adminAuth } from './auth.js';
import { deviceAuth } from './device-auth.js';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
requireSecrets();
const db = await connectDb();
const redis = new Redis({host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT||6380),lazyConnect:true,maxRetriesPerRequest:0,enableOfflineQueue:false,connectTimeout:1000,retryStrategy:()=>null});
redis.on('error',()=>{});
const health = ()=>({status:'ok',database:'not_checked',redis:'not_checked',version:'0.1.0'});
const api=apiHandlers(db);
const app = await httpApp('/api/v1', {
  ...api.handlers,
  health_live:async()=>health(),
  health_ready:async()=>{
    let database='down',cache='down';
    try { await connection(db).execute('SELECT 1'); database='up'; } catch {}
    try { if(redis.status==='wait'||redis.status==='end') await redis.connect(); await redis.ping();cache='up'; } catch {}
    const body={...health(),status:database==='down'?'unavailable':cache==='down'?'degraded':'ok',database,redis:cache};
    return database==='down'?{$http:true,status:503,body}:body;
  }
},async(req,security)=>{
  if(security.some((s:any)=>s.adminAuth))req.actorId=adminAuth(req.headers.authorization);
  if(security.some((s:any)=>s.deviceAuth))req.deviceId=await deviceAuth(db,req.headers.authorization);
});
const express=createRequire(import.meta.url)('express'),bundle=resolve('dist/web');
if(existsSync(bundle)){app.use(express.static(bundle));app.use('/admin',(_req:any,res:any)=>res.sendFile(resolve(bundle,'index.html')));}
await app.listen(Number(process.env.API_PORT||3000),process.env.API_HOST||'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();await api.close();redis.disconnect();await db.close(true);});
