import { randomUUID } from 'node:crypto';
import { type Db, type Tx, transaction, connection } from '../server/db.js';
import { hash, now, parseJson, Problem, validate } from '../shared/contracts.js';
import { normalize } from './normalize.js';
import { setTimeout as delay } from 'node:timers/promises';
export async function enqueue(tx:Tx,runId:string,type:string,aggregateId:string,dedupe:string,payload:any) {
  await tx.execute('INSERT INTO outbox_jobs(id,run_id,type,aggregate_id,dedupe_key,payload,status,available_at) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
    [randomUUID(),runId,type,aggregateId,dedupe,JSON.stringify(payload),'PENDING',now()]);
}
export async function ingestPage(db:Db,runId:string,page:any,expectedCursor:string|null,fault?:(stage:string)=>void) {
  if(page.datasetRunId!==runId)throw new Problem('CURSOR_RUN_MISMATCH');
  // Validate representable source envelopes; malformed required values stay raw and classify DATA_HOLD.
  return transaction(db,async tx=>{
    const [cp]=await tx.execute('SELECT * FROM source_checkpoints WHERE run_id=? AND source=? FOR UPDATE',[runId,'olist']);
    if(!cp)throw new Problem('RUN_NOT_REGISTERED',404);
    if(cp.cursor_token!==expectedCursor)return false;
    if(cp.status==='DONE')return false;
    const products=new Set<string>((await tx.execute('SELECT product_id FROM products WHERE run_id=?',[runId])).map((r:any)=>r.product_id));
    const sellers=new Set<string>((await tx.execute('SELECT seller_id FROM sellers WHERE run_id=?',[runId])).map((r:any)=>r.seller_id));
    fault?.('before');
    for(const source of page.items) {
      if(typeof source.sourceRecordId!=='string'||!source.sourceRecordId||!Array.isArray(source.items))throw new Problem('INVALID_SOURCE_ENVELOPE',400);
      const digest=hash(source);
      const [existing]=await tx.execute('SELECT * FROM raw_orders WHERE run_id=? AND source=? AND (source_record_id=? OR external_order_id=?) FOR UPDATE',[runId,'olist',source.sourceRecordId,source.sourceOrderId]);
      if(existing) {
        if(existing.payload_hash!==digest) {
          await tx.execute('INSERT INTO source_conflicts VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[randomUUID(),existing.id,digest,JSON.stringify(source),now()]);
          const [order]=await tx.execute('SELECT * FROM orders WHERE raw_order_id=? FOR UPDATE',[existing.id]);
          if(order.status!=='TASK_CREATED')await tx.execute('UPDATE orders SET status=?,hold_reasons=? WHERE id=?',['DATA_HOLD',JSON.stringify([...new Set([...parseJson(order.hold_reasons),'SOURCE_KEY_CONFLICT'])]),order.id]);
        }
        continue;
      }
      const rawId=randomUUID(),orderId=randomUUID(),n=normalize(source,products,sellers);
      await tx.execute('INSERT INTO raw_orders VALUES(?,?,?,?,?,?,?)',[rawId,runId,'olist',source.sourceRecordId,source.sourceOrderId||null,JSON.stringify(source),digest]);
      await tx.execute('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)',[orderId,rawId,runId,1,source.sourceOrderId||source.sourceRecordId,source.sourceStatus||'',n.status,n.sellerId,JSON.stringify(n.holdReasons),JSON.stringify(n.qualityFlags)]);
      for(const item of n.items)await tx.execute('INSERT INTO order_items VALUES(?,?,?)',[orderId,item.productId,item.requiredQty]);
      if(n.status==='READY')await enqueue(tx,runId,'CREATE_TASK',orderId,`${orderId}:1`,{orderId,revision:1});
      fault?.('during');
    }
    await tx.execute('UPDATE source_checkpoints SET cursor_token=?,status=?,updated_at=? WHERE run_id=? AND source=?',[page.nextCursor,page.exhausted?'DONE':'RUNNING',now(),runId,'olist']);
    fault?.('before_commit');return true;
  });
}
export async function ingestionStatus(db:Db,runId:string) {
  const c=connection(db);const [cp]=await c.execute('SELECT * FROM source_checkpoints WHERE run_id=? AND source=?',[runId,'olist']);
  if(!cp)throw new Problem('NOT_FOUND',404);
  const rows=await c.execute('SELECT status,COUNT(*) n FROM orders WHERE run_id=? GROUP BY status',[runId]);
  const counts=Object.fromEntries(rows.map((r:any)=>[r.status,Number(r.n)]));
  return {id:runId,datasetRunId:runId,status:cp.status,cursor:cp.cursor_token,receivedCount:Object.values(counts).reduce((a:any,b:any)=>a+b,0),readyCount:(counts.READY||0)+(counts.TASK_CREATED||0),holdCount:counts.DATA_HOLD||0,unsupportedCount:counts.UNSUPPORTED||0};
}
export async function collect(db:Db,runId:string,sourceUrl:string,signal?:AbortSignal) {
  while(!signal?.aborted) {
    const state=await ingestionStatus(db,runId);if(state.status==='DONE')return state;
    const url=new URL('/source/v1/orders',sourceUrl);url.searchParams.set('datasetRunId',runId);url.searchParams.set('limit','200');if(state.cursor)url.searchParams.set('cursor',state.cursor);
    const res=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
    if(!res.ok)throw new Problem('SOURCE_HTTP_'+res.status,503);
    const page=await res.json();validate('SourcePage',page);
    await ingestPage(db,runId,page,state.cursor);
    if(!page.items.length&&!page.exhausted) await delay(Math.max(100,Math.min(page.nextPollAfterMs,60000)),undefined,{signal});
  }
}
