# MVP 검증 판정 — 독립 코드·실행·실제 장비 결과

2026-10-28 Asia/Seoul. **전체 MVP 미완료**: 실시간 웹캠 QR 최종 시연이 남았다.

[요구사항35개·T01~T34 상세표](independent-2026-10-28/verification.md)와
[결함/실패 이력](independent-2026-10-28/findings.md)을 기준으로 판정한다.
기존5f7cbfb의 PASS를 재사용하지 않고 새로 실행·대조했고, 이전 문서는 Git 이력에 보존했다.

- 요구사항: **34 PASS / 1 BLOCKED / FAIL0 / NOT_RUN0**. 남은 항목은 M-E01의 실시간 QR 입력이다.
- T01~T34: **32 PASS / 2 BLOCKED**. T08/T29의 광학 QR 버튼 경로를 사진 입력으로 대신하지 않았다.
- 단위17개·DB/HTTP22개·계약29operations/44schemas/6known answers·build PASS.
- 실제 Chrome156 headless 운영 화면9검사와 변경 결과 DB 대조 PASS.
  API/build만으로 UI를 통과했다고 쓰지 않았다. 수동 조작/시연 영상은 별도 미실행이다.
- 실제 Pi5/C270 사진 QR 해독·1280×720 브라우저 영상·정상 재부팅·SQLite 복원 PASS.
  사진 해독→소프트웨어 폼 입력과 실시간 웹캠 버튼을 구분한다.
- 실제 Pi 작업2건/순수수량3/9사건 모두 서버 확정, 미전송0·로컬/서버 hash 일치.
- Olist ZIP CRC/SHA256·4CSV 확인, 원본99,441주문/112,650행/96,596작업/98,840수량항목 대사 PASS.
- 새 F1 실제 주문1,000건 모의 업무:수량1,134/2,134사건/응답 유실100/DUPLICATE216/미전송0.
  이전 F1 파일/plan/SQLite는 보존했다. 실제 Pi 스캔으로 표시하지 않았다.
- 최종 실제 run 누적: **2,002확정/수량2,254/4,260사건**, 전수 대사 불일치0·미완료 job0.
  운영 UI 시험은 별도 logistics_test의 명시적 합성 run으로 실제 Olist와 섞지 않았다.

독립 검증 중 결함7건을 수정했다. DB 세션 시간대 확정 시각, 카메라 늦은 콜백,
단말 페이지 이동, 대사의 손상 누락, 확정 스냅샷 재노출에 이어 실제 UI 검증에서
동기화 경고 잔류와 job 재시도 상세 잔류를 발견·수정했다. 실패 전후 근거를 보존했다.

주요 증거:
[실제 Pi·사진·재부팅 결과](hardware-validation.md),
[최종 브라우저](hardware-2026-10-28/admin-browser-final.json),
[브라우저 변경 DB 대조](hardware-2026-10-28/admin-browser-db.json),
[실제 Pi 정상 재부팅](hardware-2026-10-28/reboot.json),
[단말/서버 사건 지문 대조](hardware-2026-10-28/local-server-checks.json),
[최종 직접 CSV 전수 대사](hardware-2026-10-28/source-after-hardware.json),
[최종 단위](hardware-2026-10-28/unit-final.tap),
[DB/HTTP 통합](independent-2026-10-28/integration-verified.tap),
[Redis/MySQL 실제 장애](independent-2026-10-28/service-faults.json),
[새 F1 응답 유실](f1-e7fb6a95-0d26-42b5-9305-5b559569b7da-independent-20261028.json).

물리 HDMI는 사용자 선택 VNC로 관찰했으며 HDMI 자체는 NOT_RUN이다. 전원 차단·SD 손상도
NOT_RUN이다. 이를 정상 재부팅 PASS로 확대하지 않는다. 사진·키·토큰·주소·원본 데이터는
Git에 넣지 않았다. 실시간 광학 gate 완료 전 mvp-v1 태그·08확장은 실행하지 않는다.
