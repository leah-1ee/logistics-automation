# B0 계측·격리 준비 결과

2026-11-03 Asia/Seoul. **준비 검증 PASS / 실제 Olist B0 NOT_RUN**.

기준 SHA는 `954bb692a244803b8aad695539d81afdcb81a091`이다. 사용자 제공 명세 [E1_B0_Preparation_Spec.md](../../docs/E1_B0_Preparation_Spec.md)를 적용했다. 실제 첨부 위치는 원 저장소의 `docs/E1_B0_Preparation_Spec.md`였으며 원 파일은 보존했다. 기존 main·기존 E1 조사 보고서·원본·기존 서비스는 수정/재배포하지 않았다. 처음 명세를 찾지 못했을 때 만든 이 작업의 전용 worktree에서 이어서 수행했다.

## 결과와 증거

| 검증 | 실제 결과 | 근거 |
|---|---|---|
| 계측 단위·업무 wrapper 의미 | 3 tests PASS: 성공 resolve만 관측, 원래 반환값/예외 identity·connection API/SQL 인자 보존, OFF 비출력, async sink 오류·포화 | [단위 결과](observability-unit-final.txt) |
| 중지·종료 정책 | 6 tests PASS: 오래된 큐만으로 중지하지 않음, memory/stall 공급 정지, integrity/OOM/IO 즉시 중단 결정, 공급 정지 1회→제한 drain, EOF/업무 완료 후 3개 정상 sample | [정책 결과](policy-tests.txt), [정책 코드](../../tests/b0/test_policy.py) |
| 실제 격리 합성 ON/OFF | 원본 ID 4개, task2·필요수량4, DATA_HOLD1·UNSUPPORTED1. canonical 업무 결과·수량·분류·migration/DB 설정 동일 | [ON/OFF 대조](on-off-equivalence.json), [ON 실행 결과](smoke-on-result.json), [OFF 재검증](smoke-off-review.json) |
| 실제 DB 의미 회귀 | rollback durable 기록0, 기존 task/과거 revision/DONE 재전달은 신규 task0, sink 실패·포화 뒤 job DONE/attempt1/errorNULL 유지, DONE 페이지 재수집 false | [의미 검증 5사례](semantics-final.json) |
| 일반 sidecar | schema 206 records PASS, sequence/clean-close/drop/error 및 최종 raw/task/outbox ID 대조 VALID | [schema 검사](observation-schema-check-final.json), [coverage](coverage-final.json) |
| 실제 격리·자원 | 별도 project/network/volume, 각 입력 RO, 실제 quota/memory/shares 확인, buffer512MiB/flush1/sync_binlog1, Redis AOF everysec/noeviction | [runtime 검사](runtime-isolation-final.json), [Redis](redis-runtime-final.json), [업무·DB 설정](on-off-equivalence.json) |
| dependencies·실행물 | offline build, 기존 설치 metadata162개 일치·필수 누락0(다른 플랫폼 optional55개 제외), Node24.22.1. 앱 3개와 Node CLI는 같은 image content ID | [의존성](image-dependencies.json), [build](build-final.txt), [실행 파일 SHA](runtime-artifact-hashes.json) |
| 실제 Olist | **기동·seed·수집·pilot·반복 모두 미실행**. 새 경로에 설정만 생성하고 원본/준비본/이미지 파일 해시를 확인 | [준비 상태](b0-readiness.json), [검토용 Compose](b0-compose.json), [manifest](b0-ready-manifest.json) |

합성 fixture의 source ID1은 상품a2+b1로 적격(작업수량3), ID2는 b1로 적격(1), ID3은 상품행 없음으로 보류, ID4는 canceled/상품a1로 미지원이다. B0 smoke의 모든 task는 **CREATED·미배정·미확정**, event0·보고서0·applied_qty0이다. 내부 UUID/run/experiment/시각·manifest preparedAt 차이만 ON/OFF 비교에서 제외했다. 원본 Olist 처리 결과로 표현하지 않는다. 각 fixture는 4주문으로 최대10 제한 안에서 실행했다. 수정 검증을 위해 여러 새 sandbox를 사용했으며 성능 표본이나 반복 측정으로 사용하지 않았다.

