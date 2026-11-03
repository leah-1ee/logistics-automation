# 기존 B0 pilot 기록 분석과 첫 E1 범위

작성: 2026-11-04 Asia/Seoul. 분석 기준 commit: `92216b48575d334968d67df638eb143e2095f5a3`. 브랜치: `e1/b0-preparation-20261103T100518-0900`. 제품 공개 baseline은 `954bb692a244803b8aad695539d81afdcb81a091`, 실제 pilot 실행 코드는 `3e246da0a027e622c669f893ba2f52c89658364d`다.

**첫 E1의 설계 범위는 “후보 100개를 처리한 dispatcher가 다음 interval tick을 기다리지 않고 다음 배치를 예약”하는 변경 하나다.** 같은 프로세스의 기록에서 배치 사이 대기와 worker의 다음 job 진입 공백이 겹친다. 순차 발행·worker1/concurrency1·개별 transaction은 유지한다. 이는 dispatcher scheduling에 대한 제한된 가설이며 DB 또는 fsync가 운영 병목이라고 확정한 결론이 아니다. 이번 산출물은 분석·설계 문서뿐이다.

## 1. 원래 실패 판정과 데이터 오류를 분리한다

[기존 pilot 보고서](../e1-b0-pilot-20261103T143913+0900/README.md)의 **pilot FAIL / 독립 대사 FAIL / coverage INVALID**를 모두 유지한다.

| 구분 | 보존한 사실 | 해석 |
|---|---|---|
| 실행 중단 | `Bounded drain deadline` | EOF/DONE 관측 뒤 기존 monotonic 20분 drain 예산에 도달. 정체 감지나 메모리 중지로 확인되지 않음. 수집은 끝났지만 전체 업무는 미완료 |
| 업무 수량 | raw 99,441; 적격 96,596 = task 65,973 + READY 30,623; DATA_HOLD 789; UNSUPPORTED 2,056 | 수집 누락과 task 미완료를 구분. 생성 task 필요수량 74,342, 적용 0 |
| 독립 CSV 대사 | NORMALIZATION 30,623; ELIGIBLE_TASK_BIJECTION 30,623; OUTBOX_NOT_DRAINED 1 | 같은 미완료 READY 주문이 상태/일대일 task 검사에 함께 걸림. 서로 다른 61,246개 손상 주문이라고 합산하지 않음 |
| 시간 coverage | API 1·worker 6개 인접 기록 간 wall/monotonic 차이 >1초 | ID 완전성과 별개. 과거 TPS·t0→task 지연의 타당성을 복구하지 않음 |
| 별도 손상/업무 오류 | 감사에 별도 raw hash·CSV 내용·수량 오류 코드 없음. badTasks 0, CREATED·미배정·미확정, event/보고서/적용량 0, Outbox FAILED 0, 성공 시도 65,973·error_code 없음 | **검사한 범위에서 추가 손상 증거 없음**. 전체 적격 처리가 끝나지 않았으므로 전체 업무 성공·남은 30,623건의 미래 결과는 주장하지 않음 |
| 종료부 별도 오류 | worker sequence 1,257,289, dispatch callback_failed 1건, SQL count 0, 약 2.570ms | 실패한 마지막 발행 transaction. 정상 job의 실패 시도로 바꾸어 세지 않음. shutdown과 근접하나 정확한 원인 UNKNOWN |

최종 DB Outbox는 DONE 65,973 / PENDING 30,620 / DISPATCHED 3 / FAILED 0이며 Redis 최종 보존값은 waiting 3·active/delayed/failed 0이다. 실행을 재개하지 않았다. 원래 종료 후 수행한 독립 대사와 READ ONLY snapshot의 결과를 읽었으며 이번 분석에서 DB·Redis에 연결하지 않았다.

## 2. 분석 입력·시간 정의

원시 root는 `/home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/runtime-b0-single-20261103T143913-2g/`다. worker JSONL SHA-256은 `dff018d8fc0a0376a4471710715412c7aaef65c2cf49db45ce17af22b02e5f43`, API는 `7b415ee2fd0ec3fb8dd20e63350a332f8596524d02b853c198a106f98fa33e6a`다. [입력 해시](input-hashes.json)에 기존 보고서·monitor/resources 해시도 고정했다.

