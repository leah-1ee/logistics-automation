# 실제 Olist B0 단일 pilot 결과

2026-11-03 Asia/Seoul. **pilot FAIL — drain 미완료. 독립 대사 FAIL. Coverage INVALID.**

99,441건은 수집했지만 적격96,596건 중 task65,973건만 생성된 상태에서 기존 drain deadline에 도달했다. 미완료30,623건을 추가 처리하거나 pilot을 반복하지 않았다. 파일 drop·sink 오류는0이고 효과 ID도 DB와 일치하지만, wall/monotonic 간격 이상7건으로 기존 coverage 판정은 INVALID다. **유효한 성능 baseline·성능 개선 완료로 사용하지 않는다.**

## 수집·분류·업무 결과

| 항목 | 종료 후 고정 DB의 실제 수량 |
|---|---:|
| raw/정규화 주문 | 99,441 |
| 적격 | 96,596 = TASK_CREATED65,973 + READY30,623 |
| DATA_HOLD / UNSUPPORTED | 789 / 2,056 |
| 생성 task / task-product 항목 | 65,973 / 67,593 |
| 생성 task 필요수량 / 적용수량 | 74,342 / 0 |
| Outbox DONE / PENDING / DISPATCHED / FAILED | 65,973 / 30,620 / 3 / 0 |
| task 비-CREATED·배정·확정 위반 | 0 |
| device event / 완료 보고서 | 0 / 0 |
| product / seller master | 32,951 / 3,095 |
| job 실행 이력 | 성공65,973, 기록된 error_code 없음 |

[최종 READ ONLY snapshot](final-state.json), [독립 CSV 대사](independent-audit.json), [실행 실패 원문](pilot-result.json)을 구분한다. 최종 상태 조회를 위해 실험 MySQL만 재시작했고 API/source/worker는 다시 실행하지 않았다. 실험 Redis도 별도로 재시작해 LLEN/ZCARD만 읽었다. [보존 Redis 최종 값](redis-final.json)은 waiting3·active0·delayed0·failed0·paused0이다. 이 조회는 새 작업 처리·재생이 아니다. 모두 다시 정지했고 volume·실패 증거는 보존했다.

독립 대사는 주문99,441·task65,973·수량항목67,593을 검사했으며 미완료 Outbox30,623건을 확인했다. 오류는 `NORMALIZATION:30623`, `ELIGIBLE_TASK_BIJECTION:30623`, `OUTBOX_NOT_DRAINED:1`이다. 대사기는 적격 주문의 최종 TASK_CREATED 상태와 task 존재까지 요구하므로 READY 미완료분이 복수 검사에 걸린다. 이 수들을 서로 다른 주문의 오류로 단순 합산하지 않는다. 별도의 raw hash/CSV 내용/상품 수량 오류 코드는 보고되지 않았지만, **전체 독립 대사 PASS가 아니다**.

## 시간·처리량 — 검증되지 않은 wall 관측 참고값

B0 t0는 **2026-11-03 14:51:01.386776 Asia/Seoul**, 수집 시작 POST 직전이다. HTTP 수락 이후 시각이나 과거 `sourceAvailableAt`을 t0로 쓰지 않았다. Source는 기본 시계에서 처음부터 공개된 유한 backlog이며 입력 payload/공개 스케줄을 바꾸지 않았다.

| 지표 | 참고 관측값 | 분모·한계 |
|---|---:|---|
| t0→마지막 raw 커밋 성공 관측 | 243.836초 | 99,441건 |
| 수집 평균 | 407.819건/초 | 99,441 / 위 wall 구간 |
| t0→마지막 task 커밋 성공 관측 | 1,538.819초(25분38.819초) | 실제 생성65,973건만 |
| task 생성 평균 | 42.872건/초 | 65,973 / 위 wall 구간 |
| 전체 적격 task 생성 완료 시간 | 미측정·미완료 | 30,623건은 생성되지 않음 |
| 생성된 subset의 t0→task 관측 p50/p95 | 804.888 / 1,469.113초 | 완료65,973건만, 미생성분은 censored |