의도적인 sink 오류·포화 회귀는 일반 smoke 완료 후 worker가 정지된 별도 runner에서 실행했다. 이 runner의 sidecar는 예상대로 INVALID(drop22, sink errors 발생)이다. 해당 손실을 정상 coverage에 합치거나 숨기지 않았고, 업무 task는2개 그대로였다. 회귀용 outbox와 rollback용 synthetic run 메타데이터도 남겼다. 일반 smoke의 DB snapshot/sidecar는 회귀 전에 고정했다.

## baseline·diff·실행물 구분

- 제품 baseline: 위 공개 SHA. 원래 main HEAD `0a4c6ee1bda3dd7103525868aa15eec54d573ace`는 README2커밋 뒤인 상태 그대로다.
- instrument-only 변경: [instrument-only.diff](instrument-only.diff). 원본 분류·source payload/시계·계약·lock·migration·event ACK 코드는 바꾸지 않았다. API·source·worker 진입점과 `bull/ops-jobs`, concurrency1/pool8/page200/master200/dispatcher1초·LIMIT100·순차발행을 유지했다.
- 실행물: [runtime-artifact-hashes.json](runtime-artifact-hashes.json)의 실제 container image ID와 src/compiled JS SHA. Git가 없는 이미지 안 도구의 codeCommit 값만으로 식별하지 않는다. [b0-ready-manifest.json](b0-ready-manifest.json)은 별도 host Python driver SHA와 입력 SHA도 고정한다.
- host driver와 이미지에 보관된 도구 파일은 별도 provenance다. Python driver는 host에서 실행하며, 서비스와 Node CLI는 고정 이미지의 compiled JS를 실행한다. 시작 전에 host source/driver 변경과 이미지 source·계약·lock·migration·dependency metadata 불일치를 거부한다. 이미지 안의 보관용 Python 파일을 실행하지 않는다.

## 계측과 해석

구현은 [b0.ts](../../src/observability/b0.ts), 공통 [DB wrapper](../../src/server/db.ts), 수집·task·dispatcher 경로에 있다. `B0_OBSERVE=1`일 때만 기록하며 기본 OFF다. B0 설정은 service별 `/observations`에 기록한다. 고정 label enum과 allowlist 필드만 출력하며 SQL 본문·바인드·payload·token·오류 message/stack을 기록하지 않는다.

형식은 [JSON schema](../../tools/b0/observation.schema.json), [실제 합성 예시](observation-examples.json)를 본다. version/experiment/service/process identity/sequence/UTC wall/monotonic ns, 필요한 내부 ID/count/duration을 갖는다. span/SQL에는 시작 시각도 있다. monotonic duration과 **DB 커밋 성공 관측 시각**을 기록하며 엔진의 정확 commit timestamp라고 부르지 않는다.

transaction 후보는 최대2,048개다. rollback/실패 때 버리고 promise 성공 뒤에만 raw/task/outbox/dispatch 후보를 내보낸다. callback 완료 후 commit 오류는 `commit_outcome_unknown`으로 구분한다. SQL 기록은 성공·실패한 **시도**이므로 rollback 때 사라지지 않는다. post-commit emit/sink 실패는 업무 catch로 전파하지 않는다.

기본 queue는8,192 records/serialized8MiB이며 async flush250ms, 후보와 한 번에 flush 중인 batch·직렬화 임시 메모리는 별도 유한 공간이다. B0 설정의 파일 상한은 process당512MiB(일반 기본256MiB)이다. queue/파일 상한·sink 오류는 drop/error/candidateDrops와 health/sequence/DB ID 대조로 coverage INVALID가 된다. JSON byte 한도는 Node heap/RSS 상한이 아니다. async sink는 DB와 원자적이지 않으므로 crash/누락에서 원래 성공 시각을 복원하지 않는다.

`outbox_write_resolved`는 ON DUPLICATE KEY 문장의 성공 관측 후보이며 단독으로 신규 outbox라고 세지 않는다. 실제 최종 DB에 존재하는 ID로 교차 확인해 최초 enqueue coverage/나이를 계산한다. 미확인 최초 시각을 `available_at`으로 대신하지 않는다. worker delivery·job DONE·task_noop·task_created도 분리했다.

