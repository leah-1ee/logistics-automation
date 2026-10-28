import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb,connection } from '../../src/server/db.js';
import { importMasters } from '../../src/ingestion/masters.js';
import { register } from './helpers.js';
test('file master chunks are idempotent and a failed chunk is atomic',async()=>{
  const db=await connectDb();try{
    const {runId}=await register(db),c=connection(db);
    const product=(id:string)=>({id,payload:JSON.stringify({product_category_name:'synthetic',product_weight_g:'100'})});
    const products=[product('e'.repeat(32)),product('f'.repeat(32))],sellers=[{id:'e'.repeat(32)}];
    await importMasters(db,runId,products,sellers);await importMasters(db,runId,products,sellers);
    assert.equal((await c.execute('SELECT COUNT(*) n FROM products WHERE run_id=?',[runId]))[0].n,4);
    assert.equal((await c.execute('SELECT COUNT(*) n FROM sellers WHERE run_id=?',[runId]))[0].n,2);
    await assert.rejects(importMasters(db,runId,[product('1'.repeat(32)),product('x'.repeat(100))],[]));
    assert.equal((await c.execute('SELECT COUNT(*) n FROM products WHERE run_id=? AND product_id=?',[runId,'1'.repeat(32)]))[0].n,0);
  }finally{await db.close(true);}
});
