import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync,existsSync,mkdtempSync,mkdirSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('clean fixture bootstrap preserves tracked reference manifest and is repeatable',()=>{
  const root=mkdtempSync(tmpdir()+'/logistics-bootstrap-');
  mkdirSync(root+'/tools');mkdirSync(root+'/manifests');
  for(const path of ['Makefile','.env.example','manifests/fixture.json','tools/init-env.py','tools/fixture-env.py','tools/make-fixture.py','tools/prepare-data.py'])copyFileSync(path,root+'/'+path);
  const reference=readFileSync(root+'/manifests/fixture.json');
  const first=spawnSync('make',['fixture'],{cwd:root,encoding:'utf8'});
  assert.equal(first.status,0,first.stdout+first.stderr);
  assert(existsSync(root+'/data/prepared/fixture.sqlite'));
  const generated=readFileSync(root+'/data/prepared/fixture-manifest.json');
  assert.deepEqual(readFileSync(root+'/manifests/fixture.json'),reference);
  const second=spawnSync('make',['fixture'],{cwd:root,encoding:'utf8'});
  assert.equal(second.status,0,second.stdout+second.stderr);
  assert.deepEqual(readFileSync(root+'/data/prepared/fixture-manifest.json'),generated);
  const manifest=JSON.parse(generated.toString());
  assert.equal(manifest.synthetic,true);
  assert.equal(manifest.downloadedAt,null);
  assert.equal(manifest.files.find((f:any)=>f.fileName==='olist_order_items_dataset.csv').distinctKeyCount,30);
  const index=new DatabaseSync(root+'/data/prepared/fixture.sqlite',{readOnly:true});
  assert.equal((index.prepare("SELECT COUNT(*) n FROM items i WHERE NOT EXISTS(SELECT 1 FROM orders o WHERE o.source_key=i.order_id)").get() as any).n,0);
  // This full-source reconciliation must use a key lookup, not scan every order per item.
  const plan=index.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM items i WHERE NOT EXISTS(SELECT 1 FROM orders o WHERE o.source_key=i.order_id)').all() as any[];
  assert(plan.some(p=>/SEARCH o .*source_key/.test(p.detail)),JSON.stringify(plan));index.close();
});
