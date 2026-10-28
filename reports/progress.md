# MVP 단계 기록

PASS는 실제 실행한 범위에만 사용. 원본 문서 document_checks.json은 제품 시험 아님.
MVP 완료·mvp-v1 태그·08 확장 착수는 모든 필수 gate 통과 전 금지.

## 현재 단계 판정 — 2026-10-28

이후 절들은 시간순 작업 기록이다. 초기 NOT_RUN/BLOCKED와 실패는 당시 상태이며,
현재 판정은 이 표와 verification.md를 따른다. 초기 HEAD404 차단 판단은 아래에서 정정했다.

| 단계 | 현재 상태 | 증거·남은 조건 |
|---|---|---|
| S0 | PASS | 고정 환경·Compose/migration·실제 health/auth·깨끗한 clone의 원격 CI |
| S1 | PASS | 실제4CSV 보존·전체99,441수집·분류·96,596작업 원본 대사 |
| S2 | PASS | 작업·배정·snapshot·실제 Redis/outbox/워커 장애 시험 |
| S3 | BLOCKED | SQLite/로컬 업무/재시작 소프트웨어 PASS; 실제 웹캠 T08 필요 |
| S4 | PASS | 실제 DB/HTTP ACK·유실·중복·순서·격리·복구 시험 |
| S5 | PASS (소프트웨어) | 운영 API/화면 build·권한·이력·정정·CSV·집계; 브라우저 수동 NOT_RUN |
| S6 | BLOCKED (장비) | F2·F1·최종 전체 대사 PASS; 실제 입력 T08·실제 보드 T29 필요 |
| S7 | BLOCKED | 재현 문서·서비스·장비 절차 준비; 실제 시연·독립 검증·release gate 남음 |

## S0 — 구현 / 검증 진행

요구: M-A07, 비기능 health/readiness, 공통 계약·M-S01/02/03 기반.
산출: lockfile, Compose, 초기 migration, NestJS health, 인증 도우미,
OpenAPI 기반 schema 검증, canonical hash와 알려진 정답 시험, CI 정의.

실행: 타입 검사 PASS. 단위 시험 및 원본 예시 hash 검증 PASS.
문서 검사: 27 operations / 43 schemas / 6 event known answers / 17 local links.
실제 MySQL 초기 migration 적용 및 두 번째 재실행 PASS.
실제 HTTP /health=ok, /ready=ok(database=up, redis=up) 확인.
MySQL·Redis 전용 Compose 컨테이너 실행. 세부 통합 결과는 후속 기록.

남은 문제: 깨끗한 이미지 build·CI 원격 실행은 아직 NOT_RUN.
소프트웨어 개발을 계속하되 후속 단계 통과로 간주하지 않음.

## 원본·장비 의존성

Olist 공식 페이지의 JSON-LD: v2, contentSize 44,717,580 bytes,
CC BY-NC-SA 4.0. 공식 파일 목록에서 MVP 4개 파일 합계 35,647,734 bytes 확인.
공식 다운로드 경로가 404여서 실제 원본 다운로드·F1·F2·T28은 BLOCKED.
대체 사이트 데이터를 원본으로 사용하지 않음. 고정 fixture는 합성으로 표시.
실제 Raspberry Pi·모니터·웹캠 미연결: T29, 실제 QR 및 전원/SD 검증 BLOCKED.

## S1 — 소프트웨어 구현 / 실제 원본 gate BLOCKED

요구: M-D01~05, M-D02 대사 준비, T01~04·T32.
구현: CSV 스트리밍·원본 행 위치/해시 SQLite 인덱스, manifest, source 커서 API,
가상 시계, master 파일 적재와 REST 주문 수집 분리, DB checkpoint·원본·정규화·outbox 원자 저장.
source key 충돌 payload는 source_conflicts에 보존하고 원본은 덮어쓰지 않음.
실행: 합성 CSV 10주문/30행/2상품/1판매자 준비, 타입 검사, 분류·행수 단위 시험.
실제 MySQL 페이지 재수집, 저장 전/중/커밋 전 예외 rollback, checkpoint 및 원본 충돌 격리 PASS.
T02 프로세스 SIGKILL은 아직 NOT_RUN; 위 결과는 예외 rollback 시험만 의미.
초기 SQL placeholder 수 불일치는 실제 DB 시험에서 발견·수정 후 재실행 통과.
원본 전체 대사·F1·F2는 다운로드 실패로 BLOCKED이며 S1 통과로 표시하지 않음.

