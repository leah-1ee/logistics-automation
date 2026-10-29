# CSV 독립 대사 메모리 개선 검증 — 2026-10-29

이 보고서는 `tools/audit-source.ts`의 실제 Olist 전체 대사 프로세스만을 대상으로 한다.
기존 MVP 판정·전체 수집 결과·F1 재생·하드웨어 시험 기록은 수정하지 않는다.
성능 수치는 이번 환경의 관측값이며 전체 서비스 메모리나 운영 처리량을 뜻하지 않는다.
검증한 구현·시험·측정 도구는 커밋 `92d6ba5`에 보존했다.

## 변경 전 병목과 선택

기준 구현은 CSV 파싱 후 orders/products의 전체 Map, sellers의 전체 Set,
전체 상품 행을 담은 itemsByOrder, 검증 완료 주문 Set을 실행 종료까지 유지했다.
DB의 상품 master와 일별/상품별 집계도 전체 배열로 조회했다.
raw 주문은 이미 200개 단위였지만, 해당 페이지의 모든 이벤트도 배열에 쌓였다.
정확한 기준은 [동결 코드](../../tools/benchmarks/audit-source-baseline.ts)와
[원본 커밋·SHA·유일한 메타데이터 변경](../../tools/benchmarks/audit-source-baseline.json)에 남겼다.
동결 코드는 자기 파일 SHA를 읽는 경로만 옮겼고 검증 알고리즘은 바꾸지 않았다.

CSV 정렬을 가정하는 병합 조인은 채택하지 않았다. 주문의 상품 행이 비연속으로
나타나는 경우와 중복 키를 처리해야 하기 때문이다. 설치된 Node 24의 SQLite를 사용해
파생 인덱스를 만들고, 기존 조회의 200주문 페이지와 결합하는 방식을 선택했다.
새 패키지·Docker 이미지·데이터 다운로드는 없었다.

- [CSV 인덱스](../../tools/audit-source-index.ts): 파일 해시·byte·행수를 스트리밍으로
  확인하며 SQLite에 저장한다. 상품/판매자 조회와 seen 표시는 인덱스에서 처리한다.
  전체 CSV를 다른 JS 배열/Map으로 옮기지 않는다.
- [독립 오라클](../../tools/audit-source.ts): MySQL master·이벤트·집계는 행 스트림으로
  받고, 현재 200주문의 정규화/작업 상품만 페이지 배열로 유지한다. 이벤트는 파생 DB에
  저장한 뒤 작업별로 순회하고, 역스캔 참조도 디스크에 둔다. 집계 결과와 JSON의 날짜
  목록도 전체 배열 대신 순회·기록한다. Source/normalize/reconcile/LocalStore를 호출하지 않는다.
- SQLite cache 목표 8MiB, mmap 0, temp_store FILE이다. **8MiB는 프로세스 메모리 제한이 아니다.**
  한 주문의 상품 행과 현재 페이지의 관계 행은 메모리에 올라온다. 따라서 최대 주문 크기와
  관계 fan-out에 영향을 받으며 임의의 큰 입력에 대해 상수 메모리를 보장하지 않는다.
- journal OFF/synchronous OFF는 재생성 가능한 **대사용 임시 DB에만** 사용한다.
  단말 이벤트 SQLite의 WAL/FULL·트랜잭션 규칙과 MySQL 커밋/ACK 구현은 변경하지 않았다.
  일반 실행은 성공·실패 후 이번 실행이 만든 임시 폴더만 정리한다. SIGKILL 뒤의 자동
  정리는 보장하지 않는다. 벤치마크에서는 관찰을 위해 `AUDIT_KEEP_TEMP=1`로 보존했다.

## 데이터·환경·보존

| 항목 | 이번 측정 조건 |
|---|---|
| 실제 원본 | Olist v2, 4 CSV 합계 35,647,734 bytes |
| 행 규모 | 주문 99,441 / 상품 행 112,650 / 상품 32,951 / 판매자 3,095 |
| 서버 업무 상태 | 작업 96,596 / 이벤트 4,260 / 확정 2,002 / 확정 순수 수량 2,254 |
| 분류 | TASK_CREATED 96,596 + DATA_HOLD 789 + UNSUPPORTED 2,056 = 99,441 |
| 검증 대상 run | `e7fb6a95-0d26-42b5-9305-5b559569b7da` |
| 개발 환경 | WSL Ubuntu 22.04 x86_64, 커널 6.18.54.1, 논리 CPU 20개 |
| 실행기 | Node v24.22.1, 동일 package-lock, tsx를 포함한 새 프로세스 |
| DB | 기존 Docker MySQL 8.4.13, buffer pool 134,217,728 bytes, REPEATABLE READ |
| DB 내구성 | innodb_flush_log_at_trx_commit=1, sync_binlog=1 유지 |
| 호스트 메모리 | MemTotal 16,150,404 KiB, SwapTotal 4,194,304 KiB |

