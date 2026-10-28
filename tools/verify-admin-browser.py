"""Actual Windows headless Chrome UI acceptance; existing browser + isolated test API.

Prerequisites: browser-admin-fixture.ts, loopback API3301 using logistics_test,
and a dedicated headless Chrome whose {port,profile,appPort:3301} is in ignored var.
Secrets enter the browser through stdin/CDP Input.insertText, never command arguments.
No reset, source download, camera simulation, or production mutation occurs here.
"""
import argparse, base64, datetime, hashlib, json, pathlib, subprocess, time

parser = argparse.ArgumentParser()
parser.add_argument('--resume-reports', action='store_true')
parser.add_argument('--info', default='var/admin-browser.json')
parser.add_argument('--plan', default='var/admin-ui-plan.json')
parser.add_argument('--report', default='reports/admin-browser.json')
args = parser.parse_args()
info = json.loads(pathlib.Path(args.info).read_text(encoding='utf-8-sig'))
plan = json.loads(pathlib.Path(args.plan).read_text())
if info.get('appPort') != 3301 or plan['scope'] != 'SYNTHETIC_BROWSER_FIXTURE_NOT_OLIST':
    raise RuntimeError('Expected isolated browser fixture/API')
env = dict(line.split('=', 1) for line in pathlib.Path('.env.test').read_text().splitlines()
           if '=' in line and not line.lstrip().startswith('#'))
if env.get('MYSQL_DATABASE') != 'logistics_test':
    raise RuntimeError('Expected logistics_test')
script = pathlib.Path('tools/windows-cdp.ps1').read_text()
encoded = base64.b64encode(script.encode('utf-16le')).decode()
report = {'status': 'RUNNING', 'scope': 'Actual Windows headless browser, React events and HTTP; SYNTHETIC isolated test data',
          'runId': plan['runId'], 'apiPort': 3301, 'checks': [],
          'webSha256': hashlib.sha256(pathlib.Path('web/main.tsx').read_bytes()).hexdigest()}

def save():
    report['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    pathlib.Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')

def command(method, params=None):
    payload = {'port': info['port'], 'appPort': 3301, 'method': method, 'params': params or {}}
    if isinstance(method, list):
        payload['commands'] = method
    run = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                         input=json.dumps(payload), encoding='utf-8', text=True, capture_output=True, errors='replace', timeout=35)
    if run.returncode:
        raise RuntimeError('Windows CDP command failed: '+method)
    return json.loads(run.stdout)

def evaluate(expression):
    result = command('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
    if result.get('exceptionDetails'):
        raise RuntimeError('Browser expression failed')
    return result['result'].get('value')

def wait(expression, timeout=10):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        if evaluate(expression):
            return
        time.sleep(.15)
    raise AssertionError('UI condition timed out: '+expression)

def click(label):
    evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==="+json.dumps(label)+
             ");if(!b||b.disabled)throw Error('Button unavailable');b.click();return true;})()")

def fill(selector, value):
    evaluate("(()=>{const i=document.querySelector("+json.dumps(selector)+
             ");if(!i)throw Error('Input missing');i.focus();i.select();return true;})()")
    command('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': 'a', 'code': 'KeyA', 'modifiers': 2})
    command('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': 'a', 'code': 'KeyA', 'modifiers': 2})
    command('Input.insertText', {'text': str(value)})

