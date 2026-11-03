import { MikroORM } from '@mikro-orm/mysql';
import { EntitySchema } from '@mikro-orm/core';
import { committed, observedSql, type Label } from '../observability/b0.js';

const DatasetRun = new EntitySchema({ name: 'DatasetRun', tableName: 'dataset_runs', properties: {
  id: { type: 'string', primary: true }, datasetVersion: { type: 'string', fieldName: 'dataset_version' },
  manifest: { type: 'json' }, status: { type: 'string' }
}});
export async function connectDb() {
  return MikroORM.init({ entities: [DatasetRun], dbName: process.env.MYSQL_DATABASE || 'logistics',
    host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3307),
    user: process.env.MYSQL_USER || 'logistics', password: process.env.MYSQL_PASSWORD,
    pool: { min: 0, max: 8 }, driverOptions: { timezone: 'Z', dateStrings: true } });
}
export type Db = Awaited<ReturnType<typeof connectDb>>;
export type Tx = { execute(sql: string, params?: any[]): Promise<any> };
export function connection(db: Db): Tx {
  const native = db.em.fork().getConnection();
  return new Proxy(native, { get(target, key) {
    if(key==='execute')return (sql:string,...args:any[])=>observedSql(sql,()=> (target.execute as any)(sql,...args));
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
}
export async function transaction<T>(db: Db, run: (tx: Tx) => Promise<T>, label:Label='other'): Promise<T> {
  return committed(label,async callbackResolved=>{
    const em = db.em.fork();
    const result=await em.transactional(async inner=>{
      const value=await run({execute:(sql,params=[])=>observedSql(sql,()=>
        inner.getConnection().execute(sql,params,'all',inner.getTransactionContext()))});
      callbackResolved();return {value};
    });
    return result.value;
  });
}
