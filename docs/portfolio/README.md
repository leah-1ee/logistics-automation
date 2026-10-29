# 물류 운영 자동화 MVP — 프로젝트 설명서

2026-10-29(Asia/Seoul) 작성. 분석 기준 코드는 `53b3ee3`이며, 이 문서 묶음은 기존 기록을
수정하지 않고 추가했다. 제품의 실제 동작, 자동 시험, 장비 시험, 계획을 구분한다.
**현재 전체 MVP는 미완료**다. 실시간 C270 QR 버튼 경로가 남아 있고, 요구사항은
34 PASS/1 BLOCKED, T01~T34는 32 PASS/2 BLOCKED다.
[최신 판정](../../reports/verification.md), [장비의 실제 범위](../../reports/hardware-validation.md)

읽는 순서는 **목적(1~3) → 설계(4~5) → 구현(6~7) → 문제 해결(8) → 검증(9) → 결과(10~12)**다.

| 상세 문서 | 담은 내용 |
|---|---|
| [설계·구현·의사결정](architecture.md) | 구성도, 데이터 흐름, 트랜잭션, API/DB, 선택 이유와 절충 |
| [트러블슈팅 STAR](troubleshooting.md) | 실제 결함·수정·전후 시험, 시험 도구/환경 문제의 구분 |
| [검증·성능·한계](verification-results.md) | 전체 주문/F1/합성/Pi 범위, 시험 상태, 정량 결과와 미측정 항목 |
| [개인 기여·AI 활용](contribution-ai.md) | 사용자/Codex의 확인 가능한 활동, 작업 분할, 회고 확인 사항 |
| [문서 근거 대조 결과](evidence-checks.json) | 기존 수치·상태·코드 SHA·링크·원래 파일 보존의 문서 검수 결과 |

## 1. 프로젝트 개요

