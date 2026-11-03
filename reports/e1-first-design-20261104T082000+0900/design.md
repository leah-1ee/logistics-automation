# 첫 E1 상세 설계: full batch 뒤 dispatcher 연속 예약

작성: 2026-11-04 Asia/Seoul. **설계만 작성 / 제품 구현·기동·추가 pilot·시험 미실행.** 보고서 기준 `92216b48575d334968d67df638eb143e2095f5a3`, 공개 제품 baseline `954bb692a244803b8aad695539d81afdcb81a091`. 이 문서는 [기존 기록 분석](analysis.md)에 따른 첫 변경 제안이며 운영 성능 개선 완료를 뜻하지 않는다.

## 1. 문제·목표·선택

기존 실제 B0는 수집 99,441건을 끝냈으나 적격 96,596건 중 task 65,973개를 생성한 상태에서 drain deadline으로 종료했다. 미완료 30,623건 때문에 독립 대사가 FAIL이며 시간 coverage도 INVALID다. 이 기록을 성공 baseline으로 재분류하지 않는다.

같은 worker 프로세스의 비어 있지 않은 배치 660개는 모두 후보 100개를 골랐다. 완료 배치 659개의 p50 소요는 1.795초이며 다음 scan은 p50 2.000초/p95 3.001초 간격으로 시작했다. 배치 종료 관측→다음 scan 공백 271.872초 중 worker의 다음 job 진입 공백과 221.526초가 겹친다. 이는 **full batch 뒤 다음 interval tick을 기다리는 공급 공백을 줄일 후보 근거**다. 타이머 skip의 실제 callback 수나 그 공백 전부의 원인이 직접 계측된 것은 아니다.

목표는 단일 dispatcher가 full batch 뒤 event loop에 yield하고 다음 배치를 곧바로 요청하는 것이다. 발행 병렬화·worker 확대·쿼리 최적화와 섞지 않는다. 성능 목표는 동일 조건에서 full batch 사이의 불필요한 예약 공백을 줄이고 전체 완료 관측 시간을 줄이는 것이다. 감소 폭은 미확정이다. 기존 gap 비율로 개선율을 예측하거나 보장하지 않는다.

대안 판정은 다음과 같다.

| 대안 | 결정 |
|---|---|
| 기존 코드 + 더 긴 bounded 관측 | 새로운 비교 baseline의 완료 관측 조건으로 필요. **관측 예산 증가이며 성능 개선이 아님** |
| dispatcher full-batch continuation | 첫 E1로 선택. 기존 scan/row transaction/순차 발행을 유지하는 좁은 변경 |
| dispatcher 병렬 발행 | 제외. lock·pool·순서·실패 경계를 함께 바꿀 근거 부족 |
| worker concurrency 또는 프로세스 확대 | 제외. 공급 공백이 관측됐고 확대 시 DB 경합·pool 총량도 달라짐 |
| SQL/transaction/인덱스·commit 비용 개선 | 제외. 공용 SQL 소속과 tx 잔여 원인이 UNKNOWN. 내구성 완화 금지 |

이 선택에는 추가 측정의 선행 요구가 없다. 실제 효과 검증은 구현 이후 별도 승인된 동일 조건 비교에서만 수행한다. 현재 자료로 E1-03 전체 적체 제어·속도 조절이나 운영 병목을 확정하지 않는다.

## 2. 변경 범위와 보존 계약

