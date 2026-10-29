"""One immutable benchmark invocation; temp allocation is sampled, RSS is OS high-water.
No installs, DB mutations or overwritten reports. Set AUDIT_KEEP_TEMP=1 for inspectable scratch.
"""
import argparse,hashlib,json,os,pathlib,platform,subprocess,tempfile,time
p=argparse.ArgumentParser()
p.add_argument('--script',required=True);p.add_argument('--name',required=True)
p.add_argument('--database',required=True);p.add_argument('--env-file',default='.env.olist')
p.add_argument('--output-dir',default='reports/audit-memory-2026-10-29')
p.add_argument('--work-dir',default='var/audit-memory-20261029')
p.add_argument('--node',default='.tools/node-v24.22.1-linux-x64/bin/node')
a=p.parse_args()
if not a.name.replace('-','').replace('_','').isalnum():raise SystemExit('Unsafe invocation name')
root=pathlib.Path.cwd();out=root/a.output_dir;work=root/a.work_dir
out.mkdir(parents=True,exist_ok=True);work.mkdir(parents=True,exist_ok=True)
report_path=out/(a.name+'.json')
if report_path.exists():raise SystemExit('Existing benchmark refused')
temporary=pathlib.Path(tempfile.mkdtemp(prefix=a.name+'-',dir=work)).resolve()
audit=out/(a.name+'-audit.json');metrics=work/(a.name+'-process.json');timing=work/(a.name+'-time.txt')
env=os.environ.copy();env.update({'MYSQL_DATABASE':a.database,'AUDIT_OUTPUT':str(audit),
  'AUDIT_PROCESS_METRICS':str(metrics),'AUDIT_KEEP_TEMP':'1',
  'TMPDIR':str(temporary),'TMP':str(temporary),'TEMP':str(temporary),'SQLITE_TMPDIR':str(temporary)})
cmd=['/usr/bin/time','-f','%e %M %U %S %x','-o',str(timing),str((root/a.node).resolve()),
  '--env-file='+str((root/a.env_file).resolve()),'--import',str(root/'tools/audit-process-metrics.mjs'),'--import','tsx',str((root/a.script).resolve())]
def footprint(pid):
    found={}
    for base,dirs,files in os.walk(temporary):
        for name in files:
            try:
                s=os.stat(os.path.join(base,name));found[(s.st_dev,s.st_ino)]=(s.st_size,s.st_blocks*512)
            except FileNotFoundError:pass
    # Include scratch files already unlinked by SQLite but still held open.
    todo=[pid]
    while todo:
        current=todo.pop()
        try:todo.extend(map(int,pathlib.Path(f'/proc/{current}/task/{current}/children').read_text().split()))
        except (OSError,ValueError):pass
        try:
            for fd in pathlib.Path(f'/proc/{current}/fd').iterdir():
                try:
                    target=os.readlink(fd)
                    if target.startswith(str(temporary)+'/'):
                        s=fd.stat();found[(s.st_dev,s.st_ino)]=(s.st_size,s.st_blocks*512)
                except OSError:pass
        except OSError:pass
    return tuple(sum(v[i] for v in found.values()) for i in (0,1))
start=time.perf_counter();samples=0;peak=[0,0]
code_files=[pathlib.Path(a.script),pathlib.Path('tools/audit-process-metrics.mjs'),pathlib.Path(__file__)]
if pathlib.Path(a.script).name=='audit-source.ts':code_files.append(pathlib.Path('tools/audit-source-index.ts'))
code_before={str(f):hashlib.sha256(f.read_bytes()).hexdigest()for f in code_files}
with (work/(a.name+'-stdout.txt')).open('wb') as stdout,(work/(a.name+'-stderr.txt')).open('wb') as stderr:
    proc=subprocess.Popen(cmd,env=env,stdout=stdout,stderr=stderr)
    while proc.poll() is None:
        value=footprint(proc.pid);peak=[max(x,y)for x,y in zip(peak,value)];samples+=1;time.sleep(.02)
elapsed=time.perf_counter()-start
value=footprint(proc.pid);peak=[max(x,y)for x,y in zip(peak,value)]
process=json.loads(metrics.read_text()) if metrics.exists() else None
result=json.loads(audit.read_text()) if audit.exists() else None
code_after={str(f):hashlib.sha256(f.read_bytes()).hexdigest()for f in code_files}
report={'name':a.name,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
  'scope':'Auditor Node process only; other services/parent sampler excluded; TS loader included',
  'script':a.script,'scriptSha256':code_before[str(pathlib.Path(a.script))],
  'codeBefore':code_before,'codeUnchangedDuringInvocation':code_before==code_after,
  'database':a.database,'wallSeconds':elapsed,'process':process,'exitCode':proc.returncode,
  'gnuTime':timing.read_text().strip() if timing.exists() else None,
  'temporaryDisk':{'scope':'Unique TMPDIR including TS cache and unlinked open SQLite files; excludes MySQL server disk and source files',
    'samplingIntervalMs':20,'sampleCount':samples,'peakObservedLogicalBytes':peak[0],'peakObservedAllocatedBytes':peak[1],
    'retainedLogicalBytes':value[0],'retainedAllocatedBytes':value[1],'limitation':'Sampled peak is a lower bound; temporary data retained in ignored var for inspection'},
  'audit':{k:result[k]for k in ['status','sourceOrders','sourceItems','sourceProducts','sourceSellers','orderChecks','taskChecks','quantityChecks','eventChecks','confirmed','classifications','unfinishedJobs','reports','errors']if k in result}if result else None,
  'auditBounds':result.get('bounds')if result else None,
  'auditTemporaryStorage':result.get('temporaryStorage')if result else None,
  'environment':{'kernel':platform.release(),'machine':platform.machine(),'cpuCount':os.cpu_count(),
    'node':subprocess.check_output([str((root/a.node).resolve()),'--version'],text=True).strip()}}
with report_path.open('x')as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'name':a.name,'exitCode':proc.returncode,'wallSeconds':elapsed,'peakRssBytes':process['peakRssBytes']if process else None,'peakObservedTempBytes':peak[1],'auditStatus':result.get('status')if result else None}))
raise SystemExit(proc.returncode if code_before==code_after else 2)
