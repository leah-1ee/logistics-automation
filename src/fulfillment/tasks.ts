import { randomUUID } from 'node:crypto';
import { type Db,type Tx } from '../server/db.js';
import { now,parseJson,Problem,snapshotHash } from '../shared/contracts.js';
import { adminRequest,audit } from '../operations/requests.js';
export async function createTask(tx:Tx,job:any) {
  const p=parseJson(job.payload);
  const [order]=await tx.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[p.orderId]);
  if(!order)throw new Problem('ORDER_NOT_FOUND');
  if(order.revision!==p.revision)return 'SUPERSEDED';
  const [existing]=await tx.execute('SELECT id FROM tasks WHERE order_id=?',[order.id]);
  if(existing)return existing.id;
  if(order.status!=='READY')return 'SUPERSEDED';
  const items=await tx.execute('SELECT * FROM order_items WHERE order_id=?',[order.id]);
  if(!items.length)throw new Problem('ORDER_ITEMS_MISSING');
  const taskId=randomUUID();
  await tx.execute('INSERT INTO tasks(id,run_id,order_id,status) VALUES(?,?,?,?)',[taskId,order.run_id,order.id,'CREATED']);
  for(const item of items)await tx.execute('INSERT INTO task_items VALUES(?,?,?,0)',[taskId,item.product_id,item.required_qty]);
  await tx.execute('UPDATE orders SET status=? WHERE id=?',['TASK_CREATED',order.id]);
  return taskId;
}
export async function taskView(tx:Tx,id:string) {
  const [t]=await tx.execute('SELECT * FROM tasks WHERE id=?',[id]);if(!t)throw new Problem('NOT_FOUND',404);
  const rows=await tx.execute('SELECT * FROM task_items WHERE task_id=? ORDER BY product_id',[id]);
  return {id:t.id,datasetRunId:t.run_id,orderId:t.order_id,status:t.status,deviceId:t.device_id,assignmentVersion:t.assignment_version,lastProcessedSeq:t.last_processed_seq,
    items:rows.map((i:any)=>({productId:i.product_id,displayLabel:i.product_id.slice(0,8),requiredQty:i.required_qty,appliedQty:i.applied_qty})),confirmedAt:t.confirmed_at,holdReason:t.hold_reason};
}
export async function assign(db:Db,actor:string,taskId:string,body:any) {
  return adminRequest(db,actor,`assignment:${taskId}`,body,async tx=>{
    const [t]=await tx.execute('SELECT * FROM tasks WHERE id=? FOR UPDATE',[taskId]);if(!t)throw new Problem('NOT_FOUND',404);
    if(t.status!=='CREATED'||t.device_id)throw new Problem('ALREADY_ASSIGNED');
    const [device]=await tx.execute('SELECT * FROM devices WHERE id=?',[body.deviceId]);if(!device?.enabled)throw new Problem('DEVICE_UNAVAILABLE');
    const [o]=await tx.execute('SELECT source_order_id FROM orders WHERE id=?',[t.order_id]);
    const view=await taskView(tx,taskId);
    const snapshot:any={taskId,datasetRunId:t.run_id,externalOrderId:o.source_order_id,deviceId:body.deviceId,assignmentVersion:1,assignedAt:now(),requiredItems:view.items.map(({appliedQty,...item}:any)=>item)};
    snapshot.snapshotHash=snapshotHash(snapshot);
    await tx.execute('UPDATE tasks SET status=?,device_id=?,assignment_version=1,snapshot=? WHERE id=?',['ASSIGNED',body.deviceId,JSON.stringify(snapshot),taskId]);
    await audit(tx,actor,'ASSIGN',taskId,body.reason,{status:t.status},snapshot);
    return snapshot;
  });
}