| 모듈/자원 | 예정 변경 | 보존 사항 |
|---|---|---|
| `src/jobs/jobs.ts:66~72` | 단일 실행 소유권·예약 handle 관리, full batch 후 continuation, close 시 예약 취소/진행 중 dispatch 합류 | startJobs 반환 `{queue,worker,close}`; Queue/Worker 이름과 연결; worker concurrency1 |
| `dispatch()` (`jobs.ts:51~64`) | **업무 본문·반환값 변경 없음** | 후보 LIMIT100, `ORDER BY available_at`, 순차 for/await, row당 transaction, return은 후보 수 |
| worker 설정 | 신규 내부 enum `OUTBOX_DISPATCH_MODE=interval\|continue-full`; 미설정 기본 `interval` | 주기 1000ms·batch100·lease30000ms 고정. 병렬도 옵션 추가 안 함 |
| 계측 (`src/observability/b0.ts`, schema) | 전후 공통으로 적용할 최소 clock bracket/heartbeat 설계만 별도 준비 단계 | 기본 OFF, fixed label/allowlist, 비차단 async sink, 8192/8MiB buffer·process 누적 파일2GiB·tx 후보2048 유지 |
| 격리 실행 도구/manifest | 두 실험에 동일한 clock observer·관측 예산, mode·해시·종료 시각 정의를 명시 | 기존 root 재사용 금지, 새 프로젝트/DB/Redis/volume/run/secrets, 입력6파일 개별 RO |
| DB·migration·pool | 변경 없음 | schema·constraints·UNIQUE·FK·pool max8/process·buffer512MiB·flush1/sync_binlog1 |
| API·계약·payload | 변경 없음 | OpenAPI/docs01~09/shared contracts, ingestion POST/body/requestId·sourceAvailableAt·job payload |
| queue·Redis | 변경 없음 | 전용 Redis의 `bull/ops-jobs`, jobId=outbox id, attempts1, removeOnComplete/Fail, AOF everysec/noeviction |
| source/수집/task/단말/보고서 | 변경 없음 | source-main→API 내부 collect→worker-main, page200/master200, 분류·수량·revision·task 중복 방지·장비 event ACK |

기존 `.env`나 Compose를 운영용으로 고치지 않는다. 신규 mode는 준비할 새 실험 manifest가 명시하며 제품 기본은 interval이다. 알 수 없는 enum 값은 worker 기동 전에 설정 오류로 거부하도록 설계한다. migration·dependency·lockfile·새 테이블·API·queue·cache는 필요하지 않다. 기존 dedupe key, `tasks.order_id UNIQUE`, `FOR UPDATE` 잠금도 그대로다.

단일 worker라도 dispatch scan은 전 run 대상이라는 기존 동작을 유지한다. 실험은 전용 DB의 한 run이다. 새 scheduler가 strict global FIFO를 보장한다고 표현하지 않는다. 기존 `ORDER BY available_at`의 동률 순서·재시도/lease 순서 의미를 강화하거나 바꾸는 설계는 아니다.

## 3. 실행 예약 상태와 동작

새 스케줄러는 interval과 immediate trigger가 공유하는 실행 소유권 하나만 갖는다. 상태는 IDLE / RUNNING / CLOSING / CLOSED다. 기존 1초 interval은 유지한다. `continue-full`에서 성공한 `dispatch()`의 반환 후보 수가 100일 때만 `setImmediate`로 다음 실행을 예약한다. 재귀 호출이나 여러 배치 Promise의 누적은 하지 않는다.

```text
interval tick ─┐
              ├─ requestRun(): closing/inFlight이면 실행하지 않음
immediate ────┘                 아니면 남은 immediate 취소 후 dispatch 하나 시작
                                 │
                        성공 n < 100 또는 오류 → 다음 기존 interval까지 대기
                                 │
                        성공 n = 100 + continue-full → setImmediate 하나 예약
                                 │
                        closing → 재예약 없음, 진행 중 Promise만 합류
```

정확한 규칙:

