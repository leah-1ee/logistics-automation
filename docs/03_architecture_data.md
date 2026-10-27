# 03. 아키텍처와 데이터 모델

## 1. 기본 배치

모듈형 모놀리스로 개발합니다. API와 워커는 같은 도메인 모듈을 사용하지만 별도 프로세스로 실행합니다. 마이크로서비스 분리는 하지 않습니다.

~~~mermaid
flowchart TD
    S["모의 주문 API"] --> A["NestJS API·수집기"]
    P["라즈베리파이·SQLite"] --> A
    U["React 운영 어드민"] --> A
    A --> D["MySQL·업무 기록·Outbox"]
    D --> R["Outbox 발행기·복구기"]
    R --> Q["Redis·BullMQ"]
    Q --> W["작업 생성·집계 워커"]
    W --> D
~~~

React 현장 화면은 단말의 로컬 프로그램에 요청합니다. 로컬 프로그램만 SQLite와 스캐너/카메라에 접근하고 서버 동기화를 수행합니다. 화면이 서버 API를 직접 호출해야만 스캔되는 구조를 피합니다.

## 2. 모듈 경계

| 모듈 | 소유 책임 |
| --- | --- |
| source-adapter | 외부 응답→원본 수집 레코드, 페이지·커서·오류 변환 |
| ingestion | 체크포인트, 원본 해시, 정규화·적격성 판단 |
| fulfillment | 주문→작업, 배정, 상품 수량과 완료 불변 조건 |
| device-sync | 인증, 스냅샷, 순서·중복·ACK·충돌 |
| jobs | outbox 발행·재발행, BullMQ, 실행 기록·재시도 |
| reporting | 확정 작업에서 일별·상품별 집계·CSV |
| operations | 어드민 조회, 메모, 허용된 재처리, 감사 |
| device-agent | SQLite, 로컬 이벤트·상태, 스캐너, 자동 전송 |

도메인 로직은 HTTP DTO·BullMQ 객체·ORM 엔티티의 외부 호출에 묶지 않습니다. 작업 완료 판단은 HTTP와 큐 경로에서 재사용할 수 있는 단일 규칙입니다.

## 3. MySQL 논리 테이블

| 테이블 | 주요 필드 | 제약·용도 |
| --- | --- | --- |
| dataset_runs | id, datasetVersion, fileHashes, scenarioHash, status, counts | 원본/시뮬레이션 구분, 재현성 |
| source_checkpoints | runId, source, cursor, updatedAt | UNIQUE(runId, source) |
| raw_orders | id, runId, source, sourceRecordId, externalOrderId, payload, payloadHash | UNIQUE(runId, source, sourceRecordId), 유효 externalOrderId에도 유일 제약, 원본 불변 |
| products | runId, sourceProductId, category, weightG, dimensions | UNIQUE(runId, sourceProductId) |
| orders | id, rawOrderId, revision, status, sellerId, readyAt, holdReason | UNIQUE(rawOrderId), 같은 내부 orderId에서 revision 증가·이전 값 감사 보존 |
| order_items | orderId, sourceProductId, requiredQty | UNIQUE(orderId, sourceProductId), qty 양수 |
| tasks | id, orderId, status, deviceId, assignmentVersion, lastProcessedSeq, confirmedAt | UNIQUE(orderId), 조건부 상태 전환 |
| task_items | taskId, productId, requiredQty, appliedQty | UNIQUE(taskId, productId), 0≤appliedQty≤requiredQty |
| task_scans | eventId, taskId, productId, reversedByEventId | 각 스캔 한 번만 취소 |
| device_events | deviceId, eventId, taskId, seq, assignmentVersion, canonicalHash, type, payload, outcome, receipt | UNIQUE(deviceId,eventId), UNIQUE(taskId,assignmentVersion,seq) |
| devices | id, tokenHash, enabled, lastSeenAt, lastReportedPendingCount, reportObservedAt, appVersion | 토큰 원문 저장 금지 |
| outbox_jobs | id, runId, type, aggregateId, dedupeKey, payload, status, availableAt, leaseUntil, attempts | UNIQUE(dedupeKey), PENDING/DISPATCHED/DONE/FAILED |
| job_attempts | jobId, attempt, startedAt, endedAt, errorClass, errorCode | 실행 이력, 재처리 근거 |
| report_daily | runId, businessDate, taskCount, itemCount, computedAt | 기준 작업에서 재생성 가능 |
| report_daily_product | runId, businessDate, productId, quantity, computedAt | 상품별 확정 수량 |
| audit_logs | actorType, actorId, action, targetId, reason, beforeAfter, at | 운영 변경 증적·정규화 이전 값 |
| admin_requests | actorId, requestId, targetId, canonicalHash, storedResponse, createdAt | UNIQUE(actorId,requestId), 운영 변경 재전송의 결과 보존 |

