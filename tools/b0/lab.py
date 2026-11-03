#!/usr/bin/env python3
"""One isolated B0 only. init never starts/loads Olist; run-b0 is explicit future execution."""
import argparse,csv,datetime,hashlib,json,os,pathlib,queue,secrets,shutil,socket,subprocess,threading,time,urllib.request,uuid
BASELINE='954bb692a244803b8aad695539d81afdcb81a091'
INDEX_SHA='ca226c4f3ae6b7c561279bf2645aedcd0371d784b4b7c5e16781119605ec7863'
REPO=pathlib.Path(__file__).resolve().parents[2]
INPUT_REPO=pathlib.Path('/home/leah/logistics-automation')
PORTS={'api':13000,'source':13100,'mysql':13307,'redis':16380}
QUOTAS={'mysql':1.5,'api':.75,'worker':.75,'source':.5,'redis':.5,'runner':.25}
LIMITS={'mysql':2*1024**3,'api':1024**3,'worker':1024**3,'source':1024**3,'redis':512*1024**2,'runner':512*1024**2}
CSV_NAMES=['olist_orders_dataset.csv','olist_order_items_dataset.csv','olist_products_dataset.csv','olist_sellers_dataset.csv']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def save(p,v):
 p=pathlib.Path(p);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');p.chmod(0o600)
def cmd(args,timeout=120,check=True):
 p=subprocess.run(list(map(str,args)),capture_output=True,text=True,timeout=timeout)
 if check and p.returncode:raise RuntimeError('Command failed: '+str(args[0])+' (private log retained when applicable)')
 return p

def ports_free():
 for port in PORTS.values():
  with socket.socket() as s:
   try:s.bind(('127.0.0.1',port))
   except OSError:raise RuntimeError('Candidate loopback port in use: '+str(port))

def artifact_files():
 paths=[]
 for folder in ['src','tools','migrations']:
  paths.extend(p for p in (REPO/folder).rglob('*') if p.is_file() and '__pycache__' not in str(p) and p.suffix!='.pyc')
 paths.extend(REPO/p for p in ['package-lock.json','package.json','docs/openapi.yaml','tsconfig.json'])
 return {str(p.relative_to(REPO)):sha(p) for p in sorted(paths)}

def synthetic(root):
 raw=root/'inputs/raw';raw.mkdir(parents=True)
 def write(name,header,rows):
  with (raw/name).open('x',newline='') as f:w=csv.writer(f);w.writerow(header);w.writerows(rows)
 write(CSV_NAMES[2],['product_id','product_category_name','product_weight_g','product_length_cm','product_height_cm','product_width_cm'],[['a'*32,'synthetic',100,1,2,3],['b'*32,'synthetic',200,2,3,4]])
 write(CSV_NAMES[3],['seller_id'],[['d'*32]])
 write(CSV_NAMES[0],['order_id','order_status','order_purchase_timestamp','order_approved_at'],[[f'{i:032x}','canceled' if i==4 else 'delivered','2017-01-01 10:00:00','2017-01-01 10:05:00'] for i in range(1,5)])
 write(CSV_NAMES[1],['order_id','order_item_id','product_id','seller_id','shipping_limit_date'],[[f'{i:032x}',j,product*32,'d'*32,'2017-01-02 00:00:00'] for i,items in [(1,['a','a','b']),(2,['b']),(4,['a'])] for j,product in enumerate(items,1)])
 prepared=root/'inputs/prepared.sqlite';manifest=root/'inputs/manifest.json'
 p=cmd(['python3',REPO/'tools/prepare-data.py','--raw',raw,'--out',prepared,'--manifest',manifest,'--synthetic'])
 (root/'output/fixture-preparation.txt').write_text(p.stdout)
 return raw,prepared,manifest


def inspect_image(image):
 script="const fs=require('fs'),c=require('crypto'),r={};function walk(p){if(!fs.existsSync(p))return;if(fs.statSync(p).isDirectory()){for(const f of fs.readdirSync(p))walk(p+'/'+f);}else r[p]=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}for(const p of ['src','migrations','package-lock.json','docs/openapi.yaml'])walk(p);console.log(JSON.stringify(r));"
 args=['docker','run','--rm','--network','none','--read-only','--cpus','.25','--memory','256m',image]
 found=json.loads(cmd(args+['node','-e',script]).stdout)
 expected={p:h for p,h in artifact_files().items() if p.startswith(('src/','migrations/')) or p in ['package-lock.json','docs/openapi.yaml']}
 if found!=expected:raise RuntimeError('Image source/contract/lock/migration differs from preparation worktree')
 dependencies=json.loads(cmd(args+['node','tools/b0/verify-dependencies.mjs']).stdout)
 if dependencies['status']!='PASS':raise RuntimeError('Image dependency metadata mismatch')
 return {'sourceHashes':found,'dependencies':dependencies}

