# 04. HTTP API와 동기화 계약

HTTP 필드·타입은 [openapi.yaml](openapi.yaml), 예시는 [examples.json](examples.json)을 함께 사용합니다.

## 1. 주소와 인증

- 서버 base URL: /api/v1
- 모의 외부 주문 API: /source/v1
- 단말 로컬 API: /local/v1
- 운영자·등록 단말은 서로 다른 Bearer 토큰을 사용합니다. 서버가 토큰에서 actor/deviceId를 결정합니다.
- 이벤트 본문의 deviceId는 인증된 단말과 같아야 합니다. 요청값만으로 단말을 신뢰하지 않습니다.
- API는 datasetRunId로 데이터를 격리합니다. 실제 운영 서비스의 tenant와 동일한 의미는 아닙니다.
- 목록 기본 limit 50, 최대 200. 단말 이벤트 배치 최대 100개, 요청 body 최대 256 KiB.
- 로컬 API는 UI가 실행되는 loopback과 허용 origin으로 한정합니다. 전체 단말 관리나 원격 임의 셸 실행은 제공하지 않습니다.

## 2. endpoint 목록

| 대상 | Method·경로 | 의미 |
| --- | --- | --- |
| 서버 | GET /health | 프로세스 생존 |
| 서버 | GET /ready | MySQL 필수, Redis 장애는 degraded로 별도 표시 |
| 서버 | POST /ingestion/runs | 등록 datasetRunId의 수집 시작 |
| 서버 | GET /ingestion/runs/{runId} | 수집 진행·커서·통계 |
| 서버 | GET /orders | 주문 목록·검색·상태 필터 |
| 서버 | GET /orders/{orderId} | 원본/정규화·상품·보류·작업 연결 |
| 서버 | POST /orders/{orderId}/corrections | 작업 생성 전 데이터 정정·재검증 |
| 서버 | GET /tasks | 작업 목록 |
| 서버 | GET /tasks/{taskId} | 작업·상품 수량·이벤트·메모 |
| 서버 | POST /tasks/{taskId}/assignment | 미배정 작업의 최초 단말 배정 |
| 서버 | POST /tasks/{taskId}/notes | 업무 상태를 바꾸지 않는 운영 메모 |
| 서버 | GET /jobs | 서버 후속 작업·실패 조회 |
| 서버 | POST /jobs/{jobId}/retry | FAILED 작업의 조건부 재시도 |
| 서버 | GET /devices | 마지막 단말 보고와 stale 여부 |
| 서버 | GET /reports/daily | 확정 기준 집계 |
| 서버 | GET /reports/daily.csv | 같은 조건의 CSV |
| 단말→서버 | GET /device/tasks | 자기 단말에 배정된 스냅샷 |
| 단말→서버 | POST /device/events | 이벤트 배치 적용 |
| 단말→서버 | POST /device/status | 로컬 상태·대기량 관측값 보고 |
| 로컬 | GET /tasks | SQLite 기준 작업 목록 |
| 로컬 | GET /tasks/{taskId} | 로컬 상태·상품·전송 상태 |
| 로컬 | POST /tasks/{taskId}/scans | QR 검증 후 스캔 이벤트 생성 |
| 로컬 | POST /tasks/{taskId}/reversals | 스캔 되돌리기 이벤트 생성 |
| 로컬 | POST /tasks/{taskId}/complete | 로컬 완료 이벤트 생성 |
| 로컬 | GET /sync/status | 대기·차단·최근 성공 |
| 로컬 | POST /sync/retry | 일시 실패 전송 즉시 재시도 요청 |
| 모의 외부 | GET /orders | datasetRunId와 cursor에 따른 원본 페이지 |

표의 서버 경로는 /api/v1, 로컬은 /local/v1, 모의 외부는 /source/v1 뒤에 붙입니다.

서버의 상태 변경 endpoint는 requestId와 사유를 받습니다. 배정·정정·재처리 요청 재전송은 같은 requestId에 같은 결과를 반환해야 합니다. 같은 requestId의 다른 본문은 거부합니다. jobId·taskId를 재사용해 새로운 업무를 강제로 만들지 않습니다.

## 3. 작업 스냅샷

taskId, datasetRunId, externalOrderId, assignmentVersion, deviceId, requiredItems, snapshotHash, assignedAt을 내려줍니다. requiredItems의 productId와 requiredQty는 배정 후 불변입니다.

다운로드는 스냅샷 저장·해시 확인이 끝난 뒤 사용 가능으로 표시합니다. 같은 taskId/version 재다운로드가 로컬 이벤트·진행 수량을 초기화하지 않아야 합니다. 같은 version에 다른 hash가 오면 덮어쓰지 않고 차단합니다.

임의 상품명은 원본 사실로 만들지 않습니다. Olist의 productId·카테고리와 짧은 표시용 ID를 사용합니다.