worker의 단일 processIdentity는 `1-903eb149-d665-4b4e-8be8-7f3eac65bce8`이다. sequence 1..1,257,292가 연속이고 저장된 monotonicNs의 역행은 0이다. 작업 구간은 첫 비어 있지 않은 scan 시작 8298.454160111초부터 마지막 transaction/job 완료 관측 9771.047276710초까지 **1,472.593초**다. 절대 숫자는 이 프로세스의 hrtime 원점 기준이며 host t0나 다른 프로세스의 원점으로 사용하지 않는다. span의 durationMs는 같은 프로세스 `performance.now()` 차이이며 hrtime과 기록 시점에 작은 차이가 있다.

`span/dispatch.scan`은 두 종류다. startedMonotonicNs·durationMs가 있는 scan 완료 기록과, 곧이어 count만 담은 후보 수 기록이다. 이를 합쳐 한 scan으로 세었다. 다음 scan까지 속한 dispatch transaction/dispatch_committed/Redis add를 묶고, 배치 시작은 scan 시작, 종료 대용값은 마지막 발행 후보 또는 transaction의 관측 시각으로 잡았다. 실제 함수 return/busy 해제의 직접 기록은 없으므로 배치 사이 공백에는 미기록 정리·타이머·스케줄링 시간이 함께 들어간다. 마지막 실패 배치는 끝까지 실행된 100개 배치와 분리했다.

모든 722개 scan의 후보·발행·구간은 [배치별 CSV](dispatch-batches.csv), 요약은 [worker 분석 JSON](worker-analysis.json)에 있다. CSV의 monotonic 값은 초 단위 파생값으로 원본 ns를 대체하지 않는다. 작은 소수점 오차는 반올림이며 원본 timestamp를 수정하지 않았다.

## 3. dispatcher의 배치·주기·busy

근거 코드: [`jobs.ts:51`](../../src/jobs/jobs.ts:51)의 LIMIT 100·순차 for/await, [`jobs.ts:70`](../../src/jobs/jobs.ts:70)의 setInterval(1000)·busy guard. 후보 수와 실제 발행 성공 관측을 구분했다.

| 항목 | 같은 worker 프로세스에서 확인한 값 |
|---|---:|
| 전체 scan / 초기 빈 scan | 722 / 62 |
| 비어 있지 않은 scan | 660, 전부 후보 100개 |
| 후보 합계 | 66,000 |
| 완전 배치 | 659 × 실제 발행 100개 |
| 마지막 중단 배치 | 후보 100, Redis add/dispatch 성공 76, transaction 관측 77(성공 76 + 실패 1) |
| Redis add 성공 / dispatch 성공 | 각각 65,976, jobId도 각각 중복 없는 65,976개 |
| 완료 100개 배치 소요 p50 / p95 / 최대 | 1.795 / 2.212 / 2.824초 |
| 비어 있지 않은 배치의 다음 scan 시작 간격 p50 / p95 / 최대 | 2.000 / 3.001 / 3.003초 |
| 659개 시작 간격 중 2.5초 초과 | 153개 |
| 배치 종료 대용값→다음 scan 공백 합계 | **271.872초** |
| 위 공백 p50 / p95 / 최대 | 0.363 / 0.973 / 1.001초 |

비어 있지 않은 배치 660개가 모두 1초보다 길다. 따라서 1초 cadence를 매번 독립 실행하는 구조가 아니며, 실제로 약 2초/3초 간격으로 다음 scan이 시작됐다. 코드상 busy이면 tick이 생략되지만 **tick/busy-skip 기록 자체는 없다**. 배치 길이의 floor를 합한 813은 “배치 내부에 걸친 명목상 1초 슬롯 수”일 뿐 실제 생략 callback 813회라는 측정값이 아니다. event-loop 지연과 타이머 위상을 구분할 수 없다.

첫 비어 있지 않은 배치는 CSV index 63/scan sequence 188이다. 2.323초 동안 100개를 발행한 뒤 약 0.678초 후 다음 scan이 시작됐다. 마지막 index 722는 성공 76개에서 중단됐다. 65,976개 발행 중 65,973개만 job 완료로 이어졌으며 차이 3은 최종 Redis waiting/DB DISPATCHED와 일치한다.

## 4. worker 처리·다음 job 공백·진행

`processJob` 진입의 span(jobId 포함)→같은 job의 성공 transaction/후보 job_completed를 한 업무 구간으로 연결했다. concurrency1이고 시작/완료가 65,973개씩 일치한다. 이는 BullMQ ACK 완료 구간과 같지 않다. job_completed는 DB transaction 성공 뒤 관측이며 함수 반환·BullMQ ACK는 그 뒤다.

