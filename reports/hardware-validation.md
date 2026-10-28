# 실제 Pi·C270 검증 — 부분 PASS, 실시간 QR 최종 gate BLOCKED

2026-10-28 Asia/Seoul. 실제 장비 관측·사진 입력·합성 오류 입력·실시간 영상을 구분한다.
전체 MVP 완료나 실제 실시간 스캔 성공을 선언하지 않는다.

## 실제로 확인한 항목

| 항목 | 판정 | 근거·범위 |
|---|---|---|
| SSH·Pi 모델/OS | PASS | Pi5 Model B Rev1.1, Debian13 arm64, kernel6.18.50; [preflight](hardware-2026-10-28/preflight.json) |
| Node·SQLite·단말 서비스 | PASS | 공식 Node24.22.1 ARM64 SHA256 확인, 사용자 서비스·내장 SQLite·health200; [설치](hardware-2026-10-28/runtime-install.json) |
| C270 USB·V4L2 | PASS | 046d:0825, /dev/video0=uvcvideo 캡처/스트리밍, /dev/video1은 메타데이터 |
| 실제 C270 정상 QR 사진 | PASS | 1280×720/229,118bytes, 실제 선택 상품 일치; [사진 지문](hardware-2026-10-28/photo-valid.json) |
| Chromium C270 장치/영상 | PASS | Chromium154에서 실제 C270 1280×720 스트림; [V4L2 비교](hardware-2026-10-28/camera-v4l2-comparison.json), [영상 관측](hardware-2026-10-28/live-valid-720p.json) |
| 실시간 웹캠 버튼의 정상·오류 QR 처리 | BLOCKED | 실제 스트림은 열렸으나 QR이 프레임에 없어 이벤트 증가 없음. 저장 사진 입력을 이 시험 PASS로 대신하지 않음 |
| 실제 Pi UI의 수량·오류·취소·완료 | PASS | 정상은 저장 C270 사진→소프트웨어 입력 폼, 형식/다른 상품은 합성 문자열; [첫 순서 시험](hardware-2026-10-28/photo-ui-sequence.json), [수정 후 순서 시험](hardware-2026-10-28/ui-after-fix-offline-sequence.json) |
| 실제 Pi 정상 재부팅·SQLite 복원 | PASS | boot ID 변경, 이벤트5건 hash/seq·취소·수량2·미전송 상태·snapshot 동일, integrity=ok; [재부팅](hardware-2026-10-28/reboot.json) |
| 실제 Pi 오프라인 완료/복구 | PASS | LOCAL_COMPLETED/RETRYING과 pending5 보존, 수동 재시도 후 SERVER_CONFIRMED/SYNCED; [재시도 UI](hardware-2026-10-28/manual-retry-ui.json), [수정 후 최종 UI](hardware-2026-10-28/sync-warning-after.json) |
| 단말↔MySQL 최종 대조 | PASS | 2작업/9고유 사건/순수수량3, 전부 ACKED·서버 hash 동일·미전송0; [대조](hardware-2026-10-28/local-server-checks.json) |
| Olist 전수 대사 | PASS | 누적2,002확정/수량2,254/4,260사건, 원본99,441=96,596+789+2,056, 불일치0; [직접 CSV 오라클](hardware-2026-10-28/source-after-hardware.json) |
| 물리 HDMI 모니터 | NOT_RUN | 사용자가 현재 연결 불가, VNC Viewer 관찰 선택. 실제 Wayland Chromium을 사용함 |
| 실제 전원 차단·SD 물리 손상 | NOT_RUN | 정상 재부팅 시험으로 이런 장애까지 보장하지 않음 |

## 사진 방식과 실제 실행 순서

사용자가 QR을 계속 띄우기 어렵다고 하여 한 장을 보관하고 반복 해독하는 방식을 선택했다.
최초 사진에는 QR이 없었고 다음 사진은 QR 아래가 잘렸다. QR 전용 창을 작게 위쪽에
배치한 뒤 실제 촬영 사진의 해독·상품 일치가 성공했다. 원본 사진은 Pi/PC의 Git 제외
var/에 권한0600으로만 보관한다. QR 창은 촬영/짧은 진단 뒤 내려 두었다.

이후 정상 입력은 그 저장 사진을 Pi에서 해독해 **소프트웨어 입력 검증 폼**에 입력했다.
잘못된 형식/다른 상품은 명시적 합성 문자열을 사용했다. 오류 QR 사진 시도2개는
NotFoundException이므로 광학 오류 QR 처리 PASS가 아니다.
[형식 오류 사진 시도](hardware-2026-10-28/photo-invalid-attempt.json),
[다른 상품 사진 시도](hardware-2026-10-28/photo-wrong-attempt.json).

