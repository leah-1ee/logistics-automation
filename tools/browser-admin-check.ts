/** Verify actual UI mutations against persistent synthetic fixture, then process only its retried jobs. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { connectDb,connection } from '../src/server/db.js';
import { processJob } from '../src/jobs/jobs.js';
import { parseJson } from '../src/shared/contracts.js';
if(process.env.MYSQL_DATABASE!=='logistics_test')throw Error('Expected logistics_test');
const plan=JSON.parse(readFileSync(process.env.BROWSER_PLAN||'var/admin-ui-plan-final.json','utf8'));
if(plan.scope!=='SYNTHETIC_BROWSER_FIXTURE_NOT_OLIST')throw Error('Expected synthetic browser plan');
const db=await connectDb(),c=connection(db);
try{
  const [assigned]=await c.execute('SELECT * FROM tasks WHERE id=?',[plan.assignmentTaskId]);
  assert.equal(assigned.status,'ASSIGNED');assert.equal(assigned.device_id,plan.deviceId);assert.equal(assigned.assignment_version,1);
  const [audits]=await c.execute("SELECT SUM(action='ASSIGN') assignments,SUM(action='TASK_NOTE') notes FROM audit_logs WHERE target_id=?",[plan.assignmentTaskId]);
  assert.equal(Number(audits.assignments),1);assert.equal(Number(audits.notes),1);
  const [held]=await c.execute('SELECT o.status,o.revision,r.payload_hash FROM orders o JOIN raw_orders r ON r.id=o.raw_order_id WHERE o.id=?',[plan.holdOrderId]);
  assert.equal(held.payload_hash,plan.holdRawHash);assert.equal(held.revision,2);assert.equal(held.status,'READY');
  const corrected=await c.execute('SELECT product_id,required_qty FROM order_items WHERE order_id=?',[plan.holdOrderId]);
  assert.equal(corrected.length,1);assert.equal(corrected[0].product_id,'a'.repeat(32));assert.equal(corrected[0].required_qty,3);
  const [retry]=await c.execute('SELECT * FROM outbox_jobs WHERE id=?',[plan.transientJobId]);
  assert.equal(retry.status,'PENDING');assert.equal(retry.attempts,0);assert.equal(retry.error_code,null);
  const [permanent]=await c.execute('SELECT * FROM outbox_jobs WHERE id=?',[plan.permanentJobId]);
  assert.equal(permanent.status,'FAILED');assert.equal(permanent.attempts,1);assert.equal(permanent.error_code,'PERMANENT_INPUT_ERROR');
  const [before]=await c.execute('SELECT COUNT(*) n FROM tasks WHERE run_id=?',[plan.runId]);assert.equal(Number(before.n),51);
  const pending=await c.execute("SELECT id FROM outbox_jobs WHERE run_id=? AND status='PENDING'",[plan.runId]);assert.equal(pending.length,2);
  for(const j of pending){await processJob(db,j.id);await processJob(db,j.id);}
  const [after]=await c.execute('SELECT COUNT(*) n,COUNT(DISTINCT order_id) uniqueOrders FROM tasks WHERE run_id=?',[plan.runId]);
  assert.equal(Number(after.n),53);assert.equal(Number(after.uniqueOrders),53);
  const [daily]=await c.execute('SELECT task_count,item_count FROM report_daily WHERE run_id=? AND business_date=?',[plan.runId,plan.businessDate]);
  assert.equal(daily.task_count,1);assert.equal(daily.item_count,3);
  const [device]=await c.execute('SELECT last_report FROM devices WHERE id=?',[plan.deviceId]);assert.equal(parseJson(device.last_report).pendingCount,7);
  const result={status:'PASS',scope:'Direct DB checks after actual headless UI; SYNTHETIC fixture only',runId:plan.runId,
    assignments:1,notes:1,originalRawHashUnchanged:true,correctionRevision:2,correctedQty:3,
    transientRetryReset:true,permanentFailurePreserved:true,processedJobs:2,jobInvocations:4,tasksBefore:51,tasksAfter:53,uniqueTaskOrders:53,
    confirmedReportTasks:1,confirmedReportItems:3};
  writeFileSync(process.env.BROWSER_CHECK_REPORT||'reports/hardware-2026-10-28/admin-browser-db.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await db.close(true);}
