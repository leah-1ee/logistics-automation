/** B0 sidecar: best effort observations, never a source of business success. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const labels = [
  'other','source.fetch','source.body','source.validation','ingestion.status','ingestion.page',
  'dispatch.scan','dispatch.transaction','dispatch.redis.get','dispatch.redis.state',
  'dispatch.redis.remove','dispatch.redis.add','job.process','job.failure',
  'sql.checkpoint','sql.status','sql.products','sql.sellers','sql.raw.identity',
  'sql.raw.insert','sql.order.insert','sql.items.insert','sql.outbox.insert','sql.dispatch.scan',
  'sql.job.lock','sql.job.update','sql.attempt.insert','sql.task.read','sql.task.insert',
  'sql.task.items','sql.order.read','sql.order.update','sql.other'
] as const;
export type Label = typeof labels[number];
type Kind = 'span'|'sql'|'transaction'|'raw_order_created'|'outbox_write_resolved'|
  'task_created'|'task_noop'|'job_completed'|'dispatch_committed'|'source_page'|'source_eof';
export type Fields = {runId?:string;rawId?:string;orderId?:string;taskId?:string;jobId?:string;
  httpStatus?:number;count?:number;itemCount?:number;outboxCount?:number;attempt?:number;
  startedWallTime?:string;startedMonotonicNs?:string;
  classification?:'READY'|'DATA_HOLD'|'UNSUPPORTED';durationMs?:number;
  outcome?:'ok'|'error'|'callback_failed'|'commit_outcome_unknown';sqlCount?:number};
type Event = Fields & {kind:Kind;label:Label};
type Pending = {events:Event[];sqlCount:number;overflow:boolean};
const pending = new AsyncLocalStorage<Pending>();
const counters = new AsyncLocalStorage<{count:number}[]>();
const clamp=(v:string|undefined,fallback:number,max:number)=>{
  const n=Number(v);return Number.isSafeInteger(n)&&n>0?Math.min(n,max):fallback;
};

export class Recorder {
  readonly processIdentity = `${process.pid}-${randomUUID()}`;
  private queue:string[]=[];
  private queuedBytes=0;
  private sequence=0;
  private bytes=0;
  private acceptedBytes=0;
  private flushing:Promise<void>|undefined;
  private timer:NodeJS.Timeout|undefined;
  private handle:Awaited<ReturnType<typeof open>>|undefined;
  private clean=false;
  readonly stats={attempted:0,written:0,dropped:0,errors:0,candidateDrops:0,closed:false};
  constructor(readonly options:{enabled:boolean;directory:string;experimentId:string;service:string;
    maxRecords:number;maxBufferBytes:number;maxFileBytes:number;intervalMs?:number}) {
    if(options.enabled){
      this.timer=setInterval(()=>{void this.flush();},options.intervalMs??250);
      this.timer.unref();
    }
  }
  get enabled(){return this.options.enabled;}
  emit(event:Event):void {
    if(!this.enabled)return;
    try {
      this.stats.attempted++;const sequence=++this.sequence;
      // Explicit allowlist; no caller-supplied object/string is serialized wholesale.
      if(!labels.includes(event.label))throw Error('label');
      const row:Record<string,unknown>={version:1,experimentId:this.options.experimentId,
        service:this.options.service,processIdentity:this.processIdentity,pid:process.pid,sequence,
        wallTime:new Date().toISOString(),monotonicNs:process.hrtime.bigint().toString(),
        kind:event.kind,label:event.label};
      for(const key of ['runId','rawId','orderId','taskId','jobId'] as const){
        const v=event[key];if(v!==undefined){if(!/^[a-f0-9-]{32,36}$/i.test(v))throw Error('id');row[key]=v;}
      }
      for(const key of ['httpStatus','count','itemCount','outboxCount','attempt','durationMs','sqlCount'] as const){
        const v=event[key];if(v!==undefined){if(!Number.isFinite(v)||v<0)throw Error('number');row[key]=v;}
      }
      if(event.startedWallTime!==undefined&&/^\d{4}-\d{2}-\d{2}T/.test(event.startedWallTime))row.startedWallTime=event.startedWallTime;
      if(event.startedMonotonicNs!==undefined&&/^\d+$/.test(event.startedMonotonicNs))row.startedMonotonicNs=event.startedMonotonicNs;
      if(event.outcome!==undefined)row.outcome=event.outcome;
      if(event.classification!==undefined)row.classification=event.classification;
      const line=JSON.stringify(row)+'\n',size=Buffer.byteLength(line);
      if(this.stats.closed||this.queue.length>=this.options.maxRecords||this.queuedBytes+size>this.options.maxBufferBytes||this.acceptedBytes+size>this.options.maxFileBytes){this.stats.dropped++;return;}
      this.queue.push(line);this.queuedBytes+=size;this.acceptedBytes+=size;
    }catch{this.stats.errors++;this.stats.dropped++;}
  }
  lostCandidates(count:number){if(this.enabled){this.stats.candidateDrops+=count;}}
  async flush():Promise<void>{
    if(!this.enabled)return;
    if(this.flushing)return this.flushing;
    // No rejected promise may reach a product caller or an unhandled-rejection hook.
    this.flushing=this.flushBatch().catch(()=>{this.stats.errors++;}).finally(()=>{this.flushing=undefined;});
    return this.flushing;
  }
  private async flushBatch(){
    const batch=this.queue;this.queue=[];this.queuedBytes=0;
    try{
      await mkdir(this.options.directory,{recursive:true,mode:0o700});
      if(batch.length){
        this.handle??=await open(join(this.options.directory,`${this.processIdentity}.jsonl`),'ax',0o600);
        const body=batch.join('');await this.handle.writeFile(body);this.bytes+=Buffer.byteLength(body);this.stats.written+=batch.length;
      }
    }catch{this.stats.errors++;this.stats.dropped+=batch.length;}
    // Health is a separate file, so a failed events sink can still reveal loss.
    try{
      const path=join(this.options.directory,`${this.processIdentity}.health.json`);
      const health={version:1,experimentId:this.options.experimentId,service:this.options.service,
        processIdentity:this.processIdentity,pid:process.pid,wallTime:new Date().toISOString(),sequence:this.sequence,
        ...this.stats,bytes:this.bytes,queued:this.queue.length,cleanClose:this.clean,
        coverage:this.stats.dropped||this.stats.errors||this.stats.candidateDrops?'INVALID':this.clean?'CANDIDATE_VALID':'OPEN',
        limits:{maxRecords:this.options.maxRecords,maxBufferBytes:this.options.maxBufferBytes,maxFileBytes:this.options.maxFileBytes}};
      await writeFile(path+'.tmp',JSON.stringify(health)+'\n',{mode:0o600});await rename(path+'.tmp',path);
    }catch{this.stats.errors++;}
  }
  async close(){
    if(!this.enabled||this.stats.closed)return;
    if(this.timer)clearInterval(this.timer);
    await this.flush();this.stats.closed=true;await this.flush();
    try{await this.handle?.close();}catch{this.stats.errors++;}
    this.clean=true;await this.flush();
  }
}
export const recorder = new Recorder({enabled:process.env.B0_OBSERVE==='1',
  directory:process.env.B0_OBSERVATION_DIR||'/unconfigured-b0-observations',
  experimentId:/^[a-zA-Z0-9_-]{1,100}$/.test(process.env.B0_EXPERIMENT_ID||'')?process.env.B0_EXPERIMENT_ID!:'unconfigured',
  service:['api','worker','source','runner'].includes(process.env.B0_SERVICE||'')?process.env.B0_SERVICE!:'runner',
  maxRecords:clamp(process.env.B0_BUFFER_RECORDS,8192,32768),
  maxBufferBytes:clamp(process.env.B0_BUFFER_BYTES,8*1024*1024,32*1024*1024),
  maxFileBytes:clamp(process.env.B0_FILE_BYTES,2*1024**3,2*1024**3)});
// Exposed close is awaited by the existing service shutdown paths; natural CLI exit also flushes.
if(recorder.enabled)process.once('beforeExit',()=>{void recorder.close();});
export function observe(kind:Kind,label:Label,fields:Fields={}){try{recorder.emit({kind,label,...fields});}catch{/* observation cannot fail a business operation */}}
export function candidate(kind:Kind,label:Label,fields:Fields={}){
  if(!recorder.enabled)return;
  try{const context=pending.getStore();if(!context)return;
    if(context.events.length>=2048){context.overflow=true;return;}
    context.events.push({kind,label,...fields});
  }catch{recorder.lostCandidates(1);}
}
export async function measure<T>(label:Label,work:()=>Promise<T>,fields:Fields={}):Promise<T>{
  if(!recorder.enabled)return work();
  const t=performance.now(),counter={count:0},started={startedWallTime:new Date().toISOString(),startedMonotonicNs:process.hrtime.bigint().toString()};try{const result=await counters.run([...(counters.getStore()||[]),counter],work);observe('span',label,{...fields,...started,durationMs:performance.now()-t,sqlCount:counter.count,outcome:'ok'});return result;}
  catch(error){observe('span',label,{...fields,...started,durationMs:performance.now()-t,sqlCount:counter.count,outcome:'error'});throw error;}
}
export function measureSync<T>(label:Label,work:()=>T):T{
  if(!recorder.enabled)return work();
  const t=performance.now(),started={startedWallTime:new Date().toISOString(),startedMonotonicNs:process.hrtime.bigint().toString()};try{const value=work();observe('span',label,{...started,durationMs:performance.now()-t,outcome:'ok'});return value;}
  catch(error){observe('span',label,{...started,durationMs:performance.now()-t,outcome:'error'});throw error;}
}
export async function committed<T>(label:Label,work:(callbackResolved:()=>void)=>Promise<T>):Promise<T>{
  if(!recorder.enabled)return work(()=>{});
  const context:Pending={events:[],sqlCount:0,overflow:false};const t=performance.now(),started={startedWallTime:new Date().toISOString(),startedMonotonicNs:process.hrtime.bigint().toString()};let resolved=false;
  try{
    const result=await pending.run(context,()=>work(()=>{resolved=true;}));
    // Everything below must remain nonthrowing, outside transaction work and business catches.
    observe('transaction',label,{...started,outcome:'ok',durationMs:performance.now()-t,sqlCount:context.sqlCount});
    for(const event of context.events)try{recorder.emit(event);}catch{recorder.lostCandidates(1);}
    if(context.overflow)recorder.lostCandidates(1);
    return result;
  }catch(error){
    observe('transaction',label,{...started,outcome:resolved?'commit_outcome_unknown':'callback_failed',durationMs:performance.now()-t,sqlCount:context.sqlCount});
    throw error;
  }
}
export function sqlLabel(sql:string):Label{
  if(/source_checkpoints/i.test(sql))return 'sql.checkpoint';
  if(/SELECT status,COUNT\(\*\).*orders/i.test(sql))return 'sql.status';
  if(/\bproducts\b/i.test(sql))return 'sql.products';
  if(/\bsellers\b/i.test(sql))return 'sql.sellers';
  if(/SELECT.*raw_orders/i.test(sql))return 'sql.raw.identity';
  if(/INSERT INTO raw_orders/i.test(sql))return 'sql.raw.insert';
  if(/INSERT INTO orders/i.test(sql))return 'sql.order.insert';
  if(/INSERT INTO order_items/i.test(sql))return 'sql.items.insert';
  if(/INSERT INTO outbox_jobs/i.test(sql))return 'sql.outbox.insert';
  if(/SELECT id FROM outbox_jobs WHERE/i.test(sql))return 'sql.dispatch.scan';
  if(/SELECT.*outbox_jobs.*FOR UPDATE/i.test(sql))return 'sql.job.lock';
  if(/UPDATE outbox_jobs/i.test(sql))return 'sql.job.update';
  if(/INSERT INTO job_attempts/i.test(sql))return 'sql.attempt.insert';
  if(/INSERT INTO tasks\(/i.test(sql))return 'sql.task.insert';
  if(/task_items/i.test(sql))return 'sql.task.items';
  if(/SELECT.*tasks/i.test(sql))return 'sql.task.read';
  if(/SELECT.*orders/i.test(sql))return 'sql.order.read';
  if(/UPDATE orders/i.test(sql))return 'sql.order.update';
  return 'sql.other';
}
export async function observedSql<T>(sql:string,work:()=>Promise<T>):Promise<T>{
  if(!recorder.enabled)return work();
  const context=pending.getStore();if(context)context.sqlCount++;
  for(const counter of counters.getStore()||[])counter.count++;
  const t=performance.now(),started={startedWallTime:new Date().toISOString(),startedMonotonicNs:process.hrtime.bigint().toString()};const label=sqlLabel(sql);
  try{const result=await work();observe('sql',label,{...started,durationMs:performance.now()-t,count:1,outcome:'ok'});return result;}
  catch(error){observe('sql',label,{...started,durationMs:performance.now()-t,count:1,outcome:'error'});throw error;}
}
