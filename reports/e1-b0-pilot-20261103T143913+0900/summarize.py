"""Read preserved pilot files after execution; no service/database writes or replay."""
from pathlib import Path
from array import array
import json,sys,math,datetime,collections,hashlib
root=Path(sys.argv[1]);out=Path(__file__).parent
read=lambda p:json.loads(p.read_text())
def dt(s):return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
def dist(values):
 if not values:return None
 ordered=sorted(values);n=len(ordered)
 return {'n':n,'sum':sum(ordered),'min':ordered[0],'p50':ordered[max(0,math.ceil(n*.50)-1)],'p95':ordered[max(0,math.ceil(n*.95)-1)],'p99':ordered[max(0,math.ceil(n*.99)-1)],'max':ordered[-1]}
m=read(root/'manifest.json');t0=dt(read(root/'output/t0.json')['wallTime'])
cv=read(root/'output/coverage.json') if (root/'output/coverage.json').exists() else None
last_raw=None;last_task=None;eof=None;new_raw=0;new_task=0;phase=collections.defaultdict(lambda:array('d'));errors=collections.Counter();sizes=[];health=[]
# Endpoints are success-observation wall times, not engine commit timestamps.
for service in ['api','worker','source']:
 for p in (root/'metrics'/service).glob('*.health.json'):health.append(read(p))
 for p in (root/'metrics'/service).glob('*.jsonl'):
  sizes.append({'service':service,'file':p.name,'bytes':p.stat().st_size,'MiB':p.stat().st_size/1024**2,'fractionOf2GiB':p.stat().st_size/(2*1024**3)})
  with p.open() as f:
   for line in f:
    try:r=json.loads(line)
    except ValueError:continue
    when=dt(r['wallTime'])
    if r['kind']=='raw_order_created':new_raw+=1;last_raw=max(last_raw,when) if last_raw else when
    if r['kind']=='task_created':new_task+=1;last_task=max(last_task,when) if last_task else when
    if r['kind']=='source_eof':eof=max(eof,when) if eof else when
end=max(t for t in [last_raw,last_task,eof] if t is not None)
for service in ['api','worker','source']:
 for p in (root/'metrics'/service).glob('*.jsonl'):
  with p.open() as f:
   for line in f:
    try:r=json.loads(line)
    except ValueError:continue
    if not t0<=dt(r['wallTime'])<=end:continue
    key=service+':'+r['kind']+':'+r['label']
    if 'durationMs' in r:phase[key].append(r['durationMs'])
    if r.get('outcome') in ['error','callback_failed','commit_outcome_unknown']:errors[key+':'+r['outcome']]+=1
samples=[]
for line in (root/'output/monitor.jsonl').read_text().splitlines():
 try:r=json.loads(line)
 except ValueError:continue
 if 'counts' in r and dt(r['wallTime'])>=t0:samples.append(r)
last=samples[-1] if samples else None
peak_jobs=0;peak_queue=0;ages=[];age_unknown=0;first_done=None;first_zero=None
for r in samples:
 jobs={j['status']:int(j['count']) for j in r['jobs']};pending=sum(v for k,v in jobs.items() if k!='DONE');qsum=sum(r['queue'].get(k,0) for k in ['waiting','active','delayed','failed'])
 peak_jobs=max(peak_jobs,pending);peak_queue=max(peak_queue,qsum)
 if r.get('oldestAge',{}).get('seconds') is not None:ages.append(r['oldestAge']['seconds'])
 if r.get('oldestAge',{}).get('coverage')!='OBSERVED':age_unknown+=1
 if r['checkpoint']=='DONE' and first_done is None:first_done=r['wallTime']
 if pending==0 and qsum==0 and r['checkpoint']=='DONE' and first_zero is None:first_zero=r['wallTime']
resources=collections.defaultdict(list);host=[]
for line in (root/'output/resources.jsonl').read_text().splitlines():
 r=json.loads(line)
 if dt(r['wallTime'])<t0:continue
 host.append(r)
 for p in r['processes']:resources[p['service']].append((r,p))
resource_summary={}
for service,points in resources.items():
 first,final=points[0],points[-1];a,b=first[1],final[1];span=(dt(final[0]['wallTime'])-dt(first[0]['wallTime'])).total_seconds()
 cpu=None
 if 'utimeTicks' in a and 'utimeTicks' in b:
  cpu=((b['utimeTicks']+b['stimeTicks'])-(a['utimeTicks']+a['stimeTicks']))/a['clockTicksPerSecond']
 cpu_pct=[]
 for _,p in points:
  try:cpu_pct.append(float(p['containerStats']['CPUPerc'].rstrip('%')))
  except (KeyError,ValueError,TypeError):pass
 resource_summary[service]={'samples':len(points),'sampledRssPeakMiB':max((p.get('VmRSSBytes',0) for _,p in points),default=0)/1024**2,'processLifetimeHwmMiB':max((p.get('VmHWMBytes',0) for _,p in points),default=0)/1024**2,'sampleBracketCpuSeconds':cpu,'sampleBracketSeconds':span,'sampleBracketCpuCoreEquivalent':cpu/span if cpu is not None and span>0 else None,'dockerCpuPercentMax':max(cpu_pct) if cpu_pct else None,'memoryLimitFractionMax':max(p.get('memoryRatio',0) for _,p in points),'quotaCpus':a['cpuQuota'],'limitations':'RSS sampled peak lower bound; HWM includes process lifetime; CPU first/last sample bracket excludes prefix/suffix; Docker CPU includes exec sampler overhead.'}