카운터 필드 타입·인덱스·마이그레이션은 실제 쿼리를 기준으로 구체화합니다. enum 값·논리 제약을 DB와 도메인 검증에 반영합니다. MySQL 버전에 따라 제약 지원 여부를 확인하고 테스트합니다.

전체 원본 수집은 작업 적격 여부와 무관합니다. raw_orders와 products/order source record 보존을 통해 제외된 레코드도 추적합니다. 원본 주문 상품은 별도 raw source 저장소 또는 파일 해시+행 위치로 복원 가능하게 유지합니다. sourceRecordId는 정상 주문의 원본 key이며 key가 없는 오류 행은 파일 해시와 행 번호로 결정적인 식별자를 만듭니다.

## 4. SQLite 논리 테이블

| 테이블 | 역할 |
| --- | --- |
| task_snapshots | 불변 스냅샷, 해시, 단말 배정 버전 |
| local_events | UUID, 작업별 seq, 내용, hash, 서버 receipt, 전송 상태 |
| local_task_state | 적용 카운트, 취소 여부, localStatus, nextSeq |
| local_audit | 잘못된 QR 등 상태를 바꾸지 않은 입력 |
| sync_meta | 마지막 서버 접속, 대기 설정, 앱 버전 |

정상 스캔/되돌리기/완료마다 local_events 삽입, local_task_state 변경, nextSeq 증가를 같은 SQLite 트랜잭션에 넣습니다. 부팅 시 이벤트에서 projection을 재계산할 수 있어야 합니다.

WAL과 동기 쓰기 설정은 실제 SD 저장소에서 전원·프로세스 종료 시험을 거쳐 기록합니다. 디스크 불량·장치 분실까지 데이터 보존을 보장하지 않습니다. 저장 실패 시 입력 성공 표시를 하지 않습니다.

## 5. 트랜잭션 경계

### 주문 페이지 수집

한 배치의 원본·정규화 결과·ORDER_READY outbox와 체크포인트를 일관되게 커밋합니다. 배치가 크면 하위 저장 단위와 재실행 키를 사용하되 처리되지 않은 레코드 뒤로 체크포인트를 넘기지 않습니다. 체크포인트는 실제로 영구 보관된 페이지까지의 위치입니다.

### 출고 작업 생성

order를 잠그고 적격 상태·기존 task 존재·job의 정규화 revision이 현재 값인지 확인합니다. tasks/task_items 생성과 생성 작업 outbox DONE 처리를 같은 트랜잭션에 넣습니다. 중복 실행이면 기존 결과를 확인하고 완료 처리합니다. 작업 생성 전 정정도 같은 order 잠금을 사용하며 revision을 증가시킵니다. 오래된 revision의 job은 업무를 만들지 않고 SUPERSEDED 결과로 DONE 처리합니다.

### 단말 이벤트 적용

1. 인증·스키마·요청 크기를 확인합니다.
2. 해당 task를 잠그고 중복 eventId를 먼저 확인합니다.
3. 소유권·assignmentVersion·seq·상태·상품 수량 규칙을 검사합니다.
4. event receipt, 스캔/취소/카운트, task 상태, 필요 outbox를 한 트랜잭션으로 커밋합니다.
5. 커밋 후 ACK를 반환합니다.

이벤트 1개를 트랜잭션 1개로 처리합니다. 한 HTTP 배치 전체를 하나의 트랜잭션으로 묶지 않으므로 부분 성공이 가능합니다. 응답 유실 시 저장된 receipt를 다시 반환합니다.

## 6. 큐와 작은 Outbox

Redis + BullMQ, 기본 큐 이름 ops-jobs, 워커 1개·동시성 1부터 시작합니다. 초기 job type은 CREATE_TASK와 REBUILD_REPORT_DAY입니다. 디바이스 이벤트 적용 자체는 동기 MySQL 트랜잭션이며 큐에 위임하지 않습니다.

