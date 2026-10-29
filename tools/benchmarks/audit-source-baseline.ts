/** Independent read-only F2 oracle: reads CSV directly; imports no application/domain code. */
import { createReadStream,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse } from 'csv-parse';
import mysql from 'mysql2/promise';

const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const json=(v:any)=>typeof v==='string'?JSON.parse(v):v;
const same=(a:any,b:any)=>canonical(a)===canonical(b);
const root=process.env.RAW_DIR!,runId=process.env.DATASET_RUN_ID!;
const manifest=JSON.parse(readFileSync(process.env.SOURCE_MANIFEST||process.env.DATASET_MANIFEST||'manifests/olist-v2.json','utf8'));
const errors:Record<string,number>={},fail=(code:string)=>{errors[code]=(errors[code]||0)+1;};
const read=async(name:string)=>{const rows:any[]=[];for await(const row of createReadStream(join(root,name)).pipe(parse({columns:true,bom:true})))rows.push(row);return rows;};
let fileChecks=0;
for(const f of manifest.files){
  const h=createHash('sha256');let bytes=0;for await(const block of createReadStream(join(root,f.fileName))){h.update(block);bytes+=block.length;}
  if(h.digest('hex')!==f.fileSha256||bytes!==f.fileBytes)throw new Error('Raw CSV fingerprint mismatch; audit stopped');fileChecks++;
}
const orders=new Map((await read('olist_orders_dataset.csv')).map(r=>[r.order_id,r]));
const products=new Map((await read('olist_products_dataset.csv')).map(r=>[r.product_id,r]));
const sellers=new Set((await read('olist_sellers_dataset.csv')).map(r=>r.seller_id));
const lines=await read('olist_order_items_dataset.csv'),itemsByOrder=new Map<string,any[]>();
for(const row of lines){const group=itemsByOrder.get(row.order_id)||[];group.push(row);itemsByOrder.set(row.order_id,group);if(!orders.has(row.order_id))fail('ORPHAN_SOURCE_ITEM');}
const key=(v:any)=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const timestamp=(v:string)=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)&&Number.isFinite(Date.parse(v.replace(' ','T')+'Z'))&&new Date(v.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ')===v;
function expected(order:any){
  const lines=(itemsByOrder.get(order.order_id)||[]).slice().sort((a,b)=>Number(a.order_item_id)-Number(b.order_item_id));
  const hold=new Set<string>(),unsupported=new Set<string>(),flags=new Set<string>(),ids=new Set<number>(),vendors=new Set<string>(),quantities=new Map<string,number>();
  if(!key(order.order_id))hold.add('INVALID_ORDER_KEY');if(!order.order_status)hold.add('MISSING_SOURCE_STATUS');
  if(!timestamp(order.order_approved_at))hold.add('MISSING_OR_INVALID_APPROVAL');if(!lines.length)hold.add('NO_ITEMS');
  for(const row of lines){
    const id=Number(row.order_item_id);if(!Number.isInteger(id)||id<1||ids.has(id))hold.add('INVALID_ITEM_KEY');ids.add(id);
    if(!key(row.product_id)||!products.has(row.product_id))hold.add('MISSING_PRODUCT');else quantities.set(row.product_id,(quantities.get(row.product_id)||0)+1);
    if(!sellers.has(row.seller_id))hold.add('MISSING_SELLER');else vendors.add(row.seller_id);
    const p=products.get(row.product_id);if(!p?.product_category_name)flags.add('MISSING_CATEGORY');
    if(p)for(const name of ['product_weight_g','product_length_cm','product_height_cm','product_width_cm']){
      if(!p[name])flags.add(name.toUpperCase()+'_MISSING');else if(!Number.isFinite(Number(p[name]))||Number(p[name])<=0)flags.add(name.toUpperCase()+'_INVALID');
    }
  }
  if(!['approved','processing','shipped','delivered'].includes(order.order_status))unsupported.add('UNSUPPORTED_SOURCE_STATUS');
  if(vendors.size>1)unsupported.add('MULTIPLE_SELLERS');
  return {status:hold.size?'DATA_HOLD':unsupported.size?'UNSUPPORTED':'TASK_CREATED',reasons:[...hold,...unsupported].sort(),flags:[...flags].sort(),quantities,seller:vendors.size===1?[...vendors][0]:null,
    items:lines.map(r=>({sourceItemId:Number(r.order_item_id),productId:r.product_id||null,sellerId:r.seller_id||null,shipByRaw:r.shipping_limit_date||null,category:products.get(r.product_id)?.product_category_name||null}))};
}
const db=await mysql.createConnection({host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3307),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,dateStrings:true});
const query=async(sql:string,params:any[]=[])=>{const [rows]=await db.query(sql,params);return rows as any[];};
const group=(rows:any[],key:string)=>{const result=new Map<string,any[]>();for(const row of rows){const a=result.get(row[key])||[];a.push(row);result.set(row[key],a);}return result;};
let orderChecks=0,taskChecks=0,quantityChecks=0,eventChecks=0,confirmed=0;
const classifications:Record<string,number>={},seen=new Set<string>();
try{
  await query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [run]=await query('SELECT manifest FROM dataset_runs WHERE id=?',[runId]);
  if(!run||!same(json(run.manifest),manifest))fail('REGISTERED_MANIFEST_MISMATCH');
  const savedProducts=await query('SELECT product_id,category,attributes FROM products WHERE run_id=?',[runId]);
  if(savedProducts.length!==products.size)fail('PRODUCT_COUNT');
  for(const p of savedProducts)if(!same(json(p.attributes),products.get(p.product_id))||p.category!==(products.get(p.product_id)?.product_category_name||null))fail('PRODUCT_ATTRIBUTES');
  const savedSellers=await query('SELECT seller_id FROM sellers WHERE run_id=?',[runId]);
  if(savedSellers.length!==sellers.size||savedSellers.some(s=>!sellers.has(s.seller_id)))fail('SELLER_SET');
  let after='';
  for(;;){
    const rows=await query('SELECT r.*,o.id order_id,o.revision,o.status order_status,o.source_order_id normalized_source_id,o.source_status normalized_source_status,o.seller_id normalized_seller,o.hold_reasons,o.quality_flags,o.run_id order_run,t.id task_id,t.run_id task_run,t.status task_status,t.last_processed_seq,t.snapshot,t.device_id,t.assignment_version,t.confirmed_at,t.business_date FROM raw_orders r LEFT JOIN orders o ON o.raw_order_id=r.id LEFT JOIN tasks t ON t.order_id=o.id WHERE r.run_id=? AND r.id>? ORDER BY r.id LIMIT 200',[runId,after]);
    if(!rows.length)break;after=rows.at(-1).id;
    const orderIds=rows.map(r=>r.order_id).filter(Boolean),taskIds=rows.map(r=>r.task_id).filter(Boolean);
    const normalized=orderIds.length?group(await query('SELECT * FROM order_items WHERE order_id IN('+orderIds.map(()=>'?')+')',orderIds),'order_id'):new Map();
    const tasks=taskIds.length?group(await query('SELECT i.*,COUNT(s.event_id) net FROM task_items i LEFT JOIN task_scans s ON s.task_id=i.task_id AND s.product_id=i.product_id AND s.reversed_by_event_id IS NULL WHERE i.task_id IN('+taskIds.map(()=>'?')+') GROUP BY i.task_id,i.product_id,i.required_qty,i.applied_qty',taskIds),'task_id'):new Map();
    const events=taskIds.length?group(await query('SELECT * FROM device_events WHERE task_id IN('+taskIds.map(()=>'?')+') ORDER BY task_id,seq',taskIds),'task_id'):new Map();
    for(const row of rows){
      const source=orders.get(row.source_record_id);orderChecks++;
      if(!source||seen.has(row.source_record_id)){fail('SOURCE_KEY_SET');continue;}seen.add(row.source_record_id);
      const e=expected(source),body=json(row.payload);classifications[e.status]=(classifications[e.status]||0)+1;
      if(digest(canonical(body))!==row.payload_hash)fail('RAW_CANONICAL_HASH');
      if(row.source!=='olist'||row.external_order_id!==source.order_id||body.sourceOrderId!==source.order_id||body.sourceRecordId!==source.order_id||body.sourceStatus!==source.order_status||body.sourceApprovedAtRaw!==(source.order_approved_at||null)||body.sourcePurchasedAtRaw!==(source.order_purchase_timestamp||null)||!same(body.items,e.items))fail('RAW_CSV_CONTENT');
      if(row.revision!==1){fail('REVISION_REQUIRES_SEPARATE_REVIEW');continue;}
      if(row.order_run!==runId||row.order_status!==e.status||row.normalized_source_id!==source.order_id||row.normalized_source_status!==source.order_status||row.normalized_seller!==e.seller||!same(json(row.hold_reasons),e.reasons)||!same(json(row.quality_flags),e.flags))fail('NORMALIZATION');
      const quantities=(list:any[])=>Object.fromEntries(list.map(i=>[i.product_id,i.required_qty]));
      if(!same(quantities(normalized.get(row.order_id)||[]),Object.fromEntries(e.quantities)))fail('NORMALIZED_QUANTITIES');
      if(Boolean(row.task_id)!==(e.status==='TASK_CREATED'))fail('ELIGIBLE_TASK_BIJECTION');
      if(!row.task_id)continue;taskChecks++;
      if(row.task_run!==runId)fail('TASK_RUN');
      if(row.snapshot){
        const {snapshotHash,...snapshot}=json(row.snapshot);
        if(digest(canonical(snapshot))!==snapshotHash||snapshot.taskId!==row.task_id||snapshot.datasetRunId!==runId||snapshot.deviceId!==row.device_id||snapshot.assignmentVersion!==row.assignment_version||snapshot.externalOrderId!==source.order_id||!same(Object.fromEntries(snapshot.requiredItems.map((i:any)=>[i.productId,i.requiredQty])),Object.fromEntries(e.quantities)))fail('IMMUTABLE_SNAPSHOT');
      }else if(row.device_id||row.assignment_version!==0||row.task_status!=='CREATED')fail('MISSING_ASSIGNED_SNAPSHOT');
      const saved=tasks.get(row.task_id)||[];
      if(!same(quantities(saved),Object.fromEntries(e.quantities)))fail('TASK_CSV_QUANTITIES');
      for(const i of saved){quantityChecks++;if(i.applied_qty!==Number(i.net)||i.applied_qty<0||i.applied_qty>i.required_qty||row.task_status==='CONFIRMED'&&i.applied_qty!==i.required_qty)fail('TASK_EFFECT_QUANTITIES');}
      let seq=0;const projection=new Map<string,number>(),scans=new Map<string,{product:string,reversed:boolean}>();
      for(const savedEvent of events.get(row.task_id)||[]){
        eventChecks++;const event=json(savedEvent.event_body),receipt=json(savedEvent.result);
        if(savedEvent.seq!==++seq||event.seq!==seq||event.eventId!==savedEvent.event_id||event.taskId!==row.task_id||event.deviceId!==savedEvent.device_id||event.deviceId!==row.device_id||event.assignmentVersion!==row.assignment_version||digest(canonical(event))!==savedEvent.canonical_hash||receipt.receipt?.processedSeq!==seq||receipt.result!==savedEvent.outcome)fail('EVENT_IDENTITY_SEQUENCE_HASH_RECEIPT');
        if(savedEvent.outcome!=='APPLIED')continue;
        if(event.type==='SCAN_ITEM'){projection.set(event.payload.productId,(projection.get(event.payload.productId)||0)+1);scans.set(event.eventId,{product:event.payload.productId,reversed:false});}
        else if(event.type==='REVERSE_SCAN'){const scan=scans.get(event.payload.targetEventId);if(!scan||scan.reversed)fail('EVENT_REVERSAL');else{scan.reversed=true;projection.set(scan.product,(projection.get(scan.product)||0)-1);}}
        else if(receipt.receipt.taskStatus!=='CONFIRMED'||receipt.receipt.confirmedAt!==row.confirmed_at)fail('COMPLETE_RECEIPT');
      }
      if(seq!==row.last_processed_seq)fail('LAST_PROCESSED_SEQUENCE');
      for(const i of saved)if(i.applied_qty!==(projection.get(i.product_id)||0))fail('EVENT_EFFECT_REPLAY');
      if(row.task_status==='CONFIRMED'){confirmed++;const history=events.get(row.task_id)||[];if(history.filter((v:any)=>json(v.event_body).type==='COMPLETE'&&v.outcome==='APPLIED').length!==1)fail('CONFIRMED_COMPLETE_COUNT');
        if(!row.confirmed_at||new Intl.DateTimeFormat('en-CA',{timeZone:process.env.BUSINESS_TIMEZONE||'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.confirmed_at))!==row.business_date)fail('CONFIRMED_BUSINESS_DATE');
      }
    }
  }
  if(seen.size!==orders.size)fail('MISSING_SOURCE_ORDERS');
  const [counts]=await query("SELECT (SELECT COUNT(*) FROM orders WHERE run_id=?) orders,(SELECT COUNT(*) FROM tasks WHERE run_id=?) tasks,(SELECT COUNT(*) FROM outbox_jobs WHERE run_id=? AND status<>'DONE') unfinished",[runId,runId,runId]);
  if(Number(counts.orders)!==orders.size||Number(counts.tasks)!==taskChecks)fail('EXTRA_NORMALIZED_OR_TASK_ROWS');if(Number(counts.unfinished))fail('OUTBOX_NOT_DRAINED');
  const [checkpoint]=await query("SELECT status FROM source_checkpoints WHERE run_id=? AND source='olist'",[runId]);if(checkpoint?.status!=='DONE')fail('SOURCE_NOT_DONE');
  const actualDaily=await query("SELECT t.business_date,COUNT(DISTINCT t.id) tasks,SUM(i.applied_qty) items FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date",[runId]);
  const savedDaily=await query('SELECT business_date,task_count tasks,item_count items FROM report_daily WHERE run_id=?',[runId]);
  const daily=(rows:any[])=>rows.map(r=>({date:r.business_date,tasks:Number(r.tasks),items:Number(r.items)})).sort((a,b)=>a.date.localeCompare(b.date));
  if(!same(daily(actualDaily),daily(savedDaily)))fail('DAILY_REPORT');
  const actualProductReports=await query("SELECT t.business_date,i.product_id,SUM(i.applied_qty) qty FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date,i.product_id ORDER BY t.business_date,i.product_id",[runId]);
  const savedProductReports=await query('SELECT business_date,product_id,quantity qty FROM report_daily_product WHERE run_id=? ORDER BY business_date,product_id',[runId]);
  const productReport=(rows:any[])=>rows.map(r=>({...r,qty:Number(r.qty)}));if(!same(productReport(actualProductReports),productReport(savedProductReports)))fail('PRODUCT_REPORT');
  await query('ROLLBACK');
  const report={status:Object.keys(errors).length?'FAIL':'PASS',at:new Date().toISOString(),scope:'Independent direct CSV oracle and read-only MySQL snapshot; no Source/normalize/reconcile/LocalStore imports',input:manifest.synthetic?'SYNTHETIC':'ACTUAL_OLIST',datasetRunId:runId,codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),oracleSha256:digest(readFileSync(new URL(import.meta.url))),lockfileSha256:digest(readFileSync('package-lock.json')),fileChecks,sourceOrders:orders.size,sourceItems:lines.length,sourceProducts:products.size,sourceSellers:sellers.size,orderChecks,taskChecks,quantityChecks,eventChecks,confirmed,classifications,unfinishedJobs:Number(counts.unfinished),reports:daily(savedDaily),errors};
  const output=process.env.AUDIT_OUTPUT||'reports/independent-source-'+runId+'.json';mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status==='FAIL')process.exitCode=1;
}finally{await db.end();}
