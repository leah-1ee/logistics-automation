# E1 B0 기준 측정 준비 명세와 로컬 Codex 지시

작성일: 2026-11-03 Asia/Seoul  
기준 코드: `954bb692a244803b8aad695539d81afdcb81a091`  
단계: 조사 결과 검토 → B0 계측·격리 도구 준비. 첫 E1 성능 개선 기능은 미선정.

## 1. 조사 결과의 수용 범위

제공된 `discovery.md`, `baseline-measurement-plan.md`, 조사 전후 Git 변경 목록을 읽었습니다. 이 문서에서 로컬 관측은 제공된 조사 보고서의 결과이며, 이 채팅에서 WSL·Docker·DB·Pi에 직접 접근한 결과가 아닙니다.

로컬 HEAD는 `0a4c6ee1bda3dd7103525868aa15eec54d573ace`입니다. 기준 SHA보다 README 변경 2커밋 뒤이고, 제품 코드·계약·lockfile·migration tree는 같습니다. 현재 서비스의 이미지·run·buffer pool 설정은 섞여 있으므로 그 환경을 그대로 단일 SHA의 baseline이라고 쓰지 않습니다.

첫 측정 경로를 다음으로 고정합니다.

`실제 원본 → source HTTP → API 내부 collect → MySQL 원본/정규화/Outbox 커밋 → dispatcher → worker1/concurrency1 → 작업 생성 커밋`

첫 준비 대상은 B0 한 개입니다. 원본 99,441건을 처음부터 공개한 유한 backlog를 처리하는 실험입니다. B1의 일정 공개율, B2의 목록 조회 부하, B3의 집계 혼합·다중 워커, 단말 동기화, 장애 주입과 100만 파생 데이터는 이번 준비 범위에서 제외합니다. 이 선택은 E1 전체 범위의 확정이 아닙니다.

## 2. 기존 측정 계획에서 수정할 내용

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| prefix 전용 launcher | 전용 Redis에서 기존 `bull` prefix·`ops-jobs`를 유지 | 다른 Redis 서버라 큐 공간이 이미 분리됨. prefix 변경만을 위해 새 worker 진입점을 만들 필요 없음 |
| source launcher·공개 스케줄 | B0는 기존 source-main·seed를 유지 | 기본 시계에서 원본 전체가 공개돼 있음. B1용 스케줄 adapter·부분 원본 oracle는 B0의 선행 조건이 아님 |
| MySQL buffer pool | B0는 512MiB 고정 | 프로젝트 Compose 기본값·기존 실제 데이터 재생 기록과 연결. 현재 혼합 실행 환경의 128MiB는 별도 관측값. 128/512 비교는 필요할 때 별도 실험 |
| CPU 상한 | 서비스별 quota·cpuset/shares 정책을 실제 설정에 명시 | 서비스마다 `cpus=4`를 주고 실험 전체 4코어라고 쓰면 안 됨. 같은 호스트의 기존 서비스와 CPU·IO·파일 cache를 공유하는 한계도 기록 |
| 큐 나이 120초 중지 | B0의 단독 중지 조건에서 제외하고 관측값으로 보존 | 처음부터 99,441건이 공개된 backlog에서는 대기가 실험 대상. 큐가 오래됐다는 사실만으로 자원 위험이나 정체가 입증되지 않음 |
| t0 | driver가 수집 시작 POST를 보내기 직전에 기록 | API가 응답하기 전에 collect가 시작될 수 있음. HTTP 수락 응답 시각만 기준으로 삼으면 초기 작업을 빠뜨릴 수 있음 |
| 공개→task 지연 | B0는 t0→task 커밋 성공 관측으로 정의 | 과거 anchor의 `sourceAvailableAt`을 빼면 며칠 전 공개 대기까지 포함됨. B0의 실험 기준 공개 시각과 원본 payload 시각을 구분하고 payload는 수정하지 않음 |
| cold-start 명칭 | “주문 업무 테이블이 빈 상태에서 시작”으로 표현 | master seed와 OS 파일 cache가 이미 존재함. 60초 idle만으로 cold cache나 warm steady state를 보장하지 못함 |
| 정확한 pool wait·행 잠금 시간 | 확보 가능한 관측만 수집. 안 되면 UNKNOWN | DB client 총 시간은 pool 대기·네트워크·SQL 실행 등을 포함할 수 있음. lock snapshot은 전 구간 잠금 시간의 대체값이 아님 |
| post-commit sidecar | DB 업무 기준과 독립된 관측 기록으로 취급 | 커밋 성공 직후 프로세스가 죽으면 로그가 없을 수 있음. 로그 누락을 업무 누락으로 세거나 로그를 완전한 커밋 이력으로 쓰면 안 됨 |