큐 payload는 outboxJobId와 type 중심입니다. 실제 업무 입력은 MySQL에서 읽습니다.

- outbox 기록은 주문/완료 상태 변경과 같은 DB 트랜잭션에 생성합니다.
- 발행기는 PENDING을 큐에 넣고 DISPATCHED·leaseUntil을 기록합니다.
- 워커는 DB의 완료 여부를 확인한 뒤 업무 변경과 DONE을 같이 커밋합니다.
- 완료 기록이 없고 lease가 지난 DISPATCHED는 복구기가 재발행할 수 있습니다.
- 큐 ID가 같아도 Redis의 보관 기간 이후 사라질 수 있으므로 DB dedupeKey와 업무 제약을 최종 기준으로 사용합니다.
- CREATE_TASK dedupeKey는 orderId+정규화 revision, REBUILD_REPORT_DAY는 datasetRunId+업무일+완료 eventId를 사용합니다. 날짜 하나의 DONE job 때문에 이후 완료분 집계가 생략되지 않게 합니다. BullMQ jobId에는 outbox UUID만 사용합니다.
- 발행 후 상태 기록 전에 종료되거나 Redis가 큐를 잃으면 재발행이 발생할 수 있습니다. 중복 실행은 정상 복구 경로로 취급합니다.
- FAILED는 무한 재발행하지 않고 운영자 조치 대상으로 보존합니다.

기본 재시도: 일시 오류 최대 5회, 지수 대기+jitter. 입력 오류·권한 오류·불가능한 도메인 상태는 자동 반복하지 않습니다. 설정값과 실제 라이브러리 동작은 구현 시 고정합니다.

작은 outbox와 미완료 대사는 MVP에서 포함합니다. Redis 장애 시에도 주문은 저장됐는데 작업이 영구 누락되는 틈을 막기 위해, 대규모 확장과 별개로 필요한 최소 복구 장치입니다.

## 7. 집계

작업이 CONFIRMED가 되면 해당 업무 기준일에 대한 재집계 job을 기록합니다. 기본은 해당 날짜의 CONFIRMED task/task_items에서 합계를 다시 계산해 upsert하는 방식입니다. 같은 job을 재실행해도 결과가 같습니다. +1 형태의 비원자적 누적만으로 구현하지 않습니다.

보고서에는 computedAt과 대기 중인 재집계 유무를 표시합니다. 작업 확정 ACK와 보고서 갱신 완료는 별도입니다. E1에서 증분 집계를 도입하면 작업별 집계 반영 ID와 전체 재대사 수단을 추가합니다.

## 8. 장애 시 기대 동작

| 장애 | 지속 가능한 행동 | 복구 |
| --- | --- | --- |
| 서버/API 중단 | 단말이 내려받은 작업 기록 | 이벤트 재전송 |
| Redis 중단 | API의 주문 보관·단말 이벤트 DB 반영 | outbox 재발행, 작업 생성/집계 따라잡기 |
| MySQL 중단 | 기존 작업의 단말 로컬 기록 | DB 복구 후 적용, ACK 전에는 로컬 미반영 유지 |
| 단말 프로그램 종료 | 이미 커밋된 기록 보존 | 부팅 후 projection·outbox 복구 |
| 워커 종료 | API·단말 업무 계속, 서버 후속 작업 지연 | 큐 재시도 + DB 미완료 대사 |

서버가 꺼진 동안 새 주문 수집·신규 작업 배정이 계속된다고 주장하지 않습니다.

## 9. 기술·배포 기준

단일 저장소에서 server, admin-web, device-agent, device-web, source-simulator, shared-contracts, tools로 나눌 수 있습니다. API DTO·단말 이벤트 enum·검증 schema는 공통 계약에서 생성하거나 검증합니다.

서버·MySQL·Redis·워커·시뮬레이터는 Docker Compose로 실행하고 SQLite/원본/DB는 영구 볼륨을 사용합니다. 단말 프로그램은 로컬 서비스로 실행하며 재시작 정책을 설정합니다. API 외부 접근은 HTTPS, 단말 로컬 API는 loopback과 제한된 origin을 기본으로 합니다. 전체 인증 서버·SSO는 후속 범위입니다.
