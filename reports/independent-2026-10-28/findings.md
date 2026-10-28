# 독립 재검증 결함 기록

기준 구현: 5f7cbfb. 기존 보고서의 PASS를 새 실행 증거로 취급하지 않았다.
원본 명세를 읽고 별도 경계 조건과 직접 CSV 대사를 추가했다.
동일 프로젝트의 새 검증 실행이며 외부 인력/별도 모델의 검증을 뜻하지 않는다.

## IV-01 — UTC가 아닌 DB 세션에서 확정 시각·업무일 변동 (수정)

대상: M-S01/M-S04/M-A06, T25. 기존 UNIX_TIMESTAMP(UTC_TIMESTAMP(3))는
이미 UTC인 값을 세션의 현지 시각으로 다시 해석한다. 실제 DB 세션 +09:00에서
-32,400,000ms, -05:00에서 +18,000,000ms 오차를 재현했다.
2026-10-28T15:30Z 경계에서 기대한 한국 업무일은 10월29일이나 기존 코드는
확정 시각을06:30Z로 잘못 기록했다. 기존 T25는 단말 시각 차이만 검사하여 누락했다.

수정: UTC epoch와 UTC_TIMESTAMP(3)의 마이크로초 차이를 계산한다.
ACK를 MySQL COMMIT 이후 반환하는 경계는 유지한다. 전역 DB 시간대는 변경하지 않았다.
회귀: server-clock-before.tap FAIL1 → server-clock-after.tap PASS1.
시험은 전용 DB의 합성 작업 및 시험 전용 연결의 세션 설정만 사용했다.
원래 UTC 세션으로 실행한 실제 Olist 기록에는 이 재현 오차를 소급 적용하지 않는다.
근거: timezone-before.jsonl, tests/integration/server-clock.test.ts.
공식 의미: https://dev.mysql.com/doc/refman/8.4/en/date-and-time-functions.html

## IV-02 — 카메라 권한 대기 중 작업 변경/중지 후 잘못된 작업에 입력 가능 (수정)

대상: M-E01/M-E02/M-W04, T08 소프트웨어 경계. 기존 콜백은 인식 시작 시점의
작업이 아니라 변경 가능한 active.current로 전송했다. 아직 controls가 반환되지 않은
권한 대기 상태에서는 중지/작업 변경도 늦게 생성되는 스트림을 무효화하지 못했다.
인식 세대와 taskId를 고정하고 오래된 콜백/늦은 스트림/두 번째 프레임을 버린다.
모의 카메라 콜백3시나리오 PASS. C270 입력·브라우저 실제 권한 동작은 BLOCKED.

## IV-03 — 단말 목록에서 201번째 이후 작업에 도달할 수 없음 (수정)

대상: 단말 다중 작업 조회/M-W04. 로컬 API는 cursor를 반환했지만 화면은 항상
첫200개만 읽고 페이지 이동을 제공하지 않았다. 다음/처음200건 이동을 추가했다.
늦은 상세 조회가 새로 선택한 작업을 덮어쓰지 않도록 요청 당시 taskId도 확인한다.
번들 build PASS; 실제 브라우저 페이지 조작은 NOT_RUN.

## IV-04 — raw hash·정규화 수량 단독 손상을 기존 대사가 PASS (수정)

대상: M-D01/M-D02/M-W01, T28. 기존 도구는 CSV와 서버 payload/task만 비교하여
raw_orders.payload_hash 또는 order_items.required_qty 단독 손상을 놓쳤다.
새 CSV 직접 오라클은 이를 검출했으며 기존 대사에도 두 검사를 추가했다.
source-integrity-before.tap의 기존 도구 false-PASS 재현 → after.tap PASS.
실제 원본/실제 run을 손상시키지 않고 별도 DB의 새 SYNTHETIC run에서만 주입했다.

## 검증 장치 자체의 실패/한계

COMMIT 보류 어댑터가 mysql2 Query를 Promise 반환값으로 취급한 실패와
오래된 로컬 fixture에 외부 manifest가 있다고 가정한 경로 실패는 시험 장치 오류였다.
각각 수정 후 새로 통과했으며 제품 결함으로 세지 않는다. harness-before TAP에 보존했다.
샌드박스 자식 격리 실행에서 camera 시험이 시나리오 없이 파일1개만 통과로 나타났다.
그 결과는 사용하지 않고 허용된 실행에서 개별3개 시나리오를 확인해 camera.tap에 저장했다.

## IV-05 — 새 단말에서 확정 작업이 미처리로 다시 보임 (수정)

대상: M-W04/M-E08/M-S08, T07/T13/T14. 새 스냅샷 목록에 CONFIRMED도 포함하여
로컬 이력이 없는 단말에서 DOWNLOADED/수량0으로 나타날 수 있었다.
새 다운로드에서만 CONFIRMED를 제외한다. 기존 로컬 snapshot/event는 삭제하지 않는다.
COMPLETE 성공 ACK를 잃은 단말은 목록이 비어도 보존 이벤트를 재전송하여
DUPLICATE receipt로 SERVER_CONFIRMED를 복구한다. before FAIL → after PASS,
최종 전체22개 회귀도 PASS다.