[환경 JSON](environment.json)에 원본별 SHA/크기/읽기 전용 mode, lockfile SHA,
Docker 자원과 측정 전 서비스 스냅샷을 기록했다. 서비스 스냅샷은 최대 사용량 측정이 아니다.

새 DB `logistics_audit_bench_20261029`를 만들고 mysqldump의
single-transaction/quick/skip-lock-tables/no-tablespaces/set-gtid-purged=OFF와
skip-add-drop-table/skip-add-locks/skip-disable-keys로 기존 DB를 스트리밍 복제했다.
기존 이름이 있으면 중단하도록 확인했으며 DROP/TRUNCATE/기존 데이터 초기화는 하지 않았다.
벤치마크 계정에는 복제 DB의 SELECT를 부여했고 대사·지문 조회는 READ ONLY snapshot을 쓴다.
복제본은 22개 테이블, 실제 파일 논리 509,235,200 bytes / 할당 497,352 KiB이다.
이 **한 번의 시험 준비 공간**은 실행별 임시 공간과 분리했다. 복제본은 삭제하지 않았다.

[원 DB 사전 지문](original-before.json)과 [복제 DB 사전 지문](snapshot-before.json)은 같다.
지문은 검증에 쓰는 16개 업무 테이블의 PK 순서 전체 행을 스트리밍 해시한다.
실시간 단말 heartbeat와 검증에서 쓰지 않는 audit_logs는 범위 밖이다. 따라서 DB 전체 파일의
byte 불변을 주장하지 않는다. 지문 도구는 [별도 코드](../../tools/audit-db-fingerprint.ts)로 남겼다.
정확한 공통 SHA는 `a492633ec13b3e9a06c29e2a6275bd580bfacf7582a1982098ac7c68e413023e`이다.

[원 DB 사후 지문](original-after.json)과 [복제 DB 사후 지문](snapshot-after.json)도
같은 SHA였다. [보존 검사](preservation.json)는 원본 4 CSV와 기존 tracked 보고서125개의
크기/SHA 또는 SHA가 변하지 않았음을 확인한다. 비밀 설정·원본·파생 SQLite는 Git에서 제외했다.
[원본 ZIP 확인](archive-preservation.json)도 기존 다운로드 manifest의 SHA와 일치했다.

## 측정 방법

[실행별 측정기](../../tools/benchmark-audit.py), [Node 측정 preload](../../tools/audit-process-metrics.mjs),
[쌍 비교 실행기](../../tools/compare-audit-memory.py)를 사용했다.

1. 구현 변경 전에 기준 코드를 같은 원본·복제본에서 실행했다. [최초 측정](baseline-initial.json)은
   30.340초 / 최대 RSS 527,646,720 bytes / PASS였다. 이때 지문 조회와 겹친 구간과 캐시 상태 차이가
   있어 최종 시간 개선의 기준으로 사용하지 않는다.
2. 최종 비교는 양쪽 1회씩 준비 실행한 뒤 제외하고, 기준/개선 → 개선/기준 → 기준/개선
   순서로 3쌍을 **동시 실행 없이** 측정한다. 강제 OS/DB 캐시 비우기는 하지 않는다.
   실행마다 새 Node·새 임시/TS cache를 사용한다. 각 쌍 전후 DB 지문을 비교하며
   개별 시간 측정 중 지문·다른 시험을 병렬 실행하지 않는다.
3. RSS는 preload가 Linux `process.resourceUsage().maxRSS`를 읽은 프로세스 수명 최대값이다.
   JS heap만이 아니라 Node/네이티브 SQLite/로더를 포함하지만 MySQL·다른 서비스·Python 부모·
   esbuild 자식·OS 파일 cache는 제외한다. `--max-old-space-size`나 cgroup 메모리 제한은 걸지 않았다.