결정: 비어 있지 않은 cursor 페이지 재요청의 재현성을 위해 페이지 경계를 고정한다.
해당 페이지 마지막 레코드의 가상 공개 시각 전에는 empty/same-cursor/poll 응답을 준다.
공개된 일부 레코드가 페이지가 채워질 때까지 기다릴 수 있음. 실제 UTC 시각으로 해석하지 않음.

## S2 — 업무 모델 구현 / Redis 장애 통합은 S6에서 검증

요구: M-W01~05, T05~07·T20~22.
구현: MySQL task UNIQUE, job/order row lock, revision fencing, outbox lease 재발행,
BullMQ ops-jobs 워커 concurrency=1, immutable snapshot과 최초 배정,
운영 requestId canonical hash/응답 보존·감사·actor별 변경 직렬화.
실행: 실제 DB task 생성 중 예외 rollback, 동시 중복 job 후 작업 1개,
같은 requestId 응답 보존, 다른 requestId 재배정 거부, 같은 requestId 본문 변경 거부 PASS.
task 생성과 outbox DONE은 같은 트랜잭션. 실제 Redis 중단/복구·워커 SIGKILL은 아직 NOT_RUN.

## S3 — 파일 SQLite·로컬 화면 구현 / 하드웨어 gate BLOCKED

요구: M-E01~08, T07~13·T32·T34.
SQLite WAL/synchronous=FULL, UUID·seq·이벤트·수량·취소·완료·receipt 보존,
부팅 시 전체 로컬 이벤트 projection 재생, snapshot 충돌 격리.
React 현장 화면은 로컬 API만 사용. ZXing 웹캠으로 QR 1개씩 읽기·스캔별 취소,
부족 완료 차단·로컬 완료/서버 확정 분리. 번들 자원은 로컬 제공하며 CDN 없음.
실행: 파일 SQLite 잘못된 QR·상품·초과·재취소·부족 완료, 예외 rollback,
재다운로드·재연결·완료 잠금·늦은 ACK 수량 보존 단위 시험 PASS. 전체 빌드 PASS.
실제 Pi/웹캠/모니터/SD 시험은 BLOCKED. 프로세스 SIGKILL은 S6 시험으로 남음.

계약 보완: 재시작 후 취소할 eventId와 차단 사유를 읽을 수 있도록
GET /local/v1/tasks/{taskId}/history, 단말 health를 OpenAPI에 추가.
기존 스냅샷·이벤트 의미는 유지. 원본 계약은 최초 Git 커밋에 보존됨.

## S4 — 동기화 구현 / 통합 장애 검증 진행

요구: M-S01~08, T14~19·T23·T25·T34.
단말 event는 이벤트별 MySQL 트랜잭션에서 receipt·seq·수량·task·report outbox를
함께 저장하고 transactional promise가 완료된 뒤만 반환. Redis 경로 사용 없음.
device/eventId 및 task/version/seq 유일 제약, 중복 우선 검사, 영구 거부와 일시 오류 분리.
단말은 순서·단일 요청·작업 격리·jitter·Retry-After·5회 예산 후 수동 재시도.
실행: 실제 MySQL ACK 직후 응답 유실 hook, 중복 payload 충돌, seq gap,
다른 단말/버전, 부분 batch 후 throw, 중복 COMPLETE, 미완료 서버 직접 호출 PASS.
아직 위 hook을 실제 API SIGKILL 시험과 동일하게 표시하지 않음.

계약 해석: CONFIRMED는 terminal이므로 새 eventId로 뒤늦은 추가 입력은
BLOCKED/TASK_ALREADY_CONFIRMED로 응답하고 확정·집계를 유지한다.
committedAt/confirmedAt은 트랜잭션 마지막 저장 직전에 읽은 MySQL UTC 시각이며
ACK는 실제 COMMIT 이후이다. DB 로그의 정확한 commit timestamp를 뜻하지 않음.

