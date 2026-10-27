# MVP 단계 기록

PASS는 실제 실행한 범위에만 사용. 원본 문서 document_checks.json은 제품 시험 아님.
MVP 완료·mvp-v1 태그·08 확장 착수는 모든 필수 gate 통과 전 금지.

## S0 — 구현 / 검증 진행

요구: M-A07, 비기능 health/readiness, 공통 계약·M-S01/02/03 기반.
산출: lockfile, Compose, 초기 migration, NestJS health, 인증 도우미,
OpenAPI 기반 schema 검증, canonical hash와 알려진 정답 시험, CI 정의.

실행: 타입 검사 PASS. 단위 시험 및 원본 예시 hash 검증 PASS.
문서 검사: 27 operations / 43 schemas / 6 event known answers / 17 local links.
실제 MySQL 초기 migration 적용 및 두 번째 재실행 PASS.
실제 HTTP /health=ok, /ready=ok(database=up, redis=up) 확인.
MySQL·Redis 전용 Compose 컨테이너 실행. 세부 통합 결과는 후속 기록.

남은 문제: 깨끗한 이미지 build·CI 원격 실행은 아직 NOT_RUN.
소프트웨어 개발을 계속하되 후속 단계 통과로 간주하지 않음.

## 원본·장비 의존성

Olist 공식 페이지의 JSON-LD: v2, contentSize 44,717,580 bytes,
CC BY-NC-SA 4.0. 공식 파일 목록에서 MVP 4개 파일 합계 35,647,734 bytes 확인.
공식 다운로드 경로가 404여서 실제 원본 다운로드·F1·F2·T28은 BLOCKED.
대체 사이트 데이터를 원본으로 사용하지 않음. 고정 fixture는 합성으로 표시.
실제 Raspberry Pi·모니터·웹캠 미연결: T29, 실제 QR 및 전원/SD 검증 BLOCKED.

## S1 — 소프트웨어 구현 / 실제 원본 gate BLOCKED

요구: M-D01~05, M-D02 대사 준비, T01~04·T32.
구현: CSV 스트리밍·원본 행 위치/해시 SQLite 인덱스, manifest, source 커서 API,
가상 시계, master 파일 적재와 REST 주문 수집 분리, DB checkpoint·원본·정규화·outbox 원자 저장.
source key 충돌 payload는 source_conflicts에 보존하고 원본은 덮어쓰지 않음.
실행: 합성 CSV 10주문/30행/2상품/1판매자 준비, 타입 검사, 분류·행수 단위 시험.
실제 MySQL 페이지 재수집, 저장 전/중/커밋 전 예외 rollback, checkpoint 및 원본 충돌 격리 PASS.
T02 프로세스 SIGKILL은 아직 NOT_RUN; 위 결과는 예외 rollback 시험만 의미.
초기 SQL placeholder 수 불일치는 실제 DB 시험에서 발견·수정 후 재실행 통과.
원본 전체 대사·F1·F2는 다운로드 실패로 BLOCKED이며 S1 통과로 표시하지 않음.

결정: 비어 있지 않은 cursor 페이지 재요청의 재현성을 위해 페이지 경계를 고정한다.
해당 페이지 마지막 레코드의 가상 공개 시각 전에는 empty/same-cursor/poll 응답을 준다.
공개된 일부 레코드가 페이지가 채워질 때까지 기다릴 수 있음. 실제 UTC 시각으로 해석하지 않음.

## S2 — 업무 모델 구현 / Redis 장애 통합은 S6에서 검증

요구: M-W01~05, T05~07·T20~22.
구현: MySQL task UNIQUE, job/order row lock, revision fencing, outbox lease 재발행,
BullMQ ops-jobs 워커 concurrency=1, immutable snapshot과 최초 배정,
운영 requestId canonical hash/응답 보존·감사·actor별 변경 직렬화.
실행: 실제 DB task 생성 중 예외 rollback, 동시 중복 job 후 작업 1개,
같은 requestId 응답 보존, 다른 requestId 재배정 거부, 같은 requestId 본문 변경 거부 PASS.
task 생성과 outbox DONE은 같은 트랜잭션. 실제 Redis 중단/복구·워커 SIGKILL은 아직 NOT_RUN.