4. 시간은 명령 시작부터 종료 관찰까지의 wall time으로 로딩·CSV 인덱스 생성·전체 대사·
   결과 출력과 종료 감지 간격(약20ms)을 포함한다. 준비 DB 복제/지문 조회는 제외한다.
5. 실행별 TMPDIR 안 파일과 자식 프로세스가 연 삭제된 SQLite 임시 파일의 fd를 inode 중복 없이
   20ms마다 합산했다. **관측한 임시 디스크 최대값은 샘플링 하한**이며 짧은 spike를 놓칠 수 있다.
   최종 잔존량도 따로 기록했다. 원본·MySQL 서버 임시 공간·복제 DB 저장 공간은 이 수치에서 제외한다.

최종 수치와 각 실행 결과는 [최종 쌍 비교](paired-final/comparison.json)에 기록한다.
각 실행 JSON의 codeBefore/codeUnchangedDuringInvocation과 별도 감사 JSON의 oracle/sourceIndex SHA로
측정 중 소스가 바뀌지 않았음을 확인한다. 감사 JSON의 codeCommit은 측정 당시 기준 HEAD이며,
아직 커밋 전인 구현은 파일 SHA가 식별한다.

최종 3쌍 모두 전체 대사 PASS, 의미 결과 동일, 각 쌍 전후 DB 지문 동일이었다.

| 지표 | 기준: 최소 / 중앙 / 최대 | 개선: 최소 / 중앙 / 최대 |
|---|---:|---:|
| 최대 Node RSS (MiB) | 497.723 / 505.008 / 509.156 | 250.629 / 251.457 / 253.812 |
| 실행 시간 (초) | 8.930 / 9.081 / 9.150 | 13.398 / 13.416 / 13.471 |
| 관측 임시 할당 최대 (MiB) | 0.027 / 0.027 / 0.031 | 73.941 / 73.949 / 73.949 |
| 종료 후 임시 잔존 할당 (MiB) | 0.027 / 0.027 / 0.027 | 58.668 / 58.668 / 58.668 |

중앙값 기준 최대 RSS는 **50.21% 감소**했고, 실행 시간은 **47.73% 증가**했다.
메모리 목표에는 효과가 있었지만 더 빨라진 도구로 보고하지 않는다. SQLite 삽입·인덱스 생성·
행 해시 및 랜덤 조회 비용과 약 73.95MiB의 관측 임시 디스크 최대값을 지불한다.
개선의 중앙 RSS는 263,671,808 bytes, 기준은 529,539,072 bytes다. 종료 시 파생 인덱스
논리 크기는 61,476,864 bytes였고, 실행 디렉터리의 할당 크기에는 TS cache도 포함된다.

이번 실제 데이터의 관측 최대치는 주문당 상품 행21개, raw 페이지200행, 현재 페이지의
정규화 상품217행/작업 상품211행, 페이지 이벤트25개였다. 계수한 MySQL 문장은2,004개였다
(정리용 ROLLBACK 제외).
실제 4 CSV의 중복/부모 key 상충은 모두0이었다. 진단은
[개선 실행 감사](paired-final/round1-disk-indexed-audit.json)의 bounds/sourceKeyDiagnostics를 참고한다.

| 쌍 | 기준 시간 (초) | 개선 시간 (초) | 기준 RSS (MiB) | 개선 RSS (MiB) |
|---|---:|---:|---:|---:|
| 1 | 9.081 | 13.398 | 509.156 | 251.457 |
| 2 | 9.150 | 13.471 | 497.723 | 250.629 |
| 3 | 8.930 | 13.416 | 505.008 | 253.812 |

## 정확성 및 손상 비교

실제 전체 대사의 비교는 주문 99,441개, 적격 작업 96,596개, 주문-상품 수량 98,840개,
기존 이벤트 4,260개·확정 2,002개 및 전체 일별/상품별 집계를 포함한다.
이 작업에서 새 1,000건 시뮬레이션이나 이벤트를 추가한 것은 아니다.

[최종 비교 사례 JSON](regression-cases-final.json)과
[전체 통합 실행 결과](integration-final.tap)는 격리된 `logistics_test`와 새 SYNTHETIC CSV만 사용했다.
실제 원본·원 DB·고정 복제본에는 손상을 주입하지 않았다. 각 변경을 복구한 후 최종 정상 재검사도 했다.

