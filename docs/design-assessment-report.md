# 설계: 전환 준비도 평가서 + 회귀 코퍼스 (v0.37)

`generate_egovframe_report(sections=["assessment"])` 와 `test:migrate-corpus` 의 설계 기록입니다. 코드는 `src/assessment.ts`(평가·등급·Markdown), `src/report.ts`(절 조립·저장), `scripts/corpus-lib.mjs`·`scripts/generate-migration-corpus.mjs`·`test/migrate-corpus.mjs`(코퍼스), 데이터는 `catalog/migration-corpus.json` 입니다.

## 1. 문제

공공 SI 현장에서 "이 3.x/4.x 시스템을 5.x 로 옮기면 무엇이 얼마나 걸리고, 지금 공급망 상태는 어떤가"를 물으면 v0.36 까지는 도구 다섯 개(`diagnose` → `migrate` 진단 → `check_egovframe_dependencies` → 보안 점검 → `generate_egovframe_sbom`)를 차례로 불러 사람이 합쳐야 했습니다. 또 전환 규칙·의존성 기준은 데이터(`catalog/*.json`)라 갱신이 쉬운 대신, 갱신이 실제 자산에서 어떤 결과 변화를 낳는지는 단위 픽스처로만 확인했습니다. 4.x→5.x 경로는 실제 4.x 자산으로 확인한 적이 없었습니다.

## 2. 평가서

### 2.1 구성

한 번의 호출로 아래 여섯 절을 만듭니다. 새 분석은 없고 기존 함수의 결과를 재배열합니다 — 평가서가 다른 도구와 다른 숫자를 내는 일이 없게 하기 위해서입니다.

| 절 | 출처 | 내용 |
|---|---|---|
| 1 개요 | `diagnoseProject` · `migrateProject` · `checkDependencies` | 빌드 도구, RTE 버전과 좌표 세대(`sourceEra`), parent 종류·상태, Java, DbType, 공통컴포넌트 수·id, AI 계층·매니페스트, 스캔 파일 수 |
| 2 전환 범위 | `migrateProject` | 자동/수동 건수, 종류별 표(수동·자동 혼합 종류는 둘 다), 재조립 권고 컴포넌트, 제거된 API 참조 수, **예상 수동 작업 상위 N** — 수동 항목을 (종류, 대상) 으로 묶어 건수 순 |
| 3 의존성 | `checkDependencies` | 판정 집계, 조치 목록(기준 미만·전환 대상·교체 필요·버전 없음 → 한 줄 조치 문구), `resolve=true` 면 해석 요약과 전이 포함, `offline=false` 면 OSV 취약점, 벤더·기준 없음은 참고 |
| 4 보안 설정 | `checkDependencies().checks` | 충족·누락·해당 없음 수와 근거 2줄 |
| 5 SBOM | 파일 읽기 | `sbomPath`(기본 `sbom/bom.cdx.json`)가 CycloneDX 문서면 component 수·spec·생성 시각·vulnerabilities 수. 평가서는 SBOM 을 만들지 않습니다(빌드 도구 실행은 `generate_egovframe_sbom` 의 일) |
| 6 등급과 근거 | `computeGrade` | 두 축의 등급·점수·요인 표·주의, 그리고 **산식 전문** |

Markdown 과 `format=json`(`outputSchema` 선언, `structuredContent` 에는 Markdown 본문 제외)을 제공하고, `outputPath` 를 주면 프로젝트 안 상대 경로에 **새 파일로만** 저장합니다(기존 파일 거부, `..`·절대·symlink 이탈 거부 — SBOM 과 같은 검사, transaction, `dryRun`). 덮어쓰기 옵션을 두지 않은 것은 도구를 비파괴(`destructiveHint: false`)로 유지하기 위해서입니다. 대신 `readOnlyHint` 는 뗐습니다(파일을 만들 수 있고 `resolve`·`offline=false` 는 네트워크를 씁니다) — 읽기 전용 도구는 14 → 13종.

`sections` 기본값은 `["components"]`(v0.16 리포트 그대로)라 기존 호출의 출력은 바뀌지 않습니다. `["components","assessment"]` 는 두 절을 `---` 로 이어 붙입니다.

### 2.2 등급 산식

원칙: **사람이 리포트의 숫자만으로 다시 계산할 수 있어야 한다.** 그래서 요인·구간·점수를 데이터(`MIGRATION_RUBRIC`·`SUPPLY_CHAIN_RUBRIC`)로 두고 리포트 6절에 그대로 인쇄하며, 테스트가 리포트의 요인 값으로 점수와 등급을 재계산해 같은지 단언합니다. 비용·공수(사람·조직마다 다름)는 산정하지 않습니다 — 건수와 등급까지가 범위입니다.

요인별 점수를 더한 합계로 등급을 정합니다: **A = 0 · B ≤ 3 · C ≤ 7 · D > 7** (두 축 공통).

**전환 난이도** (최대 11점)

