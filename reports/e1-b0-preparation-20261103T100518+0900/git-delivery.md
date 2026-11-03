# Git 전달 범위

기준 SHA: `954bb692a244803b8aad695539d81afdcb81a091`.
브랜치: `e1/b0-preparation-20261103T100518-0900`.
worktree: `/home/leah/e1-lab/e1-b0-preparation-20261103T100518+0900/worktree`.

- 계측·업무 의미 검증 commit: `85663cd533be0039b4dd4ef4af53ef94eac194dc`.
- 격리 실행 도구·정책 commit: `65d052df6949cc8f60ed4ead4e9dd3d32db3e10b`.
- 이 문서와 선택한 compact 결과는 후속 문서 commit으로 보존한다. 문서 commit 자체 SHA는 Git log와 push 후 로컬 `push-result.json`에 기록한다.
- 같은 origin의 `refs/heads/e1/b0-preparation-20261103T100518-0900`에만 push한다. main 병합/checkout/reset/stash/pull·태그·기존 서비스 재배포는 수행하지 않는다.

선택 추가 대상: 사용자 명세의 worktree 사본 `docs/E1_B0_Preparation_Spec.md`, 출력 제외 규칙 `.gitignore`, 아래 새 보고서 파일이다. `git add -A`는 쓰지 않는다.

- `README.md`
- `b0-compose.json`
- `b0-readiness.json`
- `b0-ready-manifest.json`
- `baseline-contract-hashes.json`
- `build-final.txt`
- `clock-final.json`
- `coverage-final.json`
- `failed-attempt-01.json`
- `failed-attempt-02.json`
- `generated-secret-check.json`
- `git-safety.json`
- `image-dependencies.json`
- `input-runtime-off.json`
- `input-runtime-on.json`
- `instrument-only.diff`
- `observability-unit-final.txt`
- `observation-examples.json`
- `observation-schema-check-final.json`
- `on-off-equivalence.json`
- `policy-tests.txt`
- `preservation-final.json`
- `redis-runtime-final.json`
- `runtime-artifact-hashes.json`
- `runtime-isolation-final.json`
- `semantics-final.json`
- `smoke-off-interruption.json`
- `smoke-off-review.json`
- `smoke-on-result.json`
- `spec-received.json`
- `git-delivery.md`

초기 큰 original-before inventory, 초기 build/단위/schema 관측, preflight와 원시 실험 디렉터리는 로컬에 보존한다. private environment·원본·SQLite·volume·큰 raw metrics는 Git에 추가하지 않는다. 초기 Git 상태는 [보존 결과](preservation-final.json)와 원래16개 조사 파일의 SHA로 대조했다. 원 저장소의 untracked 명세는 사용자가 뒤에 제공한 파일이며 그대로 보존했다.

`git-safety.json`은 reachable 이력·tracked/untracked 후보의 bounded 패턴 검사다. worktree에 .env를 넣지 않아 그 도구의 exact-local-secret 수는0이다. 별도 [generated-secret-check.json](generated-secret-check.json)이 새 실험에서 생성한 실제 secret 값들과 후보 파일을 대조했으며 값은 출력하지 않았다. 임의의 모든 개인정보를 판별한다고 주장하지 않는다.

push 결과는 실제 명령 뒤에만 기록하며 로그인/권한을 새로 설정하거나 force push하지 않는다. 로컬 push receipt는 Git에서 제외해 자기 commit SHA를 문서에 넣는 순환을 피한다.

코드/문서의 whitespace 검사는 통과했다. 원문 명세의 Markdown hard-break 공백2곳과 unified diff의 빈 context 행은 원문/patch 보존을 위해 검사 예외로 구분했다.