source headers/body/validation, ingestionStatus, 페이지 transaction, 고정 SQL label client duration, dispatch scan/DB/Redis get/state/add, job 처리/신규 task를 관측한다. SQL의 client elapsed는 pool·네트워크·서버 시간 등이 섞인 값이다. [coverage](coverage-final.json)의 lifetime 수치에는 readiness/idle/drain이 포함된다. `processingWindowSqlCounts`는 t0부터 마지막 raw/task/EOF 관측까지 SQL 완료 관측으로 별도 계산하며, raw timestamp로 다른 구간도 분리할 수 있다. histogram은 고정 bucket의 client elapsed 분포이며 일반 API p95가 아니다.

B0 t0는 driver가 수집 시작 POST를 보내기 직전의 wall/monotonic 시각이다. 과거 sourceAvailableAt은 바꾸거나 t0로 사용하지 않는다. `t0ToTaskCommitSuccessObservedSeconds`는 그 t0→task 성공 관측이다. host/container clock 시작 bracket을 [기록](clock-final.json)했고 음수/clock 간격 이상을 숨기지 않는다. **raw→task 정확 지연·정확 pool wait·전 구간 lock 시간은 UNKNOWN**이다. lock snapshot 권한이 없으면 UNKNOWN이다. startup clock sample이 전 실행의 정확한 동기화 보장은 아니다.

process PID1 RSS/HWM·CPU ticks, container CPU/memory/IO, host 메모리/디스크, DB 상태·queue depth/oldest enqueue age를 수집한다. Docker MemUsage를 RSS로 바꾸어 쓰지 않는다. HWM은 process 수명 값이고 sample peak는 하한이다. API 내부 collect RSS를 별도 수집 프로세스처럼 분리하지 않았다. Node observer는5초 주기로 DB를 조회한다. Docker 자원 수집 비용 때문에 controller 판정은5초보다 늦을 수 있으며 raw sample 시각과 stable 확인 시각을 따로 남긴다. 관측 SQL/runner의 비용도 추가되며 오버헤드율은 측정하지 않았다.

## 격리 자원과 실행 인터페이스

host 도구는 [tools/b0/lab.py](../../tools/b0/lab.py)다. `init`은 새 경로만 허용하며 `smoke`, `check`, `verify`, `semantics`, 명시적인 `run-b0 --execute-full-b0`를 제공한다. 기존 full data/var/.env를 mount하지 않는다. CSV4개·indexed SQLite·manifest6파일만 개별 RO mount한다. indexed SHA와 WAL/SHM 부재를 재확인한다. writable bind는 새 실험 root만 허용한다. 환경파일0600·새 토큰/계정/run/DB·새 project/volume/network를 사용하고 secret 값은 결과 bundle에 넣지 않는다.

MySQL1.5, API0.75, worker0.75, source0.5, Redis0.5 CPU quota의 합계는 **4.0 CPU equivalents**다. runner는 실행 중0.25를 더한다. cpuset 고정 없이 shares1024를 사용하므로 실험 전용 물리4코어나 호스트 전체4코어 제한을 의미하지 않는다. 메모리는 MySQL2GiB, API/worker/source 각1GiB, Redis512MiB, runner512MiB다. Redis maxmemory0은 Redis 자체 상한이 없다는 뜻이며 container 한도·외부 stop과 함께 해석한다. 기존 서비스와 호스트 CPU/IO/cache를 공유한다.

전용 bridge network에서 host 공개 포트는 loopback13000/13100/13307/16380이다. 최초 internal network가 이 호스트의 loopback 공개 포트에서 통하지 않아 새 bridge network로 검증했다. 인터넷·다른 서비스를 부하 대상으로 쓰지 않는다. 기존 logistics-mvp/network/volume/3000·3100·3307·6380은 제어하지 않았다.

아래는 **후속 실행 지시가 있을 때의 실제 인터페이스**다. 이번에 `run-b0`는 실행하지 않았다. 준비된 경로는 아직 기동/seed되지 않았다. 실행 직전 포트·원본 SHA·이미지·동결한 host driver/source를 다시 검사하고, 이름 충돌이나 이미 시작한 실험은 초기화하지 않고 거부한다.