validation=read(root/'output/business-validation.json') if (root/'output/business-validation.json').exists() else None
audit=read(root/'output/final-audit-host.json') if (root/'output/final-audit-host.json').exists() else None
result=read(root/'output/adapter-result.json') if (root/'output/adapter-result.json').exists() else None
raw_seconds=(last_raw-t0).total_seconds() if last_raw else None;task_seconds=(last_task-t0).total_seconds() if last_task else None
summary={'manifest':{'baseline':m['baseline'],'project':m['project'],'runId':m['runId'],'imageId':m['imageId'],'observationLimits':m['observationLimits']},'adapterResult':result,'t0':t0.isoformat(),'processingObservationEnd':end.isoformat(),'rawCreatedObservations':new_raw,'taskCreatedObservations':new_task,
 'rawCommitSuccessObservationSeconds':raw_seconds,'taskCommitSuccessObservationSeconds':task_seconds,'rawOrdersPerSecondObserved':new_raw/raw_seconds if raw_seconds else None,'newTasksPerSecondObserved':new_task/task_seconds if task_seconds else None,
 'sourceEofObservedAt':eof.isoformat() if eof else None,'lastRawCommitSuccessObservedAt':last_raw.isoformat() if last_raw else None,'lastTaskCommitSuccessObservedAt':last_task.isoformat() if last_task else None,
 'phaseCostMs':{k:dist(v) for k,v in phase.items()},'phaseCostLimits':'Nested/parallel spans overlap; do not add these totals as wall time. Fixed-label client durations include instrumentation/pool/network/DB; not DB engine time or general API p95.',
 'observedErrors':dict(errors),'backlog':{'sampleCount':len(samples),'firstCheckpointDoneAt':first_done,'firstQueueAndDbZeroAt':first_zero,'sampledDbUnfinishedPeak':peak_jobs,'sampledRedisPendingPeak':peak_queue,'oldestEnqueueAgeSeconds':dist(ages),'ageUnknownSampleCount':age_unknown,'lastSample':last},
 'drain':{'lastRawToLastTaskObservedSeconds':(last_task-last_raw).total_seconds() if last_task and last_raw else None,'sourceEofToFirstQueueZeroObservedSeconds':(dt(first_zero)-eof).total_seconds() if first_zero and eof else None,'limits':'First zero is a 5s observer sample; controller/resource collection adds confirmation delay. Negative intervals remain visible.'},
 'resources':resource_summary,'host':{'minMemAvailableBytes':min((r['host']['MemAvailable'] for r in host),default=None),'minDiskFreeBytes':min((r['diskFreeBytes'] for r in host),default=None)},'actualSidecarFiles':sizes,'totalSidecarBytes':sum(p['bytes'] for p in sizes),'health':health,
 'coverage':{k:v for k,v in cv.items() if k not in ['t0ToTaskCommitSuccessObservedSeconds','clientDurationHistograms']} if cv else 'NOT_YET_COMPUTED',
 't0ToTaskSeconds':dist(cv['t0ToTaskCommitSuccessObservedSeconds']) if cv else None,'businessFinal':validation['state'] if validation else 'No complete-run validation; final monitor is observational unless separately verified',
 'independentAudit':audit,'limits':['Single instrumented finite-backlog pilot, no repeat or performance-improvement comparison','Source all initially published; this is not stable finite lambda capacity','Same host shares CPU/IO/cache with original services','API/collector same process','Exact pool wait, lock duration and raw-to-task commit interval UNKNOWN','Sidecar non-atomic with database; detail validity depends on coverage checks','Large raw metrics, generated secrets and DB volumes remain outside Git']}
summary['performanceBaselineValidity']='INVALID: drain incomplete and CLOCK_INTERVAL_ANOMALY. Wall times/rates and cross-process latency are nominal reference observations only; no correction or repeat.'
summary['wallTimeMetricsValidated']=False
summary['taskLatencyDenominator']={'observedCreatedTasks':new_task,'expectedEligibleTasks':m['expected']['task'],'uncreatedTasks':m['expected']['task']-new_task,'note':'Completed subset only; not the p95 for all eligible tasks. Uncreated tasks are censored.'}
summary['durationQuantileMethod']='nearest rank; milliseconds from recorded same-process monotonic durations; nested spans overlap'
for resource in summary['resources'].values():resource['sampleBracketCpuCoreEquivalentValidity']='UNVALIDATED wall-time denominator; CPU tick seconds retained separately'
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['rawCreatedObservations','taskCreatedObservations','rawCommitSuccessObservationSeconds','taskCommitSuccessObservationSeconds','rawOrdersPerSecondObserved','newTasksPerSecondObserved','totalSidecarBytes']},ensure_ascii=False))