def init(root,image,mode,observe):
 root=root.resolve();allowed=pathlib.Path('/home/leah/e1-lab').resolve()
 if not root.is_relative_to(allowed) or root==allowed or root.exists():raise RuntimeError('A new, unique directory under /home/leah/e1-lab is required')
 ports_free();image_id=json.loads(cmd(['docker','image','inspect',image]).stdout)[0]['Id'];image_proof=inspect_image(image_id)
 root.mkdir(parents=True,mode=0o700)
 for d in ['runtime','metrics','manifests','scratch','output']: (root/d).mkdir(mode=0o700)
 for service in ['api','worker','source','runner']:(root/'metrics'/service).mkdir(mode=0o700)
 if mode=='smoke':raw,prepared,manifest=synthetic(root);expected={'raw':4,'task':2,'qty':4,'classifications':{'TASK_CREATED':2,'DATA_HOLD':1,'UNSUPPORTED':1}}
 else:
  raw=INPUT_REPO/'data/raw/olist-v2';prepared=INPUT_REPO/'data/prepared/olist-indexed.sqlite';manifest=INPUT_REPO/'manifests/olist-v2.json'
  if sha(prepared)!=INDEX_SHA or any(pathlib.Path(str(prepared)+s).exists() for s in ['-wal','-shm']):raise RuntimeError('Indexed input SHA or WAL/SHM mismatch')
  expected={'raw':99441,'task':96596,'qty':None,'classifications':{'TASK_CREATED':96596,'DATA_HOLD':789,'UNSUPPORTED':2056}}
 source_manifest=json.loads(manifest.read_text())
 for row in source_manifest['files']:
  p=raw/row['fileName']
  if p.stat().st_size!=row['fileBytes'] or sha(p)!=row['fileSha256']:raise RuntimeError('Input fingerprint mismatch')
 experiment='e1b0-'+uuid.uuid4().hex[:16];db='e1b0_'+uuid.uuid4().hex[:16];run=str(uuid.uuid4())
 env={'MYSQL_DATABASE':db,'MYSQL_USER':'e1b0','MYSQL_PASSWORD':secrets.token_hex(32),
      'ADMIN_TOKEN':secrets.token_hex(32),'DEVICE_TOKEN':secrets.token_hex(32),'DEVICE_ID':'b0-synthetic-unused',
      'DATASET_RUN_ID':run,'BUSINESS_TIMEZONE':'Asia/Seoul'}
 def envfile(path,values):path.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));path.chmod(0o600)
 envfile(root/'runtime/app.env',env)
 envfile(root/'runtime/mysql.env',{k:v for k,v in env.items() if k.startswith('MYSQL_')}|{'MYSQL_ROOT_PASSWORD':secrets.token_hex(32)})
 inputs=[{'type':'bind','source':str((raw/n).resolve()),'target':'/inputs/raw/'+n,'read_only':True} for n in CSV_NAMES]
 inputs.extend([{'type':'bind','source':str(prepared.resolve()),'target':'/inputs/prepared.sqlite','read_only':True},{'type':'bind','source':str(manifest.resolve()),'target':'/inputs/manifest.json','read_only':True}])
 environment={'MYSQL_HOST':'mysql','MYSQL_PORT':'3306','REDIS_HOST':'redis','REDIS_PORT':'6379','API_HOST':'0.0.0.0','API_PORT':'3000','SOURCE_HOST':'0.0.0.0','SOURCE_PORT':'3100','SOURCE_URL':'http://source:3100','PREPARED_DB':'/inputs/prepared.sqlite','RAW_DIR':'/inputs/raw','SOURCE_MANIFEST':'/inputs/manifest.json','OUTBOX_LEASE_MS':'30000','B0_EXPERIMENT_ID':experiment,'B0_OBSERVE':'1' if observe else '0','B0_FILE_BYTES':str(512*1024**2),'B0_OBSERVATION_DIR':'/observations','TMPDIR':'/scratch'}
 services={}
 for name,entry in [('api','src/server/main'),('worker','src/server/worker-main'),('source','src/source/main'),('runner','tools/b0/monitor')]:
  services[name]={'image':image_id,'pull_policy':'never','env_file':[str(root/'runtime/app.env')],
   'environment':environment|{'B0_SERVICE':name,'B0_OBSERVE':('0' if name=='runner' else environment['B0_OBSERVE'])},
   'command':['node','dist/'+entry+'.js'],'volumes':inputs+[
    {'type':'bind','source':str(root/'metrics'/name),'target':'/observations'},
    {'type':'bind','source':str(root/'manifests'),'target':'/app/manifests'},
    {'type':'bind','source':str(root/'scratch'),'target':'/scratch'}],
   'cpus':QUOTAS[name],'mem_limit':LIMITS[name],'cpu_shares':1024,'networks':['isolated'],'restart':'no'}
  if name in ['api','source']:services[name]['ports']=[f'127.0.0.1:{PORTS[name]}:{3000 if name=="api" else 3100}']
  if name=='runner':
   services[name]['profiles']=['tools'];services[name]['volumes'].append({'type':'bind','source':str(root/'metrics/api'),'target':'/api-observations','read_only':True})
 services['mysql']={'image':'mysql:8.4@sha256:2068651a18ac6048578647ea57b940ca2daed3f504ebe7fba6a93beeb39aaa1f','pull_policy':'never','env_file':[str(root/'runtime/mysql.env')],'command':['--innodb-buffer-pool-size=512M','--innodb-flush-log-at-trx-commit=1','--sync-binlog=1'],'ports':['127.0.0.1:13307:3306'],'volumes':['mysql-data:/var/lib/mysql'],'healthcheck':{'test':['CMD-SHELL','MYSQL_PWD=$$MYSQL_PASSWORD mysql -h 127.0.0.1 -u$$MYSQL_USER -e "SELECT 1" $$MYSQL_DATABASE'],'interval':'2s','timeout':'3s','retries':60},'networks':['isolated'],'restart':'no'}
 services['redis']={'image':'redis:7.4-alpine@sha256:1cf73a2f04808e55a8bd2f5706c2aa0ebb0f71938f93deb7af79f48311cd5cb9','pull_policy':'never','command':['redis-server','--appendonly','yes','--appendfsync','everysec','--maxmemory-policy','noeviction','--maxmemory','0'],'ports':['127.0.0.1:16380:6379'],'volumes':['redis-data:/data'],'healthcheck':{'test':['CMD','redis-cli','ping'],'interval':'2s','timeout':'3s','retries':30},'networks':['isolated'],'restart':'no'}
 for name in ['mysql','redis']:services[name].update({'cpus':QUOTAS[name],'mem_limit':LIMITS[name],'cpu_shares':1024})
 compose={'name':experiment,'services':services,'networks':{'isolated':{'driver':'bridge','name':experiment+'-network'}},'volumes':{k:{'name':experiment+'-'+k} for k in ['mysql-data','redis-data']}}
 save(root/'runtime/compose.json',compose)
 m={'version':1,'createdAt':now(),'baseline':BASELINE,'root':str(root),'project':experiment,'database':db,'runId':run,'mode':mode,'observation':observe,'imageId':image_id,'imageProof':image_proof,'expected':expected,'ports':PORTS,'quotas':QUOTAS,'limits':LIMITS,'cpuMeaning':'Product+DB+Redis quota ceilings sum 4.0 CPU equivalents; runner adds 0.25 only while running. No cpuset pinning; shared host/cache/IO and unbounded host driver remain. This is not exclusive 4-core hardware.',
    'inputs':{str(p):sha(p) for p in [*[raw/n for n in CSV_NAMES],prepared,manifest]},'codeFiles':artifact_files(),'composeSha256':sha(root/'runtime/compose.json')}
 save(root/'manifest.json',m);guard(root);print(json.dumps({'lab':str(root),'mode':mode,'project':experiment,'status':'CONFIGURED_NOT_STARTED'}))

