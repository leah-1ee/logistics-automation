import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/ingestion/normalize.js';
const raw=JSON.parse(readFileSync('docs/examples.json','utf8')).sourcePage.items[0];
const products=new Set<string>(raw.items.map((i:any)=>i.productId));const sellers=new Set<string>(raw.items.map((i:any)=>i.sellerId));
test('T03/T04 fixture classification, row counts and missing-parent precedence',()=>{
  const n=normalize(raw,products,sellers);assert.equal(n.status,'READY');assert.deepEqual(n.items.map(i=>i.requiredQty),[2,1]);
  const bad=structuredClone(raw);bad.sourceStatus='canceled';bad.items[0].sellerId='second';
  const ns=normalize(bad,products,new Set([...sellers,'second']));assert.equal(ns.status,'UNSUPPORTED');assert(ns.holdReasons.includes('MULTIPLE_SELLERS'));
  const held=normalize(bad,new Set(),sellers);assert.equal(held.status,'DATA_HOLD');assert(held.holdReasons.includes('MISSING_PRODUCT'));
  assert.equal(normalize({...raw,sourceApprovedAtRaw:null},products,sellers).status,'DATA_HOLD');
  const sparse=structuredClone(raw);sparse.items[2].sourceItemId=50;assert.equal(normalize(sparse,products,sellers).items[1].requiredQty,1);
});
