/** Wait for the existing actual-data run, then verify F2 -> F1 -> final reconciliation. */
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { connectDb,connection } from '../src/server/db.js';
import { ingestionStatus } from '../src/ingestion/ingest.js';
import { drained } from '../src/verification/drain.js';
const input=new DatabaseSync(process.env.PREPARED_DB!,{readOnly:true});
const manifest=JSON.parse((input.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);input.close();
if(manifest.synthetic||manifest.datasetVersion!=='olist-v2')throw new Error('Actual Olist input required');
const runId=process.env.DATASET_RUN_ID!,db=await connectDb();mkdirSync('reports',{recursive:true});
const path='reports/actual-run-'+runId+'.json';
const status:any={datasetRunId:runId,input:'ACTUAL_OLIST_V2',actions:'SIMULATED_SOFTWARE_WAREHOUSE',hardware:'BLOCKED',status:'RUNNING',startedAt:new Date().toISOString(),T28:'NOT_RUN',T27:'NOT_RUN',finalReconciliation:'NOT_RUN'};
const save=()=>writeFileSync(path,JSON.stringify({...status,updatedAt:new Date().toISOString()},null,2)+'\n');
const execute=(script:string)=>new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',script],{env:process.env,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(script+' failed: '+(signal||code))));
});
try{
  save();const deadline=Date.now()+6*3600*1000;
  for(;;){
    const {cursor,...ingestion}=await ingestionStatus(db,runId);
    const jobs=await connection(db).execute('SELECT status,COUNT(*) n FROM outbox_jobs WHERE run_id=? GROUP BY status',[runId]);
    status.progress={ingestion,jobs};save();console.log(JSON.stringify(status.progress));
    if(drained(ingestion.status,jobs))break;
    if(Date.now()>deadline)throw new Error('Run wait deadline exceeded; source and checkpoint retained');
    await new Promise(r=>setTimeout(r,30000));
  }
  await execute('tools/reconcile.ts');status.T28='PASS';save();
  await execute('tools/replay-actual.ts');status.T27='PASS';save();
  await execute('tools/reconcile.ts');status.finalReconciliation='PASS';
  status.status='PASS';status.completedAt=new Date().toISOString();
  status.reconciliation=JSON.parse(readFileSync('reports/reconciliation-'+runId+'.json','utf8')).status;
  save();console.log(JSON.stringify(status));
}catch(error:any){status.status='FAIL';status.error=error.message;save();throw error;}
finally{await db.close(true);}