## S5 — 운영 화면·API·집계 구현

요구: M-A01~07, M-D06·M-W06, T24·T26·T30~31·T33.
구현: React 주문 검색/페이지·상세·정정, 작업 배정/메모/이벤트,
실패 job 조회·조건부 재시도, 단말 마지막 보고·수신 시각 기준 stale,
업무일/상품별 CONFIRMED 재계산 및 CSV. 운영 변경은 사유·감사·requestId를 보존.
DATA_HOLD만 revision 정정, 원본 불변, task 존재 후 정정 금지,
영구 job 오류 재시도 우회 금지, 일시 job 오류 5회 예산.
실행: 실제 MySQL 정정/원본/감사/재시도/집계 멱등성 PASS.
실제 Nest HTTP 401/403, 검색/목록 max200, 256KiB body 제한, 메모 201,
CSV content type, stale 관측·readiness·React index 제공 PASS.
브라우저 클릭·웹캠·모니터의 실제 UI 동작은 아직 NOT_RUN/BLOCKED이며
번들 build/HTTP 응답만으로 현장 UI 시험 통과를 주장하지 않음.

## S6 — 통합 실행 / 실제 입력·하드웨어 gate BLOCKED

실행: 실제 자식 수집기/워커/SQLite SIGKILL, HTTP API 커밋 직후 SIGKILL,
Redis/BullMQ 누락 delivery 재구성, Redis/MySQL 실제 컨테이너 중단·복구 PASS.
전용 자원만 중단했고 볼륨·원본·기존 run 삭제 없음. finally로 가용성 복구.
보조 합성 1,000작업: 고유 이벤트4,000 / 전달4,400 / 수량3,000 / 중복효과0 /
ACK 유실0 / 로컬 미전송0. 실제 Olist F1으로 표시하지 않음.
10주문 컨테이너 REST 수집→task10·상품 수량 대사 PASS.
처음 drain 전 대사는 FAIL(미완료 outbox10/task0)을 반환했고, drain 후 재실행 PASS.
초기 Compose 기동은 이 세션의 이전 health 서버와 3000 포트가 충돌해 실패했으나,
해당 프로젝트 프로세스임을 확인 후 종료하여 Compose API로 전환함.

최종 회귀는 별도 logistics_test DB로 분리. fixture 개발 워커와의 간섭을 예방하고
기존 시험 이력도 삭제하지 않음. 실제 F1 도구는 합성 manifest를 명시적으로 거부하며
원본 준비 후 고정 선택·지속 SQLite·ACK 유실 재생·대사·재개가 가능하도록 구현.
실제 F1 실행은 아직 BLOCKED. T27/T28/T29와 T08의 실제 입력은 미통과.

보완: sourceItemId 오류가 HTTP schema 때문에 raw 보존 전에 실패하던 표현 공백을
nullable로 해결. 원문 CSV/행은 보존하고 DATA_HOLD 분류. item distinct key 정의 명시.
MySQL JSON 키 순서로 재-seed가 잘못 충돌할 위험은 canonical hash 비교로 해결.
DB status enum·수량·소유권 CHECK도 적용. 영구 BLOCKED 근거를 DEVICE 감사에 저장.

## S7 — 재현 문서·단말 서비스 예시 준비 / release gate BLOCKED

README, Makefile, .env 예시·비밀 자동 생성, Compose 전체 build/migrate/seed,
원본 ZIP 보존 추출·manifest·대사·실제/합성 재생, QR 인쇄, systemd 예시 준비.
실제 OS/카메라/전원/SD·브라우저 수동·시연 영상은 아직 미완료.
전체 MVP 완료·mvp-v1 tag 없음. 08 확장 기능 구현 없음.
이 단계 당시 원격/push 없음; 이후 사용자 승인으로 연결한 비공개 저장소는 아래 기록 참조.
요구 ID와 T01~34 최종 판정은 verification.md 참조.

## 2026-10-28 — GitHub 비공개 연결과 회귀

