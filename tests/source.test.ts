import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Source } from '../src/source/source.js';
import { DatabaseSync } from 'node:sqlite';
import { normalize } from '../src/ingestion/normalize.js';
test('S1 source cursor is repeatable, bound to run, waits instead of false EOF',()=>{
  // Fresh temp output; fixture generation also runs on clean CI.
  if(!existsSync('data/fixtures/olist_orders_dataset.csv')) assert.equal(spawnSync('python3',['tools/make-fixture.py']).status,0);
  const path=`/tmp/logistics-source-${process.pid}.sqlite`,manifest=`/tmp/logistics-source-${process.pid}.json`;
  assert.equal(spawnSync('python3',['tools/prepare-data.py','--raw','data/fixtures','--out',path,'--manifest',manifest,'--synthetic']).status,0);
  const s=new Source(path,'11111111-1111-4111-8111-111111111111');
  try {
    const f1=spawnSync(process.execPath,['--import','tsx','tools/replay-actual.ts'],{env:{...process.env,PREPARED_DB:path},encoding:'utf8'});
    assert.equal(f1.status,2);assert.match(f1.stderr,/synthetic input refused/);
    const waiting=s.page(undefined,2,new Date('2026-10-26T00:00:00Z'));assert.equal(waiting.exhausted,false);assert.equal(waiting.items.length,0);
    const p=s.page(undefined,2,new Date('2026-10-28T00:00:00Z'));
    assert.deepEqual(s.page(undefined,2,new Date('2026-10-28T00:00:00Z')),p);
    assert.equal(p.items[0].items.length,3);
    assert.equal(s.page(p.nextCursor!,2,new Date('2026-10-28T00:00:00Z')).items.length,2);
    assert.throws(()=>s.page(p.nextCursor!,3));
    const other=new Source(path,'22222222-2222-4222-8222-222222222222');try{assert.throws(()=>other.page(p.nextCursor!,2));}finally{other.close();}
    const edit=new DatabaseSync(path);
    const product=JSON.parse((edit.prepare('SELECT payload FROM products WHERE id=?').get('a'.repeat(32)) as any).payload);
    product.product_weight_g='-1';product.product_length_cm='';
    edit.prepare('UPDATE products SET payload=? WHERE id=?').run(JSON.stringify(product),'a'.repeat(32));edit.close();
    const flagged=s.page(undefined,2,new Date('2026-10-28T00:00:00Z')).items[0];
    assert(flagged.qualityFlags.includes('PRODUCT_WEIGHT_G_INVALID'));assert(flagged.qualityFlags.includes('PRODUCT_LENGTH_CM_MISSING'));
    const n=normalize(flagged,new Set(['a'.repeat(32),'b'.repeat(32)]),new Set(['d'.repeat(32)]));
    assert.equal(n.status,'READY');assert(n.qualityFlags.includes('PRODUCT_WEIGHT_G_INVALID'));
  }finally{s.close();}
});
