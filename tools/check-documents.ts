import { readFileSync, existsSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { contract, validate, hash, snapshotHash } from '../src/shared/contracts.js';
const examples = JSON.parse(readFileSync('docs/examples.json', 'utf8'));
for (const [i, event] of examples.events.entries()) {
  validate('DeviceEvent', event); assert.equal(hash(event), examples.eventHashes[event.eventId], `event ${i}`);
}
for (const [key, schema] of Object.entries({sourcePage:'SourcePage', taskSnapshot:'TaskSnapshot', eventBatch:'EventBatch', appliedResult:'EventResult', duplicateResult:'EventResult', sequenceGapResult:'EventResult', reuseConflictResult:'EventResult', batchResult:'BatchResult'})) {
  if (examples[key]) validate(schema, examples[key]);
}
const snap = examples.taskSnapshot || examples.snapshot;
if (snap) { validate('TaskSnapshot', snap); assert.equal(snapshotHash(snap), snap.snapshotHash); }
function checkRefs(value:any):void {
  if(!value||typeof value!=='object')return;
  if(value.$ref){assert(value.$ref.startsWith('#/'));let target=contract;for(const part of value.$ref.slice(2).split('/'))target=target?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];assert(target,value.$ref);}
  for(const v of Object.values(value))checkRefs(v);
}
checkRefs(contract);
let links = 0;
for (const file of readdirSync('docs').filter(f => f.endsWith('.md'))) {
  for (const match of readFileSync('docs/'+file,'utf8').matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (!/^https?:/.test(match[1])) { assert(existsSync('docs/'+match[1]), match[1]); links++; }
  }
}
console.log(JSON.stringify({scope:'document contracts only; not product verification', operations:Object.values(contract.paths).reduce((n:number,p:any)=>n+Object.keys(p).length,0), schemas:Object.keys(contract.components.schemas).length, events:examples.events.length, links}));
