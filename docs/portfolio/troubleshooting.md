# 8. 트러블슈팅 — STAR와 증거 범위

[개요](README.md) · [설계/결정](architecture.md) · [최신 검증](verification-results.md)

각 사례는 S(증상/상황)→T(해결 목표)→A(원인/해결)→R(검증/결과) 순서다.
‘재발 방지’는 저장소에 추가된 검사·구조를 뜻하며 미래 무결함의 보장은 아니다.
기준은 [독립 결함 기록 IV-01~07](../../reports/independent-2026-10-28/findings.md)이고,
제품 결함, 검증 도구 결함, 환경 문제, 성능 개선을 별도로 표시했다.

## 8.1 IV-01 확정 시각의 시간대 재해석 — 제품 결함

- **S·증상:** DB 세션 +09:00에서 기대 확정 시각15:30Z가06:30Z로 저장됐다.
  기존 T25는 단말 시계만 바꿨기에 DB 세션 시간대 오류를 놓쳤다.
- **T·목표:** 단말/DB 세션 설정과 무관하게 같은 UTC 확정 시각·한국 업무일을 얻고 ACK 경계는 유지한다.
- **A·원인:** `UNIX_TIMESTAMP(UTC_TIMESTAMP(3))`가 이미 UTC인 값을 세션 현지 시각으로 다시 해석했다.
  UTC epoch와 UTC_TIMESTAMP의 마이크로초 차이로 계산하도록 수정했다. 전역 DB 시간대는 바꾸지 않았다.
- **R·검증:** 합성 작업의 전용 DB 세션 ±시간대·업무일 경계에서
  [수정 전 FAIL1](../../reports/independent-2026-10-28/server-clock-before.tap) →
  [수정 후 PASS1](../../reports/independent-2026-10-28/server-clock-after.tap).
  원래 UTC 세션으로 처리한 Olist 과거 기록이 모두 잘못됐다는 뜻은 아니다.