def load(root):
 root=pathlib.Path(root).resolve()
 if not root.is_relative_to(pathlib.Path('/home/leah/e1-lab')):raise RuntimeError('Unexpected experiment root')
 m=json.loads((root/'manifest.json').read_text())
 if m['root']!=str(root) or not m['project'].startswith('e1b0-') or m['baseline']!=BASELINE:raise RuntimeError('Target identity mismatch')
 return m

def guard(root):
 root=pathlib.Path(root).resolve();m=load(root);c=json.loads((root/'runtime/compose.json').read_text())
 if sha(root/'runtime/compose.json')!=m['composeSha256']:raise RuntimeError('Compose changed since init')
 if c['name']!=m['project'] or sum(v for k,v in m['quotas'].items() if k!='runner')!=4:raise RuntimeError('Project/quota mismatch')
 for service,spec in c['services'].items():
  if spec.get('pull_policy')!='never' or spec['cpus']!=QUOTAS[service]:raise RuntimeError('Unexpected runtime policy')
  for port in spec.get('ports',[]):
   if not port.startswith('127.0.0.1:') or int(port.split(':')[1]) not in PORTS.values():raise RuntimeError('Unsafe host port')
  for mount in spec.get('volumes',[]):
   if isinstance(mount,dict):
    source=pathlib.Path(mount['source']).resolve()
    if mount['target'].startswith('/inputs/'):
     if not mount.get('read_only') or str(source) not in m['inputs']:raise RuntimeError('Input mount must be individually read only')
    elif not source.is_relative_to(root):raise RuntimeError('Writable mount outside experiment')
   elif not mount.startswith(('mysql-data:','redis-data:')):raise RuntimeError('Unexpected named volume')
  for path in spec.get('env_file',[]):
   if not pathlib.Path(path).resolve().is_relative_to(root/'runtime') or pathlib.Path(path).stat().st_mode&0o077:raise RuntimeError('Unsafe environment file')
 for p,h in m['inputs'].items():
  if sha(p)!=h:raise RuntimeError('Input changed')
 if m['mode']=='smoke':
  meta=json.loads(pathlib.Path(next(p for p in m['inputs'] if p.endswith('manifest.json'))).read_text())
  if not meta['synthetic'] or next(f['rowCount'] for f in meta['files'] if f['fileName']==CSV_NAMES[0])>10:raise RuntimeError('Smoke must be at most ten synthetic orders')
 report={'status':'PASS','project':m['project'],'inputMounts':'six individual read-only files','writableBinds':'experiment root only','ports':PORTS,'productCpuQuotaSum':4,'runnerCpuQuota':.25,'cpuMeaning':m['cpuMeaning'],'legacyServiceControl':'NONE','sourceIdentity':m['inputs']}
 save(root/'output/isolation.json',report);return m

def compose(root,*args,timeout=120,check=True):
 m=load(root);return cmd(['docker','compose','-p',m['project'],'-f',str(pathlib.Path(root)/'runtime/compose.json'),*args],timeout=timeout,check=check)