| 구간 | 관측값 |
|---|---:|
| 첫 job 진입→마지막 job 완료 | 1,472.584초(monotonic) |
| processJob 업무 구간 union | 1,189.037초 |
| job transaction duration 합계 | 1,184.688초 |
| 직전 job_completed→다음 job 진입 공백 합계 | **283.547초** |
| 다음 job 공백 p50 / p95 / p99 | 0.689 / 1.068 / 2.842ms |
| 다음 job 공백 최대 | 1.009597초 |
| 100ms 초과 / 1초 초과 / 60초 이상 공백 | 527 / 1 / 0개 |
| 인접 durable job 완료 간격 최대 | 1.044606초 |

283.547초를 전부 “Redis blocking wait”라고 부르지 않는다. callback return/ACK 왕복·클라이언트 전달·스케줄링 등이 섞인다. `processJob` 업무가 관측되지 않은 구간이라는 뜻이다. 그중 **221.526초(78.13%)**가 dispatcher 배치 종료→다음 scan 구간과 겹친다.

성공 Redis add 수−이미 processJob에 진입한 수를 sequence/monotonic 순서로 누적하면 음수 0, 최종 잔여 3이다. 이 관측상 미전달 발행 수가 0이고 job 업무 구간도 없는 상태가 배치 사이 공백과 겹친 시간은 **219.251초**다. 이는 Redis 내부 waiting/active의 정확한 연속 상태나 ACK 완료 시각을 복원한 값이 아니다. Redis add 응답 전 전달, ACK 미관측 등 한계가 있다. 별도로, 선택된 후보가 아직 모두 발행되지 않은 배치 내부에서도 같은 대용 조건이 606구간/1.252초 나타났다(최대 5.649ms).

monitor의 DB 미완료 조회 후 Redis waiting/active/delayed/failed 합계 0인 sample은 **34개**다. 예: sample 18, 미완료 15,132건, 관측 wall `2026-11-03T05:51:35.725Z`. 전체 목록은 worker-analysis.json에 있다. DB/Redis 조회는 순차적이며 원자적 snapshot이 아니고 worker와 monitor clock의 정확한 정렬도 검증되지 않았다. 이를 선형 보간해 “Redis가 비었던 정확한 초”로 바꾸지 않는다. 다만 DB 대기와 worker 공급 공백이 공존했다는 가설을 뒷받침한다.

첫 job 진입 기준 60초 monotonic bucket의 완료 수는 전체 24개 bucket에서 2,200~2,960개, 마지막 부분 bucket(32.584초)은 1,573개다. 마지막 중단 전까지 긴 처리 정지는 보이지 않는다. 원래 stop은 **진행 중이지만 정해진 예산에 완료하지 못한 상황**으로 해석한다. 종료 뒤 기록이 없는 시간을 정체라고 세거나 남은 작업이 언제 완료됐을지 확정하지 않는다.

## 5. dispatch와 worker 중첩 및 SQL 비용의 한계

| 같은 worker monotonic 구간 | union/교집합 초 |
|---|---:|
| 비어 있지 않은 dispatch 배치 구간 union | 1,200.718 |
| job 업무 구간 union | 1,189.037 |
| 둘의 교집합 | **1,138.688** |
| 둘을 합친 union | **1,251.067** |

1,200.718+1,189.037을 처리시간으로 쓰지 않는다. 각각의 transaction 합계 1,179.956초(dispatch 성공만)·1,184.688초(job) 역시 동시에 진행된 client duration이고 합산 TPS 분모가 아니다.

SQL에는 transaction ID가 없다. label이 job 전용인 조회/쓰기들은 코드 call site를 확인했고, 공용 `sql.job.lock`/`sql.job.update`는 SQL 시작~완료가 포함되는 동시 transaction 후보를 찾았다. 후보가 하나면 유일 배정, 둘이면 양쪽 가능성으로 남겼다. scan SQL 722개는 transaction 밖이다. 나머지 SQL 727,329개 중 473,413개만 유일 배정되며 **253,916개는 모호**하다(lock 127,323 / update 126,593). 시간 겹침만으로 정확히 배분하지 않았다.

| 성공 transaction | 개수·전체 client duration | 소속이 확실한 SQL 합계 | 모호 SQL을 모두 해당 tx로 볼 때의 SQL 합계 상한 | SQL을 뺀 미귀속 잔여 합계의 보수적 범위 |
|---|---|---:|---:|---:|
| dispatch | 65,976 / 1,179.956초 | 8.117초 | 99.467초 | **1,080.610~1,171.839초** |
| job | 65,973 / 1,184.688초 | 156.202초 | 247.552초 | **937.330~1,028.486초** |

