import { type Db,transaction } from '../server/db.js';
import { type Event,validate,hash,parseJson,businessDate,Problem } from '../shared/contracts.js';
import { enqueue } from '../ingestion/ingest.js';
export async function applyEvent(db:Db,authenticatedDevice:string,event:Event,afterCommit?:()=>void) {
  validate('DeviceEvent',event);
  if(event.deviceId!==authenticatedDevice)throw new Problem('DEVICE_ID_MISMATCH',403);
  const result=await transaction(db,async tx=>{
    // Also serialize same eventId sent against two different task locks.
    const [device]=await tx.execute('SELECT enabled FROM devices WHERE id=? FOR UPDATE',[authenticatedDevice]);
    if(!device?.enabled)throw new Problem('FORBIDDEN',403);
    const [task]=await tx.execute('SELECT * FROM tasks WHERE id=? FOR UPDATE',[event.taskId]);
    const base={eventId:event.eventId,taskId:event.taskId};
    const blocked=(code:string)=>({...base,result:'BLOCKED',code,retryable:false});
    const digest=hash(event);
    const [existing]=await tx.execute('SELECT * FROM device_events WHERE device_id=? AND event_id=?',[authenticatedDevice,event.eventId]);
    if(existing) {
      if(existing.canonical_hash!==digest)return blocked('EVENT_ID_REUSED');
      const original=parseJson(existing.result);return {...original,result:'DUPLICATE',originalResult:original.result};
    }
    if(!task)return blocked('TASK_NOT_FOUND');
    const [used]=await tx.execute('SELECT event_id FROM device_events WHERE task_id=? AND assignment_version=? AND seq=?',[event.taskId,event.assignmentVersion,event.seq]);
    if(used)return blocked('SEQ_ALREADY_USED');
    if(task.device_id!==authenticatedDevice)return blocked('WRONG_DEVICE');
    if(task.assignment_version!==event.assignmentVersion)return blocked('ASSIGNMENT_VERSION_MISMATCH');
    if(task.status==='HOLD')return blocked('TASK_ON_HOLD');
    if(task.status==='CONFIRMED')return blocked('TASK_ALREADY_CONFIRMED');
    if(!['ASSIGNED','IN_PROGRESS'].includes(task.status))return blocked('TASK_NOT_ASSIGNED');
    if(event.seq>task.last_processed_seq+1)return {...base,result:'DEFERRED',code:'SEQUENCE_GAP',retryable:true,expectedSeq:task.last_processed_seq+1};
    if(event.seq<=task.last_processed_seq)return blocked('SEQ_ALREADY_USED');
    const items=await tx.execute('SELECT * FROM task_items WHERE task_id=? ORDER BY product_id',[event.taskId]);
    let rejected:string|null=null;
    if(event.type==='SCAN_ITEM') {
      const item=items.find((i:any)=>i.product_id===event.payload.productId);
      if(!item)rejected='PRODUCT_NOT_IN_TASK';else if(item.applied_qty>=item.required_qty)rejected='OVER_QUANTITY';
      else {
        await tx.execute('INSERT INTO task_scans(event_id,task_id,product_id) VALUES(?,?,?)',[event.eventId,event.taskId,item.product_id]);
        await tx.execute('UPDATE task_items SET applied_qty=applied_qty+1 WHERE task_id=? AND product_id=?',[event.taskId,item.product_id]);
        item.applied_qty++;task.status='IN_PROGRESS';
      }
    }else if(event.type==='REVERSE_SCAN') {
      const [scan]=await tx.execute('SELECT * FROM task_scans WHERE event_id=? AND task_id=? FOR UPDATE',[event.payload.targetEventId,event.taskId]);
      if(!scan||scan.reversed_by_event_id)rejected='INVALID_REVERSAL';
      else {
        await tx.execute('UPDATE task_scans SET reversed_by_event_id=? WHERE event_id=?',[event.eventId,scan.event_id]);
        await tx.execute('UPDATE task_items SET applied_qty=applied_qty-1 WHERE task_id=? AND product_id=?',[event.taskId,scan.product_id]);
        items.find((i:any)=>i.product_id===scan.product_id).applied_qty--;task.status='IN_PROGRESS';
      }
    }else if(items.some((i:any)=>i.applied_qty!==i.required_qty))rejected='INCOMPLETE_QUANTITY';
    const [time]=await tx.execute('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP(3))*1000 AS millis');
    const committedAt=new Date(Number(time.millis)).toISOString();
    if(rejected){task.status='HOLD';task.hold_reason=rejected;}
    else if(event.type==='COMPLETE') {
      task.status='CONFIRMED';task.confirmed_at=committedAt;task.business_date=businessDate(committedAt);
      await enqueue(tx,task.run_id,'REBUILD_REPORT_DAY',event.taskId,`${task.run_id}:${task.business_date}:${event.eventId}`,{businessDate:task.business_date});
    }
    await tx.execute('UPDATE tasks SET status=?,last_processed_seq=?,confirmed_at=?,business_date=?,local_completed_at=?,hold_reason=? WHERE id=?',
      [task.status,event.seq,task.confirmed_at,task.business_date,event.type==='COMPLETE'?event.occurredAt:task.local_completed_at,task.hold_reason,event.taskId]);
    const response={...base,result:rejected?'REJECTED':'APPLIED',code:rejected||'OK',retryable:false,
      receipt:{committedAt,processedSeq:event.seq,taskStatus:task.status,confirmedAt:task.confirmed_at,appliedItems:items.map((i:any)=>({productId:i.product_id,quantity:i.applied_qty}))}};
    await tx.execute('INSERT INTO device_events VALUES(?,?,?,?,?,?,?,?,?)',[authenticatedDevice,event.eventId,event.taskId,event.assignmentVersion,event.seq,digest,JSON.stringify(event),response.result,JSON.stringify(response)]);
    return response;
  });
  // The caller cannot observe APPLIED until MikroORM's commit promise resolves.
  afterCommit?.();return result;
}
export async function applyBatch(db:Db,device:string,batch:any,afterEach?:(index:number)=>void) {
  validate('EventBatch',batch);
  if(batch.events.some((e:Event)=>e.deviceId!==device))throw new Problem('DEVICE_ID_MISMATCH',403);
  const results=[];
  for(const [i,event] of batch.events.entries()) {
    try {results.push(await applyEvent(db,device,event));}
    catch(error:any){if(error instanceof Problem)throw error;results.push({eventId:event.eventId,taskId:event.taskId,result:'DEFERRED',code:'DATABASE_UNAVAILABLE',retryable:true});}
    afterEach?.(i);
  }
  return {batchId:batch.batchId,serverTime:new Date().toISOString(),results};
}
