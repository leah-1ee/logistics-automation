import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectDb,connection } from '../../src/server/db.js';
import { applyEvent } from '../../src/sync/events.js';
import { assigned } from './helpers.js';

test('T25 DB session timezone cannot shift committedAt or confirmed business date',async()=>{
  const db=await connectDb();
  const pool:any=await db.em.getConnection().getNativeClient();
  pool.config.connectionLimit=1; // Test-only pool: session overrides cannot escape this connection.
  const fixed='2026-10-28T15:30:00.000Z';
  const session=async(zone:string,timestamp:number)=>{
    const physical=await pool.promise().getConnection();
    try{await physical.query('SET SESSION time_zone=?',[zone]);await physical.query('SET SESSION timestamp=?',[timestamp]);}
    finally{physical.release();}
  };
  try{
    for(const zone of ['+09:00','-05:00']){
      const a=await assigned(db);await session(zone,Date.parse(fixed)/1000);
      let seq=0;
      for(const productId of ['a'.repeat(32),'a'.repeat(32),'b'.repeat(32)]){
        const r=await applyEvent(db,a.deviceId,{eventId:randomUUID(),taskId:a.snapshot.taskId,deviceId:a.deviceId,assignmentVersion:1,seq:++seq,occurredAt:'2020-01-01T00:00:00Z',type:'SCAN_ITEM',payload:{productId,quantity:1}});
        assert.equal(r.receipt?.committedAt,fixed,zone);
      }
      const r=await applyEvent(db,a.deviceId,{eventId:randomUUID(),taskId:a.snapshot.taskId,deviceId:a.deviceId,assignmentVersion:1,seq:++seq,occurredAt:'2020-01-01T00:00:00Z',type:'COMPLETE',payload:{}});
      assert.equal(r.receipt?.confirmedAt,fixed);
      const [saved]=await connection(db).execute('SELECT confirmed_at,business_date FROM tasks WHERE id=?',[a.snapshot.taskId]);
      assert.equal(saved.confirmed_at,fixed);assert.equal(saved.business_date,'2026-10-29');
    }
  }finally{await session('+00:00',0);await db.close(true);}
});