def runner(root,entry,*args,env=None,timeout=120):
 command=['run','--rm','-T','--no-deps']
 for k,v in (env or {}).items():command+=['-e',k+'='+v]
 p=compose(root,*command,'runner','node','dist/'+entry+'.js',*args,timeout=timeout,check=False)
 # Store any diagnostics privately; do not reflect SQL/errors/secret-bearing config into summaries.
 path=pathlib.Path(root)/'output'/('runner-'+pathlib.Path(entry).name+'-'+uuid.uuid4().hex[:8]+'.txt')
 path.write_text(p.stdout+'\nSTDERR\n'+p.stderr);path.chmod(0o600)
 if p.returncode:raise RuntimeError('Sandbox runner failed; private log: '+path.name)
 return p.stdout

def json_last(text):
 for line in reversed(text.splitlines()):
  try:return json.loads(line)
  except ValueError:pass
 raise RuntimeError('No structured result')

def inspect_runtime(root):
 m=load(root);rows=[]
 for service in ['mysql','redis','api','worker','source']:
  cid=compose(root,'ps','-q',service).stdout.strip()
  if not cid:raise RuntimeError('Missing experiment service '+service)
  d=json.loads(cmd(['docker','inspect',cid]).stdout)[0]
  if d['Config']['Labels'].get('com.docker.compose.project')!=m['project']:raise RuntimeError('Runtime project mismatch')
  if service in ['api','worker','source'] and d['Image']!=m['imageId']:raise RuntimeError('Runtime image mismatch')
  if d['HostConfig']['NanoCpus']!=int(QUOTAS[service]*10**9) or d['HostConfig']['Memory']!=LIMITS[service] or d['HostConfig']['CpuShares']!=1024:raise RuntimeError('Actual quota/memory/shares mismatch')
  if any(name!=m['project']+'-network' for name in d['NetworkSettings']['Networks']):raise RuntimeError('Unexpected runtime network')
  mounts=[]
  for mount in d['Mounts']:
   source=pathlib.Path(mount['Source'])
   if mount['Type']=='bind' and mount['RW'] and not source.is_relative_to(pathlib.Path(root)):raise RuntimeError('Unsafe live mount')
   if mount['Type']=='volume' and not mount['Name'].startswith(m['project']+'-'):raise RuntimeError('Legacy volume reference')
   mounts.append({k:mount.get(k) for k in ['Type','Source','Destination','RW','Name']})
  rows.append({'service':service,'containerId':cid,'imageId':d['Image'],'cpuNano':d['HostConfig']['NanoCpus'],'memoryLimit':d['HostConfig']['Memory'],'mounts':mounts,'running':d['State']['Running']})
 save(pathlib.Path(root)/'output/runtime-isolation.json',rows);return rows

def start(root):
 root=pathlib.Path(root);m=guard(root);ports_free()
 if artifact_files()!=m['codeFiles']:raise RuntimeError('Preparation source/host driver changed since init; use a new lab')
 inspect_image(m['imageId'])
 if (root/'output/started.json').exists():raise RuntimeError('One-shot lab already started; preserve it and create a new lab')
 if compose(root,'ps','-aq').stdout.strip():raise RuntimeError('Existing experiment containers refused')
 for name in ['mysql-data','redis-data']:
  if cmd(['docker','volume','inspect',m['project']+'-'+name],check=False).returncode==0:raise RuntimeError('Pre-existing experiment volume refused')
 save(root/'output/started.json',{'at':now(),'mode':m['mode']})
 compose(root,'up','-d','--no-build','--pull','never','--wait','mysql','redis',timeout=180)
 runner(root,'tools/migrate',timeout=120)
 runner(root,'tools/seed',timeout=180 if m['mode']=='smoke' else 900)
 compose(root,'up','-d','--no-build','--pull','never','source','worker','api')
 deadline=time.monotonic()+60
 while True:
  try:
   with urllib.request.urlopen('http://127.0.0.1:13000/api/v1/ready',timeout=3) as r:
    if json.load(r)['status']=='ok':break
  except Exception:pass
  if time.monotonic()>deadline:raise RuntimeError('Sandbox readiness deadline')
  time.sleep(1)
 rows=inspect_runtime(root)
 script="const fs=require('fs'),c=require('crypto');const r={};function walk(p){if(!fs.existsSync(p))return;if(fs.statSync(p).isDirectory()){for(const f of fs.readdirSync(p))walk(p+'/'+f);}else r[p]=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}for(const p of ['src','dist/src','dist/tools','package-lock.json','docs/openapi.yaml','migrations'])walk(p);console.log(JSON.stringify(r));"
 cid=next(r['containerId'] for r in rows if r['service']=='api')
 files=json.loads(cmd(['docker','exec',cid,'node','-e',script]).stdout)
 before_clock=now();container_clock=int(cmd(['docker','exec',cid,'node','-e','console.log(Date.now())']).stdout);after_clock=now()
 aligned=datetime.datetime.fromisoformat(before_clock).timestamp()*1000-2<=container_clock<=datetime.datetime.fromisoformat(after_clock).timestamp()*1000+2
 save(root/'output/clock-sample.json',{'alignment':'BRACKETED_AT_START' if aligned else 'UNKNOWN','hostBefore':before_clock,'containerWallMs':container_clock,'hostAfter':after_clock,'precision':'Wall millisecond sample bounded by host request interval; no exact cross-process commit order guarantee'})
 save(root/'output/artifact-hashes.json',{'imageId':m['imageId'],'files':files,'baseline':BASELINE,'sourceWorkingTree':m['codeFiles'],'scope':'All app services and CLI runner use the same immutable image ID.'})
 config=compose(root,'exec','-T','redis','redis-cli','--raw','CONFIG','GET','appendonly','appendfsync','maxmemory-policy','maxmemory').stdout.splitlines()
 save(root/'output/redis-config.json',dict(zip(config[::2],config[1::2])))

