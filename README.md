# 물류 운영 자동화 MVP

Olist 주문 수집 → 검증·작업 생성 → 단말 배정 → 웹캠 QR → 오프라인 SQLite →
MySQL 확정 → 일별 집계. 현재 **개발 중 소프트웨어 MVP**입니다.
실제 Olist v2 원본을 확보했고 99,441주문의 수집·분류를 실행했습니다.
작업96,596건 생성·전체 독립 대사(F2)·실제 주문1,000건 모의 재생(F1)을 통과했습니다.
Raspberry Pi·웹캠·SD는 BLOCKED입니다.
전체 MVP 완료로 표시하지 않습니다.
[GitHub 비공개 저장소](https://github.com/leah-1ee/logistics-automation)에 로컬 이력을 보존해 push합니다.
공개 배포·확장 기능은 실행하지 않았습니다.

필수 기준: [원본 명세](docs/README.md), [단계 기록](reports/progress.md),
[시험표](reports/verification.md), [환경·다운로드](reports/environment.md).
최초 문서 원본은 Git 커밋 `325662e`에 보존되어 있습니다.

## 개발 실행

Node **24.22.1**, Docker/Compose, Python 3 필요. `.nvmrc`와 lockfile/digest 고정.
이 환경은 `.tools/node-v24.22.1-linux-x64/bin`에 Node를 설치했습니다.
외부 HTTPS 배포는 구성하지 않았으며 모든 개발 포트는 loopback만 사용합니다.

```bash
export PATH="$PWD/.tools/node-v24.22.1-linux-x64/bin:$PATH"
make setup          # .env 최초 생성(0600), npm 설치
make dev-fixture    # 합성 10주문 준비·이미지 build·DB migration·master seed·서비스 실행
make device-fixture # 별도 터미널: 파일 SQLite 단말, http://127.0.0.1:3200/device
```

어드민: http://127.0.0.1:3000/admin 에 `.env.fixture`의 ADMIN_TOKEN을 직접 입력합니다.
화면은 토큰을 메모리에만 보관합니다. 로그나 Git에 토큰을 붙이지 마세요.
run ID는 `.env.fixture`의 DATASET_RUN_ID입니다. 수집 시작 → 출고 작업 조회 →
CREATED 작업을 pi-01에 최초 배정 → 단말 화면에서 작업 선택 → 웹캠으로 QR 1개씩 읽기.
프로젝트 QR text는 `LOPS1:PRODUCT:<32자리 productId>`입니다.
상품 ID QR은 실제 상품·바코드 인식이 아니라 모의 물류 입력 표식입니다.
QR 인쇄 파일 생성은 아래 단말 안내를 따릅니다.

```bash
PREPARED_DB=data/prepared/fixture.sqlite npm run qr:labels
# var/qr-labels.html을 브라우저에서 열어 인쇄 (최대 12개, 외부 자원 없음)
# 실제 선택 작업의 상품만 출력:
node --import tsx --env-file=.env.olist tools/qr-labels.ts --task-id <작업_UUID>
# var/qr-labels-<작업_UUID>.html, 토큰·명령은 QR에 포함하지 않음
```

내려받은 작업은 서버 중단 시에도 처리할 수 있습니다. LOCAL_COMPLETED와
SERVER_CONFIRMED를 구분하며, COMPLETE의 성공 receipt 후에만 서버 확정으로 표시합니다.
개별 물품 serial이 없으므로 같은 실물을 두 번 읽었는지는 판별하지 못합니다.

## 실제 원본 준비

[Olist 공식 다운로드 화면](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce)의
버전 2와 **CC BY-NC-SA 4.0**, 다운로드 크기 **44,717,580 bytes**를 확인했습니다.
HEAD 요청은 404였지만 GET 다운로드는 정상 동작함을 확인했습니다.
현재 원본은 `data/downloads/brazilian-ecommerce-v2.zip`에 보존했고 MVP 4파일만 추출했습니다.
새 환경은 공식 페이지에서 ZIP을 내려받아 프로젝트의 `data/downloads/`에 저장합니다.
자격 증명은 이 대화나 Git에 넣지 마세요. 1GB 초과 또는 크기 미확인 다운로드는 승인 후 진행합니다.
원본 ZIP 약44.72MB, MVP 추출 4파일 합계35,647,734 bytes이며 준비 인덱스·DB까지
별도 공간이 필요합니다. 초기 여유 공간은 3GB 이상을 권장합니다.

```bash
python3 tools/import-olist-zip.py data/downloads/brazilian-ecommerce-v2.zip
# data/raw/olist-v2/download.json에 실제 다운로드 시각·관측 정보를 기록
npm run prepare:data        # .env의 RAW_DIR/PREPARED_DB 사용; 기존 출력 거부
npm run migrate
npm run seed               # 실제 manifest와 시나리오 해시 등록, master 파일 적재
npm run source             # 별도 터미널: 모의 REST API
npm run worker             # 별도 터미널: 큐 1개/동시성 1
npm run dev                # 별도 터미널: 서버
npm run ingest             # HTTP 주문 수집; 저장한 checkpoint부터 재개
npm run reconcile -- --wait-seconds=60 # worker drain 후 전체 분모·분류·작업·수량·집계 대사
npm run verify:actual       # 실제 적격 미배정 1,000주문 F1; 작업 이벤트는 소프트웨어 모의 입력
```

fixture와 원본은 **다른 DATASET_RUN_ID**를 사용해야 합니다. `.env`의 원본 run ID를
새 UUID로 설정하세요. 동일 run의 manifest나 시나리오를 바꾸면 등록을 거부합니다.
현재 실제 검증은 별도 `.env.olist`를 사용합니다. 기존 `.env`와 fixture 설정은 보존했습니다.
아래 명령은 **이미 준비된 현재 실제 run**을 사용합니다. 최초 준비 명령을 다시 실행해 원본을 덮어쓰지 마세요.

```bash
APP_ENV_FILE=.env.olist docker compose --env-file .env.olist up -d --no-build api worker source
node --import tsx --env-file=.env.olist tools/verify-actual-run.ts
# 기존 수집/작업 생성 drain → 독립 CSV 대사(F2) → 실제 주문 1,000건 모의 입력(F1) → 최종 대사
```

원본은 주문99,441 / 주문 상품112,650행 / 상품32,951 / 판매자3,095이며,
현재 분류는 적격96,596 / DATA_HOLD789 / UNSUPPORTED2,056입니다.
진행 상태는 `reports/actual-run-<runId>.json`, 결과는 `reports/reconciliation-<runId>.json`과
`reports/f1-<runId>.json`에 기록됩니다. PASS는 각각 실제 실행 완료 후에만 기록합니다.
fixture 실행과 실제 실행은 source 서비스 설정이 다르므로 수집 중에 서로 전환하지 마세요.

기존 .env/CSV/SQLite/DB 볼륨은 자동 초기화하지 않습니다.
전체 원본 F2 통과와 실제 원본 적격 1,000건 F1은 합성 시험으로 대체하지 않습니다.
F1을 실행할 때 실제 단말 agent는 중지하세요. 별도 `var/f1-<runId>.sqlite`와 고정 선택 plan에
입력/ACK를 보존하며 같은 명령으로 재개합니다. 합성 manifest는 F1 도구가 거부합니다.

## 검증·복구

```bash
make verify
node --import tsx --env-file=.env.test tests/service-faults.ts  # 이 프로젝트 mysql/redis 잠시 중단 후 복구
node --import tsx --env-file=.env.test tests/replay-synthetic.ts # 보조 합성 1,000작업 시험
docker compose logs --tail=100 api worker source
docker compose ps
```

`make verify`는 별도 logistics_test DB와 .env.test를 준비하고 migration 후 통합 시험을 실행합니다.
단위/통합 시험은 합성 run을 매번 새로 등록하며 기존 run을 삭제하지 않습니다.
초기 개발 시 같은 DB에서 사용한 합성 시험 기록도 삭제하지 않고 보존했습니다.
SIGKILL 시험은 시험 전용 자식 프로세스만 종료합니다. 서비스 장애 시험은
`logistics-mvp` 컨테이너만 중단하고 finally에서 재시작합니다.
Redis 복구 후 워커의 outbox 발행 루프는 PENDING 및 lease 만료 DISPATCHED를 재발행합니다.
FAILED는 자동 무한 반복하지 않으며 운영 화면에서 이유 확인 후 허용된 일시 오류만 재시도합니다.
HOLD 이벤트의 내용 변경·강제 완료·재배정은 제공하지 않습니다.

`docker compose stop`은 데이터를 보존합니다. **`down -v`·볼륨 삭제·원본 삭제는
별도 대상/영향 확인 없이는 실행하지 마세요.** migration은 버전·해시를 보존하고
완료된 파일 변경을 거부합니다. 초기 DDL은 암시적 커밋으로 부분 적용될 수 있으므로
재시작 가능한 CREATE IF NOT EXISTS이며, 향후 구조 변경은 새 migration을 추가합니다.

## 단말 정책

실제 Pi5/Debian13 arm64·Node24.22.1·Logitech C270을 확인했습니다.
사용자는 HDMI 대신 VNC 관찰을 선택했습니다. C270 사진 QR 해독과 정상 재부팅 복구는
통과했으나 실시간 웹캠 버튼의 광학 QR 처리 전체 시연은 아직 BLOCKED입니다.
[systemd 예시](deploy/logistics-device.service)를 실제 경로·환경 파일에 맞춰 설치합니다.
장비 연결·네트워크 경로와 T08/T29 순서는 [장비 검증 절차](reports/hardware-validation.md)를 따릅니다.
환경은 `SERVER_URL`, `DEVICE_ID`, `DEVICE_TOKEN`, `DATASET_RUN_ID`, `DEVICE_DB`, `LOCAL_ORIGIN`.
Pi Chromium 장치 열거가 대기한 환경에서는 [전용 실행 스크립트](deploy/start-device-browser.sh)의
V4L2 설정으로 실제 장치·영상을 확인했습니다. 일반 실행은 디버깅 포트를 열지 않습니다.
기본 origin은 `http://127.0.0.1:3200`이며 웹캠 권한을 브라우저에서 허용해야 합니다.
로컬 API의 변경 요청은 같은 origin만 허용하며 API 토큰은 QR에 넣지 않습니다.

SQLite WAL·synchronous=FULL, 이벤트/상태/seq 동시 커밋, 부팅 시 projection 재생.
전송은 1초~60초 지수 대기+jitter, 429 Retry-After 우선, 5회 후 수동 재시도 대기.
미확인·차단 이벤트와 ACK된 기록을 자동 삭제하지 않습니다. 명세의 최소 7일보다
길게 보존하며 SD 공간 관찰 후 별도 승인된 정리 정책을 정합니다.
실제 전원 차단·SD 불량·장치 분실에 대한 보장은 아직 없습니다.

## 현재 한계

독립 CSV 오라클·장애/경계·추가 실제1,000건·실제 Pi/운영 UI 시험으로 결함7건을 수정했습니다.
요구사항34 PASS/1 BLOCKED, T01~T34는32 PASS/2 BLOCKED입니다. 실시간 QR 최종 시연이 남았습니다.
운영 화면은 실제 headless 브라우저로 검증했으며 수동 시연·영상·물리 HDMI는 미실행입니다.
재현은 [운영 브라우저 검증](reports/browser-validation.md)을 참고하세요.
실제 Olist F1/F2와 최종 전체 대사는 PASS입니다. F1의 스캔·배정은 모의 업무 입력이며
실제 장비의 현장 시험을 뜻하지 않습니다. 결과와 재현 명령은 시험표에 연결했습니다.
실험 환경은 [환경 기록](reports/environment.md)을 보세요. 합성 재생의 초당 처리량을
실제 기업 운영 성능이나 현장 자동화 시간 절감으로 해석하지 않습니다.
모든 T01~T34 gate 통과 전 `mvp-v1` 태그를 만들지 않습니다.

## GitHub 작업

기존 7커밋을 보존하고 비공개 `origin/main`으로 push했습니다. 새 기능·시험 단위로 커밋하고
`python3 tools/audit-git.py` 실행 후 `git push origin main` 합니다.
검사 범위는 reachable 이력·tracked/추가 후보의 알려진 비밀값/패턴·금지 경로이며,
임의의 모든 개인정보를 자동으로 식별한다는 보장은 아닙니다. `.env*`, 원본, SQLite,
node_modules, `.tools`, dist는 Git에서 제외됩니다. 원격 가시성은 PRIVATE로 확인했습니다.


## 독립 재검증과 오프라인 빌드

최신 판정은 [요구사항별 재검증](reports/independent-2026-10-28/verification.md)을 보세요.
CSV 독립 대사의 메모리 개선·정확성 비교·실행 시간/임시 디스크 비용은
[2026-10-29 측정 보고서](reports/audit-memory-2026-10-29/README.md)에 별도로 기록했습니다.
실제 C270/Pi와 화면 수용 기준은 실행 증거가 생기기 전 BLOCKED/NOT_RUN으로 유지합니다.
기존 F1을 덮어쓰지 않는 별도 재생은 `F1_TRIAL=independent-20261028` 환경 값으로
`tools/replay-actual.ts`를 실행합니다. 같은 trial은 저장한 plan과 로컬 사건을 재사용합니다.

핫스팟에서 이미 로컬 앱 이미지와 동일 lockfile이 있을 때만 다음 증분 빌드를 쓸 수 있습니다.
패키지는 다운로드하지 않으며 기존 이미지의 lockfile이 다르면 중단합니다.
최초 환경은 기존 Dockerfile/Compose 준비 절차가 필요합니다.

```bash
docker build --network=none --pull=false -f deploy/Dockerfile.offline -t logistics-mvp-app:independent .
```

새 단말 다운로드는 서버 CONFIRMED 작업을 제외하지만 기존 로컬 사건은 삭제하지 않습니다.
ACK 유실 COMPLETE는 기존 SQLite에서 같은 ID로 재전송해 확정을 복구합니다.