사용자가 기존 이력 보존·비공개 저장소 생성·push 및 이후 주기적 push를 명시적으로 승인.
기존 main 7커밋과 원격 없음 확인 후 reachable blob132개·현재 후보 파일을 검사.
로컬 .env 실제 비밀값·GitHub/AWS/개인 키 패턴·원본/빌드 경로 검사에서 발견 없음.
Git author는 기존 Leah/leah@localhost 메타데이터를 보존. 임의 PII를 완전히 검출하는 보장은 아님.
검사 도구 tools/audit-git.py와 reports/git-safety-2026-10-28.json에 범위/한계를 기록.

GitHub CLI 2.103.3: 공식 압축 15,031,972 bytes·SHA256 검증 후 .tools에 로컬 설치.
사용자가 브라우저 로그인을 완료했고 leah-1ee 계정 인증을 확인.
동명 저장소 조회 HTTP404 확인 후 https://github.com/leah-1ee/logistics-automation 생성,
visibility PRIVATE 재확인. 기존 7커밋(7e36ff3까지) push 완료. 전역 Git 설정은 바꾸지 않고
프로젝트에만 gh credential helper를 연결했으며 토큰은 Git 설정/원격 URL에 넣지 않음.

Docker/WSL 연결을 사용자가 복구한 뒤 별도 DB 최종 회귀15개·단위10개·계약29 operations/
44 schemas·build PASS. 기존 CI는 원본 입력 미준비 상태의 seed 단계에서 FAIL을 확인했고,
최신 CI는 fixture 준비·별도 시험 DB를 먼저 생성하도록 수정한 상태.
실제 데이터/장비 gate는 그대로 BLOCKED이며 전체 MVP 완료로 변경하지 않음.

## 2026-10-28 — 원본 GET 확인·전체 수집

원본 다운로드가 막혔다던 앞선 기록을 정정한다. HEAD404만으로 차단 판정했으나
범위 GET은206/44,717,580 bytes를 반환했고 실제 GET을 완료했다.
공식 화면 CC BY-NC-SA4.0/v2 재확인, byte 상한·SHA256·ZIP CRC 검증,
원본 ZIP과 MVP4CSV를 data/에 보존했다. Git에는 원본을 추가하지 않음.
manifest: 주문99,441·item112,650행·상품32,951·판매자3,095, orphan item0.

전체 준비/수집에서 드러난 결함:
- 준비 SQLite 부모 대사가 source_key 인덱스 없이 반복 탐색: 기존 부분 index를 보존하고 새 파일로 재준비.
- MySQL 원본 식별자 OR 조회가 후보7,233행 탐색: 각각 고유 키 조회(const/1row)로 수정.
  양쪽 식별자가 다른 레코드와 충돌하면 양쪽 증적을 남기는 회귀도 추가.
- master 준비 중 주문 수집을 막고 PREPARING→REGISTERED로 전환.
  파일 master는 MVP의200record 단위로 커밋하며 중단 후 중복 안전하게 재개.
- 서버 DTO를 정답으로 재사용하던 대사를 CSV 기반으로 독립시켰으며,
  서버 DTO/task를 함께 잘못 바꾸어도 FAIL인 회귀를 실제 DB에서 확인.

새 실제 run=e7fb6a95-0d26-42b5-9305-5b559569b7da (.env.olist, 비밀은 제외).
수집 도중 API를 교체하고 같은 checkpoint부터 재개한 뒤 전체99,441건 수집 완료.
적격96,596 / DATA_HOLD789 / UNSUPPORTED2,056. 같은 run에서 워커1·동시성1로 작업 생성 중.
tools/verify-actual-run.ts가 drain을 기다려 F2→F1→최종 대사를 순서대로 실행 중이다.
데이터 확보가 완료됐으므로 T27/T28의 이전 '접근 BLOCKED'는 해소했지만
최종 대사·실제1000건 재생 완료 전에는 PASS로 바꾸지 않는다.

회귀·빌드와 기능 단위 커밋을 주기적으로 비공개 origin/main으로 push했다.
최초 CI2회 실패(seed 누락, 예시/생성manifest경로충돌) 후 회귀 보완한 최신 CI는 PASS.
실제 장비 T08/T29·브라우저 수동·영상·release gate는 남아 있다.