class Policy:
 def __init__(self):self.since={};self.no_progress_at=None;self.progress=None
 def sustained(self,name,bad,t,seconds):
  if not bad:self.since.pop(name,None);return False
  self.since.setdefault(name,t);return t-self.since[name]>=seconds
 def evaluate(self,t,*,memory_available,memory_ratios,backlog,progress,integrity=True,oom=False,io_error=False,disk_free=10*1024**3):
  if not integrity or oom or io_error:return 'STOP_NOW'
  if self.progress!=progress:self.progress=progress;self.no_progress_at=t
  if self.no_progress_at is None:self.no_progress_at=t
  if self.sustained('host_memory',memory_available<2*1024**3,t,20):return 'STOP_SUPPLY'
  if self.sustained('container_memory',any(r>.8 for r in memory_ratios),t,30):return 'STOP_SUPPLY'
  if disk_free<2*1024**3:return 'STOP_SUPPLY'
  if backlog>0 and t-self.no_progress_at>=60:return 'STOP_SUPPLY'
  return 'CONTINUE' # oldest age intentionally is not a stop input


class Lifecycle:
 """Pure, tested supply/drain/termination decisions. Never sends a kill signal."""
 def __init__(self,deadline,drain_seconds):
  self.deadline=deadline;self.drain_seconds=drain_seconds;self.drain_deadline=None
  self.supply_stopped=False;self.stable=0;self.first_zero=None
 def step(self,t,action,source_done,complete,empty,observed_at):
  if action=='STOP_NOW':return 'STOP_NOW'
  if not self.supply_stopped and (action=='STOP_SUPPLY' or t>=self.deadline):
   self.supply_stopped=True;self.drain_deadline=t+self.drain_seconds;return 'STOP_SUPPLY'
  if source_done and self.drain_deadline is None:self.drain_deadline=t+self.drain_seconds
  if empty and source_done and complete:
   if self.first_zero is None:self.first_zero=observed_at
   self.stable+=1
   if self.stable>=3:return 'DRAIN_COMPLETE'
  else:self.stable=0;self.first_zero=None
  if self.drain_deadline is not None and t>=self.drain_deadline:return 'DRAIN_TIMEOUT'
  return 'OBSERVE'

def resources(root):
 m=load(root);t=now();rows=[]
 for service in ['api','worker','source','mysql','redis']:
  cid=compose(root,'ps','-aq',service).stdout.strip()
  if not cid:continue
  p=cmd(['docker','exec',cid,'cat','/proc/1/stat','/proc/1/status'],timeout=10,check=False)
  record={'service':service,'wallTime':t,'samplingScope':'container PID1; HWM covers process lifetime','cpuQuota':QUOTAS[service]}
  if p.returncode==0:
   lines=p.stdout.splitlines();stat=lines[0].rsplit(')',1)[1].split()
   record.update({'utimeTicks':int(stat[11]),'stimeTicks':int(stat[12]),'clockTicksPerSecond':os.sysconf('SC_CLK_TCK')})
   for line in lines[1:]:
    if line.startswith(('VmRSS:','VmHWM:')):record[line.split(':')[0]+'Bytes']=int(line.split()[1])*1024
  else:record['processResource']='UNKNOWN'
  d=json.loads(cmd(['docker','inspect',cid]).stdout)[0];record['oomKilled']=d['State']['OOMKilled'];record['runtimeError']=bool(d['State'].get('Error'))
  stats=cmd(['docker','stats','--no-stream','--format','{{json .}}',cid],timeout=10,check=False)
  if stats.returncode==0 and stats.stdout.strip():
   v=json.loads(stats.stdout.strip());record['containerStats']={k:v.get(k) for k in ['CPUPerc','MemUsage','MemPerc','BlockIO','NetIO','PIDs']};record['memoryRatio']=float(v['MemPerc'].rstrip('%'))/100
  rows.append(record)
 mem={l.split(':')[0]:int(l.split()[1])*1024 for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith(('MemAvailable:','MemTotal:'))}
 return {'wallTime':t,'monotonicNs':time.monotonic_ns(),'host':mem,'diskFreeBytes':shutil.disk_usage(root).free,'processes':rows,'scope':'Sampled RSS peaks are lower bounds; Docker MemUsage is not process RSS. Host and observer are shared with other services.'}

