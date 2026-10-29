/** Correctness comparison against the frozen pre-optimization oracle. Synthetic data only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,existsSync,readdirSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'csv-parse/sync';
import { connectDb,connection,transaction } from '../../src/server/db.js';
import { Source } from '../../src/source/source.js';
import { importMasters } from '../../src/ingestion/masters.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { assign } from '../../src/fulfillment/tasks.js';
import { applyEvent } from '../../src/sync/events.js';
import { hash,now,parseJson } from '../../src/shared/contracts.js';
import { drainRunJobs } from './helpers.js';

const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const csv=(rows:any[])=>[Object.keys(rows[0]),...rows.map(r=>Object.keys(rows[0]).map(k=>r[k]))].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
const load=(path:string)=>parse(readFileSync(path),{columns:true,bom:true}) as any[];
const files=['olist_orders_dataset.csv','olist_order_items_dataset.csv','olist_products_dataset.csv','olist_sellers_dataset.csv'];
const stable=(r:any)=>Object.fromEntries(['status','sourceOrders','sourceItems','sourceProducts','sourceSellers','orderChecks','taskChecks','quantityChecks','eventChecks','confirmed','classifications','unfinishedJobs','reports','errors'].map(k=>[k,r[k]]));

test('disk CSV oracle preserves checks and logical duplicates, rejects hidden conflicts and wrong counts',{timeout:180000},async()=>{
  assert.equal(process.env.MYSQL_DATABASE,'logistics_test','Corruptions require isolated test DB');
  const work=mkdtempSync(join(tmpdir(),'logistics-audit-memory-')),raw=join(work,'raw'),preparedPath=join(work,'prepared.sqlite');
  mkdirSync(raw);
  for(const file of files)copyFileSync(join('data/fixtures',file),join(raw,file));
  const orders=load(join(raw,files[0])),items=load(join(raw,files[1])),products=load(join(raw,files[2])),sellers=load(join(raw,files[3]));
  orders[1].order_approved_at='';
  const keptItems=items.filter(i=>i.order_id!==orders[2].order_id);
  orders[3].order_status='canceled';
  sellers.push({...sellers[0],seller_id:'e'.repeat(32)});
  keptItems.find(i=>i.order_id===orders[4].order_id).seller_id='e'.repeat(32);
  for(const [n,item] of keptItems.filter(i=>i.order_id===orders[5].order_id).entries())item.order_item_id=String([1,3,9][n]);
  keptItems.filter(i=>i.order_id===orders[6].order_id)[1].order_item_id='1'; // Correct DATA_HOLD, not an audit failure by itself.
  products[0].product_weight_g='0';products[1].product_category_name='';
  for(const [i,rows] of [orders,keptItems,products,sellers].entries())writeFileSync(join(raw,files[i]),csv(rows));
  const build=spawnSync('python3',['tools/prepare-data.py','--synthetic','--raw',raw,'--out',preparedPath,'--manifest',join(work,'manifest.json')],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const prepared=new DatabaseSync(preparedPath,{readOnly:true}),runId=randomUUID(),deviceId='audit-matrix-'+randomUUID();
  const source=new Source(preparedPath,runId),manifest=source.manifest,db=await connectDb(),c=connection(db);
  const results:any[]=[];
  const codeFiles=['tools/audit-source.ts','tools/audit-source-index.ts','tools/benchmarks/audit-source-baseline.ts','tests/integration/audit-memory.test.ts'];
  const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,sha(readFileSync(f))]));
  const saveResults=()=>{assert.deepEqual(Object.fromEntries(codeFiles.map(f=>[f,sha(readFileSync(f))])),codeHashes,'No code edits during correctness run');if(process.env.AUDIT_CASE_REPORT)writeFileSync(process.env.AUDIT_CASE_REPORT,JSON.stringify({status:'PASS',scope:'Isolated SYNTHETIC fixture; original CSV/DB never corrupted',codeHashes,cases:results},null,2)+'\n');};
  async function restore(table:string,row:any){const names=Object.keys(row);await c.execute('INSERT INTO `'+table+'` ('+names.map(n=>'`'+n+'`').join(',')+') VALUES('+names.map(()=>'?')+')',names.map(n=>row[n]!==null&&typeof row[n]==='object'?JSON.stringify(row[n]):row[n]));}
  const compare=(name:string,kind:'PASS'|'FAIL'|'NEW_SOURCE_CHECK',directory=raw,m=manifest)=>{
    const config=join(work,name+'-manifest.json');writeFileSync(config,JSON.stringify(m));
    const reports:any[]=[];
    for(const script of ['tools/benchmarks/audit-source-baseline.ts','tools/audit-source.ts']){
      const file=join(work,name+'-'+reports.length+'.json'),temp=join(work,name+'-scratch-'+reports.length);mkdirSync(temp);
      const p=spawnSync(process.execPath,['--import','tsx',script],{env:{...process.env,DATASET_RUN_ID:runId,RAW_DIR:directory,SOURCE_MANIFEST:config,AUDIT_OUTPUT:file,TMPDIR:temp,SQLITE_TMPDIR:temp,AUDIT_KEEP_TEMP:'0'},encoding:'utf8',timeout:30000});
      assert.notEqual(p.status,null,p.stderr);
      const report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
      reports.push({exit:p.status,status:report?.status||'ABORTED',errors:report?.errors||{},keyDiagnostics:report?.sourceKeyDiagnostics||null,result:report?stable(report):null});
      if(script==='tools/audit-source.ts')assert(!readdirSync(temp).some(n=>n.startsWith('olist-audit-')),'Scratch must be cleaned on success and failure');
    }
    if(kind==='PASS'){
      assert.equal(reports[0].exit,0,name);assert.equal(reports[1].exit,0,name);assert.deepEqual(reports[1].result,reports[0].result,name);
      if(name==='normal-mixed-classification-and-events'){assert.deepEqual(reports[1].result.classifications,{...reports[1].result.classifications,TASK_CREATED:5,DATA_HOLD:3,UNSUPPORTED:2});assert.equal(reports[1].result.eventChecks,6);assert.equal(reports[1].result.confirmed,1);assert.equal(reports[1].keyDiagnostics.duplicateRows.items,1);}
      if(name.startsWith('identical-duplicate-')){const kind=name.split('-').at(-1)+'s';assert.equal(reports[1].keyDiagnostics.duplicateRows[kind],1);}
    }
    else if(kind==='FAIL'){
      assert.equal(reports[0].exit,1,name+': baseline must detect');assert.equal(reports[1].exit,1,name+': new oracle must detect');
      assert(!reports[1].errors.AUDIT_ABORTED,name+': detection must not be an unrelated runtime error');
      if(reports[0].status==='FAIL')assert.deepEqual(reports[1].errors,reports[0].errors,name+': preserve existing error codes/counts');
      else assert(['csv-changed-with-old-fingerprint','missing-source-file'].includes(name),'Only known input aborts may lack baseline JSON');
    }
    else{assert.equal(reports[0].exit,0,name+': baseline hides bad source metadata/conflict');assert.equal(reports[1].exit,1,name+': new source check');assert(Object.keys(reports[1].errors).some(c=>c.startsWith('SOURCE_KEY_CONFLICT_')||c==='SOURCE_ROW_COUNT'),name);}
    results.push({name,expected:kind,baseline:{exit:reports[0].exit,status:reports[0].status,errors:reports[0].errors},diskIndexed:{exit:reports[1].exit,status:reports[1].status,errors:reports[1].errors,keyDiagnostics:reports[1].keyDiagnostics}});
  };
  const sqlCase=async(name:string,change:()=>Promise<any>,undo:()=>Promise<any>)=>{await change();try{compare(name,'FAIL');}finally{await undo();}};
  const sourceCase=async(name:string,edit:(dir:string)=>void,kind:'PASS'|'FAIL'|'NEW_SOURCE_CHECK',updateFingerprint=true,editManifest?:(m:any)=>void)=>{
    const dir=join(work,name);mkdirSync(dir);for(const file of files)copyFileSync(join(raw,file),join(dir,file));edit(dir);
    const m=structuredClone(manifest);
    if(updateFingerprint)for(const f of m.files){const path=join(dir,f.fileName),buffer=readFileSync(path),rows=load(path);f.fileSha256=sha(buffer);f.fileBytes=buffer.length;f.rowCount=rows.length;f.schemaFingerprint=sha(JSON.stringify(Object.keys(rows[0])));const fields=f.keyDefinition?.split('+')||[];if(fields.length)f.distinctKeyCount=new Set(rows.map((r:any)=>fields.map((k:string)=>r[k]).join(':'))).size;}
    editManifest?.(m);
    await c.execute('UPDATE dataset_runs SET manifest=? WHERE id=?',[JSON.stringify(m),runId]);
    try{compare(name,kind,dir,m);}finally{await c.execute('UPDATE dataset_runs SET manifest=? WHERE id=?',[JSON.stringify(manifest),runId]);}
  };
  try{
    await transaction(db,async tx=>{
      await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?)',[runId,manifest.datasetVersion,JSON.stringify(manifest),'REGISTERED',now()]);
      await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?)',[runId,'olist',null,'PAUSED',now()]);
      await tx.execute('INSERT INTO devices(id,token_hash,enabled) VALUES(?,?,true)',[deviceId,sha(randomUUID())]);
    });
    await importMasters(db,runId,prepared.prepare('SELECT * FROM products').iterate(),prepared.prepare('SELECT * FROM sellers').iterate());
    await ingestPage(db,runId,source.page(undefined,200,new Date('2030-01-01T00:00:00Z')),null);await drainRunJobs(db,runId);
    const [target]=await c.execute('SELECT t.id FROM tasks t JOIN orders o ON o.id=t.order_id WHERE t.run_id=? AND o.source_order_id=?',[runId,orders[0].order_id]);
    await assign(db,'audit-matrix',target.id,{requestId:randomUUID(),deviceId,reason:'Synthetic memory-oracle correctness fixture'});
    let seq=0;
    const emit=async(type:any,payload:any)=>{const event:any={eventId:randomUUID(),taskId:target.id,deviceId,assignmentVersion:1,seq:++seq,occurredAt:now(),type,payload};await applyEvent(db,deviceId,event);return event;};
    const first=await emit('SCAN_ITEM',{productId:'a'.repeat(32),quantity:1});
    await emit('SCAN_ITEM',{productId:'a'.repeat(32),quantity:1});await emit('REVERSE_SCAN',{targetEventId:first.eventId});
    await emit('SCAN_ITEM',{productId:'a'.repeat(32),quantity:1});await emit('SCAN_ITEM',{productId:'b'.repeat(32),quantity:1});await emit('COMPLETE',{});await drainRunJobs(db,runId);
    compare('normal-mixed-classification-and-events','PASS');
    await sourceCase('unsorted-all-four-csv',dir=>{for(const file of files)writeFileSync(join(dir,file),csv(load(join(dir,file)).reverse()));},'PASS');
    const [row]=await c.execute("SELECT r.id raw_id,r.payload,r.payload_hash,o.id order_id,t.id task_id FROM raw_orders r JOIN orders o ON o.raw_order_id=r.id JOIN tasks t ON t.order_id=o.id WHERE r.run_id=? AND t.status='CREATED' LIMIT 1",[runId]);
    await sqlCase('raw-hash-only',()=>c.execute('UPDATE raw_orders SET payload_hash=? WHERE id=?',['0'.repeat(64),row.raw_id]),()=>c.execute('UPDATE raw_orders SET payload_hash=? WHERE id=?',[row.payload_hash,row.raw_id]));
    await sqlCase('normalized-quantity-only',()=>c.execute('UPDATE order_items SET required_qty=1 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]),()=>c.execute('UPDATE order_items SET required_qty=2 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]));
    await sqlCase('task-required-quantity-only',()=>c.execute('UPDATE task_items SET required_qty=1 WHERE task_id=? AND product_id=?',[row.task_id,'a'.repeat(32)]),()=>c.execute('UPDATE task_items SET required_qty=2 WHERE task_id=? AND product_id=?',[row.task_id,'a'.repeat(32)]));
    const changed=structuredClone(parseJson(row.payload));changed.items=changed.items.filter((_:any,i:number)=>i!==0);
    await sqlCase('coherent-raw-and-projections',async()=>{await c.execute('UPDATE raw_orders SET payload=?,payload_hash=? WHERE id=?',[JSON.stringify(changed),hash(changed),row.raw_id]);await c.execute('UPDATE order_items SET required_qty=1 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]);await c.execute('UPDATE task_items SET required_qty=1 WHERE task_id=? AND product_id=?',[row.task_id,'a'.repeat(32)]);},async()=>{await c.execute('UPDATE raw_orders SET payload=?,payload_hash=? WHERE id=?',[typeof row.payload==='string'?row.payload:JSON.stringify(row.payload),row.payload_hash,row.raw_id]);await c.execute('UPDATE order_items SET required_qty=2 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]);await c.execute('UPDATE task_items SET required_qty=2 WHERE task_id=? AND product_id=?',[row.task_id,'a'.repeat(32)]);});
    await sqlCase('order-classification',()=>c.execute("UPDATE orders SET status='UNSUPPORTED' WHERE id=?",[row.order_id]),()=>c.execute("UPDATE orders SET status='TASK_CREATED' WHERE id=?",[row.order_id]));
    const [rawIdentity]=await c.execute('SELECT source_record_id FROM raw_orders WHERE id=?',[row.raw_id]);
    await sqlCase('source-identity-not-in-csv',()=>c.execute('UPDATE raw_orders SET source_record_id=? WHERE id=?',['f'.repeat(32),row.raw_id]),()=>c.execute('UPDATE raw_orders SET source_record_id=? WHERE id=?',[rawIdentity.source_record_id,row.raw_id]));
    const [normalItem]=await c.execute('SELECT * FROM order_items WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]);
    await sqlCase('missing-normalized-product',()=>c.execute('DELETE FROM order_items WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]),()=>restore('order_items',normalItem));
    const [savedTask]=await c.execute('SELECT * FROM tasks WHERE id=?',[row.task_id]);
    const savedTaskItems=await c.execute('SELECT * FROM task_items WHERE task_id=?',[row.task_id]);
    await sqlCase('missing-entire-task',async()=>{await c.execute('DELETE FROM task_items WHERE task_id=?',[row.task_id]);await c.execute('DELETE FROM tasks WHERE id=?',[row.task_id]);},async()=>{await restore('tasks',savedTask);for(const item of savedTaskItems)await restore('task_items',item);});
    const [unsupported]=await c.execute('SELECT id FROM orders WHERE run_id=? AND source_order_id=?',[runId,orders[3].order_id]);const extraTask=randomUUID();
    await sqlCase('extra-ineligible-task',async()=>{await c.execute("INSERT INTO tasks(id,run_id,order_id,status) VALUES(?,?,?,'CREATED')",[extraTask,runId,unsupported.id]);await c.execute('INSERT INTO task_items VALUES(?,?,?,0)',[extraTask,'a'.repeat(32),2]);await c.execute('INSERT INTO task_items VALUES(?,?,?,0)',[extraTask,'b'.repeat(32),1]);},async()=>{await c.execute('DELETE FROM task_items WHERE task_id=?',[extraTask]);await c.execute('DELETE FROM tasks WHERE id=?',[extraTask]);});
    const [missingOrder]=await c.execute('SELECT * FROM orders WHERE run_id=? AND source_order_id=?',[runId,orders[2].order_id]);const [missingRaw]=await c.execute('SELECT * FROM raw_orders WHERE id=?',[missingOrder.raw_order_id]);
    assert.equal((await c.execute('SELECT * FROM order_items WHERE order_id=?',[missingOrder.id])).length,0);
    await sqlCase('missing-server-order-and-raw',async()=>{await c.execute('DELETE FROM orders WHERE id=?',[missingOrder.id]);await c.execute('DELETE FROM raw_orders WHERE id=?',[missingRaw.id]);},async()=>{await restore('raw_orders',missingRaw);await restore('orders',missingOrder);});
    const [attributes]=await c.execute('SELECT attributes FROM products WHERE run_id=? AND product_id=?',[runId,'a'.repeat(32)]);
    await sqlCase('product-attributes',()=>c.execute('UPDATE products SET attributes=? WHERE run_id=? AND product_id=?',['{}',runId,'a'.repeat(32)]),()=>c.execute('UPDATE products SET attributes=? WHERE run_id=? AND product_id=?',[typeof attributes.attributes==='string'?attributes.attributes:JSON.stringify(attributes.attributes),runId,'a'.repeat(32)]));
    await sqlCase('extra-server-seller',()=>c.execute('INSERT INTO sellers VALUES(?,?)',[runId,'c'.repeat(32)]),()=>c.execute('DELETE FROM sellers WHERE run_id=? AND seller_id=?',[runId,'c'.repeat(32)]));
    const [scan]=await c.execute("SELECT * FROM device_events WHERE task_id=? AND seq=1",[target.id]);
    await sqlCase('event-canonical-hash',()=>c.execute('UPDATE device_events SET canonical_hash=? WHERE device_id=? AND event_id=?',['0'.repeat(64),deviceId,scan.event_id]),()=>c.execute('UPDATE device_events SET canonical_hash=? WHERE device_id=? AND event_id=?',[scan.canonical_hash,deviceId,scan.event_id]));
    const wrongSeq={...parseJson(scan.event_body),seq:99};
    await sqlCase('event-body-sequence',()=>c.execute('UPDATE device_events SET event_body=?,canonical_hash=? WHERE device_id=? AND event_id=?',[JSON.stringify(wrongSeq),hash(wrongSeq),deviceId,scan.event_id]),()=>c.execute('UPDATE device_events SET event_body=?,canonical_hash=? WHERE device_id=? AND event_id=?',[typeof scan.event_body==='string'?scan.event_body:JSON.stringify(scan.event_body),scan.canonical_hash,deviceId,scan.event_id]));
    const receipt=parseJson(scan.result),badReceipt={...receipt,receipt:{...receipt.receipt,processedSeq:99}};
    await sqlCase('event-receipt-sequence',()=>c.execute('UPDATE device_events SET result=? WHERE device_id=? AND event_id=?',[JSON.stringify(badReceipt),deviceId,scan.event_id]),()=>c.execute('UPDATE device_events SET result=? WHERE device_id=? AND event_id=?',[JSON.stringify(receipt),deviceId,scan.event_id]));
    const [reversal]=await c.execute('SELECT * FROM device_events WHERE task_id=? AND seq=3',[target.id]);
    const badReversal={...parseJson(reversal.event_body),payload:{targetEventId:randomUUID()}};
    await sqlCase('event-reversal-target',()=>c.execute('UPDATE device_events SET event_body=?,canonical_hash=? WHERE device_id=? AND event_id=?',[JSON.stringify(badReversal),hash(badReversal),deviceId,reversal.event_id]),()=>c.execute('UPDATE device_events SET event_body=?,canonical_hash=? WHERE device_id=? AND event_id=?',[typeof reversal.event_body==='string'?reversal.event_body:JSON.stringify(reversal.event_body),reversal.canonical_hash,deviceId,reversal.event_id]));
    const [task]=await c.execute('SELECT snapshot,business_date FROM tasks WHERE id=?',[target.id]);const snapshot=parseJson(task.snapshot);
    await sqlCase('snapshot-hash',()=>c.execute('UPDATE tasks SET snapshot=? WHERE id=?',[JSON.stringify({...snapshot,snapshotHash:'0'.repeat(64)}),target.id]),()=>c.execute('UPDATE tasks SET snapshot=? WHERE id=?',[JSON.stringify(snapshot),target.id]));
    await sqlCase('applied-effects',()=>c.execute('UPDATE task_items SET applied_qty=1 WHERE task_id=? AND product_id=?',[target.id,'a'.repeat(32)]),()=>c.execute('UPDATE task_items SET applied_qty=2 WHERE task_id=? AND product_id=?',[target.id,'a'.repeat(32)]));
    await sqlCase('daily-report-count',()=>c.execute('UPDATE report_daily SET item_count=item_count+1 WHERE run_id=?',[runId]),()=>c.execute('UPDATE report_daily SET item_count=item_count-1 WHERE run_id=?',[runId]));
    await sqlCase('product-report-count',()=>c.execute('UPDATE report_daily_product SET quantity=quantity+1 WHERE run_id=? AND product_id=?',[runId,'a'.repeat(32)]),()=>c.execute('UPDATE report_daily_product SET quantity=quantity-1 WHERE run_id=? AND product_id=?',[runId,'a'.repeat(32)]));
    const [day]=await c.execute('SELECT * FROM report_daily WHERE run_id=?',[runId]);
    await sqlCase('missing-report-day',()=>c.execute('DELETE FROM report_daily WHERE run_id=?',[runId]),()=>restore('report_daily',day));
    await sqlCase('extra-zero-report-day',()=>c.execute('INSERT INTO report_daily VALUES(?,?,0,0,?)',[runId,'2000-01-01',now()]),()=>c.execute('DELETE FROM report_daily WHERE run_id=? AND business_date=?',[runId,'2000-01-01']));
    await sqlCase('extra-zero-product-report',()=>c.execute('INSERT INTO report_daily_product VALUES(?,?,?,?,?)',[runId,task.business_date,'f'.repeat(32),0,now()]),()=>c.execute('DELETE FROM report_daily_product WHERE run_id=? AND business_date=? AND product_id=?',[runId,task.business_date,'f'.repeat(32)]));
    const [job]=await c.execute('SELECT id FROM outbox_jobs WHERE run_id=? LIMIT 1',[runId]);
    await sqlCase('undrained-outbox',()=>c.execute("UPDATE outbox_jobs SET status='PENDING' WHERE id=?",[job.id]),()=>c.execute("UPDATE outbox_jobs SET status='DONE' WHERE id=?",[job.id]));
    await sqlCase('source-not-done',()=>c.execute("UPDATE source_checkpoints SET status='RUNNING' WHERE run_id=?",[runId]),()=>c.execute("UPDATE source_checkpoints SET status='DONE' WHERE run_id=?",[runId]));
    await sourceCase('csv-changed-with-old-fingerprint',dir=>{const p=join(dir,files[0]),rows=load(p);rows[0].order_status='canceled';writeFileSync(p,csv(rows));},'FAIL',false);
    await sourceCase('missing-source-file',dir=>unlinkSync(join(dir,files[2])),'FAIL',false);
    await sourceCase('missing-source-order',dir=>{const p=join(dir,files[0]);writeFileSync(p,csv(load(p).slice(1)));},'FAIL');
    await sourceCase('missing-source-item',dir=>{const p=join(dir,files[1]);writeFileSync(p,csv(load(p).slice(1)));},'FAIL');
    for(const [name,file] of [['identical-duplicate-order',files[0]],['identical-duplicate-product',files[2]],['identical-duplicate-seller',files[3]]])await sourceCase(name,dir=>{const p=join(dir,file),rows=load(p);rows.push({...rows[0]});writeFileSync(p,csv(rows));},'PASS');
    await sourceCase('conflicting-order-hidden-by-last-row',dir=>{const p=join(dir,files[0]),rows=load(p);rows.unshift({...rows[0],order_status:'canceled'});writeFileSync(p,csv(rows));},'NEW_SOURCE_CHECK');
    await sourceCase('conflicting-product-hidden-by-last-row',dir=>{const p=join(dir,files[2]),rows=load(p);rows.unshift({...rows[0],product_category_name:'conflicting-synthetic'});writeFileSync(p,csv(rows));},'NEW_SOURCE_CHECK');
    await sourceCase('conflicting-seller-hidden-by-last-row',dir=>{const p=join(dir,files[3]),rows=load(p).map(r=>({...r,audit_note:'synthetic-original'}));rows.unshift({...rows[0],audit_note:'synthetic-conflict'});writeFileSync(p,csv(rows));},'NEW_SOURCE_CHECK');
    for(const file of files)await sourceCase('incorrect-row-count-'+file.replace('.csv',''),()=>{},'NEW_SOURCE_CHECK',true,m=>{m.files.find((f:any)=>f.fileName===file).rowCount++;});
    await sourceCase('duplicate-item',dir=>{const p=join(dir,files[1]),rows=load(p);rows.push({...rows[0]});writeFileSync(p,csv(rows));},'FAIL');
    compare('normal-after-all-restorations','PASS');saveResults();
  }catch(error){if(process.env.AUDIT_CASE_REPORT)writeFileSync(process.env.AUDIT_CASE_REPORT,JSON.stringify({status:'FAIL',scope:'Isolated SYNTHETIC fixtures only',completedCases:results,errorType:(error as Error).name,errorMessage:(error as Error).message},null,2)+'\n');throw error;}
  finally{source.close();prepared.close();await db.close(true);}
});
