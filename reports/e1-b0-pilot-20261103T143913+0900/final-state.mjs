// One read-only final snapshot of this experiment only; never starts a workload.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]);
if(!root.startsWith('/home/leah/e1-lab/'))throw Error('Experiment root required');
const m=JSON.parse(readFileSync(root+'/manifest.json'));
const env=Object.fromEntries(readFileSync(root+'/runtime/app.env','utf8').trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
if(!/^e1b0_[a-z0-9_]+$/.test(env.MYSQL_DATABASE)||env.MYSQL_DATABASE!==m.database||env.DATASET_RUN_ID!==m.runId)throw Error('Experiment target mismatch');
const mysql=createRequire(resolve('package.json'))('mysql2');
const db=mysql.createConnection({host:'127.0.0.1',port:13307,user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE,dateStrings:true}).promise();
const query=async(sql,p=[])=>{const [rows]=await db.query(sql,p);return rows;};
try{
 const [target]=await query('SELECT DATABASE() db');if(target.db!==m.database)throw Error('Wrong DB');
 await query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');const run=m.runId;
 const classifications=await query('SELECT status,COUNT(*) count FROM orders WHERE run_id=? GROUP BY status',[run]);
 const jobs=await query('SELECT status,COUNT(*) count FROM outbox_jobs WHERE run_id=? GROUP BY status',[run]);
 const [checkpoint]=await query('SELECT status FROM source_checkpoints WHERE run_id=?',[run]);
 const [counts]=await query(`SELECT (SELECT COUNT(*) FROM raw_orders WHERE run_id=?) rawCount,
 (SELECT COUNT(*) FROM tasks WHERE run_id=?) taskCount,
 (SELECT COUNT(*) FROM tasks WHERE run_id=? AND (status<>'CREATED' OR device_id IS NOT NULL OR assignment_version<>0 OR confirmed_at IS NOT NULL)) badTasks,
 (SELECT COUNT(*) FROM device_events) eventCount,(SELECT COUNT(*) FROM report_daily WHERE run_id=?) reports,
 (SELECT COALESCE(SUM(i.required_qty),0) FROM task_items i JOIN tasks t ON t.id=i.task_id WHERE t.run_id=?) requiredQty,
 (SELECT COALESCE(SUM(i.applied_qty),0) FROM task_items i JOIN tasks t ON t.id=i.task_id WHERE t.run_id=?) appliedQty,
 (SELECT COUNT(*) FROM products WHERE run_id=?) products,(SELECT COUNT(*) FROM sellers WHERE run_id=?) sellers`,[run,run,run,run,run,run,run,run]);
 const rawIds=(await query('SELECT id FROM raw_orders WHERE run_id=?',[run])).map(r=>r.id);
 const taskIds=(await query('SELECT id FROM tasks WHERE run_id=?',[run])).map(r=>r.id);
 const jobIds=(await query('SELECT id FROM outbox_jobs WHERE run_id=?',[run])).map(r=>r.id);
 const attempts=await query('SELECT a.error_code errorCode,COUNT(*) count FROM job_attempts a JOIN outbox_jobs j ON j.id=a.job_id WHERE j.run_id=? GROUP BY a.error_code',[run]);
 const [variables]=await query('SELECT VERSION() version,@@innodb_buffer_pool_size bufferPoolBytes,@@innodb_flush_log_at_trx_commit flushCommit,@@sync_binlog syncBinlog');
 const result={state:{wallTime:new Date().toISOString(),checkpoint:checkpoint.status,classifications,jobs,counts,queue:'NOT_CHECKED_AFTER_STOP',scope:'Frozen experiment DB, read-only consistent snapshot after pilot; not a replay'},variables,attempts,rawIds,taskIds,jobIds};
 writeFileSync(root+'/output/final-state-readonly.json',JSON.stringify(result)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'PASS',state:result.state,variables,attempts}));
}catch(e){console.error(JSON.stringify({status:'FAIL',reason:'FINAL_READONLY_SNAPSHOT_FAILED'}));process.exitCode=1;}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