def coverage(root,validation):
 root=pathlib.Path(root);m=load(root);kinds={};seen={};sql={};health=[];anomalies=[];first={};task_times={};histograms={};last_effect=None
 for service in ['api','worker','source']:
  health+= [json.loads(p.read_text()) for p in (root/'metrics'/service).glob('*.health.json')]
  for p in (root/'metrics'/service).glob('*.jsonl'):
   last=0;previous_clock=None
   with p.open() as stream:
    for line in stream:
     try:r=json.loads(line)
     except ValueError:anomalies.append('TRUNCATED_OR_INVALID_JSON');continue
     if r['sequence']!=last+1:anomalies.append('SEQUENCE_GAP')
     last=r['sequence']
     wall=datetime.datetime.fromisoformat(r['wallTime'].replace('Z','+00:00')).timestamp();mono=int(r['monotonicNs'])/10**9
     if previous_clock and abs((wall-previous_clock[0])-(mono-previous_clock[1]))>1:anomalies.append('CLOCK_INTERVAL_ANOMALY')
     previous_clock=(wall,mono)
     kinds[r['kind']]=kinds.get(r['kind'],0)+1
     if r['kind']=='sql':sql[r['label']]=sql.get(r['label'],0)+1
     if 'durationMs' in r:
      key=r['kind']+':'+r['label'];buckets=[.1,.25,.5,1,2,5,10,20,50,100,250,500,1000,5000,15000,60000]
      h=histograms.setdefault(key,{'count':0,'sumMs':0,'maxMs':0,'upperBoundsMs':buckets,'bucketCounts':[0]*(len(buckets)+1)})
      v=r['durationMs'];h['count']+=1;h['sumMs']+=v;h['maxMs']=max(h['maxMs'],v);h['bucketCounts'][next((i for i,b in enumerate(buckets) if v<=b),len(buckets))]+=1
     key={'raw_order_created':'rawId','task_created':'taskId','outbox_write_resolved':'jobId'}.get(r['kind'])
     if key:seen.setdefault(r['kind'],set()).add(r[key])
     if r['kind']=='outbox_write_resolved':first.setdefault(r['jobId'],r['wallTime'])
     if r['kind']=='task_created':task_times[r['taskId']]=r['wallTime']
     if r['kind'] in ['raw_order_created','task_created','source_eof']:
      stamp=datetime.datetime.fromisoformat(r['wallTime'].replace('Z','+00:00'));last_effect=stamp if last_effect is None else max(last_effect,stamp)
 if m['observation']:
  for kind,key in [('raw_order_created','rawIds'),('task_created','taskIds'),('outbox_write_resolved','jobIds')]:
   if seen.get(kind,set())!=set(validation[key]):anomalies.append(kind.upper()+'_DB_COVERAGE_MISMATCH')
  if {h['service'] for h in health}!={'api','worker','source'}:anomalies.append('MISSING_PROCESS_HEALTH')
  for h in health:
   if not h['cleanClose'] or h['errors'] or h['dropped'] or h['candidateDrops']:anomalies.append('UNCLEAN_OR_LOSSY_PROCESS')
 else:
  if health or kinds:anomalies.append('OFF_PRODUCED_RECORDS')
 t0=json.loads((root/'output/t0.json').read_text())['wallTime']
 origin=datetime.datetime.fromisoformat(t0.replace('Z','+00:00'));latencies=[(datetime.datetime.fromisoformat(v.replace('Z','+00:00'))-origin).total_seconds() for v in task_times.values()]
 if any(v<0 for v in latencies):anomalies.append('NEGATIVE_T0_TASK_CLOCK_INTERVAL')
 finish=last_effect
 measured_sql={}
 if finish:
  for service in ['api','worker','source']:
   for path in (root/'metrics'/service).glob('*.jsonl'):
    with path.open() as stream:
     for line in stream:
      try:r=json.loads(line)
      except ValueError:continue
      when=datetime.datetime.fromisoformat(r['wallTime'].replace('Z','+00:00'))
      if r['kind']=='sql' and origin<=when<=finish:measured_sql[r['label']]=measured_sql.get(r['label'],0)+1

 result={'status':'INVALID' if anomalies else 'VALID' if m['observation'] else 'OFF_CONFIRMED','anomalies':sorted(set(anomalies)),'kindCounts':kinds,'sqlCounts':sql,'sqlCountsScope':'process lifetime including readiness/idle/drain; not the processing-window total','processingWindow':{'start':t0,'end':finish.isoformat() if finish else None,'definition':'SQL completion observed between t0 and the last raw/task/EOF observation'},'processingWindowSqlCounts':measured_sql if finish else 'UNKNOWN','clientDurationHistogramsScope':'process lifetime; raw timestamped records permit window selection','clientDurationHistograms':histograms,'health':health,'newRawObserved':len(seen.get('raw_order_created',set())),'newTaskObserved':len(seen.get('task_created',set())),
 'enqueueCoverage':{'observedFinalJobs':len(set(validation['jobIds'])&first.keys()),'finalJobs':len(validation['jobIds']),'note':'Successful ON DUPLICATE KEY write candidates are filtered by final DB IDs, never counted as inserts solely from a log.'},
 't0ToTaskCommitSuccessObservedSeconds':latencies,'rawToTaskLatency':'UNKNOWN (cross-process observation order/clock precision not validated as exact commit order)',
 'poolWait':'UNKNOWN','lockDuration':'UNKNOWN','generalApiP95':'NOT_MEASURED (one start POST)','atomicity':'Sidecar is not atomic with DB. Missing health, sequence gaps, loss, crash or DB ID mismatch invalidates detailed coverage.'}
 save(root/'output/coverage.json',result);return result

