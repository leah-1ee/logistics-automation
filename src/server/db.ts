import { MikroORM } from '@mikro-orm/mysql';
import { EntitySchema } from '@mikro-orm/core';

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
export function connection(db: Db): Tx { return db.em.fork().getConnection(); }
export async function transaction<T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> {
  const em = db.em.fork();
  return em.transactional(async inner => ({ value: await run({ execute: (sql, params = []) =>
    inner.getConnection().execute(sql, params, 'all', inner.getTransactionContext()) }) })).then(x => x.value);
}