## S3 — 파일 SQLite·로컬 화면 구현 / 하드웨어 gate BLOCKED

요구: M-E01~08, T07~13·T32·T34.
SQLite WAL/synchronous=FULL, UUID·seq·이벤트·수량·취소·완료·receipt 보존,
부팅 시 전체 로컬 이벤트 projection 재생, snapshot 충돌 격리.
React 현장 화면은 로컬 API만 사용. ZXing 웹캠으로 QR 1개씩 읽기·스캔별 취소,
부족 완료 차단·로컬 완료/서버 확정 분리. 번들 자원은 로컬 제공하며 CDN 없음.
실행: 파일 SQLite 잘못된 QR·상품·초과·재취소·부족 완료, 예외 rollback,
재다운로드·재연결·완료 잠금·늦은 ACK 수량 보존 단위 시험 PASS. 전체 빌드 PASS.
실제 Pi/웹캠/모니터/SD 시험은 BLOCKED. 프로세스 SIGKILL은 S6 시험으로 남음.

계약 보완: 재시작 후 취소할 eventId와 차단 사유를 읽을 수 있도록
GET /local/v1/tasks/{taskId}/history, 단말 health를 OpenAPI에 추가.
기존 스냅샷·이벤트 의미는 유지. 원본 계약은 최초 Git 커밋에 보존됨.

## S4 — 동기화 구현 / 통합 장애 검증 진행

요구: M-S01~08, T14~19·T23·T25·T34.
단말 event는 이벤트별 MySQL 트랜잭션에서 receipt·seq·수량·task·report outbox를
함께 저장하고 transactional promise가 완료된 뒤만 반환. Redis 경로 사용 없음.
device/eventId 및 task/version/seq 유일 제약, 중복 우선 검사, 영구 거부와 일시 오류 분리.
단말은 순서·단일 요청·작업 격리·jitter·Retry-After·5회 예산 후 수동 재시도.
실행: 실제 MySQL ACK 직후 응답 유실 hook, 중복 payload 충돌, seq gap,
다른 단말/버전, 부분 batch 후 throw, 중복 COMPLETE, 미완료 서버 직접 호출 PASS.
아직 위 hook을 실제 API SIGKILL 시험과 동일하게 표시하지 않음.

계약 해석: CONFIRMED는 terminal이므로 새 eventId로 뒤늦은 추가 입력은
BLOCKED/TASK_ALREADY_CONFIRMED로 응답하고 확정·집계를 유지한다.
committedAt/confirmedAt은 트랜잭션 마지막 저장 직전에 읽은 MySQL UTC 시각이며
ACK는 실제 COMMIT 이후이다. DB 로그의 정확한 commit timestamp를 뜻하지 않음.

## S5 — 운영 화면·API·집계 구현

요구: M-A01~07, M-D06·M-W06, T24·T26·T30~31·T33.
구현: React 주문 검색/페이지·상세·정정, 작업 배정/메모/이벤트,
실패 job 조회·조건부 재시도, 단말 마지막 보고·수신 시각 기준 stale,
업무일/상품별 CONFIRMED 재계산 및 CSV. 운영 변경은 사유·감사·requestId를 보존.
DATA_HOLD만 revision 정정, 원본 불변, task 존재 후 정정 금지,
영구 job 오류 재시도 우회 금지, 일시 job 오류 5회 예산.
실행: 실제 MySQL 정정/원본/감사/재시도/집계 멱등성 PASS.
실제 Nest HTTP 401/403, 검색/목록 max200, 256KiB body 제한, 메모 201,
CSV content type, stale 관측·readiness·React index 제공 PASS.
브라우저 클릭·웹캠·모니터의 실제 UI 동작은 아직 NOT_RUN/BLOCKED이며
번들 build/HTTP 응답만으로 현장 UI 시험 통과를 주장하지 않음.
