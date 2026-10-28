import { DatabaseSync } from 'node:sqlite';
import { connectDb, transaction } from '../src/server/db.js';
import { now, sha256,hash,parseJson } from '../src/shared/contracts.js';
import { Source } from '../src/source/source.js';
import { writeFileSync } from 'node:fs';
const db=await connectDb();const runId=process.env.DATASET_RUN_ID!;
try {
  await transaction(db,async tx=>{
    const tokenHash=sha256(process.env.DEVICE_TOKEN!);
    const [existing]=await tx.execute('SELECT token_hash FROM devices WHERE id=? FOR UPDATE',[process.env.DEVICE_ID!]);
    if(existing&&existing.token_hash!==tokenHash)throw new Error('Device token already registered; refusing silent replacement');
    await tx.execute('INSERT INTO devices(id,token_hash,enabled) VALUES(?,?,true) ON DUPLICATE KEY UPDATE id=id',[process.env.DEVICE_ID!,tokenHash]);
  });
  const path=process.env.PREPARED_DB||'data/prepared/olist.sqlite';
  const source=new DatabaseSync(path,{readOnly:true});
  try {
    const manifest=JSON.parse((source.prepare("SELECT value FROM meta WHERE key='manifest'").get() as any).value);
    await transaction(db,async tx=>{
      const [old]=await tx.execute('SELECT manifest FROM dataset_runs WHERE id=? FOR UPDATE',[runId]);
      if(old&&hash(parseJson(old.manifest))!==hash(manifest))throw new Error('Run manifest changed; register a new run ID');
      await tx.execute('INSERT INTO dataset_runs VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[runId,manifest.datasetVersion,JSON.stringify(manifest),'REGISTERED',now()]);
      await tx.execute('INSERT INTO source_checkpoints VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE run_id=run_id',[runId,'olist',null,'PAUSED',now()]);
    });
    const replay=new Source(path,runId);
    try {
      await transaction(db,async tx=>{
        const [previous]=await tx.execute('SELECT scenario_hash FROM dataset_scenarios WHERE run_id=? FOR UPDATE',[runId]);
        if(previous&&previous.scenario_hash!==replay.scenarioHash)throw new Error('Scenario changed; register a new run ID');
        await tx.execute('INSERT INTO dataset_scenarios VALUES(?,?,?) ON DUPLICATE KEY UPDATE run_id=run_id',[runId,replay.scenarioHash,JSON.stringify(replay.scenario)]);
      });
      writeFileSync('manifests/scenario-'+runId+'.json',JSON.stringify({...replay.scenario,scenarioHash:replay.scenarioHash},null,2)+'\n');
    }finally{replay.close();}
    for(const row of source.prepare('SELECT * FROM products').iterate() as Iterable<any>) {
      const p=JSON.parse(row.payload);
      await transaction(db,async tx=>{await tx.execute('INSERT INTO products VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE product_id=product_id',[runId,row.id,p.product_category_name||null,row.payload]);});
    }
    for(const row of source.prepare('SELECT * FROM sellers').iterate() as Iterable<any>) await transaction(db,async tx=>{await tx.execute('INSERT INTO sellers VALUES(?,?) ON DUPLICATE KEY UPDATE seller_id=seller_id',[runId,row.id]);});
    console.log('Registered dataset and file-loaded masters',runId,manifest.synthetic?'SYNTHETIC':'ACTUAL OLIST');
  } finally{source.close();}
} finally{await db.close(true);}
