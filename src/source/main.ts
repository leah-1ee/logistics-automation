import { Source } from './source.js';
import { httpApp } from '../server/http.js';
import { Problem } from '../shared/contracts.js';
const source=new Source(process.env.PREPARED_DB||'data/prepared/olist.sqlite',process.env.DATASET_RUN_ID!);
const app=await httpApp('/source/v1',{source_orders:async req=>{
  if(req.query.datasetRunId!==source.runId)throw new Problem('CURSOR_RUN_MISMATCH');
  return source.page(req.query.cursor,req.query.limit);
}});
await app.listen(Number(process.env.SOURCE_PORT||3100),process.env.SOURCE_HOST||'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await app.close();source.close();});
