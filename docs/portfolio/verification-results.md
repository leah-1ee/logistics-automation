# 9~11. 검증·성능·결과·한계

[개요](README.md) · [설계/구현](architecture.md) · [STAR 문제 해결](troubleshooting.md)

## 9. 테스트 및 검증

이 문서는 기존 실행 산출물을 대조한 설명서다. **문서 작성 중 새 업무/장비/부하 시험을
실행한 결과가 아니다.** 별도 [근거 대조 JSON](evidence-checks.json)은 수치·파일/링크·상태
추적 검사이며 제품 시험 PASS를 새로 부여하지 않는다.

상태 의미는 PASS=명시된 조건에서 기대 결과 관측, FAIL=당시 실패 관측,
BLOCKED=필수 확인 경로 미완료/차단, NOT_RUN=실행 증거 없음이다. 의도적으로 손상시킨
입력에서 도구가 FAIL한 것은 거부 동작을 기대한 **검증 시험의 PASS**일 수 있다.
[원 판정 기준](../06_verification.md)

### 9.1 입력·행동·검증 대상 구분

| 구분 | 실제/생성 데이터 | 확인 범위 |
|---|---|---|
| Olist 원본 F2 | 실제 과거 주문·상품·판매자 CSV, 모의 Source API와 생성 작업 | 전체 수집·분류·작업 생성·수량·이벤트·집계 대사. 전체 주문을 사람이 스캔한 시험 아님 |
| 실제 입력 F1 2회 | 각각 실제 적격1,000주문을 고정 선정, 배정/스캔/유실은 소프트웨어 생성 | 기능·중복·응답 유실 복구. 실제 물류 현장 기록 아님 |
| 보조 합성1,000작업 | seed42 고정 fixture, 상품·입력 생성 | 도메인 불변 조건. 실제 Olist F1/F2 대체 불가 |
| 실제 Pi2작업 | 실제 Olist 적격 작업, 저장 C270 정상 사진 해독→검증 폼 입력 | 장비 SQLite·UI·정상 재부팅·오프라인·서버 확정. 오류 형식/다른 상품은 합성 문자열 |
| 대사 손상43사례 | 새 SYNTHETIC CSV + 격리 logistics_test run | 기존/개선 도구 결과 비교. 실제 원본·원 DB·고정 성능 복제본 손상 없음 |

근거: [F1 도구](../../tools/replay-actual.ts), [보조 합성 결과](../../reports/synthetic-1000.json),
[장비 기록](../../reports/hardware-validation.md), [43사례 코드](../../tests/integration/audit-memory.test.ts).

### 9.2 전체99,441주문 대사 — 정확성 PASS

원본은 ZIP44,717,580bytes, MVP4CSV 합계35,647,734bytes다. 원본 ZIP/CSV와 준비 인덱스는
Git 밖에 보존하고 manifest에 파일 SHA/행수/관계를 기록했다. CSV는 주문99,441개,
상품 행112,650개, 상품32,951개, 판매자3,095개다.
[manifest](../../manifests/olist-v2.json), [ZIP/CRC 원 검증](../../reports/independent-2026-10-28/source-archive.json),
[최근 ZIP 보존](../../reports/audit-memory-2026-10-29/archive-preservation.json)

| 항목 | 실제 대사 결과 | 의미 |
|---|---:|---|
| TASK_CREATED | 96,596 | 적격 주문/생성 작업 |
| DATA_HOLD | 789 | 데이터 검증 보류, 작업 미생성 |
| UNSUPPORTED | 2,056 | MVP 미지원, 작업 미생성 |
| 합계 | 99,441 | 원본 전체 주문과 일치 |
| 작업별 상품 수량 검사 | 98,840 | 작업-상품 항목 수. 주문 수·상품 행 수와 다른 분모 |
| 최신 누적 확인 이벤트 | 4,260 | 두 F1과 실제 Pi 후속 시험을 포함한 이 run의 저장 이벤트 |
| 최신 누적 확정 / 순수 수량 | 2,002 / 2,254 | 실제 물품 출고 실적이 아닌 프로젝트 업무 확정 |
| 미완료 outbox / 대사 오류 | 0 / 0 | 검사 시점의 결과 |

최신 전체 검증은 원본→raw payload/hash→분류·정규화 수량→적격 작업/스냅샷→event seq/hash/
receipt·순수 효과→확정 날짜→일별/상품별 집계와 누락/추가 행을 확인한다.
[최근 감사 결과](../../reports/audit-memory-2026-10-29/paired-final/round1-disk-indexed-audit.json),
[검증 구현](../../tools/audit-source.ts), [기존 대사 회귀 결과](../../reports/audit-memory-2026-10-29/legacy-current/reconciliation-e7fb6a95-0d26-42b5-9305-5b559569b7da.json)