1. 시작 직후의 첫 실행은 기존처럼 첫 interval tick이다. baseline mode는 interval-only이고 full 배치 후 별도 예약이 없다.
2. RUNNING 중 interval은 기존 busy guard처럼 생략한다. 여러 callback을 대기열에 쌓지 않는다.
3. full batch가 끝나면 inFlight를 정리하고 continuation 한 개만 둔다. 이미 interval이 다음 실행을 선점하면 pending immediate를 취소한다. 모든 진입점이 동일한 단일 소유권 검사를 거치므로 dispatch 중첩은 최대1이다.
4. 0~99개 반환 또는 dispatch 예외이면 immediate를 예약하지 않는다. 기존 interval에서 다시 시도한다. 새 exponential retry나 catch-up 무한 루프를 만들지 않는다.
5. `dispatch()`의 return은 실제 발행 수가 아니라 후보 수다. 후보가 concurrent DONE/lease 변화로 건너뛰어졌어도 n=100이면 한 번 더 scan할 수 있다. 다음 scan/row 재확인 조건은 그대로이며 빈 결과이면 즉시 연속 실행을 멈춘다. skip을 실제 발행 성공으로 세지 않는다.
6. full batch continuation도 한 번에 최대100개를 순차 발행한다. LIMIT·pool·transaction을 늘리지 않는다. 실제 처리 속도와 pending Redis가 달라질 수 있으므로 기존 메모리/정체/정합성 guard를 유지한다. 이 버전에는 새 backlog feedback controller를 섞지 않는다.
7. close는 CLOSING 전이→interval/immediate 취소→현재 dispatch Promise 합류→worker.close()→queue.close() 순서다. close 중 완료한 dispatch는 continuation을 만들지 않는다. **이 합류는 신규 예약 소유권의 종료 처리이며 기존 shutdown 오류의 원인을 해결했다고 미리 주장하지 않는다.** 기존 interval 모드도 신규 소유권 아래서는 종료 시 진행 중 dispatch를 기다리는 점을 명시적으로 회귀 검증한다.

full batch 완료→예약→다음 scan 사이의 event-loop 지연은 남는다. setImmediate가 지연 0이나 CPU 독점을 보장하지 않는다. 따라서 기대 결과는 약 1초 tick 위상 대기를 줄이는 것이며 정확한 271.872초 절감이 아니다.

## 4. 실패·재시도·중복·복구

- 업무 transaction 경계를 유지한다. Redis get/state/remove/add가 기존 row lock transaction 안에 있는 순서도 바꾸지 않는다. **Redis add는 dispatch DB 커밋보다 먼저 일어날 수 있다.** DB와 Redis의 원자적 발행을 새로 보장한다고 쓰지 않는다.
- worker는 기존 processJob의 `FOR UPDATE`·available_at·revision·기존 task 확인 뒤 task/품목/상태/DONE/시도 기록을 한 transaction으로 처리한다. 성공 resolve 후에만 callback이 반환되고 BullMQ의 후속 ACK로 이어진다. ACK를 앞당기지 않는다.
- dispatcher 예외는 기존 로그/다음 interval 재시도 경로를 유지한다. dispatcher 오류를 worker의 attempts/FAILED로 대신 기록하지 않는다. 업무 catch나 transient/permanent 분류도 바꾸지 않는다.
- Redis add 성공 뒤 dispatch transaction 실패/프로세스 crash는 기존 at-least-once 영역이다. worker가 PENDING 행을 다시 읽을 수도 있고, DISPATCHED lease 만료 뒤 다시 발행될 수도 있다. idempotent jobId·row 재검사·task UNIQUE로 중복 효과를 막는 기존 규칙을 보존한다. 불확실한 성공을 새로 DONE으로 만드는 경로를 추가하지 않는다.
- 자동5회·기존 backoff/jitter·조건부 단건 수동 retry·lease30000ms를 유지한다. FAILED job을 scheduler가 자동 초기화하지 않는다.
- `job_completed`/task sidecar는 DB와 원자적이지 않다. rollback 후보 폐기·post-commit logging 오류 격리·drop/error/candidateDrops·sequence/clean-close/ID coverage를 그대로 유지한다. logging 실패가 FAILED·재시도·ACK·반환값에 영향을 주어서는 안 된다.
- close가 DB/Redis I/O에서 끝나지 않으면 운영의 기존 제한 shutdown 유예를 적용하고 실험만 정지한다. unresolved Promise를 성공으로 만들거나 조기 ACK하지 않는다. 강제 종료 시 상태·volume·오류·coverage 실패를 보존하고 새 실행을 자동 시작하지 않는다.
- 시계 이상은 관측만의 문제가 아닐 가능성도 있다. available_at/lease는 Date.now 계열을 쓰므로 영향 가능성은 UNKNOWN이다. 기존 pilot에서 발행 ID 중복·job 재시도 증거는 없었지만 미래에도 안전하다는 증명은 아니다. 첫 변경에 clock/lease 업무 규칙 교체를 포함하지 않는다.

