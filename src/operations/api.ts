import { randomUUID } from 'node:crypto';
import { type Db,type Tx,transaction,connection } from '../server/db.js';
import { type Handler } from '../server/http.js';
import { hash,now,pageLimit,parseJson,Problem,validate } from '../shared/contracts.js';
import { taskView,assign } from '../fulfillment/tasks.js';
import { adminRequest,audit } from './requests.js';
import { enqueue,collect,ingestionStatus } from '../ingestion/ingest.js';
import { normalize } from '../ingestion/normalize.js';
import { applyBatch } from '../sync/events.js';

export async function orderView(tx:Tx,id:string) {
  const [o]=await tx.execute('SELECT o.*,t.id task_id FROM orders o LEFT JOIN tasks t ON t.order_id=o.id WHERE o.id=?',[id]);
  if(!o)throw new Problem('NOT_FOUND',404);
  return {id:o.id,datasetRunId:o.run_id,sourceOrderId:o.source_order_id,sourceStatus:o.source_status,status:o.status,revision:o.revision,holdReasons:parseJson(o.hold_reasons),taskId:o.task_id||null};
}
export async function orderDetail(tx:Tx,id:string) {
  const order=await orderView(tx,id);
  const [raw]=await tx.execute('SELECT r.payload FROM raw_orders r JOIN orders o ON o.raw_order_id=r.id WHERE o.id=?',[id]);
  const items=await tx.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY product_id',[id]);
  const audit=await tx.execute('SELECT actor_id actorId,action,reason,before_after,at FROM audit_logs WHERE target_id=? ORDER BY at,id',[id]);
  return {order,raw:parseJson(raw.payload),items:items.map((i:any)=>({productId:i.product_id,displayLabel:i.product_id.slice(0,8),requiredQty:i.required_qty})),audit:audit.map((a:any)=>({...a,before_after:parseJson(a.before_after)}))};
}
export async function correct(db:Db,actor:string,id:string,body:any) {
  return adminRequest(db,actor,'correct:'+id,body,async tx=>{
    const [o]=await tx.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[id]);if(!o)throw new Problem('NOT_FOUND',404);
    const [task]=await tx.execute('SELECT id FROM tasks WHERE order_id=?',[id]);
    if(o.status!=='DATA_HOLD'||task)throw new Problem('CORRECTION_NOT_ALLOWED');
    if(o.revision!==body.expectedRevision)throw new Problem('REVISION_CONFLICT');
    const before=await orderDetail(tx,id);
    const unique=new Set(body.items.map((i:any)=>i.productId));if(unique.size!==body.items.length)throw new Problem('DUPLICATE_PRODUCT',400);
    const products=new Set<string>((await tx.execute('SELECT product_id FROM products WHERE run_id=?',[o.run_id])).map((r:any)=>r.product_id));
    const sellers=new Set<string>((await tx.execute('SELECT seller_id FROM sellers WHERE run_id=?',[o.run_id])).map((r:any)=>r.seller_id));
    const source={...before.raw,items:body.items.map((i:any,index:number)=>({sourceItemId:index+1,productId:i.productId,sellerId:i.sellerId,shipByRaw:null,category:null}))};
    const n=normalize(source,products,sellers);const revision=o.revision+1;
    await tx.execute('UPDATE orders SET revision=?,status=?,seller_id=?,hold_reasons=?,quality_flags=? WHERE id=?',[revision,n.status,n.sellerId,JSON.stringify(n.holdReasons),JSON.stringify(n.qualityFlags),id]);
    await tx.execute('DELETE FROM order_items WHERE order_id=?',[id]);
    for(const item of body.items){if(!Number.isSafeInteger(item.requiredQty)||item.requiredQty>2147483647)throw new Problem('QUANTITY_OUT_OF_RANGE',400);await tx.execute('INSERT INTO order_items VALUES(?,?,?)',[id,item.productId,item.requiredQty]);}
    if(n.status==='READY')await enqueue(tx,o.run_id,'CREATE_TASK',id,`${id}:${revision}`,{orderId:id,revision});
    const after=await orderDetail(tx,id);await audit(tx,actor,'CORRECT_ORDER',id,body.reason,before,after);
    return orderDetail(tx,id);
  });
}
export function jobView(j:any) {return {id:j.id,type:j.type,status:j.status,attempts:j.attempts,errorCode:j.error_code,availableAt:j.available_at};}
export async function retryJob(db:Db,actor:string,id:string,body:any) {
  return adminRequest(db,actor,'retry:'+id,body,async tx=>{
    const [j]=await tx.execute('SELECT * FROM outbox_jobs WHERE id=? FOR UPDATE',[id]);if(!j)throw new Problem('NOT_FOUND',404);
    if(j.status!=='FAILED')throw new Problem('JOB_NOT_FAILED');
    if(j.error_code!=='TRANSIENT_ERROR')throw new Problem('PERMANENT_JOB_ERROR');
    await tx.execute("UPDATE outbox_jobs SET status='PENDING',attempts=0,error_code=NULL,available_at=?,lease_until=NULL WHERE id=?",[now(),id]);
    const [after]=await tx.execute('SELECT * FROM outbox_jobs WHERE id=?',[id]);await audit(tx,actor,'RETRY_JOB',id,body.reason,jobView(j),jobView(after));return jobView(after);
  });
}
export async function dailyReport(db:Db,runId:string,date:string) {
  const c=connection(db);const [row]=await c.execute('SELECT * FROM report_daily WHERE run_id=? AND business_date=?',[runId,date]);
  const [pending]=await c.execute("SELECT COUNT(*) n FROM outbox_jobs WHERE run_id=? AND type='REBUILD_REPORT_DAY' AND status<>'DONE' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.businessDate'))=?",[runId,date]);
  const products=await c.execute('SELECT product_id productId,quantity FROM report_daily_product WHERE run_id=? AND business_date=? ORDER BY product_id',[runId,date]);
  return {datasetRunId:runId,businessDate:date,taskCount:row?.task_count||0,itemCount:row?.item_count||0,computedAt:row?.computed_at||now(),rebuildPending:Number(pending.n)>0,products};
}
export function apiHandlers(db:Db) {
  const running=new Map<string,Promise<any>>();
  const abort=new AbortController();
  const launch=(run:string)=>{if(!running.has(run)){const work=collect(db,run,process.env.SOURCE_URL!,abort.signal).catch(async(e:any)=>{console.error('Ingestion paused',run,e.code||e.message);await connection(db).execute('UPDATE source_checkpoints SET status=? WHERE run_id=? AND status<>?', [abort.signal.aborted?'PAUSED':'FAILED',run,'DONE']);}).finally(()=>running.delete(run));running.set(run,work);}};
  const list=async(req:any,table:string,view:(tx:Tx,id:string)=>Promise<any>,filterKeys:string[],whereExtra='',extraParams:any[]=[])=>{
    const limit=pageLimit(req.query.limit),conditions=['run_id=?'],params:any[]=[req.query.datasetRunId];
    for(const key of filterKeys)if(key!=='query'&&req.query[key]){conditions.push((key==='deviceId'?'device_id':key)+'=?');params.push(req.query[key]);}
    const scope=hash({table,run:req.query.datasetRunId,filters:Object.fromEntries(filterKeys.map(k=>[k,req.query[k]||null])),whereExtra,extraParams});
    let after='';if(req.query.cursor){try{const c=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString());if(c.scope!==scope||typeof c.after!=='string')throw 0;after=c.after;}catch{throw new Problem('INVALID_CURSOR',400);}}
    if(req.query.query){conditions.push('source_order_id LIKE ?');params.push('%'+req.query.query+'%');}
    conditions.push('id>?');params.push(after);
    if(whereExtra){conditions.push(whereExtra);params.push(...extraParams);}
    const c=connection(db);const rows=await c.execute(`SELECT id FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT ?`,[...params,limit+1]);
    const items=[];for(const r of rows.slice(0,limit))items.push(await view(c,r.id));
    return {items,nextCursor:rows.length>limit?Buffer.from(JSON.stringify({scope,after:rows[limit-1].id})).toString('base64url'):null};
  };
  const handlers:Record<string,Handler>={
    ingestion_start:async req=>{
      const run=req.body.datasetRunId;
      const result=await adminRequest(db,req.actorId,'ingestion:'+run,req.body,async tx=>{
        const [cp]=await tx.execute('SELECT * FROM source_checkpoints WHERE run_id=? FOR UPDATE',[run]);if(!cp)throw new Problem('RUN_NOT_REGISTERED',404);
        if(cp.status!=='DONE')await tx.execute("UPDATE source_checkpoints SET status='RUNNING' WHERE run_id=?",[run]);
        await audit(tx,req.actorId,'START_INGESTION',run,'Operator requested registered dataset ingestion',{status:cp.status},{status:cp.status==='DONE'?'DONE':'RUNNING',requestId:req.body.requestId});
        return {...await ingestionStatus(db,run),status:cp.status==='DONE'?'DONE':'RUNNING'};
      });launch(run);return result;
    },
    ingestion_get:async(_req,p)=>ingestionStatus(db,p.runId),
    orders_list:async req=>list(req,'orders',orderView,['status','query']),
    orders_get:async(_req,p)=>orderDetail(connection(db),p.orderId),
    orders_correct:async(req,p)=>correct(db,req.actorId,p.orderId,req.body),
    tasks_list:async req=>list(req,'tasks',taskView,['status','deviceId']),
    tasks_get:async(_req,p)=>{
      const c=connection(db);const task=await taskView(c,p.taskId);
      const records=await c.execute('SELECT result,event_body FROM device_events WHERE task_id=? ORDER BY seq',[p.taskId]);
      const events=records.map((e:any)=>parseJson(e.result)),eventBodies=records.map((e:any)=>parseJson(e.event_body));
      const syncIncidents=await c.execute("SELECT actor_id deviceId,reason code,at observedAt,before_after evidence FROM audit_logs WHERE target_id=? AND action='SYNC_BLOCKED' ORDER BY at,id",[p.taskId]);
      const notes=(await c.execute("SELECT id,actor_id actorId,reason,at createdAt FROM audit_logs WHERE target_id=? AND action='TASK_NOTE' ORDER BY at,id",[p.taskId]));
      return {task,events,notes,eventBodies,syncIncidents:syncIncidents.map((i:any)=>({...i,evidence:parseJson(i.evidence)}))};
    },
    tasks_assign:async(req,p)=>assign(db,req.actorId,p.taskId,req.body),
    tasks_note:async(req,p)=>adminRequest(db,req.actorId,'note:'+p.taskId,req.body,async tx=>{
      await taskView(tx,p.taskId);const note={id:randomUUID(),actorId:req.actorId,reason:req.body.reason,createdAt:now()};
      await tx.execute('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)',[note.id,'ADMIN',req.actorId,'TASK_NOTE',p.taskId,note.reason,'{}',note.createdAt]);return note;
    }),
    jobs_list:async req=>list(req,'outbox_jobs',async(c,id)=>jobView((await c.execute('SELECT * FROM outbox_jobs WHERE id=?',[id]))[0]),['status']),
    jobs_retry:async(req,p)=>retryJob(db,req.actorId,p.jobId,req.body),
    devices_list:async req=>{
      const limit=pageLimit(req.query.limit),rows=await connection(db).execute('SELECT * FROM devices WHERE id>? ORDER BY id LIMIT ?',[req.query.cursor||'',limit+1]);
      return {items:rows.slice(0,limit).map((d:any)=>({id:d.id,enabled:!!d.enabled,lastSeenAt:d.last_seen_at,lastReport:d.last_report?parseJson(d.last_report):null,stale:!d.report_received_at||Date.now()-Date.parse(d.report_received_at)>Number(process.env.DEVICE_STALE_MS||120000)})),nextCursor:rows.length>limit?rows[limit-1].id:null};
    },
    reports_daily:async req=>dailyReport(db,req.query.datasetRunId,req.query.businessDate),
    reports_csv:async req=>{const r=await dailyReport(db,req.query.datasetRunId,req.query.businessDate);return 'datasetRunId,businessDate,taskCount,itemCount,productId,quantity,computedAt,rebuildPending\r\n'+(r.products.length?r.products:[{productId:'',quantity:0}]).map((p:any)=>[r.datasetRunId,r.businessDate,r.taskCount,r.itemCount,p.productId,p.quantity,r.computedAt,r.rebuildPending].join(',')).join('\r\n')+'\r\n';},
    device_tasks:async req=>list(req,'tasks',async(c,id)=>parseJson((await c.execute('SELECT snapshot FROM tasks WHERE id=?',[id]))[0].snapshot),[],'device_id=? AND snapshot IS NOT NULL',[req.deviceId]),
    device_events:async req=>applyBatch(db,req.deviceId,req.body),
    device_status:async req=>{await connection(db).execute('UPDATE devices SET last_seen_at=?,last_report=?,report_received_at=? WHERE id=?',[now(),JSON.stringify(req.body),now(),req.deviceId]);return {accepted:true,requestId:randomUUID()};}
  };
  return {handlers,async close(){abort.abort();await Promise.allSettled([...running.values()]);}};
}
