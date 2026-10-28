import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneShotCamera,type CameraControls } from '../web/camera.js';
const latch=()=>{let resolve!:(controls:CameraControls)=>void;const promise=new Promise<CameraControls>(r=>{resolve=r;});return {promise,resolve};};

test('T08 software camera session ignores old frames and permission results after task switch',async()=>{
  const camera=new OneShotCamera(),pending=latch(),seen:string[]=[];let oldFrame!:(text:string,c:CameraControls)=>void,newFrame!:(text:string,c:CameraControls)=>void,oldStopped=0,newStopped=0,ended=0;
  const old={stop(){oldStopped++;}},current={stop(){newStopped++;}};
  const first=camera.read('task-A',receive=>{oldFrame=receive;return pending.promise;},(id,text)=>seen.push(id+':'+text),()=>ended++);
  camera.stop();await camera.read('task-B',async receive=>{newFrame=receive;return current;},(id,text)=>seen.push(id+':'+text),()=>ended++);
  oldFrame('stale',old);pending.resolve(old);await first;
  assert.deepEqual(seen,[]);assert(oldStopped>=1);assert.equal(newStopped,0);assert.equal(ended,0);
  newFrame('product',current);newFrame('duplicate-frame',current);
  assert.deepEqual(seen,['task-B:product']);assert.equal(ended,1);assert(newStopped>=1);
});
test('T08 software camera stop during permission prompt cancels the late stream',async()=>{
  const camera=new OneShotCamera(),pending=latch();let receive!:(text:string,c:CameraControls)=>void,stops=0,scans=0;
  const controls={stop(){stops++;}};
  const read=camera.read('task-A',r=>{receive=r;return pending.promise;},()=>scans++,()=>{});
  camera.stop();pending.resolve(controls);await read;receive('late',controls);
  assert.equal(scans,0);assert(stops>=1);
});
test('T08 synchronous decode callback is consumed once; active startup errors surface',async()=>{
  const camera=new OneShotCamera();let scans=0;const c={stop(){}};
  await camera.read('task-A',async receive=>{receive('first',c);receive('second',c);return c;},()=>scans++,()=>{});
  assert.equal(scans,1);
  await assert.rejects(camera.read('task-A',async()=>{throw new Error('camera denied');},()=>{},()=>{}),/camera denied/);
});