def validate_expected(m,v):
 c=v['state']['counts'];expected=m['expected'];classes={r['status']:int(r['count']) for r in v['state']['classifications']}
 if int(c['rawCount'])!=expected['raw'] or int(c['taskCount'])!=expected['task'] or classes!=expected['classifications']:raise RuntimeError('Final business denominator mismatch')
 if any(int(c[k]) for k in ['badTasks','eventCount','reports','appliedQty']):raise RuntimeError('Unexpected assignment/confirmation/event/report effect')
 if expected['qty'] is not None and int(c['requiredQty'])!=expected['qty']:raise RuntimeError('Quantity mismatch')
 if int(v['variables']['bufferPoolBytes'])!=512*1024**2 or int(v['variables']['flushCommit'])!=1 or int(v['variables']['syncBinlog'])!=1:raise RuntimeError('MySQL durability setting mismatch')

def run(root,full=False):
 root=pathlib.Path(root).resolve();m=guard(root)
 if (m['mode']=='olist')!=full:raise RuntimeError('Use explicit run-b0 only for real input; smoke requires synthetic mode')
 start(root);policy=Policy();timeline=[];monitor=None;observations=queue.Queue(maxsize=4);raw_monitor=root/'output/monitor.jsonl'
 command=['docker','compose','-p',m['project'],'-f',str(root/'runtime/compose.json'),'run','--rm','-T','--no-deps','runner','node','dist/tools/b0/monitor.js']
 private_error=(root/'output/monitor-stderr.txt').open('w')
 monitor=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=private_error,text=True)
 def reader():
  with raw_monitor.open('x') as f:
   for line in monitor.stdout:
    if f.tell()<64*1024**2:f.write(line);f.flush()
    else:
     if not observations.full():observations.put_nowait({'error':'OBSERVER_OUTPUT_CAP'})
     continue
    try:v=json.loads(line)
    except ValueError:continue
    if observations.full():
     try:observations.get_nowait()
     except queue.Empty:pass
    observations.put_nowait(v)
 thread=threading.Thread(target=reader,daemon=True);thread.start()
 try:
  if full:
   for _ in range(12):time.sleep(5) # input-free 60s; no claim about cold cache
  env=dict(l.split('=',1) for l in (root/'runtime/app.env').read_text().splitlines())
  request=urllib.request.Request('http://127.0.0.1:13000/api/v1/ingestion/runs',data=json.dumps({'datasetRunId':m['runId'],'requestId':str(uuid.uuid4())}).encode(),headers={'Authorization':'Bearer '+env['ADMIN_TOKEN'],'Content-Type':'application/json'},method='POST')
  t0={'wallTime':now(),'monotonicNs':time.monotonic_ns(),'definition':'Immediately before driver sends ingestion start POST; payload sourceAvailableAt unchanged'}
  try:
   with urllib.request.urlopen(request,timeout=20) as response:response.read();status=response.status
   save(root/'output/t0.json',t0)
   save(root/'output/start-post.json',{'status':status,'responseCompletedAt':now(),'dispatched':1,'finished':1,'timeout':0})
  except Exception:
   save(root/'output/t0.json',t0)
   save(root/'output/start-post.json',{'status':'TRANSPORT_OR_HTTP_ERROR','responseCompletedAt':now(),'dispatched':1,'finished':0});raise RuntimeError('Start POST failed')
  origin=time.monotonic();deadline=origin+(45*60 if full else 90);lifecycle=Lifecycle(deadline,20*60 if full else 30);last_state=None
  with (root/'output/resources.jsonl').open('x') as resource_file:
   while time.monotonic()<deadline+(20*60 if full else 30):
    try:state=observations.get(timeout=15)
    except queue.Empty:raise RuntimeError('No observer progress; preserve sandbox')
    if 'error' in state:raise RuntimeError('Observer query failed')
    last_state=state;counts=state['counts'];jobs={r['status']:int(r['count']) for r in state['jobs']};remaining=sum(v for k,v in jobs.items() if k!='DONE');q=state['queue'];queue_pending=sum(q.get(k,0) for k in ['waiting','active','delayed','failed'])
    resources_row=resources(root);resource_file.write(json.dumps(resources_row)+'\n');resource_file.flush()
    action=policy.evaluate(time.monotonic()-origin,memory_available=resources_row['host']['MemAvailable'],memory_ratios=[r.get('memoryRatio',0) for r in resources_row['processes']],backlog=remaining+max(0,m['expected']['raw']-int(counts['rawCount'])),progress=(int(counts['rawCount']),int(counts['taskCount'])),integrity=state['checkpoint']!='FAILED' and not any(int(counts[k]) for k in ['badTasks','eventCount','reports','appliedQty']) and not jobs.get('FAILED',0),oom=any(r.get('oomKilled') for r in resources_row['processes']),io_error=any(r.get('runtimeError') for r in resources_row['processes']),disk_free=resources_row['diskFreeBytes'])
    complete=int(counts['rawCount'])==m['expected']['raw'] and int(counts['taskCount'])==m['expected']['task']
    decision=lifecycle.step(time.monotonic(),action,state['checkpoint']=='DONE',complete,remaining==0 and queue_pending==0,state['wallTime'])
    if decision=='STOP_NOW':timeline.append({'at':now(),'action':decision});raise RuntimeError('Immediate safety stop')
    if decision=='STOP_SUPPLY':
     timeline.append({'at':now(),'action':decision,'reason':action if action!='CONTINUE' else 'WORKLOAD_DEADLINE'});compose(root,'stop','-t','20','api')
    if decision=='DRAIN_COMPLETE':
     timeline.append({'at':now(),'action':'DRAIN_STABLE','firstZeroObservedAt':lifecycle.first_zero,'note':'Three complete observations at the observer sample times; stable confirmation includes waiting.'})
     if lifecycle.supply_stopped:raise RuntimeError('Supply stopped by policy/deadline; drain completed but sample remains stopped')
     break
    if decision=='DRAIN_TIMEOUT':raise RuntimeError('Bounded drain deadline')
   else:raise RuntimeError('Total execution deadline')
  validation=json_last(runner(root,'tools/b0/monitor','--validate'));validate_expected(m,validation)
  save(root/'output/business-validation.json',validation)
  # Supply has finished; close only experiment app services so sidecars can flush.
  compose(root,'stop','-t','30','api','worker','source');cov=coverage(root,validation)
  if m['observation'] and cov['status']!='VALID':raise RuntimeError('Observation coverage invalid')
  if full:
   audit_start=now();result=runner(root,'tools/audit-source',env={'AUDIT_OUTPUT':'/scratch/final-audit.json','B0_OBSERVE':'0'},timeout=300)
   audit=json_last(result);save(root/'output/final-audit.json',audit)
   if audit.get('status')!='PASS':raise RuntimeError('Independent audit failed')
   timeline.append({'action':'AUDIT_COMPLETE','startedAt':audit_start,'at':now()})
  save(root/'output/result.json',{'status':'PASS','input':'ACTUAL_OLIST_B0' if full else 'SYNTHETIC_ONLY','expected':m['expected'],'coverage':cov['status'],'timeline':timeline,'performanceClaim':'NONE; smoke is not an overhead or throughput experiment'})
 except Exception as error:
  save(root/'output/result.json',{'status':'FAIL','input':m['mode'],'reason':str(error) if isinstance(error,RuntimeError) else 'EXECUTION_ERROR','timeline':timeline,'preserved':True});raise
 finally:
  if monitor:
   # docker compose run's client is not a service; stop its project-labeled runner container first.
   ids=cmd(['docker','ps','-q','--filter','label=com.docker.compose.project='+m['project'],'--filter','label=com.docker.compose.service=runner'],check=False).stdout.split()
   if ids:cmd(['docker','stop','-t','10',*ids],timeout=30,check=False)
   try:monitor.wait(timeout=15)
   except subprocess.TimeoutExpired:monitor.terminate();monitor.wait(timeout=5)
   thread.join(timeout=5);private_error.close()
  compose(root,'stop','-t','30',timeout=90,check=False) # retain containers/volumes; no down, flush or destructive cleanup