기존 상세 QR 보고서와 README의 차이는 그대로 근거 종류별로 남깁니다. 사용자 완료 확인을 취소하거나 자동 장비 시험 로그로 바꾸지 않습니다. 이번 단계에서 태그·MVP 상세 판정·장비 상태를 수정하지 않습니다.

## 3. B0의 최소 계측

### 3.1 반드시 필요한 것

| 경로 | 관측 내용 | 해석 제한 |
| --- | --- | --- |
| source fetch | 시작/본문 수신·검증 완료 시각, 페이지 항목 수·오류 | 요청 수와 주문 수 분리. HTTP1, page200 유지 |
| 수집 status | `ingestionStatus` 전체 시간과 query count | 관측 목적으로 status API를 고빈도로 추가 호출하지 않음 |
| 페이지 저장 | transaction 호출→성공 resolve 시간, 신규 raw/order/outbox 식별자·분류 수, rollback/실패 | 성공 resolve 뒤에만 durable 관측으로 승격. 같은 페이지 재수집으로 신규 수를 늘리지 않음 |
| SQL | 고정 역할 label별 count·client elapsed 분포 | query text·바인드값·payload 출력 없음. master/status/raw 조회/쓰기 등을 구분하고 모니터링 SQL은 별도 |
| dispatcher | 후보 선택 시간·수, DB transaction 시간, Redis get/state/add 왕복, 발행 성공 관측 | 큐 add와 DB DISPATCHED 커밋을 구분. 완료 task 수로 사용하지 않음 |
| worker | 시작/성공 transaction resolve, outbox/job/task/order 연결, 신규 task인지 중복/무변경인지 | job delivery·시도·DONE·신규 task를 서로 구분. 실제 DB 커밋 시각이 아니라 성공을 관측한 시각 |
| 자원 | API/worker/source 프로세스별 RSS·CPU, DB/Redis·컨테이너·호스트 지표 | API 내 collect의 RSS를 API와 분리한 것처럼 쓰지 않음. peak의 관측 범위·표본 간격·process 수명 명시 |
| 대기열 | DB outbox 상태·BullMQ waiting/active/delayed, 미완료 최초 enqueue 관측 나이 | Redis completed 수는 자동 제거되므로 누적 처리량의 근거로 사용하지 않음. 재시도로 변하는 available_at은 최초 생성 시각 아님 |
| 종료 | source EOF, checkpoint DONE, durable task 수, 미완료·FAILED·Redis 잔여, drain 확인 시각 | source EOF만으로 완료 판정하지 않음. audit 시간은 처리 시간과 따로 기록 |

수집·task 고유 계수는 계측 결과와 최종 DB 대사로 교차 확인합니다. 이벤트·receipt는 B0에서 생성하지 않으므로 event ACK 유실 0을 새로 시험했다는 판정을 만들지 않습니다. B0의 기대 상태는 작업 CREATED, 미배정·미확정, device event 0·완료 집계 없음입니다.

새 제품 DB 열·테이블·API·job payload를 추가하지 않습니다. 계측 기능은 기본 꺼짐으로 두고 기존 함수의 반환·예외·transaction·checkpoint·재시도 의미를 보존합니다. 필요한 hook은 공통 DB wrapper와 선택된 경로에 최소한으로 둡니다. 설치된 라이브러리에서 검증되지 않은 private pool API를 가정하지 않습니다.

계측 형식은 version, experimentId, service, process identity, sequence, UTC wall time, monotonic time, event kind, 고정 label, 필요한 내부 ID·count·duration을 가집니다. 원본 payload·SQL 값·토큰을 기록하지 않습니다. 파일 크기·메모리 buffer에 상한을 둡니다. sink 오류·포화는 누락 수와 상태로 드러나야 합니다.