- **재발 방지:** [시간대 회귀 시험](../../tests/integration/server-clock.test.ts)을 남겼다.
  [코드](../../src/sync/events.ts), [수정 커밋 b4d4894](https://github.com/leah-1ee/logistics-automation/commit/b4d4894).

## 8.2 IV-02 늦은 카메라 콜백이 다른 작업에 입력 — 제품 결함

- **S·증상:** 코드 검토에서 권한 대기·작업 변경 뒤 콜백이 변경 가능한 active 작업을 참조하는 경로를 확인했다.
  실제로 다른 작업에 잘못 스캔된 C270 사건을 관측한 기록은 아니다.
- **T·목표:** 인식을 시작한 작업과 인식 세대를 고정하고, 중지 후 늦게 열린 스트림을 폐기한다.
- **A·원인/해결:** 반환 전 controls가 없어 중지할 수 없는 구간과 가변 task 참조가 문제였다.
  taskId·generation·한 번 소비 여부를 고정하고 오래된 프레임/스트림을 중지하도록 바꿨다.
- **R·검증:** [모의 카메라 콜백3시나리오 PASS](../../reports/independent-2026-10-28/camera.tap).
  수정 전 FAIL TAP은 이 사례에 따로 남아 있지 않다. 실시간 광학 gate는 계속 BLOCKED다.
- **재발 방지:** [OneShotCamera](../../web/camera.ts), [회귀 시험](../../tests/camera.test.ts),
  [수정 커밋 fa920ce](https://github.com/leah-1ee/logistics-automation/commit/fa920ce).

## 8.3 IV-03 단말에서 201번째 작업 접근 불가 — 제품의 UI 누락

- **S·증상:** 로컬 API는 nextCursor를 반환하지만 화면은 첫200개만 읽는 코드였다.
- **T·목표:** 배정 작업의 다음 페이지로 이동하고 늦은 상세 응답이 새 선택을 덮지 않게 한다.
- **A·원인/해결:** 다음/처음200건 이동 UI를 추가하고 상세 요청 당시 taskId를 확인했다.
- **R·검증:** 번들 build PASS와 변경 코드가 있다. **수정 전 실행 실패 및 실제 단말 브라우저의
  201번째 작업 이동 전후 비교는 NOT_RUN**이다. 운영 어드민54건 페이지 시험은 다른 화면/분모다.
- **재발 방지 범위:** 페이지 이동·선택 응답 확인 로직은 남았으나 이 대규모 단말 UI 경로의
  자동 브라우저 회귀는 추가 필요다. [화면 코드](../../web/main.tsx),
  [결함 기록](../../reports/independent-2026-10-28/findings.md),
  [변경 커밋 fa920ce](https://github.com/leah-1ee/logistics-automation/commit/fa920ce).

## 8.4 IV-04 서버 일부 손상에도 대사 PASS — 검증 도구 결함

- **S·증상:** raw payload hash 또는 정규화 상품 수량만 바꾸면 기존 대사는 종료0/PASS였다.
  서버 payload와 task가 함께 틀린 경우에도 같은 오류를 정답처럼 재사용할 위험이 있었다.
- **T·목표:** 원본 CSV를 독립 정답으로 사용하고 단독 손상과 일관된 projection 손상을 거부한다.
- **A·원인/해결:** 기존 대사에 빠진 raw canonical hash·정규화 수량 검사를 추가했다.
  Source/normalize/기존 reconcile을 호출하지 않는 별도 CSV 오라클도 만들었다.
- **R·검증:** 격리 SYNTHETIC run에서 [수정 전 false-PASS를 드러낸 실패](../../reports/independent-2026-10-28/source-integrity-before.tap) →
  [수정 후 PASS](../../reports/independent-2026-10-28/source-integrity-after.tap).
  실제 원본/원 DB에 손상을 주입하지 않았다.
- **재발 방지:** [단독 손상 시험](../../tests/integration/source-integrity.test.ts),
  [일관된 손상 시험](../../tests/integration/reconciliation.test.ts),
  [기존 대사](../../tools/reconcile.ts), [직접 CSV 대사](../../tools/audit-source.ts),
  [수정 커밋 8afc8b9](https://github.com/leah-1ee/logistics-automation/commit/8afc8b9).

## 8.5 IV-05 확정 작업이 새 단말에 미처리로 재노출 — 제품 결함

- **S·증상:** 서버 CONFIRMED 작업이 새 snapshot 목록에 포함되어 로컬 이력 없는 단말에서
  DOWNLOADED/수량0으로 다시 보일 수 있었다. [수정 전 FAIL](../../reports/independent-2026-10-28/snapshot-lifecycle-before.tap)
- **T·목표:** 새 작업 노출은 막되 COMPLETE ACK를 잃은 기존 단말의 복구 경로를 유지한다.
- **A·원인/해결:** 새 다운로드에서 CONFIRMED만 제외한다. 목록에서 없어졌다는 이유로
  이미 보관한 로컬 snapshot/event를 삭제하지 않고 동일 COMPLETE를 재전송한다.
- **R·검증:** 새 목록0건, 기존 pending1/LOCAL_COMPLETED 보존, DUPLICATE receipt 후
  pending0/SERVER_CONFIRMED·이벤트4건 유지가 [수정 후 PASS](../../reports/independent-2026-10-28/snapshot-lifecycle-after.tap).
- **재발 방지:** [snapshot lifecycle 시험](../../tests/integration/snapshot-lifecycle.test.ts),
  [API](../../src/operations/api.ts), [수정 커밋 a48377f](https://github.com/leah-1ee/logistics-automation/commit/a48377f).

## 8.6 IV-06 복구 후 동기화 경고가 남음 — 실제 Pi에서 확인한 제품 결함

- **S·증상:** 실제 Pi SQLite는 SERVER_CONFIRMED/SYNCED·미전송0인데 화면에는
  RETRY_BUDGET_EXHAUSTED가 남았다. [수정 전 화면 관측](../../reports/hardware-2026-10-28/sync-warning-before.json)
- **T·목표:** 복구된 동기화 오류는 지우고, 별도 입력 오류는 폴링이 덮지 않도록 한다.
- **A·원인/해결:** refresh가 syncError가 있을 때만 공용 error를 갱신했다.
  입력 error/syncError를 분리하고 성공 조회에서 syncError를 비우며 입력 경고를 우선 표시했다.
- **R·검증:** [복구 후 화면](../../reports/hardware-2026-10-28/sync-warning-after.json)과
  [폴링 후 입력 경고](../../reports/hardware-2026-10-28/input-warning-after-poll.json),
  [단말/서버 최종 대조](../../reports/hardware-2026-10-28/local-server-checks.json) PASS.
  정상 입력은 저장 C270 사진 해독→폼 입력이었고 실시간 버튼 성공으로 확대하지 않는다.
- **재발 방지:** 분리된 UI 상태와 [브라우저 진단 도구](../../tools/verify-device-browser.mjs),
  [수정 코드](../../web/main.tsx), [커밋 d7afe65](https://github.com/leah-1ee/logistics-automation/commit/d7afe65).
  UI 증거는 같은 실제 장비 실행 조건의 관측이며 모든 환경의 자동 회귀 보장은 아니다.

## 8.7 IV-07 job 재시도 후 상세가 FAILED로 잔류 — 제품 결함

- **S·증상:** 실제 headless Chrome에서 재시도 후 DB는 PENDING/attempt0인데 상세는
  FAILED/attempt5와 활성 재시도 버튼을 표시했다.
  [UI 전 상태](../../reports/hardware-2026-10-28/admin-job-stale-detail-before.json),
  [서버 상태](../../reports/hardware-2026-10-28/admin-job-server-before.json)
- **T·목표:** 재시도 성공 뒤 화면 상세도 API의 새 job 상태와 일치시킨다.
- **A·원인/해결:** 변경 핸들러가 task/order만 다시 조회했다. retry API가 반환한 Job으로
  상세를 갱신했다. 서버 계약이나 DB 업무 의미는 바꾸지 않았다.
- **R·검증:** [최종9개 UI 검사 M-A04](../../reports/hardware-2026-10-28/admin-browser-final.json)와
  [DB 직접 대조·동일 job 반복 처리](../../reports/hardware-2026-10-28/admin-browser-db.json) PASS.
  데이터는 logistics_test의 합성 run이며 실제 Olist 운영 화면 시험으로 혼동하지 않는다.
- **재발 방지:** [브라우저 검증 절차](../../reports/browser-validation.md),
  [검증 driver](../../tools/verify-admin-browser.py), [UI](../../web/main.tsx),
  [커밋 d7afe65](https://github.com/leah-1ee/logistics-automation/commit/d7afe65).

## 8.8 실제 수집의 원본 식별자 OR 조회 — 성능 병목/구현 수정

- **S·상황:** 실제 Olist 수집 중 원본 식별자와 external ID를 OR로 조회하는 계획이
  run/source 후보를 반복 탐색했다. 계획상 estimatedRows는7,233이었다.
- **T·목표:** 원본/체크포인트를 초기화하지 않고 두 식별자의 중복·교차 충돌을 모두 보존한다.
- **A·해결:** 두 유일 키의 정확 조회를 분리하고 양쪽 결과를 합쳐 각각 상충을 보존했다.
- **R·검증:** [실행 계획 기록](../../reports/olist-query-plan-2026-10-28.json)은 ref→const,
  조회별 estimatedRows1을 남겼다. 이는 **옵티마이저 추정치**이며 7,233배 속도 개선이 아니다.
  [수집 충돌 시험](../../tests/integration/ingestion.test.ts)과 후속 전체 대사를 통과했다.
  통제된 시간/처리량 전후 비교는 없으므로 속도 개선율은 기록하지 않는다.
- **재발 방지:** [정확 조회 코드](../../src/ingestion/ingest.ts),
  [커밋 f502a6e](https://github.com/leah-1ee/logistics-automation/commit/f502a6e), 원본/충돌 회귀.

## 8.9 대사 메모리 개선과 중복 정책 재검토 — 성능 개선/검증 보강

- **S·상황:** 직접 CSV 오라클이 전체 행·seen·master·집계를 JS 컬렉션으로 보관했다.
  개선 전 최초 RSS 관측과, 최종 같은 환경 기준 구현의 반복 결과를 모두 보존했다.
- **T·목표:** 실제 원본/DB 상태와 검증 범위를 유지하며 최대 Node RSS를 줄인다.
- **A·해결:** SQLite 임시 인덱스, 200주문 관계 조회, master/event/집계 스트림으로 바꿨다.
  초기 ‘모든 중복 key는 FAIL’ 정책은 기존 같은key/같은내용 재수집 계약과 충돌해 철회했다.
  동일 반복은 통계만 남기고 부모 key 내용 상충/manifest 행수 오류를 추가 실패로 구분했다.
- **R·검증:** 같은 원본/고정 DB·양쪽 warmup1회 제외·교차순서3쌍에서 RSS 중앙50.21% 감소,
  시간47.73% 증가, 관측 임시 최대 중앙73.949MiB. 정상 대사 결과는 동일했다.
  [최종 비교](../../reports/audit-memory-2026-10-29/paired-final/comparison.json),
  [43사례](../../reports/audit-memory-2026-10-29/regression-cases-final.json).
- **재발 방지:** 기준 코드 동결·소스 SHA 고정·DB 지문 전후 비교·비정렬/동일 중복/상충/손상
  비교 시험을 남겼다. 초기32/36사례와 prototype 측정도 별도 보존했다.
  [정책/한계 기록](../../reports/audit-memory-2026-10-29/README.md),
  [구현·시험 커밋 92d6ba5](https://github.com/leah-1ee/logistics-automation/commit/92d6ba5).

## 8.10 제품 결함으로 세지 않은 시험 도구·환경 문제

아래는 실제 실패 기록이지만 IV-01~07의 제품 결함 수와 합산하지 않는다.

| S·증상 | T/A·원인 및 조치 | R·실행 근거·재발 방지 |
|---|---|---|
| COMMIT 보류 시험 어댑터 실패 | mysql2 Query를 Promise처럼 취급한 테스트 어댑터 수정 | [실패](../../reports/independent-2026-10-28/commit-boundary-harness-before.tap)와 [정상 경계 시험](../../reports/independent-2026-10-28/commit-boundary.tap) 분리 |
| 준비 job이 PENDING인데 대사 시작 | processJob 한 번 호출을 drain으로 가정한 fixture 수정, 실제 DONE까지 제한시간 대기 | [실패 기록](../../reports/independent-2026-10-28/source-regression.tap), [회귀](../../reports/independent-2026-10-28/source-regression-after.tap), [drain helper](../../src/verification/drain.ts), [커밋0077431](https://github.com/leah-1ee/logistics-automation/commit/0077431) |
| 초기 CI/fixture 실패 | seed 누락·생성 manifest와 보존 예시 경로 충돌을 수정 | [진행 기록](../../reports/progress.md), [커밋756f21d](https://github.com/leah-1ee/logistics-automation/commit/756f21d). 이 파일 묶음에는 초기 CI 원격 로그 전체가 없어 세부 전후 로그는 확인 필요 |
| UI fixture가 INVALID_SCHEMA | 합성 DeviceStatusReport 필수 필드 누락, fixture 검증/관측 보완 | [조정 기록](../../reports/hardware-2026-10-28/admin-fixture-adjustment.json), [최종 실행](../../reports/hardware-2026-10-28/admin-browser-final.json) |
| CSV 브라우저 시험 실패 | PowerShell 출력 인코딩·CDP 연결 수명 문제. 같은 연결에서 다운로드 정책/클릭/완료 확인 | [실패 시도](../../reports/hardware-2026-10-28/admin-browser-csv-attempt.json), [재현 방법](../../reports/browser-validation.md), 최종 CSV2행/SHA 확인 |
| Pi 카메라 열거 대기 | 전용 Chromium에서 V4L2 설정 후 장치·1280×720 스트림 관측 | [비교](../../reports/hardware-2026-10-28/camera-v4l2-comparison.json), [실행 스크립트](../../deploy/start-device-browser.sh). 모든 PipeWire 문제의 원인을 입증하지 않음 |
| QR 사진에 코드가 없거나 잘림 | 사용자 카메라 방향/QR 표시 조정 후 저장 사진에서 해독 성공 | [최초 실패](../../reports/hardware-2026-10-28/photo-initial.json), [성공](../../reports/hardware-2026-10-28/photo-valid.json). 실시간 광학 시험은 여전히 BLOCKED |
| 마지막 기존 대사에서 DB 연결 거절 | 측정 후 서비스가 중지된 상태를 관측해 기존 컨테이너/볼륨 그대로 재시작 | [실패](../../reports/audit-memory-2026-10-29/legacy-reconcile.txt)와 [재실행](../../reports/audit-memory-2026-10-29/legacy-reconcile-retry.txt). 중지 원인은 확인되지 않음 |

검증 자체가 잘못될 수 있다는 점은 실제 도구 실패를 통해 드러났다. 이를 없던 일로 하거나
제품 안정성 성과로 바꾸지 않고, 입력 계약·실제 commit/DONE·실행 시나리오 수·관측 범위를
확인하는 방식으로 보완했다. [상세 원 기록](../../reports/independent-2026-10-28/findings.md)
