/** Read-only, row-streamed content identity of exactly the business tables used by the auditor. */
import mysql from 'mysql2';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const run=process.env.DATASET_RUN_ID!;
const native=mysql.createConnection({host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3307),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,dateStrings:true});
const db=native.promise();
const tables:Record<string,string>={dataset_runs:'x.id=?',dataset_scenarios:'x.run_id=?',source_checkpoints:'x.run_id=?',products:'x.run_id=?',sellers:'x.run_id=?',raw_orders:'x.run_id=?',orders:'x.run_id=?',tasks:'x.run_id=?',outbox_jobs:'x.run_id=?',report_daily:'x.run_id=?',report_daily_product:'x.run_id=?',
  order_items:'EXISTS(SELECT 1 FROM orders o WHERE o.id=x.order_id AND o.run_id=?)',
  task_items:'EXISTS(SELECT 1 FROM tasks t WHERE t.id=x.task_id AND t.run_id=?)',
  task_scans:'EXISTS(SELECT 1 FROM tasks t WHERE t.id=x.task_id AND t.run_id=?)',
  device_events:'EXISTS(SELECT 1 FROM tasks t WHERE t.id=x.task_id AND t.run_id=?)',schema_migrations:'1=1'};
try{
  await db.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const result:Record<string,any>={};
  for(const [table,where] of Object.entries(tables)){
    const [columns]=await db.query<any[]>('SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? ORDER BY ORDINAL_POSITION',[table,'PRIMARY']);
    if(!columns.length)throw Error('Fingerprint requires primary key: '+table);
    const order=columns.map(c=>'x.`'+String(c.COLUMN_NAME).replaceAll('`','``')+'`').join(',');
    const hash=createHash('sha256');let rows=0;
    for await(const row of native.query('SELECT x.* FROM `'+table+'` x WHERE '+where+' ORDER BY '+order,table==='schema_migrations'?[]:[run]).stream({highWaterMark:16})){
      hash.update(canonical(row)+'\n');rows++;
    }
    result[table]={rows,sha256:hash.digest('hex')};
  }
  await db.query('ROLLBACK');
  const contentSha256=createHash('sha256').update(canonical(result)).digest('hex');
  const report={at:new Date().toISOString(),scope:'Read-only consistent snapshot; validator business tables only, excludes mutable device heartbeats',datasetRunId:run,database:process.env.MYSQL_DATABASE,contentSha256,tables:result};
  if(process.env.FINGERPRINT_OUTPUT)writeFileSync(process.env.FINGERPRINT_OUTPUT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report));
}finally{await db.end();}