## 기존 검증 판정의 공백

화면 수용 기준9개는 기존 API/build PASS만으로 실제 UI 조작을 통과했다고 볼 수 없어
이번 요구사항 표에서 NOT_RUN으로 판정했다. 실제 Pi/C2702요구는 BLOCKED다.
원본 해시/분류·이벤트·ACK·수량의24개 소프트웨어 요구는 새 실행 증거로 PASS다.

추가 시험 장치 보완: 병렬2파일 실행에서 합성 run 간 InnoDB deadlock이 발생해
문서화된 동시성1로 다시 실행했다. 후속 전체 시험에서 준비 job1개가 PENDING/attempt0으로
남아 첫 대사가 FAIL했다. processJob 한 번 호출만으로 drain을 가정한 fixture를 고쳐
제한 시간 내 실제 DONE을 확인했다. 이 실패를 숨기지 않고 최종22PASS와 구분한다.
source HTTP 오라클의 잘못된400 기대도 계약의 CURSOR_RUN_MISMATCH409로 바로잡았다.

## IV-06 — 실제 단말의 해결된 동기화 오류가 화면에 잔류 (수정)

대상 M-E02/M-E08, 실제 Pi UI. 서버 복구 후 SQLite는 SERVER_CONFIRMED/SYNCED,
미전송0인데 화면 경고는 RETRY_BUDGET_EXHAUSTED였다. refresh는 syncError가 있을
때만 공용 error를 갱신해 성공 뒤 이전 오류가 남았고 입력 오류도 폴링에 덮일 수 있었다.
입력 error와 syncError를 분리하고 성공 조회에서 syncError를 비운다. 입력 오류를 우선 표시한다.
실제 Pi의 수정 전 sync-warning-before.json, 수정 후 sync-warning-after.json 및
input-warning-after-poll.json으로 확인했다. 경로는 ../hardware-2026-10-28/ 아래다.
API 응답 계약·SQLite·ACK 규칙은 변경하지 않았다.

## IV-07 — 운영 화면 job 재시도 성공 뒤 상세가 FAILED로 잔류 (수정)

대상 M-A04. 실제 Chrome156 headless/격리 logistics_test에서 재시도 후 DB는
PENDING/attempt0인데 상세는 FAILED/attempt5이고 재시도 버튼도 활성 상태였다.
변경 핸들러가 task/order만 다시 조회하고 job 상세를 갱신하지 않았다.
기존 retry API의 반환 Job으로 상세도 갱신한다. API 계약 변경은 필요하지 않았다.
admin-browser-before.json의 실제 실패와 admin-job-stale-detail-before.json/
admin-job-server-before.json에 전후 불일치를 보존했다. 최종 admin-browser-final.json의
M-A04와 admin-browser-db.json에서 실제 UI·DB·반복 job의 단일 작업 생성까지 확인했다.

## 후속 검증 하네스·환경 이력

최초2개 합성 장치 관측에 DeviceStatusReport 필수 필드를 빠뜨려 단말 화면 응답이
INVALID_SCHEMA였다. 제품 실패로 세지 않고 fixture에 validate를 추가했다. 직접 만든
테스트 장치2행만 계약에 맞게 보완했으며 기존 주문/run/job 이력은 삭제하지 않았다.
admin-browser-after.json, admin-fixture-adjustment.json에 남겼다.

Windows PowerShell의 stderr 인코딩과 CDP 다운로드 설정의 연결 수명 때문에 마지막
CSV 단계가 실패했다. 이를 숨기지 않고 admin-browser-csv-attempt.json에 남겼다.
같은 연결에서 다운로드 정책·사용자 클릭·완료 대기를 실행하고 실제 파일2행과 SHA256을
확인했다. 최종9개 UI 검사 PASS는 이전7개 실행 결과와 재실행한 CSV/저장소 검사를
동일 run/source hash로 연결한다. 최초 제품 실패를 임의 PASS로 덮어쓴 것이 아니다.

Pi Chromium은 권한 granted 상태에서도 장치 열거가 대기했다. V4L2 실행 설정 뒤
실제 C270 장치·1280×720 영상이 관측됐다. 실제 광학 QR 버튼은 프레임에 QR이 없어
성공을 확인하지 못했다. 저장 사진의 해독 성공으로 이 gate를 PASS 처리하지 않는다.
실제 Pi 정상 재부팅/사진 기반 오프라인 복구와 실제 headless UI를 추가해 요구사항
판정은 현재34 PASS/1 BLOCKED이며, 초기24 PASS/9 NOT_RUN/2 BLOCKED 기록과 구분한다.