| 요인 | 0점 | 1점 | 2점 | 3점 | 출처 |
|---|---|---|---|---|---|
| 수동 전환 항목 수 | 0 | 1–20 | 21–100 | 101+ | 진단 `action=manual` |
| 재조립 권고 공통컴포넌트 수 | 0 | 1–5 | 6–20 | 21+ | `kind=component-reassemble` |
| 제거된 API 참조 수 | 0 | 1–10 | 11–100 | 101+ | `class-removed`·`component-class-removed`·`removed-module`·`xml-namespace` |
| 현재 좌표 세대 | 5.x | 4.x · unknown | 3.x | — | `sourceEra` |

**공급망 상태** (최대 13점)

| 요인 | 0점 | 1점 | 2점 | 3점 | 출처 |
|---|---|---|---|---|---|
| 기준 미만 의존성 수 | 0 | 1–3 | 4–10 | 11+ | `status=outdated`(resolve 면 전이 포함) |
| 전환 대상·교체 필요 의존성 수 | 0 | 1–3 | 4–10 | 11+ | `status ∈ {legacy, replace}` |
| 알려진 취약점이 있는 의존성 수 | 0 | 1–2 | 3–9 | 10+ | OSV(`offline=false`); 미조회면 0점으로 계산하고 ⚠️ 주의를 붙임 |
| 보안 설정 누락 수 | 0 | 1–2 | 3+ | — | 점검 5종의 `missing` |
| 5.x parent·Java 기준 | 둘 다 충족 | 하나 미달 | 둘 다 미달 | — | parent 없음·other·구버전 +1, Java 미만·미검출 +1 |

벤더 배포·기준 없음·버전 없음 의존성과 공통컴포넌트 수 자체는 등급에 넣지 않습니다(판단 보류 항목을 점수로 바꾸지 않기 위해).

**구간을 정한 근거** — 양 끝은 실제 자산입니다.

| 자산 | 수동 | 재조립 | 제거 API | 세대 | 전환 | 기준 미만 | 전환·교체 | 보안 누락 | parent·Java | 공급망 |
|---|---|---|---|---|---|---|---|---|---|---|
| 공식 5.x 템플릿 `egovframe-web`(pom) | 0 | 0 | 0 | 5.x | **A** (0) | 0 | 0 | 3 | 1(parent 5.0.0 < 5.0.2) | **B** (3) |
| 공통컴포넌트 v4.3.2 전체 | 717 | 155 | 552 | 4.x | **D** (10) | 13 | 27 | 0 | 2 | **D** (8) |
| 공통컴포넌트 v3.10.0 전체 | 808 | 159 | 636 | 3.x | **D** (11) | 19 | 30 | 1 | 2 | **D** (9) |
| 4.x 소형 픽스처(컴포넌트 없음, javax 몇 개) | 2–3 | 0 | 0 | 4.x | **B** | — | — | — | — | — |
| 4.x 중형 가정(컴포넌트 5종 복사) | ~30 | 5 | ~25 | 4.x | **C** (6) | — | — | — | — | — |

공통컴포넌트 전체 트리(165종)는 상상할 수 있는 가장 무거운 입력이고 그보다 작은 모든 프로젝트가 B–C 에 분포하도록 1→2점, 2→3점 경계(20/100, 5/20, 10/100)를 잡았습니다. 공식 템플릿의 공급망 B 는 사실에 근거합니다 — pom 만 있는 템플릿은 CSRF·XSS 필터·보안 헤더 설정이 없고, Initializr 고정 commit 의 parent(5.0.0)는 기준(5.0.2)보다 낮습니다. 취약점을 조회하지 않은 등급은 "확정 등급"이 아니라고 리포트에 적습니다.

### 2.3 결정 사항

- 평가서는 자체 분석을 하지 않는다(다른 도구와 숫자가 어긋나지 않게).
- 등급은 데이터와 재계산 테스트로 고정한다. 구간을 바꾸면 `MIGRATION_RUBRIC`/`SUPPLY_CHAIN_RUBRIC` 과 이 문서를 함께 고치고 코퍼스 기대값(등급 포함)을 갱신한다.
- SBOM 은 "있으면 요약"만 한다 — 빌드 도구 실행과 파일 생성은 그 도구의 책임.
- `outputPath` 는 새 파일만, 덮어쓰기 없음(비파괴 유지).

## 3. 회귀 코퍼스

### 3.1 무엇을 고정하나

`catalog/migration-corpus.json` 에 공식 `egovframe-common-components` 두 태그를 커밋 sha 와 함께 기록하고, 각 트리에 (1) 진단 `migrateProject`, (2) `applyMigration(dryRun)`, (3) `checkDependencies`(오프라인), (4) `assessProject` 를 돌린 측정값을 `expected` 로 둡니다.

| id | 태그 | 커밋 | 세대 | 경로 |
|---|---|---|---|---|
| `cc-3.10.0` | v3.10.0 | `aaebaa5` | 3.x | 3.x → 5.x (패키지 접두어 + Jakarta + 좌표) |
| `cc-4.3.2` | v4.3.2 (4.x 마지막) | `bfa2ef5` | 4.x | 4.x → 5.x (Jakarta + 좌표 이름) — 실제 자산으로는 첫 확인 |

