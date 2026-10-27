import { type Db,connection } from './db.js';
import { sha256,Problem } from '../shared/contracts.js';
export async function deviceAuth(db:Db,header:string|undefined) {
  if(!header?.startsWith('Bearer '))throw new Problem('UNAUTHORIZED',401);
  const [device]=await connection(db).execute('SELECT id,enabled FROM devices WHERE token_hash=?',[sha256(header.slice(7))]);
  if(!device?.enabled)throw new Problem('FORBIDDEN',403);
  return device.id as string;
}
