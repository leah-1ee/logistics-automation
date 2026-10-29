"""Sequential warm-ups and three paired measurements on an existing immutable DB clone.
Does not create, reset, corrupt, stop or delete any database/service/source/report.
"""
import argparse,hashlib,json,os,pathlib,statistics,subprocess,sys
p=argparse.ArgumentParser()
p.add_argument('--database',required=True)
p.add_argument('--env-file',default='.env.olist')
p.add_argument('--output-dir',default='reports/audit-memory-2026-10-29/paired')
p.add_argument('--work-dir',default='var/audit-memory-20261029')
p.add_argument('--reference',default='reports/audit-memory-2026-10-29/snapshot-before.json')
a=p.parse_args();out=pathlib.Path(a.output_dir);out.mkdir(parents=True,exist_ok=True)
if list(out.iterdir()):raise SystemExit('Use a new empty output directory; reports are never replaced')
node=str(pathlib.Path('.tools/node-v24.22.1-linux-x64/bin/node').resolve())
reference=json.loads(pathlib.Path(a.reference).read_text());expected=reference['contentSha256']
scripts={'baseline':'tools/benchmarks/audit-source-baseline.ts','disk-indexed':'tools/audit-source.ts'}
results=[];identities=[]
def fingerprint(name):
    path=out/(name+'-db.json');env=os.environ.copy();env.update({'MYSQL_DATABASE':a.database,'FINGERPRINT_OUTPUT':str(path)})
    r=subprocess.run([node,'--import','tsx','--env-file='+a.env_file,'tools/audit-db-fingerprint.ts'],env=env,capture_output=True,text=True)
    if r.returncode:raise RuntimeError('Read-only DB identity check failed')
    data=json.loads(path.read_text());identities.append({'file':str(path),'sha256':data['contentSha256']})
    if data['contentSha256']!=expected:raise RuntimeError('Snapshot changed; benchmark comparison invalid')
def measure(variant,name,warmup=False):
    command=[sys.executable,'tools/benchmark-audit.py','--script',scripts[variant],'--name',name,'--database',a.database,
             '--env-file',a.env_file,'--output-dir',str(out),'--work-dir',a.work_dir]
    r=subprocess.run(command,capture_output=True,text=True)
    print(r.stdout.strip(),flush=True)
    if r.returncode:raise RuntimeError('Auditor invocation failed; not a valid performance sample')
    row=json.loads((out/(name+'.json')).read_text())
    if not row['codeUnchangedDuringInvocation']or row['audit']['status']!='PASS':raise RuntimeError('Changed code or failed validation')
    row['variant']=variant;row['warmup']=warmup;results.append(row)
    return row
try:
    fingerprint('before-warmup')
    measure('baseline','warmup-baseline',True);measure('disk-indexed','warmup-disk-indexed',True)
    for i,order in enumerate([['baseline','disk-indexed'],['disk-indexed','baseline'],['baseline','disk-indexed']],1):
        fingerprint('round'+str(i)+'-before')
        pair=[measure(v,'round'+str(i)+'-'+v)for v in order]
        if pair[0]['audit']!=pair[1]['audit']:raise RuntimeError('Semantic validation results differ')
        fingerprint('round'+str(i)+'-after')
    def summarize(variant):
        rows=[r for r in results if r['variant']==variant and not r['warmup']]
        def stats(values):return {'min':min(values),'median':statistics.median(values),'max':max(values)}
        return {'samples':len(rows),'wallSeconds':stats([r['wallSeconds']for r in rows]),
                'peakRssBytes':stats([r['process']['peakRssBytes']for r in rows]),
                'tempObservedAllocatedBytes':stats([r['temporaryDisk']['peakObservedAllocatedBytes']for r in rows]),
                'tempRetainedAllocatedBytes':stats([r['temporaryDisk']['retainedAllocatedBytes']for r in rows])}
    baseline=summarize('baseline');improved=summarize('disk-indexed')
    report={'status':'PASS','scope':'Auditor Node RSS only (OS high-water); invocation wall time; scratch allocation sampled20ms, lower bound. No whole-service memory claim.',
      'warmupsPerVariant':1,'measuredPairs':3,'order':['baseline/disk-indexed','disk-indexed/baseline','baseline/disk-indexed'],
      'cachePolicy':'No forced cache flush; both implementations warmed. Fresh Node process and separate temp/TS cache every invocation.',
      'snapshotSha256':expected,'dbIdentityChecks':identities,'semanticResultsEqual':True,
      'baseline':baseline,'diskIndexed':improved,
      'measuredRssReductionPercent':(1-improved['peakRssBytes']['median']/baseline['peakRssBytes']['median'])*100,
      'measuredWallTimeChangePercent':(improved['wallSeconds']['median']/baseline['wallSeconds']['median']-1)*100,
      'memoryImprovedInThisExperiment':improved['peakRssBytes']['median']<baseline['peakRssBytes']['median'],
      'auditResult':next(r['audit']for r in results if not r['warmup']),
      'scriptHashes':{v:hashlib.sha256(pathlib.Path(s).read_bytes()).hexdigest()for v,s in scripts.items()},
      'limits':['Three pairs on one WSL/Docker host; no statistical population or throughput claim','Other services remain running; MySQL RSS, OS page cache, parent sampler and MySQL temporary disk are excluded','Preliminary first-run observations are separate and not used in these medians']}
except Exception as error:
    report={'status':'FAIL','reason':str(error),'completedInvocations':len(results),'dbIdentityChecks':identities}
    with (out/'comparison.json').open('x')as f:json.dump(report,f,indent=2);f.write('\n')
    raise
with (out/'comparison.json').open('x')as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report),flush=True)
