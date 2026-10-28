import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drained } from '../src/verification/drain.js';
test('actual verification waits for both source EOF and durable job completion',()=>{
  assert.equal(drained('RUNNING',[]),false);
  assert.equal(drained('RUNNING',[{status:'DONE'}]),false);
  assert.equal(drained('DONE',[{status:'PENDING'}]),false);
  assert.equal(drained('DONE',[{status:'DISPATCHED'}]),false);
  assert.equal(drained('DONE',[{status:'DONE'}]),true);
  assert.equal(drained('DONE',[]),true);
  assert.throws(()=>drained('FAILED',[{status:'DONE'}]));
  assert.throws(()=>drained('DONE',[{status:'FAILED'}]));
});
