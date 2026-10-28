# MVP 검증 판정

기준일 2026-10-28 (Asia/Seoul). **전체 MVP 미완료**.
PASS의 입력과 실행 범위는 아래 증거에 구분했습니다.
실제 MySQL 8.4, Redis 7.4/BullMQ, 파일 SQLite, Nest HTTP를 실행했습니다.
fixture는 Olist 원본이 아닙니다. 실제 Olist 원본을 확보하고 전체 수집·분류를 마쳤으며,
F2 작업 생성·원본 독립 대사와 F1 1,000작업 모의 재생·최종 전체 대사는 PASS입니다.
실제 보드/웹캠/SD는 BLOCKED입니다.

증거: `unit-tests-2026-10-28.tap`, `integration-tests-2026-10-28.txt`, `service-faults.json`,
`synthetic-1000.json`, `reconciliation-11111111-1111-4111-8111-111111111111.json`.
실제 입력 증거: [전체 실행](actual-run-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[F1](f1-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[로컬 receipt 관측](f1-local-audit-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[최종 전체 대사](reconciliation-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[실행 자원 표본](actual-runtime-2026-10-28.json).
2026-10-28 회귀: 단위14개·DB/HTTP17개 시험 PASS.
계약 검사·전체 build PASS. 최신 원격 CI는 PASS이며 초기 seed/manifest 경로 실패는 이력에 보존했습니다.

| 시험 | 판정 | 실행한 증거·범위 / 남은 조건 |
|---|---|---|
| T01 | PASS | 실제 DB 페이지 재수집, 주문/작업 UNIQUE; ingestion/tasks 시험 |
| T02 | PASS | 실제 수집기 SIGKILL: 저장 전/중/직전/직후, 재개·checkpoint 대사; crash 시험 |
| T03 | PASS | 누락·취소·다중 판매자·부모 부재 우선 분류; normalization 시험 |
| T04 | PASS | 같은 상품 행 수 2+1, 불연속 item ID도 행 수; normalization·DB 시험 |
| T05 | PASS | 동시/반복 CREATE_TASK, 실제 task 하나; tasks 시험 |
| T06 | PASS | 최초 배정·동일 요청 재전송·다른 요청/본문 거부; tasks 시험 |
| T07 | PASS | snapshot hash·재다운로드·기존 로컬 사건 유지; local·HTTP 시험 |
| T08 | BLOCKED | QR encode/decode·형식·없는 상품·초과는 PASS. 실제 웹캠 입력 미연결 |
| T09 | PASS | 개별 UUID/seq와 누적 수량, synthetic-1000에서 고유 이벤트 4,000개 |
| T10 | PASS | 로컬·서버 취소/재취소/음수 방지; local·event-rules 시험 |
| T11 | PASS | 로컬/로컬 HTTP 부족 완료 차단, 서버 직접 COMPLETE 거부·HOLD |
| T12 | PASS | 파일 SQLite 프로세스 SIGKILL 커밋 경계: event/state/seq 동시 복구. SD 전원 시험 아님 |
| T13 | PASS | 서버 요청 없이 전체 로컬 완료/PENDING, 재시작 후 유지; local·synthetic 시험 |
| T14 | PASS | 실제 HTTP API 첫 커밋 후 SIGKILL/응답 유실, 재전송 DUPLICATE |
| T15 | PASS | 같은 eventId 다른 본문 BLOCKED, 원본 불변, DEVICE 감사 증적 |
| T16 | PASS | seq gap DEFERRED와 기대 seq, 순서 복구·이미 쓴 seq 거부 |
| T17 | PASS | 다른 등록 단말/배정 버전 차단, 수량 불변; sync 시험 |
| T18 | PASS | 실제 HTTP batch 도중 API SIGKILL, 앞 receipt 중복·나머지 반영 |
| T19 | PASS | 차단 작업과 정상 작업의 단말 전송 분리; device-sync 시험 |
| T20 | PASS | 실제 Redis 컨테이너 중단 중 수집 DB 커밋·HTTP 스캔 ACK, ready degraded |
| T21 | PASS | 실제 Redis 재시작 및 별도 missing-delivery 시나리오, DB lease 재발행·BullMQ worker drain |
| T22 | PASS | 워커 자식 프로세스 작업 생성 전후/커밋 후 SIGKILL, 재실행 task 하나 |
| T23 | PASS | 실제 MySQL 컨테이너 중단: ACK 없음, SQLite 재시작 보존·DB 복구 후 HTTP 일치 |
| T24 | PASS | 중복 COMPLETE/report job 및 이미 집계된 날짜의 후속 COMPLETE 재집계 |
| T25 | PASS | 단말 과거/미래 시각과 seq 독립, MySQL 확정 업무일로 집계; sync/report 시험 |
| T26 | PASS | 실제 HTTP 역할 401/403·단말 local origin/host 거부 및 업무 수량 불변 |
| T27 | PASS | 실제 적격1,000주문 모의 입력: 수량1,117·이벤트2,117·전달2,332·응답유실100회·DUPLICATE215·미전송0; 서버 hash/상태/집계 및 최종 대사 일치 |
| T28 | PASS | 실제99,441주문·작업96,596·상품별 수량98,840항목 독립 대사, 원본4파일 hash 일치·오류0 |
| T29 | BLOCKED | Raspberry Pi·모니터·웹캠·SD 미연결. 실제 재시작·QR·오프라인 시연 필요 |
| T30 | PASS | 원본 불변 정정/revision/audit·메모·실패 재시도·오래된 revision job superseded |
| T31 | PASS | 실제 ready503/degraded, max200/body256KiB·검색·CSV·stale 관측·HTTP 정적 화면 제공 |
| T32 | PASS | 같은 원본 key 상충 payload 보존 및 같은 snapshot version 상충 hash 격리 |
| T33 | PASS | 단말 Retry-After/5회 예산·수동 재개, 서버 5회 FAILED·영구 오류 자동/수동 우회 금지 |
| T34 | PASS | 앞 seq ACK 후에도 이후 미전송 로컬 카운트/seq 보존; local 시험 |

T01~T34 중32개 PASS, T08/T29는 실제 장비 BLOCKED입니다.
F1은 실제 원본을 입력으로 사용했지만 배정·스캔은 소프트웨어 모의 업무입니다.
2,117개 ACK의 DB hash를 확인했고 전량/상태/순수 스캔/일별 집계 대사가 일치했습니다.
중복 업무 효과와 ACK 후 DB 누락은 이 검증 범위에서0건입니다.
브라우저 수동 클릭·영상은 별도 NOT_RUN.
독립 검증 세션은 실행하지 않았습니다. 실행 테스트·자체 코드 검토를 그 대신으로 표현하지 않습니다.

## 요구사항 추적

| 요구 | 현재 판정 | 연결 시험·비고 |
|---|---|---|
| M-D01 | PASS | 실제 v2 ZIP/4CSV 보존, hash/bytes/행 수/시각/라이선스 manifest 기록 |
| M-D02 | PASS | 실제 전체 수집/분류/작업/수량 독립 대사 오류0, T28 |
| M-D03 | PASS | fixture의 실제 HTTP 커서 수집; T01 |
| M-D04 | PASS | T02 |
| M-D05 | PASS | T03 |
| M-D06 | PASS | T30 |
| M-W01 | PASS | T04·T05·T28 실제 원본 전체 수량 대사 |
| M-W02 | PASS | T20~T22 |
| M-W03 | PASS | T06 |
| M-W04 | PASS | T07·T32 |
| M-W05 | PASS | T06·T17 |
| M-W06 | PASS | T30 |
| M-E01 | BLOCKED | 실제 웹캠·Pi: T08·T29 |
| M-E02 | PASS | T08 소프트웨어 입력 범위 |
| M-E03 | PASS | T09 |
| M-E04 | PASS | T10 |
| M-E05 | PASS | T11 |
| M-E06 | PASS | WSL 파일 SQLite: T12·T34, 실제 SD는 미검증 |
| M-E07 | BLOCKED | 소프트웨어 재시작 PASS; 실제 Pi 재부팅 T29 필요 |
| M-E08 | PASS | T13 |
| M-S01 | PASS | T14·T20·T23 |
| M-S02 | PASS | T14·T18 |
| M-S03 | PASS | T15 |
| M-S04 | PASS | T16·T25 |
| M-S05 | PASS | T17 |
| M-S06 | PASS | T23·T33 |
| M-S07 | PASS | T19 |
| M-S08 | PASS | T18·T34 |
| M-A01 | PASS | 소프트웨어 API/화면 build; T31, 브라우저 수동 NOT_RUN |
| M-A02 | PASS | T30·T31, 원래 입력·차단 증적 포함 |
| M-A03 | PASS | T06·T26 |
| M-A04 | PASS | T30·T33 |
| M-A05 | PASS | T31 |
| M-A06 | PASS | T24·T25·T31 |
| M-A07 | PASS | T26·T30 |

## 재현과 남은 완료 조건

1. 새 환경의 원본·환경 준비는 README를 따릅니다. 현재 실제 run은 보존되어 있으며,
   `node --import tsx --env-file=.env.olist tools/verify-actual-run.ts`로 재검증할 수 있습니다.
   원본과 SQLite/plan을 지우지 않습니다. 현재 실행은 T28→T27→최종 대사 모두 PASS입니다.
2. [실제 장비 절차](hardware-validation.md)에 따라 Pi 모델/OS/SD/웹캠과 네트워크 경로를
   확인하고 정상/오류/취소/오프라인/재부팅/복구를 실행합니다. 현재 T08/T29 BLOCKED입니다.
3. 브라우저 수동 시연·영상·독립 검증 세션을 실행한 뒤 해당 증거를 연결합니다.
   깨끗한 clone의 소프트웨어 환경 재현은 GitHub CI로 확인했지만 실제 Pi 재현은 미검증입니다.
4. 위 조건과 모든 필수 시험을 통과하기 전 전체 MVP 완료·mvp-v1 태그·08 확장은 보류합니다.

원본 분류99,441 = TASK_CREATED96,596 + DATA_HOLD789 + UNSUPPORTED2,056입니다.
분류 사유/품질 flag는 한 주문에 여러 개가 붙으므로 사유별 수를 더해 전체 분모로 쓰지 않습니다.
성능은 F1 경과361.02초와 자원 표본을 기록했습니다. 통제된 성능 비교·API p95/p99·현장 시간 절감
측정은 NOT_RUN이며 이 수치를 운영 처리 성능으로 해석하지 않습니다.