## 2026-10-28 — 실제 F2/F1 완료와 S7 인계

재개 시 이전 호스트 검증 프로세스가 사라진 것을 확인하고 같은 실제 run의 검증만 다시 시작했다.
Docker의 수집과 워커는 유지됐고96,596 CREATE_TASK가 모두 DONE이었다. 데이터 초기화 없음.
F2: 원본4CSV hash 재확인, 주문99,441 / TASK_CREATED96,596 / DATA_HOLD789 /
UNSUPPORTED2,056 / 상품32,951 / 판매자3,095 / 수량98,840항목 대사 PASS·오류0.

F1: 실제 적격1,000주문 고정 선택, 배정/스캔은 명시적 소프트웨어 모의 입력.
수량1,117 / 고유 이벤트2,117 / HTTP 전달2,332 / 응답 유실100회 /
로컬 DUPLICATE receipt215 / 로컬 미전송0. 1,000작업 SERVER_CONFIRMED,
모든 ACK의 DB hash와 로컬/서버 수량·상태·일별 집계 일치 PASS.
후속 전체 독립 대사도 PASS·오류0. 관련 actual-run/f1/f1-local-audit/reconciliation 보고서 보존.
실제 카메라 입력·보드 전원/SD 검증으로 해석하지 않는다.

최종 단위14개·DB/HTTP17개·계약29operations/44schemas/6known answers·전체 build PASS.
선택 작업의 QR 표식만 출력하고 datasetRun 혼합을 거부하는 회귀도 통과해 b6bb698로 push했다.
해당 원격 CI도 PASS. 원본/토큰/SQLite/build 산출물은 Git 제외 상태를 확인했다.
README·장비/네트워크 경로·systemd 예시·실행/복구/정책과 시험 증거를 정리했다.
전체 MVP는 T08/T29의 장비와 수동 브라우저/시연·독립 검증 조건이 남아 미완료다.
장비 관련 BLOCKED는 유지하며 mvp-v1 tag나08확장은 시작하지 않는다.


## 2026-10-28 — 사용자 요청 독립 재검증

기준5f7cbfb에서 기존 PASS를 새 증거로 취급하지 않고 문서/코드/실행을 대조했다.
직접 CSV 오라클, COMMIT 보류/실패 및 동시8전송, 실제 Redis/MySQL 중단/복구,
새로운 실제 주문1,000건의 응답 유실100회 재생을 실행했다. 단위17·통합22 PASS.
IV-01~05 결함 수정과 before/after 증거를 reports/independent-2026-10-28에 보존했다.
UI9요구는 API/build만으로 PASS를 주장하지 않고 NOT_RUN, 실제 장비2요구는 BLOCKED다.
최신 기준은 reports/verification.md와 상세 독립 검증표를 따른다.

원본 전체99,441/작업96,596 대사, 전체4,251사건·누적2,000확정·수량2,251 대사 PASS.
이전 F1의 plan/SQLite/보고서 byte hash 유지. 새 trial만 추가했으며 원본/볼륨 삭제 없음.
초기 오프라인 Docker 설치 레이어 캐시 부재로 빌드가 실패했지만, 기존 이미지의
lockfile 일치를 검사해 네트워크 없는 증분 빌드로 수정 API를 적용했다.

사용자가 Pi 주소/계정과 C270을 지정했다. SSH 서버에 도달했으나 키 인증은 거부됐다.
ssh-copy-id가 ~/.ssh 임시 폴더 부재로 실패하여 해당 디렉터리만0700으로 만들었다.
프로젝트 전용 개인키/known_hosts는 ignored var/에만 보관하고 공개키 재등록을 안내했다.
아직 Pi 모델/OS/USB/C270/실제 QR/재부팅 PASS는 없으며 인증 후 한 단계씩 진행한다.

## 2026-10-28 — 실제 Pi 설치·C270 촬영 및 사진 방식 준비

