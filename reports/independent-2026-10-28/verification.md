# 독립 재검증 판정 — 2026-10-28 (Asia/Seoul)

전체 MVP 미완료. 기존 PASS는 증거로 재사용하지 않고 기준5f7cbfb의 명세·코드·시험을
읽고 새로 실행했다. Source/normalize/기존 reconcile을 가져오지 않는 CSV 직접 오라클,
실제 COMMIT 보류/실패·동시 중복 HTTP 및 새로운 실제 주문1,000건을 추가했다.
같은 에이전트의 별도 검증 단계이며 외부 검증자/별도 모델에게 위임했다는 뜻은 아니다.
코드와 API 실행 PASS를 실제 브라우저·Pi·C270 시험 PASS로 확대하지 않는다.

새 단위17개, 최종 DB/HTTP22개 PASS. 계약29operations/44schemas/6known answers 및 build PASS.
초기 실패·오라클 보완 이력은 [결함 기록](findings.md)과 before/harness TAP에 보존했다.

새 실제 F1:1,000작업·수량1,134·2,134고유 사건·전달2,350·응답 유실100회·
DUPLICATE216·미전송0. 이전 F1 plan/SQLite/보고서는 byte hash가 그대로다.
[F1 결과](../f1-e7fb6a95-0d26-42b5-9305-5b559569b7da-independent-20261028.json),
[로컬 관측](f1-local.json), [직접 CSV 전수 대사](source-final.json).
전체 누적 확정은2,000작업/수량2,251이며 기존1,000건과 새 시험1,000건을 구분한다.
모든 배정/스캔은 소프트웨어 모의 업무다. 원본 전체=99,441=96,596+789+2,056.

## 요구사항별 판정

UI 표시/사용자 조작이 수용 기준인 항목은 API/build만으로 전체 PASS로 판정하지 않았다.
24 PASS / 9 NOT_RUN / 2 BLOCKED. 현재 미수정으로 확인된 업무 결함 FAIL은0이며,
NOT_RUN은 결함이 없다는 뜻이 아니다.

| 요구 ID | 판정 | 새 근거·범위 |
|---|---|---|
| M-D01 | PASS | source-archive.json: 원본 ZIP CRC9개·SHA256와4CSV 재확인, 원본 제외 Git 검사 |
| M-D02 | PASS | source-final.json: 직접 CSV99,441주문·112,650행·96,596작업 전수 대사 |
| M-D03 | PASS | source-http.json: 실제 source HTTP 동일 페이지·run/limit409·잘못된 cursor400 |
| M-D04 | PASS | integration-verified.tap/crash: 페이지 저장 경계 SIGKILL 후 재개·checkpoint |
| M-D05 | PASS | unit-final.tap/normalization 및 독립 CSV 분류·사유·품질 flag 전수 비교 |
| M-D06 | PASS | integration-verified.tap/operations·event-rules: 원본 불변·정정 revision·감사 |
| M-W01 | PASS | source-final.json 및 source-integrity-after.tap: COUNT(rows)·단독 손상 검출 |
| M-W02 | PASS | service-faults.json/redis·crash: 실제 중단·outbox lease 재발행·작업1개 |
| M-W03 | PASS | integration-verified.tap/tasks: 최초 배정·중복 요청·소유권 저장 |
| M-W04 | PASS | source-final.json 스냅샷 hash/수량·snapshot-lifecycle-after.tap ACK 유실 복구 |
| M-W05 | PASS | integration-verified.tap/tasks·sync: 재배정·다른 단말/버전 거부 |
| M-W06 | PASS | integration-verified.tap/operations·http: 보류/이벤트/메모 조회·감사 API |
| M-E01 | BLOCKED | Pi5/C270 연결·사진 촬영 확인, 첫 사진 QR 해독 실패; 실제 입력 미통과 |
| M-E02 | NOT_RUN | 로컬/API의 오류·수량·seq 차단은 PASS; 실제 경고 화면/입력 경로는 미실행 |
| M-E03 | PASS | 새 F1 2,134고유 이벤트 및 local/event-rules: 상품1개·UUID·연속 seq |
| M-E04 | PASS | integration-verified.tap/event-rules, unit-final.tap/local: 특정 스캔/재취소·음수 차단 |
| M-E05 | NOT_RUN | 로컬/서버 부족 완료 차단 PASS; 브라우저 완료 버튼 비활성화는 실제 미실행 |
| M-E06 | PASS | WSL 실제 파일 SQLite SIGKILL·동시 event/state/nextSeq 복구·늦은 ACK; SD 시험 아님 |
| M-E07 | BLOCKED | 파일/프로세스 복구 PASS; 실제 Pi 재부팅 후 복구는 미실행 |
| M-E08 | NOT_RUN | LOCAL_COMPLETED/PENDING→SERVER_CONFIRMED 상태 시험 PASS; 실제 표시 화면 미실행 |
| M-S01 | PASS | commit-boundary.tap: COMMIT 보류 중 HTTP ACK 없음·다른 연결에서 미반영·실패 커밋 |
| M-S02 | PASS | 동시8요청=APPLIED1/DUPLICATE7; 새 F1 DUPLICATE216·수량/집계 일치 |
| M-S03 | PASS | integration-verified.tap/sync: 같은ID 다른본문 BLOCKED·최초 값/감사 보존 |
| M-S04 | PASS | gap DEFERRED/복구·이미 쓴seq 거부·server-clock-after.tap 두 시간대/업무일 |
| M-S05 | PASS | integration-verified.tap/sync·http: 인증 단말·배정 version·수량 불변 |
| M-S06 | PASS | unit-final.tap/device-sync: backoff·Retry-After·5회 예산·수동; 실제 DB 중단 복구 |
| M-S07 | PASS | unit-final.tap/device-sync 및 sync 통합: 차단 작업 이외 전송 지속 |
| M-S08 | PASS | HTTP API SIGKILL 부분 배치·실제 주문 새1,000건 응답 유실100회·재전송 |
| M-A01 | NOT_RUN | 주문 검색/목록/상세 API·React build PASS; 실제 주문 화면 조작 미실행 |
| M-A02 | NOT_RUN | 작업/이벤트/감사/메모 API PASS; 실제 상세 화면 조작 미실행 |
| M-A03 | NOT_RUN | 배정 API 불변 조건 PASS; 운영 화면 단말 선택/확인 조작 미실행 |
| M-A04 | NOT_RUN | job 실패/횟수/영구 오류 거부/재시도 API PASS; 운영 화면 조작 미실행 |
| M-A05 | NOT_RUN | 단말 관측·stale API PASS; 실제 단말 상태 화면 조작 미실행 |
| M-A06 | NOT_RUN | 확정/상품별/CSV API 및 두 독립 대사 PASS; 실제 보고서 화면 조작 미실행 |
| M-A07 | PASS | 새 HTTP401/403·local origin/host/주소 거부·변경 사유/requestId/감사 시험 |