## 4. 단말 이벤트

### 공통 필드

| 필드 | 타입 | 규칙 |
| --- | --- | --- |
| eventId | UUID string | 단말에서 한 번 생성 후 재전송해도 유지 |
| taskId | UUID string | 배정받은 작업 |
| deviceId | string | 인증된 단말과 일치 |
| assignmentVersion | integer ≥1 | 스냅샷 버전 |
| seq | integer ≥1 | 작업/배정 버전별 1부터 연속 증가 |
| type | SCAN_ITEM / REVERSE_SCAN / COMPLETE | 세 종류만 허용 |
| occurredAt | offset 포함 date-time | 관측 정보. 정렬·권한·날짜 확정의 단독 근거로 사용하지 않음 |
| payload | type별 object | 미지원 키·타입 거부 |

### type별 payload

- SCAN_ITEM: productId, quantity=1.
- REVERSE_SCAN: targetEventId. 같은 작업·버전의 성공한 SCAN_ITEM이고 아직 취소되지 않아야 합니다.
- COMPLETE: 빈 object. 서버의 유효 스캔 합계가 requiredQty와 모두 같아야 합니다.

quantity를 임의로 크게 보내는 대량 카운트 수정은 없습니다. 작업자 입력 실수는 명시적인 REVERSE_SCAN으로 남깁니다.

event hash는 서버와 단말이 동일한 계약 필드의 canonical JSON으로 계산합니다. 키 정렬·UTF-8·누락 금지·숫자 정수 규칙을 shared-contracts에 고정하고 known-answer 테스트를 둡니다. HTTP batchId, 전송 시각 등 재전송 때 바뀌는 값은 event hash에 넣지 않습니다.

## 5. 서버 처리 결과

| result | 의미 | 단말 행동 |
| --- | --- | --- |
| APPLIED | DB 업무 반영과 receipt 커밋 완료 | ACK 저장. 로컬 기록은 보존 정책에 따라 유지 |
| DUPLICATE | 같은 ID·내용의 기존 receipt 존재 | originalResult를 적용. 기존 REJECTED면 실패 상태 유지 |
| REJECTED | 올바른 형식·순서의 이벤트지만 업무 규칙 충돌. 거부 receipt와 seq 소비를 커밋 | 해당 작업 BLOCKED, 해당 이벤트·사유 보존 |
| DEFERRED | 일시 장애 또는 앞 seq 누락. 업무·seq 미반영 | 필요한 앞 이벤트부터 재전송 |
| BLOCKED | 소유권·버전·내용 충돌 또는 작업이 이미 HOLD. 업무·seq 미반영 | 해당 작업 전송 중지, 운영자 확인 |

HTTP 200은 배치 요청의 처리 결과를 반환했다는 뜻이며, 모든 이벤트 성공이라는 뜻이 아닙니다. 각 result를 확인합니다. 서버가 중간에 종료되면 앞 이벤트는 커밋됐을 수 있으므로 전체 미확인 이벤트를 같은 ID로 재전송합니다.

MVP UI의 SERVER_CONFIRMED는 COMPLETE가 APPLIED였거나 DUPLICATE의 originalResult가 APPLIED이고, receipt의 taskStatus가 CONFIRMED인 경우에만 표시합니다.

## 6. 검사 순서

1. 요청 인증·스키마·크기 검사. 실패하면 해당 요청에 대한 400/401/413, 이벤트 미적용.
2. task 잠금 후 같은 deviceId/eventId 조회. 기존 내용이 같으면 저장된 최초 결과를 반환합니다. task가 이미 완료됐어도 중복 검사를 우선합니다.
3. eventId 재사용·seq 충돌 확인. 다른 본문은 BLOCKED/EVENT_ID_REUSED. 기존 기록을 덮어쓰지 않습니다.
4. 단말·배정 버전·작업 상태 확인. 미배정·다른 단말·다른 버전은 BLOCKED.
5. seq 확인. 기대 seq보다 크면 DEFERRED/SEQUENCE_GAP, expectedSeq를 반환합니다. 작은 seq를 새 eventId가 쓰면 BLOCKED/SEQ_ALREADY_USED.
6. 도메인 규칙 적용. SCAN의 수량 한도, REVERSE의 대상, COMPLETE의 수량 일치 확인.
7. 통과하면 APPLIED, 순서가 맞지만 업무상 불가능하면 REJECTED를 영구 저장합니다. REJECTED는 해당 seq를 소비하고 작업을 HOLD로 전환합니다.
8. 커밋 후 응답합니다. 같은 작업에 REJECTED가 생긴 뒤 배치의 후속 이벤트는 BLOCKED이며 다른 작업은 계속 처리합니다.

seq와 도메인 변경은 같은 잠금·트랜잭션 범위에서 다룹니다. 워커 병렬 수 증가가 이 순서를 깨뜨리지 않도록 합니다.