측정값: `javaFiles`·`filesScanned`, `migration{sourceEra, rteVersion, items, auto, manual, files, byKind, reassemble, removedApiRefs, unknownClasses}`, `apply{items, edits, files, conflicts, skippedManual}`, `dependencies{findings, summary, parentKind, java, unknown[], vendor[], checksMissing[]}`, `grades{migration, migrationScore, supplyChain, supplyChainScore}`.

### 3.2 부분 트리

전체 저장소는 태그당 200–250MB(`src/script` 의 DDL 144MB, 폰트·이미지)이지만 스캐너가 보는 텍스트 파일은 `pom.xml`·`src/main/java`·`src/main/resources`·`src/main/webapp/WEB-INF`·`src/test` 에 있습니다. 코퍼스는 이 `include` 목록만 `git clone --depth 1 --filter=blob:none --sparse` + `sparse-checkout set --no-cone` 으로 받습니다(태그당 ≈ 3초, 캐시 ≈ 50MB). 기대값은 **이 부분 트리 기준**이며(예: 3.10.0 의 `javaFiles` 1,125 — 전체 1,148 에서 `ant_script` 등 제외), `include` 가 바뀌면 캐시 표식(`.egov-corpus.json`)이 달라 다시 받습니다. 체크아웃 커밋이 기록과 다르면(태그 이동) 실패합니다.

캐시 위치: `EGOV_CORPUS_CACHE` > `<repo>/.corpus-cache`(gitignore). CI 는 `actions/cache` 로 `catalog/migration-corpus.json` 해시를 키로 보관합니다.

### 3.3 판정

숫자는 `|측정 − 기대| ≤ max(abs, round(기대 × pct))`(기본 pct 1%, abs 0 — 작은 수는 사실상 완전 일치), 문자열·배열·불리언은 완전 일치입니다. 기대값과 별개로 절대 조건도 단언합니다: 세대 판정, 확인 필요 클래스·알 수 없는 좌표 0건, 기준 없음은 `xerces:xercesImpl` 뿐, dryRun 계획 = 자동 항목 전부·충돌 0, 공통컴포넌트 전체가 재조립 권고, 두 축 D, 측정 60초 미만. 그리고 두 세대의 관계(3.x 만 RTE 패키지 접두어 치환, 4.x 의 system scope 로컬 jar 9건은 벤더)도 봅니다.

규칙·기준·스캐너를 **의도적으로** 바꿔 결과가 움직이면 `npm run generate:migration-corpus` 로 기대값을 다시 만들고 변경 이력에 적습니다(`--check` 는 기록 없이 차이만 출력). 기대값에는 생성 당시 서버 버전·규칙 태그·기준 조사일이 남고, 테스트는 그것이 현재 동봉본과 같은지 먼저 확인합니다.

### 3.4 코퍼스가 보여 준 것 (2026-10-04)

- v0.36 의 `vendor` 소급이 4.3.2 pom 의 `project:*` system scope jar 9건을 전부 벤더로 분류해 기준 없음은 두 세대 모두 `xerces:xercesImpl` 1건입니다.
- 두 트리 모두 `class-unknown`·`coordinate-unknown` 0건 — 규칙 카탈로그가 공식 자산의 RTE 참조를 전부 설명합니다.
- 4.x 트리에는 RTE 패키지 접두어 항목(`package`)이 없고(이미 `org.egovframe`) `jakarta-package` 577건·`component-class-removed` 524건이 남습니다. 즉 4.x→5.x 의 수작업은 Jakarta 가 아니라(자동) **5.x 에서 바뀐 공통컴포넌트 클래스**입니다 — 재조립 권고가 그 답입니다.
- 공통컴포넌트 트리 자체는 두 축 모두 D 가 맞습니다(165종 전부 재조립 대상). 등급 구간의 상단을 정하는 기준점으로 씁니다.
- 결함 수정은 없었습니다. v0.36 에서 선행 조사로 고친 `project:*`·`javax.faces` 가 전부였고, 코퍼스는 그것을 고정했습니다.

## 4. 릴리스 재개 (같은 PR 에 포함)

v0.36.1 의 첫 자동 배포는 npm 게시 뒤 "전파 확인" 단계가 2분(20초 × 6) 안에 끝나지 않아 실패했고, 그 뒤 단계(태그·Release·Registry)가 건너뛰어졌으며, 재실행은 "npm 에 이미 있음"으로 멈췄습니다(태그·Release 는 수동으로 복구). `scripts/release-check.mjs` 가 이제 원격 상태(npm 게시 여부와 npm 이 기록한 `gitHead`, 태그, GitHub Release, MCP Registry 버전)를 보고 **남은 단계만** 고릅니다 — npm 만 있으면 태그를 `gitHead` 커밋(현재 `main` 의 조상이어야 함)에 만들어 npm 패키지와 태그가 항상 같은 코드를 가리키게 하고, 전파 확인은 10분까지 기다린 뒤 경고만 남기고 진행합니다. 판정표는 `test/release.mjs` 가 단언합니다.
