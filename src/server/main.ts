import { connectDb, connection } from './db.js';
import { requireSecrets } from './auth.js';
import { httpApp } from './http.js';
import { Redis } from 'ioredis';
requireSecrets();
const db = await connectDb();
const redis = new Redis({host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT||6380),lazyConnect:true,maxRetriesPerRequest:0,enableOfflineQueue:false,connectTimeout:1000,retryStrategy:()=>null});
redis.on('error',()=>{});
const health = ()=>({status:'ok',database:'not_checked',redis:'not_checked',version:'0.1.0'});
const app = await httpApp('/api/v1', {
  health_live:async()=>health(),
  health_ready:async()=>{
    let database='down',cache='down';
    try { await connection(db).execute('SELECT 1'); database='up'; } catch {}
    try { if(redis.status==='wait'||redis.status==='end') await redis.connect(); await redis.ping();cache='up'; } catch {}
    const body={...health(),status:database==='down'?'unavailable':cache==='down'?'degraded':'ok',database,redis:cache};
    return database==='down'?{$http:true,status:503,body}:body;
  }
});
await app.listen(Number(process.env.API_PORT||3000),process.env.API_HOST||'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();redis.disconnect();await db.close(true);});
