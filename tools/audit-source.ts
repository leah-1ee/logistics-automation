/** Independent read-only F2 oracle; disk-indexed CSV, bounded MySQL pages/streams. */
import { readFileSync,writeSync,openSync,closeSync,mkdirSync,createReadStream } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import mysql from 'mysql2';
import { SourceIndex } from './audit-source-index.js';
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const json=(v:any)=>typeof v==='string'?JSON.parse(v):v;
const same=(a:any,b:any)=>canonical(a)===canonical(b);
const root=process.env.RAW_DIR!,runId=process.env.DATASET_RUN_ID!;
const manifest=JSON.parse(readFileSync(process.env.SOURCE_MANIFEST||process.env.DATASET_MANIFEST||'manifests/olist-v2.json','utf8'));
const errors:Record<string,number>={},fail=(code:string,count=1)=>{errors[code]=(errors[code]||0)+count;};
const index=new SourceIndex(fail);
let orderChecks=0,taskChecks=0,quantityChecks=0,eventChecks=0,confirmed=0,maxPageEvents=0,maxRawRows=0,maxNormalizedRows=0,maxTaskItemRows=0;
let sqlStatements=0,unfinishedJobs=0;
const classifications:Record<string,number>={};
try{
  await index.build(root,manifest);
  if(index.fileChecks!==4)throw Object.assign(Error('Source not verified'),{auditCode:'SOURCE_NOT_VERIFIED'});
  const native=mysql.createConnection({host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3307),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,dateStrings:true});
  const db=native.promise();
  const query=async(sql:string,params:any[]=[])=>{sqlStatements++;const [rows]=await db.query(sql,params);return rows as any[];};
  const stream=(sql:string,params:any[]=[])=>{sqlStatements++;return native.query(sql,params).stream({highWaterMark:16});};
  const group=(rows:any[],key:string)=>{const result=new Map<string,any[]>();for(const row of rows){const a=result.get(row[key])||[];a.push(row);result.set(row[key],a);}return result;};
  try{
  await query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [run]=await query('SELECT manifest FROM dataset_runs WHERE id=?',[runId]);
  if(!run||!same(json(run.manifest),manifest))fail('REGISTERED_MANIFEST_MISMATCH');
  let productCount=0,sellerCount=0,sellerMismatch=false;
  for await(const p of stream('SELECT product_id,category,attributes FROM products WHERE run_id=?',[runId])){
    productCount++;const original=index.getProduct(p.product_id);
    if(!same(json(p.attributes),original)||p.category!==(original?.product_category_name||null))fail('PRODUCT_ATTRIBUTES');
  }
  if(productCount!==index.counts.products)fail('PRODUCT_COUNT');
  for await(const s of stream('SELECT seller_id FROM sellers WHERE run_id=?',[runId])){sellerCount++;if(!index.hasSeller(s.seller_id))sellerMismatch=true;}
  if(sellerCount!==index.counts.sellers||sellerMismatch)fail('SELLER_SET');
  const saveEvent=index.db.prepare('INSERT INTO page_events(task_id,seq,payload) VALUES(?,?,?)');
  const taskEvents=index.db.prepare('SELECT payload FROM page_events WHERE task_id=? ORDER BY seq,row_no');
  const saveScan=index.db.prepare('INSERT INTO event_scans VALUES(?,?,0) ON CONFLICT(event_id) DO UPDATE SET product=excluded.product,reversed=0');
  const getScan=index.db.prepare('SELECT product,reversed FROM event_scans WHERE event_id=?');
  const reverseScan=index.db.prepare('UPDATE event_scans SET reversed=1 WHERE event_id=?');
  let after='';
  for(;;){
    const rows=await query('SELECT r.*,o.id order_id,o.revision,o.status order_status,o.source_order_id normalized_source_id,o.source_status normalized_source_status,o.seller_id normalized_seller,o.hold_reasons,o.quality_flags,o.run_id order_run,t.id task_id,t.run_id task_run,t.status task_status,t.last_processed_seq,t.snapshot,t.device_id,t.assignment_version,t.confirmed_at,t.business_date FROM raw_orders r LEFT JOIN orders o ON o.raw_order_id=r.id LEFT JOIN tasks t ON t.order_id=o.id WHERE r.run_id=? AND r.id>? ORDER BY r.id LIMIT 200',[runId,after]);
    if(!rows.length)break;after=rows.at(-1).id;
    const orderIds=rows.map(r=>r.order_id).filter(Boolean),taskIds=rows.map(r=>r.task_id).filter(Boolean);
    const normalized=orderIds.length?group(await query('SELECT * FROM order_items WHERE order_id IN('+orderIds.map(()=>'?')+')',orderIds),'order_id'):new Map();
    const tasks=taskIds.length?group(await query('SELECT i.*,COUNT(s.event_id) net FROM task_items i LEFT JOIN task_scans s ON s.task_id=i.task_id AND s.product_id=i.product_id AND s.reversed_by_event_id IS NULL WHERE i.task_id IN('+taskIds.map(()=>'?')+') GROUP BY i.task_id,i.product_id,i.required_qty,i.applied_qty',taskIds),'task_id'):new Map();
    let normalizedRows=0,taskItemRows=0;for(const rows of normalized.values())normalizedRows+=rows.length;for(const rows of tasks.values())taskItemRows+=rows.length;
    maxRawRows=Math.max(maxRawRows,rows.length);maxNormalizedRows=Math.max(maxNormalizedRows,normalizedRows);maxTaskItemRows=Math.max(maxTaskItemRows,taskItemRows);
    index.db.exec('DELETE FROM page_events');let pageEvents=0;
    if(taskIds.length)for await(const event of stream('SELECT * FROM device_events WHERE task_id IN('+taskIds.map(()=>'?').join(',')+') ORDER BY task_id,seq',taskIds)){
      saveEvent.run(event.task_id,event.seq,JSON.stringify(event));pageEvents++;
    }
    maxPageEvents=Math.max(maxPageEvents,pageEvents);
    for(const row of rows){
      const source=index.getOrder(row.source_record_id);orderChecks++;
      if(!source||source.seen){fail('SOURCE_KEY_SET');continue;}index.markSeen(row.source_record_id);
      const e=index.expected(source),body=json(row.payload);classifications[e.status]=(classifications[e.status]||0)+1;
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
      let seq=0,completeCount=0;const projection=new Map<string,number>();index.db.exec('DELETE FROM event_scans');
      for(const record of taskEvents.iterate(row.task_id) as Iterable<any>){
        const savedEvent=JSON.parse(record.payload);
        eventChecks++;const event=json(savedEvent.event_body),receipt=json(savedEvent.result);
        if(savedEvent.seq!==++seq||event.seq!==seq||event.eventId!==savedEvent.event_id||event.taskId!==row.task_id||event.deviceId!==savedEvent.device_id||event.deviceId!==row.device_id||event.assignmentVersion!==row.assignment_version||digest(canonical(event))!==savedEvent.canonical_hash||receipt.receipt?.processedSeq!==seq||receipt.result!==savedEvent.outcome)fail('EVENT_IDENTITY_SEQUENCE_HASH_RECEIPT');
        if(savedEvent.outcome!=='APPLIED')continue;if(event.type==='COMPLETE')completeCount++;
        if(event.type==='SCAN_ITEM'){projection.set(event.payload.productId,(projection.get(event.payload.productId)||0)+1);saveScan.run(event.eventId,event.payload.productId);}
        else if(event.type==='REVERSE_SCAN'){const scan=getScan.get(event.payload.targetEventId) as any;if(!scan||scan.reversed)fail('EVENT_REVERSAL');else{reverseScan.run(event.payload.targetEventId);projection.set(scan.product,(projection.get(scan.product)||0)-1);}}
        else if(receipt.receipt.taskStatus!=='CONFIRMED'||receipt.receipt.confirmedAt!==row.confirmed_at)fail('COMPLETE_RECEIPT');
      }
      if(seq!==row.last_processed_seq)fail('LAST_PROCESSED_SEQUENCE');
      for(const i of saved)if(i.applied_qty!==(projection.get(i.product_id)||0))fail('EVENT_EFFECT_REPLAY');
      if(row.task_status==='CONFIRMED'){confirmed++;if(completeCount!==1)fail('CONFIRMED_COMPLETE_COUNT');
        if(!row.confirmed_at||new Intl.DateTimeFormat('en-CA',{timeZone:process.env.BUSINESS_TIMEZONE||'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.confirmed_at))!==row.business_date)fail('CONFIRMED_BUSINESS_DATE');
      }
    }
  }
  if(index.seenCount()!==index.counts.orders)fail('MISSING_SOURCE_ORDERS');
  const [counts]=await query("SELECT (SELECT COUNT(*) FROM orders WHERE run_id=?) orders,(SELECT COUNT(*) FROM tasks WHERE run_id=?) tasks,(SELECT COUNT(*) FROM outbox_jobs WHERE run_id=? AND status<>'DONE') unfinished",[runId,runId,runId]);
  if(Number(counts.orders)!==index.counts.orders||Number(counts.tasks)!==taskChecks)fail('EXTRA_NORMALIZED_OR_TASK_ROWS');unfinishedJobs=Number(counts.unfinished);if(unfinishedJobs)fail('OUTBOX_NOT_DRAINED');
  const [checkpoint]=await query("SELECT status FROM source_checkpoints WHERE run_id=? AND source='olist'",[runId]);if(checkpoint?.status!=='DONE')fail('SOURCE_NOT_DONE');
  // Grouped SQL results may be large too: spool each result row to disk, never .query() an entire result array.
  for(const [table,sql] of [
    ['daily_expected',"SELECT t.business_date,COUNT(DISTINCT t.id) tasks,SUM(i.applied_qty) items FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date"],
    ['daily_saved','SELECT business_date,task_count tasks,item_count items FROM report_daily WHERE run_id=?']]){
    const insert=index.db.prepare('INSERT INTO '+table+' VALUES(?,?,?)');
    for await(const r of stream(sql,[runId]))insert.run(r.business_date||'',Number(r.tasks),Number(r.items));
  }
  const dailyMismatch=index.db.prepare(`SELECT COUNT(*) n FROM (
    SELECT e.day FROM daily_expected e LEFT JOIN daily_saved s ON s.day=e.day WHERE s.day IS NULL OR e.tasks<>s.tasks OR e.items<>s.items
    UNION ALL SELECT s.day FROM daily_saved s LEFT JOIN daily_expected e ON e.day=s.day WHERE e.day IS NULL)`).get() as any;
  if(Number(dailyMismatch.n))fail('DAILY_REPORT');
  for(const [table,sql] of [
    ['product_expected',"SELECT t.business_date,i.product_id,SUM(i.applied_qty) qty FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date,i.product_id"],
    ['product_saved','SELECT business_date,product_id,quantity qty FROM report_daily_product WHERE run_id=?']]){
    const insert=index.db.prepare('INSERT INTO '+table+' VALUES(?,?,?)');
    for await(const r of stream(sql,[runId]))insert.run(r.business_date||'',r.product_id,Number(r.qty));
  }
  const productMismatch=index.db.prepare(`SELECT COUNT(*) n FROM (
    SELECT e.day FROM product_expected e LEFT JOIN product_saved s ON s.day=e.day AND s.product=e.product WHERE s.day IS NULL OR e.qty<>s.qty
    UNION ALL SELECT s.day FROM product_saved s LEFT JOIN product_expected e ON e.day=s.day AND e.product=s.product WHERE e.day IS NULL)`).get() as any;
  if(Number(productMismatch.n))fail('PRODUCT_REPORT');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}catch(error:any){if(process.env.AUDIT_DEBUG==='1')console.error(error);fail(error.auditCode||(error.code==='ENOENT'?'RAW_FILE_UNAVAILABLE':'AUDIT_ABORTED'));}
try{
  index.finish();
  const report={status:Object.keys(errors).length?'FAIL':'PASS',at:new Date().toISOString(),scope:'Independent CSV oracle with disposable SQLite index and read-only consistent MySQL snapshot; no Source/normalize/reconcile/LocalStore imports',input:manifest.synthetic?'SYNTHETIC':'ACTUAL_OLIST',datasetRunId:runId,
    codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),oracleSha256:digest(readFileSync(new URL(import.meta.url))),sourceIndexSha256:digest(readFileSync(new URL('./audit-source-index'+(import.meta.url.endsWith('.ts')?'.ts':'.js'),import.meta.url))),lockfileSha256:digest(readFileSync('package-lock.json')),
    fileChecks:index.fileChecks,sourceOrders:index.counts.orders||0,sourceItems:index.counts.items||0,sourceProducts:index.counts.products||0,sourceSellers:index.counts.sellers||0,orderChecks,taskChecks,quantityChecks,eventChecks,confirmed,classifications,unfinishedJobs,
    errors,sourceCsvRows:index.fileRows,sourceKeyDiagnostics:{duplicateRows:index.duplicateRows,conflictingKeys:index.conflictingKeys},bounds:{sqliteCacheKiB:8192,mmapBytes:0,rawPageRows:200,streamHighWaterRows:16,maxRawRows,maxNormalizedRows,maxTaskItemRows,maxOrderItems:index.maxOrderItems,maxPageEvents,sqlStatements},
    temporaryStorage:{logicalBytes:index.disk(),retained:process.env.AUDIT_KEEP_TEMP==='1',scope:'Disposable disk index only; excludes source files and MySQL disk'}};
  // Report days are also streamed: output size does not turn into another process-wide array.
  const output=process.env.AUDIT_OUTPUT||'reports/independent-source-'+runId+'-'+report.at.replace(/[:.]/g,'-')+'.json';
  mkdirSync(dirname(output),{recursive:true});const fd=openSync(output,'w',0o600);
  try{
    writeSync(fd,JSON.stringify(report).slice(0,-1)+',"reports":[');let first=true;
    for(const row of index.db.prepare('SELECT day,tasks,items FROM daily_saved ORDER BY day').iterate() as Iterable<any>){
      writeSync(fd,(first?'':',')+JSON.stringify({date:row.day,tasks:row.tasks,items:row.items}));first=false;
    }
    writeSync(fd,']}\n');
  }finally{closeSync(fd);}
  await pipeline(createReadStream(output),process.stdout,{end:false});
  if(report.status==='FAIL')process.exitCode=1;
}finally{index.close();}