## T01~T34

32 PASS / 2 BLOCKED. 소프트웨어 시험 통과와 화면/장비의 별도 수용 조건을 구분한다.
시험 이름은 unit-final.tap, integration-verified.tap의 개별 시나리오로 연결된다.

| 시험 | 판정 | 새 실행 증거 |
|---|---|---|
| T01 | PASS | ingestion/tasks: 페이지 재수집·UNIQUE·수량 |
| T02 | PASS | crash: 수집기 저장 전/중/직전/직후 SIGKILL·재개 |
| T03 | PASS | normalization 및 CSV 직접 오라클 전수 분류 |
| T04 | PASS | 불연속 item ID·동일 상품 행 수와 원본 수량 전수 비교 |
| T05 | PASS | tasks/crash: 반복/동시 job·생성 경계 SIGKILL |
| T06 | PASS | tasks: 최초 배정·같은 requestId 결과·다른 본문/재배정 거부 |
| T07 | PASS | local·snapshot-lifecycle: hash/재다운로드·기존 사건 보존 |
| T08 | BLOCKED | 실제 C270 입력 미실행; 소프트웨어 QR·모의 camera3회귀 PASS |
| T09 | PASS | local·새 F1 고유 사건/연속 seq/수량 |
| T10 | PASS | local/event-rules: 되돌리기/재취소/음수 차단 |
| T11 | PASS | local/local-http/sync: 부족 완료 차단·직접 COMPLETE HOLD |
| T12 | PASS | crash: 실제 파일 SQLite 경계 SIGKILL·event/state/seq 복구 |
| T13 | PASS | local/F1: 내려받은 작업 로컬 완료/PENDING 보존 |
| T14 | PASS | commit-boundary·API SIGKILL·새 F1 실제 응답 유실100회 |
| T15 | PASS | sync: 동일ID 다른본문 차단·기존 값/증거 보존 |
| T16 | PASS | commit-boundary/sync: seq gap 미반영·순서 복구·이미 쓴 seq 차단 |
| T17 | PASS | sync: 다른 등록 단말·assignment version 차단 |
| T18 | PASS | crash/sync: HTTP 부분 배치 후 SIGKILL·동일ID로 복구 |
| T19 | PASS | device-sync/sync: 차단 작업과 정상 전송 격리 |
| T20 | PASS | service-faults.json: 실제 Redis 중단, 수집/이벤트 commit·ACK 유지 |
| T21 | PASS | service-faults.json 및 redis: 복구·DB lease에서 missing delivery 재발행 |
| T22 | PASS | crash/tasks: 워커 경계 SIGKILL 후 작업1개 |
| T23 | PASS | service-faults 및 commit-boundary: 실제 DB 중단/커밋 실패 ACK 없음·SQLite 유지 |
| T24 | PASS | event-rules/operations 및 source-final: 반복 COMPLETE·후속 재집계·확정만 집계 |
| T25 | PASS | server-clock-before FAIL→after PASS; 단말 ±시각·DB 세션 ±시간대와 날짜 경계 |
| T26 | PASS | http/device-sync: 역할·local origin/host/주소 차단 |
| T27 | PASS | 새 실제1,000주문/모의 업무: 1,134개·2,134이벤트·유실100·중복216·미전송0 |
| T28 | PASS | source-final.json 및 보강 reconcile: 원본99,441·작업96,596·오류0 |
| T29 | BLOCKED | 실제 Pi/C270/모니터/SD·재부팅/QR 시연 미실행 |
| T30 | PASS | operations/event-rules/http: 정정/revision/메모/원본/감사/재처리 |
| T31 | PASS | http/service-faults: ready503/degraded·max200/body256KiB·검색/CSV/stale |
| T32 | PASS | ingestion/local: 같은key 상충 원본·같은version 상충 snapshot 격리 |
| T33 | PASS | device-sync/operations: 5회 예산·429·수동·영구 오류 우회 거부 |
| T34 | PASS | local: 늦은 앞 seq ACK가 후속 로컬 입력/nextSeq를 덮지 않음 |

