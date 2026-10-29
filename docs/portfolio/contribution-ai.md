# 12. 개인 기여 및 회고·AI 활용 방식

[개요](README.md) · [의사결정](architecture.md) · [수정 사례](troubleshooting.md) · [검증 결과](verification-results.md)

## 12.1 기록에서 개인 기여를 판정하는 방법

근거를 **저장소 파일/실행 산출물/커밋**과 **현재 대화에서 확인되는 사용자 지시·완료 답변**으로
나눈다. 전체 원대화 transcript는 저장소에 없으므로 아래 대화 관련 설명은 이 세션의 문맥을
근거로 하며, 제3자가 저장소만으로 원문/발언 시각을 검증할 수 있는 것은 아니다.
개인의 코드 작성 비율·최초 설계자·학습 내용은 별도 확인 없이 추정하지 않는다.

| 주체 | 확인 가능한 활동 | 근거·한계 |
|---|---|---|
| 사용자 | docs/계약 선독, S0→S7 진행, T01~T34·MVP gate, 확장 보류를 지시 | 이 대화의 최초 구현 요청. [명세](../07_delivery_plan.md)·[진행 기록](../../reports/progress.md)과 방향이 일치 |
| 사용자 | 핫스팟 다운로드 조건·비밀/원본 보존·위험 작업 확인·ACK/중복/SQLite/outbox 불변 조건 전달 | 최초 작업 지시에서 확인. 세부 설계가 모두 사용자의 독자 발명이라는 증거는 아님 |
| 사용자 | GitHub 로그인·Docker 준비, SSH 공개키 등록 완료 답변 | 이 대화의 단계별 답변과 [진행 기록](../../reports/progress.md). 비밀번호/토큰은 문서에 포함하지 않음 |
| 사용자 | C270 물리 연결, HDMI 대신 VNC 선택, 카메라 방향 조정, 사진 재사용 요청, sudo 정상 reboot 직접 실행 | 이 대화의 완료 답변과 [장비 결과](../../reports/hardware-validation.md). VNC 전체 수동 UI 조작을 사용자가 수행했다고 확대하지 않음 |
| 사용자 | 기존 PASS를 신뢰하지 않는 독립 검증과 결함 수정 요청, 대사의 동일 조건 전후 비교·손상 시험·보존 요구 | 이 대화의 별도 검증/메모리 개선 지시. [독립 결함 기록](../../reports/independent-2026-10-28/findings.md), [측정 기록](../../reports/audit-memory-2026-10-29/README.md)으로 후속 산출물 확인 |
| 사용자 | 확인된 Pi에 한정한 코드/Node/단말 토큰 전송·실행 승인 | 이 대화의 명시적 승인과 [장비 전송 범위](../../reports/hardware-validation.md). 관리/DB 자격증명·원본 전송 승인으로 확대하지 않음 |
| Codex | 환경 조사·고정, 코드/Compose/migration/시험·문서 작성, 실행·실패 분석·수정·커밋/push | 이 대화의 작업 흐름과 [커밋 이력](https://github.com/leah-1ee/logistics-automation/commits/main), [단계 기록](../../reports/progress.md). 사용자 직접 수정분을 파일별로 분리한 원장/기여율은 없음 |
| Codex | 별도 CSV 오라클·실제 DB/HTTP 장애 경계·새 F1·Pi/브라우저 검증 수행 | [독립 검증](../../reports/independent-2026-10-28/verification.md), [실제 UI](../../reports/browser-validation.md), [최종 메모리 측정](../../reports/audit-memory-2026-10-29/README.md) |
| 확인 필요 | 문서 세트의 최초 원작성자, 원래 JD, 전체 팀 규모, 사용자 개인의 상세 설계/코딩/리뷰 기여 | 최초 명세는 [325662e](https://github.com/leah-1ee/logistics-automation/commit/325662e)에 보존됐지만 보존 커밋이 작성 주체·투입 시간을 증명하지 않음 |

커밋의 author가 Leah라는 사실만으로 ‘사용자가 코드를 직접 작성했다’고 판정하지 않는다.
마찬가지로 Codex에 작업을 요청했다는 사실만으로 모든 판단과 검토를 AI가 독자 수행했다고
단정하지 않는다. 역할은 위에 확인된 행위 단위로 표현한다.

## 12.2 요구·완료 기준·제약을 전달한 단위

현재 대화의 사용자 요청에는 다음 문구가 포함되어 있다. 인용은 확인 가능한 지시의 예이며
새로 만든 프롬프트나 일반적인 AI 사용법 예시가 아니다.

> “docs 폴더에 있는 모든 문서와 openapi.yaml, examples.json, document_checks.json을 먼저 읽고 명세를 따르세요.”
>
> “MySQL 커밋 후에만 단말 이벤트 ACK를 반환합니다.”
>
> “기존 PASS 결과를 그대로 신뢰하지 말고 실제 코드와 실행 결과로 검증하세요.”

작업은 다음 산출물과 연결되었다. 이 연결은 **커밋/시험 단위가 확인된다는 뜻**이며,
한 단계의 모든 필수 gate가 다음 커밋 전에 통과했다는 의미는 아니다. 실제 장비 gate는
소프트웨어 개발 중 BLOCKED였다가 후속 시험으로 일부 해소됐다.

| 단위 | 전달한 계약·완료 기준 | 확인되는 산출물/수정 |
|---|---|---|
| S0 계약·환경 | 설치/호환 버전·보존·Compose·기본 health/auth | [240c1a6](https://github.com/leah-1ee/logistics-automation/commit/240c1a6), [환경 기록](../../reports/environment.md), [문서 검사](../../tools/check-documents.ts) |
| S1 수집·분류 | 원본 전체/동일 페이지/체크포인트/사유/수량 T01~04·T32 | [6c186ed](https://github.com/leah-1ee/logistics-automation/commit/6c186ed), [ingestion 시험](../../tests/integration/ingestion.test.ts), 실제 데이터 보완 커밋은 후속으로 존재 |
| S2 작업·배정·Outbox | 적격1주문1작업, 불변 snapshot, Redis 복구 | [9c38112](https://github.com/leah-1ee/logistics-automation/commit/9c38112), [tasks 시험](../../tests/integration/tasks.test.ts), [Redis 시험](../../tests/integration/redis.test.ts) |
| S3 로컬 기록 | 이벤트·상태 동시 저장, 취소/완료·재시작·실제 입력 gate | [b686af1](https://github.com/leah-1ee/logistics-automation/commit/b686af1), [local 시험](../../tests/local.test.ts), 실시간 광학 gate는 미완료 |
| S4 동기화 | 커밋 후 ACK, 중복/seq/부분 배치/격리 | [ff282e4](https://github.com/leah-1ee/logistics-automation/commit/ff282e4), [commit-boundary](../../tests/integration/commit-boundary.test.ts), [sync 시험](../../tests/integration/sync.test.ts) |
| S5 운영·집계 | 정정/이력/메모/재시도/CONFIRMED만 집계 | [7e36ff3](https://github.com/leah-1ee/logistics-automation/commit/7e36ff3), [operations 시험](../../tests/integration/operations.test.ts), [브라우저 후속 검사](../../reports/browser-validation.md) |
| S6·S7 검증/정리 | 전체 대사·1,000작업·장애·실제 장비·재현 문서 | [0288cbe](https://github.com/leah-1ee/logistics-automation/commit/0288cbe), [5f7cbfb](https://github.com/leah-1ee/logistics-automation/commit/5f7cbfb). S7 문서 커밋이 있어도 release gate 미완료 |
| 독립 검증·수정 | 기존 PASS 재검사, 손상/순서/ACK·새 실제 F1 | [b4d4894](https://github.com/leah-1ee/logistics-automation/commit/b4d4894) 등 IV-01~05, [독립 보고서43d606f](https://github.com/leah-1ee/logistics-automation/commit/43d606f) |
| 실제 장비·운영 UI | 직접 연결은 사용자, 명령/진단/자동 브라우저는 Codex, 미확인 gate 유지 | [하드웨어 기록 a7bb633](https://github.com/leah-1ee/logistics-automation/commit/a7bb633), [UI 수정 d7afe65](https://github.com/leah-1ee/logistics-automation/commit/d7afe65) |
| 대사 메모리 개선 | 기준 측정→선택→정확성/손상 비교→3쌍 재측정·보존 | [92d6ba5](https://github.com/leah-1ee/logistics-automation/commit/92d6ba5), [53b3ee3](https://github.com/leah-1ee/logistics-automation/commit/53b3ee3) |

사용자는 매 사소한 구현 선택마다 멈추지 말고 가능한 작업을 계속하되 로그인·관리자 권한·
다운로드 승인·실제 연결처럼 직접 필요한 단계만 안내하라고 했다. 실제로 장비 연결/
공개키/재부팅은 사용자와 단계별로 진행했고, 비공개 원격 저장소의 생성/push도 별도 요청 후
수행했다. 권한 요청은 개발 성과 수치가 아니라 작업 범위·정보 보호의 제약이다.
[진행 기록](../../reports/progress.md), [장비 승인 범위](../../reports/hardware-validation.md)

## 12.3 구현 결과를 검증하고 수정한 과정

1. **요구를 코드/시험에 연결:** M-*/T-*와 OpenAPI/known-answer 예시를 기준으로 입력·결과·
   실패 조건을 고정했다. 문서 검사331assertions/PASS가 제품 완료는 아니라는 범위도
   [document_checks](../document_checks.json)에 명시돼 있다.
2. **기존 정상 경로와 다른 조건 실행:** COMMIT을 실제로 보류/실패시키고, 응답 유실 뒤 같은
   ID를 재전송하고, DB 세션 시간대를 바꾸고, 원본과 서버 projection을 별도로 비교했다.
   [COMMIT 시험](../../tests/integration/commit-boundary.test.ts), [시계 결함 전후](troubleshooting.md#81-iv-01-확정-시각의-시간대-재해석--제품-결함)
3. **검증 누락 자체 수정:** 기존 대사가 raw hash 단독 손상을 PASS한 사실을 재현하고 검사와
   회귀를 보강했다. API/build만 통과한 UI는 한때9요구 NOT_RUN으로 되돌린 뒤 실제 headless
   실행과 DB 대조로 판정했다. [IV-04](troubleshooting.md), [독립 판정](../../reports/independent-2026-10-28/verification.md)
4. **실제 관측으로 가정 수정:** Pi에서 동기화 경고가 남는 문제, 브라우저에서 job 재시도 상세가
   남는 문제를 고쳤다. 사진/폼 입력이 실시간 웹캠 입력의 대체 PASS가 아님을 유지했다.
   [IV-06/07 및 장비 범위](../../reports/hardware-validation.md), [운영 UI](../../reports/browser-validation.md)
5. **성능에도 정확성 검사 유지:** 기준 구현 동결·같은 원본/DB 지문·교차순서3쌍을 사용하고,
   43사례에서 기존 결과와 추가 검출을 분리했다. 중복 무조건 실패 정책을 계약 대조 후
   철회한 이력과 시간/디스크 증가도 남겼다. [측정 기록](../../reports/audit-memory-2026-10-29/README.md)

위 ‘독립 검증’은 동일 프로젝트의 별도 검증 단계/오라클이다. **외부 검증자·별도 모델·
여러 에이전트가 교차 검토했다는 기록은 없다.** 실제로 사용한 모델 이름/버전·모델별 기여·
프롬프트별 비용/오탐률을 측정한 기록도 없어 확정하지 않는다.
[독립 검증의 범위 선언](../../reports/independent-2026-10-28/verification.md)

## 12.4 실제 방법과 연결되는 개발 방식

| 확인된 방법 | 일치하는 범위 | 확대해 부르지 않을 것 |
|---|---|---|
| 명세/계약 기반 구현 | 요구 ID·입출력 스키마·예시 hash·완료 시험을 개발 입력으로 사용 | 명세만으로 오류가 없는 구현을 자동 생성했다는 주장 |
| 기능·회귀 단위의 점진 개발 | S0~S7 기능 커밋과 후속 fix/test 커밋, 요구/시험 기록 연결 | 모든 초기 기능이 선행 테스트로 개발된 엄격한 TDD, Scrum/정식 스프린트 운영 |
| 결함 재현 후 회귀 | 시간대/손상/확정 재노출의 before FAIL→after PASS | 모든 결함에 수정 전 실패 시험이 있다는 주장 |
| 장애 주입·검증 하네스 | 실행 환경·입력·fault trigger·관찰·결과 파일로 불변 조건을 검사 | 특정 AI 개발 방법론 전체를 도입/입증했다는 주장. 시험 하네스가 있다는 사실과 에이전트 일반 성능 평가는 다름 |
| 기준 보존·통제 비교 | 같은 데이터/고정 DB·소스 SHA·준비 실행 제외·3쌍 비교 | 전체 서비스나 기업 운영 성능에 대한 일반화 |
| AI 작업 지시·실행 증거 확인 | Codex에 범위/금지/완료 조건 전달, 별도 재검증과 실패 수정 요청 | 사람 대비 개발 시간/비용 절감률, AI 정확도·생산성 향상률 |

별도 무AI 개발 baseline·전체 시간 기록이 없으므로 ‘개발 시간 N% 절감’은 쓰지 않는다.
커밋 간격은 대기·사용자 연결·인증·장비 상태·AI 실행이 섞여 실제 작업 시간의 대체값이 아니다.
앞으로 비교하려면 동일 과업·난이도·순서 교차·총 시간/수정 비용·최종 품질을 함께 정해야 한다.
이번에는 소급 비교가 불가능하고 새 생산성 실험을 실행하지 않았다.

## 12.5 자소서·포트폴리오에 사용할 사실 문장

다음은 **프로젝트 결과에 대한 문장**이다. ‘내가 직접 설계/구현했다’라는 개인 기여 문장으로
전환하려면 아래 확인 사항을 먼저 보완해야 한다.

> 공개 Olist 주문99,441건을 보존·수집·분류하고 적격96,596건의 출고 작업을 생성하는
> 물류 운영 자동화 프로토타입을 구성했다. 원본과 생성 작업·스캔을 구분하고,
> 전체 수량/상태/집계를 독립 CSV 대사로 확인했다.

근거: [전체 대사](../../reports/audit-memory-2026-10-29/paired-final/round1-disk-indexed-audit.json).

> 단말은 SQLite에 이벤트와 상태를 함께 기록하고, 서버는 MySQL 커밋 후 receipt를 반환한다.
> 응답 유실·중복 전달·Redis 장애를 주입한 시험으로 중복 효과 없이 복구되는 범위를 확인했다.
> 실제 Pi의 정상 재부팅/사진 기반 입력은 검증했으며 실시간 웹캠 QR 최종 gate는 미완료다.

근거: [COMMIT 시험](../../reports/independent-2026-10-28/commit-boundary.tap),
[실제 장애](../../reports/audit-memory-2026-10-29/service-faults.json), [장비](../../reports/hardware-validation.md).

> 대사 도구의 전체 JS 컬렉션을 디스크 인덱스와 스트림으로 바꿔 같은 데이터/고정 DB의
> 3쌍 비교에서 최대 Node RSS 중앙값을50.21% 줄였다. 실행 시간은47.73% 늘었고 관측
> 임시 디스크 최대 중앙값은73.949MiB였다. 정확성 비교와 손상 시험을 함께 유지했다.

근거: [측정 조건·원 수치](../../reports/audit-memory-2026-10-29/paired-final/comparison.json),
[43사례 비교](../../reports/audit-memory-2026-10-29/regression-cases-final.json).

### 개인 서술 전에 확인할 항목

- **기간/인원/역할:** 실제 기획 시작일, 실투입 시간, 종료 여부, 전체 참여 인원, 사용자 직접 작성/리뷰한 파일·시험.
- **동기/JD:** 원래 지원 공고와 선택 이유, 실제 물류 경험 유무. 현재 PRD의 JD 요약만으로 개인 경력을 만들지 않음.
- **판단 주체:** SQLite/Outbox/프레임워크 선택에서 사용자가 직접 검토한 대안·질문·결정이 무엇이었는지.
- **회고:** 실제 이해가 바뀐 부분, 어려웠던 점, 코드를 검토/수정한 방식, 이후 개선 우선순위에 대한 사용자 자신의 설명.
- **기여 표현:** Codex가 구현·실행한 코드/시험과 사용자 자신의 요구·검토·실행을 어떤 범위까지 본인 기여로 설명할지.
- **성과:** 실제 사용자/현장 적용·수작업 비교·기업 연동·개발 시간 절감은 현재 근거 없음. 향후 관측 전에는 수치로 쓰지 않음.

기록에서 얻는 프로젝트 수준의 교훈은 ‘기존 PASS도 검증 누락일 수 있다’, ‘사진/모의 입력과
광학 전체 흐름은 다르다’, ‘RSS 절감은 시간/디스크 비용과 함께 평가해야 한다’이다.
이를 사용자의 개인적 배움으로 확정하려면 본인의 설명이 필요하다.
