import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectDb,transaction,connection } from '../../src/server/db.js';
import { assigned } from './helpers.js';
test('MySQL enforces quantities, state enum and assigned ownership independently of HTTP',async()=>{
  const db=await connectDb();try{
    const {snapshot}=await assigned(db);
    await assert.rejects(transaction(db,async tx=>{await tx.execute('UPDATE task_items SET applied_qty=-1 WHERE task_id=?',[snapshot.taskId]);}));
    await assert.rejects(transaction(db,async tx=>{await tx.execute("UPDATE tasks SET status='INVALID' WHERE id=?",[snapshot.taskId]);}));
    await assert.rejects(transaction(db,async tx=>{await tx.execute('UPDATE tasks SET device_id=NULL WHERE id=?',[snapshot.taskId]);}));
    const [t]=await connection(db).execute('SELECT status,device_id FROM tasks WHERE id=?',[snapshot.taskId]);assert.equal(t.status,'ASSIGNED');assert.equal(t.device_id,snapshot.deviceId);
  }finally{await db.close(true);}
});
