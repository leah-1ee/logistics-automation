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
MySQL·Redis 전용 Compose 컨테이너 실행. 세부 통합 결과는 후속 기록.

남은 문제: 깨끗한 이미지 build·CI 원격 실행은 아직 NOT_RUN.
소프트웨어 개발을 계속하되 후속 단계 통과로 간주하지 않음.

## 원본·장비 의존성

Olist 공식 페이지의 JSON-LD: v2, contentSize 44,717,580 bytes,
CC BY-NC-SA 4.0. 공식 파일 목록에서 MVP 4개 파일 합계 35,647,734 bytes 확인.
공식 다운로드 경로가 404여서 실제 원본 다운로드·F1·F2·T28은 BLOCKED.
대체 사이트 데이터를 원본으로 사용하지 않음. 고정 fixture는 합성으로 표시.
실제 Raspberry Pi·모니터·웹캠 미연결: T29, 실제 QR 및 전원/SD 검증 BLOCKED.