## 5. 다음 비교에 필요한 최소 시계 계측 보완

이 보완은 **baseline과 E1 양쪽에 동일하게 먼저 적용할 관측 준비 사항**이다. 이번에 구현하지 않는다. 기존 timestamp 수정·offset 보정·표본 삭제·유효 판정 완화는 금지한다.

| 항목 | 설계 |
|---|---|
| 같은 프로세스 bracket | API/worker/source에서 시작·종료 및 5초마다 `hrtime m0 → Date.now wall → hrtime m1`를 연속 취득. 원본 m0/m1/wallEpochMs와 sequence/process identity를 fixed `clock.sample`로 기록. header의 기존 wall/mono와 구분 |
| sampling 지연 | 예정 monotonic deadline과 실제 m0를 함께 기록해 heartbeat 누락/late 여부를 드러냄. timer가 안 돌았다고 시계 점프로 단정하지 않음 |
| host driver | 같은 주기로 `monotonic_ns m0 → time_ns wall → monotonic_ns m1`. 가능하면 동일 sample에 `CLOCK_BOOTTIME` 참고값과 clock resolution을 기록. 불가하면 UNKNOWN. 독립 기준과의 정확한 초 보증이라고 쓰지 않음 |
| 실행 metadata | Node/Python/kernel 버전, 읽을 수 있는 clocksource·time namespace·boot identity hash를 시작/종료에 기록. NTP/시계/호스트 설정 변경·새 daemon·권한 추가는 하지 않음 |
| cross-process 정렬 | 시작/종료의 기존 host 요청 bracket을 보강해 서비스 clock sample을 대응. 왕복 폭·시간차·drift 한계를 보고하며 임의 보정 mapping으로 정확 commit timestamp를 만들지 않음 |
| sink/schema | 고정 allowlist 필드, 관측 schema version 식별, 기본 OFF·기존 buffer/파일 cap 사용. heartbeat도 기존 sequence/drop/error 검사를 통과해야 함. 샘플 수/기록 비용을 보고 |

단일 clock sample의 wall 위치는 `[m0,m1]`의 폭 안에서만 대응한다. 인접 bracket의 wall 차이와 가능한 monotonic 차이 구간이 오차 예산 밖으로 어긋나면 anomaly다. 기존 >1초 기준을 유지하고, 그보다 작아도 누적 차이를 함께 보고한다. 기존 기록에서 worker >1초 6건의 합은 7.791초지만 전체 차이는 67.288초였으므로 단일 threshold 통과만으로 정밀도를 보장하지 않는다.

후속 실험 전 고정할 gate: clock bracket 폭 p99≤10ms, 누락 0, 기존 interval anomaly 0, 유효 bracket으로 산출한 누적 wall/mono 경과 차이≤max(100ms, monotonic 경과의 0.1%). 이는 **새 비교 실험의 제안된 판정 기준**이며 B0 판정을 소급 변경하지 않는다. 기준 초과 시 원인을 UNKNOWN/구체 증거로 남기고 end-to-end timing comparison은 INVALID로 종료한다. heartbeat만으로 clock step·suspend·event-loop 정지를 완전히 구분할 수 없다.

