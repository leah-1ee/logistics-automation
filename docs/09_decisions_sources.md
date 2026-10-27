# 09. 설계 결정·제약·근거

## 1. 확정한 설계 결정

| ADR | 결정 | 선택 이유 | 바꿀 조건 |
| --- | --- | --- | --- |
| ADR-01 | 물류 운영 자동화가 주력, AI/비전은 후속 | 제공 JD가 API 수집·서버/배치·어드민·자동화를 요구 | 목표 직무가 AI/비전으로 바뀔 때 |
| ADR-02 | Olist 실제 주문 + 모의 API/현장 작업 | 실제 주문 구조와 재현성을 함께 확보 | 사용 권한 있는 실제 연동 기록 확보 |
| ADR-03 | 모듈형 모놀리스, API/worker 별도 프로세스 | 일주일 MVP와 이후 성능 확장 모두 고려 | 실제 분리 필요 측정·인력/운영 비용 확보 |
| ADR-04 | 단말 SQLite, 서버 MySQL을 각 기록의 기준으로 둠 | 네트워크와 Redis 상태에 업무 기록을 의존시키지 않음 | durable inbox 등 명세 변경 시 |
| ADR-05 | 단말 event는 동기 DB 적용 후 ACK | 수신/큐 등록/업무 확정을 혼동하지 않음 | 새로운 수신/적용 receipt 계약을 도입할 때 |
| ADR-06 | 최소 Outbox·미완료 대사는 MVP 포함 | DB/Redis 이중 쓰기의 누락 경로를 막음 | 동일 신뢰성을 제공하는 대안 검증 |
| ADR-07 | 기본 워커1·큐1, E1에서 확장 | 먼저 정확성과 baseline 확보 | 측정한 처리량·대기 기준 초과 |
| ADR-08 | 초기 단말1·수동 배정·재배정 없음 | 오프라인 소유권 충돌을 제한 | E2 배정 버전·정정·현장 정책 완성 |
| ADR-09 | 서버 확정일 기준 집계 | 단말 시계·지연 전송을 신뢰하지 않음 | 검증된 현장 시계 정책과 이중 날짜 리포트 |
| ADR-10 | 원본 불변·정규화 정정 이력·실물과 가상 구분 | 재현성과 사실성 유지 | 원본 공급자의 정식 변경 이벤트 지원 |
| ADR-11 | 캐시·Redis lock만으로 도메인 불변 조건 보장하지 않음 | 유실/만료/재시도 후에도 중복·과다 반영 방지 | 동등한 영속·동시성 보장 검증 |

## 2. 남겨둔 구현 선택

다음은 개발 시작 시 실제 환경을 확인하고 결정합니다. 정해지지 않은 값 때문에 도메인·ACK 규칙을 다시 추측하지 않습니다.

- Raspberry Pi 모델·OS·저장소·카메라 또는 USB 스캐너.
- Node.js·NestJS·MikroORM·BullMQ·MySQL·Redis의 지원되는 안정 버전과 lockfile.
- 단말 로컬 프로그램의 실행 방식: Node.js/TypeScript 기본, 장치 SDK가 다른 언어를 요구하면 adapter만 분리.
- 실제 Olist 파일 버전·라이선스·정확한 건수·필드 품질.
- 측정 장비와 데이터 크기에 맞춘 batch size·poll interval·DB pool·워커 동시성.
- 공개 배포 여부·HTTPS 도메인·인증 UI. 기본은 로컬/사설 개발 환경의 단일 운영자입니다.

기본 local event 보관 7일, sync backoff 1~60초, source page 200, API list max200, event batch max100/256 KiB는 설계 초기값입니다. 변경 시 설정과 시험 결과를 남깁니다.

## 3. 정책상 한계

- 출고 확정은 모의 업무 기록이며 실제 물품 이동·카드 승인·택배 접수가 아닙니다.
- 원본 취소 상태는 있을 수 있지만 완전한 취소 시점·전체 상태 이벤트 로그는 제공되지 않습니다.
- 상품명·실제 유통 barcode·장비 serial·창고 위치·재고 수량을 원본에 있는 것처럼 만들지 않습니다.
- commodity QR 스캔은 수량 검증이며 개별 실물 식별이나 포장 내용의 증명은 아닙니다.
- 전원/프로세스 재시작은 검증하지만 SD카드 물리 파손·기기 분실까지 보장하지 않습니다.
- 미전송 기록이 있는 단말을 초기화·업데이트하는 정책은 E2에서 더 강화합니다.
- 실제 자동화 효과는 직접 비교 실험 범위에서만 보고합니다.
- '10만 주문 처리'는 실제 초당 고부하 운영이나 기업 운영 경력의 대체 표현이 아닙니다.