첫 실제 적격 작업(필요2개)은 정상2회→초과/형식/다른 상품 차단→취소→정상1회→완료,
총5사건으로 로컬 완료했다. 서버 loopback 터널만 중단하고 SSH/VNC는 유지했다.
서버는 ASSIGNED/수량0/사건0이었다. sudo 비밀번호가 필요해 사용자가 정상 재부팅을
직접 실행했고, 재접속 후 복원 지문을 비교했다. 서비스도 다시 active/health200이었다.
터널 복구와 실제 화면의 수동 재시도로 같은5사건을 전송해 확정했다.

두 번째 적격 작업(같은 상품 필요1개)은 UI 경고 수정 회귀용이다. 저장 사진 입력→
오류/초과 차단→취소→사진 입력→완료, 총4사건을 별도로 확정했다.
기존 원본·첫 작업·F1·SQLite 이력은 삭제하지 않았다. 실제 상품 출고는 하지 않았다.

## 발견한 문제와 수정

1. Chromium에서 권한이 granted여도 장치 열거가8초 이상 대기했다. 검증용 브라우저에서
   `--disable-features=WebRtcPipeWireCamera` 적용 후 실제 C270 열거와 영상이 관측됐다.
   이 Pi의 비교 결과이며 모든 PipeWire 문제의 원인을 입증한 것은 아니다.
   [실행 스크립트](../deploy/start-device-browser.sh)는 전용 프로필을 쓰며 가짜 장치나
   가짜 영상 옵션을 쓰지 않는다. 개발 진단 포트는 LOGISTICS_BROWSER_DEBUG=1일 때만
   loopback 임시 포트로 열린다. 일반 실행에서는 브라우저 카메라 권한을 사용자가 허용한다.
2. 단말 동기화 성공 뒤 과거 RETRY_BUDGET_EXHAUSTED 경고가 남았다.
   입력 오류와 동기화 오류를 분리하고 조회 때 동기화 오류를 비우도록 수정했다.
   [수정 전 실제 화면](hardware-2026-10-28/sync-warning-before.json)과
   [수정 후 실제 화면](hardware-2026-10-28/sync-warning-after.json)으로 확인했다.
   [입력 경고 우선 표시](hardware-2026-10-28/input-warning-after-poll.json)도 실제 폴링 뒤 확인했다.
3. 카메라는 C270에서 사진 해독이 된1280×720을 ideal 제약으로 요청한다. 변경 뒤
   실제 스트림 크기는 확인했지만 해상도 변경만으로 실시간 QR 인식이 해결됐다고 쓰지 않는다.

DevTools 카메라 권한은 같은 연결 안에서 허용·관측했다. 권한 허용 뒤 연결을 끊고
새 연결에서 검사하면 prompt로 돌아오는 것을 관측했으므로 초기 grant 호출 성공만으로
실제 권한 허용을 판정하지 않았다.

## 재현과 미완료 범위

프로젝트 전용 SSH 키·known_hosts·실제 주소·단말 환경0600은 ignored var/에만 둔다.
Pi에는 사용자 승인 범위의 코드·공식 Node 약31MB·운영 패키지 약12.64MB·단말 전용
토큰만 전송했다. 관리자/DB 자격증명·Olist 원본은 보내지 않았다. 다른 장비로 복제하지 않는다.

Pi 프로젝트 폴더에서 기존 ffmpeg/ffprobe/fswebcam과 Node를 사용한다. 자동 설치/다운로드는 없다.

```bash
node tools/verify-camera-photo.mjs --capture --db var/device.sqlite --task-id <작업_UUID>
node tools/verify-camera-photo.mjs --image var/camera-photos/<촬영폴더>/frame.jpg --db var/device.sqlite --task-id <작업_UUID>
LOGISTICS_BROWSER_DEBUG=1 bash deploy/start-device-browser.sh
printf '%s' '{"action":"observe","taskId":"<작업_UUID>"}' | node tools/verify-device-browser.mjs
```

사진 진단 도구는 업무 이벤트를 만들지 않는다. 브라우저 검증 도구의 scan은 저장 사진 폼 입력,
scan-camera만 실제 웹캠 버튼이다. 출력의 source와 실행 전후 seq를 함께 확인한다.
사진/합성 입력으로 실제 카메라 버튼의 정상·오류 QR 처리를 PASS로 바꾸지 않는다.
M-E07의 실제 재부팅 조건은 통과했지만 M-E01 및 T08/T29의 전체 실시간 QR 시연 gate는
BLOCKED로 유지한다. 정상/오류 QR이 실제 프레임에 담긴 상태에서 짧은 광학 시험이 남았다.
전체 gate 통과 전 mvp-v1 태그·08확장은 진행하지 않는다.

공식 참고: [Pi 원격 접속](https://www.raspberrypi.com/documentation/computers/remote-access.html),
[Logitech C270](https://www.logitech.com/en-us/shop/p/c270-hd-webcam.960-000694),
[Chromium V4L2/PipeWire 캡처 경로](https://chromium.googlesource.com/chromium/src/+/master/media/capture/video/linux/video_capture_device_factory_linux.cc),
[DevTools Browser 권한 계약](https://chromedevtools.github.io/devtools-protocol/tot/Browser/).