### 3.2 지표를 거짓으로 만들지 않는 규칙

- transaction 안에서 만든 후보 관측은 rollback 때 버립니다. commit promise의 성공을 관측한 뒤 성공 기록을 만듭니다. 일반 예외와 커밋 결과가 불확실한 연결 오류는 구분해 가능한 범위만 기록합니다.
- sink 실패가 `processJob`의 업무 catch로 흘러가 이미 커밋된 job을 실패·재시도로 기록하게 하면 안 됩니다. 계측 호출은 예외를 업무 경로로 전파하지 않고, 계측 무결성 실패를 별도 상태로 남깁니다.
- bounded buffer가 넘치면 제품 동작을 막거나 무제한 메모리를 쓰지 않습니다. 누락을 표시하고 해당 세부 지연/계수 결과를 INVALID 또는 UNKNOWN으로 판정합니다. DB correctness는 별도로 남깁니다.
- sidecar 기록과 DB는 원자적이지 않습니다. 커밋 뒤 crash·로그 flush 실패 시 누락이 생길 수 있습니다. 후속 DB 조회로 복원한 행에는 복원 사실을 표시하고 원래 커밋 시각을 만들어 넣지 않습니다.
- “DB 커밋 성공 관측 시각”은 엔진의 정확한 commit timestamp가 아닙니다. 프로세스 간 관측 순서와 실제 commit 순서는 다를 수 있습니다. 관측 지연 때문에 음수가 된 구간을 0으로 보정해 숨기지 않습니다.
- 같은 프로세스 내 경과 시간은 monotonic clock으로 잽니다. 프로세스 간 구간은 공통 호스트 시계 기준·정밀도·clock step을 확인하고 관측 오차를 표시합니다.
- raw→task 지연이 정확히 확보되지 않으면 해당 값만 UNKNOWN으로 둡니다. t0→task 관측, 단계별 transaction/SQL 시간·자원·최종 처리량으로도 B0를 시작할 수 있습니다.
- 최초 enqueue 관측이 없는 job의 나이를 available_at으로 대체하지 않습니다. 미확인 최초 시각의 job 수와 oldest age의 coverage를 함께 보고합니다.
- 개별 task가 조회되는지 96,596회 poll하지 않습니다. B0는 commit 성공 관측과 측정 종료 후 DB 확인을 기본으로 합니다. 조회 가능 시각의 별도 검증은 필요할 때 표본·주기를 따로 고정합니다.

### 3.3 이번 준비에서 제외하는 계측

목록 API p95 driver, 일정 λ source scheduler, partial CSV oracle, 전체 tracing 대시보드, 새 observability 서버, pool 내부 hook을 위한 dependency 교체, cache, 새 queue, 다중 worker 설정은 만들지 않습니다. B0의 기존 source HTTP·페이지 저장·job 실행 시간 분포를 먼저 확보합니다. B0 한 번의 수집 시작 POST로 일반 API p95를 계산하지 않습니다.

## 4. 실행 환경과 실험 단계

기준 코드를 전용 작업 경로에서 준비합니다. 기존 main과 실행 중 컨테이너는 그대로 둡니다. 새 API/worker/source와 대사 CLI는 같은 source·lockfile·계약에서 만들어 실제 실행 파일·image content ID를 검증합니다. 오래된 mixed image를 mutable tag만 바꿔 재사용하지 않습니다.

기존 원본 CSV와 `olist-indexed.sqlite`만 읽기 전용으로 이용합니다. SQLite의 현재 WAL·SHM 유무와 읽기 경로를 확인하고 불완전한 본체 복사를 사용하지 않습니다. 준비본의 기준 SHA는 조사 보고서의 `ca226c4f3ae6b7c561279bf2645aedcd0371d784b4b7c5e16781119605ec7863`입니다. 실행 때 다시 확인합니다.

실험마다 새 MySQL/Redis 서버·volume·network·run을 사용합니다. 기존 DB와 같은 서버에 새 schema만 만드는 것은 별도 서버 격리의 대체가 아닙니다. source 전체 디렉터리·기존 `.env`·live DB·단말 SQLite를 쓰기 가능하게 mount하지 않습니다. 필요한 출력만 새 경로에 둡니다.

