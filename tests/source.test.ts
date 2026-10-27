import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Source } from '../src/source/source.js';
test('S1 source cursor is repeatable, bound to run, waits instead of false EOF',()=>{
  // Fresh temp output; fixture generation also runs on clean CI.
  if(!existsSync('data/fixtures/olist_orders_dataset.csv')) assert.equal(spawnSync('python3',['tools/make-fixture.py']).status,0);
  const path=`/tmp/logistics-source-${process.pid}.sqlite`,manifest=`/tmp/logistics-source-${process.pid}.json`;
  assert.equal(spawnSync('python3',['tools/prepare-data.py','--raw','data/fixtures','--out',path,'--manifest',manifest,'--synthetic']).status,0);
  const s=new Source(path,'11111111-1111-4111-8111-111111111111');
  try {
    const waiting=s.page(undefined,2,new Date('2026-10-26T00:00:00Z'));assert.equal(waiting.exhausted,false);assert.equal(waiting.items.length,0);
    const p=s.page(undefined,2,new Date('2026-10-28T00:00:00Z'));
    assert.deepEqual(s.page(undefined,2,new Date('2026-10-28T00:00:00Z')),p);
    assert.equal(p.items[0].items.length,3);
    assert.equal(s.page(p.nextCursor!,2,new Date('2026-10-28T00:00:00Z')).items.length,2);
    assert.throws(()=>s.page(p.nextCursor!,3));
    const other=new Source(path,'22222222-2222-4222-8222-222222222222');try{assert.throws(()=>other.page(p.nextCursor!,2));}finally{other.close();}
  }finally{s.close();}
});
