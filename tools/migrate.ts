import { readFileSync, readdirSync } from 'node:fs';
import { connectDb, connection } from '../src/server/db.js';
import { sha256 } from '../src/shared/contracts.js';
const db = await connectDb();
try {
  const c = connection(db);
  // DDL implicitly commits in MySQL. A dedicated connection holds the advisory lock.
  const pool = await (c as any).getNativeClient();
  const client = await pool.promise().getConnection();
  const sql = (q:string,p:any[]=[]) => client.query(q,p);
  try {
    const [locks] = await sql("SELECT GET_LOCK('logistics-migrations',30) AS acquired");
    if (Number(locks[0].acquired)!==1) throw new Error('Migration lock unavailable');
    await sql('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(128) PRIMARY KEY, sha256 CHAR(64) NOT NULL, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    for (const version of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) {
      const body = readFileSync('migrations/'+version,'utf8');
      const [found] = await sql('SELECT sha256 FROM schema_migrations WHERE version=?',[version]);
      if (found.length) { if (found[0].sha256!==sha256(body)) throw new Error('Applied migration changed: '+version); continue; }
      for (const statement of body.split(';').map(s=>s.trim()).filter(Boolean)) await sql(statement.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS '));
      await sql('INSERT INTO schema_migrations(version,sha256) VALUES(?,?)',[version,sha256(body)]);
      console.log('Applied',version);
    }
  } finally { await sql("SELECT RELEASE_LOCK('logistics-migrations')"); client.release(); }
} finally { await db.close(true); }