자원 정책은 MySQL buffer pool512MiB·내구성 flush1/sync_binlog1, Redis AOF everysec/noeviction, worker1/concurrency1, page200/master200, DB pool8/제품 프로세스, 기존 dispatcher1초/LIMIT100을 고정합니다. Redis maxmemory=0을 선택하면 이는 Redis 자체 메모리 상한이 없다는 뜻이며 컨테이너 한도와 외부 중지 기준을 함께 기록합니다.

메모리 상한은 기존 계획의 MySQL2GiB/API·worker·source 각각1GiB/Redis512MiB를 출발 제안으로 유지하되 현재 여유를 확인합니다. CPU는 서비스별 실제 quota를 명시한 단일 설정을 준비하고 합계의 의미를 검증합니다. 같은 호스트의 기존 서비스가 만드는 CPU·IO 간섭은 남습니다. 백그라운드 상태를 기록하고 호스트 자원을 완전히 격리했다고 쓰지 않습니다.

### 준비 검증과 전체 원본 측정의 분리

| 단계 | 이번 로컬 지시 범위 | 결과 |
| --- | --- | --- |
| 격리 설정·수집 도구·계측 구현 | 포함 | 검토 가능한 diff·도구 사용법·측정 출력 schema |
| 의미 검증 | 포함 | 새 격리 자원에서 고정 소형 fixture로 ON/OFF 결과·rollback·sink 실패 검증 |
| 소형 실제 실행 smoke | 포함 | 최대 10개 합성 주문, 정확히 예상한 task/수량, 단말·장애 부하 없음 |
| 계측 오버헤드 정량 pilot | 준비만 | 비교 workload·초기 상태·반복을 계획. 짧은 smoke 시간으로 오버헤드율을 결론내리지 않음 |
| 실제 99,441건 B0 | 이번에는 실행하지 않음 | 준비 결과 검토 후 별도 실행 지시. 먼저 pilot 1회, 필요에 따라 같은 조건의 반복 결정 |
| B1~B3·제품 최적화 | 제외 | B0 결과가 나온 뒤 선택 |

전체 baseline을 처음부터 3회 돌리지 않습니다. 첫 pilot에서 계측 coverage·완료 시간·자원·stop 동작을 확인하고, 유효하면 사전 고정한 조건으로 반복합니다. pilot과 최종 비교 표본은 구분합니다.

B0 자원/정합성 중지 후보는 기존 계획을 따르되 큐 age 단독 중지·자동 연쇄 강제종료는 제거합니다. 위험에 따라 공급 정지, 제한 drain, 즉시 중단을 구분합니다. 원본·잘못된 대상 쓰기·정합성 위반·OOM/IO 오류는 즉시 중단 대상으로 둡니다. host MemAvailable<2GiB 20초, container memory 한도80% 30초, backlog가 있는데 durable progress 60초 없음은 최초 제안이며 실행 전에 측정 방법과 행동을 고정합니다. 작업별 lease·15초 source timeout과 제한 drain 시간을 종료 정책에 연결합니다.

EOF 뒤 DB 미완료/FAILED와 Redis 잔여를 확인합니다. 5초 간격 3회 연속 정상 확인은 최대 약15초의 판정 대기를 포함하므로 drain 원시 시각과 안정 확인 시각을 구분합니다. 최종 audit는 그 뒤 실행합니다. 중지/실패 표본을 복구 성공으로 덮어쓰지 않습니다.

## 5. 로컬 Codex에 보낼 다음 프롬프트

아래 지시는 로컬에서 사용자가 전달할 다음 작업 범위입니다. 이 문서 작성 과정에서는 코드 변경·환경 기동·DB 쓰기·시험을 실행하지 않았습니다.

