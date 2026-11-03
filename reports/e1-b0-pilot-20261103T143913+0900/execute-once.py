"""Single authorized pilot. Only the final auditor is routed to the existing host Node/cache.
The prepared product/collector/worker/observer and stop policies are unchanged.
"""
from pathlib import Path
import importlib.util,subprocess,os,sys,json,datetime,traceback
WORK=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('b0lab',WORK/'tools/b0/lab.py')
lab=importlib.util.module_from_spec(spec);spec.loader.exec_module(lab)
if len(sys.argv)!=3 or sys.argv[2]!='--execute-full-b0':raise SystemExit('Explicit single-pilot flag required')
root=Path(sys.argv[1]).resolve();manifest=lab.guard(root)
assert manifest['mode']=='olist' and not (root/'output/started.json').exists()
with (root/'output/pilot-invocation.json').open('x') as f:
 json.dump({'at':lab.now(),'adapterSha256':lab.sha(__file__),'driverSha256':lab.sha(WORK/'tools/b0/lab.py'),'singlePilot':True,'auditRoute':'host Node24/unchanged auditor source + matching installed dependency metadata'},f)
original_runner=lab.runner
def host_audit(target,entry,*args,env=None,timeout=120):
 if entry!='tools/audit-source':return original_runner(target,entry,*args,env=env,timeout=timeout)
 target=Path(target).resolve();assert target==root
 with (root/'output/host-audit-invocation.json').open('x') as f:
  json.dump({'startedAt':lab.now(),'oracleSourceSha256':lab.sha(WORK/'tools/audit-source.ts'),'indexSourceSha256':lab.sha(WORK/'tools/audit-source-index.ts'),'lockSha256':lab.sha(WORK/'package-lock.json'),'readOnlyConsistentSnapshot':True,'auditOutsideProcessingWindow':True},f)
 private=dict(line.split('=',1) for line in (root/'runtime/app.env').read_text().splitlines())
 assert private['MYSQL_DATABASE']==manifest['database'] and private['DATASET_RUN_ID']==manifest['runId']
 task_env=os.environ.copy()
 for key in list(task_env):
  if key.startswith(('MYSQL_','REDIS_','B0_','AUDIT_')) or key in ['DATASET_RUN_ID','RAW_DIR','SOURCE_MANIFEST','DATASET_MANIFEST','PREPARED_DB','ADMIN_TOKEN','DEVICE_TOKEN','NODE_OPTIONS']:task_env.pop(key,None)
 task_env.update({k:private[k] for k in ['MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','DATASET_RUN_ID','BUSINESS_TIMEZONE']})
 temporary=root/'scratch/host-audit';temporary.mkdir(mode=0o700)
 task_env.update({'MYSQL_HOST':'127.0.0.1','MYSQL_PORT':'13307','RAW_DIR':'/home/leah/logistics-automation/data/raw/olist-v2','SOURCE_MANIFEST':'/home/leah/logistics-automation/manifests/olist-v2.json','TMPDIR':str(temporary),'AUDIT_OUTPUT':str(root/'output/final-audit-host.json'),'B0_OBSERVE':'0'})
 node='/home/leah/logistics-automation/.tools/node-v24.22.1-linux-x64/bin/node'
 p=subprocess.run([node,'--import','tsx','tools/audit-source.ts'],cwd=WORK,env=task_env,capture_output=True,text=True,timeout=timeout)
 (root/'output/audit-host-stdout.txt').write_text(p.stdout);(root/'output/audit-host-stderr.txt').write_text(p.stderr)
 for name in ['audit-host-stdout.txt','audit-host-stderr.txt']:(root/'output'/name).chmod(0o600)
 if p.returncode:raise RuntimeError('Independent host audit failed; original output retained')
 report=lab.json_last(p.stdout);lab.save(root/'output/host-audit-completion.json',{'endedAt':lab.now(),'status':report['status'],'codeCommit':report['codeCommit'],'note':'This source auditor uses host Git; container has no Git. No source/DB contract modified.'})
 return p.stdout
lab.runner=host_audit
status='PASS';failure=None
try:lab.run(root,full=True)
except Exception as error:
 status='FAIL';failure=type(error).__name__+': '+str(error)
 # No second workload. Preserve stopped/partial data; independently audit it once if safe.
 if not (root/'output/host-audit-invocation.json').exists() and (root/'output/t0.json').exists():
  available=int(next(l.split()[1] for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:')))*1024
  if available>=2*1024**3:
   try:
    lab.compose(root,'up','-d','--no-build','--pull','never','--wait','mysql',timeout=120)
    host_audit(root,'tools/audit-source',timeout=300)
   except Exception:pass
finally:
 if (root/'output/started.json').exists():lab.compose(root,'stop','-t','30',timeout=90,check=False)
 lab.save(root/'output/adapter-result.json',{'status':status,'at':lab.now(),'failure':failure,'singlePilot':True,'noReplayOrOptimization':True,'dataAndVolumesRetained':True})
 print(json.dumps({'status':status,'results':str(root/'output')}),flush=True)
if status!='PASS':raise SystemExit(1)