범위는 tx별 `max(0, tx_duration − 가능한 모든 SQL_duration)`부터 `max(0, tx_duration − 유일 배정 SQL_duration)`를 합한 것이다. 모호 SQL을 양쪽에 넣은 낮은 잔여 경계는 일부를 중복 가정하므로 좁은 오차막대가 아니다. SQL duration은 client 시간이고 interval 포함관계는 관측 시점 기준이다. 정확한 trace 배분이 아니다.

이 잔여에는 미계측 ORM BEGIN/COMMIT, connection 획득, 네트워크, application/계측·스케줄링, Redis 호출(dispatch), DB 작업 이후 resolve까지의 시간이 들어갈 수 있다. **잔여 전부를 commit/fsync/lock으로 분류할 수 없다.** Redis get/add의 전체 client 합계 16.157/25.833초도 dispatch transaction 안에 중첩된다. pool wait·전 구간 lock·엔진 commit 시간은 UNKNOWN이다. 현재 증거는 DB 내구성을 약화하거나 transaction을 합칠 근거가 아니다.

## 6. 시계 이상 7건과 측정 구간 영향

아래 UTC wall은 원본 그대로다. 전부 양의 `wall_delta − monotonic_delta`다. 각 행의 정확한 원본 ns·processIdentity는 [시계 분석 JSON](clock-analysis.json)에 있다.

| process / sequence 전→후 | UTC wall 전→후 | wall Δ초 | monotonic Δ초 | 차이 초 | 영향 |
|---|---|---:|---:|---:|---|
| API 1→2 | 05:49:57.756→05:51:01.401 | 63.645000 | 61.042875 | 2.602125 | idle→최초 수집 SQL. host t0 직후에 걸침. t0 정렬·누적 wall 시간 영향 |
| worker 54→55 | 05:50:15.316→05:50:17.622 | 2.306000 | 0.999660 | 1.306340 | 첫 job 전 idle scan |
| worker 144→145 | 05:50:46.631→05:50:48.928 | 2.297000 | 1.000842 | 1.296158 | 첫 job 전 idle scan |
| worker 30,685→30,686 | 05:51:49.502→05:51:51.564 | 2.062000 | 0.785722 | 1.276278 | 처리 중 scan, task t0 지연·wall 구간 영향 |
| worker 234,603→234,604 | 05:56:31.412→05:56:33.446 | 2.034000 | 0.722175 | 1.311825 | 처리 중 scan |
| worker 425,153→425,154 | 06:00:10.574→06:00:12.775 | 2.201000 | 0.896065 | 1.304935 | 처리 중 scan |
| worker 474,686→474,687 | 06:01:13.173→06:01:15.411 | 2.238000 | 0.942550 | 1.295450 | 처리 중 scan |

추가 확인: 7건만 제외하면 충분하다는 근거도 없다. worker 첫 job→마지막 완료 wall은 1,537.270초, monotonic은 1,472.584초로 **64.686초** 다르다. 전체 worker 기록의 차이는 67.288초이고, >1초인 6개 인접 간격의 차이 합계는 7.791초뿐이다. 나머지 인접 간격에도 합계 59.497초 차이가 분포한다. API 전체 기록도 wall 307.526초 vs monotonic 294.471초, 차이 13.055초다. 이는 drift/clock step/host suspend 또는 기록 사이 scheduling 등의 특정 원인을 증명하지 않는다.

`Recorder.emit`은 Date→hrtime을 순차 호출하고 둘을 bracket하지 않았다(`b0.ts:58`). 시작 때 host/container wall 한 번을 bracket한 결과도 전 구간 보장이 아니다. 저장 자료에 독립 시계 기준·sampling 중단/clocksource 변화의 충분한 증거가 없어 원인은 **UNKNOWN**이다. 같은 프로세스의 hrtime/performance 구간은 batch/겹침의 상대 비교에 사용했지만 실제 초와의 독립 검증을 통과한 end-to-end TPS로 승격하지 않았다. 원래 wall TPS·t0→task 값은 검증되지 않은 참고값으로 유지한다. host 전체 완료시간·정확한 cross-process latency도 복원하지 않는다.