시계 간격 이상 때문에 이 wall 기반 시간·율·cross-process latency는 검증된 수치가 아니다. subset의 p95를 적격96,596건 전체의 p95로 쓰지 않는다. 단일 계측 ON run이며 계측 OFF 비교·오버헤드율·지속 가능한 유입 λ·일반 API p95·운영 처리량을 측정하지 않았다. [요약 JSON](summary.json)의 validity flag도 INVALID로 남겼다.

## 단계별 client 비용

아래는 고정 label의 같은 프로세스 monotonic duration 기록이다. 합계는 초, p50/p95는 ms이며 nearest-rank다. 부모/자식 span 및 dispatcher/worker가 중첩되므로 합계를 전체 wall 시간으로 더하지 않는다. DB 엔진 실행 시간·commit 시간·정확 pool wait·행 잠금 시간으로 분해할 수 없다. timestamp로 선택한 처리 구간 자체도 시계 이상 한계가 있다.

| 단계 | 관측 수 | 합계 초 | p50 ms | p95 ms |
|---|---:|---:|---:|---:|
| source headers/fetch | 498 | 6.495 | 12.748 | 16.833 |
| source body/JSON | 498 | 0.233 | 0.440 | 0.641 |
| source validation | 498 | 0.076 | 0.131 | 0.202 |
| ingestionStatus | 500 | 14.520 | 28.831 | 54.788 |
| ingestPage transaction | 498 | 211.424 | 383.477 | 703.212 |
| dispatch scan | 661 | 17.985 | 26.739 | 42.328 |
| dispatch DB transaction | 65,977 | 1179.959 | 16.595 | 27.380 |
| Redis getJob | 65,976 | 16.157 | 0.225 | 0.387 |
| Redis add | 65,976 | 25.833 | 0.360 | 0.619 |
| job transaction | 65,973 | 1184.688 | 16.189 | 28.625 |

추가 고정 SQL label: product master498회/합계10.065초/p95 27.431ms, seller498회/1.281초/p95 3.080ms, status COUNT/GROUP BY500회/14.146초/p95 54.248ms, 원본 두 identity 조회198,882회/38.244초/p95 0.313ms였다. 전체 label별 count·분포는 [summary.json](summary.json)에 있다. source fetch는498개 페이지이고, 수집 시작 POST는1회(성공 응답1·timeout0)다.

종료부에 dispatch transaction `callback_failed` 1건(SQL count0)이 기록됐다. [종료 관측](shutdown-observation.json)에 그대로 남겼으며 구체 원인은 UNKNOWN이다. 이 1건과 job 실행 이력의 성공65,973건을 혼동하지 않는다. 코드 패턴이나 한 번의 이 수치만으로 단일 운영 병목의 원인을 확정하지 않았다.

## 자원·backlog·drain

PID1 자원147표본이다. RSS 최대는 sampling 하한, HWM은 시작/idle을 포함한 process 수명 값이다. CPU 초는 첫/마지막 `/proc` tick 차이를 CLK_TCK100으로 환산했다. Docker CPU%에는 exec sampler 비용도 포함된다. wall 구간 평균 core-equivalent는 시계 이상 때문에 검증되지 않았다. API와 내부 collect를 별도 RSS처럼 나누지 않았다.

| 프로세스 | 관측 RSS 최대 MiB | process HWM MiB | sample bracket CPU 초 | Docker CPU% 관측 최대 |
|---|---:|---:|---:|---:|
| API/collect | 192.23 | 195.05 | 93.94 | 48.63% |
| worker | 137.93 | 140.29 | 239.64 | 27.60% |
| source | 150.34 | 150.34 | 11.90 | 4.95% |
| MySQL | 910.68 | 910.68 | 551.72 | 103.78% |
| Redis | 11.16 | 11.16 | 46.80 | 8.22% |