| 비교 결과 | 사례 수 | 근거와 의미 |
|---|---:|---|
| 둘 다 PASS, 의미 결과 동일 | 6 | 정상 혼합 분류/역스캔/완료, 4 CSV 역순, 동일 부모 key·내용 반복 3종, 손상 복구 후 정상 |
| 둘 다 손상 거부 | 30 | 원본 누락/변경, raw hash/내용, 분류, 정규화/작업 수량, master, 작업 누락/추가, 이벤트/스냅샷/집계/outbox/checkpoint |
| 기준 PASS → 개선 FAIL | 7 | 부모 key 상충 3종 + 각 CSV manifest 행수 오류 4종. 아래 추가 검출 근거 참고 |

30개 기존 오류 중 정상 JSON으로 실패하던 경우는 오류 코드와 건수까지 동일함을 확인했다.
원본 파일 누락·과거 해시로 내용 변경의 2개는 기준이 JSON 없이 종료했고,
개선은 `RAW_FILE_UNAVAILABLE` / `RAW_FILE_FINGERPRINT` 등 구조화된 실패를 남겼다.
모든 손상 사례는 단순한 `AUDIT_ABORTED` 런타임 오류로 통과시키지 않았다.

7개 추가 검출은 정확성의 의도적 보강이다. 기준 Map은 같은 부모 key에서 마지막 값만 남기고
seller Set은 다른 열을 버려, 정상 행 앞의 상충 행을 숨겼다. 새 도구는 모든 행을 디스크에
보존하고 전체 파싱 행 SHA의 차이를 `SOURCE_KEY_CONFLICT_*`로 보고한다. seller 사례는
합성의 부가 열에만 차이를 준 것으로 실제 판매자 데이터 손상을 발견했다는 뜻이 아니다.
manifest byte/SHA가 올바르고 DB 등록 manifest도 같아도 rowCount가 잘못되면 기존은 놓쳤다.
새 도구는 실제 파싱 행수와 대조해 `SOURCE_ROW_COUNT`로 실패한다.

같은 부모 key·같은 내용은 기존 재수집 계약에 따라 허용하고 중복 행 통계만 기록한다.
상품 행 key 반복은 `INVALID_ITEM_KEY`에 따른 DATA_HOLD가 정확하면 대사 PASS이다.
이미 적재한 정상 주문에 상품 행을 몰래 추가한 경우는 내용/분류/수량 불일치로 양쪽 모두 거부한다.
이는 [검증 명세 보완](../../docs/06_verification.md) 및 기존 05 문서의 재수집 규칙을 따른다.

## 회귀 시험과 기록의 범위

| 시험 | 실행 결과 | 증거 |
|---|---|---|
| TypeScript + Vite build | PASS | [최종 빌드 로그](build-final.txt), 기존 번들 크기 경고는 남아 있음 |
| 단위 시험 | 17 PASS / 0 FAIL | [최종 단위 로그](unit-final.tap) |
| MySQL/Redis 통합 시험 | 23 PASS / 0 FAIL | [최종 통합 로그](integration-final.tap), 이 안의 1 test가 위 43사례를 비교 |
| 실제 서비스 장애/복구 | PASS | [서비스 장애 결과](service-faults.json): T20 Redis 중단 중 DB 커밋/ACK, T21 outbox→BullMQ 복구, T23/T31 MySQL 중단 시 ACK 금지·SQLite 복구 |
| 기존 도구의 실제 전체 대사 | PASS / 오류0 | [재실행 로그](legacy-reconcile-retry.txt), [기존 형식 결과](legacy-current/reconciliation-e7fb6a95-0d26-42b5-9305-5b559569b7da.json) |
| 문서 계약 | PASS | [문서 검사 결과](documents-final.txt) |
| Git 민감정보/금지 경로 검사 | PASS | [검사 결과](git-safety.json), 알려진 패턴 및 로컬 비밀값16개와 비교한 범위 |
| 컴파일된 JS 실행/정리 | PASS | [실제 전체 대사](compiled-audit.json), [코드 SHA·결과·보존 교차 확인](completion-checks.json) |
| 최종 서비스 readiness | PASS | [정의된 /api/v1/ready 응답](services-after.json): database/redis up |