전체 완료 시간의 주 지표는 **driver 한 프로세스의 monotonic t0→완료 상태 수신 관측**으로 정의한다. t0는 POST 직전이며 sourceAvailableAt은 수정하지 않는다. job hrtime에서 host t0를 직접 빼지 않는다. 이는 정확한 마지막 DB commit 시각이 아니라 controller가 완료를 알게 된 시각이다. polling·DB/Redis 순차 조회·resource 수집 지연과 3회 안정 확인 대기를 별도 보고한다. 같은 프로세스의 transaction/worker 구간도 clock gate 한계를 함께 보고한다.

clock gate를 통과하지 못하면 scheduler 의미 검증 결과만 남기고 유효 TPS·정확한 완료 시간 개선을 선언하지 않는다. 계측 보완은 원인을 자동 해결하는 제품 변경이 아니다.

## 6. 개발 순서와 완료 기준

이번에는 아래 단계를 **수행하지 않는다**. 이후 별도 구현 지시가 있을 때의 순서다.

1. 기준 고정: 기존 92216b4 보고서·원시 실패는 보존하고 새 작업 diff를 식별한다. 계약/lock/migration/source 입력 SHA를 고정한다. 기존 mixed runtime은 비교에 사용하지 않는다.
2. 전후 공통 clock observer와 driver 완료 관측/예산 manifest 인터페이스를 먼저 준비한다. schema·buffer·drop/error·logging 무영향·소형 clock gate 검증을 한다. 이 공통 계측만 들어간 baseline image와 해시를 동결한다.
3. scheduler에 interval 기본·continue-full 선택과 단일 실행 소유권·종료 합류를 구현한다. fake timer/제어 가능한 dispatch Promise로 예약 규칙을 검증한다. 기존 `dispatch()` API와 SQL 본문은 바꾸지 않는다.
4. 새 격리 자원·최대10주문 fixture에서 interval/continue-full의 canonical 업무 결과·예외·수량·분류를 대조한다. ID/허용 시각·mode/관측 metadata만 비교에서 제외한다.
5. 아래 장애 회귀 후 instrument-only baseline diff / E1 diff / 실제 image·compiled JS·host driver SHA를 분리해 검토한다. 배포나 원본 전체 실행은 별도 실행 지시 전 금지한다.
6. 별도 승인된 전후 비교에서 완결·coverage·자원·성능 gate를 확인한다. gate 실패는 그 상태로 보존하며 worker 확대나 다른 최적화로 자동 전환하지 않는다.

기능 완료 기준은 동시 dispatch≤1, pending immediate≤1, full batch 성공 뒤 interval 위상 대기를 강요하지 않음, non-full/오류는 interval cadence, close 후 새 scan 0, 진행 중 dispatch/worker를 합류한 뒤 queue close다. 미설정 mode에서는 기존 steady-state interval 동작을 유지해야 한다.

업무 완료 기준은 원본/정규화 99,441, 적격 task96,596·보류789·미지원2,056, 모든 task CREATED·미배정·미확정, 수량 독립 대사 일치, applied/event/report0, DB/Redis 미완료0·FAILED0, 3회 정상 sample·최종 독립 audit PASS다. coverage는 sequence/clean-close/ID/schema/clock/drop/error 전체 gate를 통과해야 한다.

비교 성능의 사전 목표는 **완료 100개 배치 사이 공백 p95≤50ms 및 전체 완료 수신 관측 시간 5% 이상 감소**로 제안한다. 이는 이번 자료로 입증된 효과가 아니라 다음 비교에서 검증할 수용 기준이다. event-loop/자원 제한으로 불충족할 수 있다. 의미·정합성만 통과하고 이 기준을 못 맞추면 “처리 성능 개선 검증 완료”로 선언하지 않는다. 1쌍 관측으로 통계적 일반성·운영 SLO를 확정하지 않는다.