MySQL buffer512MiB/flush1/sync_binlog1, Redis AOF everysec/noeviction/maxmemory0, worker1/concurrency1·pool8/process·page200/master200·기존 dispatcher를 유지했다. quota는 MySQL1.5+API0.75+worker0.75+source0.5+Redis0.5=4.0 CPU equivalents이고 관측 runner는 실행 중0.25를 더한다. cpuset 고정·호스트 전체4코어 격리가 아니며 기존 서비스와 CPU/IO/cache를 공유한다. host MemAvailable 관측 최소는 약9.95GiB였다. OOM이나 메모리 기준에 의한 중지는 없었다.

- 관측 DB 미완료 최대 **87,750건**, Redis waiting+active+delayed+failed 최대 **20건**. 대기는 주로 DB Outbox에 있었다. 이것만으로 DB 서버나 특정 SQL이 원인이라고 단정하지 않는다.
- 최초 enqueue 성공 관측이 확인된 subset의 가장 오래된 나이는 최대1,378.966초(wall 참고값)였다. 263표본 중13표본은 enqueue age coverage UNKNOWN이었다. `available_at`을 최초 시각으로 대신하지 않았다.
- 최초 checkpoint DONE 표본은 `2026-11-03T05:55:09.966Z`다. DB/Redis가 함께0인 sample이나 3회 연속 drain 정상 확인은 **없었다**.
- 기존 controller의 monotonic20분 drain 예산 뒤 `Bounded drain deadline`으로 중지했다. 마지막 raw→마지막 task 성공 관측의 wall 차이는1,294.983초다. controller의 DONE 인지/자원 수집·판정 지연/종료 유예와 clock 이상이 있어 이를 정확한20분 wall 시간으로 바꾸어 쓰지 않는다.
- 큐 age120초만으로 멈추지 않았고 deadline을 늘리지 않았다. 원본 전체 처리나 backlog를 끝내기 위한 추가 resume·반복·최적화는 하지 않았다.

## 실제 로그 크기·coverage

| process JSONL | bytes | MiB | 2GiB 대비 |
|---|---:|---:|---:|
| API/collect | 330,893,082 | 315.564 | 15.41% |
| worker | 509,570,184 | 485.964 | 23.73% |
| source | 0 | 0 | 0% |
| 합계 | **840,463,266** | **801.528** | process별 한도임 |

source는 JSONL event가 없고 health만 남겼다. health 파일은 별도 소량 파일이며 위 bytes는 누적 cap 대상 JSONL 크기다. 별도 monitor.jsonl261,732bytes, resources.jsonl413,279bytes도 새 실험 경로에 보존했다. 이번에는 2GiB에 도달하지 않았으며 상한 변경의 성능 개선 효과를 입증한 실험이 아니다. 파일 회전은 구현하지 않았다.

[coverage](coverage.json), [schema 검사](schema-check.json), [시계 간격 진단](clock-anomalies.json)을 구분한다.

- JSONL **2,057,103 records schema PASS**, process별 sequence/clean-close 확인.
- raw99,441/task65,973/outbox96,596 ID가 최종 DB와 모두 일치.
- API/worker/source의 drop·sink errors·candidateDrops는 전부0, clean-close true.
- **기존 판정은 INVALID: CLOCK_INTERVAL_ANOMALY**. API1·worker6곳, 최대 absolute interval skew2.602초. 일부는 warm-up 구간이며 worker4곳은 수집 시작 후다. 기록만으로 clock step과 scheduling/기록 간격을 구분하지 못해 원인은 UNKNOWN이다.
- 원래 timestamp를 보정하거나 anomaly를 제외해 VALID로 다시 판정하지 않았다. ID coverage의 일치가 시간 coverage나 전체 workload 완료를 보증하지 않는다. sidecar는 DB와 원자적이지 않다.

## 변경·실행 provenance와 보존