## 7. 재시도와 격리

- 단말은 동일 작업 이벤트를 seq 순서로 보내고 기본 동기화 요청 1개만 진행합니다.
- 한 작업에 문제가 생겨도 다른 작업의 전송은 계속합니다.
- 네트워크 오류·5xx는 재시도하며 지수 대기는 1초부터 최대 60초, jitter를 둡니다. 설정값은 결과 보고서에 남깁니다.
- 429는 Retry-After를 우선하고 호출량을 줄입니다.
- 401/403은 무한 반복하지 않고 인증 문제로 표시합니다.
- APPLIED/DUPLICATE의 성공 receipt만 정상 전송 완료로 취급합니다.
- REJECTED/BLOCKED의 입력을 수정해 같은 eventId로 다시 보내지 않습니다.
- 서버 receipt 저장과 로컬 상태 갱신을 SQLite 트랜잭션으로 처리합니다.
- 늦게 도착한 receipt의 appliedItems로 로컬 전체 카운트를 덮어쓰지 않습니다. 해당 seq까지의 서버 확정 정보와 이후 아직 전송되지 않은 로컬 이벤트를 구분하고, 로컬 projection은 전체 로컬 이벤트를 순서대로 재계산합니다.
- 로컬 사건 기록은 ACK 직후 삭제하지 않습니다. 기본 7일 보관은 초기 정책값이며 실제 보존 요구에 맞춰 조정합니다. 미확인·차단 이벤트는 자동 삭제하지 않습니다.

## 8. 보류와 재처리의 권한

서버 job 재시도는 같은 업무를 다시 계산하는 행위입니다. 이미 반영된 이벤트를 또 적용하는 기능이 아닙니다. DATA_HOLD 정정은 작업 생성 전만 가능합니다.

잘못된 스캔 payload, 다른 버전 이벤트, 완료 후 추가 스캔 등은 어드민의 '재시도'로 무시하고 통과시키지 않습니다. MVP에서는 증거 보존·메모·해당 작업 격리까지 수행합니다. 승인 기반 정정 사건과 재배정 정책은 E2입니다.

## 9. QR 규격

프로젝트 생성 QR의 text는 LOPS1:PRODUCT:<sourceProductId>입니다. sourceProductId는 해당 datasetRun에 존재하는 Olist productId입니다. 이 문자열은 본 프로젝트 전용 표식이며 실제 유통 바코드가 아닙니다.

QR은 상품 식별자만 담습니다. API 토큰·운영자 권한·임의 명령은 포함하지 않습니다. 형식이 틀리거나 스냅샷에 없는 상품은 정상 스캔 이벤트를 생성하지 않습니다.

## 10. 시각·집계 날짜

서버 confirmedAt은 서버 DB 커밋 시각입니다. confirmedBusinessDate는 이 시각을 설정한 업무 시간대로 바꾼 날짜입니다. 오프라인 중 작업자가 완료한 실제 시각은 localCompletedAt 관측 정보로 별도 보존합니다.

구현 보완(2026-10-27): committedAt/confirmedAt은 트랜잭션의 마지막 기록 직전에
MySQL UTC 시계에서 얻은 확정 기록 시각입니다. ACK는 COMMIT 성공 후에만 반환하며,
필드는 DB 엔진 로그의 정확한 commit timestamp를 의미하지 않습니다.
UTC epoch 차이로 계산하여 MySQL 세션 시간대가 UTC가 아니어도 확정 시각과 업무일이 바뀌지 않습니다.
CONFIRMED는 terminal이므로 새 eventId의 추가 입력은 BLOCKED/TASK_ALREADY_CONFIRMED이며
seq·확정·집계를 바꾸지 않습니다. 기존 eventId 중복 검사는 이 상태 검사보다 우선합니다.

로컬 보존 이력·취소 대상·차단 사유는 GET /local/v1/tasks/{taskId}/history로 조회합니다.
GET /local/v1/health는 프로세스와 SQLite 상태를 확인합니다.

IngestionStart의 HTTP 계약에는 reason 필드가 없으므로 이 명령은 고정된
수집 시작/재개 사유와 actor/requestId를 감사 기록에 남깁니다. 다른 운영 변경은
계약의 사용자 사유를 보존합니다. BLOCKED는 업무 수량/seq를 바꾸지 않으며,
별도 DEVICE 감사 증적과 작업 상세 syncIncidents에 차단 근거를 보존합니다.
작업 상세 eventBodies는 receipt와 함께 원래 스캔/취소/완료 입력을 표시합니다.

단말 시계가 틀릴 수 있어 MVP 집계는 서버 확정 기준입니다. '현장 작업일 기준 집계'는 시계 신뢰 정책을 포함해 E2에서 추가합니다.