```text
물류 운영 자동화의 B0 기준 측정을 위한 최소 계측·격리 실행 도구를 준비해 주세요.
이번 목표는 준비 도구 구현과 의미 검증입니다. 실제 Olist99,441건 B0는 실행하지 마세요.
첨부한 E1_B0_Preparation_Spec.md를 이번 작업의 범위·판정 기준으로 사용하세요.

기존 저장소: /home/leah/logistics-automation
기준 SHA: 954bb692a244803b8aad695539d81afdcb81a091
기존 조사: reports/e1-discovery-20261103T094149+0900/
로컬 HEAD는 0a4c6ee1bda3dd7103525868aa15eec54d573ace였고
공개 기준보다 README2커밋 뒤, 제품 코드·계약·lock·migration은 같았습니다.
작업 시작 때 현재 상태를 다시 확인하고, 기존 수정·조사 출력·ignored 자산을 보존하세요.
적용 가능한 AGENTS.md가 있으면 먼저 읽으세요.

1. 기준 코드와 작업 공간
- 기존 main을 checkout/reset/pull/stash하지 마세요.
- 기준 SHA에서 새 브랜치·별도 worktree를 만들어 작업하세요.
  /home/leah/e1-lab/ 아래 새 고유 경로를 쓰고 기존 경로는 재사용하지 마세요.
- public SHA의 baseline + instrument-only diff + 실제 실행 artifact 해시를 구분하세요.
- existing runtime의 API/worker/source는 서로 다른 이미지/run을 쓰므로 그대로 측정하지 마세요.
- 기존 소스·lock과 일치하는 dependencies/cache만 사용하세요. 전역 설치·dependency
  업그레이드·큰 다운로드는 하지 마세요. 자산이 없으면 필요한 항목을 차단 사유로 기록하세요.

2. B0 한 개를 위한 격리 설정
- 새 Compose project/network/MySQL/Redis/volume/DB/run/비밀 설정/출력 경로를 만드세요.
- API/source/MySQL/Redis는 loopback13000/13100/13307/16380 후보이며 시작 전 충돌 확인.
  기존 project/logistics-mvp/network/volume/3000/3100/3307/6380은 사용·제어하지 마세요.
- 소스 원본 CSV와 준비 indexed SQLite만 개별 read-only 입력으로 사용하세요.
  기존 전체 data·var·.env를 쓰기 가능 mount하거나 원DB를 복제하지 마세요.
- 전용 Redis의 기존 prefix=bull/queue=ops-jobs를 유지하세요.
  prefix용 launcher·source 공개 스케줄 adapter·부분 데이터 oracle는 만들지 마세요.
- 제품 경로는 기존 source-main/API 내부 collect/worker-main을 유지하세요.
- MySQL buffer512MiB·flush1/sync_binlog1, Redis AOF everysec/noeviction,
  worker1/concurrency1, page200/master200/pool8/process/기존 dispatcher를 고정하세요.
- CPU quota를 서비스별로 명시하고 합계의 뜻을 검증하세요.
  같은 호스트의 기존 서비스·IO/cache 간섭은 환경 한계에 기록하세요.
- 기존 원본99,441건 seed·수집은 이번에 실행하지 마세요.

3. 최소 계측
- source fetch/validation, ingestionStatus, ingestPage transaction,
  label별 SQL count/client duration, dispatch scan/DB/Redis,
  job 처리/신규 task 커밋 성공 관측과 process/container 자원을 구현하세요.
- 고정 label만 사용하고 SQL 본문/바인드/payload/token은 출력하지 마세요.
- 기본 OFF, bounded buffer·async sink·drop/error 카운터, timestamp/ID/sequence/version을 두세요.
- transaction 후보 기록은 rollback 때 버리고 성공 resolve 뒤에만 durable 관측으로 남기세요.
- post-commit logging 오류가 업무 catch·FAILED·재시도·ACK·반환값에 영향을 주면 안 됩니다.
  sidecar는 DB와 원자적이지 않습니다. crash/누락은 coverage 실패로 표시하세요.
- 엔진의 정확 commit timestamp라고 쓰지 말고 commit 성공 관측이라고 명명하세요.
- pool private API를 추정해 patch하지 마세요. 확보 못한 pool wait/잠금 시간은 UNKNOWN입니다.
- B0 t0는 driver가 수집 시작 POST를 보내기 직전입니다.
  과거 sourceAvailableAt을 B0 t0 대신 쓰거나 payload를 변경하지 마세요.
- 제품 DB/API/계약/job payload/재시도·순서·분류·transaction·ACK 규칙은 바꾸지 마세요.
- 신규 캐시·배치 최적화·큐 분리·증분 집계·워커 확대·대시보드는 구현하지 마세요.

4. 의미 검증과 소형 smoke만 실행
- 새 자원에만 migration을 적용하고 고정 소형 합성 fixture로 최대10주문을 처리하세요.
  기대 분류/수량/task 수를 미리 고정하고 실제 Olist 처리로 표현하지 마세요.
- 관측 ON/OFF에서 ID/시각처럼 허용한 차이를 제외한 업무 결과·예외·분류·수량이
  같은지 확인하세요. task CREATED·미배정·미확정, 완료 event0을 확인하세요.
- rollback을 durable 성공으로 세지 않는지, 중복/무변경 job을 신규 task로 세지 않는지,
  sink 실패·buffer 포화가 업무 성공을 실패/재시도로 바꾸지 않는지 검사하세요.
- 기존 제품 코드를 건드린 경로에 필요한 최소 회귀만 새 자원에서 수행하세요.
  기존 .env.test/logistics_test를 쓰는 명령·기존 서비스 fault script를 그대로 실행하지 마세요.
- smoke 경과시간으로 성능 개선·계측 오버헤드율을 선언하지 마세요.
- 큐 oldest-age120초만으로 B0를 중지하지 않게 하세요. 자원/정체/정합성 stop과
  공급 정지→제한 drain→종료 정책을 구분해 검증 가능한 동작으로 만드세요.
- service stop은 실험 project만, 상태·volume·실패 증거는 보존하세요.
  down -v/flush/DROP/TRUNCATE로 정리하지 마세요.

5. 결과·Git·종료점
- 도구 설명, instrument-only diff, 관측 schema/예시, 격리 검사 결과,
  소형 검증의 실제 실행 결과·실패 기록, runtime/입력/lock/계약 해시를 남기세요.
- 기존 조사 파일은 수정하지 말고 새 reports/e1-b0-preparation-<timestamp>/에 저장하세요.
- 전체 B0 실행 명령은 대상 자원/환경·동작 확인·원본SHA·중지·drain·최종 audit와
  출력이 준비된 실제 인터페이스로 작성하되 이번에 실행하지 마세요.
- 변경은 의미 있는 단위로 commit하고 같은 origin의 새 브랜치에 push하세요.
  main 병합·태그 생성·기존 서비스 재배포는 하지 마세요.
  조사 산출물은 선택해서 추가하고 git add -A로 기존 untracked를 섞지 마세요.
  secrets/원본/volume/임시SQLite/큰 raw metrics는 Git에서 제외하세요.
- 원격 인증 등이 없으면 로그인·권한을 임의 설정하지 말고 구체 차단 사유를 알려 주세요.

최종 응답은 브랜치·commit·push 결과, 검증 결과, 계측 coverage/UNKNOWN,
실제 Olist B0 실행 준비 여부와 명령/결과 문서 경로만 간결히 적으세요.
여기서 종료하고 실제99,441건 pilot이나 반복 측정·제품 최적화를 시작하지 마세요.
```

## 6. 이 단계의 완료 기준

1. 혼합 runtime 대신 기준 SHA의 코드와 계측 diff로 만든 실행물이 식별됩니다.
2. 전용 자원과 읽기 전용 원본 경로가 검토 가능하고 기존 서비스를 건드리지 않습니다.
3. 계측 ON/OFF·rollback·중복·sink 실패의 의미 검증이 통과합니다.
4. 최대10건 소형 합성 경로가 예상 결과와 일치하고, 출력이 정해진 schema로 남습니다.
5. 계측 누락·미확보 지표와 한계가 보고됩니다. 아직 못 잰 값을 0이나 성공으로 채우지 않습니다.
6. 전체 B0 pilot을 실행할 구체 명령·조건·중지·대사·보존 경로가 준비되거나 남은 차단 사유가 명확합니다.

이후 실제 B0 결과를 보고 E1-01·02·03·11 등에서 첫 구현 범위를 선택합니다. 이번 결과만으로 서버 병목이나 성능 개선 완료를 선언하지 않습니다.
