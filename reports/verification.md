# MVP 검증 판정 — 독립 재검증 반영

기준일:2026-10-28 (Asia/Seoul). **전체 MVP 미완료**.

최신 상세 판정은 [독립 재검증 요구사항·T01~T34 표](independent-2026-10-28/verification.md)와
[발견 결함·수정/실패 이력](independent-2026-10-28/findings.md)에 기록했다.
기존5f7cbfb의 PASS를 신뢰하는 대신 코드와 새 실행을 대조했다.
초기 검증 보고서 원문은 Git5f7cbfb 이력에 보존되어 있다.

- 새 단위17개·DB/HTTP22개·계약 검사·build PASS.
- T01~T34:32 PASS, 실제 웹캠 T08·Pi재시작/시연 T29 BLOCKED.
- 요구사항35개:24 PASS, 화면 조작9개 NOT_RUN, 실제 장비2개 BLOCKED.
  API/build PASS를 실제 브라우저 수용 조건으로 확대하지 않았다.
- 실제 ZIP CRC/SHA256 및4CSV 지문 재확인 PASS.
- 직접 CSV 오라클:99,441주문·112,650상품행·96,596작업·98,840수량항목 PASS.
- 새 실제 주문1,000건 모의 업무:수량1,134·2,134사건·전달2,350·유실100회·
  DUPLICATE216·미전송0. 이전 F1의 plan/SQLite/보고서 hash는 불변이다.
- 누적 확정2,000작업/2,251수량의 상태·이벤트·서버/로컬 수량·일별/상품별 집계 일치.

수정한 결함은 DB세션 시간대에 따른 확정 시각 오류, 늦은 카메라 콜백의 잘못된 작업 반영,
단말201번째 이후 조회 부재, raw hash/정규화 수량 손상 false-PASS,
확정 작업의 새 단말 미처리 재노출이다. 관련 실패/수정 후 시험을 별도로 보존했다.

증거:
[단위](independent-2026-10-28/unit-final.tap),
[최종 통합](independent-2026-10-28/integration-verified.tap),
[실제 서비스 장애](independent-2026-10-28/service-faults.json),
[직접 CSV 전수 대사](independent-2026-10-28/source-final.json),
[기존 대사 도구 보강 결과](independent-2026-10-28/reconciliation-e7fb6a95-0d26-42b5-9305-5b559569b7da.json),
[새 F1](f1-e7fb6a95-0d26-42b5-9305-5b559569b7da-independent-20261028.json),
[로컬 ACK·원래 F1 보존](independent-2026-10-28/f1-local.json).

실제 Pi/C270 점검은 [장비 절차](hardware-validation.md)를 따른다.
현재 사용자 제공 SSH 서버에는 도달했으나 인증 등록이 진행 중이다.
WSL 파일 SQLite·SIGKILL·모의 카메라 결과를 실제 Pi/SD/웹캠 PASS로 기록하지 않는다.
실제 브라우저·현장 영상·Pi 재부팅이 끝나기 전 mvp-v1 태그나08확장은 실행하지 않는다.