통합 시험에는 커밋 경계 SIGKILL, 동시 중복 반영 1회, 이벤트 순서·fencing·역스캔,
API 응답 유실, 로컬 SQLite 복구, Redis delivery 소실 뒤 DB outbox 재구축,
기존 reconcile의 일관된 서버 손상 거부가 포함된다. 서비스 장애 시험은 이번 작업 중
대사 도구의 중복 진단 정책을 최종 조정하기 전에 실행했으며 운영 이벤트 코드는 바꾸지 않았다.
서비스는 시험 후 복구했다. 하드웨어 시험은 이번에 실행하지 않았다.

측정 종료 뒤 이어서 작업할 때 기존 서비스5개가 중지된 상태여서 기존 대사의 첫 실행은
`ECONNREFUSED`로 실패했다([실패 로그](legacy-reconcile.txt)). 중지 원인은 이 기록만으로
확인하지 않았다. 기존 컨테이너/볼륨 그대로 시작하고 재실행해 위 PASS와 사후 지문을 얻었다.
실패 시도를 PASS로 세거나 성능 표본에 포함하지 않았다.

## 재현

실제 원본과 원 DB/비밀 설정은 Git에 포함하지 않는다. 아래 명령은 설치된 Node24,
같은 lockfile·원본 SHA·run 및 **별도로 만든 새 고정 DB**와 `.env.olist`가 준비된 경우이다.
배포용 DB를 초기화하거나 같은 이름의 보고서를 덮어쓰지 말고 새 출력 디렉터리를 사용한다.

```bash
export PATH="$PWD/.tools/node-v24.22.1-linux-x64/bin:$PATH"
# 일상적인 대사는 매 실행 임시 인덱스를 만들고 정리한다.
AUDIT_OUTPUT=reports/new-source-audit.json node --import tsx --env-file=.env.olist tools/audit-source.ts
# 고정 복제 DB를 확인하고 새 경로로 반복 측정한다.
python3 tools/compare-audit-memory.py --database YOUR_NEW_FROZEN_DB \
  --reference reports/audit-memory-2026-10-29/snapshot-before.json \
  --output-dir reports/YOUR_NEW_MEASUREMENTS --work-dir var/YOUR_NEW_MEASUREMENTS
# 손상 주입은 .env.test의 logistics_test만 허용한다.
node --import tsx --env-file=.env.test --test --test-concurrency=1 tests/integration/audit-memory.test.ts
```

다른 run/DB의 비교는 먼저 그 고정 DB의 지문을 새 파일에 저장해 `--reference`로 지정해야 한다.
지문이 달라지거나 검사 결과가 다르면 비교 실행기는 실패한다. 이번 복제 DB를 자동 삭제하거나
운영 DB를 변경하는 명령은 측정 도구에 없다.

## 보존한 중간 기록과 한계

`baseline-initial*`는 개선 전 최초 관측, `candidate-smoke*`는 초기 구현의 전체 실행이다.
`paired/`는 **최종 중복 계약 조정 전** 3쌍 결과이며 `paired-final/`과 혼합하지 않는다.
`corruption-comparison*`, `regression-cases.json`은 초기 32/36사례 검증 기록이다.
처음에는 동일 부모 key 반복도 무조건 실패시키는 방향이었으나 기존 재수집 계약을 다시
대조해 그 정책을 철회하고, 최종 43사례에서 동일 반복 허용/상충 거부를 구분했다.
중간 기록을 삭제하거나 최종 결과로 위장하지 않았다. `contract-cases*`는 같은 최종 코드의
단독 실행이고 최종 회귀 집계는 `regression-cases-final.json`을 사용한다.

한 호스트·한 고정 데이터에서 3쌍 관측한 결과다. 전체 서비스 메모리·OS 파일 cache·
장시간 부하·100만 파생 주문·cgroup 제한·OOM 임계값·Raspberry Pi에서의 성능은 **NOT_RUN**이다.
revision>1은 기존과 같이 별도 검토가 필요한 실패로 유지했다. 임의로 수 GB인 단일 CSV 행이나
단일 주문의 초대형 fan-out에 대한 상한도 검증하지 않았다. SQLite 임시 저장으로 메모리의
일부를 디스크/파일 cache로 옮겼으므로 호스트 전체 메모리가 같은 비율로 줄었다고 해석하지 않는다.
