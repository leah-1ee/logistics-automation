# 개발 환경 — 2026-10-27~28 (Asia/Seoul)

Ubuntu 22.04.5 LTS / WSL2 x86_64, kernel 6.18.54.1-microsoft-standard-WSL2.
호스트 메모리 15GiB, swap 4GiB, 디스크 가용 945GiB. 모바일 핫스팟.
Docker Desktop 서버 29.9.2, Compose 5.6.1, CPU 20, Docker 메모리 약 15.4GiB.
Git 2.34.1, Python 3.10.12는 기존 설치. Node/npm은 처음에 없음.

선택: Node 24.22.1 LTS (npm 11.19.1), Nest 12.2.0, MikroORM 7.2.5,
BullMQ 6.5.0, ioredis 6.0.0, React 19.3.1, Vite 8.3.5, TypeScript 5.9.3.
공식 npm engines와 Node LTS 보안 릴리스를 확인했고 package-lock.json으로 고정.
MySQL 8.4 LTS, Redis 7.4 Alpine, Node 컨테이너는 reports/image-*.json의
linux/amd64 manifest digest로 고정. Raspberry Pi 단말은 Node 24 ARM64 사용 예정,
실제 모델·OS·SD·메모리·웹캠 검증은 BLOCKED.

Node 압축본 32,026,916 bytes / SHA256
6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6 검증 완료.
패키지 전체 플랫폼 tarball 상한 294,087,877 bytes, 최대 개별 9,163,112 bytes.
실제 npm 설치는 현재 플랫폼 162 packages. 설치 스크립트 비활성화.
MySQL 이미지 238,319,598 bytes, Redis 16,243,847 bytes,
Node 이미지 81,042,384 bytes (압축 합계; 설치·볼륨 공간은 더 필요).
현재 플랫폼 npm tarball 합계 35,354,260 bytes, 설치 node_modules 약165MiB.
컨테이너 빌드에서도 이 플랫폼 의존성을 별도 설치해 검증했다.
기본 개발 실행 공간 3GB, 실제 전체 데이터 실행은 추가 공간을 측정할 것.

2026-10-28 실제 규모 환경 보완: MySQL buffer pool을 512MiB로 고정한다.
Docker 가용 메모리 약15.4GiB 내에서 전체 원본/업무 인덱스를 읽을 기본 작업 메모리다.
MVP의 워커1·동시성1·단일 queue 및 MySQL 커밋 내구성 설정은 그대로 적용한다.
기존128MiB 상태에서 read_requests=994,987,845 / physical_reads=375,111 /
wait_free=130을 관측했다. 이 값은 원본 ID OR 조회 수정 전후 누적이며 독립 부하 비교가 아니다.

제한: sandbox에서 Docker socket·로컬 listen·.git 쓰기가 제한되어 해당 명령만
승인된 실행 권한으로 사용. 시스템 전역 설치·공개 배포 없음.
사용자 승인 후 GitHub 비공개 origin/main을 연결하고 기존 이력 및 완료한 작업을 push했다.
tsx CLI의 IPC socket 제한은 `node --import tsx`로 회피.

공식 근거:
- https://nodejs.org/en/blog/release/v24.22.1
- https://docs.nestjs.com/migration-guide
- https://mikro-orm.io/docs/quick-start
- https://registry.npmjs.org/
- https://docs.bullmq.io/guide/retrying-failing-jobs

초기 MySQL DDL의 예약어 cursor 오류를 실제 실행에서 발견하여 cursor_token으로 수정.
DDL 암시적 커밋 후 재개를 위해 초기 CREATE TABLE을 IF NOT EXISTS로 재실행하며,
완료 migration은 내용 해시를 검증. 기존 데이터 삭제 없이 재실행 확인.


2026-10-28 실제 원본 준비: 공식 Kaggle v2 ZIP 44,717,580 bytes를 내려받고
CRC 및 SHA256을 확인했다. MVP 4CSV 합계35,647,734 bytes를 읽기 전용으로 보존했다.
원본과 준비 SQLite는 data/에 두고 Git에서 제외했다. Node 및 gh도 .tools/에만 설치했다.
GitHub CLI 2.103.3 공식 압축본15,031,972 bytes·SHA256 확인 후 사용자가 브라우저 인증했다.
개별 다운로드는 모두 크기를 확인했으며 1GB 초과 다운로드는 없었다.
실제 파일별 해시/규모는 manifests/olist-v2.json과 olist-download-2026-10-28.json 참조.
실제 전체 run에서는 Node24.22.1/워커1/동시성1/배치200, MySQL buffer pool512MiB,
innodb_flush_log_at_trx_commit=1 및 sync_binlog=1을 사용했다.
하드웨어 측정이나 통제된 성능 비교는 실행하지 않았다.
