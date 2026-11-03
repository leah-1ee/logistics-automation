import {createRequire} from 'node:module';
import {readFileSync,readdirSync,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
const require=createRequire('/app/package.json'),Ajv=require('ajv'),addFormats=require('ajv-formats');
const [schemaPath,root]=process.argv.slice(2);
if(!schemaPath||!root)throw Error('Usage: node check-observations.mjs SCHEMA OBSERVATIONS');
const ajv=new Ajv({allErrors:true});addFormats(ajv);const validate=ajv.compile(JSON.parse(readFileSync(schemaPath)));
let count=0,invalid=0;const errorPaths=new Set();
for(const service of ['api','worker','source'])for(const name of readdirSync(join(root,service)).filter(n=>n.endsWith('.jsonl'))){
  for await(const line of createInterface({input:createReadStream(join(root,service,name)),crlfDelay:Infinity})){
    count++;try{if(!validate(JSON.parse(line))){invalid++;for(const e of validate.errors||[])errorPaths.add(e.instancePath);}}catch{invalid++;}
  }
}
console.log(JSON.stringify({status:invalid?'FAIL':'PASS',records:count,invalid,errorPaths:[...errorPaths],schemaVersion:1}));
if(invalid)process.exitCode=1;