## 7. 동일 조건 전후 실험 설계

기존 B0는 20분 drain/이전 clock observer/미완료 표본이므로 개선 후 숫자와 완결 성능 비교의 대조군으로 쓰지 않는다. 보존된 탐색 근거다. 아래는 **새 baseline(interval) 1회 + E1(continue-full) 1회의 향후 비교 설계**이며 이번 실행 허가나 실행 명령이 아니다. 자동 반복·resume은 없다.

| 조건 | 양쪽 동일하게 고정 |
|---|---|
| 누적 N·공개 | 실제 Olist 주문99,441/품목112,650/product32,951/seller3,095. 처음부터 공개된 유한 backlog. λ scheduler 없음; 수집 평균을 외부 지속 유입 λ로 쓰지 않음 |
| 입력 | CSV4 + indexed SQLite + manifest의 기존 개별6파일 SHA, indexed `ca226c4f3ae6b7c561279bf2645aedcd0371d784b4b7c5e16781119605ec7863`, WAL/SHM 부재·RO 검증 |
| 실행 경로 | 기존 source-main→API 내부 collect→worker-main. HTTP collect1·worker1/concurrency1, pool8/process, page200/master200 |
| DB/Redis | 새 독립 MySQL/Redis/volume/database/run/secrets, MySQL512MiB·flush1·sync_binlog1, Redis AOF everysec/noeviction, bull/ops-jobs |
| CPU/memory | MySQL1.5/API0.75/worker0.75/source0.5/Redis0.5 =4.0 CPU equivalents, runner0.25 추가. MySQL2GiB, 앱 각1GiB, Redis/runner 각512MiB. cpuset 없음·shares1024. 호스트 다른 서비스/IO/cache 공유를 기록 |
| 초기 상태 | 새 DB에 migration·동일 master seed만 수행, 주문/task/outbox/event/report 비어 있음. 새 Redis 빈 큐. 원 DB 복제 금지. 입력 없는60초, cold cache로 명명하지 않음 |
| 계측 | 동일 version/label/heartbeat/5초 monitor/resource 수집·buffer8192/8MiB·파일2GiB/tx후보2048. 양쪽 ON. monitor 비용도 동일하게 포함 |
| 유일한 실험 변수 | `OUTBOX_DISPATCH_MODE`: interval vs continue-full. compiled scheduling diff와 그에 필요한 종료 소유권 처리 외 업무 코드 동일 |
| 처리·관측 예산 | 공급/수집45분, EOF/DONE 인지 뒤 drain60분, t0 뒤 처리 hard limit105분. 양쪽 같은 budget. 더 긴 관측은 성능 개선으로 집계하지 않음 |
| 부대 최대시간 | readiness/migration/master seed 합계 최대20분, warm-up1분, audit5분, 종료2분. 전체 orchestration hard limit135분(반올림 여유 포함)을 새 도구가 실험 project에만 적용 |
| 최종 대사 | 처리 구간 밖 동일 hash의 원래 독립 CSV auditor·READ ONLY consistent snapshot. host audit adapter/동일 lock cache와 image provenance를 구분. source/worker 다시 기동하지 않음 |

예정 자원 경로는 새 고유 `<lab-session>/runtime-e1-interval-<timestamp>`와 `<lab-session>/runtime-e1-continue-full-<timestamp>`이며 기존 root와 같으면 거부해야 한다. 각 project/network/volume/DB/run/secret도 새 이름이다. 한 실험만 실행하고 정지한 뒤 다음 실험의 loopback13000/13100/13307/16380 충돌을 다시 확인한다. 기존 logistics-mvp 및3000/3100/3307/6380을 제어하지 않는다. 큰 metrics·DB/Redis 상태는 각 runtime의 metrics/output/scratch/volume에 보존하고 Git에는 요약/해시만 넣는다.