후속 비교의 최소 보완은 설계 문서 5절에 고정했다. 핵심은 low-frequency 같은 프로세스 `mono_before → wall → mono_after` bracket, 예정 heartbeat와 실제 sampling 지연, host의 같은 bracket·가능한 BOOTTIME 참고값이다. 원본을 보정하거나 이상 표본을 삭제하지 않는다. 비교 두 쪽에 같은 관측기를 먼저 적용해야 한다.

## 7. 대안과 선택

| 대안 | 근거/효과 범위 | 불확실성·위험 | 이번 첫 E1 선택 |
|---|---|---|---|
| 기존 방식 유지 + 완료 관측 예산 증가 | 진행은 지속됐고 기존 drain 20분은 부족했다. 더 긴 bounded 관측은 완결 대사의 선행 조건 | 예산 증가는 처리 성능 개선이 아니다. 이 pilot의 FAIL을 바꾸거나 성공으로 resume할 수 없음 | 전후 실험의 공통 관측 조건으로만 설계 |
| dispatcher 실행 예약 조정 | 배치 후 271.872초 공백, worker 공백과 221.526초 겹침; 34개 DB 대기/Redis 0 sample | timer/busy skip 정확 횟수 UNKNOWN; gap 전부가 제거 가능하다는 보장은 없음; 연속 DB 사용으로 경합/Redis backlog 증가 가능 | **선택: full batch 뒤 yield 후 다음 scan 예약만** |
| dispatcher 발행 병렬성 | 순차 dispatch transaction 비용은 큼 | 동시 발행은 row lock·큐 진입 순서·오류 경계·pool 예산을 함께 바꿈. 미귀속 tx 비용 원인도 UNKNOWN | 제외. 순차 for/await 유지 |
| worker concurrency/프로세스 확대 | worker 업무 구간 약 81%, 처리도 계속 진행 | 약 19% 공백 중 공급 예약 대기가 관측됨. pool8×프로세스·DB lock·CPU 수요 증가. 미완료만으로 worker 부족을 확정할 수 없음 | 제외. worker1/concurrency1 유지 |
| transaction/SQL 최적화 | 큰 client 잔여·매 페이지 status/master 비용 존재 | tx ID 부재, commit/lock 시간 미확보. 수집은 이미 종료됐고 downstream 미완료와 별개. 내구성 완화 근거 없음 | 제외. query/transaction/인덱스 변경 없음 |

첫 변경은 busy guard를 없애거나 dispatch를 중첩 실행하지 않는다. interval 기본 모드는 보존하고 full batch continuation 모드를 명시적으로 선택하게 설계한다. 이 좁은 선택을 할 근거는 있으므로 추가 pilot을 선행 요구하지 않는다. 성능 효과는 아직 UNKNOWN이며 [상세 설계](design.md)의 동일 조건 비교를 통과하기 전 개선 완료를 선언하지 않는다. 271.872초 전체 제거를 약속하거나 그 비율로 성능 향상을 계산하지 않는다. 이는 E1-03 전체 속도 조절/적체 제어 기능의 완료도 아니다.

## 8. 재계산·검증 및 보존

분석은 저장 JSONL을 순차 읽어, monotonic interval의 union/intersection 및 nearest-rank 분위수를 계산했다. batch별 값은 CSV로 공개했고 SQL 소속은 고정 label call site + 포함 interval 후보로 남겼다. drop/error는 원래 coverage를 참조하며, 사후 추정으로 성공 관측을 새로 만들지 않았다. [offline-checks.json](offline-checks.json)은 합계·sequence·union 항등식·기존 coverage 계수·원시 해시 대조 결과다. 이는 재실행·제품 시험·성능 측정이 아니다.

재계산 절차: scan duration 기록과 count 기록 pair → 다음 scan 전까지 발행 묶기 → job 진입/성공 tx/후보 완료 pair → 시간구간 정렬/union/intersection → SQL label별 가능한 tx 후보 계산 → 인접 wall delta−mono delta와 전체 누적 차이 산출. observer snapshot은 원래 sample로만 세며 시간 보간하지 않는다. 분석용 임시 Python은 `/tmp/e1-analysis-20261104T082000/`에만 있고 SHA를 input-hashes.json에 남겼다. 제품/실행 도구 코드로 추가하지 않는다.

이번 문서 밖 제품 코드·설정·lock·migration·기존 보고서·원시 결과의 보존 확인은 [preservation.json](preservation.json)에 있다. 서비스·DB·Redis·단말에 접근하거나 재기동하지 않았고 pilot/resume/새 측정도 하지 않았다. 이번 새 문서와 작은 파생 JSON/CSV만 선택해 같은 브랜치에 commit한다.
