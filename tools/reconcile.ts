import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { connectDb,connection } from '../src/server/db.js';
import { parseJson } from '../src/shared/contracts.js';
const db=await connectDb(),runId=process.env.DATASET_RUN_ID!;
try{
  const c=connection(db),prepared=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
  const waitArg=process.argv.find(v=>v.startsWith('--wait-seconds='));
  const waitSeconds=waitArg?Number(waitArg.split('=')[1]):0;
  if(!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>600)throw new Error('wait-seconds must be 0..600');
  const deadline=Date.now()+waitSeconds*1000;
  while(Date.now()<deadline){const rows=await c.execute("SELECT status,COUNT(*) n FROM outbox_jobs WHERE run_id=? AND status<>'DONE' GROUP BY status",[runId]);if(!rows.length||rows.some((r:any)=>r.status==='FAILED'))break;await new Promise(r=>setTimeout(r,500));}
  const [run]=await c.execute('SELECT * FROM dataset_runs WHERE id=?',[runId]);if(!run)throw new Error('Unknown run');
  const manifest=parseJson(run.manifest);
  const expected=Number((prepared.prepare('SELECT COUNT(DISTINCT source_key) n FROM orders').get() as any).n);
  const [raw]=await c.execute('SELECT COUNT(*) n FROM raw_orders WHERE run_id=?',[runId]);
  const statuses=await c.execute('SELECT status,COUNT(*) n FROM orders WHERE run_id=? GROUP BY status',[runId]);
  const counts=Object.fromEntries(statuses.map((r:any)=>[r.status,Number(r.n)]));
  const classificationReasons=await c.execute("SELECT o.status,r.reason,COUNT(*) recordCount FROM orders o JOIN JSON_TABLE(o.hold_reasons,'$[*]' COLUMNS(reason VARCHAR(128) PATH '$')) r ON TRUE WHERE o.run_id=? GROUP BY o.status,r.reason ORDER BY o.status,r.reason",[runId]);
  const qualityFlags=await c.execute("SELECT f.flag,COUNT(*) recordCount FROM orders o JOIN JSON_TABLE(o.quality_flags,'$[*]' COLUMNS(flag VARCHAR(128) PATH '$')) f ON TRUE WHERE o.run_id=? GROUP BY f.flag ORDER BY f.flag",[runId]);
  const [tasks]=await c.execute('SELECT COUNT(*) n FROM tasks WHERE run_id=?',[runId]);
  const [unfinished]=await c.execute("SELECT COUNT(*) n FROM outbox_jobs WHERE run_id=? AND status<>'DONE'",[runId]);
  const [master]=await c.execute('SELECT COUNT(*) n FROM products WHERE run_id=?',[runId]);
  const productExpected=Number((prepared.prepare('SELECT COUNT(*) n FROM products').get() as any).n);
  const errors:string[]=[];
  if(Number(raw.n)!==expected)errors.push('RAW_COUNT_MISMATCH');
  if(Object.values(counts).reduce((a:number,b:any)=>a+Number(b),0)!==Number(raw.n))errors.push('CLASSIFICATION_MISMATCH');
  if(Number(tasks.n)!==(counts.READY||0)+(counts.TASK_CREATED||0))errors.push('TASK_COUNT_MISMATCH_OR_NOT_DRAINED');
  if(Number(unfinished.n))errors.push('OUTBOX_NOT_DRAINED');
  if(Number(master.n)!==productExpected)errors.push('PRODUCT_MASTER_MISMATCH');
  let after='';let quantityChecks=0;
  for(;;){
    const rows=await c.execute('SELECT t.id,t.status,o.revision,r.payload FROM tasks t JOIN orders o ON o.id=t.order_id JOIN raw_orders r ON r.id=o.raw_order_id WHERE t.run_id=? AND t.id>? ORDER BY t.id LIMIT 200',[runId,after]);if(!rows.length)break;
    for(const task of rows){
      const source=parseJson(task.payload),expectedQty=new Map<string,number>();for(const i of source.items)expectedQty.set(i.productId,(expectedQty.get(i.productId)||0)+1);
      const items=await c.execute('SELECT * FROM task_items WHERE task_id=?',[task.id]);
      for(const item of items){quantityChecks++;if(task.revision===1&&item.required_qty!==expectedQty.get(item.product_id))errors.push('SOURCE_ROW_QUANTITY:'+task.id);
        const [scans]=await c.execute('SELECT COUNT(*) n FROM task_scans WHERE task_id=? AND product_id=? AND reversed_by_event_id IS NULL',[task.id,item.product_id]);
        if(Number(scans.n)!==item.applied_qty)errors.push('NET_SCAN_QUANTITY:'+task.id);
        if(task.status==='CONFIRMED'&&item.applied_qty!==item.required_qty)errors.push('BAD_CONFIRMED:'+task.id);
      }
      if(task.revision===1&&items.length!==expectedQty.size)errors.push('SOURCE_PRODUCT_SET:'+task.id);
    }after=rows[rows.length-1].id;
  }
  const reports=await c.execute('SELECT * FROM report_daily WHERE run_id=?',[runId]);
  for(const r of reports){const [actual]=await c.execute("SELECT COUNT(DISTINCT t.id) tasks,COALESCE(SUM(i.applied_qty),0) items FROM tasks t JOIN task_items i ON i.task_id=t.id WHERE t.run_id=? AND t.business_date=? AND t.status='CONFIRMED'",[runId,r.business_date]);if(Number(actual.tasks)!==r.task_count||Number(actual.items)!==r.item_count)errors.push('REPORT_MISMATCH:'+r.business_date);}
  const report={at:new Date().toISOString(),datasetRunId:runId,synthetic:!!manifest.synthetic,manifest,expectedRawOrders:expected,rawOrders:Number(raw.n),classification:counts,classificationReasons,qualityFlags,tasks:Number(tasks.n),unfinishedJobs:Number(unfinished.n),products:Number(master.n),quantityChecks,orphanItemRows:JSON.parse((prepared.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value).orphanItemRows,status:errors.length?'FAIL':'PASS',errors};
  prepared.close();const output=JSON.stringify(report,null,2)+'\n';writeFileSync('reports/reconciliation-'+runId+'-'+report.at.replace(/[:.]/g,'-')+'.json',output);writeFileSync('reports/reconciliation-'+runId+'.json',output);console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
}finally{await db.close(true);}