```bash
cd /home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/worktree
python3 tools/b0/lab.py check --lab /home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/runtime-b0-pilot-ready
# 별도 실행 지시 후에만: 실제 원본 99,441건의 단일 pilot. 이번 미실행.
python3 tools/b0/lab.py run-b0 --lab /home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/runtime-b0-pilot-ready --execute-full-b0
```

이 명령은 새 infra→migration→실제 master seed→기존 source/worker/API→입력 없는60초→API 내부 collect→최대45분 공급/처리→EOF 후 최대20분 drain→동일 이미지의 독립 CSV audit(최대5분)→실험만 stop을 수행한다. 초기 테이블은 주문 업무 테이블이 빈 상태이며 master와 OS cache는 있으므로 cold cache라고 부르지 않는다. 최종 audit는 처리 구간 밖의 READ ONLY consistent snapshot이고 임시 인덱스/출력은 실험 scratch/output뿐이다. DB·Redis의 상태/volume·실패를 보존한다. 결과와 raw metrics는 위 root의 `output/`, `metrics/`이고 비밀 설정은 `runtime/`이다. Git에 원본·secret·SQLite·volume·큰 raw metrics를 넣지 않는다.

일단 queue/DB 미완료0·FAILED0·Redis 잔여0, checkpoint DONE·정확한 raw/task 수를 관측하고 **5초 주기의 정상 sample3개**로 drain을 확인한다. source EOF만으로 끝내지 않는다. 최초 정상 sample과 stable 확인 대기를 구분한다. 자원 수집 때문에 실제 controller 확인은 더 늦을 수 있다.

host MemAvailable<2GiB20초, container memory80%30초, backlog가 있는데60초 durable progress 없음 또는 공급 deadline은 **공급 정지(API의 기존 abort/종료)→제한 drain**이다. 큐 age120초는 단독 stop이 아니다. 정합성·FAILED checkpoint/job·관측 가능한 OOM/runtime/observer I/O 오류는 drain을 기다리지 않고 실험만 stop한다. 내부 MySQL storage 오류 원인의 즉시 식별을 보장하지 않으며 DB가 숨긴 원인/정확 lock·pool 시간은 UNKNOWN이다. source timeout15초·lease30초를 유지하고 service stop 유예20~30초 후 Docker가 종료를 강제할 수 있다. 이것이 발생하면 clean-close/coverage를 실패로 남긴다. 공급을 정지한 표본은 나중에 drain돼도 정상 baseline PASS로 바꾸지 않는다. down -v/flush/DROP/TRUNCATE/기존 서비스 fault script는 사용하지 않는다.

첫 전체 pilot에서는 실제 크기의 coverage·자원·종료 동작을 확인해야 한다. full-size 성능·오버헤드·수용 λ는 아직 미측정이다. 반복 측정·B1 scheduler·부분 oracle·B2 API driver·큐 분리·다중 worker·cache·증분 집계·100만 파생·장비 작업은 구현/실행하지 않았다.

## 실패와 보존

- [실패1](failed-attempt-01.json): 수집 전 internal network의 host readiness 실패. 그 컨테이너/volume/로그는 보존하고 새 network/새 root에서 검증했다.
- [실패2](failed-attempt-02.json): 합성 업무 완료 후 Python3.10의 UTC `Z` 파싱 후처리 실패. parser 수정 후 보존한 snapshot/sidecar로 재검증했으며 최초 실패를 덮어쓰지 않았다.
- [최종 OFF 중단](smoke-off-interruption.json): 업무 snapshot과 app 종료 이후 driver가 더 이상 없어 observer/DB/Redis가 남아 있었다. 재개 시 해당 project만 정지하고 보존 sidecar/업무 결과를 재검증했다. [OFF review](smoke-off-review.json)는 후처리 결과이며 중단 자체를 숨기지 않는다. 최종 ON은 정상 명령 종료까지 PASS다.
- 의미 검증의 의도적인 sink/drop 실패는 별도 runner 증거이며 정상 sample coverage와 분리했다.

원래 Git/조사/입력과 실험 종료 상태 확인은 [preservation-final.json](preservation-final.json), 선택한 Git 변경 범위는 [git-delivery.md](git-delivery.md)에 남긴다. 기존 상세 QR 판정·사용자 완료 확인·release tag는 갱신하지 않았다. E1 성능 개선 기능이나 운영 병목은 확정하지 않는다.