기준 baseline `954bb692a244803b8aad695539d81afdcb81a091`, 준비 결과 `ed4c8cb`, 이번 상한 변경 commit **`3e246da`**다. [limit-diff.patch](limit-diff.patch)는 default/clamp와 환경값을2GiB로 맞추고 manifest에 한도를 명시한 변경 및 전용 상한 검사다. memory buffer의 코드/clamp/동작은 그대로다. 일반 업무 회귀·F1·합성 smoke·부하 재시험은 하지 않았고 상한 검사2개만 실행했다. 최초 검사 준비에서 test TypeScript env 타입과 record 크기 가정 오류가 있었으며 [build 실패](build-failed-types.txt), [검사 실패](file-limit-tests-failed-size.txt)를 보존했다. 수정 후 [상한 검사](file-limit-tests.txt)는2 PASS다.

새 image ID는 `sha256:b85e8fde1616c1acf5cc3ea8d0df9beac475f4ccaa9a4756176e1ef78d8ed200`이며 offline cache/같은 lock으로 build했다. [manifest](manifest.json), [실제 실행 artifact SHA](runtime-artifact-hashes.json), [사전 조건](preflight.json), [격리 결과](runtime-isolation.json)를 남겼다. actual health의 maxFileBytes=2,147,483,648·maxBufferBytes=8,388,608·maxRecords=8,192도 확인됐다.

실행 이미지에는 Git이 없어 기존 auditor의 무조건 `git rev-parse HEAD` 호출을 실행할 수 없었다. 제품/계측 코드를 추가 수정하지 않고 [단일 실행 adapter](execute-once.py)가 **최종 감사 호출만** 기존 host Node24.22.1/같은 lock·dependency cache의 원래 `tools/audit-source.ts`로 연결했다. 실제 수집·worker·observer는 새 고정 이미지였다. [감사 provenance](audit-provenance.json), [host dependency 검사](host-dependencies.json)를 남겼다. 감사는 처리 구간 밖 READ ONLY consistent snapshot이고 원본 CSV를 직접 읽으며 새 scratch의 파생 SQLite만 썼다. container JS와 host TS auditor의 SHA·실행 위치를 혼동하지 않는다.

실제 실행은 아래1회다. [pilot-invocation.json](pilot-invocation.json)과 [start-post.json](start-post.json)에 단일 invocation/POST1회가 남았다.

```bash
cd /home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/worktree
python3 reports/e1-b0-pilot-20261103T143913+0900/execute-once.py /home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/runtime-b0-single-20261103T143913-2g --execute-full-b0
```

이 경로는 이미 사용했으며 실행 adapter와 도구의 one-shot gate가 재사용을 거부한다. 새 pilot을 시작하지 않는다. 읽기 전용 사후 원장·Redis 조회는 정지된 동일 실험 데이터만 확인했고 API/source/worker를 다시 시작하지 않았다.

[보존 확인](preservation.json): 기존 main 상태·tracked 파일·기존 조사/준비 보고서·이전 pilot-ready·입력6파일 SHA가 그대로다. 기존5개 서비스의 image/start 시각도 조사 당시와 같았다. 기존 실제 DB의 전체 fingerprint나 단말 접근은 수행하지 않았다. 이번 실험의 container는 정지했고 volume·DB·Redis 상태·큰 raw metrics·실패 증거는 유지했다. raw metrics/ID 목록/비밀 환경/DB 파일은 Git에 추가하지 않는다.

원시 결과 위치는 `/home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/runtime-b0-single-20261103T143913-2g/`다. 요약은 [summary.json](summary.json), 실패 원문은 [execution-result.json](execution-result.json), 정합성은 [independent-audit.json](independent-audit.json)에 있다. 단일 pilot에서 종료하며 E1 기능·성능 개선 완료를 선언하지 않는다.

감사에 사용한 기존 dependency cache의 임시 worktree symlink는 감사 후 제거했다. 기존 cache의 파일은 수정하지 않았고 Git에 추가하지 않았다. 재현 설명은 그 감사 시점의 실행 환경을 기록한 것이며 이미 사용한 pilot을 다시 실행하는 지시가 아니다.
