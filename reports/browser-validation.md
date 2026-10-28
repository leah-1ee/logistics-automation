# 실제 운영 브라우저 검증

2026-10-28. 설치되어 있던 Windows Chrome156.0.8078.48을 별도 임시 프로필의 headless
모드로 실행했다. 가짜 DOM/HTTP를 쓰지 않고 실제 React 핸들러와 loopback API3301,
logistics_test DB를 사용했다. 실제 Olist run·Pi 토큰·사용자 Chrome 프로필은 사용하지 않았다.

최종 [브라우저9검사](hardware-2026-10-28/admin-browser-final.json)와
[변경 결과 직접 DB 대조](hardware-2026-10-28/admin-browser-db.json)는 PASS다.
목록54건의50+4 페이지, 검색/상태/원본·정규화, 이벤트4/수량3, 사유/배정/재배정 차단,
메모, 실패5회/재시도/영구 실패 거부, 보류 정정/감사, stale/pending7, 확정 보고서/상품2행,
CSV 버튼 다운로드와 실제 파일 해시, token의 local/session storage 미저장을 확인했다.
이는 자동 브라우저 조작이며 사람이 수동 조작하거나 시연 영상을 남긴 시험은 아니다.

초기 제품 실패는 job 재시도 뒤 상세가 갱신되지 않는 IV-07이다. 이후 합성 관측 누락과
CSV 검증 하네스 인코딩/연결 문제를 구분했다. [실패·수정 근거](independent-2026-10-28/findings.md)를 참조한다.
최종 fixture는 별도 합성 run이다. 배정/노트1회·정정 revision2/원본 hash 보존·일시 retry
횟수0·영구 실패 유지·job2개를 각각2번 처리해 작업51→53/고유order53·확정보고서1/3을
DB로 확인했다. 이전 실패 fixture와 job 시도 이력도 보존했다.

## 재현

Node24와 실제 DB 준비/migration은 README의 make verify 환경을 사용한다. 새 BROWSER_PLAN을
선택하면 기존 run을 지우지 않고 추가한다. fixture/check 도구는 logistics_test 이외 DB를 거부한다.

```bash
export PATH="$PWD/.tools/node-v24.22.1-linux-x64/bin:$PATH"
npm run build
BROWSER_PLAN=var/admin-ui-new.json node --import tsx --env-file=.env.test tools/browser-admin-fixture.ts
API_PORT=3301 API_HOST=127.0.0.1 node --env-file=.env.test dist/src/server/main.js
```

API ready200을 확인한 뒤 설치된 Windows Chrome을 loopback 디버깅 포트/별도 프로필로 연다.
새 PowerShell 터미널의 예시이며 Chrome 경로는 설치 위치에 맞춘다. 패키지를 자동 설치하지 않는다.

```powershell
$profilePath = Join-Path $env:TEMP ('logistics-admin-verify-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profilePath | Out-Null
Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @(
  '--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  "--user-data-dir=$profilePath",'--no-first-run','--disable-background-networking',
  '--disable-component-update',
  '--disable-features=OptimizationHints,OptimizationGuideModelDownloading,OptimizationGuideOnDeviceModel,Translate,MediaRouter',
  'http://127.0.0.1:3301/admin')
# DevToolsActivePort 생성 뒤 port 첫 줄을 읽는다.
$portNumber = [int](Get-Content (Join-Path $profilePath 'DevToolsActivePort') -First 1)
@{port=$portNumber;profile=$profilePath;appPort=3301} | ConvertTo-Json
```

마지막 JSON만 WSL의 ignored var/admin-browser.json에 저장한다. 토큰은 파일에 넣지 않는다.
다른 WSL 터미널에서 실행한다. 하네스는 .env.test의 토큰을 stdin으로만 전달하고 출력하지 않는다.

```bash
python3 tools/verify-admin-browser.py --plan var/admin-ui-new.json --report reports/admin-browser-new.json
BROWSER_PLAN=var/admin-ui-new.json BROWSER_CHECK_REPORT=reports/admin-browser-db-new.json node --import tsx --env-file=.env.test tools/browser-admin-check.ts
```

브라우저 driver는 이 WSL/Windows 환경 전용이며 다른 OS에서 실행했다고 주장하지 않는다.
실제 CSV는 전용 Windows 임시 프로필 아래 downloads/에만 받고 Git에는 해시/요약만 남긴다.
API·브라우저 종료는 이 시험에서 시작한 프로세스만 대상으로 한다. run/DB/원본/프로필을
자동 삭제하거나 reset하지 않는다. Linux/Pi 단말 브라우저 검증은 별도
[장비 결과](hardware-validation.md)와 verify-device-browser.mjs를 사용한다.
