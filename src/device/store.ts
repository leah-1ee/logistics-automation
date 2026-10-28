import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Event,hash,now,snapshotHash,validate,Problem } from '../shared/contracts.js';

export class LocalStore {
  db:DatabaseSync;
  constructor(path:string,public deviceId:string) {
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS task_snapshots(task_id TEXT PRIMARY KEY,hash TEXT NOT NULL,snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_task_state(task_id TEXT PRIMARY KEY,state TEXT NOT NULL,FOREIGN KEY(task_id) REFERENCES task_snapshots(task_id));
      CREATE TABLE IF NOT EXISTS local_events(event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,receipt TEXT,created_at TEXT NOT NULL,UNIQUE(task_id,seq),FOREIGN KEY(task_id) REFERENCES task_snapshots(task_id));
      CREATE TABLE IF NOT EXISTS local_audit(id TEXT PRIMARY KEY,task_id TEXT,code TEXT NOT NULL,input TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      PRAGMA user_version=1;`);
    this.atomic(()=>{for(const r of this.db.prepare('SELECT task_id FROM task_snapshots').all() as any[])this.rebuild(r.task_id);});
  }
  atomic<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  get(id:string):any {const r=this.db.prepare('SELECT state FROM local_task_state WHERE task_id=?').get(id) as any;if(!r)throw new Problem('TASK_NOT_DOWNLOADED',404);return JSON.parse(r.state);}
  list(limit=50,after='') {const rows=this.db.prepare('SELECT task_id,state FROM local_task_state WHERE task_id>? ORDER BY task_id LIMIT ?').all(after,limit+1) as any[];return {items:rows.slice(0,limit).map(r=>JSON.parse(r.state)),nextCursor:rows.length>limit?rows[limit-1].task_id:null};}
  events(id:string):any[] {return (this.db.prepare('SELECT * FROM local_events WHERE task_id=? ORDER BY seq').all(id) as any[]).map(r=>({...r,event:JSON.parse(r.body),receipt:r.receipt?JSON.parse(r.receipt):null}));}
  audit(id:string,code:string,input:any) {this.db.prepare('INSERT INTO local_audit VALUES(?,?,?,?,?)').run(randomUUID(),id,code,JSON.stringify(input),now());}
  block(id:string,code:string) {this.db.prepare('INSERT INTO sync_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('blocked:'+id,code);this.rebuild(id);}
  download(snapshot:any) {
    validate('TaskSnapshot',snapshot);
    if(snapshot.deviceId!==this.deviceId)throw new Problem('WRONG_DEVICE');
    if(snapshotHash(snapshot)!==snapshot.snapshotHash)throw new Problem('SNAPSHOT_HASH_INVALID');
    return this.atomic(()=>{
      const old=this.db.prepare('SELECT * FROM task_snapshots WHERE task_id=?').get(snapshot.taskId) as any;
      if(old) {
        if(old.hash!==snapshot.snapshotHash) {this.audit(snapshot.taskId,'SNAPSHOT_CONFLICT',snapshot);this.block(snapshot.taskId,'SNAPSHOT_CONFLICT');return false;}
        return true;
      }
      this.db.prepare('INSERT INTO task_snapshots VALUES(?,?,?)').run(snapshot.taskId,snapshot.snapshotHash,JSON.stringify(snapshot));
      this.rebuild(snapshot.taskId);return true;
    });
  }
  rebuild(id:string) {
    const row=this.db.prepare('SELECT snapshot FROM task_snapshots WHERE task_id=?').get(id) as any;
    if(!row)throw new Problem('TASK_NOT_DOWNLOADED',404);
    const snapshot=JSON.parse(row.snapshot),events=this.events(id);
    const state:any={snapshot,localStatus:'DOWNLOADED',syncStatus:'SYNCED',nextSeq:1,items:snapshot.requiredItems.map((i:any)=>({...i,appliedQty:0}))};
    const counts=new Map<string,any>(state.items.map((i:any)=>[i.productId,i]));const scans=new Map<string,any>();
    for(const {event,receipt} of events) {
      if(event.seq!==state.nextSeq||hash(event)!==events[event.seq-1].hash)throw new Error('Corrupt local event sequence/hash');
      if(event.type==='SCAN_ITEM') {counts.get(event.payload.productId).appliedQty++;scans.set(event.eventId,{productId:event.payload.productId,reversed:false});state.localStatus='IN_PROGRESS';}
      else if(event.type==='REVERSE_SCAN') {const scan=scans.get(event.payload.targetEventId);if(!scan||scan.reversed)throw new Error('Corrupt reversal');scan.reversed=true;counts.get(scan.productId).appliedQty--;state.localStatus='IN_PROGRESS';}
      else {state.localStatus='LOCAL_COMPLETED';if(receipt&&(receipt.result==='APPLIED'||receipt.result==='DUPLICATE'&&receipt.originalResult==='APPLIED')&&receipt.receipt?.taskStatus==='CONFIRMED')state.localStatus='SERVER_CONFIRMED';}
      state.nextSeq++;
    }
    if(events.some(e=>e.status!=='ACKED'))state.syncStatus='PENDING';
    if(this.db.prepare('SELECT 1 FROM sync_meta WHERE key=?').get('retry:'+id))state.syncStatus='RETRYING';
    if(this.db.prepare('SELECT 1 FROM sync_meta WHERE key=?').get('blocked:'+id))state.syncStatus='BLOCKED';
    for(const i of state.items)if(i.appliedQty<0||i.appliedQty>i.requiredQty)throw new Error('Corrupt local quantity');
    this.db.prepare('INSERT INTO local_task_state VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET state=excluded.state').run(id,JSON.stringify(state));
    return state;
  }
  action(id:string,type:Event['type'],payload:any,fault?:(stage:string)=>void) {
    try {return this.atomic(()=>{
      const state=this.get(id);
      if(['LOCAL_COMPLETED','SERVER_CONFIRMED'].includes(state.localStatus))throw new Problem('LOCAL_TASK_LOCKED');
      if(state.syncStatus==='BLOCKED')throw new Problem('TASK_SYNC_BLOCKED');
      if(type==='SCAN_ITEM') {
        const item=state.items.find((i:any)=>i.productId===payload.productId);
        if(!item)throw new Problem('PRODUCT_NOT_IN_TASK');if(item.appliedQty>=item.requiredQty)throw new Problem('OVER_QUANTITY');
      } else if(type==='REVERSE_SCAN') {
        const events=this.events(id);const target=events.find(e=>e.event.eventId===payload.targetEventId);
        if(!target||target.event.type!=='SCAN_ITEM'||events.some(e=>e.event.type==='REVERSE_SCAN'&&e.event.payload.targetEventId===payload.targetEventId))throw new Problem('INVALID_REVERSAL');
      } else if(state.items.some((i:any)=>i.appliedQty!==i.requiredQty))throw new Problem('INCOMPLETE_QUANTITY');
      const event:Event={eventId:randomUUID(),taskId:id,deviceId:this.deviceId,assignmentVersion:state.snapshot.assignmentVersion,seq:state.nextSeq,occurredAt:now(),type,payload} as Event;
      validate('DeviceEvent',event);fault?.('before_event');
      this.db.prepare('INSERT INTO local_events VALUES(?,?,?,?,?,?,?,?)').run(event.eventId,id,event.seq,JSON.stringify(event),hash(event),'PENDING',null,now());
      fault?.('after_event');const task=this.rebuild(id);fault?.('before_commit');return {event,task};
    });}catch(e:any){if(e instanceof Problem)this.audit(id,e.code,{type,payload});throw e;}
  }
  scan(id:string,text:string,fault?:(stage:string)=>void) {
    const match=/^LOPS1:PRODUCT:([a-f0-9]{32})$/.exec(text);
    if(!match){this.audit(id,'INVALID_QR',{text});throw new Problem('INVALID_QR',400);}
    return this.action(id,'SCAN_ITEM',{productId:match[1],quantity:1},fault);
  }
  accept(result:any) {
    validate('EventResult',result);
    this.atomic(()=>{
      const row=this.db.prepare('SELECT * FROM local_events WHERE event_id=?').get(result.eventId) as any;
      if(!row||row.task_id!==result.taskId)throw new Problem('UNKNOWN_RECEIPT');
      if(row.status==='ACKED')return; // Preserve successful receipt against late contradictory responses.
      const original=result.result==='DUPLICATE'?result.originalResult:result.result;
      if(['APPLIED','REJECTED'].includes(original)) {
        if(result.receipt.processedSeq!==row.seq)throw new Problem('RECEIPT_SEQUENCE_MISMATCH');
        const event=JSON.parse(row.body);
        if(original==='APPLIED'&&event.type==='COMPLETE'&&result.receipt.taskStatus!=='CONFIRMED')throw new Problem('INVALID_COMPLETE_RECEIPT');
        this.db.prepare('UPDATE local_events SET status=?,receipt=? WHERE event_id=?').run(original==='APPLIED'?'ACKED':'BLOCKED',JSON.stringify(result),result.eventId);
        if(original==='REJECTED')this.block(row.task_id,result.code);
        else this.db.prepare('DELETE FROM sync_meta WHERE key=?').run('retry:'+row.task_id);
        this.db.prepare('INSERT INTO sync_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('lastSuccessAt',now());
      } else if(result.result==='BLOCKED')this.block(row.task_id,result.code);
      this.rebuild(row.task_id); // Replay all local events; never overwrite with older receipt.appliedItems.
    });
  }
  pending():any[] {return (this.db.prepare("SELECT e.body FROM local_events e WHERE e.status='PENDING' AND NOT EXISTS(SELECT 1 FROM sync_meta m WHERE m.key='blocked:'||e.task_id) ORDER BY e.task_id,e.seq").all() as any[]).map(r=>JSON.parse(r.body));}
  syncStatus() {
    const [r]=this.db.prepare("SELECT COUNT(*) n,MIN(created_at) oldest FROM local_events WHERE status!='ACKED'").all() as any[];
    const b=this.db.prepare("SELECT COUNT(*) n FROM sync_meta WHERE key LIKE 'blocked:%'").get() as any;
    const last=this.db.prepare("SELECT value FROM sync_meta WHERE key='lastSuccessAt'").get() as any;
    return {pendingCount:Number(r.n),blockedTaskCount:Number(b.n),lastSuccessAt:last?.value||null,oldestPendingAt:r.oldest||null};
  }
  retryMeta(id:string):any {const r=this.db.prepare('SELECT value FROM sync_meta WHERE key=?').get('retry:'+id) as any;return r?JSON.parse(r.value):null;}
  setRetry(id:string,attempt:number,code:string,delay:number) {this.atomic(()=>{this.db.prepare('INSERT INTO sync_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('retry:'+id,JSON.stringify({attempt,code,nextAt:Date.now()+delay}));this.rebuild(id);});}
  retryNow() {this.atomic(()=>{this.db.prepare("DELETE FROM sync_meta WHERE key LIKE 'retry:%' OR (key LIKE 'blocked:%' AND value='AUTHENTICATION_REQUIRED')").run();for(const r of this.db.prepare('SELECT task_id FROM task_snapshots').all() as any[])this.rebuild(r.task_id);});}
  close(){this.db.close();}
}
