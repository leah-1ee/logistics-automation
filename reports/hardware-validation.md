# 실제 장비 검증 — 진행 중, 필수 gate BLOCKED

기준일: 2026-10-28 Asia/Seoul. 예정 카메라: 사용자 지정 Logitech C270.
사용자 공개키 등록과 코드·Node·단말 토큰 전송 승인을 받은 뒤 실제 Pi에 접속·설치했다.
Raspberry Pi 5 Model B Rev 1.1 / Debian13 arm64 / Chromium154 / Node24.22.1이며,
C270 USB046d:0825와 실제 캡처 노드 /dev/video0(uvcvideo)를 확인했다.
물리 HDMI는 연결할 수 없어 NOT_RUN이고, 사용자가 선택한 VNC로 화면을 관찰한다.
사용자 서비스·내장 SQLite·로컬 health200·실제 작업 스냅샷 다운로드는 확인했으나,
실제 QR 인식·오프라인 완료·재부팅 복원·서버 확정 전체 흐름은 아직 통과하지 않았다.
WSL에서 비디오 장치를 찾지 못한 결과를 Pi의 장비 상태로 해석하지 않는다.
아래 절차의 미실행 항목은 실행 결과가 아니다. WSL의 SQLite/프로세스 시험이나
QR 문자열 encode/decode를 실제 웹캠·보드 시험의 PASS로 옮기지 않는다.

## 연결 전 기록

실제 Pi 모델, RAM, OS/커널/아키텍처, SD 모델·여유 공간, 전원, USB 웹캠 모델,
브라우저 버전과 Node 버전을 기록한다. Node24 ARM64와 해당 OS의 호환성을 확인한다.
새 OS/Node/패키지는 크기와 저장 공간을 먼저 확인하고, 개별1GB 초과 또는 크기 미확인은 승인 후 받는다.

프로젝트 전용 공개키 등록은 완료했다. 아래 명령은 연결 재현용이다.
개인키와 known_hosts는 Git 제외된 var/에만 두며 실제 SSH 주소를 보고서에 커밋하지 않는다.

```bash
ssh-copy-id -i "$PWD/var/pi-verify-ed25519.pub" -o "UserKnownHostsFile=$PWD/var/pi-known_hosts" <사용자>@<Pi주소>
```

다음 읽기 전용 프로브는 실행했다. 프로브 자체는 촬영/설치/재부팅을 하지 않는다.

```bash
ssh -i var/pi-verify-ed25519 -o UserKnownHostsFile=var/pi-known_hosts <사용자>@<Pi주소> python3 - < tools/probe-hardware.py
```

출력은 Pi 모델/OS/아키텍처·USB 제품명/ID·V4L2 캡처 노드/권한·Node/Chromium 버전이다.
프로브 자체는 실제 QR·재부팅을 PASS로 판정하지 않는다. C270 연결이 안 보이면 그때
사용자에게 USB 연결을 한 단계로 안내하고 같은 관측을 다시 수행한다.
Logitech 공식 제품 설명의720p/30fps는 제품 사양이며 해당 Pi에서의 실제 동작 결과가 아니다.

개발 API는127.0.0.1:3000에만 바인딩된다. PC→Pi SSH가 있으므로 PC에 새 SSH 서버를
설치하는 대신 PC/WSL에서 Pi loopback33000으로 역방향 터널을 만든다. 먼저 포트 점유를 확인한다.

```bash
ssh -i var/pi-verify-ed25519 -o UserKnownHostsFile=var/pi-known_hosts -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -N -R 127.0.0.1:33000:127.0.0.1:3000 <사용자>@<Pi주소>
```

Pi의 별도 비공개 환경 파일에 SERVER_URL=http://127.0.0.1:33000,
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


공식 참고(2026-10-28 확인):
- [Raspberry Pi 원격 접속·SSH](https://www.raspberrypi.com/documentation/computers/remote-access.html)
- [Logitech C270 제품 설명](https://www.logitech.com/en-us/shop/p/c270-hd-webcam.960-000694)

소프트웨어 경계 보완: 권한 허용 대기 중 중지/작업 변경, 늦은 스트림, 반복 콜백을
모의 카메라3시험으로 확인했다. 단말 목록의201번째 이후 작업 페이지 이동도 구현했다.
C270 실제 프레임 QR 인식, 브라우저 카메라 입력, Pi 재부팅 복원 시험은 여전히 BLOCKED다.

## 사진을 이용한 중간 진단 (2026-10-28)

사용자가 QR 화면을 계속 유지하기 어려워 사진 방식의 검증을 요청했다.
설치되어 있던 fswebcam/ffmpeg/ffprobe로 실제 C270 사진1280×720을 Pi의 Git 제외
var/에 권한0600으로 저장했다. 최초 사진273,273bytes에서는 QR이 프레임 밖이었고
ZXing은 NotFoundException을 반환했다. 촬영 자체 PASS와 QR 해독 FAIL을 구분한다.
기존 브라우저 읽기도 TIMEOUT/camera:null이므로 인식 성공 증거로 쓰지 않는다.

- [실제 USB/V4L2 관측](hardware-2026-10-28/preflight.json)
- [Node 공식 다운로드 지문](hardware-2026-10-28/node-download.json)
- [Pi 런타임 설치 확인](hardware-2026-10-28/runtime-install.json)
- [실시간 읽기 시간 초과](hardware-2026-10-28/first-optical-scan.json)
- [저장 사진 해독 실패](hardware-2026-10-28/photo-initial.json)
- [합성 정상 사진/실제 QR 없는 사진 진단 도구 시험](hardware-2026-10-28/photo-tool-checks.json)
- [실제 Pi 화면: 수량 부족 시 완료 비활성화](hardware-2026-10-28/device-ui-partial.json)

사진 원본·원본 상품 QR·토큰·SSH 주소·키는 커밋하지 않는다. 저장 사진을 다시 해독한
결과는 SAVED_IMAGE이며 실제 브라우저 웹캠 입력 시험의 PASS로 대신하지 않는다.
진단 도구는 스캔 API를 호출하지 않으며 event/state/seq를 변경하지 않는다.
첫 읽기 뒤 실제 SQLite는 DOWNLOADED/SYNCED, 수량0/2, nextSeq1로 유지되었다.
서버 loopback 터널만 중단해 두었고 SSH/VNC와 로컬 단말 서비스는 유지한다.

추가 다운로드 없이 Pi 프로젝트 폴더에서 다음처럼 재현한다. 매 촬영은 새 폴더를
생성하고 기존 사진을 덮어쓰지 않는다. 출력에는 해독한 QR 문자열을 포함하지 않는다.

```bash
node tools/verify-camera-photo.mjs --capture --device /dev/video0 --db var/device.sqlite --task-id <작업_UUID>
node tools/verify-camera-photo.mjs --image var/camera-photos/<촬영폴더>/frame.jpg --db var/device.sqlite --task-id <작업_UUID>
```

QR이 담긴 사진 한 장을 해독한 뒤 사용자는 QR 창을 내릴 수 있다. 그 사진의 반복
해독은 사진 기반 시험으로 기록하고 실제 카메라 오류 QR/실시간 입력 시험은 별도 유지한다.
현재 다음 물리 단계는 C270 방향을 조정해 QR 전체를 프레임에 담는 것이다.
