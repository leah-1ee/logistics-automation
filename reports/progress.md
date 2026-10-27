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
