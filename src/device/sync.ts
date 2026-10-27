import { randomUUID } from 'node:crypto';
import { LocalStore } from './store.js';
import { now,validate } from '../shared/contracts.js';
export function retryDelay(attempt:number,random=Math.random) {return Math.min(60000,1000*2**Math.max(0,attempt-1)+Math.floor(random()*500));}
export class Sync {
  busy=false;
  constructor(public store:LocalStore,public server:string,public token:string,public runId:string,public transport:typeof fetch=fetch){}
  async call(path:string,body?:any) {
    const r=await this.transport(new URL('/api/v1/'+path,this.server),{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+this.token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    if(!r.ok) {const e:any=new Error('HTTP_'+r.status);e.status=r.status;const retry=r.headers.get('Retry-After');if(retry)e.delay=/^\d+$/.test(retry)?+retry*1000:Math.max(0,Date.parse(retry)-Date.now());throw e;}
    return r.json();
  }
  async download() {
    let cursor:string|null=null;
    do {const q=new URLSearchParams({datasetRunId:this.runId,limit:'200',...(cursor?{cursor}:{})});const p=await this.call('device/tasks?'+q);validate('SnapshotPage',p);for(const s of p.items)this.store.download(s);cursor=p.nextCursor;}while(cursor);
  }
  async tick() {
    if(this.busy)return;this.busy=true;
    try {
      const groups=new Map<string,any[]>();for(const e of this.store.pending()){const group=groups.get(e.taskId)||[];group.push(e);groups.set(e.taskId,group);}
      for(const [taskId,pending] of groups) {
        const retry=this.store.retryMeta(taskId);if(retry&&retry.nextAt>Date.now())continue;
        try {
          const events=pending.slice(0,100),batchId=randomUUID();const reply=await this.call('device/events',{batchId,events});validate('BatchResult',reply);
          if(reply.batchId!==batchId||reply.results.length!==events.length||new Set(reply.results.map((r:any)=>r.eventId)).size!==events.length)throw new Error('INVALID_BATCH_RECEIPT');
          for(const result of reply.results)if(!events.some(e=>e.eventId===result.eventId&&e.taskId===result.taskId))throw new Error('UNKNOWN_BATCH_RECEIPT');
          let deferred=false;
          for(const result of reply.results){this.store.accept(result);if(result.result==='DEFERRED')deferred=true;}
          if(deferred)throw new Error('DEFERRED');
        }catch(error:any) {
          if(error.status===401||error.status===403){this.store.atomic(()=>this.store.block(taskId,'AUTHENTICATION_REQUIRED'));continue;}
          const attempt=(retry?.attempt||0)+1;
          const pause=attempt>=5;this.store.setRetry(taskId,attempt,pause?'RETRY_BUDGET_EXHAUSTED':error.message,pause?365*24*3600*1000:(error.status===429&&Number.isFinite(error.delay)?error.delay:retryDelay(attempt)));
        }
      }
    }finally{this.busy=false;}
  }
  async report(){const s=this.store.syncStatus();await this.call('device/status',{appVersion:process.env.APP_VERSION||'0.1.0',observedAt:now(),pendingCount:s.pendingCount,blockedTaskCount:s.blockedTaskCount,oldestPendingAt:s.oldestPendingAt});}
}
