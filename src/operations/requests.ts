import { randomUUID } from 'node:crypto';
import { type Db,type Tx,transaction } from '../server/db.js';
import { hash,now,parseJson,Problem } from '../shared/contracts.js';
export async function audit(tx:Tx,actor:string,action:string,target:string,reason:string,before:any,after:any) {
  await tx.execute('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?,?)',[randomUUID(),'ADMIN',actor,action,target,reason,JSON.stringify({before,after}),now()]);
}
export async function adminRequest<T>(db:Db,actor:string,target:string,body:any,run:(tx:Tx)=>Promise<T>):Promise<T> {
  return transaction(db,async tx=>{
    await tx.execute('INSERT INTO admin_actor_locks VALUES(?) ON DUPLICATE KEY UPDATE actor_id=actor_id',[actor]);
    await tx.execute('SELECT * FROM admin_actor_locks WHERE actor_id=? FOR UPDATE',[actor]);
    const digest=hash({target,body});
    const [old]=await tx.execute('SELECT * FROM admin_requests WHERE actor_id=? AND request_id=?',[actor,body.requestId]);
    if(old) {if(old.canonical_hash!==digest)throw new Problem('REQUEST_ID_REUSED');return parseJson(old.stored_response);}
    const response=await run(tx);
    await tx.execute('INSERT INTO admin_requests VALUES(?,?,?,?,?,?)',[actor,body.requestId,target,digest,JSON.stringify(response),now()]);
    return response;
  });
}