분류 사유 예시는 DATA_HOLD 내 NO_ITEMS775·승인 시각 결측/오류160,
UNSUPPORTED 내 MULTIPLE_SELLERS1,278·UNSUPPORTED_SOURCE_STATUS779다.
사유는 중첩될 수 있어 합해서 보류/미지원 주문 수를 만들면 안 된다. 미지원 source 상태는
취소만을 뜻하지 않으므로779를 원본 전체 취소 주문 수로 쓰지 않는다. category 누락 flag1,451도
상품 개수가 아닌 해당 서버 **주문의 flag 집계**다.
[사유/flag 원 집계](../../reports/audit-memory-2026-10-29/legacy-current/reconciliation-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[분류 로직](../../src/ingestion/normalize.ts)

### 9.3 실제 입력 F1 두 번과 합성 재생

공통 개발 환경은 WSL2/Node24/MySQL·Redis/파일 SQLite다. 기존 환경 기록의 실제 F1 구성은
워커1·동시성1·배치200·MySQL buffer pool512MiB다. 장애/응답 유실은 정해진 시험 절차로
생성했다. [환경](../../reports/environment.md), [재생 코드](../../tools/replay-actual.ts)

| 지표 | 실제 입력 F1 최초 | 실제 입력 F1 독립 재검증 | 보조 합성 재생 |
|---|---:|---:|---:|
| 상태 | PASS | PASS | PASS(보조 범위) |
| 작업 수 | 1,000 | 1,000 | 1,000 |
| 순수 수량 | 1,117 | 1,134 | 3,000 |
| 고유 이벤트 | 2,117 | 2,134 | 4,000 |
| 전달 시도 | 2,332 | 2,350 | 4,400 |
| 성공 응답 의도적 유실 | 100 | 100 | 같은 정의의 수치 없음 |
| DUPLICATE 관측 | 215 | 216 | 400 |
| 최종 미전송 | 0 | 0 | 0 |
| 기록된 경과 시간 | 361.024초 | 400.253초 | 271.641초 |

각 근거: [최초 F1](../../reports/f1-e7fb6a95-0d26-42b5-9305-5b559569b7da.json)·
[최초 로컬 receipt](../../reports/f1-local-audit-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[새 F1](../../reports/f1-e7fb6a95-0d26-42b5-9305-5b559569b7da-independent-20261028.json)·
[새 로컬 receipt](../../reports/independent-2026-10-28/f1-local.json),
[합성 결과](../../reports/synthetic-1000.json).
실제 입력 F1은 ACK별 DB hash·수량/상태/집계를 확인했고, 새 trial은 이전 plan/SQLite/보고서를
보존했다. [이전 산출물 지문](../../reports/independent-2026-10-28/prior-f1-artifact-hashes.json)

두 F1은 상품 구성과 시점/코드가 달라 **속도 전후 비교 실험이 아니다**. 전달은 고유 이벤트보다
많지만 중복 receipt는 중복 효과 건수가 아니다. 응답을 잃은100건이 추가 재전송과 함께
포함되므로 전달·유실·중복 수를 서로 더해 고유 이벤트 수로 만들지 않는다.
누적 수치는 1,000+1,000+Pi2=2,002작업, 1,117+1,134+3=2,254개,
2,117+2,134+9=4,260이벤트로 연결된다.

### 9.4 기능·안정성·검증 정확성 시험

| 분류·ID | 입력 / 환경 / 방법 | 기록된 결과·범위 | 상태 |
|---|---|---|---|
| 계약/기능 | OpenAPI+예시, Node의 기존 문서/단위 검사 | 29operations/44schemas/6known answers; 최신 단위17개 | PASS |
| T01~T07/T30/T32 | 합성 run·실제 MySQL, 페이지 재수집/충돌/체크포인트/배정/정정·rollback | 원본 불변, 작업1개, 버전/스냅샷 유지 | PASS |
| T09~T13/T34 | 파일 SQLite, 스캔/취소/완료·예외·SIGKILL·늦은 ACK | event/state/seq 복원, 이후 로컬 입력 보존 | PASS |
| T14~T19/T23/T25 | 실제 HTTP·MySQL, COMMIT 보류/실패, 동시8요청, 부분 배치 API SIGKILL, seq/버전/시간대 | ACK 경계·중복 효과1회·업무 오류 격리·응답 유실 복구 | PASS |
| T20~T22 | 이 프로젝트 실제 Redis/MySQL/워커, 서비스 중단·delivery 소실·lease 만료 재발행 | DB outbox에서 작업 복구, 반복 후 작업1개 | PASS |
| T24/T26/T31/T33 | MySQL/HTTP, 완료·집계 반복/권한·origin/목록·CSV/재시도 예산 | 확정만 집계, 임시/영구 오류 구분, ready503/degraded | PASS |
| 실제 운영 UI | Windows Chrome156 headless·React·loopback API·격리 합성54주문 | 50+4페이지·상세/변경/관측·CSV/저장소9검사와 DB 대조 | PASS |
| 대사43사례 | 격리 CSV/logistics_test, 동결 기준/개선 도구를 같은 손상 상태에 실행 | 6정상 동일PASS, 30손상 양쪽 거부, 7추가 검출 | PASS |
| 과거 결함 재현 | 별도 합성 DB의 시간대/단독 손상/확정 snapshot 등 | 과거 FAIL과 수정 후 PASS 보존, 현재 결과와 구분 | FAIL(과거 기록)→수정 후 PASS |

주요 근거: [최종 단위17](../../reports/audit-memory-2026-10-29/unit-final.tap),
[통합23](../../reports/audit-memory-2026-10-29/integration-final.tap),
[서비스 장애](../../reports/audit-memory-2026-10-29/service-faults.json),
[COMMIT 시험](../../tests/integration/commit-boundary.test.ts),
[SIGKILL 시험](../../tests/integration/crash.test.ts), [Redis 복구 시험](../../tests/integration/redis.test.ts),
[43사례 결과](../../reports/audit-memory-2026-10-29/regression-cases-final.json),
[UI9검사](../../reports/hardware-2026-10-28/admin-browser-final.json)·[DB 대조](../../reports/hardware-2026-10-28/admin-browser-db.json).

통합23개 중1개가43사례 비교를 수행하므로 시험 수를23+43으로 합쳐 ‘66개 통합 시험’이라고
쓰지 않는다. 각 T01~T34의 개별 최신 판정은 [상세표](../../reports/independent-2026-10-28/verification.md)로 연결한다.
‘독립’은 업무 모듈과 별도 오라클/새 검증 절차라는 의미다. 외부 전문가·별도 모델 검증은 아니다.

### 9.5 실제 Pi·웹캠 검증

장비는 Pi5 Model B Rev1.1·Debian13 arm64·Node24.22.1·C270이다.
Chromium154와 V4L2 경로에서 실제 카메라 스트림을 관측했다.
[preflight](../../reports/hardware-2026-10-28/preflight.json), [장비 보고서](../../reports/hardware-validation.md)

| 입력·방법 | 결과 | 상태 |
|---|---|---|
| C270 USB/V4L2 열거, 실제1280×720 브라우저 스트림 | 장치/영상 확인 | PASS |
| 실제 C270 정상 QR 사진1장 해독 | 선택 상품과 일치, 사진229,118bytes | PASS |
| 저장 사진 해독 결과를 실제 Pi 검증 폼에 입력 | 2작업·9고유 사건·순수수량3, 최종 ACK/서버 hash 일치·미전송0 | PASS(사진/폼 범위) |
| 합성 잘못된 형식/다른 상품, 실제 UI의 초과·취소·완료 | 경고·정상 seq 불변·수량/완료 제한 확인 | PASS(합성 오류 입력 범위) |
| 서버 터널만 중단, 로컬 완료 뒤 사용자 정상 reboot | boot ID 변경, pending5·수량2·취소 이력·hash/seq/snapshot 복원·SQLite integrity ok | PASS |
| 터널 복구·UI 수동 재시도 | LOCAL_COMPLETED/RETRYING→SERVER_CONFIRMED/SYNCED | PASS |
| 실시간 웹캠 버튼으로 정상/오류 QR 광학 처리 | 실제 스트림은 열렸으나 QR이 프레임에 없어 성공 이벤트 미확인 | BLOCKED |
| 물리 HDMI 모니터 | 사용자가 연결 불가, VNC 관찰 선택 | NOT_RUN |
| 실제 전원 차단·SD 손상 | 정상 재부팅과 다른 시험, 실행 증거 없음 | NOT_RUN |

[정상 사진](../../reports/hardware-2026-10-28/photo-valid.json),
[재부팅 전후](../../reports/hardware-2026-10-28/reboot.json),
[최종 로컬/서버](../../reports/hardware-2026-10-28/local-server-checks.json),
[실시간 영상 관측](../../reports/hardware-2026-10-28/live-valid-720p.json).
원본 사진·토큰·주소는 Git에 포함하지 않았다. 사진 해독은 진단 도구로 수행하며 그 도구 자체는
업무 이벤트를 생성하지 않는다. [사진 진단](../../tools/verify-camera-photo.mjs), [브라우저 검증](../../tools/verify-device-browser.mjs)

### 9.6 현재 완료 판정과 기록 충돌의 처리

35요구 **34 PASS/1 BLOCKED**, T34개 **32 PASS/2 BLOCKED**, 전체 MVP는 미완료다.
남은 요구는 M-E01, 시험은 T08/T29의 실시간 QR 경로다. 이 집계의 FAIL0/NOT_RUN0을
모든 잠재 시험·모든 환경에 대한 성공으로 해석하지 않는다.
[최신 판정](../../reports/verification.md), [전체 상세표](../../reports/independent-2026-10-28/verification.md)

초기 README 첫머리/환경 문서는 장비 전체 BLOCKED라고 남았으나 후속 장비 보고서에서는
사진·영상·재부팅이 부분 PASS다. 초기 stage 기록과 옛 F1 파일의 hardware 필드는 당시
상태다. 기존 기록을 덮어쓰지 않고 **항목별 최신 실제 증거**로 해석했다.
단말201번째 페이지의 실제 브라우저 조작은 별도 NOT_RUN이며,
headless 운영 UI PASS는 수동 사용자 시연·영상 촬영 PASS와 다르다.
[IV-03 한계](troubleshooting.md), [운영 UI 검증 범위](../../reports/browser-validation.md)

## 10. 성능 및 결과

### 10.1 대사 도구 전후 비교

입력은 같은4CSV/35,647,734bytes와 같은 업무 DB를 복제한 고정 schema다. 업무 지문이
사전·사후/각 쌍 전후에 같았다. 환경은 WSL2 x86_64·논리CPU20·Node24.22.1·Docker MySQL8.4.13,
관측 DB buffer pool128MiB다. **과거 F1의512MiB 설정 기록과 이 측정 환경을 혼합하지 않는다.**
[측정 환경](../../reports/audit-memory-2026-10-29/environment.json), [최종 쌍 비교](../../reports/audit-memory-2026-10-29/paired-final/comparison.json)

양쪽 준비 실행1회씩 제외 후 기준/개선→개선/기준→기준/개선으로3쌍을 순차 실행했다.
캐시를 강제로 비우지 않았고, 매번 새 Node/임시 디렉터리를 썼다. 같은 시간대에 다른 시험이나
지문 조회를 병렬 수행하지 않았다. 기준은 [동결 전 코드](../../tools/benchmarks/audit-source-baseline.ts)이고,
구현 중 수정한 소스는 커밋명 대신 실제 SHA로도 고정했다.
[측정 절차 상세](../../reports/audit-memory-2026-10-29/README.md), [측정기](../../tools/benchmark-audit.py)

| 지표 | 기존 최소 / 중앙 / 최대 | 개선 최소 / 중앙 / 최대 |
|---|---:|---:|
| 최대 Node RSS(MiB) | 497.723 / 505.008 / 509.156 | 250.629 / 251.457 / 253.812 |
| wall time(초) | 8.930 / 9.081 / 9.150 | 13.398 / 13.416 / 13.471 |
| 관측 임시 할당 최대(MiB) | 0.027 / 0.027 / 0.031 | 73.941 / 73.949 / 73.949 |
| 종료 후 보존된 임시 할당(MiB) | 0.027 / 0.027 / 0.027 | 58.668 / 58.668 / 58.668 |

중앙값 기준 **RSS50.21% 감소 / 시간47.73% 증가**다. 추가 I/O·인덱스·행 해시 비용을
지불해 대사 프로세스 메모리를 줄인 결과다. 임시 디스크는20ms 샘플의 **관측 하한**이며,
종료 후 잔존량은 benchmark가 의도적으로 보존한 값이다. 일반 실행은 자기 임시 인덱스를 정리한다.
한 번 만든 DB 복제본의509,235,200bytes 논리 공간은 실행별 임시 디스크에서 제외했다.
[정확한 byte·표본](../../reports/audit-memory-2026-10-29/paired-final/comparison.json),
[일반/컴파일 실행 정리 확인](../../reports/audit-memory-2026-10-29/completion-checks.json)

RSS는 Linux Node 프로세스 수명 최대이며 네이티브 SQLite·TS 로딩을 포함한다.
MySQL/다른 서비스·Python sampler·esbuild 자식·OS 파일 cache는 제외했다.
전체 서비스/호스트 메모리 절감, 임의 메모리 상한 내 동작, 처리량 증가를 주장하지 않는다.
초기30.340초 실행은 캐시/겹친 지문 부하가 달라 기준 시간으로 쓰지 않았고,
중간 prototype `paired/`와 최종 `paired-final/`도 분리했다.

### 10.2 입증한 결과와 쓰지 않을 성과

입증한 것은 전체 주문 대응/수량/분류/집계의 정확성, 지정한 장애·중복 조건의 복구,
실제 장비의 제한된 입력·재부팅 범위, 대사 프로세스 RSS 절감이다.
실제 기업 연동·출고량·사용자 수·운영 시간 절감·수동 대비 자동화 효율·TPS/p95/p99 개선은
**측정 기록이 없어 성과로 쓰지 않는다**. F1 경과 시간을 나누어 기업 처리량으로 환산하지 않는다.
[PRD의 가설과 측정 규칙](../01_product_prd.md), [원본 검증 규칙](../06_verification.md)

## 11. 한계 및 개선 방향

아래는 제안이며 실행 결과가 아니다. MVP 광학 gate 전에는 08의 운영 확장 완료를 주장하지 않는다.
대사 메모리 개선은 사용자가 별도로 요청한 검증 도구 보완이며 E1 제품 확장 완료가 아니다.

| 미완료/제약 | 현재 상태 | 후속 작업·이유 |
|---|---|---|
| 정상·오류 QR 실시간 버튼 경로 | BLOCKED | 짧은 광학 시험에서 프레임에 QR 전체를 담고 버튼 입력 전후 seq/수량/경고·서버 효과를 확인. 사진 폼과 분리 |
| 단말201번째 작업의 실제 UI | NOT_RUN | 합성201개 이상을 격리 단말에 배정해 다음/이전·선택 경쟁까지 브라우저 확인 |
| 물리 HDMI·수동 시연 영상 | NOT_RUN | 필요하면 사용자 연결/동의 범위에서 진행. VNC·headless와 구분 |
| 전원 차단·SD 파손 | NOT_RUN | 복제 시험 매체/백업·영향 확인이 선행되어야 함. 정상 reboot 결과로 대체 불가 |
| 제한 메모리 전체 대사 | NOT_RUN | 같은 원본·고정 DB에서 대사 프로세스만 cgroup 제한(예:512→384→256MiB), 성공/최대RSS/시간/디스크·OOM 여부·정확성을 각3회 확인. 현재 수치로 성공을 예측하지 않음 |
| 이벤트 이력 증가·단일 주문 fan-out | NOT_RUN | 원본은 보존하고 격리 DB의 파생 입력 규모를 늘려 페이지/주문 최대와 scratch 사용을 관측. 현재 오라클도 한 주문/페이지 관계 행은 메모리에 유지 |
| F3 압축 유입/F4 파생100만 주문 | NOT_RUN | 원본과 파생을 구분하고 key remap·관계/분류 대사 후 유입률/대기열·복구 시간을 측정. 검증 장비 공간/다운로드 조건 먼저 확인 |
| 서버·단말 메모리 확장성 | NOT_RUN | 대사 최적화가 수집기 master Set·단말 전체 pending/projection의 메모리 구조까지 개선한 것은 아님. [수집](../../src/ingestion/ingest.ts)·[로컬](../../src/device/store.ts)·[동기화](../../src/device/sync.ts) 각각 측정 필요 |
| 다중 단말·재배정/실제 외부 연동 | 범위 밖/미구현 | 소유권·정정/만료·접근 권한 정책 후 별도 계약/회귀 필요 |
| 개인정보/보안·공개 배포 | 개발용 범위 | loopback·토큰·기본 권한은 시험했으나 외부 배포/종합 보안 감사는 미실행 |
| 사용자 생산성·운영 효과 | 미측정 | 같은 작업/입력·순서 교차·총 시간/실패/수정 비용을 포함한 비교가 필요. 과거 개발 시간은 지금 소급 측정할 수 없음 |

[후속 범위 원문](../08_extensions.md), [장비 절차](../../reports/hardware-validation.md),
[대사 측정 한계](../../reports/audit-memory-2026-10-29/README.md), [개인 기여 확인](contribution-ai.md)
