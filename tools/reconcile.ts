import { writeFileSync,readFileSync,mkdirSync,createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join,basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connectDb,connection } from '../src/server/db.js';
import { hash,parseJson,sha256 } from '../src/shared/contracts.js';
import { normalize } from '../src/ingestion/normalize.js';
const db=await connectDb(),runId=process.env.DATASET_RUN_ID!;
const prepared=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
try{
  const c=connection(db),waitArg=process.argv.find(v=>v.startsWith('--wait-seconds=')),waitSeconds=waitArg?Number(waitArg.split('=')[1]):0;
  if(!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>600)throw new Error('wait-seconds must be 0..600');
  const deadline=Date.now()+waitSeconds*1000;
  while(Date.now()<deadline){
    const rows=await c.execute("SELECT status,COUNT(*) n FROM outbox_jobs WHERE run_id=? AND status<>'DONE' GROUP BY status",[runId]);
    const [cp]=await c.execute("SELECT status FROM source_checkpoints WHERE run_id=? AND source='olist'",[runId]);
    if((!rows.length&&cp?.status==='DONE')||rows.some((r:any)=>r.status==='FAILED')||cp?.status==='FAILED')break;
    await new Promise(r=>setTimeout(r,500));
  }
  const [run]=await c.execute('SELECT * FROM dataset_runs WHERE id=?',[runId]);if(!run)throw new Error('Unknown run');
  const manifest=parseJson(run.manifest),originalManifest=JSON.parse((prepared.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);
  const errors:string[]=[];let errorCount=0;const fail=(code:string)=>{errorCount++;if(errors.length<100)errors.push(code);};
  if(hash(manifest)!==hash(originalManifest))fail('MANIFEST_MISMATCH');
  let rawFileHashesVerified=0;
  if(!process.env.RAW_DIR)fail('RAW_SOURCE_DIRECTORY_NOT_CONFIGURED');
  else for(const file of originalManifest.files){
    try{const digest=createHash('sha256');let bytes=0;for await(const block of createReadStream(join(process.env.RAW_DIR,basename(file.fileName)))){digest.update(block);bytes+=block.length;}
      if(digest.digest('hex')!==file.fileSha256||bytes!==file.fileBytes)fail('RAW_FILE_CHANGED');else rawFileHashesVerified++;
    }catch{fail('RAW_FILE_UNAVAILABLE');}
  }
  const expected=Number((prepared.prepare('SELECT COUNT(DISTINCT source_key) n FROM orders').get() as any).n);
  const [raw]=await c.execute('SELECT COUNT(*) n FROM raw_orders WHERE run_id=?',[runId]);
  const statuses=await c.execute('SELECT status,COUNT(*) n FROM orders WHERE run_id=? GROUP BY status',[runId]);
  const counts=Object.fromEntries(statuses.map((r:any)=>[r.status,Number(r.n)]));
  const classificationReasons=await c.execute("SELECT o.status,r.reason,COUNT(*) recordCount FROM orders o JOIN JSON_TABLE(o.hold_reasons,'$[*]' COLUMNS(reason VARCHAR(128) PATH '$')) r ON TRUE WHERE o.run_id=? GROUP BY o.status,r.reason ORDER BY o.status,r.reason",[runId]);
  const qualityFlags=await c.execute("SELECT f.flag,COUNT(*) recordCount FROM orders o JOIN JSON_TABLE(o.quality_flags,'$[*]' COLUMNS(flag VARCHAR(128) PATH '$')) f ON TRUE WHERE o.run_id=? GROUP BY f.flag ORDER BY f.flag",[runId]);
  const [tasks]=await c.execute('SELECT COUNT(*) n FROM tasks WHERE run_id=?',[runId]);
  const [unfinished]=await c.execute("SELECT COUNT(*) n FROM outbox_jobs WHERE run_id=? AND status<>'DONE'",[runId]);
  const [cp]=await c.execute("SELECT status FROM source_checkpoints WHERE run_id=? AND source='olist'",[runId]);
  if(cp?.status!=='DONE')fail('INGESTION_NOT_DONE');
  if(Number(raw.n)!==expected)fail('RAW_COUNT_MISMATCH');
  if(Object.values(counts).reduce((a:number,b:any)=>a+Number(b),0)!==Number(raw.n))fail('CLASSIFICATION_MISMATCH');
  if(Number(tasks.n)!==(counts.READY||0)+(counts.TASK_CREATED||0))fail('TASK_COUNT_MISMATCH_OR_NOT_DRAINED');
  if(Number(unfinished.n))fail('OUTBOX_NOT_DRAINED');
  const productIds=new Set<string>(),categories=new Map<string,string|null>();let batch:any[]=[];
  const checkMasterBatch=async()=>{
    if(!batch.length)return;const rows=batch;batch=[];
    const saved=await c.execute('SELECT product_id,category,attributes FROM products WHERE run_id=? AND product_id IN('+rows.map(()=>'?').join(',')+')',[runId,...rows.map(r=>r.id)]);
    const byId=new Map<string,any>(saved.map((r:any)=>[r.product_id,r]));
    for(const row of rows){const p=JSON.parse(row.payload),s=byId.get(row.id);if(!s||hash(parseJson(s.attributes))!==hash(p)||s.category!==(p.product_category_name||null))fail('PRODUCT_MASTER_CONTENT_MISMATCH');}
  };
  for(const row of prepared.prepare('SELECT id,payload FROM products').iterate() as Iterable<any>){productIds.add(row.id);categories.set(row.id,JSON.parse(row.payload).product_category_name||null);batch.push(row);if(batch.length===200)await checkMasterBatch();}await checkMasterBatch();
  const [master]=await c.execute('SELECT COUNT(*) n FROM products WHERE run_id=?',[runId]);if(Number(master.n)!==productIds.size)fail('PRODUCT_MASTER_MISMATCH');
  const sellerIds=new Set<string>((prepared.prepare('SELECT id FROM sellers').all() as any[]).map(r=>r.id));
  const savedSellers=await c.execute('SELECT seller_id FROM sellers WHERE run_id=?',[runId]);
  if(savedSellers.length!==sellerIds.size||savedSellers.some((r:any)=>!sellerIds.has(r.seller_id)))fail('SELLER_MASTER_MISMATCH');
  const originalOrder=prepared.prepare('SELECT payload FROM orders WHERE source_key=? ORDER BY position LIMIT 1');
  const originalItems=prepared.prepare('SELECT * FROM items WHERE order_id=? ORDER BY CAST(source_item_id AS INTEGER),rowid');
  const sourceItems=(id:string)=>(originalItems.all(id) as any[]).map(i=>({sourceItemId:Number.isInteger(Number(i.source_item_id))&&Number(i.source_item_id)>0?Number(i.source_item_id):null,productId:i.product_id||null,sellerId:i.seller_id||null,shipByRaw:i.ship_by||null,category:categories.get(i.product_id)||null}));
  let after='',orderChecks=0,quantityChecks=0,taskChecks=0;
  for(;;){
    const rows=await c.execute('SELECT o.id,o.revision,o.status,r.source_record_id,r.payload,r.payload_hash FROM orders o JOIN raw_orders r ON r.id=o.raw_order_id WHERE o.run_id=? AND o.id>? ORDER BY o.id LIMIT 200',[runId,after]);if(!rows.length)break;
    const normalized=await c.execute('SELECT order_id,product_id,required_qty FROM order_items WHERE order_id IN('+rows.map(()=>'?').join(',')+')',rows.map((r:any)=>r.id));
    for(const order of rows){
      const original=originalOrder.get(order.source_record_id) as any;if(!original){fail('ORIGINAL_ORDER_KEY_MISSING');continue;}
      const o=JSON.parse(original.payload),body=parseJson(order.payload),items=sourceItems(o.order_id);
      if(hash(body)!==order.payload_hash)fail('RAW_CANONICAL_HASH_MISMATCH');
      if(body.sourceOrderId!==(o.order_id||null)||body.sourceStatus!==(o.order_status||null)||body.sourceApprovedAtRaw!==(o.order_approved_at||null)||body.sourcePurchasedAtRaw!==(o.order_purchase_timestamp||null)||hash(body.items)!==hash(items))fail('ORIGINAL_ORDER_CONTENT_MISMATCH');
      if(order.revision===1){const n=normalize({...body,sourceOrderId:o.order_id||null,sourceStatus:o.order_status||null,sourceApprovedAtRaw:o.order_approved_at||null,items},productIds,sellerIds);if((order.status==='TASK_CREATED'?'READY':order.status)!==n.status)fail('ORIGINAL_CLASSIFICATION_MISMATCH');
        const expectedQty:Record<string,number>={};for(const item of items)if(item.productId&&productIds.has(item.productId))expectedQty[item.productId]=(expectedQty[item.productId]||0)+1;
        if(hash(Object.fromEntries(normalized.filter((i:any)=>i.order_id===order.id).map((i:any)=>[i.product_id,i.required_qty])))!==hash(expectedQty))fail('NORMALIZED_SOURCE_QUANTITY');
      }orderChecks++;
    }after=rows[rows.length-1].id;if(orderChecks%5000===0)console.log('Reconciled original orders',orderChecks);
  }
  after='';
  for(;;){
    const rows=await c.execute('SELECT t.id,t.status,o.id order_id,o.revision,o.source_order_id FROM tasks t JOIN orders o ON o.id=t.order_id WHERE t.run_id=? AND t.id>? ORDER BY t.id LIMIT 200',[runId,after]);if(!rows.length)break;
    const ids=rows.map((r:any)=>r.id);
    const items=await c.execute('SELECT i.task_id,i.product_id,i.required_qty,i.applied_qty,COUNT(s.event_id) net_scans FROM task_items i LEFT JOIN task_scans s ON s.task_id=i.task_id AND s.product_id=i.product_id AND s.reversed_by_event_id IS NULL WHERE i.task_id IN('+ids.map(()=>'?').join(',')+') GROUP BY i.task_id,i.product_id,i.required_qty,i.applied_qty',ids);
    const byTask=new Map<string,any[]>();for(const i of items){const a=byTask.get(i.task_id)||[];a.push(i);byTask.set(i.task_id,a);}
    for(const task of rows){
      const expectedQty=new Map<string,number>();
      if(task.revision===1){for(const item of sourceItems(task.source_order_id))if(item.productId)expectedQty.set(item.productId,(expectedQty.get(item.productId)||0)+1);}
      else for(const item of await c.execute('SELECT product_id,required_qty FROM order_items WHERE order_id=?',[task.order_id]))expectedQty.set(item.product_id,item.required_qty);
      const saved=byTask.get(task.id)||[];if(saved.length!==expectedQty.size)fail('SOURCE_PRODUCT_SET');
      for(const item of saved){quantityChecks++;if(item.required_qty!==expectedQty.get(item.product_id))fail('SOURCE_ROW_QUANTITY');if(Number(item.net_scans)!==item.applied_qty)fail('NET_SCAN_QUANTITY');if(item.applied_qty<0||item.applied_qty>item.required_qty||(task.status==='CONFIRMED'&&item.applied_qty!==item.required_qty))fail('BAD_CONFIRMED');}taskChecks++;
    }after=rows[rows.length-1].id;if(taskChecks%5000===0)console.log('Reconciled task quantities',taskChecks);
  }
  const reports=await c.execute('SELECT * FROM report_daily WHERE run_id=?',[runId]);
  const expectedReports=await c.execute("SELECT t.business_date,COUNT(DISTINCT t.id) task_count,COALESCE(SUM(i.applied_qty),0) item_count FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.status='CONFIRMED' GROUP BY t.business_date",[runId]);
  const days=new Set([...reports.map((r:any)=>r.business_date),...expectedReports.map((r:any)=>r.business_date)]);
  for(const day of days){
    const saved=reports.find((r:any)=>r.business_date===day),actual=expectedReports.find((r:any)=>r.business_date===day);
    if((saved?.task_count||0)!==Number(actual?.task_count||0)||(saved?.item_count||0)!==Number(actual?.item_count||0)||(!saved&&actual))fail('REPORT_MISMATCH');
    const actualProducts=await c.execute("SELECT i.product_id,SUM(i.applied_qty) quantity FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.business_date=? AND t.status='CONFIRMED' GROUP BY i.product_id ORDER BY i.product_id",[runId,day]);
    const savedProducts=await c.execute('SELECT product_id,quantity FROM report_daily_product WHERE run_id=? AND business_date=? ORDER BY product_id',[runId,day]);
    const values=(list:any[])=>list.map(r=>({productId:r.product_id,quantity:Number(r.quantity)}));if(hash(values(actualProducts))!==hash(values(savedProducts)))fail('PRODUCT_REPORT_MISMATCH');
  }
  const migrations=await c.execute('SELECT version,sha256 FROM schema_migrations ORDER BY version');const [scenario]=await c.execute('SELECT scenario_hash FROM dataset_scenarios WHERE run_id=?',[runId]);
  let codeCommit:string|null=process.env.CODE_COMMIT||null;try{codeCommit=codeCommit||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{}
  const report={at:new Date().toISOString(),datasetRunId:runId,synthetic:!!manifest.synthetic,manifest,scenarioHash:scenario?.scenario_hash||null,codeCommit,lockfileSha256:sha256(readFileSync('package-lock.json')),migrations,rawFileHashesVerified,expectedRawOrders:expected,rawOrders:Number(raw.n),classification:counts,classificationReasons,qualityFlags,tasks:Number(tasks.n),unfinishedJobs:Number(unfinished.n),products:Number(master.n),sellers:savedSellers.length,orderChecks,taskChecks,quantityChecks,orphanItemRows:originalManifest.orphanItemRows,status:errorCount?'FAIL':'PASS',errorCount,errors};
  const output=JSON.stringify(report,null,2)+'\n',directory=process.env.RECONCILE_OUTPUT_DIR||'reports';mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,'reconciliation-'+runId+'-'+report.at.replace(/[:.]/g,'-')+'.json'),output);writeFileSync(join(directory,'reconciliation-'+runId+'.json'),output);console.log(JSON.stringify(report));if(errorCount)process.exitCode=1;
}finally{prepared.close();await db.close(true);}
