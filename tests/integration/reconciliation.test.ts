import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { connectDb,connection,transaction } from '../../src/server/db.js';
import { Source } from '../../src/source/source.js';
import { importMasters } from '../../src/ingestion/masters.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { processJob } from '../../src/jobs/jobs.js';
import { now,hash,parseJson } from '../../src/shared/contracts.js';
test('full reconciliation independently checks original rows and rejects coherent server corruption',async()=>{
  const db=await connectDb(),runId=randomUUID(),path='data/prepared/fixture.sqlite',out=mkdtempSync(tmpdir()+'/logistics-reconcile-');
  const source=new Source(path,runId),prepared=new DatabaseSync(path,{readOnly:true});
  const check=()=>{
    const child=spawnSync(process.execPath,['--import','tsx','tools/reconcile.ts'],{env:{...process.env,DATASET_RUN_ID:runId,PREPARED_DB:path,RAW_DIR:'data/fixtures',RECONCILE_OUTPUT_DIR:out},encoding:'utf8'});
    assert(existsReport(),child.stderr);return {exit:child.status,report:JSON.parse(readFileSync(out+'/reconciliation-'+runId+'.json','utf8'))};
  };
  const existsReport=()=>{try{readFileSync(out+'/reconciliation-'+runId+'.json');return true;}catch{return false;}};
  try{
    await transaction(db,async tx=>{
      await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?)',[runId,source.manifest.datasetVersion,JSON.stringify(source.manifest),'REGISTERED',now()]);
      await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?)',[runId,'olist',null,'PAUSED',now()]);
    });
    await importMasters(db,runId,prepared.prepare('SELECT * FROM products').iterate(),prepared.prepare('SELECT * FROM sellers').iterate());
    await ingestPage(db,runId,source.page(undefined,200,new Date('2030-01-01T00:00:00Z')),null);
    const c=connection(db);for(const j of await c.execute('SELECT id FROM outbox_jobs WHERE run_id=?',[runId]))await processJob(db,j.id);
    const good=check();assert.equal(good.exit,0);assert.equal(good.report.rawFileHashesVerified,4);assert.equal(good.report.orderChecks,10);assert.equal(good.report.taskChecks,10);
    const [row]=await c.execute('SELECT t.id,o.id order_id,r.id raw_id,r.payload FROM tasks t JOIN orders o ON o.id=t.order_id JOIN raw_orders r ON r.id=o.raw_order_id WHERE t.run_id=? LIMIT 1',[runId]);
    const body=parseJson(row.payload);body.items=body.items.slice(1);
    await transaction(db,async tx=>{
      await tx.execute('UPDATE raw_orders SET payload=?,payload_hash=? WHERE id=?',[JSON.stringify(body),hash(body),row.raw_id]);
      await tx.execute('UPDATE order_items SET required_qty=1 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]);
      await tx.execute('UPDATE task_items SET required_qty=1 WHERE task_id=? AND product_id=?',[row.id,'a'.repeat(32)]);
    });
    const bad=check();assert.equal(bad.exit,1);assert(bad.report.errors.includes('ORIGINAL_ORDER_CONTENT_MISMATCH'));assert(bad.report.errors.includes('SOURCE_ROW_QUANTITY'));
    await c.execute('UPDATE products SET attributes=? WHERE run_id=? AND product_id=?',['{}',runId,'a'.repeat(32)]);
    const master=check();assert.equal(master.exit,1);assert(master.report.errors.includes('PRODUCT_MASTER_CONTENT_MISMATCH'));
  }finally{prepared.close();source.close();await db.close(true);}
});
