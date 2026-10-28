import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { connectDb,connection,transaction } from '../../src/server/db.js';
import { Source } from '../../src/source/source.js';
import { importMasters } from '../../src/ingestion/masters.js';
import { ingestPage } from '../../src/ingestion/ingest.js';
import { processJob } from '../../src/jobs/jobs.js';
import { now } from '../../src/shared/contracts.js';

test('T28 both auditors reject isolated raw hash and normalized quantity corruption',async()=>{
  const db=await connectDb(),runId=randomUUID(),path='data/prepared/fixture.sqlite',out=mkdtempSync(tmpdir()+'/logistics-independent-');
  const source=new Source(path,runId),prepared=new DatabaseSync(path,{readOnly:true});
  writeFileSync(out+'/manifest.json',JSON.stringify(source.manifest));
  const check=(script:string)=>{
    const child=spawnSync(process.execPath,['--import','tsx','tools/'+script+'.ts'],{env:{...process.env,DATASET_RUN_ID:runId,PREPARED_DB:path,RAW_DIR:'data/fixtures',SOURCE_MANIFEST:out+'/manifest.json',RECONCILE_OUTPUT_DIR:out,AUDIT_OUTPUT:out+'/independent.json'},encoding:'utf8'});
    const file=script==='audit-source'?out+'/independent.json':out+'/reconciliation-'+runId+'.json';
    assert(existsSync(file),child.stderr);const report=JSON.parse(readFileSync(file,'utf8'));
    return {exit:child.status,report};
  };
  try{
    await transaction(db,async tx=>{
      await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?)',[runId,source.manifest.datasetVersion,JSON.stringify(source.manifest),'REGISTERED',now()]);
      await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?)',[runId,'olist',null,'PAUSED',now()]);
    });
    await importMasters(db,runId,prepared.prepare('SELECT * FROM products').iterate(),prepared.prepare('SELECT * FROM sellers').iterate());
    await ingestPage(db,runId,source.page(undefined,200,new Date('2030-01-01T00:00:00Z')),null);
    const c=connection(db);for(const j of await c.execute('SELECT id FROM outbox_jobs WHERE run_id=?',[runId]))await processJob(db,j.id);
    assert.equal(check('audit-source').exit,0);assert.equal(check('reconcile').exit,0);
    const [row]=await c.execute('SELECT r.id raw_id,r.payload_hash,o.id order_id FROM raw_orders r JOIN orders o ON o.raw_order_id=r.id WHERE r.run_id=? LIMIT 1',[runId]);
    await c.execute('UPDATE raw_orders SET payload_hash=? WHERE id=?',['0'.repeat(64),row.raw_id]);
    const hash=check('audit-source');assert.equal(hash.exit,1);assert.equal(hash.report.errors.RAW_CANONICAL_HASH,1);
    const legacy=check('reconcile');assert.equal(legacy.exit,1,'existing reconciler must not PASS an invalid immutable raw hash');assert(legacy.report.errors.includes('RAW_CANONICAL_HASH_MISMATCH'));
    await c.execute('UPDATE raw_orders SET payload_hash=? WHERE id=?',[row.payload_hash,row.raw_id]);
    await c.execute('UPDATE order_items SET required_qty=1 WHERE order_id=? AND product_id=?',[row.order_id,'a'.repeat(32)]);
    const quantities=check('audit-source');assert.equal(quantities.exit,1);assert.equal(quantities.report.errors.NORMALIZED_QUANTITIES,1);
    const saved=check('reconcile');assert.equal(saved.exit,1);assert(saved.report.errors.includes('NORMALIZED_SOURCE_QUANTITY'));
  }finally{prepared.close();source.close();await db.close(true);}
});