def main():
 p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='action',required=True)
 q=sub.add_parser('init');q.add_argument('--root',type=pathlib.Path,required=True);q.add_argument('--image',required=True);q.add_argument('--mode',choices=['smoke','olist'],required=True);q.add_argument('--observe',choices=['on','off'],default='on')
 for name in ['check','smoke','semantics','verify','run-b0']:
  q=sub.add_parser(name);q.add_argument('--lab',type=pathlib.Path,required=True)
  if name=='run-b0':q.add_argument('--execute-full-b0',action='store_true',required=True)
 a=p.parse_args()
 if a.action=='init':init(a.root,a.image,a.mode,a.observe=='on')
 elif a.action=='check':print(json.dumps(guard(a.lab)))
 elif a.action in ['smoke','run-b0']:
  try:run(a.lab,a.action=='run-b0');print(json.dumps({'status':'PASS','results':str(a.lab/'output')}))
  except Exception as error:
   if (a.lab/'output/started.json').exists():
    if not (a.lab/'output/result.json').exists():save(a.lab/'output/result.json',{'status':'FAIL','reason':str(error) if isinstance(error,RuntimeError) else type(error).__name__,'preserved':True})
    compose(a.lab,'stop','-t','30',timeout=90,check=False)
   raise
 elif a.action=='verify':
  m=guard(a.lab);validation=json.loads((a.lab/'output/business-validation.json').read_text());validate_expected(m,validation)
  cov=coverage(a.lab,validation);result={'status':'PASS' if cov['status'] in ['VALID','OFF_CONFIRMED'] else 'FAIL','scope':'Postprocess the saved actual smoke DB snapshot and preserved sidecars; original execution failures remain unchanged','coverage':cov['status'],'reviewedAt':now(),'reviewToolSha256':sha(__file__)}
  save(a.lab/'output/review.json',result);print(json.dumps(result))
  if result['status']!='PASS':raise RuntimeError('Postprocessing coverage failed')
 elif a.action=='semantics':
  m=guard(a.lab)
  if m['mode']!='smoke':raise RuntimeError('Semantics requires synthetic sandbox')
  # The smoke command preserved infrastructure but stopped it. Restart only its existing DB/Redis.
  compose(a.lab,'up','-d','--no-build','--pull','never','--wait','mysql','redis',timeout=120)
  try:
   result=json_last(runner(a.lab,'tools/b0/semantics',env={'B0_OBSERVE':'1','B0_OBSERVATION_DIR':'/observations/semantics'},timeout=60));save(a.lab/'output/semantics.json',result);print(json.dumps(result))
  finally:compose(a.lab,'stop','-t','30',timeout=90,check=False)
if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'status':'FAIL','reason':str(error) if isinstance(error,RuntimeError) else type(error).__name__}));raise SystemExit(1)
