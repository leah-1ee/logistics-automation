import { spawnSync } from 'node:child_process';
const r=spawnSync('python3',['tools/prepare-data.py','--raw',process.env.RAW_DIR||'data/raw/olist-v2','--out',process.env.PREPARED_DB||'data/prepared/olist.sqlite','--manifest',process.env.DATASET_MANIFEST||'data/prepared/olist-manifest.json',...process.argv.slice(2)],{stdio:'inherit'});
process.exitCode=r.status||0;
