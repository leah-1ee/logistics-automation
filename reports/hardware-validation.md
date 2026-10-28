# 실제 장비 검증 — BLOCKED

기준일: 2026-10-28 Asia/Seoul. Raspberry Pi·모니터·웹캠·SD 미연결.
아래는 실행 절차이며 실행 결과가 아니다. WSL의 SQLite/프로세스 시험이나
QR 문자열 encode/decode를 실제 웹캠·보드 시험의 PASS로 옮기지 않는다.

## 연결 전 기록

실제 Pi 모델, RAM, OS/커널/아키텍처, SD 모델·여유 공간, 전원, USB 웹캠 모델,
브라우저 버전과 Node 버전을 기록한다. Node24 ARM64와 해당 OS의 호환성을 확인한다.
새 OS/Node/패키지는 크기와 저장 공간을 먼저 확인하고, 개별1GB 초과 또는 크기 미확인은 승인 후 받는다.

개발 API는 127.0.0.1:3000에만 바인딩되어 있어 Pi에서 개발 PC의 LAN 주소로 직접 접근할 수 없다.
이미 SSH로 접근 가능하고 그 호스트에서 API loopback에 접속할 수 있다면 Pi에서 다음 터널을 사용한다.
SSH 설치·방화벽·Windows/WSL 경로 변경은 실제 호스트를 확인한 뒤 별도로 진행한다.

```bash
ssh -N -L 3000:127.0.0.1:3000 <사용자>@<API_loopback에_접근_가능한_호스트>
```

Pi의 별도 비공개 환경 파일에 SERVER_URL=http://127.0.0.1:3000,
DEVICE_ID/DEVICE_TOKEN, 시험할 DATASET_RUN_ID, DEVICE_DB, LOCAL_ORIGIN을 설정한다.
토큰은 Git/QR/화면 캡처에 넣지 않는다. 기존 SQLite를 삭제하거나 다른 단말 ID로 덮어쓰지 않는다.
Node 경로·사용자·WorkingDirectory·EnvironmentFile을 확인해 deploy/logistics-device.service를 적용한다.
브라우저에서 http://127.0.0.1:3200/device 를 열고 웹캠 사용을 허용한다.

## 실행 순서와 증거

실제 run에서 아직 CREATED인 시험 작업을 선택하고 운영 화면에서 최초 배정한다.
`node --import tsx --env-file=.env.olist tools/qr-labels.ts --task-id <작업_UUID>`로
선택 작업의 프로젝트 QR을 출력한다. F1에서 이미 확정한 작업은 재배정하지 않는다.

| 시험 | 기대 결과 | 현재 결과 |
|---|---|---|
| T08 정상 QR·연속 입력 | 버튼 한 번에 1개, 필요한 수량까지 별도 eventId/seq | BLOCKED |
| T08 잘못된 QR·없는 상품·초과 | 경고, 업무 수량과 정상 seq 불변 | BLOCKED |
| T10/T11 취소·재취소·부족 완료 | 취소 1회만 반영, 음수 방지, 부족 완료 차단 | BLOCKED |
| T13/T29 서버 연결 중단 후 작업 | 이미 받은 작업 계속 처리, LOCAL_COMPLETED/PENDING 유지 | BLOCKED |
| T12/T29 Pi 재시작 | SQLite event/state/seq와 미전송 사건 복원 | BLOCKED |
| T14/T29 연결 복구·재전송 | MySQL 커밋 뒤 ACK, 업무 1회 반영, SERVER_CONFIRMED | BLOCKED |
| T24/T29 최종 대사 | 로컬/서버 수량·receipt·확정 상태·일별 보고서 일치 | BLOCKED |

네트워크 단절은 위 SSH 터널 중단으로 시험할 수 있다. 로컬 agent와 SQLite는 유지한다.
재시도5회 예산을 소진했다면 연결 복구 후 단말 화면에서 수동 재시도를 누른다.
정상 재부팅부터 실행하고 실제 전원 차단/SD 손상은 별도 대상·영향 확인 후 수행한다.
시험마다 시각·작업/단말 ID·코드 commit·원본/scenario 해시·DB/SQLite 결과·영상 경로를 기록한다.
영상과 증거에서 토큰·개인정보·원본 행이 노출되지 않게 검토한다.
모든 필수 gate가 통과하기 전 전체 MVP 완료·mvp-v1 tag·08 확장은 보류한다.