def status(value):
    evaluate("(()=>{const s=document.querySelector('select[aria-label=\"상태 필터\"]');s.value="+
             json.dumps(value)+";s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
    click('조회·새로고침')

rows = "document.querySelectorAll('.grid section:first-child tbody tr').length"
detail = "JSON.parse(document.querySelector('pre.json').textContent)"

def open_row(prefix):
    evaluate("(()=>{const b=[...document.querySelectorAll('.grid section:first-child tbody button')].find(b=>b.textContent==="+
             json.dumps(prefix)+");if(!b)throw Error('Row unavailable');b.click();return true;})()")
    wait("!!document.querySelector('pre.json')")
    evaluate("(()=>{const d=document.querySelector('details');if(!d.open)d.querySelector('summary').click();return d.open;})()")

def check(requirement, name, evidence):
    report['checks'].append({'requirement': requirement, 'name': name, 'status': 'PASS', 'evidence': evidence})
    save()

try:
    if args.resume_reports:
        previous=json.loads(pathlib.Path(args.report).read_text())
        if previous['runId']!=plan['runId'] or previous['webSha256']!=report['webSha256']:
            raise RuntimeError('Resume evidence source/run mismatch')
        report['checks']=previous['checks']
        report['browser']=previous['browser']
    else:
        report['browser'] = command('Browser.getVersion')['product']
        command('Page.reload', {'ignoreCache': True})
        wait("!!document.querySelector('input[aria-label=\"운영자 토큰\"]')")
        fill('input[aria-label="운영자 토큰"]', env['ADMIN_TOKEN'])
        evaluate("(()=>{document.querySelector('form').requestSubmit();return true;})()")
        wait("!!document.querySelector('nav.tabs')")
        fill('input[aria-label="datasetRunId"]', plan['runId'])
        click('조회·새로고침')
        wait(rows+'===50')
        first = evaluate("[...document.querySelectorAll('.grid section:first-child tbody button')].map(x=>x.textContent)")
        click('다음 50건')
        wait(rows+'===4')
        second = evaluate("[...document.querySelectorAll('.grid section:first-child tbody button')].map(x=>x.textContent)")
        assert not set(first) & set(second), 'Repeated rows across browser pages'
        click('처음')
        wait(rows+'===50')
        status('DATA_HOLD')
        wait(rows+'===1')
        status('')
        fill('input[aria-label="원본 주문 ID 검색"]', plan['searchSourceOrderId'])
        click('조회·새로고침')
        wait(rows+'===1')
        open_row(plan['searchSourceOrderId'][:12])
        wait("!!document.querySelector('pre.json')")
        assert evaluate(detail+'.order.id') == plan['searchOrderId']
        assert evaluate(detail+'.items.reduce((n,i)=>n+i.requiredQty,0)') == 3
        check('M-A01', 'orders list, page50+4, status filter, full-key search, raw/normalized detail', {'orders':54,'pages':[50,4],'searchedRows':1,'requiredQty':3})

        click('출고 작업')
        status('CONFIRMED')
        wait(rows+'===1')
        open_row(plan['confirmedTaskId'][:12])
        wait("!!document.querySelector('pre.json') && "+detail+".task?.status==='CONFIRMED'")
        assert evaluate(detail+'.eventBodies.length') == 4
        assert evaluate(detail+'.task.items.reduce((n,i)=>n+i.appliedQty,0)') == 3
        check('M-A02', 'confirmed task shows quantity and retained event bodies', {'events':4,'appliedQty':3})
        status('CREATED')
        wait(rows+'===50')
        open_row(plan['assignmentTaskId'][:12])
        wait("!!document.querySelector('pre.json') && "+detail+".task?.id==="+json.dumps(plan['assignmentTaskId']))
        click('최초 배정 확인')
        wait("document.querySelector('[role=alert]')?.textContent==='변경 사유를 입력하세요.'")
        fill('.grid section:nth-child(2) textarea', 'Synthetic browser assignment acceptance')
        fill('.grid section:nth-child(2) input', plan['deviceId'])
        click('최초 배정 확인')
        wait(detail+".task.status==='ASSIGNED'")
        assert evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='최초 배정 확인').disabled")
        assert evaluate(detail+'.task.assignmentVersion') == 1
        check('M-A03', 'reason required; device selection, first assignment and disabled reassignment button', {'assignmentVersion':1})
        fill('.grid section:nth-child(2) textarea', 'Synthetic browser operator note')
        click('운영 메모 저장')
        wait(detail+'.notes.length===1')
        check('M-A02', 'operator note displayed after save', {'notes':1})

        click('서버 작업')
        status('FAILED')
        wait(rows+'===2')
        open_row(plan['transientJobId'][:12])
        wait("!!document.querySelector('pre.json') && "+detail+".id==="+json.dumps(plan['transientJobId']))
        assert evaluate(detail+'.attempts') == 5
        assert evaluate(detail+'.errorCode') == 'TRANSIENT_ERROR'
        fill('.grid section:nth-child(2) textarea', 'Synthetic transient cause resolved')
        click('실패 job 재시도')
        wait(detail+".status==='PENDING'")
        assert evaluate(detail+'.attempts') == 0
        assert evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='실패 job 재시도').disabled")
        open_row(plan['permanentJobId'][:12])
        wait(detail+'.id==='+json.dumps(plan['permanentJobId']))
        fill('.grid section:nth-child(2) textarea', 'Synthetic permanent failure must remain blocked')
        click('실패 job 재시도')
        wait("document.querySelector('[role=alert]')?.textContent==='PERMANENT_JOB_ERROR'")
        check('M-A04', 'failed attempts/error shown; transient retry resets detail, permanent retry rejected', {'failedAttempts':5,'resetAttempts':0,'permanentCode':'PERMANENT_JOB_ERROR'})

        click('주문')
        status('DATA_HOLD')
        wait(rows+'===1')
        evaluate("(()=>{document.querySelector('.grid section:first-child tbody button').click();return true;})()")
        wait("!!document.querySelector('fieldset')")
        evaluate("(()=>{const d=document.querySelector('details');if(!d.open)d.querySelector('summary').click();return d.open;})()")
        while evaluate("document.querySelectorAll('fieldset').length") > 1:
            evaluate("(()=>{[...document.querySelectorAll('fieldset button')].at(-1).click();return true;})()")
        fill('fieldset input:nth-of-type(1)', 'a'*32)
        inputs = evaluate("document.querySelectorAll('fieldset input').length")
        assert inputs == 3
        fill('fieldset label:nth-of-type(2) input', 'd'*32)
        fill('fieldset input[type=number]', 3)
        fill('.grid section:nth-child(2) textarea', 'Synthetic product evidence correction; original preserved')
        click('정정 저장·재검증')
        wait(detail+".order.revision===2 && "+detail+".order.status==='READY'")
        assert evaluate(detail+'.audit.length') == 1
        assert evaluate(detail+'.items[0].requiredQty') == 3
        check('M-A01/M-A02', 'synthetic DATA_HOLD correction and audit displayed', {'revision':2,'requiredQty':3,'auditEntries':1})

        click('단말')
        wait(rows+'>0')
        open_row(plan['deviceId'][:12])
        wait("!!document.querySelector('pre.json') && "+detail+'.id==='+json.dumps(plan['deviceId']))
        assert evaluate(detail+'.stale') is True
        assert evaluate(detail+'.lastReport.pendingCount') == 7
        check('M-A05', 'stale device, last observation and pending count displayed', {'stale':True,'pendingCount':7})

    click('일별 보고서')
    if evaluate("document.querySelector('input[type=date]').value") != plan['businessDate']:
        evaluate("(()=>{const d=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(d,"+
                 json.dumps(plan['businessDate'])+");d.dispatchEvent(new Event('input',{bubbles:true}));d.dispatchEvent(new Event('change',{bubbles:true}));return true;})()")
    click('집계 조회')
    wait("document.body.innerText.includes('확정 1작업 · 3개')")
    assert evaluate("[...document.querySelectorAll('section.panel tbody tr td:last-child')].map(x=>Number(x.textContent)).sort().join(',')") == '1,2'
    command([{'method':'Browser.setDownloadBehavior','params':{'behavior':'allow','downloadPath':info['profile']+'\\downloads'}},
             {'method':'Runtime.evaluate','params':{'expression':"(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='CSV 다운로드');b.click();await new Promise(r=>setTimeout(r,2000));return true;})()",'awaitPromise':True,'returnByValue':True,'userGesture':True}}])
    csv_script = '''$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$v=[Console]::In.ReadToEnd() | ConvertFrom-Json
$f=Join-Path (Join-Path $v.profile 'downloads') ('daily-'+$v.date+'.csv')
for($i=0;$i -lt 40 -and !(Test-Path $f);$i++){Start-Sleep -Milliseconds 200}
if(!(Test-Path $f)){throw 'UI CSV download missing'}
$rows=@(Import-Csv -LiteralPath $f)
@{rows=$rows.Count;runId=$rows[0].datasetRunId;taskCount=[int]$rows[0].taskCount;itemCount=[int]$rows[0].itemCount;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower()} | ConvertTo-Json -Compress
'''
    run = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',base64.b64encode(csv_script.encode('utf-16le')).decode()],
                         input=json.dumps({'profile':info['profile'],'date':plan['businessDate']}),text=True,encoding='utf-8',capture_output=True,errors='replace',timeout=15)
    if run.returncode:
        raise AssertionError('Actual UI CSV download failed')
    csv = json.loads(run.stdout)
    assert csv['rows']==2 and csv['runId']==plan['runId'] and csv['taskCount']==1 and csv['itemCount']==3
    check('M-A06', 'confirmed-only day/product report and actual CSV button download', csv)
    assert evaluate('localStorage.length') == 0
    assert evaluate('sessionStorage.length') == 0
    check('M-A07', 'token absent from local/session storage', {'localStorageKeys':0,'sessionStorageKeys':0})
    report['status']='PASS'
except Exception as error:
    report['status']='FAIL'
    report['failure']={'type':type(error).__name__,'message':str(error)}
    save()
    print(json.dumps({'status':'FAIL','completedChecks':len(report['checks']),'failure':report['failure']},ensure_ascii=False))
    raise SystemExit(1)
save()
print(json.dumps({'status':report['status'],'checks':len(report['checks']),'scope':report['scope']}))
