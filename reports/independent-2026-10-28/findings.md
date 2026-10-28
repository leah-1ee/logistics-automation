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
