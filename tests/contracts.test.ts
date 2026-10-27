import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash, validate, snapshotHash, businessDate } from '../src/shared/contracts.js';
import { adminAuth } from '../src/server/auth.js';
const e = JSON.parse(readFileSync('docs/examples.json','utf8'));
test('S0 canonical known answers from preserved contract', () => {
  for (const event of e.events) { validate('DeviceEvent',event); assert.equal(hash(event),e.eventHashes[event.eventId]); }
  const snap = e.taskSnapshot || e.snapshot;
  if (snap) assert.equal(snapshotHash(snap),snap.snapshotHash);
  assert.equal(hash({b:1,a:'한글'}),hash({a:'한글',b:1}));
  assert.throws(()=>hash({a:undefined}));
});
test('S0 schema forbids unknown fields, non-unit quantities, bad times', () => {
  assert.throws(()=>validate('DeviceEvent',{...e.events[0],unexpected:true}));
  assert.throws(()=>validate('DeviceEvent',{...e.events[0],payload:{...e.events[0].payload,quantity:2}}));
  assert.throws(()=>validate('DeviceEvent',{...e.events[0],occurredAt:'2026-10-27T00:00:00'}));
});
test('S0 role authentication and server business timezone',()=>{
  process.env.ADMIN_TOKEN='a'.repeat(64);
  assert.equal(adminAuth('Bearer '+'a'.repeat(64)),'operator-01');
  assert.throws(()=>adminAuth(undefined)); assert.throws(()=>adminAuth('Bearer '+'d'.repeat(64)));
  assert.equal(businessDate('2026-10-26T16:00:00Z','Asia/Seoul'),'2026-10-27');
});