정확한 새 manifest/env 및 mode/예산 인터페이스는 **현재 미구현**이다. `tools/b0/lab.py`는 drain20분을 hardcode하고 새 worker mode를 전달하지 않는다. 기존 one-shot root도 재사용할 수 없다. 따라서 존재하지 않는 `--dispatch-mode`/`--drain-seconds` 명령을 완성된 실행 명령처럼 적지 않는다. 향후 도구가 manifest를 검증하고 실제 app.env/image에 일치시키는 것까지 준비한 후 실행 경로를 확정해야 한다. 원래 auditor의 image 내 Git 부재와 host 실행 adapter provenance도 같은 조건으로 해결·검토해야 한다.

측정 분모·종료:

- 주 지표: driver monotonic t0→최초 완결 snapshot 수신, 별도로 3회 안정 확인 시각. snapshot은 raw99,441/task96,596/미완료0/FAILED0/Redis잔여0/업무 위반0이고, 5초 간격3회 연속 정상 확인 후 종료한다. 독립 audit 시간·정지시간은 처리시간 분모에서 뺀다. 첫 정상 sample과 최종 stable 관측을 섞지 않는다.
- 전체 완료 처리율은 **96,596 / 검증된 완료 관측 구간**으로 계산한다. 미완료면 censored/FAIL이고 완료 TPS를 보고하지 않는다. 완료 subset rate는 그 수량/구간/미생성 분모를 명시한 보조값이다.
- 단계별 monotonic client duration, dispatch batch당 candidate/add/commit, 배치 사이 공백, worker 업무 union·다음 job 공백·겹침, backlog/drain 시계열, 최초 enqueue coverage/unknown을 동일 분석기로 계산한다. tx/SQL을 합산한 시간을 전체 wall 분모로 쓰지 않는다.
- SQL 소속이 그대로 모호하면 범위/UNKNOWN을 유지한다. 정확 pool wait·lock·commit time을 이 실험 목표로 추가하지 않는다. 일반 API p95·B1 λ 수용·OFF 오버헤드·목록/집계 혼합·단말은 미측정이다.
- HTTP 오류/timeout 분모는 발송 POST1회다. dispatcher 오류 횟수/발행 시도, worker delivery/성공 commit/신규 task/FAILED/재시도는 각각 분리한다. timeout/실패 표본을 완료 시간 통계에서 조용히 제외하지 않는다.
- process/container RSS·HWM/CPU ticks/IO·host 여유·실제 로그 크기·observer 비용·clock health를 함께 보고한다. sample peak는 하한, HWM은 수명 값이며 Docker memory는 RSS와 다르다.

안전 정책은 현재 guard를 유지한다. host MemAvailable<2GiB20초, container memory80%30초, backlog가 있는데 durable progress60초 없음 또는 공급 deadline은 공급 정지→제한 drain이다. 정합성·checkpoint/FAILED job·관측 가능한 OOM/runtime/observer I/O 오류는 실험만 즉시 중단한다. 큐 oldest age120초 단독 stop은 없다. clock/drop/coverage gate 실패 시 데이터 안전 판정과 시간 유효성을 분리해 실패 원인을 보존하고 사전 고정한 정책대로 실험만 종료한다. 공급을 중지한 표본은 이후 drain돼도 정상 baseline PASS로 승격하지 않는다.

두 run 중 하나라도 미완료·대사 실패·coverage INVALID면 그 쌍의 성능 판정은 보류/실패다. 결과를 보고 예산을 중간에 늘리거나 다음 run에만 바꾸지 않는다. 새 실험·반복·다른 최적화에는 별도 지시가 필요하다.

## 8. 정합성·장애 회귀 설계

아래는 나중의 최소 검증 목록이며 이번에 실행하지 않았다. 기존 `.env.test`/logistics_test/기존 서비스 fault script를 그대로 실행하지 않는다. 테스트 helper도 새 DB/Redis/포트/run/개별 RO 입력과 최대10개 합성 주문을 명시해야 한다. 기존 test 명칭은 의미 근거이며 실행 증거가 아니다.