## 4. 주요 실패 위험과 대응

| 위험 | 대응 | 확인 |
| --- | --- | --- |
| 공개 데이터 접근 지연 | 다운로드를 S1 첫 작업으로 수행, 미다운로드를 완료로 표시하지 않음 | manifest |
| 원본 품질로 적격1,000건 미확보 | 정확한 필터·분모 보고, 기준을 조용히 완화하지 않음 | 품질 보고 |
| 보드 카메라 문제 | 실제 USB 스캐너를 대체 입력으로 선택 가능 | T29 실제 장치 기록 |
| ORM 객체 누적으로 메모리 증가 | 배치/작업 단위 관리 범위 | F2 memory |
| Redis 유실로 후속 job 누락 | DB Outbox+완료 기준 재발행 | T20~T22 |
| 로컬 완료를 서버 완료로 오표시 | 두 상태 분리·receipt만 기준 | T13~T18 |
| 다중 단말로 조기 범위 확대 | MVP 단말1·배정 불변 | T06·T17 |
| 성능 개선 중 정합성 손상 | 불변 조건·전체 대사를 성능 run에도 실행 | E1 gate |

## 5. 참고 자료

아래는 제품 맥락·데이터·기술 결정의 출처입니다. 실제 구현에 맞춰 사용하는 버전의 문서를 다시 고정합니다. 외부 문서의 정책·접근 조건은 변경될 수 있습니다. 확인 기준일은 2026-10-27입니다.

| 구분 | 자료 | 이 PRD에서 사용하는 내용 |
| --- | --- | --- |
| JD | 사용자 제공 TypeScript/NestJS/MikroORM/MySQL/Redis·Operations 공고 | 역량과 프로젝트 우선순위 |
| 팀 업무 | https://toss.im/career/article/tossplace_node_faq | 외부 시스템 경계·운영 자동화라는 맥락. 현재 미해결 수작업을 입증하는 근거로 쓰지 않음 |
| 제품 복구 사례 | https://guide.tossplace.com/trouble/emergency-payment-mode | 장애 중 기능 유지·복구 후 반영의 제품 접근 |
| 원본 데이터 | https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce | 실제 주문 약10만 건과 연결 파일 |
| 큐 통합 | https://docs.nestjs.com/techniques/queues | NestJS와 작업 큐 구성 |
| 동시 처리 | https://docs.bullmq.io/guide/workers/concurrency | 워커·동시성 조절 |
| 호출 제한 | https://docs.bullmq.io/guide/rate-limiting | 외부 API 처리 속도 조절 |
| 재시도 | https://docs.bullmq.io/guide/retrying-failing-jobs | 실패 재시도·backoff |
| 재실행 안전성 | https://docs.bullmq.io/patterns/idempotent-jobs | 반복 실행 후 동일한 최종 결과 |
| 큐 운영 | https://docs.bullmq.io/guide/going-to-production | Redis 영속화·메모리·종료·관측 |
| Redis 메모리 | https://redis.io/docs/latest/develop/reference/eviction/ | 캐시와 큐의 메모리 정책 차이 |
| Redis 영속화 | https://redis.io/docs/latest/management/persistence/ | 영속화와 복구 정책 |
| Outbox | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html | DB/이벤트 이중 쓰기·중복 소비 |
| ORM | https://mikro-orm.io/docs/guide/advanced | 배치 upsert 등 성능 선택 |
| 실제 물류 API 예시 | https://docs.logistics-api.flexport.com/ | 상품·입고·출고·webhook·sandbox 접근 조건 |

토스의 비상결제 사례에서 확인되는 것은 장애 중 결제 유지와 복구 후 매출 반영입니다. 카드 승인 경로나 항상 일괄 전송하는 내부 구현, 정산 시스템 구조 전체를 확인한 것은 아닙니다. 이 프로젝트는 그 내부 구현의 복제물이 아닙니다.

## 6. 문서 변경 이력

- v1.0 / 2026-10-27: 대화에서 합의한 MVP와 확장 범위를 개발 가능한 계약·데이터·검증 기준으로 구성.
- 구체화하면서 보완: 스캔 취소, 배정 스냅샷 불변성, ACK 결과 구분, 시계 오차, 원본/가상 상태 분리.
- 신뢰성 공백을 막기 위해 최소 Outbox·미완료 작업 복구를 MVP로 포함. 대량 처리·다중 워커·캐시·업무 확장은 후속 단계 유지.
- 본 패키지는 문서 작성 결과입니다. 서비스 구현·원본 다운로드·전체 성능 검증 완료를 의미하지 않습니다.
