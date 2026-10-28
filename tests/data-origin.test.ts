import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,copyFileSync,existsSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('generated CSVs cannot be prepared as actual Olist; explicit synthetic preparation works',()=>{
  const root=mkdtempSync(tmpdir()+'/logistics-origin-');mkdirSync(root+'/manifests');
  copyFileSync('manifests/olist-v2.json',root+'/manifests/olist-v2.json');
  assert.equal(spawnSync('python3',[resolve('tools/make-fixture.py')],{cwd:root}).status,0);
  const args=[resolve('tools/prepare-data.py'),'--raw',root+'/data/fixtures','--out',root+'/prepared.sqlite','--manifest',root+'/prepared.json'];
  const wrong=spawnSync('python3',[...args,'--downloaded-at','2026-10-28T00:00:00Z'],{cwd:root,encoding:'utf8'});
  assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/Actual Olist v2 source hash mismatch/);assert.equal(existsSync(root+'/prepared.sqlite'),false);
  const synthetic=spawnSync('python3',[...args,'--synthetic'],{cwd:root,encoding:'utf8'});assert.equal(synthetic.status,0,synthetic.stderr);
  assert.equal(JSON.parse(readFileSync(root+'/prepared.json','utf8')).synthetic,true);
});
