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
하드웨어 시험 추가 전 누적 확정은2,000작업/수량2,251이며 기존1,000건과 새 시험1,000건을 구분한다.
이 F1의 배정/스캔은 소프트웨어 모의 업무다. 원본 전체=99,441=96,596+789+2,056.

## 요구사항별 판정

UI 수용 조건은 API/build만으로 PASS로 판정하지 않았다. 아래 추가 판정은 실제 Pi 화면과 Chrome headless의 React/HTTP 실행에 근거한다.
34 PASS / 0 NOT_RUN / 1 BLOCKED. 실제 Pi 사진·재부팅과 실제 headless 운영 화면 시험을 추가했다. 현재 미수정으로 확인된 업무 결함 FAIL은0이며,
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
| M-E01 | BLOCKED | 실제 C270 사진 QR 해독·폼 입력/브라우저 영상 PASS; 실시간 웹캠 버튼의 광학 QR 시연 미확인 |
| M-E02 | PASS | hardware-2026-10-28/photo-ui-sequence.json: 실제 Pi UI, 저장 정상 사진/합성 형식·상품 오류/초과 경고와 수량·seq 불변 |
| M-E03 | PASS | 새 F1 2,134고유 이벤트 및 local/event-rules: 상품1개·UUID·연속 seq |
| M-E04 | PASS | integration-verified.tap/event-rules, unit-final.tap/local: 특정 스캔/재취소·음수 차단 |
| M-E05 | PASS | 실제 Pi UI에서 수량 부족/취소 뒤 완료 비활성화·정량 시 활성화; 서버 직접 COMPLETE 차단 시험도 PASS |
| M-E06 | PASS | WSL 실제 파일 SQLite SIGKILL·동시 event/state/nextSeq 복구·늦은 ACK; SD 시험 아님 |
| M-E07 | PASS | hardware-2026-10-28/reboot.json: 실제 Pi 정상 재부팅, boot 변경·5사건 hash/seq·수량·취소/전송 상태·snapshot 보존 |
| M-E08 | PASS | 실제 Pi UI LOCAL_COMPLETED/RETRYING·pending5 → SERVER_CONFIRMED/SYNCED·pending0; sync-warning-after.json |
| M-S01 | PASS | commit-boundary.tap: COMMIT 보류 중 HTTP ACK 없음·다른 연결에서 미반영·실패 커밋 |
| M-S02 | PASS | 동시8요청=APPLIED1/DUPLICATE7; 새 F1 DUPLICATE216·수량/집계 일치 |
| M-S03 | PASS | integration-verified.tap/sync: 같은ID 다른본문 BLOCKED·최초 값/감사 보존 |
| M-S04 | PASS | gap DEFERRED/복구·이미 쓴seq 거부·server-clock-after.tap 두 시간대/업무일 |
| M-S05 | PASS | integration-verified.tap/sync·http: 인증 단말·배정 version·수량 불변 |
| M-S06 | PASS | unit-final.tap/device-sync: backoff·Retry-After·5회 예산·수동; 실제 DB 중단 복구 |
| M-S07 | PASS | unit-final.tap/device-sync 및 sync 통합: 차단 작업 이외 전송 지속 |
| M-S08 | PASS | HTTP API SIGKILL 부분 배치·실제 주문 새1,000건 응답 유실100회·재전송 |
| M-A01 | PASS | 실제 Chrome156 headless: 합성54주문 페이지50+4/검색/상태/원본·정규화/보류 정정, admin-browser-final.json |
| M-A02 | PASS | 실제 headless 상세 disclosure·이벤트4·수량3·메모 저장/정정 감사; admin-browser-db.json로 DB 대조 |
| M-A03 | PASS | 실제 headless 사유 필수·단말 선택·최초 배정·재배정 버튼 비활성; DB ASSIGN1/버전1 |
| M-A04 | PASS | 실제 headless 실패5회/오류·재시도 후 PENDING 상세/횟수0·영구 오류 거부; 재시도 job 반복 처리 중복0 |
| M-A05 | PASS | 실제 headless 합성 stale 단말/오래된 관측/pending7 표시; DeviceStatusReport 계약 준수 fixture |
| M-A06 | PASS | 실제 headless 확정1작업/3개/상품2행과 CSV 버튼 다운로드·파일 해시 확인; 실제 Olist 누적 집계는 별도 전수 대사 |
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
| T08 | BLOCKED | 실제 Pi 저장 사진/합성 경고 UI PASS, 실제 C270 영상 열림; 광학 오류 QR 버튼 경로 미확인 |
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
| T29 | BLOCKED | 실제 Pi 정상 재부팅·사진 입력 오프라인/복구 PASS; 실시간 웹캠 QR 시연은 미확인 |
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

## 실제 장비·화면 후속 검증

[장비 결과](../hardware-validation.md)에 실제 Pi5/Node24/C270·사진 QR 해독·
정상 재부팅·SQLite/상태 복원·9사건 서버 확정을 기록했다. 정상 입력은 저장 C270 사진을
실제 Pi 폼에 입력했고 오류 형식/다른 상품은 합성 문자열이다. 실시간 카메라 영상은
열렸으나 QR이 프레임에 없어 광학 QR 버튼의 최종 gate는 통과하지 않았다.
M-E01 및 T08/T29는 BLOCKED 유지, M-E07은 실제 재부팅 증거로 PASS로 갱신했다.
물리 HDMI/전원 차단/SD 손상은 NOT_RUN이며 정상 재부팅으로 이를 보장하지 않는다.

새 UI 결함 IV-06(해결된 동기화 경고 잔류), IV-07(job 재시도 뒤 상세 잔류)을 수정했다.
headless Chrome156의 실제 React/HTTP 시험9개 및 직접 DB 대조를 수행했다.
초기 headless 실패/합성 관측 필드 누락/CSV 하네스 인코딩·세션 실패를 보존했다.
[최종 브라우저](../hardware-2026-10-28/admin-browser-final.json),
[DB·재시도 중복 대조](../hardware-2026-10-28/admin-browser-db.json),
[최종 단위17개](../hardware-2026-10-28/unit-final.tap).
이는 자동 브라우저 조작이며 사람이 UI를 조작하거나 시연 영상을 촬영했다는 뜻은 아니다.

실제 Olist 후속 전수 대사는4,260사건·누적2,002확정·수량2,254·불일치0이다.
[직접 CSV 오라클](../hardware-2026-10-28/source-after-hardware.json).
실제 Pi 업무2건(순수수량3/9사건)은 앞선 소프트웨어 F1 2,000건과 구분한다.
모든 gate 완료 전 mvp-v1 태그·08확장은 실행하지 않는다.
