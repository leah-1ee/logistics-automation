# 물류 운영 자동화 및 오프라인 출고 단말 시스템 PRD

버전: 1.0 · 작성일: 2026-10-27 · 상태: 개발 착수용 명세

## 제품 한 문장

실제 과거 주문을 출고 요청으로 재생해 수집·검증·작업 생성을 자동화하고, 라즈베리파이에서 수행한 스캔 기록을 통신 장애와 재시작 이후에도 누락·중복 없이 서버에 반영하는 운영 시스템입니다.

## 개발 순서

1. 아래 01~06 문서를 읽고 기본 데이터·동기화 규칙을 고정합니다.
2. [07_delivery_plan.md](07_delivery_plan.md)의 S0~S7 순서로 MVP를 만듭니다.
3. [06_verification.md](06_verification.md)의 MVP 통과 기준을 모두 확인하고 MVP 태그를 남깁니다.
4. 이후 [08_extensions.md](08_extensions.md)의 E1 → E2 순서로 확장합니다. E3·E4는 조건이 충족될 때 선택합니다.

확장 기능을 먼저 구현하기 위해 MVP의 통과 기준을 생략하지 않습니다. 일정이 부족하면 확장을 줄이고, 데이터 보존·중복 방지·실제 단말 시연은 유지합니다.

## 문서 구성

| 파일 | 내용 |
| --- | --- |
| [01_product_prd.md](01_product_prd.md) | 제품 목표, 사용자, 문제 가설, JD 연결, 범위 |
| [02_mvp_requirements.md](02_mvp_requirements.md) | 화면·기능·상태·기능별 수용 기준 |
| [03_architecture_data.md](03_architecture_data.md) | 구성 요소, DB 모델, 트랜잭션, 큐, 복구 |
| [04_api_sync_contract.md](04_api_sync_contract.md) | API, 단말 이벤트, ACK, 순서·중복·충돌 규칙 |
| [05_dataset_pipeline.md](05_dataset_pipeline.md) | Olist 원본 매핑, 정규화, 재생, 데이터 출처 |
| [06_verification.md](06_verification.md) | 기능·장애·전체 데이터·부하 검증, 지표, 통과 기준 |
| [07_delivery_plan.md](07_delivery_plan.md) | 단계별 개발 작업, 의존성, 산출물, 완료 체크리스트 |
| [08_extensions.md](08_extensions.md) | Redis·대량 처리·다중 단말·업무·AI 확장 로드맵 |
| [09_decisions_sources.md](09_decisions_sources.md) | 설계 결정, 제약, 남은 결정, 근거 링크 |
| [openapi.yaml](openapi.yaml) | MVP HTTP API 계약. 예시는 구현 데이터가 아닙니다 |
| [examples.json](examples.json) | 원본 주문 변환·단말 이벤트·응답·작업 스냅샷 예시 |
| [document_checks.json](document_checks.json) | 문서 참조·예시·요구사항 추적 검사 결과. 제품 구현 시험 결과가 아닙니다 |

## 확정한 기준

- 기본 기술: TypeScript, NestJS, MikroORM, MySQL, Redis + BullMQ, React.
- 단말: Raspberry Pi OS/Linux의 라즈베리파이, SQLite 기반 로컬 기록 프로그램, 브라우저 작업 화면.
- MVP: 창고 1개, 등록 단말 1대, 운영자 1명. 작업은 수동 배정하고 이후 자동화합니다.
- 데이터: Olist 원본 전체를 수집 대상으로 삼습니다. 현장 출고 작업은 유효한 단일 판매자 주문에서 시작합니다.
- 1,000건은 기능 검증용 작업 수이며 원본 데이터셋 크기가 아닙니다.
- ACK는 MySQL의 이벤트·업무 반영 트랜잭션이 커밋된 뒤 반환합니다. Redis 등록 성공을 단말 처리 성공으로 쓰지 않습니다.
- 로컬 완료와 서버 확정은 별도 상태입니다.
- 출고 작업 확정은 모의 창고 업무의 기록 확정입니다. 실제 재고 확보·택배 발송·결제 승인이 아닙니다.
- AI 모델 개발은 MVP 필수 기능이 아닙니다. AI 활용 실험은 별도 측정 가능한 단계로 둡니다.

## 명세 해석 순서

제품 범위는 01·02, 데이터 불변 조건은 03, 이벤트 처리 의미는 04가 기준입니다. HTTP 필드·경로·타입은 openapi.yaml이 기준입니다. 데이터 변환은 05, 완료 판정은 06이 기준입니다. 구현 중 충돌을 발견하면 이 순서를 근거로 관련 문서를 함께 수정하고 결정 기록을 남깁니다.

제품 데이터는 MySQL, 전송 전 단말 기록은 SQLite가 기준입니다. Redis·캐시·어드민 화면은 기준 기록을 대체하지 않습니다.

## 첫 실행 전에 결정·기록할 값

라이브러리 안정 버전과 lockfile, 실제 Olist 원본 버전·해시, 데이터 시간대 처리, 카메라/USB 스캐너 선택, 실제 테스트 장비·메모리·CPU·네트워크 조건을 기록합니다. 본 문서는 실제 개발·데이터 다운로드·성능 시험을 수행한 결과물이 아닙니다.
