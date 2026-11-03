import {readFileSync} from 'node:fs';
const lock=JSON.parse(readFileSync('package-lock.json')),installed=JSON.parse(readFileSync('node_modules/.package-lock.json'));
const mismatches=[],missingRequired=[];let checked=0,omittedOptional=0;
for(const [path,entry] of Object.entries(lock.packages)){
  if(!path)continue;
  const found=installed.packages[path];
  if(!found){if(entry.optional)omittedOptional++;else missingRequired.push(path);continue;}
  checked++;
  if(['version','resolved','integrity'].some(key=>entry[key]!==found[key]))mismatches.push(path);
}
console.log(JSON.stringify({status:mismatches.length||missingRequired.length?'FAIL':'PASS',checked,omittedOptional,mismatches,missingRequired,
  scope:'Installed package metadata vs unchanged lock; no installation or version change; not a byte audit of every dependency file.'}));
if(mismatches.length||missingRequired.length)process.exitCode=1;