| 항목 | 확인된 내용 |
|---|---|
| 프로젝트명 | 물류 운영 자동화 MVP (`logistics-operations-mvp`) |
| 기간 | 저장소의 문서 보존·개발·검증 커밋 관측 구간은 **2026-10-27~2026-10-29**. 실제 기획 시작일·총 투입 시간·개발 종료일은 **확인 필요** |
| 인원 | 이 대화의 사용자와 Codex 활용은 확인된다. 전체 참여 인원·외부 협업자·인별 기여율은 **확인 필요** |
| 역할 | 사용자: 요구·제약 전달, 계정/장비 준비와 물리 조작. Codex: 코드·시험·환경 구성·검증·수정·기록. 세부 근거와 개인 기여의 한계는 [12번](contribution-ai.md) |
| 저장소 | [GitHub 비공개 저장소](https://github.com/leah-1ee/logistics-automation). 열람 권한이 필요하며 공개 배포 실적은 없음 |
| 진행 이유 | 문서의 ADR-01에는 제공 JD의 API 수집·서버/배치·운영 어드민·자동화 역량과 연결한다고 기록됨. 지원 공고 원문·개인적인 계기·지원 회사와의 관계는 **확인 필요** |

기록 구간의 시작은 [원본 명세 보존 `325662e`](https://github.com/leah-1ee/logistics-automation/commit/325662e),
이번 분석의 끝은 [측정 기록 `53b3ee3`](https://github.com/leah-1ee/logistics-automation/commit/53b3ee3)다.
PRD의 ‘일주일 계획 예시’를 실제 개발 기간이나 일주일 내 완성 실적으로 사용하지 않는다.
[단계 계획](../07_delivery_plan.md), [ADR·JD 연결](../09_decisions_sources.md)

## 2. 배경 및 목표

목표는 **공개 주문을 수집해 작업을 생성하고, 통신 장애 중에도 현장 입력을 남긴 뒤
복구 시 중복 없이 서버에 확정하는 흐름**을 재현하는 것이다. 주문 재입력, 연결 중단 시
기록 재작성, 재시도로 인한 중복 반영, 예외 확인 부담을 문제 가설로 삼았다.
특정 기업의 현재 수작업 실태를 조사하거나 실제 창고에서 절감 시간을 측정한 것은 아니다.
[문제 가설·목표](../01_product_prd.md)

Olist의 주문·상품·판매자 관계는 실제 공개 데이터다. 모의 REST API의 공개 시각,
출고 작업, 배정, QR 표식, 스캔/취소/완료와 장애는 프로젝트가 생성했다. 원본의
`delivered`는 이 시스템의 `CONFIRMED`가 아니며, 실제 출고·재고 예약·택배 접수는 하지 않았다.
[데이터 경계](../05_dataset_pipeline.md), [실제 F1의 actions 필드](../../reports/f1-e7fb6a95-0d26-42b5-9305-5b559569b7da-independent-20261028.json)

### 제품 사례와 출처 확인 범위

아래 출처는 기존 [09 문서](../09_decisions_sources.md)에 기록되어 있으며, 이 문서 작성 시
2026-10-29에 공식 페이지를 다시 확인했다. 원문의 제품 동작과 이 프로젝트의 설계를 동일시하지 않는다.

| 출처 | 확인한 범위 | 이 프로젝트와의 관계·확인하지 못한 것 |
|---|---|---|
| [토스플레이스 비상결제모드 안내](https://guide.tossplace.com/trouble/emergency-payment-mode) | 장애 중 제한된 결제 이용, 통신 복구 후 내역의 매출 반영이라는 사용자 안내 | 장애 중 기능 유지/복구 후 반영의 제품 맥락. 내부 저장소·큐·카드 승인·ACK 구현은 공개 안내만으로 알 수 없고 복제하지 않음 |
| [토스플레이스 Node.js 직무 소개](https://toss.im/career/article/tossplace_node_faq) | 기존 명세가 업무 맥락의 출처로 연결한 사실과 페이지 제목 | 이번 본문 추출은 불완전함. 구체적인 직무·내부 시스템 설명의 재확인은 **확인 필요** |
| [Flexport Logistics API 공식 문서](https://docs.logistics-api.flexport.com/) | 상품·주문·입고·webhook·sandbox 안내가 존재하는 범위 | 실제 물류 API의 경계 참고. 본 프로젝트에서 Flexport 계정·인증·sandbox·실제 주문 연동을 실행한 기록은 없음 |

## 3. 요구사항 및 제약

기능은 전체 주문 수집/분류, 적격 주문의 작업 생성, 수동 최초 배정, 불변 스냅샷,
스캔·취소·완료, 로컬 보존/재전송, 운영 조회·정정·메모·실패 job 재시도, 확정 집계/CSV다.
원본 보존·페이지 체크포인트·커밋 후 ACK·중복 효과 1회·로컬/서버 완료 구분을
핵심 불변 조건으로 둔다. 구현과 시험의 연결은 [M-* 35개](../02_mvp_requirements.md),
[T01~T34](../06_verification.md), [실제 구현](architecture.md)에 있다.

| 제약 | 실제 적용과 근거 |
|---|---|
| 모바일 핫스팟 | 다운로드 크기/공간 사전 확인, 1GB 초과·크기 미확인 시 사용자 확인이라는 작업 제약. 도구는 `.tools`, 원본은 Git 제외. [환경 기록](../../reports/environment.md) |
| 데이터·비밀 보존 | 원본·토큰·SQLite·빌드 산출물 Git 제외, 원본 manifest/SHA 보존. [원본 manifest](../../manifests/olist-v2.json), [검사](../../reports/audit-memory-2026-10-29/git-safety-before-push.json) |
| 단말·업무 범위 | 단말1대·수동 배정·재배정 없음, 단일 판매자만 적격, 개별 실물 serial 식별 불가. [범위/수용 기준](../02_mvp_requirements.md) |
| 서버 기본 구성 | 큐1개·워커 concurrency1, DB를 기록 기준으로 사용. [작업 코드](../../src/jobs/jobs.ts) |
| 재현성 | Compose·환경 예시·migration 해시·lockfile·컨테이너 digest·CI 제공. [Compose](../../compose.yaml), [migration 도구](../../tools/migrate.ts), [CI](../../.github/workflows/ci.yml) |
| 하드웨어 | Pi5/Debian13 arm64/C270, HDMI 대신 사용자 선택 VNC. 실시간 QR gate는 BLOCKED, 물리 HDMI·전원 차단·SD 손상은 NOT_RUN. [장비 기록](../../reports/hardware-validation.md) |
| 종료 기준 | 소프트웨어가 실행돼도 모든 필수 gate 전에는 전체 MVP 완료·`mvp-v1`·08 확장 완료를 선언하지 않음. [완료 기준](../07_delivery_plan.md) |

환경은 개발용 WSL2 Ubuntu22.04 x86_64·Docker Desktop이며, 장비는 별도 ARM64다.
코드 설치·실행 성공을 깨끗한 Pi 환경 전체 자동 설치 성공으로 확대하지 않는다.
[개발 환경](../../reports/environment.md), [Pi 설치 증거](../../reports/hardware-2026-10-28/runtime-install.json)

## 4. 기술 스택

아래 버전은 ‘현재 최신 추천’이 아니라 저장소 lockfile/실행 기록의 고정 버전이다.
선정 이유가 없는 항목은 역할만 설명하고 대안 대비 우수성을 추측하지 않았다.

| 기술 | 실제 용도·버전 | 기록으로 확인되는 선택 이유 |
|---|---|---|
| TypeScript / Node.js | TS5.9.3 / Node24.22.1, 서버·단말·검증 도구 | JD와 연결된 기본 스택, 공통 웹/HTTP 계약 및 ARM64 단말. 안정/호환 버전 확인·고정 기록 있음 |
| NestJS | 12.2.0, HTTP 서버 | JD 스택과 연결. 일반 Controller/DI 중심 구조 대신 OpenAPI의 operationId를 핸들러에 연결하는 [실제 어댑터](../../src/server/http.ts) 사용. 다른 프레임워크와 비교 측정은 없음 |
| MikroORM / MySQL | 7.2.5 / 8.4 계열, 서버 영구 기록 | ADR-04/05/11의 트랜잭션·DB 제약 요구. 실제 구현은 ORM 연결/트랜잭션과 명시적 SQL을 주로 사용하며 풍부한 엔티티 모델 성과로 표현하지 않음 |
| SQLite (`node:sqlite`) | 단말 파일 DB, 원본 준비 인덱스, 대사용 파생 인덱스 | 단말은 연결 장애 중 기록 보존, 대사 인덱스는 전체 JS 컬렉션 제거. 세 DB의 목적·내구성 설정은 서로 다름 |
| Redis / BullMQ / ioredis | Redis7.4 계열 / BullMQ6.5.0 / ioredis6.0.0, 후속 job | 작업·집계 비동기 실행. DB outbox를 진실의 기준으로 두며 Redis 수신을 업무 ACK로 취급하지 않음 |
| React / Vite | 19.3.1 / 8.3.5, 운영·단말 화면 | 공통 웹 화면이라는 설계 방향은 기록됨. React/Vite 자체의 다른 UI 대안 대비 선정 과정은 **확인 필요** |
| ZXing | browser0.2.1 / library0.23.0, QR 해독 | 웹캠 QR 방향은 사용자 요구. 라이브러리 간 비교 근거는 **확인 필요**; 광학 최종 gate는 미통과 |
| Ajv / YAML / csv-parse | Ajv8.20.0 등, OpenAPI 검증·CSV 파싱 | 실제 계약/입출력 검증과 스트리밍 파싱에 사용. 라이브러리별 대안 선정 근거는 **확인 필요** |
| Python3 / Docker Compose / GitHub Actions | CSV 준비·진단·측정, 서비스 구성, CI | 재현 환경과 시험 자동화라는 목적. 서비스 간 통신/DB 상태는 실제 통합 시험으로 확인 |

버전/의존성은 [package.json](../../package.json), [lockfile](../../package-lock.json),
[초기 환경 결정](../../reports/environment.md), 판단 이유는 [ADR](../09_decisions_sources.md)를 근거로 한다.

## 5. 시스템 아키텍처

모듈형 모놀리스의 API와 워커를 별도 프로세스로 실행한다. 주문 Source는 모의 외부 API이고,
React 단말은 로컬 agent를 통해 SQLite에 기록한다. 서버 확정 후에만 MySQL 기반 집계에 포함한다.
[Mermaid 구성도와 데이터 흐름](architecture.md#5-시스템-아키텍처)

## 6. 핵심 기능 및 구현

페이지 원자 수집, 품질 분류, 작업/배정, 로컬 이벤트, 서버 멱등 적용, 운영 정정·집계와
독립 대사를 구현했다. API/DB·트랜잭션 경계와 실행 근거는
[핵심 기능 상세](architecture.md#6-핵심-기능-및-구현)를 따른다.

## 7. 주요 기술적 의사결정

오프라인 기록을 SQLite에 남기고, ACK를 MySQL 커밋 뒤로 제한하며, DB 제약/이벤트 ID/순서로
중복 효과를 막고, 후속 job은 outbox에서 복구한다. 대사는 디스크 인덱스로 최대 RSS를 줄이는
대신 시간·디스크 사용을 늘렸다. 각각의 문제·고려사항·선택·결과는 [결정 기록](architecture.md#7-주요-기술적-의사결정)에 연결했다.

## 8. 트러블슈팅

독립 검증의 IV-01~07과 대사 개선, 원본 조회 계획을 [STAR 사례](troubleshooting.md)로 정리했다.
시간대 오류·대사 false-PASS·확정 작업 재노출은 실패 전후 시험이 있고, 카메라 콜백/단말
페이지 누락은 수정 전 실행 실패 증거의 한계도 표시했다. 하네스/환경 문제는 제품 결함과 별도다.

## 9. 테스트 및 검증

전체99,441주문 대사, 서로 다른 적격1,000건씩의 두 F1, 보조 합성1,000건, 실제 Pi2작업을
구분한다. 최신 소프트웨어 회귀는 단위17개·통합23개이며, 통합1개 안에 정상·손상43사례 비교가
포함된다. 이번 문서 작성에서 업무/장비 시험을 재실행한 것으로 표시하지 않는다.
[입력·환경·방법·상태별 검증표](verification-results.md#9-테스트-및-검증)

## 10. 성능 및 결과

최종 3쌍 비교의 최대 Node RSS 중앙값은 505.008→251.457MiB(50.21% 감소),
시간은 9.081→13.416초(47.73% 증가), 관측 임시 디스크 최대 중앙값은
0.027→73.949MiB다. 전체 서비스 메모리/처리량 개선이 아닌 **대사 프로세스의 절충**이다.
[측정 조건·결과](verification-results.md#10-성능-및-결과),
[원 측정 JSON](../../reports/audit-memory-2026-10-29/paired-final/comparison.json)

## 11. 한계 및 개선 방향

실시간 QR·물리 전원/SD·수동 시연, 제한 메모리·장시간/대규모 부하·기업 운영 효과는
미확인이다. 먼저 광학 gate를 완료하고, 이후 제한 메모리 실험과 소유권 정책을 갖춘
다중 단말·실제 외부 연동을 별도 검증할 수 있다. 현재 구현 실적으로 쓰지 않는다.
[미완료 상태·후속 실험안](verification-results.md#11-한계-및-개선-방향)

## 12. 개인 기여 및 회고·AI 활용 방식

사용자의 요구/제약/장비 조작과 Codex의 구현/시험/수정은 구분해서 기술한다.
Git 작성자 이름만으로 코드의 인간 작성자를 판정하지 않는다. 명세 원작성자·실제 인원·
개인별 설계 판단·학습·총 시간·개발 생산성 개선은 **확인 필요**다.
[작업 분할·독립 검증·수정 사례·활용 문장과 확인 목록](contribution-ai.md)