공개키 등록·전송/실행 승인을 받은 뒤 Pi5/Debian13 arm64/C270을 실제 확인했다.
공식 Node24.22.1 ARM64 약31MB의 크기·SHA256을 확인하고 사용자 폴더에 설치했다.
단말 전용 환경0600·systemd 사용자 서비스·loopback 역방향 터널을 구성했다.
원본 데이터나 DB/관리자 토큰은 Pi에 보내지 않았다. 실제 적격 작업1개/필요수량2를
내려받았으며 실제 Chromium 화면에서 수량0의 완료 버튼 비활성화를 확인했다.

물리 HDMI 연결이 어려워 사용자가 VNC 관찰을 선택했다. HDMI는 NOT_RUN이다.
실시간 카메라 시도는 TIMEOUT이며 성공 사건은0이다. 사용자가 QR 창을 계속 유지하기
어려워 사진 방식을 요청하여 기존 fswebcam으로1280×720 사진273,273bytes를 저장했다.
최초 사진에는 QR이 프레임 밖이라 해독 FAIL이다. 사진은 ignored var/에만 저장했다.
tools/verify-camera-photo.mjs는 새 촬영/저장 사진을 진단하며 업무 이벤트는 만들지 않는다.
실제 Pi에서 합성 정상 사진 해독 PASS/exit0, 실제 QR 없는 사진 FAIL/exit1을 확인했다.
실제 카메라 입력·재부팅 gate를 사진/합성 검사 PASS로 대신하지 않았다.

현재 단말 SQLite는 DOWNLOADED/SYNCED·수량0/2·nextSeq1이다. 서버 터널만 차단하고
SSH/VNC·서비스는 유지했다. 다음 물리 단계는 QR 전체가 담기게 카메라 방향을 조정하는
것이다. T08/T29·M-E01/M-E07은 BLOCKED 유지; 상세 증거는 hardware-validation.md 참조.

## 2026-10-28 — 사진 재사용·실제 Pi 재부팅·운영 UI 독립 검증

실제 C270 정상 QR 사진1280×720/229,118bytes 해독·상품 일치 PASS. 사용자가 QR을
계속 띄울 부담을 줄이도록 저장 사진을 반복 해독해 실제 Pi 폼에 입력했다. 오류 형식/
다른 상품은 합성 문자열로 명시했다. 실제 광학 스캔으로 바꾸어 기록하지 않았다.

사용자가 sudo 정상 재부팅을 실행했다. boot ID 변경, SQLite integrity ok, 스냅샷·
5사건 hash/seq·수량2·취소/미전송 상태 복구를 확인했다. 서버 loopback 터널을 복구하고
실제 UI 재시도로 동일 사건을 ACK/확정했다. 두 번째 UI 회귀 작업까지2작업/9사건/
순수수량3·미전송0·단말/서버 hash 일치. 실제 run 전수 대사4,260사건/2,002확정/
수량2,254/불일치0. 앞선 F1·원본·SQLite·실패 fixture는 보존했다.

실제 Pi에서 IV-06 동기화 경고 잔류를 발견·수정했다. Chromium 장치 열거는 V4L2
실행 설정으로 복구했고 C2701280×720 실제 스트림을 확인했다. 실시간 버튼의 QR 처리는
프레임에 QR이 없어 성공 미확인이다. T08/T29/M-E01은 BLOCKED 유지한다.

기존 Windows Chrome156 headless/격리 logistics_test에서 운영 화면을 실제 조작했다.
IV-07 재시도 job 상세가 FAILED로 남는 결함을 수정했다. 최종9검사와 직접 DB 대조 PASS.
하네스의 합성 DeviceStatusReport 필드 누락/Windows 출력 인코딩·CDP 연결 실패도 보존했다.
새 단위17·계약·typecheck/build PASS. UI 수용9개 NOT_RUN은 실제 실행 증거로 갱신했고,
실제 재부팅 조건 M-E07도 PASS가 되어 요구사항34 PASS/1 BLOCKED다. T표32 PASS/2 BLOCKED.

[최신 요구사항/시험 표](verification.md), [장비 결과](hardware-validation.md),
[운영 브라우저 재현](browser-validation.md). 전체 MVP 미완료이며 태그/08확장은 시작하지 않았다.
