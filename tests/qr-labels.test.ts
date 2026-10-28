import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
test('task QR labels contain only selected products and reject a different dataset run',async()=>{
  const root=mkdtempSync(tmpdir()+'/logistics-labels-'),runId='11111111-1111-4111-8111-111111111111',taskId='33333333-3333-4333-8333-333333333333';
  assert.equal(spawnSync('python3',[resolve('tools/make-fixture.py')],{cwd:root}).status,0);
  assert.equal(spawnSync('python3',[resolve('tools/prepare-data.py'),'--raw',root+'/data/fixtures','--out',root+'/p.sqlite','--manifest',root+'/m.json','--synthetic'],{cwd:root}).status,0);
  let selectedRun=runId;
  const server=createServer((req,res)=>{assert.equal(req.url,'/api/v1/tasks/'+taskId);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({task:{datasetRunId:selectedRun,items:[{productId:'b'.repeat(32),requiredQty:2}]}}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const run=async()=>{const child=spawn(process.execPath,['--import','tsx','tools/qr-labels.ts','--task-id',taskId],{env:{...process.env,PREPARED_DB:root+'/p.sqlite',DATASET_RUN_ID:runId,SERVER_URL:'http://127.0.0.1:'+(server.address() as any).port,ADMIN_TOKEN:'e'.repeat(64),QR_OUTPUT_DIR:root},stdio:'ignore'});return (await once(child,'exit'))[0];};
  try{
    assert.equal(await run(),0);const path=root+'/qr-labels-'+taskId+'.html',html=readFileSync(path,'utf8');
    assert(html.includes('b'.repeat(32)));assert(!html.includes('a'.repeat(32)));assert(html.includes('필요 수량 2'));assert(html.includes('SYNTHETIC'));
    selectedRun='22222222-2222-4222-8222-222222222222';assert.notEqual(await run(),0);assert.equal(readFileSync(path,'utf8'),html);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