| 검증 | 기대 결과 |
|---|---|
| fake timer, dispatch Promise가1초 이상 걸림 | interval/immediate 경합에도 dispatch 최대1. full 성공 뒤1개 continuation, microtask 재귀/예약 누적 없음 |
| 반환0/99/100, 예외, 후보100 중 skipped | non-full/오류는 interval, full은1개 continuation. 반환 의미는 후보 수; skip을 발행수로 세지 않음 |
| close 대기·예약 직전/직후·진행 중 | close 후 새 scan0, pending immediate 취소, inFlight 합류 뒤 worker/queue 종료. 제한 종료 실패는 그대로 보존 |
| interval vs continue-full canonical 업무 대조 | 내부 ID/허용 시각 외 분류·품목·수량·task 수·예외 동일. task CREATED·미배정·미확정/event0 |
| rollback 및 commit outcome unknown | durable 후보 성공으로 세지 않음. 업무 retry/오류 의미 동일 |
| 중복 delivery·DONE·과거 revision·기존 task | 신규 task 증가0, UNIQUE/row lock/기존 noop 의미 유지 |
| Redis get/add 실패, add 뒤 DB rollback/crash | 기존 PENDING/lease 복구·중복 무효화. 새 scheduler가 attempts/FAILED를 직접 조작하지 않음 |
| expired DISPATCHED + Redis delivery 부재 | 원래 lease 복구로 재발행, 최종 task1. 전용 실험에서도 flush/down-v/DROP/TRUNCATE 없이 fixture 상태로 구성 |
| worker commit 전/후 crash 및 ACK 경계 | commit 전 업무 rollback, commit 후 재전달에도 신규 task0. commit 성공 전 ACK 금지. 실제 단말/SQLite/장비 event 장애 주입 제외 |
| sink 실패·buffer 포화·clock probe 오류 | 업무 반환/예외/DONE/attempt/ACK 불변, coverage INVALID/UNKNOWN 표시. 실패를 숨기지 않음 |
| 설정·artifact 정합성 | lock·migrations·OpenAPI·공용 계약 해시 불변, 두 image의 instrumentation 동일·scheduler diff만 분리 |

참고할 기존 회귀 의미는 `tests/integration/redis.test.ts`의 lease 복구/중복, `tests/integration/crash.test.ts`의 DB/worker commit 경계, `tests/b0/observability.test.ts`의 rollback/sink 의미다. 원래 파일 전체 실행에는 단말/기존 환경 대상이 섞이므로 이번 범위의 새 전용 fixture로 필요한 사례만 옮겨 검토해야 한다.

## 9. MVP 보존·rollback·납품 경계

기존 main/실제 run/단말/원본·기존 E1 조사·준비·B0 실패 보고서/ready 경로는 수정하거나 재배포하지 않는다. 제품 기본은 interval이다. 새 실험에서만 continue-full을 선택한다. 구현할 때도 별도 작업 경로/실험 자원으로 검증하며 main 병합·태그 이동·기존 서비스 제어를 동반하지 않는다.

rollback은 새 실행을 중단하고 **다음 새 실험에서** 기존 고정 image + interval mode를 쓰는 것이다. schema가 같아 migration rollback은 없다. 운영 반영은 이 설계의 범위가 아니다. 이미 실행 중인 run에서 mode를 실시간 전환하거나 실패한 B0를 resume하지 않는다. 실험 종료 시 volume/DB/Redis/log를 보존하고 down-v/flush/삭제로 초기화하지 않는다.

이번 납품은 analysis/design 문서와 작은 파생 근거뿐이다. code/config/lock/migration 변경 0, 서비스·DB 접속·재실행0이다. 성능 효과·완결 baseline·시계 이상 원인은 아직 확정하지 않았다. 기존 FAIL/INVALID는 유지한다.