## 재현

```bash
export PATH="$PWD/.tools/node-v24.22.1-linux-x64/bin:$PATH"
node --import tsx --test --test-reporter=tap tests/*.test.ts
node --import tsx --env-file=.env.test --test --test-reporter=tap --test-concurrency=1 tests/integration/*.test.ts
SERVICE_FAULT_REPORT=reports/independent-2026-10-28/service-faults.json node --import tsx --env-file=.env.test tests/service-faults.ts
F1_TRIAL=independent-20261028 node --import tsx --env-file=.env.olist tools/replay-actual.ts
AUDIT_OUTPUT=reports/independent-2026-10-28/source-final.json node --import tsx --env-file=.env.olist tools/audit-source.ts
```

서비스 장애 시험은 이 프로젝트 mysql/redis만 일시 중단하고 finally에서 복구한다.
원본/볼륨/SQLite/plan은 삭제하지 않는다. 같은 F1_TRIAL은 저장 plan과 사건을 재사용한다.
source 감사는 READ ONLY consistent snapshot에서 CSV를 직접 비교하며 실제 원본 행을 출력하지 않는다.
샌드박스에서 개별 시험이 실행되지 않고 파일만 성공한 결과는 사용하지 않았다.
DB 시험 동시성은1이다. 병렬 시험의 deadlock과 초기 fixture drain 가정 실패는
별도로 보존했고, 최종 판정은 DONE 확인 후 실행한22개 결과를 쓴다.

## 남은 실제 수용 조건

[장비 절차](../hardware-validation.md)에 따라 SSH 인증 후 Pi 모델/OS/SD와 C270을 확인한다.
SSH 인증과 Pi5/Node 설치·C270 인식·실제 촬영은 완료했다. 최초 사진에는 QR이
담기지 않아 해독 FAIL이며, 실시간 읽기 TIMEOUT도 통과 증거로 쓰지 않는다.
사용자 요청에 따라 한 장 촬영 뒤 사진 기반 반복 진단을 준비했다. 이 진단은 업무
이벤트를 만들지 않으며 실시간 브라우저 QR 및 재부팅 gate를 대신하지 않는다.
WSL의 USB 부재/모의 카메라/프로세스 SIGKILL을 실제 Pi QR·재부팅·SD 시험으로 표시하지 않는다.
실제 브라우저 조작·현장 시연 영상·전원 차단/SD 물리 장애는 실행하지 않았다.
하드웨어 인증/연결 뒤 사용자 행동을 한 단계씩 안내하고 실제 결과로 표를 갱신한다.
모든 gate 완료 전 mvp-v1 태그·08확장은 실행하지 않는다.
