# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

**English summary: [README.en.md](README.en.md)** · 도구 설명을 영문으로 받으려면 `EGOVFRAME_LANG=en`

전자정부 표준프레임워크(eGovFrame) 프로젝트 스캐폴딩·조립·진단을 제공하는 **MCP(Model Context Protocol) 서버** — 커뮤니티 PoC

> [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 개념 증명(Proof of Concept) 구현입니다.
> [#628](https://github.com/eGovFramework/egovframe-common-components/issues/628)(eGovFrame MCP Server 제안)을 "프로젝트 생성 → 컴포넌트 조립 → 진단·업그레이드" 수명주기로 구체화했습니다.

Claude, VS Code(Copilot), Cursor 등 MCP를 지원하는 AI 도구에서 **대화 중 즉시** 표준프레임워크
프로젝트를 만들고 공통컴포넌트·AI 계층을 조립할 수 있습니다. 기존 프로젝트 진단, 리포트, 안전한 upstream 재동기화도 지원합니다.

현재 v0.36.1은 **도구 28종(title·annotations·구조화 출력 6종), 공식 템플릿 22종, 설정 템플릿 21종, 5.x 전환 규칙(RTE 18모듈·클래스 331종 + 공통컴포넌트 1,089종 근거)과 적용·검증, 의존성 기준(공식 parent 관리 좌표 139종+계열 6종+Spring Boot BOM 1,473종+RTE 전이 58종)·해석된 의존성 트리·CycloneDX SBOM 과 규칙·기준 drift 감시, 네트워크 진단·AGENTS.md 생성, 공통컴포넌트 카탈로그 190항목(리프 176종+그룹 14종)**을 제공합니다.

## 진행 현황 (2026-10-04)

- **소스 기준**: v0.37.0(`package.json`), 도구 28종·공식 템플릿 22종·설정 템플릿 21종·카탈로그 190항목.
- **안전성 기준선 완료**: [PR #7](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/7)~[#16](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/16)을 반영해 provenance·strict assertion·safe remove와 프로젝트 생성/레시피/직접 조립/AI 조립/업그레이드 transaction을 갖췄습니다.
- **v0.22.0 추가**: `EGOVFRAME_ALLOWED_ROOTS`를 19개 도구 진입점에 적용해 `..`·symlink/junction 이탈을 차단하고, 실패 시 rollback 결과를 구조화해 반환합니다. [PR #16](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/16)은 7파일(+340/−31), 로컬 16종 스위트 전체 통과 후 병합됐습니다.
- **v0.23.0 추가**: `build_egovframe_project` — 생성한 프로젝트를 실제로 빌드(maven/gradle·mvnw/gradlew 자동 감지)하고 컴파일·테스트 오류를 파일/라인 단위로 구조화해 생성→검증 루프를 완성합니다. 타임아웃·로그 상한·허용 root·dryRun 포함. [PR #18](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/18)은 4파일(+458/−3), 오프라인 40단언과 실제 spawn 경로를 검증했습니다.
- **v0.24.0 추가**: 공식 템플릿 커버리지 7 → 10종(`msa-common-components`·`mobile-device-api`·`ai-rag`, 모두 멀티 프로젝트). [PR #19](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/19).
- **v0.25.0 추가**: `test_egovframe_project` — 테스트를 실행하고 빌드도구가 남기는 JUnit XML 리포트(surefire·gradle)를 읽어 스위트·케이스 단위로 결과를 구조화합니다. 실패 케이스의 메시지·예외 타입·테스트 파일/라인, `testFilter`(클래스/메서드 패턴), 이전 실행 리포트 제외, 종료 코드가 0이어도 리포트에 실패가 있으면 실패로 판정. 오프라인 54단언(`npm run test:test`).
- **v0.25.2 추가**: 보안·안정성 보강 — `generate_egovframe_ci`의 `jdk` 입력 검증(생성 YAML 주입 차단), 빌드·테스트 타임아웃 시 프로세스 트리 종료(래퍼가 띄운 JVM 때문에 타임아웃이 걸려도 호출이 끝나지 않던 문제 해결), MCP handshake 서버 버전을 `package.json`과 일치, 의존성 갱신으로 `npm audit` 0건.
- **v0.25.3 추가**: Linux·macOS에서 `npx egovframe-scaffold-mcp`(bin symlink 경유) 실행 시 서버가 기동하지 않고 종료되던 문제 수정, CI를 ubuntu·windows × Node 18·20·22 매트릭스로 확장.
- **v0.26.0 추가**: `sync_egovframe_templates` + `catalog/templates.json` — 그동안 Initializr(프로젝트 22종 zip 카탈로그)·MCP(`TEMPLATES` 10종 저장소 조달)·Development(`wizards.xml` 설정 마법사)에 흩어져 있던 "어떤 공식 프로젝트가 있는가"를 하나의 스키마로 합쳤습니다. 매핑은 `catalog/template-mapping.json` 에서 큐레이션하고(자동 추론 없음), upstream 과의 추가·삭제·변경과 MCP 커버리지 격차(현재 22종 중 9종 대응)를 도구로 조회합니다. 오프라인 148단언(`npm run test:template-catalog`).
- **v0.27.0 추가**: 공식 템플릿 커버리지 10 → **22종**(Initializr 22종 기준 대응 9 → 21종). 단독 저장소가 없는 배치 6종·빈 골격(`web`·`boot-web`)·모바일 2종·MSA 포털 2종을 Initializr 의 zip(Git LFS)으로 조달하며, commit 과 sha256·크기를 고정해 내려받은 바이트를 검증합니다. `sync_egovframe_templates` 가 zip 지문의 upstream 변화도 함께 보고합니다(설계: [docs/design-initializr-zip-templates.md](docs/design-initializr-zip-templates.md)).
- **v0.28.0 추가**: `generate_egovframe_config` — 공식 Initializr 설정 템플릿 21종(datasource·transaction·cache·logging·scheduling·idGeneration·property)을 패키지에 동봉해 **오프라인**으로 Spring 설정 파일을 생성합니다. xml·javaConfig·yaml·properties 형식, Initializr 폼과 같은 필드명·기본값, 기존 파일 보호. 리소스 `egovframe://catalog/config-templates` 로 필드·기본값·선택지를 조회할 수 있고, `sync_egovframe_templates` 가 동봉 템플릿의 upstream 변화를 보고합니다(설계: [docs/design-config-generation.md](docs/design-config-generation.md)).
- **v0.29.0 추가**: `migrate_egovframe_project` 1단계 — 3.x/4.x 프로젝트를 5.x(Jakarta EE 9+, Spring 6, Java 17) 기준으로 스캔해 RTE Maven 좌표·패키지·제거/이동 클래스·`javax→jakarta`·web.xml 스키마·제거된 `egov-*` XML 네임스페이스·교체 필요 라이브러리를 파일·라인 단위로 보고합니다(**읽기 전용**, auto/manual 구분). 규칙은 `egovframe-runtime` 태그(v3.10.0·v4.3.0-Final·v5.0.2-Final) 소스 트리 비교로 생성한 `catalog/migration-rules.json` 에 두고, 목적지 좌표 61건이 실제 Maven 저장소에 있음을 CI 에서 확인합니다. 공식 5.x 템플릿 2종에서 항목 0건(설계: [docs/design-migration.md](docs/design-migration.md)).
- **v0.30.0 추가**: `migrate_egovframe_project` 2단계(`apply=true`) — 진단의 auto 항목을 하나의 transaction 으로 실제 치환합니다(dryRun 기본, 원본 `migration-backup/` 보관, `migration-plan.json`, 실패 시 복구). 3.10 좌표·javax 픽스처를 적용한 뒤 JDK 17 `mvn compile` 통과를 CI 에서 확인합니다. `check_egovframe_dependencies` — 공식 5.x parent 2종에서 추출한 기준(관리 좌표 139종 + BOM 계열 7종, `catalog/dependency-baseline.json`)과 의존성을 대조해 기준 충족/미만/parent 관리/전환 대상/교체 필요/기준 없음으로 분류하고, 보안 설정(sec.security·CSRF·XSS 필터·보안 헤더·HTTPS 저장소) 존재 여부를 근거와 함께 보고합니다. 기본 오프라인, `offline=false` 면 OSV 취약점 조회(설계: [docs/design-dependency-check.md](docs/design-dependency-check.md)).
- **v0.31.0 추가**: 운영 편의 — `diagnose_egovframe_network`(도구가 쓰는 호스트 7종에 DNS·HEAD 프로브, 실패 종류 분류, HTTPS_PROXY+NODE_USE_ENV_PROXY·IPv4 우선·사내 CA 처방을 bash/cmd/PowerShell 명령으로), 모든 다운로드 실패 메시지에 같은 처방 한 줄 부착, `generate_agents_md`(진단 결과로 AI 코딩 도구용 AGENTS.md, ko/en), 영문 README(`README.en.md`)와 `EGOVFRAME_LANG=en` 영문 도구 설명, MCP Registry 메타데이터(`server.json`·`mcpName`). 기획 3개 버전(v0.29–v0.31)이 모두 완료됐습니다.
- **v0.32.0 추가**: MCP 프로토콜 현대화 — 도구 27종을 `registerTool` 로 전환해 `title`(ko/en)과 annotations(`readOnlyHint` 14종·`destructiveHint` 4종·`idempotentHint`·`openWorldHint`)를 `tools/list` 에 노출하고, `format=json` 을 제공하던 5종(`diagnose_egovframe_project`·`validate_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network`)은 `outputSchema` 와 `structuredContent` 를 함께 돌려줍니다(기존 `text` 유지). 테스트 이식성 가드(`scripts/check-test-portability.mjs`, 게이트 포함)와 플랫폼 주입 단언으로 Windows 전용 실패 재발을 막습니다.
- **v0.37.0 추가**: 전환 준비도 평가서 + 회귀 코퍼스 — `generate_egovframe_report(sections=["assessment"])` 가 진단·전환 진단·의존성·보안 설정·SBOM 확인을 한 번에 돌려 여섯 절(개요·전환 범위·의존성 조치 목록·보안·SBOM·**등급과 근거**)의 평가서를 만듭니다. 전환 난이도와 공급망 상태를 각각 A–D 로 매기되 요인·구간·점수 산식을 리포트에 그대로 인쇄해 사람이 재계산할 수 있고(테스트가 실제로 재계산), `format=json`(`outputSchema`)·`outputPath`(새 파일만, transaction) 를 지원합니다. 회귀 코퍼스 `test:migrate-corpus` 가 공식 공통컴포넌트 **v3.10.0·v4.3.2** 부분 트리(커밋 고정, sparse 클론 ≈3초)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 의 기대값과 ±1% 안인지 CI 에서 단언합니다 — 4.x→5.x 경로를 실제 자산으로 처음 확인했고 두 세대 모두 확인 필요 클래스 0·기준 없음 1(`xerces`)입니다. 릴리스 워크플로는 끊긴 배포를 이어 갑니다(npm 의 `gitHead` 커밋에 태그, 전파 대기 10분·경고만). 기획 세 버전(v0.35–v0.37)이 모두 완료됐습니다(설계: [docs/design-assessment-report.md](docs/design-assessment-report.md)).
- **v0.36.0 추가**: 해석된 의존성 트리 + SBOM — `check_egovframe_dependencies(resolve=true)` 가 Maven(`dependency:tree`)·Gradle(`dependencies`)로 전이 의존성까지 해석해 기준·OSV 와 대조합니다(항목마다 `origin`·트리 경로 `via`, 선언과 다르게 해석된 버전은 `differs`). 공식 `egovframe-web` 템플릿은 선언 19건·조치 0 이지만 해석하면 65 artifact 중 기준 미만 11·OSV 권고 24건이 보입니다. 새 도구 **`generate_egovframe_sbom`**(28번째)이 빌드 파일 변경 없이 CycloneDX 1.6 JSON 을 만들고(Maven 은 cyclonedx-maven-plugin 으로 해시·라이선스 포함, Gradle 은 해석 트리로 구성) component 마다 기준 판정(`egovframe:status·basis·baseline`)을, `offline=false` 면 OSV 결과를 `vulnerabilities[]` 로 넣습니다 — 2027년부터 단계화되는 공공기관 SBOM 등록·제출에 쓸 수 있는 형식입니다.
- **v0.35.0 추가**: 릴리스 자동화 — `main` 에서 CI 가 성공하면 `release.yml` 이 네 조건(`server.json` 버전 일치·변경 이력 항목·태그 없음·npm 미배포)을 검사해 npm(OIDC trusted publishing, provenance 자동) → 그 커밋에 태그 → GitHub Release(변경 이력에서 추출) → MCP Registry(GitHub OIDC) 순으로 게시합니다. 사람은 PR 병합만 합니다. 게이트에 `test:release`(판정 함수·릴리스 노트·`npm pack` 내용·크기 상한)와 `server.json` 설명 100자 제한(레지스트리 검증 조건 — 실제 `mcp-publisher validate` 로 발견한 결함 수정)을 추가했습니다.
- **v0.34.0 추가**: 의존성 기준 완성 + 규칙·기준 drift 감시 — `check_egovframe_dependencies` 의 기준에 **Spring Boot BOM 전체**(`spring-boot-dependencies` 3.5.6 직접 항목 + BOM import 44종을 한 단계 풀어 1,473 좌표)와 **RTE 모듈 18종의 전이 의존성**(58 좌표, 어느 모듈이 끌어오는지)을 더해 항목마다 기준 출처(parent 직접·계열·Boot BOM·RTE 전이·전환 규칙)를 표시하고, 국내 벤더·기관 배포 좌표는 `vendor` 로, EOL·이전 좌표(옛 MySQL/Oracle 드라이버·Jackson 1·xmlbeans·Ehcache 2·HttpClient 4·ANTLR 3·Spring Social)는 교체 규칙으로 분류해 공식 공통컴포넌트 3.10 pom 의 '기준 없음'을 17 → 1 로 줄였습니다. `sync_egovframe_templates` 가 동봉 규칙·기준의 upstream drift(`egovframe-runtime`·공통컴포넌트 새 태그, 공식 parent 새 버전, 고정 pom sha256 변화)를 갱신 절차와 함께 보고합니다. 기준 parent 를 5.0.2 로 올렸습니다.
- **v0.33.0 추가**: `migrate_egovframe_project` 3단계 — `verify=true` 가 compile 을 실행해 컴파일 오류를 수동 항목과 연결하고 "처리하면 해결될 오류 수" 순 작업 목록을 냅니다(javac `symbol:`/`location:` 파싱). 규칙 카탈로그(schemaVersion 2)에 공통컴포넌트 3.x→5.x 대응표(`egovframe-common-components` v3.10.0↔v5.0.6, 제거 54·이동 4)를 추가해 `egovframework.com.*` 제거·이동 클래스를 진단하고, 3.x 공통컴포넌트 소스가 섞인 프로젝트에는 컴포넌트 단위 재조립 권고(`skipComponents` 로 치환 제외)를 냅니다.
- **다음 계획**: v0.35–v0.37 기획이 끝났습니다. 다음 기획은 [보류·운영 항목](#보류운영-항목)과 선행 조사를 바탕으로 새로 세웁니다.
- **배포 상태**: npm 최신 배포 버전은 상단 npm 배지와 [npm 패키지 페이지](https://www.npmjs.com/package/egovframe-scaffold-mcp)를 단일 출처로 확인합니다. 이 문서의 버전 표기는 저장소 소스(`package.json`) 기준이며, git 태그 `vX.Y.Z`가 해당 배포본의 커밋을 가리킵니다.

## 제공 도구

| 도구 | 설명 |
|---|---|
| `create_egovframe_project` | 공식 템플릿을 내려받아 projectName(artifactId)·groupId·DB 타입을 적용한 새 프로젝트 생성 |
| `list_egovframe_templates` | 사용 가능한 공식 템플릿 목록 |
| `sync_egovframe_catalog` | 공식 common-components 태그·commit·archive SHA-256/크기/파일 수 검증, `sec.security`와 미매핑 upstream 경로 탐지 |
| `list_egovframe_components` | 선택 설치 가능한 공통컴포넌트 카탈로그 (공식 v5.0.6 고정, **리프 176종 + 그룹 14종** — 리프는 서비스 단위, 그룹 id는 하위 일괄 설치) |
| `add_egovframe_components` | 공통컴포넌트 완전 조립 — 소스·매퍼·JSP와 message·IDGN·scheduling·정적 자산·Spring/web fragment 복사, Maven 좌표 탐지, **컴포넌트별 선별 DDL·DML 생성**(`database`), archive 검증·충돌 전체 거부·쓰기 실패 롤백·`dryRun` |
| `search_egovframe_components` | 키워드로 컴포넌트 검색 (id·이름·설명, 점수순 상위 10건) |
| `remove_egovframe_components` | 설치 매니페스트 기반 트랜잭션 제거 — 의존 컴포넌트·사용자 수정 hash 보호, `dryRun` 분류, `force` 시 `remove-backup/` 백업 후 제거 |
| `validate_egovframe_project` | 조립 프로젝트 무결성 진단 — 파일 존재·DbType↔DB 스크립트 일치 |
| `get_egovframe_guide` | 컴포넌트의 공식 가이드 문서 조회 (egovframe-docs, 151종 매핑) |
| `add_ai_components` | 공식 [egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플 기반 AI RAG 챗봇 조립 — Spring AI(Redis Stack)·LangChain4j(PGVector) 스택 선택(상호 배타), 소스·설정(`application-ai.yml` 프로필)·UI·인프라 복사, **pom 누락 의존성만 마커 구간 삽입**(백업 생성, 제거 시 원복), 충돌 시 전체 거부, `dryRun` 미리보기 (설계: [docs/design-ai-components.md](docs/design-ai-components.md)) |
| `list_egovframe_recipes` | 큐레이션된 레시피(템플릿+컴포넌트 번들) 목록 |
| `apply_egovframe_recipe` | 레시피 하나로 생성→컴포넌트(→AI 계층)까지 조립하고 전체 성공 시에만 최종 경로로 atomic commit. 공식 템플릿이 제공하는 공통기반은 확인·보존하고 추가 컴포넌트만 설치 (`dryRun` 지원) |
| `diagnose_egovframe_project` | 기존/레거시 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치 공통컴포넌트(pathPrefixes 지문)·설정 문제 진단 (읽기 전용) |
| `search_egovframe_docs` | 공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색 — 제목·경로·연계 컴포넌트, 문서 URL·조립용 id 반환 (오프라인) |
| `generate_egovframe_report` | 프로젝트 리포트 — `sections=["components"]`(기본) 설치 컴포넌트·참조 테이블·가이드 링크·이슈, `sections=["assessment"]` 5.x 전환 준비도 평가서(개요·전환 범위·의존성 조치·보안·SBOM·A–D 등급과 산식). Markdown/json, `outputPath` 로 새 파일 저장(선택) |
| `upgrade_egovframe_project` | 설치 컴포넌트를 upstream과 3-way 비교해 갱신 — 사용자 수정 보존, dryRun 기본, 적용 직전 재검증, 파일·백업·매니페스트 단일 transaction (파괴적, 게이트) |
| `explain_egovframe_component` | 컴포넌트 하나의 상세(설명·직접/전이 의존성·역의존·참조 테이블·가이드 링크·설치 명령)를 한 번에 반환 (읽기 전용) |
| `generate_egovframe_ci` | GitHub Actions CI 워크플로(빌드·테스트) 생성 — maven/gradle 자동 감지, dryRun, 기존 파일 보호 |
| `build_egovframe_project` | 생성한 프로젝트를 실제로 빌드(compile·test·package) — maven/gradle·mvnw/gradlew 자동 감지, 타임아웃·로그 상한, 컴파일 오류 파일/라인 구조화, dryRun |
| `test_egovframe_project` | 테스트 실행 + JUnit XML 리포트(surefire·gradle) 구조화 — 스위트별 통과/실패/오류/건너뜀, 실패 케이스 메시지·예외 타입·테스트 파일/라인, `testFilter`, 이전 실행 리포트 제외, dryRun |
| `generate_egovframe_crud` | 공식 Development CRUD wizard 입력 체계 기반 코드 생성 — VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5(선택), Classic/Boot 분기, 전체 충돌 사전 검사 |
| `sync_egovframe_templates` | 공식 프로젝트 템플릿 통합 카탈로그(Initializr·MCP·Development) upstream 대조 — 추가/삭제/변경 항목과 MCP 커버리지 격차, zip 조달 템플릿의 고정 지문(sha256·크기)과 동봉 설정 템플릿의 변화 보고, 동봉 5.x 전환 규칙·의존성 기준 카탈로그의 drift(새 RTE·공통컴포넌트 태그, 새 parent 버전, 고정 pom sha256 변화)와 갱신 절차 보고, 네트워크 필요 |
| `generate_egovframe_config` | 공식 Initializr 설정 템플릿 21종으로 Spring 설정 파일 생성(오프라인 동봉) — datasource(DBCP/C3P0/JDBC·JNDI)·transaction(datasource/JPA/JTA)·cache·logging(log4j2 5종)·scheduling(Quartz 5종)·idGeneration(3종)·property, xml/javaConfig/yaml/properties, Initializr 폼과 같은 필드·기본값, 기존 파일 거부, dryRun |
| `migrate_egovframe_project` | 3.x/4.x 프로젝트의 5.x(Jakarta EE 9+·Spring 6·Java 17) 전환 — **진단**(기본, 읽기 전용): RTE Maven 좌표(`egovframework.rte:egovframework.rte.*`·`org.egovframe.rte:org.egovframe.rte.*` → `org.egovframe.rte:egovframe-rte-*`)·RTE 버전·저장소 URL·5.x parent, 패키지 접두어·이름 변경·제거 클래스(대체 안내), `javax→jakarta` 패키지·의존성 좌표, web.xml 스키마, 제거된 `egov-security/access/crypto` 네임스페이스, 교체 필요 라이브러리를 파일·라인 단위 `auto`/`manual` 항목으로 보고. **적용**(`apply=true`): auto 항목을 transaction 으로 치환, dryRun 기본, 원본 `migration-backup/` 보관·`migration-plan.json`, 실패 시 복구, 적용 후 재진단. **검증**(`verify=true`): compile 실행 후 컴파일 오류를 수동 항목과 연결한 작업 목록(해결될 오류 수 순). 공통컴포넌트 3.x→5.x 대응표(제거·이동 클래스)와 컴포넌트 단위 재조립 권고, `skipComponents` |
| `check_egovframe_dependencies` | 의존성 점검(읽기 전용) — 선언된 의존성(`resolve=true` 면 Maven `dependency:tree`·Gradle `dependencies` 로 해석한 전이 의존성까지, 트리 경로·선언/해석 버전 차이 포함)을 공식 5.x parent 기준(관리 좌표 139종 + Spring/Security/Boot 등 BOM 계열) + Spring Boot BOM 전체(1,473종) + RTE 모듈 전이 의존성(58종)과 대조해 기준 충족/기준 미만/parent 관리/전환 대상(3.x·4.x RTE·javax)/교체 필요(DBCP 1.x·Log4j 1.x·Jackson 1·Ehcache 2 등)/벤더 배포(국내 DBMS·GPKI)/기준 없음 분류(항목마다 기준 출처 표시), 5.x parent·Java 버전 판정, 보안 설정 존재 점검(sec.security·CSRF·XSS 필터·보안 헤더·HTTPS 저장소, 파일·라인 근거). 기본 오프라인, `offline=false` 면 OSV 취약점 조회 |
| `diagnose_egovframe_network` | 도구가 내려받는 호스트 7종(codeload·raw·media.githubusercontent, maven.egovframe.go.kr, repo1.maven.org, registry.npmjs.org, api.osv.dev)에 DNS 조회·HEAD 요청을 보내 도달 여부·소요 시간·실패 종류(DNS·타임아웃·TLS·프록시 인증·거부)를 보고하고, 환경에 맞는 처방(`HTTPS_PROXY`+`NODE_USE_ENV_PROXY=1`, `NODE_OPTIONS=--dns-result-order=ipv4first`, `NODE_EXTRA_CA_CERTS`)을 bash/cmd/PowerShell 명령으로 안내. 프로젝트 디렉터리 불필요, 파일 무기록 |
| `generate_egovframe_sbom` | **SBOM 생성** — Maven/Gradle 프로젝트의 CycloneDX 1.6 JSON 을 빌드 파일 변경 없이 생성(Maven: cyclonedx-maven-plugin makeAggregateBom, 해시·라이선스 포함 / Gradle: 해석된 의존성 트리로 구성). `enrich` 로 component 마다 기준 판정(`egovframe:status·basis·baseline`) 속성, `offline=false` 로 OSV 취약점을 `vulnerabilities[]` 에 포함. 출력은 프로젝트 안 경로(기본 `sbom/bom.cdx.json`), 기존 파일은 `overwrite` 없이는 거부, `dryRun`(기본)은 계획만 |
| `generate_agents_md` | 프로젝트 진단 결과로 AI 코딩 도구용 `AGENTS.md` 생성 — 빌드·테스트 명령(래퍼 감지), RTE·5.x 전환 상태, DbType, 기본 패키지·설정 디렉터리, 설치 컴포넌트(매니페스트 여부), 규칙(좌표·백업 디렉터리·비밀 정보·의존성 기준), MCP 도구 목록. 기존 파일은 `overwrite` 없이는 거부, `dryRun`, ko/en, 파일명 변경(`CLAUDE.md` 등) |

### create_egovframe_project 파라미터

- `projectName` — 프로젝트명(artifactId). 소문자·숫자·하이픈 (예: `my-egov-app`)
- `groupId` — 자바 groupId (예: `egovframework.example`)
- `database` — `hsql`(기본) | `mysql` | `oracle` | `altibase` | `tibero` (템플릿 `Globals.DbType` 지원 값)
- `template` — `simple-backend`(기본, Spring Boot REST) | `simple-react` | `simple-homepage` | `portal-site` | `enterprise-business` | `web-sample` | `msa-edu` | `msa-common-components` | `mobile-device-api` | `ai-rag` | `web` | `boot-web` | `batch-file-scheduler` | `batch-file-commandline` | `batch-file-web` | `batch-db-scheduler` | `batch-db-commandline` | `batch-db-web` | `mobile-web` | `mobile-common-components` | `msa-portal-backend` | `msa-portal-frontend` (전체 22종, `list_egovframe_templates`로 확인)
  - 레거시 템플릿(simple-homepage·portal-site·enterprise-business·web-sample)은 `egovProps/globals.properties`의 `Globals.DbType`에 DB 타입을 적용합니다.
  - `msa-edu`·`msa-common-components`·`mobile-device-api`·`ai-rag`는 멀티 프로젝트라 좌표·DB 자동 적용 없이 원본 그대로 생성하고 README 안내를 반환합니다.
  - `web`부터 `msa-portal-frontend`까지 12종은 **Initializr zip 조달** 템플릿입니다. 고정 commit 의 zip 을 받아 sha256·크기를 검증한 뒤 `pom.xml` 의 `###GROUP_ID###` 등 자리표시자를 채우고, `globals.properties`(배치는 `egovframework/batch/properties/`)에 DB 타입을 적용합니다. `msa-portal-*` 2종은 멀티 프로젝트라 자동 적용이 없습니다.
- `outputDir` — 생성 위치 상위 디렉터리
- `ref` — (선택) 내려받을 브랜치/태그. 미지정 시 템플릿 기본 브랜치. 예: `main`, `v4.3.0` zip 조달 템플릿에 `ref`를 주면 고정 지문 검증을 건너뛰며 결과에 그 사실이 표시됩니다.
- `dryRun` — (선택, 기본 `false`) `true`면 디스크에 쓰지 않고 생성 예정 파일 수·적용 설정만 미리보기

동작: 공식 템플릿 zip 다운로드 → 압축 해제(zip-slip 방지) → `pom.xml`의 groupId/artifactId/name 적용(부모 POM 좌표는 유지) → `application.properties`의 `Globals.DbType` 설정, 프론트엔드 템플릿은 `package.json`의 `name` 설정. 기존 디렉터리가 있으면 거부합니다. 다운로드에는 30초 타임아웃이 적용되어 무응답 시 무한 대기하지 않습니다. `dryRun`으로 먼저 안전하게 미리볼 수 있습니다.

### generate_egovframe_crud 핵심 파라미터

- `projectDir` — 대상 Maven/Gradle 프로젝트
- `tableName`, `entityName` — DB 테이블과 생성할 클래스명 (`entityName` 생략 시 테이블명에서 변환)
- `basePackage` — 기본 패키지. mapper·VO·service·impl·controller 패키지를 개별 재정의할 수도 있습니다.
- `fields` — `columnName`, `javaType`, `jdbcType`, `primaryKey`, `generated`, `nullable`, `label` 컬럼 스펙. 안전한 update/delete 생성을 위해 기본키가 최소 1개 필요합니다.
- `profile` — `classic`(Spring MVC+JSP) 또는 `boot`(REST Controller)
- `checkDataAccess`, `checkService`, `checkWeb` — 공식 `wizard.xml`의 생성 그룹과 대응
- `includeJsp`, `withTest`, `dryRun` — JSP·JUnit 5 테스트 선택 생성 및 무기록 미리보기

```text
generate_egovframe_crud(
  projectDir="/work/my-egov-app",
  tableName="SAMPLE_BOARD",
  entityName="Board",
  basePackage="egovframework.example.board",
  profile="classic",
  fields=[
    { columnName: "BOARD_ID", javaType: "Long", jdbcType: "BIGINT", primaryKey: true, generated: true },
    { columnName: "TITLE", javaType: "String", jdbcType: "VARCHAR", nullable: false }
  ],
  withTest=true,
  dryRun=true
)
```

생성 전 모든 대상 경로를 검사하며 기존 파일이 하나라도 있으면 아무 파일도 쓰지 않습니다. 지원 타입과 출력 계약은 [CRUD 생성 설계](docs/design-crud-generation.md)를 참고하세요.

### generate_egovframe_config 핵심 파라미터

- `projectDir` — 대상 프로젝트
- `configId` — 설정 템플릿 id. `datasource` `datasource-jndi` `transaction-datasource` `transaction-jpa` `transaction-jta` `cache-ehcache-default` `cache-spring` `logging-console` `logging-file` `logging-rolling-file` `logging-time-rolling-file` `logging-jdbc` `scheduling-bean-job` `scheduling-method-job` `scheduling-simple-trigger` `scheduling-cron-trigger` `scheduling-scheduler` `idgen-sequence` `idgen-table` `idgen-uuid` `property`
- `format` — `xml`(기본) | `javaConfig` | `yaml` | `properties` (yaml·properties 는 logging 계열만)
- `fields` — 템플릿 변수 덮어쓰기. 필드명과 기본값은 Initializr 웹뷰 폼과 같습니다(예: `txtDatasourceName`, `rdoType`(DBCP|C3P0|JDBC), `txtDriver`, `txtUrl`, `txtUser`, `txtPasswd`, `txtConfigPackage`). 템플릿에 없는 필드나 선택지 밖 값은 거부합니다. 전체 목록은 리소스 `egovframe://catalog/config-templates` 참조
- `fileName` — 파일명(확장자 제외) 또는 JavaConfig 클래스명. 미지정 시 Initializr 기본값(`context-datasource`, `EgovDataSourceConfig` 등)
- `outputDir` — 프로젝트 상대 경로. 미지정 시 xml → `src/main/resources/egovframework/spring`(logging 은 `src/main/resources`), javaConfig → `src/main/java/<패키지>`
- `dryRun` — 내용·경로·컨텍스트만 반환

```text
generate_egovframe_config(
  projectDir="/work/my-egov-app",
  configId="datasource",
  format="javaConfig",
  fields={ txtConfigPackage: "kr.go.sample.config", rdoType: "C3P0", txtUrl: "jdbc:mysql://db:3306/app", txtUser: "app", txtPasswd: "…" }
)
```

기존 파일이 있으면 쓰지 않고 거부하며, 결과의 컨텍스트에서 비밀번호 필드는 가려집니다. 템플릿은 [eGovFramework/egovframe-vscode-initializr](https://github.com/eGovFramework/egovframe-vscode-initializr)(Apache-2.0)의 `templates/config` 를 commit·sha256 고정으로 동봉합니다. 설계와 upstream 에서 발견한 문제는 [설정 파일 생성 설계](docs/design-config-generation.md)를 참고하세요.

### migrate_egovframe_project 파라미터

- `projectDir` — 진단할 프로젝트(허용 root 적용). `pom.xml`(다중 모듈 포함)·`build.gradle(.kts)`·`*.java`·`*.xml`·`*.jsp`·`web.xml`·`*.properties/yml` 을 읽으며 `target/`·`build/`·`.git/`·`node_modules/` 는 건너뜁니다
- `target` — `5.x`(기본이자 현재 유일)
- `format` — `markdown`(기본, 수동 항목 → 자동 항목 순 요약) | `json`(항목 배열 `{file, line, kind, from, to, action, reason, edits?}` 과 `summary.byKind`, `sourceEra`)
- `apply` — `true` 면 2단계(적용). `dryRun`(기본 `true`)이면 파일별 변경 미리보기만, `false` 면 실제 치환
- `verify` — `true` 면 3단계(검증): 진단 뒤 `compile` 을 실행해 컴파일 오류를 수동 항목과 연결한 작업 목록을 반환(빌드 도구 필요, 파일 무기록)
- `skipComponents` — `true` 면 3.x 공통컴포넌트 디렉터리(재조립 권고 대상)의 자동 항목을 치환하지 않고 수동으로 남김

```text
migrate_egovframe_project(projectDir="/work/legacy-3.10-app")                       # 1단계 진단
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", apply=true)           # 적용 계획(미리보기)
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", apply=true, dryRun=false)  # 적용
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", verify=true)   # 컴파일 → 오류 ↔ 수동 항목 작업 목록
```

`action` 이 `auto` 인 항목(좌표·RTE 버전 속성·패키지 접두어·패키지 이름 변경·`javax→jakarta` 패키지와 의존성 좌표·저장소 URL·Java 버전·web.xml 스키마)은 적용 단계가 원문 오프셋 기준으로 치환하고, `manual`(제거된 클래스·네임스페이스·교체 필요 라이브러리·Spring 버전·5.x parent 권고)은 사유와 대체 API 를 함께 남깁니다. 적용은 하나의 transaction 이며 원본을 `migration-backup/<시각>-<id>/` 에 보관하고 `migration-plan.json` 을 남깁니다. 중간에 실패하면 작업 전 상태로 되돌립니다. 규칙의 출처와 제거 클래스 38종의 대체 근거는 [전환 진단 설계](docs/design-migration.md)를, 규칙 자체는 리소스 `egovframe://catalog/migration-rules` 를 참고하세요. 이 도구는 파일을 쓰지 않습니다.

### check_egovframe_dependencies 파라미터

- `projectDir` — 점검할 프로젝트(허용 root 적용). Maven(다중 모듈 pom, `<properties>` 해석) 또는 Gradle
- `offline` — `true`(기본) 오프라인 기준 대조만 | `false` OSV(`api.osv.dev`) 취약점 조회 추가
- `resolve` — `true` 면 빌드 도구로 의존성 트리를 해석해 전이 의존성까지 판정(Maven `maven-dependency-plugin:3.8.1:tree`, Gradle `dependencies --configuration runtimeClasspath`; 빌드 도구·저장소 접근 필요). `resolveScope` `runtime`(기본) | `all`(test·provided 포함), `resolveTimeoutMs`
- `format` — `markdown` | `json`

```text
check_egovframe_dependencies(projectDir="/work/my-egov-app", offline=false)
check_egovframe_dependencies(projectDir="/work/my-egov-app", resolve=true, offline=false)   # 실제로 실리는 artifact 전부
```

`resolve=true` 결과는 항목마다 `origin`(`declared`·`transitive`)과 전이 경로 `via`(예 `egovframe-rte-ptl-mvc → spring-webmvc`), 선언과 다르게 해석된 버전(`treeVersion`·`resolution.differs`)을 담고, parent 가 관리하는 좌표가 기준 미만 버전으로 해석되면 비고에 알립니다. 해석에 실패하면 선언 기준 결과에 이유를 붙여 돌려줍니다.

기준은 공식 5.x parent(`org.egovframe.web:egovframe-web-config-parent`·`org.egovframe.boot:egovframe-boot-starter-parent` 5.0.2)의 `properties`·`dependencyManagement`, Boot parent 가 상속하는 Spring Boot BOM 전체(`spring-boot-dependencies` 3.5.6 + import 한 단계), RTE 모듈 18종의 전이 의존성에서 추출한 `catalog/dependency-baseline.json`(schemaVersion 2) 이며 리소스 `egovframe://catalog/dependency-baseline` 로 조회할 수 있습니다. 대조 순서는 parent 직접 → 계열 → (Boot parent 프로젝트) Boot BOM → RTE 전이, 그 밖은 RTE 전이 → Boot BOM 이고 항목마다 `basis` 로 출처를 적습니다. RTE 전이 버전보다 낮게 명시한 좌표는 "충돌 가능" 사유와 함께 기준 미만으로 봅니다. 국내 벤더·기관 배포 좌표(Altibase·Tibero·CUBRID·GPKI·mGov)는 `vendor`, 기준에 없는 좌표는 `unknown`(판단 보류)으로 두고 둘 다 조치 목록에 넣지 않습니다. 보안 점검은 설정의 존재 여부와 근거만 보고합니다(설계: [의존성 점검 설계](docs/design-dependency-check.md)).

### generate_egovframe_sbom 파라미터

- `projectDir` — Maven 또는 Gradle 프로젝트(허용 root 적용)
- `outputPath` — 프로젝트 상대 경로(기본 `sbom/bom.cdx.json`; `..`·절대 경로·symlink 이탈 거부), `overwrite` — 기존 파일 덮어쓰기(기본 거부)
- `scope` — `runtime`(기본: compile+runtime) | `all`(test·provided 포함)
- `enrich` — `true`(기본) component 마다 `egovframe:status`·`egovframe:basis`·`egovframe:baseline` 속성 부착
- `offline` — `true`(기본) | `false` OSV 결과를 CycloneDX `vulnerabilities[]`(`affects` 로 component 참조)로 포함
- `dryRun` — `true`(기본) 실행 없이 명령·출력 경로만 | `false` 생성·기록, `timeoutMs`(기본 600000)

```text
generate_egovframe_sbom(projectDir="/work/my-egov-app")                              # 계획만
generate_egovframe_sbom(projectDir="/work/my-egov-app", dryRun=false, offline=false)  # sbom/bom.cdx.json + OSV
```

Maven 은 `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom` 을 좌표를 완전히 적어 호출하므로 pom 을 바꾸지 않으며(해시·라이선스 포함, 멀티 모듈 합산), Gradle 은 해석된 트리로 이 서버가 문서를 구성합니다(해시·라이선스 없음, 빌드 파일 변경 없음). 문서의 `metadata.tools` 에 이 서버가 기록됩니다. 기준 판정은 `check_egovframe_dependencies` 와 같은 규칙입니다(설계: [의존성 점검 설계](docs/design-dependency-check.md)).

### generate_egovframe_report 파라미터 (전환 준비도 평가서)

- `projectDir` — 평가할 프로젝트(허용 root 적용)
- `sections` — `["components"]`(기본, v0.16 리포트 그대로) | `["assessment"]`(평가서) | 둘 다(이어 붙임)
- `resolve`·`resolveScope`·`resolveTimeoutMs` — 평가서의 의존성 절을 빌드 도구로 해석한 전이 의존성까지 판정(기본 선언만)
- `offline` — `true`(기본) | `false` OSV 로 알려진 취약점 조회 — 공급망 등급은 취약점을 조회해야 "확정"으로 표시
- `sbomPath` — 요약할 SBOM(기본 `sbom/bom.cdx.json`; 없으면 "없음"으로 표시하고 만들지 않음), `topN` — 예상 수동 작업 상위 N(기본 20)
- `outputPath` — 프로젝트 상대 `.md` 경로. 주면 **새 파일로만** 저장(기존 파일 거부, `..`·절대·symlink 이탈 거부, transaction), `dryRun` — 쓰지 않고 내용만
- `format` — `markdown`(기본) | `json`(`outputSchema`·`structuredContent`, 평가 데이터 포함)

```text
generate_egovframe_report(projectDir="/work/legacy-app", sections=["assessment"])
generate_egovframe_report(projectDir="/work/legacy-app", sections=["assessment"], offline=false, resolve=true, outputPath="docs/assessment.md")
```

평가서 6절의 등급은 두 축입니다. **전환 난이도** = 수동 전환 항목 수(0 / 1–20 / 21–100 / 101+ → 0–3점) + 재조립 권고 공통컴포넌트 수(0 / 1–5 / 6–20 / 21+) + 제거된 API 참조 수(0 / 1–10 / 11–100 / 101+) + 현재 좌표 세대(5.x 0 · 4.x 1 · 3.x 2), **공급망 상태** = 기준 미만 의존성 수(0 / 1–3 / 4–10 / 11+) + 전환 대상·교체 필요 수(같은 구간) + 알려진 취약점이 있는 의존성 수(0 / 1–2 / 3–9 / 10+, 미조회면 0점으로 계산하고 주의) + 보안 설정 누락 수(0 / 1–2 / 3+ → 0–2점) + 5.x parent·Java 기준(각 미달 +1). 합계로 **A=0 · B≤3 · C≤7 · D>7**. 산식 전문은 리포트 안에 인쇄되며, 공식 5.x 템플릿은 전환 A, 공식 공통컴포넌트 3.10.0·4.3.2 전체 트리는 두 축 모두 D 입니다(구간을 정한 근거와 예시: [docs/design-assessment-report.md](docs/design-assessment-report.md)). 비용·공수는 산정하지 않습니다.

평가서 발췌(공통컴포넌트 v4.3.2 전체 트리):

```markdown
- **전환 난이도 D · 공급망 상태 D** (산식은 6절)
## 2. 전환 범위
- 항목 1352건 = 자동 치환 635 + 수동 717 · 대상 파일 689개
- 재조립 권고 공통컴포넌트 155종: cmm, cop.adb, bbs, …
- 제거된 API 참조 552건 (제거된 RTE 클래스 · 제거된 공통컴포넌트 클래스 · 제거된 RTE 모듈 · 제거된 XML 네임스페이스)
## 6. 등급과 근거
### 전환 난이도: **D** (10/11점, A=0 · B≤3 · C≤7 · D>7)
| 요인 | 값 | 구간 | 점수 | 비고 |
| 수동 전환 항목 수 | 717 | 101+ | 3 |  |
| 재조립 권고 공통컴포넌트 수 | 155 | 21+ | 3 |  |
| 제거된 API 참조 수 | 552 | 101+ | 3 |  |
| 현재 좌표 세대 | 1 | 1 | 1 | sourceEra=4.x |
```

### diagnose_egovframe_network / generate_agents_md

```text
diagnose_egovframe_network()                       # 호스트 7종 전부, 호스트당 10초
diagnose_egovframe_network(hosts=["codeload.github.com"], timeoutMs=20000)
generate_agents_md(projectDir="/work/my-egov-app", dryRun=true)   # 내용만
generate_agents_md(projectDir="/work/my-egov-app", lang="en", fileName="CLAUDE.md", overwrite=true)
```

네트워크 진단은 프록시 URL 의 자격 증명을 가려서 보고하며, `NODE_TLS_REJECT_UNAUTHORIZED=0` 이 설정돼 있으면 경고합니다. 다운로드가 실패하는 다른 도구들도 오류 메시지 끝에 같은 분류와 한 줄 처방을 붙입니다(`[네트워크 timeout] … 자세한 진단: diagnose_egovframe_network`). `AGENTS.md` 의 사실 항목은 `diagnose_egovframe_project`·`migrate_egovframe_project`·빌드 도구 감지에서 오고, 규칙 항목은 이 서버의 도구가 지키는 원칙입니다.

### sync_egovframe_catalog / 컴포넌트 조립

- 카탈로그는 common-components 공식 `v5.0.6` 태그와 commit `23d01889…`에 고정됩니다.
- `sync_egovframe_catalog()`는 태그 이동, archive SHA-256·크기·파일 수 불일치, `sec.security` 누락, 미매핑 Java·Mapper·JSP를 검사합니다.
- `add_egovframe_components`는 기존 파일이 upstream과 동일하면 재사용하고 내용이 다르면 전체 조립을 거부합니다.
- 감지된 `mavenDependencies`는 결과에 반환합니다. 프로젝트별 dependency management·버전 정책을 보호하기 위해 기존 `pom.xml`과 `web.xml`은 자동 덮어쓰지 않습니다.

상세 스키마와 안전 게이트는 [카탈로그 동기화·완전 조립 설계](docs/design-catalog-sync.md)를 참고하세요.

## 설치·사용

[npm에 배포되어](https://www.npmjs.com/package/egovframe-scaffold-mcp) 설치 없이 바로 실행할 수 있습니다:

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "npx",
      "args": ["-y", "egovframe-scaffold-mcp"]
    }
  }
}
```

영문 도구 설명이 필요하면(응답은 한국어 그대로) `env` 에 `"EGOVFRAME_LANG": "en"` 을 추가합니다. 사내 프록시 환경에서 프로젝트 생성이 타임아웃되면 `"HTTPS_PROXY": "http://proxy:8080", "NODE_USE_ENV_PROXY": "1"` 을 같은 `env` 에 넣고, 원인 확인은 `diagnose_egovframe_network` 로 합니다.

소스에서 직접 빌드하려면:

```bash
npm install
npm run build
```

Claude Desktop / Claude Code 설정 예 (`mcpServers`):

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "node",
      "args": ["/절대경로/egovframe-scaffold-mcp/dist/index.js"]
    }
  }
}
```

빌드 없이 실행하려면 (로컬 클론 후):

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "npx",
      "args": ["-y", "tsx", "/절대경로/egovframe-scaffold-mcp/src/index.ts"]
    }
  }
}
```

사용 예 (AI 도구에서):

> "표준프레임워크로 `my-egov-app` 프로젝트를 `~/work`에 만들어줘. groupId는 `egovframework.example`, DB는 mysql."


## 리소스·프롬프트 (MCP Resources/Prompts)

도구(tools)뿐 아니라 MCP의 리소스·프롬프트도 제공합니다 (MCP 3대 프리미티브 완비).

**Resources** (읽기 전용) — 지원 클라이언트에서 도구 호출 없이 카탈로그를 탐색·인용:

모든 도구는 MCP annotations(`readOnlyHint`·`destructiveHint`·`idempotentHint`·`openWorldHint`)와 ko/en `title` 을 노출합니다 — 읽기 전용 14종(목록·검색·진단·검증·리포트·점검·upstream 대조), 파괴 가능 4종(`remove_egovframe_components`·`upgrade_egovframe_project`·`migrate_egovframe_project(apply)`·`generate_agents_md(overwrite)`), 네트워크 사용 도구는 `openWorldHint`. `diagnose_egovframe_project`·`validate_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network` 는 `outputSchema` 를 선언하고 `structuredContent` 로 같은 결과를 구조화해 돌려줍니다(`text` 는 그대로).

- `egovframe://catalog/components` · `egovframe://catalog/components/{id}` · `egovframe://catalog/templates` · `egovframe://catalog/recipes` · `egovframe://catalog/ai-components` · `egovframe://catalog/config-templates` · `egovframe://catalog/migration-rules` · `egovframe://catalog/dependency-baseline`

**Prompts** — 가이드형 워크플로: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`

**레시피** — 자주 쓰는 조합을 한 번에 조립합니다. 예: `apply_egovframe_recipe(recipeId="board-login", projectName="my-egov-app", outputDir="~/work")`. 목록은 `catalog/recipes.json`에서 관리하며 기여 환영합니다.

### MCP Registry

[MCP Registry](https://registry.modelcontextprotocol.io) 용 메타데이터는 저장소의 `server.json`(이름 `io.github.EricSeokgon/egovframe-scaffold-mcp`)과 `package.json` 의 `mcpName` 이며, `npm run test:registry` 가 두 파일의 이름·버전·npm 좌표 일치를 검사합니다. 등록은 npm 배포 뒤 저장소 루트에서:

```bash
mcp-publisher login github     # GitHub device flow — io.github.EricSeokgon/ 네임스페이스 권한
mcp-publisher publish          # server.json 을 레지스트리에 게시
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EricSeokgon/egovframe-scaffold-mcp"
```

버전을 올릴 때 `server.json` 의 `version`·`packages[0].version` 도 함께 올립니다(릴리스 절차 참조).

## 보안 설정 — 허용 root (선택)

환경변수 `EGOVFRAME_ALLOWED_ROOTS`를 설정하면, 모든 도구의 디렉터리 인자(`outputDir`·`projectDir`)가 지정한 root 내부일 때만 실행됩니다. 미설정 시 기존과 동일하게 제한이 없습니다.

```jsonc
// MCP 클라이언트 설정 예 (여러 root는 OS 경로 구분자로 연결: POSIX ":", Windows ";")
{ "mcpServers": { "egovframe-scaffold": {
    "command": "npx", "args": ["-y", "egovframe-scaffold-mcp"],
    "env": { "EGOVFRAME_ALLOWED_ROOTS": "/home/user/workspaces" }
} } }
```

- 검사는 realpath 기준이라 symlink를 통한 우회도 차단합니다.
- 위반 시 도구는 아무 파일도 만들지 않고 `AllowedRootsError`(허용 root 목록 포함)로 거부합니다.
- transaction 실패 메시지에는 사람용 문구와 함께 기계가 읽을 수 있는 `rollback-report: {...}` JSON 한 줄(복원·제거·정리 건수, 실패 목록)이 포함됩니다.

## 검증

- 함수 레벨: 실제 템플릿(약 296파일) 생성, pom 좌표·DbType 적용, 중복 생성 거부, `dryRun` 미리보기(무기록) 확인 (`npm run smoke`)
- Maven 좌표 레벨: 프로젝트 직접 groupId/artifactId/name만 변경하고 parent·dependency artifactId 보존 (`npm run test:pom`, 네트워크 불필요)
- 카탈로그 레벨: schema v2, 고정 source/archive 지문, 자산 메타데이터, 무결성·위상 정렬·미리보기 검증 (`npm run test:catalog`, `npm run test:catalog-sync`, 네트워크 불필요)
- zip 조달 레벨: 자리표시자 치환·globals 경로 판별·12종 정의 유효성(`npm run test:pom`, 네트워크 불필요), `batch-file-commandline` 실생성으로 지문 검증·좌표·DbType·zip 루트 보존, 지문 불일치 거부와 무기록, `ref` 지정 시 검증 생략 표시(`npm run test:templates`, 네트워크 필요, CI 실행)
- 설정 생성 레벨: 동봉 템플릿 지문·카탈로그 무결성, 49건 전 형식 기본값 렌더링, 분기·필드 덮어쓰기, 필드·선택지·파일명·패키지 거부, dryRun 무기록, 충돌 거부, 비밀번호 가림, `..`·절대경로·symlink 이탈 거부, CRLF 체크아웃 시뮬레이션 (`npm run test:config`, 506단언, 네트워크 불필요)
- 템플릿 카탈로그 레벨: `catalog/templates.json` 스키마·커버리지 계산·큐레이션 매핑 정합·변환기·upstream 차이 계산(추가/삭제/필드 변경) 검증 (`npm run test:template-catalog`, 256단언, zip 지문·동봉 설정 템플릿 drift·LFS 포인터 해석 포함, 네트워크 불필요)
- 동기화 레벨: 공식 v5.0.6 태그→commit, SHA-256·크기·파일 수, `sec.security`, 미매핑 경로 0건 검증 (`npm run test:catalog-sync-live`, 네트워크 필요)
- 조립 레벨: 실제 공통컴포넌트 저장소로 bbs+login+sec.security(+cmm) 843파일 조립, message·IDGN·웹 자산·공용 fragment·Maven 좌표·선별 DB 스크립트·충돌 전체 거부·파일/SQL/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:components`)
- 수명주기 레벨: 설치 매니페스트 기록, 중복 설치 거부, 의존 컴포넌트 제거 보호, 제거·검증 동작 (`npm run test:components`)
- 프로토콜 레벨: 빌드된 서버를 실제 프로세스로 띄워 MCP initialize / tools/list 핸드셰이크, `serverInfo.version`↔`package.json` 일치, 핵심 도구 노출, `jdk` 패턴 제약 노출 확인 (`npm run test:handshake`, 네트워크 불필요)
- 릴리스 레벨: 배포 판정(버전·`server.json`·변경 이력·태그·npm 네 조건)과 릴리스 노트 추출, `npm pack --dry-run` 의 tarball 내용(포함·제외·크기 상한), `server.json` 설명 100자 제한 (`npm run test:release`·`npm run test:registry`, 네트워크 불필요); CI 통합이 `mcp-publisher validate` 로 레지스트리 스키마를 실제 검증
- 플랫폼 레벨: CI가 릴리스 게이트를 ubuntu·windows × Node 18·20·22 매트릭스로 실행하고, 공식 저장소를 내려받는 통합 테스트는 ubuntu/Node 20에서 실행합니다. 타임아웃 시 프로세스 트리 종료는 POSIX·Windows 모두 실제 프로세스로 검증합니다 (`npm run test:build`).
- 레시피 레벨: `catalog/recipes.json`의 컴포넌트 id·의존성·템플릿 제공 컴포넌트 정합 검증 (`npm run test:recipes`, 네트워크 불필요). 공식 `simple-backend`의 기존 `cmm`을 보존하고 board-login의 bbs 88파일·login 41파일·SQL 4건(총 133파일)을 조립한 뒤 검증하며, 컴포넌트 이후 fault injection의 전체 staging rollback도 확인 (`npm run test:recipe-transaction`)
- 진단 레벨: 픽스처(pom·DbType·컴포넌트 패키지)로 `diagnose_egovframe_project`의 빌드·버전·DbType·컴포넌트 지문·의존성 검출 검증 (`npm run test:diagnose`, 네트워크 불필요)
- 전환 진단 레벨: 3.10 스타일 픽스처(pom·gradle·java·Spring XML·MyBatis XML·web.xml·JSP)에서 항목 종류·auto/manual·라인·대응 좌표를 단언하고, 5.x 스타일 픽스처에서 항목 0건과 진단 전후 디스크 불변을 확인 (`npm run test:migrate`, 87단언, 네트워크 불필요). 규칙 카탈로그는 스키마·좌표 규칙성·제거 클래스의 대체가 동봉된 5.x 소스 트리에 존재하는지·JDK 내장 `javax.*` 제외·큐레이션과 생성물 일치를 검증 (`npm run test:migration-rules`, 579단언, 네트워크 불필요). 목적지 좌표(RTE 5.x 24종·3.x 원본 18종·parent 2종·Jakarta 좌표)가 표준프레임워크 Maven 저장소와 Maven Central 에 실제로 존재하는지는 CI 통합 job 에서 확인 (`npm run test:migration-rules-live`, 61건, 네트워크 필요)
- 전환 검증 레벨: 공통컴포넌트 대응표 판정(제거·이동·사용자 클래스 무시), 재조립 권고와 `skipComponents`, `linkBuildError` 8케이스(심볼·패키지 부재·라인 근접·규칙 심볼·javax 부재·무관), javac `symbol:`/`location:` 파싱(maven·gradle), 가짜 runner 로 verify 결과·작업 목록·Markdown·빌드 파일 없음 (`npm run test:migrate` 에 포함, 총 162단언). 실제 `mvn compile` 오류 3건이 수동 항목 2건에 전부 연결되는지는 CI 통합 job (`npm run test:migrate-integration`)
- 전환 적용 레벨: 3.10 픽스처에 대해 auto 항목의 편집 원문 일치, dryRun 무기록, fault-injection 롤백(내용·mtime 불변), 적용 후 pom·java·XML·web.xml·gradle·JSP 내용, 백업·`migration-plan.json`, 재적용 무기록, manual 항목 불변을 단언 (`npm run test:migrate`, 132단언, 네트워크 불필요). 3.10 좌표·javax 픽스처를 적용한 뒤 JDK 17 로 `mvn compile` 통과는 CI 통합 job 에서 확인 (`npm run test:migrate-integration`, 네트워크·JDK·Maven 필요)
- 의존성 점검 레벨: 기준 카탈로그 스키마·출처 sha256·RTE 5.x 모듈·BOM 계열, 분류 함수 12케이스, 3.10·5.x parent·gradle·빈 디렉터리 픽스처, OSV 모의 질의·매핑·실패 처리, 디스크 불변 (`npm run test:dependencies`, 68단언, 네트워크 불필요). 실제 OSV 조회는 CI 통합 job (`npm run test:dependencies-live`)
- 네트워크 진단 레벨: 오류 분류 8종, 프로브·DNS 주입으로 7가지 시나리오(전부 도달, 405/404/407/503, 프록시+타임아웃, 프록시 없음+IPv6 혼재, TLS, DNS, 필터)의 처방·안내·자격 증명 가림·셸별 명령을 단언하고, `fetchWithTimeout` 실패 메시지에 처방이 붙는지 확인 (`npm run test:network`, 33단언, 네트워크 불필요). 실제 호스트 7종 프로브는 CI 통합 job (`npm run test:network-live`)
- AGENTS.md 레벨: 5.x(매니페스트·래퍼·컴포넌트 2종·백업 디렉터리)와 3.x gradle 픽스처, 빈 디렉터리에서 사실 수집·ko/en 렌더링·dryRun 무기록·기존 파일 거부·overwrite·파일명 검증·staging 정리 (`npm run test:agents-md`, 22단언, 네트워크 불필요)
- 레지스트리 메타데이터 레벨: `server.json` ↔ `package.json` 의 이름(`mcpName`)·버전·npm 좌표·스키마 URL·환경변수 문서화 정합 (`npm run test:registry`, 네트워크 불필요)
- 프로토콜 레벨(추가): `EGOVFRAME_LANG=en` 으로 띄운 서버의 도구 28종 설명이 모두 영문이고 표에 빠진 도구가 없는지, `tools/list` 에 `title`·annotations(readOnly 13종)·`outputSchema` 7종이 노출되는지 확인 (`npm run test:handshake`)
- SBOM·해석 레벨: Maven·Gradle 트리 파서(실제 출력 픽스처), `resolve=true` 의 전이 항목·경로·선언/해석 차이·실패 경로, CycloneDX 문서 구성·보강·취약점 병합·출력 경로 거부·overwrite·dryRun (`npm run test:dependencies`, `npm run test:sbom`, 네트워크 불필요); CI 통합이 공식 `egovframe-web` 템플릿을 실제 Maven 으로 해석하고 SBOM 을 생성 (`npm run test:sbom-live`)
- 메타데이터·구조화 출력 레벨: `TOOL_META` ↔ 등록 도구 일치, 읽기 전용·파괴·네트워크 힌트 배정, 영문 title, 7종 도구의 실제 결과(진단·검증·전환 진단/적용·의존성·네트워크·리포트, 빈 프로젝트 포함)가 `outputSchema` 를 통과하고 최상위 키가 전부 선언돼 있으며 잘못된 값은 거부 (`npm run test:output-schemas`, 47단언, 네트워크 불필요). MCP 프로토콜 경유 호출 시 SDK 가 `structuredContent` 를 스키마로 검증합니다
- 테스트 이식성 레벨: `scripts/check-test-portability.mjs` 가 `test/*.mjs` 에서 Windows 에서 깨지는 가정(정규화 없는 `path.relative` 비교, `./mvnw` 리터럴 기대값, POSIX 절대 경로)을 찾아 실패시킵니다(`npm run check:portability`, 게이트 포함, 의도된 줄은 `// portability: ok <사유>`). 플랫폼 분기 함수(`resolveCommand`·`collectAgentsFacts`)는 `platform` 주입으로 linux·win32 양쪽을 단언합니다
- 문서 검색 레벨: `search_egovframe_docs`의 키워드 매칭·점수 정렬·컴포넌트 매핑·빈질의/미존재어 처리 검증 (`npm run test:docs`, 네트워크 불필요)
- 리포트 레벨: 픽스처로 `generate_egovframe_report`의 컴포넌트·테이블·가이드 링크 렌더링 검증 (`npm run test:report`, 네트워크 불필요)
- 평가서 레벨: 등급 산식 경계(구간·등급)와 리포트 숫자로의 재계산, 3.x(공통컴포넌트 소스·교체 라이브러리·http 저장소·벤더)·4.x 소형·5.x parent 픽스처의 절별 내용과 등급(5.x 는 전환 범위 0·A), OSV 조회·실패 시 취약점 요인, SBOM 요약·깨진 파일, 절 조립·중복 제거, `outputPath` 저장·dryRun·기존 파일/프로젝트 밖/절대 경로/symlink/.md 아님 거부, `structuredContent` 스키마 (`npm run test:assessment`, 55단언, 네트워크 불필요). CI 통합이 공식 5.x 템플릿 2종에서 전환 A 를 확인 (`npm run test:dependencies-live`)
- 회귀 코퍼스 레벨: 공식 공통컴포넌트 v3.10.0·v4.3.2 부분 트리(커밋 고정, sparse 클론, 캐시)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 기대값과 ±1% 안인지, 세대 판정·확인 필요 클래스 0·기준 없음은 `xerces` 뿐·계획=자동 전부·재조립 권고·등급 D/D·60초 미만을 단언 (`npm run test:migrate-corpus`, 20단언, git·네트워크 필요, CI 통합). 기대값 갱신은 `npm run generate:migration-corpus`(`--check` 는 차이만)
- 업그레이드 레벨: 3-way 판정 6분류(unchanged/update/user-modified/conflict/added/removed)·v1 보수모드·정상 적용/백업 계획·파일/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:upgrade`, 네트워크 불필요)
- 컴포넌트 설명 레벨: `explain_egovframe_component`의 의존성(직접·전이)·역의존·테이블·가이드 URL·미존재 예외 검증 (`npm run test:explain`, 네트워크 불필요)
- CI 생성 레벨: `generate_egovframe_ci`의 maven/gradle 감지·YAML·dryRun 무기록·기존 파일 거부·빌드파일 부재 예외·`jdk` 주입 입력 거부 검증 (`npm run test:ci`, 네트워크 불필요)
- CRUD 생성 레벨: 공식 wizard 그룹, Classic/Boot 분기, DB 생성키, JUnit 5, dryRun, PK·경로 검증, 충돌 시 전체 무기록 검증 (`npm run test:crud`, 네트워크 불필요)
- CRUD 컴파일 레벨: 공식 simple-backend/Boot CRUD 7파일과 web-sample/Classic CRUD 9파일 생성 → JDK 17에서 `mvn -q -DskipTests compile` (`npm run test:crud-integration`, 네트워크 필요, CI 실행)
- 안전성 레벨: 19개 도구 공통 허용 root의 미설정 호환·격리·`..` 이탈·symlink 우회·다중 root·비대상 인자 무해 6케이스와 구조화 rollback 필드를 검증합니다 (`npm run test:allowed-roots`, `npm run test:transaction`, 네트워크 불필요).

## 현재 지원 범위와 알려진 제약

- 공통컴포넌트 실행 자산과 Maven 좌표 탐지는 지원합니다. 기존 `pom.xml`·`web.xml`의 구조적 노드 병합은 프로젝트별 dependency management·설정 경로를 보호하기 위해 자동 수행하지 않습니다.
- 카탈로그는 공식 v5.0.6 태그·commit·archive 지문에 고정됩니다. 최신 main 변경은 `sync_egovframe_catalog(ref="main")` 결과를 검토한 뒤 생성 스크립트로 승격합니다.
- `build_egovframe_project`·`test_egovframe_project`는 로컬에 설치된 JDK와 maven/gradle(또는 프로젝트 래퍼)을 사용합니다. DB 등 외부 의존성이 필요한 테스트는 그 환경이 준비되지 않으면 오류(error)로 집계됩니다.
- 자바 패키지 구조 변경(groupId에 맞춘 소스 디렉터리 이동)은 미지원입니다. 현재는 IDE rename refactoring을 권장합니다.
- `migrate_egovframe_project` 의 적용은 진단이 `auto` 로 표시한 항목만 치환합니다. 정적 텍스트 스캔이므로 리플렉션·문자열 조립으로 만든 클래스명, 프로젝트 밖 라이브러리 안의 `javax` 사용, Spring Security 6·Hibernate 6 등 라이브러리 자체의 API 변경으로 인한 코드 수정 범위는 보고하지 않습니다(라이브러리 단위로 `manual` 안내만 합니다).
- 템플릿·컴포넌트·가이드 원본을 받을 때 GitHub(`codeload.github.com`, `raw.githubusercontent.com`, zip 조달 템플릿은 `media.githubusercontent.com`) 네트워크 접근이 필요합니다.

## 로드맵

v0.31.0까지 프로젝트·CRUD 생성, 검증된 공통컴포넌트 실행 자산 조립, 안전성 기반(테스트 판정 강제·사용자 파일 보호·전 도구 트랜잭션·허용 root·구조화 rollback 보고), 생성→검증 루프(실제 빌드·오류 구조화·테스트 리포트 구조화), 공식 템플릿 카탈로그 단일화와 커버리지 확대(22종 중 21종), 설정 파일 생성, 5.x 전환(진단·적용), 의존성 점검, 운영 편의(네트워크 진단·AGENTS.md·영문 설명·레지스트리 메타데이터)를 완료했습니다.

v0.32–v0.34 로 MCP 프로토콜 현대화, 5.x 전환 3단계(검증)와 공통컴포넌트 대응표, 의존성 기준 완성과 규칙·기준 drift 감시를, v0.35–v0.37 로 릴리스 자동화, 해석된 의존성 트리와 SBOM, 전환 준비도 평가서와 회귀 코퍼스를 마쳤습니다(기획 원문과 결과: [다음 버전 기획](#다음-버전-기획-v035v037)). Homebrew 탭은 계속 후순위입니다.

| 버전 | 핵심 기능 | 목표 |
|---|---|---|
| **v0.20 완료** | `generate_egovframe_crud` | 공식 `wizard.xml` 그룹과 경로 입력, VO·Mapper(XML)·Service·Controller·JSP(선택), Classic/Boot, JUnit 5, dryRun·충돌 원자적 거부 구현. 오프라인 테스트와 공식 simple-backend/Boot·web-sample/Classic Maven compile 통과 |
| **v0.21 완료** | `sync_egovframe_catalog` + 컴포넌트 완전 조립 | common-components v5.0.6 태그/commit/archive 고정, 190항목, message·IDGN·scheduling·정적 자산·web fragment 조립, Maven 좌표 탐지, sec.security·미매핑 경로 검증, 매니페스트 v3 |
| **v0.22 완료** | 전 도구 안전성 기반 | 모든 쓰기 경로 transaction, 사용자 파일 보호, 전 도구 허용 root, symlink/junction 이탈 차단, 구조화 rollback 보고 |
| **v0.23 완료** | `build_egovframe_project` | Maven/Gradle·래퍼(mvnw/gradlew) 자동 감지, 타임아웃·로그 상한, 파일/라인 단위 오류 구조화로 생성→검증 에이전트 루프 완성([PR #18](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/18)). `test_egovframe_project`는 v0.25에서 완료 |
| **v0.24 완료** | 공식 템플릿 커버리지 확대 (7 → **10종**) | Initializr 카탈로그(22항목) 대조로 미커버 공식 자산을 식별해 `msa-common-components`(KRDS)·`mobile-device-api`·`ai-rag` 추가. 모두 멀티 프로젝트로 표시해 좌표/DB 자동 재작성을 건너뛰고 하위 모듈 참조를 보호하며, 실제 아카이브 다운로드 통합 테스트로 검증 |
| **v0.25 완료** | `test_egovframe_project` | 테스트 실행 후 JUnit XML 리포트(surefire `target/surefire-reports`, gradle `build/test-results/test`)를 읽어 스위트·케이스 단위 집계, 실패 메시지·예외 타입·테스트 파일/라인, `testFilter`, 오래된 리포트 제외, exit 0이어도 리포트 실패면 실패 판정 |
| **v0.26 완료** | IDE·Initializr·MCP 공통 카탈로그 | Initializr `templates-projects.json`(22종), MCP `TEMPLATES`(10종), Development `wizards.xml`(8카테고리)을 `schemaVersion: 1` 단일 스키마 `catalog/templates.json` 으로 통합. 변환기(`fromInitializr`·`fromMcpTemplates`)와 큐레이션 매핑(`catalog/template-mapping.json`), upstream 대조 도구 `sync_egovframe_templates` 로 커버리지 격차를 수작업 비교 없이 확인 |
| **v0.27 완료** | 공식 템플릿 커버리지 확대 (10 → **22종**) | 통합 카탈로그가 계산한 미커버 13종 중 12종을 Initializr zip(Git LFS) 조달로 추가. commit·sha256·크기 고정과 다운로드 검증, pom 자리표시자 치환, 템플릿별 `globals.properties` 경로 대응, `sync_egovframe_templates` 의 zip 지문 drift 보고 |
| **v0.28 완료** | `generate_egovframe_config` | Initializr 설정 템플릿 21종(Handlebars)을 commit·sha256 고정으로 동봉해 오프라인 생성. xml·javaConfig·yaml·properties, Initializr 폼과 같은 필드·기본값, 선택지·파일명·패키지 검증, 기존 파일 거부, `sync_egovframe_templates` 의 동봉 템플릿 drift 보고 |
| **v0.29 완료** | `migrate_egovframe_project` (1단계: 진단) | 3.x/4.x 프로젝트를 5.x(Jakarta) 기준으로 스캔해 RTE 좌표·패키지·제거/이동 클래스·`javax→jakarta`·web.xml·XML 네임스페이스·라이브러리 전환 항목을 **읽기 전용**으로 auto/manual 구분 보고. 규칙은 `egovframe-runtime` 태그 3개 비교로 생성(`catalog/migration-rules.json`), 목적지 좌표는 CI 에서 실제 저장소와 대조 |
| **v0.30 완료** | `migrate_egovframe_project` (2단계: 적용) + `check_egovframe_dependencies` | 진단의 auto 항목을 원문 오프셋 편집으로 transaction 적용(백업·dryRun 기본·계획 파일·실패 복구, 적용 후 JDK 17 `mvn compile` CI 검증), 공식 5.x parent 에서 추출한 기준(관리 좌표 139종 + BOM 계열 7종)과 의존성 대조·보안 설정 존재 점검·선택적 OSV 조회 |
| **v0.31 완료** | 운영 편의 | `diagnose_egovframe_network`(호스트 7종 프로브·실패 분류·셸별 처방, 다운로드 오류 메시지에 처방 부착), `generate_agents_md`(ko/en), 영문 README 와 `EGOVFRAME_LANG=en` 도구 설명, MCP Registry `server.json`·`mcpName`·정합 테스트 |
| **v0.32 완료** | MCP 프로토콜 현대화 | `registerTool` 전환(deprecated `tool()` 0건), 도구 27종에 ko/en `title`·annotations(readOnly 14·destructive 4·openWorld), 5종 `outputSchema`+`structuredContent`, 테스트 이식성 검사 스크립트(게이트)와 플랫폼 주입 단언 |
| **v0.33 완료** | `migrate_egovframe_project` 3단계: 검증 | `verify=true` 로 compile 오류 ↔ 수동 항목 연결 작업 목록(javac symbol/location 파싱, 연결 4단계), 공통컴포넌트 3.x→5.x 대응표(제거 54·이동 4, schemaVersion 2)와 재조립 권고·`skipComponents` |
| **v0.34 완료** | 의존성 기준 완성 + drift 감시 | Spring Boot BOM 전체(1,473종)·RTE 모듈 전이 의존성(58종)을 기준에 포함하고 항목마다 기준 출처 표시, `vendor` 분류·EOL 좌표 교체 규칙으로 공통컴포넌트 3.10 pom 의 `unknown` 17 → 1, `sync_egovframe_templates` 가 규칙·기준 카탈로그의 upstream drift(새 태그·새 parent·pom sha256)와 갱신 절차 보고 |
| **v0.35 완료** | 릴리스 자동화 (배포 공급망) | `release.yml`: `main` 의 CI 성공 → 네 조건 검사 → npm(OIDC trusted publishing, provenance) → 그 커밋에 태그 → GitHub Release(변경 이력 추출) → MCP Registry(OIDC). `test:release`(판정·노트·tarball 내용·크기), `server.json` 설명 100자 제한, CI 통합의 `mcp-publisher validate` |
| **v0.36 완료** | 해석된 의존성 트리 + SBOM | `check_egovframe_dependencies(resolve=true)`: Maven `dependency:tree`·Gradle `dependencies` 로 전이 의존성까지 판정(`origin`·`via`·`differs`), 새 도구 `generate_egovframe_sbom`(28종): CycloneDX 1.6 JSON(Maven 플러그인 / Gradle 트리 구성) + 기준 판정 속성 + OSV `vulnerabilities[]`, 공식 web 템플릿 해석 65 artifact·SBOM 67 component·OSV 24건 |
| **v0.37 완료** | 전환 준비도 평가서 + 회귀 코퍼스 | `generate_egovframe_report(sections=["assessment"])`: 개요·전환 범위·의존성 조치·보안·SBOM·A–D 등급(산식 인쇄, 재계산 테스트), json·outputPath. `test:migrate-corpus`: 공식 공통컴포넌트 v3.10.0·v4.3.2 부분 트리 기대값 고정(±1%, CI), 4.x→5.x 실자산 첫 확인. 릴리스 워크플로 재개(npm gitHead 태그) |

## 다음 버전 기획 (v0.35–v0.37)

v0.34.0 까지 끝난 상태(2026-10-04, 도구 27종, 테스트 약 1,300건, npm 0.33.1 배포·0.34.0 배포 대기)에서 다음 세 릴리스를 아래 순서로 진행합니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **배포와 운영을 사람 손에서 떼어 내는 것**(v0.35), **선언된 의존성이 아니라 실제로 실리는 의존성을 보는 것**(v0.36), **지금까지 만든 분석을 한 장의 평가서와 회귀 코퍼스로 묶는 것**(v0.37)입니다. 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-04)"에 있습니다.

### v0.35.0 — 릴리스 자동화 (배포 공급망)

**목표**: v0.29–v0.34 여섯 번의 릴리스에서 태그를 잘못된 커밋에 단 일(2회), npm 배포를 빠뜨린 일(0.32.0·0.33.0), Windows 게이트 실패 상태로 병합한 일(2회)이 모두 사람이 명령을 순서대로 치는 과정에서 났습니다. `main` 에 병합되면 나머지(게이트 재확인 → 태그 → npm → GitHub Release → MCP Registry)는 CI 가 하고, 사람은 PR 병합만 합니다. 배포물에는 provenance 가 붙어 "이 npm 패키지는 이 저장소의 이 커밋에서 이 워크플로가 만들었다"를 소비자가 검증할 수 있게 합니다.

**범위 (포함)**
- `.github/workflows/release.yml`: CI 워크플로가 `main` 에서 성공한 뒤(`workflow_run`)에만 실행. `package.json` 버전을 읽어 (a) `server.json` 두 `version` 과 같고, (b) README 변경 이력에 그 버전 항목이 있고, (c) 태그 `vX.Y.Z` 가 아직 없고, (d) npm 에 그 버전이 없을 때만 진행합니다. 네 조건 중 하나라도 어긋나면 이유를 적고 성공 종료(병합마다 도는 워크플로가 빨간불이 되지 않게).
- npm: **trusted publishing(OIDC)** 으로 토큰 없이 `npm publish --access public`. 공개 저장소·공개 패키지이므로 provenance 가 자동으로 붙습니다. 요구 조건은 npm CLI 11.5.1+·Node 22.14+·`id-token: write`·self-hosted 러너 금지이며, npmjs.com 의 패키지 설정에서 trusted publisher(저장소 `EricSeokgon/egovframe-scaffold-mcp`, 워크플로 파일명 `release.yml`)를 **저장소 소유자가 한 번 등록**해야 합니다(README 절차에 적음).
- 태그·Release: 배포가 성공한 **그 `main` 커밋**에 `vX.Y.Z` 태그를 만들고, `scripts/release-notes.mjs` 가 README 변경 이력에서 해당 버전 항목을 뽑아 GitHub Release 본문으로 씁니다(태그가 병합 전 커밋에 달리는 사고가 구조적으로 사라집니다).
- MCP Registry: `mcp-publisher login github-oidc` → `mcp-publisher publish`(`io.github.EricSeokgon/*` 네임스페이스는 GitHub OIDC 로 소유 증명, 비밀 없음). npm 에 패키지가 먼저 있어야 하므로 npm 단계 뒤에 둡니다. 첫 실행이 곧 "MCP Registry 첫 등록"(보류 항목)이 됩니다.
- 패키지 내용 검사: `npm pack --dry-run --json` 으로 tarball 에 `dist/`·`catalog/`·`server.json`·`README*`·`LICENSE` 만 들어가고 `test/`·`scripts/`·`.github/` 가 없는지, 크기 상한(현재 약 1.2MB → 2MB)을 넘지 않는지 게이트에서 단언(`test:package`). `test:registry` 에 "변경 이력에 현재 버전 항목 존재" 단언 추가(변경 이력 누락을 게이트가 막음).
- README 릴리스 절차를 "PR 병합 → CI 가 나머지 수행 → `npm view`·Release 페이지 확인" 3단계로 줄이고, 수동 절차는 비상용으로만 남깁니다.

**범위 (제외)**: 브랜치 보호 설정(저장소 설정이라 코드로 못 함 — 보류 항목에 유지), Homebrew 탭, Windows 서명

**검증 기준**: `test:package`·`test:registry` 게이트 통과. 워크플로는 실제 병합으로만 검증할 수 있으므로 v0.35.0 자체는 마지막 수동 릴리스로 내고, 병합 직후 `release.yml` 의 "조건 불충족 → 성공 종료" 경로(이미 태그·npm 이 있음)를 로그로 확인합니다. v0.36.0 부터 자동 배포. 배포 뒤 `npm view egovframe-scaffold-mcp --json` 의 `dist.attestations` 와 GitHub Release·MCP Registry 검색 결과를 확인합니다.

**완료 정의**: 도구 27종(변화 없음), `release.yml` 병합, npmjs.com trusted publisher 등록(소유자 수동 1회, README 에 체크리스트), v0.36.0 이 사람 명령 없이 npm·태그·Release·Registry 에 게시

**결과(2026-10-04) — 완료**: `release.yml`(`workflow_run: CI` 성공 후, `workflow_dispatch` 로 수동 재실행 가능) + `scripts/release-check.mjs`(네 조건 판정, `GITHUB_OUTPUT`) + `scripts/release-notes.mjs`(변경 이력 항목 → Release 본문에 설치 스니펫·검증 안내) + `test/release.mjs` 32단언. 기획과 달라진 점: (1) `mcp-publisher validate` 를 실제로 돌려 보니 `server.json` 의 `description` 이 레지스트리 상한 100자를 넘어 첫 등록이 실패할 상태였습니다 — 98자로 줄이고 `test:registry` 가 100자 이하를 단언하며, CI 통합과 `release.yml` 이 npm 게시 **전에** `validate` 를 돌립니다(npm 에 없는 버전도 스키마 검증은 통과함을 확인). (2) 레지스트리 게시 단계는 `continue-on-error` 로 두어 npm·태그·Release 가 끝난 뒤의 실패가 릴리스 자체를 되돌리지 않게 하고 경고로 남깁니다. (3) 릴리스 노트는 변경 이력 항목의 "(1) (2)" 번호 앞에서 단락을 나눠 읽기 쉽게 합니다. 바이너리는 `mcp-publisher v1.8.1`(자산 이름 `mcp-publisher_<os>_<arch>.tar.gz`, 버전 접두 없음)로 고정했습니다. v0.35.0 자체는 마지막 수동 릴리스이며, 병합 뒤 `release.yml` 이 "태그·npm 이미 있음 → 배포 안 함" 으로 성공 종료하는지 확인합니다.

### v0.36.0 — 해석된 의존성 트리 + SBOM

**목표**: `check_egovframe_dependencies` 는 pom 에 **적힌** 의존성만 봅니다. 공식 `egovframe-web` 템플릿은 선언 19건·조치 0건이지만, Maven 으로 실제 해석하면 런타임에 **69개 artifact** 가 실리고 그중 11개가 기준 미만, 9개가 기준 밖, 8개에 OSV 권고가 붙어 있습니다(선행 조사). 전이 의존성까지 보는 `resolve=true` 와, 2027년부터 공공기관 SW 등록에 요구될 SBOM 을 표준 형식(CycloneDX 1.6)으로 만들어 주는 도구를 추가합니다.

**범위 (포함)**
- `check_egovframe_dependencies(resolve=true, resolveScope="runtime"|"all", timeoutMs)`: `build_egovframe_project` 의 러너(타임아웃·프로세스 트리 종료·래퍼 감지)로 Maven `org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree -DoutputFile -DoutputType=text`(pom 변경 없이 좌표를 완전히 적어 호출) 또는 Gradle `dependencies --configuration runtimeClasspath` 를 실행해 트리를 파싱합니다. 결과 `findings` 에 `origin: "declared" | "transitive"` 와 `via`(트리 경로, 예 `egovframe-rte-ptl-mvc → spring-webmvc`)를 붙이고, 해석된 집합 전체를 기존 분류기(parent → 계열 → Boot BOM/RTE 전이, v0.34)로 판정합니다. `summary` 는 선언/해석을 나눠 세고, 선언한 버전과 해석된 버전이 다른 좌표(가까운 선언이 이김)는 `resolvedDiffers` 로 따로 보입니다. `offline=false` 면 OSV 조회도 해석된 집합에 대해 합니다. 빌드 도구가 없거나 해석이 실패하면 선언 기준 결과에 이유를 붙여 돌려줍니다(기존 동작 유지).
- 새 도구 `generate_egovframe_sbom(projectDir, format="cyclonedx-json", outputPath="sbom/bom.cdx.json", enrich=true, offline=true, dryRun=true)`: Maven 은 `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom`(멀티 모듈 합산, pom 변경 없음), Gradle 은 `--init-script` 로 `cyclonedx-gradle-plugin` 3.4.1 을 적용(빌드 파일 변경 없음)해 CycloneDX **1.6 JSON** 을 만듭니다. `enrich=true` 면 component 마다 `properties` 에 `egovframe:status`(기준 판정)·`egovframe:basis`·`egovframe:baseline` 을 붙이고, `offline=false` 면 OSV 결과를 CycloneDX `vulnerabilities[]`(`affects` 로 component 참조)로 넣습니다. 출력은 프로젝트 안 경로만 허용, 기존 파일은 `overwrite=true` 가 아니면 거부, transaction·dryRun(요약만) 적용. 응답은 component 수·직접/전이 수·판정 집계·취약점 수·파일 경로.
- 도구 메타: `generate_egovframe_sbom` 은 `openWorldHint`(빌드 도구가 저장소 접근)·비파괴(새 파일만, overwrite 는 명시)·`outputSchema` 선언. 영문 설명·README·AGENTS.md 생성기(사용 가능 도구 목록)에 반영.
- 기준 카탈로그 소급: 선행 조사에서 드러난 공통컴포넌트 4.3.2 pom 의 `project:*` groupId(system scope 로 로컬 jar 를 붙이는 관행)는 `vendor` 로 분류하고 사유에 "system scope 로컬 jar — SBOM 에서 공급자 확인 필요" 를 적습니다.

**범위 (제외)**: SPDX 형식(요구가 생기면 CycloneDX → SPDX 변환기로), 취약점 DB 동봉, 라이선스 정책 판정(SBOM 에 라이선스는 플러그인이 넣는 그대로)

**검증 기준**: 공식 `egovframe-web` 템플릿(자리표시자 채운 pom)에서 `resolve=true` 가 60개 이상 해석·`transitive` 표시·`via` 경로 존재, SBOM 이 `bomFormat: CycloneDX`·`specVersion: 1.6`·component 60개 이상·모든 component 에 `purl`(`pkg:maven/…`)·`enrich` 속성 존재; `offline=false` 로 `vulnerabilities[]` 가 OSV 결과와 같은 수; Gradle 템플릿(`egovframe-boot-web` 를 Gradle 로 변환한 픽스처 또는 공식 Gradle 샘플)에서 init script 경로 통과; 오프라인 테스트는 트리 파서(Maven·Gradle 출력 픽스처)와 SBOM 보강을 가짜 러너로 단언; CI 통합에 실제 Maven 해석·SBOM 생성 추가

**완료 정의**: 도구 28종, `test:dependencies` 에 해석 경로 단언, 신규 `test:sbom`(오프라인)·`test:sbom-live`(CI), `docs/design-dependency-check.md` 에 해석·SBOM 절, README 에 SBOM 사용 예

**결과(2026-10-04) — 완료**: `src/dependency-tree.ts`(Maven·Gradle 트리 파서, 가장 얕은 경로로 중복 제거, 래퍼 감지 명령), `check_egovframe_dependencies` 의 `resolve`·`resolveScope`·`resolveTimeoutMs`, `src/sbom.ts`(`generate_egovframe_sbom`). 기획과 달라진 점: (1) Gradle 은 cyclonedx-gradle-plugin 을 init script 로 적용하는 대신 해석된 트리로 이 서버가 CycloneDX 문서를 직접 구성합니다 — 플러그인 버전별 API 차이 없이 결정적으로 동작하고 오프라인 테스트가 가능하며, 대가로 해시·라이선스가 빠집니다(문서 `metadata.tools` 와 응답 노트에 명시). (2) Maven 범위는 `-Dscope=runtime`(dependency:tree)·`includeProvidedScope=false`(플러그인)로 "실리는 것"에 맞추고 `all` 로 test·provided 를 포함합니다. (3) 선행 조사의 `project:*` system scope 좌표를 `vendor` 로, `javax.faces:javax.faces-api` 를 Jakarta 규칙(→ `jakarta.faces:jakarta.faces-api` 4.1.2, Boot BOM 기준)으로 소급해 공통컴포넌트 4.3.2 pom 의 `unknown` 11 → 1(`xerces`)이 됐습니다. 실측: 공식 `egovframe-web` 템플릿 해석 65 artifact(직접 14, 선언에 없던 전이 51; 기준 미만 11·기준 없음 9), SBOM 67 component·205KB·OSV 24건, Gradle 샘플 40~46 artifact. Windows 게이트가 깨진 전력 때문에 트리·SBOM 명령은 플랫폼을 주입해 `mvn.cmd`·`gradle.bat` 분기를 단언합니다.

### v0.37.0 — 전환 준비도 평가서 + 회귀 코퍼스

**목표**: 공공 SI 현장에서 "이 3.x/4.x 시스템을 5.x 로 옮기면 무엇이 얼마나 걸리고, 지금 공급망 상태는 어떤가"를 묻는 데 답하려면 지금은 도구 다섯 개를 차례로 불러야 합니다. 한 번의 호출로 평가서를 만들고, 공식 3.x/4.x 자산에 대한 결과를 코퍼스로 고정해 규칙·기준이 바뀔 때 회귀를 잡습니다.

**범위 (포함)**
- `generate_egovframe_report(sections=["assessment"], resolve=false, offline=true)`: 기존 리포트(진단)에 평가서 절을 추가 — (1) 프로젝트 개요(빌드 도구·RTE 세대·parent·Java·공통컴포넌트), (2) 전환 범위(`migrate_egovframe_project` 진단 요약: auto/manual, 종류별, 파일 수, 재조립 권고 컴포넌트, 예상 수동 작업 목록 상위 N), (3) 의존성(기준 판정 집계·조치 목록·`resolve=true` 면 전이 포함·OSV), (4) 보안 설정 점검, (5) SBOM 요약(만들었으면 경로·component 수), (6) **등급과 근거**: 전환 난이도(수동 항목 수·재조립 컴포넌트 수·제거 클래스 참조 수를 구간으로)와 공급망 상태(기준 미만·교체 필요·취약점 수)를 각각 A–D 로 매기되, 등급 산식을 리포트 안에 그대로 적어 사람이 재계산할 수 있게 합니다. Markdown 과 `format=json`(`outputSchema`), 선택적으로 `outputPath` 에 파일로 저장(transaction·dryRun).
- 회귀 코퍼스 `test:migrate-corpus`(CI 통합): 공식 `egovframe-common-components` **v3.10.0**(1,148 java)과 **v4.3.2**(1,295 java, 4.x 좌표 `org.egovframe.rte:org.egovframe.rte.*`) 소스 트리 전체에 진단·적용(dryRun)·의존성 점검을 돌려 종류별 건수·`unknown`·재조립 권고·적용 계획 수를 `catalog/migration-corpus.json` 에 기대값으로 고정하고 ±허용 범위 안인지 단언합니다. 4.x→5.x 경로는 지금까지 단위 픽스처로만 검증했으므로 실제 자산으로 처음 확인하는 셈입니다. 코퍼스 결과는 평가서 등급 산식의 구간을 정하는 근거로도 씁니다.
- 코퍼스가 드러내는 결함 수정(선행 조사에서 이미 하나: 4.3.2 pom 의 `project:*` system scope jar 11건이 `unknown` — v0.36 에서 `vendor` 로 소급; 그 밖에 `javax.faces` 등 미처리 Jakarta 좌표가 있으면 매핑에 추가).

**범위 (제외)**: 비용·공수 산정(사람·조직마다 다름 — 건수와 등급까지만), PDF/HWP 출력(Markdown 을 변환하는 것은 호출자의 몫)

**검증 기준**: 코퍼스 2종(3.10.0·4.3.2) 기대값 고정 후 게이트·CI 통과, 평가서가 공식 5.x 템플릿에서 "전환 범위 0·등급 A", 3.10 자산에서 수동 항목·재조립 권고가 등급 근거로 나타남, `format=json` 이 `outputSchema` 통과, 등급 산식 재계산 테스트

**완료 정의**: 도구 28종(평가서는 기존 도구 확장), `catalog/migration-corpus.json`, `docs/design-assessment-report.md`, README 에 평가서 예시

**결과(2026-10-04) — 완료**: `src/assessment.ts`(평가·등급·Markdown)와 `src/report.ts`(절 조립·저장)를 추가하고 `generate_egovframe_report` 에 `sections`·`resolve`·`offline`·`sbomPath`·`topN`·`outputPath`·`dryRun`·`format` 을 더했습니다(기본 `["components"]` 는 v0.16 출력 그대로). 등급 산식은 데이터(`MIGRATION_RUBRIC`·`SUPPLY_CHAIN_RUBRIC`)로 두고 리포트 6절에 전문을 인쇄하며 테스트가 리포트의 숫자로 재계산합니다. 구간은 공식 5.x 템플릿(전환 A)과 공통컴포넌트 3.10.0·4.3.2 전체 트리(두 축 D)를 양 끝으로 정했습니다. 계획과 다른 점 둘: `outputPath` 는 덮어쓰기 없이 새 파일만(비파괴 유지) — 대신 읽기 전용 힌트를 뗐습니다(13종); 공급망 등급은 공식 템플릿에서 B 입니다(pom 만 있어 보안 설정 3건 누락, Initializr 고정 commit 의 parent 5.0.0 < 5.0.2 — 둘 다 사실이라 A 를 강제하지 않았습니다). 코퍼스는 전체 저장소(≈250MB) 대신 스캔 대상 디렉터리만 sparse 부분 클론(태그당 ≈3초·50MB)하며, 결함은 새로 드러나지 않았고(v0.36 소급분이 전부) 두 세대 모두 확인 필요 클래스 0·기준 없음 `xerces` 1건으로 고정됐습니다. 같은 PR 에 v0.36.1 첫 자동 배포에서 드러난 워크플로 결함(전파 확인 2분 초과 → 태그·Release 누락, 재실행 불가)을 재개 판정으로 고쳤습니다.

### 보류·운영 항목

- **npm trusted publisher**: 등록 완료 — 0.36.1 이 OIDC 로 게시된 첫 버전입니다(Release #3). 등록 정보: npmjs.com → 패키지 `egovframe-scaffold-mcp` → Settings → Trusted publishing → GitHub Actions: owner `EricSeokgon`, repository `egovframe-scaffold-mcp`, workflow filename `release.yml`.
- **MCP Registry 첫 등록**: v0.36.1 의 Release 는 전파 확인 실패로 Registry 단계에 이르지 못했습니다(태그·Release 는 수동 복구). v0.37.0 자동 배포가 OIDC 로 첫 게시를 수행하며, 실패하면 다음 `main` 병합의 Release 가 Registry 단계만 다시 시도합니다(재개 판정).
- **브랜치 보호**: #33·#36 이 Windows gate 실패 상태로 병합됐습니다. `main` 규칙에 "Require status checks to pass"(gate 6 + integration)를 켜 두면 재발하지 않습니다.
- **기준 없음 잔여**: 공통컴포넌트 3.10 pom 의 `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다(JDK 내장 파서로 충분하면 제거 권고를 규칙에 넣을 수 있음).
- Homebrew 탭, Initializr upstream 이슈 3건 제출, 응답 본문 영문화(`EGOVFRAME_LANG=en` 은 현재 도구 설명만)는 계속 후순위입니다.

## 이전 기획 (v0.32–v0.34, 완료)

v0.31.0 까지 끝난 상태(2026-10-02, 도구 27종, 테스트 약 1,100건)에서 다음 세 릴리스를 아래 순서로 진행했습니다. 세 버전 모두 2026-10-03 까지 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-02)"에 있습니다.

### v0.32.0 — MCP 프로토콜 현대화 + 테스트 플랫폼 중립 가드

**목표**: 도구의 "무엇을 하는가"를 설명문뿐 아니라 프로토콜 메타데이터로도 알려 MCP 클라이언트가 승인 UX(읽기 전용은 자동 허용, 파괴적 도구는 확인)와 구조화된 결과 처리를 할 수 있게 합니다. 외부 동작 변화는 없고, 기존 `text` 응답은 그대로 유지합니다.

**범위 (포함)**
- 등록 API: `server.tool(...)`(SDK 1.29 에서 deprecated) → `server.registerTool(name, { title, description, inputSchema, outputSchema?, annotations }, cb)` 로 27종 전환. `i18n` 의 설명 선택은 그대로 `description` 에 적용하고 `title` 도 ko/en 으로 둡니다.
- annotations: 읽기 전용 도구 14종(`list_*`·`search_*`·`explain_*`·`get_*`·`diagnose_*`·`validate_*`·`generate_egovframe_report`·`check_egovframe_dependencies`·`migrate(apply=false)`·`sync_*`)에 `readOnlyHint: true`, 파일을 지우거나 덮어쓰는 도구(`remove_egovframe_components`·`upgrade_egovframe_project`·`migrate(apply)`·`generate_agents_md(overwrite)`)에 `destructiveHint: true`, 다시 실행해도 같은 결과인 도구에 `idempotentHint`, 네트워크를 쓰는 도구에 `openWorldHint: true`. `migrate_egovframe_project` 처럼 인자에 따라 성격이 바뀌는 도구는 보수적으로(파괴 가능) 표시하고 설명에 조건을 적습니다.
- 구조화 출력: 이미 `format=json` 을 제공하는 5종(`diagnose_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network`·`validate_egovframe_project`)에 zod `outputSchema` 를 선언하고 `structuredContent` 를 함께 돌려줍니다(`text` 는 유지). 스키마는 `src/*.ts` 의 결과 인터페이스에서 도출하며 테스트가 실제 결과를 스키마로 검증합니다.
- 테스트 플랫폼 중립 가드: v0.30·v0.31 에서 두 번 연속 Windows gate 만 깨진 원인(테스트가 POSIX 경로·래퍼 이름을 가정)을 구조적으로 막습니다 — (a) `resolveCommand`·`walk`·경로 비교처럼 플랫폼 분기가 있는 함수는 `platform` 주입 옵션을 두고 테스트가 `win32`·`linux` 양쪽을 명시적으로 단언, (b) `scripts/check-test-portability.mjs` 가 `test/*.mjs` 에서 `"./mvnw"`·`endsWith("/…")`·`path.sep` 미정규화 `path.relative` 같은 패턴을 찾아 실패시키고 `prepublishOnly` 에 포함, (c) README 릴리스 절차 2단계에 "Windows 체크아웃에서 통과" 조건을 명문화.

**범위 (제외)**: 도구 추가, 응답 본문 변경, SDK 메이저 업그레이드(1.x 유지)

**검증 기준**: `test:handshake` 가 27종 전부 `title`·`annotations` 존재와 읽기 전용 도구의 `readOnlyHint` 를 단언, 구조화 출력 5종은 `structuredContent` 가 `outputSchema` 를 통과(오프라인 픽스처), 이식성 검사 스크립트가 현재 테스트에서 0건, Windows gate 3개 통과

**완료 정의**: 도구 27종(변화 없음), deprecated API 사용 0건, 기획 전 조사한 Claude Desktop·VS Code 에서 읽기 전용 도구가 승인 없이 실행되는지 수동 확인 1회

**결과(2026-10-02) — 완료**: `server.tool()` 27회 → `registerTool` 27회(deprecated 0건), `src/tool-meta.ts`(title ko/en·annotations)와 `src/output-schemas.ts`(zod, 핵심 필드 엄격·그 외 passthrough) 추가, `test:output-schemas` 41단언·handshake 확장. 이식성 검사는 과거 두 번의 Windows 실패 줄을 모두 잡는 것을 확인했고, 현재 테스트에서 잠복해 있던 같은 유형 1건(`test/dependencies.mjs` 의 `path.relative` 비교)을 추가로 고쳤습니다. 의도된 POSIX 경로 12줄은 사유를 달아 허용했습니다. 클라이언트 수동 확인(읽기 전용 도구 자동 승인)은 npm 배포 뒤 저장소 소유자가 수행합니다.

### v0.33.0 — `migrate_egovframe_project` 3단계: 검증 + 공통컴포넌트 대응표

**목표**: 2단계 적용 뒤 남는 일(컴파일 오류 고치기)을 사람이 처음부터 찾지 않게 합니다. "컴파일 오류 N건 중 M건은 수동 항목 K 때문" 을 연결한 작업 목록을 돌려주고, 3.x 공통컴포넌트 소스가 섞인 프로젝트에는 5.0.6 기준 대응표와 재조립 권고를 냅니다.

**범위 (포함)**
- `migrate_egovframe_project(mode="verify")`(또는 `apply=true, verify=true`): `build_egovframe_project(goal="compile")` 을 실행해 파일·라인 단위 오류를 받은 뒤, 각 오류를 (1) 같은 파일의 수동 항목 — 라인 근접·심볼 일치(`cannot find symbol … Mapper` ↔ `class-removed Mapper→EgovMapper`), (2) 규칙 카탈로그의 제거 클래스·제거 모듈 심볼, (3) 분류 불가 로 나누고, 수동 항목별로 "이 항목을 처리하면 해결될 오류" 수를 붙여 우선순위를 매깁니다. 빌드 도구가 없으면 verify 는 건너뛰고 이유를 적습니다.
- 공통컴포넌트 3.x→5.x 대응표: `scripts/generate-migration-rules.mjs` 에 `egovframe-common-components` 저장소(v3.10.0 ↔ v5.0.6)를 두 번째 근거로 추가해 `egovframework.com.*` 의 제거 클래스(조사 시점 58종, 예: `cmm.util.EgovMybaitsUtil`, `sec.rnc.service.EgovSocketClient`, `ext.oauth.*`)·추가 52종·이름 변경 4종을 `packages.components` 로 기록합니다. 진단은 사용자 소스가 제거 클래스를 참조하면 `class-removed`(manual) 로 보고합니다.
- 재조립 권고: 진단에서 `diagnose_egovframe_project` 가 감지한 공통컴포넌트 패키지가 3.x 소스(`egovframework.rte` import 또는 `javax.servlet`)이면 "`add_egovframe_components` 로 5.0.6 을 다시 조립하고 사용자 수정은 백업과 diff 로 옮기라" 는 항목을 컴포넌트 단위로 1건씩 내고, 2단계 적용은 그 디렉터리를 치환 대상에서 뺄 수 있는 옵션(`skipComponents`)을 둡니다.

**범위 (제외)**: 컴파일 오류 자동 수정, 공통컴포넌트 소스의 3-way 병합(그건 `upgrade_egovframe_project` 가 매니페스트가 있을 때만 하는 일)

**검증 기준**: 픽스처(2단계 적용 후 제거 클래스를 참조하는 java 2개)로 verify 가 오류 ↔ 수동 항목을 정확히 연결, CI 통합에서 실제 `mvn compile` 오류 파싱 경로 통과, 규칙 정합 테스트가 공통컴포넌트 대응표의 목적지가 v5.0.6 트리에 있는지 검증, 공식 5.x 템플릿에서 verify 오류 0건

**완료 정의**: 도구 27종, `test:migrate` 에 verify 단언 추가, `docs/design-migration.md` 3단계 절, 규칙 카탈로그 schemaVersion 2(하위 호환 필드 유지)

**결과(2026-10-02) — 완료**: `verify` 는 `apply`·`dryRun` 과 같은 도구의 파라미터로 두었고(`mode` 문자열 대신), 연결은 심볼 일치 → 라인 근접 → 규칙 심볼 → 미분류 4단계입니다. 공통컴포넌트 대응표의 실제 수치는 제거 54·이동 4·추가 52(기획의 58 은 트리 비교에서 단순명 이동 4건을 빼기 전 값)이며, 생성기가 루트형(`src/main/java/`) 저장소도 읽도록 고쳤습니다. 큐레이션 대체는 `EgovMybaitsUtil`→`EgovMybatisUtil`(오타 정정) 1건입니다. CI 통합에서 실제 `mvn compile` 오류 3건이 수동 항목 2건에 전부 연결됐습니다.

### v0.34.0 — 의존성 기준 완성 + 규칙 drift 감시

**목표**: `check_egovframe_dependencies` 의 `unknown` 을 줄이고, 동봉 규칙·기준이 upstream 과 어긋나면 사람이 알게 합니다.

**범위 (포함)**
- Spring Boot BOM 전체: 생성기가 `spring-boot-starter-parent` → `spring-boot-dependencies` pom 을 Maven Central 에서 받아 `dependencyManagement`(약 300 좌표)와 그 안의 BOM import 를 한 단계 더 풀어 `catalog/dependency-baseline.json` 에 `managedBoot` 로 넣습니다(계열 규칙은 유지). Boot parent 프로젝트의 버전 없는 의존성은 `managed` 에 기준 버전을 함께 보입니다.
- RTE 모듈 전이 의존성: `egovframe-runtime` v5.0.2 모듈 pom 18종의 `<dependencies>` 를 읽어 mybatis·mybatis-spring·poi·quartz 등 RTE 가 끌어오는 버전을 `managedRte` 로 기록하고, 프로젝트가 같은 좌표를 더 낮은 버전으로 명시하면 `outdated`(사유: RTE 전이 버전과 충돌 가능) 로 봅니다.
- drift 감시: `sync_egovframe_templates` 에 `migrationRules`·`dependencyBaseline` 절을 추가해 (1) `egovframe-runtime` 최신 태그가 규칙의 `toTag` 보다 새로운지, (2) parent 2종의 최신 버전이 기준 `sources` 보다 새로운지, (3) parent pom sha256 이 바뀌었는지를 보고합니다(파일은 고치지 않음). 변화가 있으면 README 의 갱신 절차를 결과에 붙입니다.
- `check_egovframe_dependencies` 결과에 "기준 출처"(parent 직접 / 계열 / Boot BOM / RTE 전이)를 항목마다 표시합니다.

**범위 (제외)**: 자동 버전 올리기(파일 수정), 취약점 DB 동봉

**검증 기준**: 공식 5.x `egovframe-boot-web` 템플릿에서 `unknown` 0건, 공식 공통컴포넌트 v3.10.0 pom 에서 `unknown` 18 → 5 이하, drift 테스트는 네트워크(CI 통합)와 오프라인 모의 양쪽, 기준 카탈로그 생성이 재현 가능(sha256 고정)

**완료 정의**: 도구 27종, `test:dependencies` 확장, `docs/design-dependency-check.md` 갱신, 기준 파일 크기 200KB 이하 유지

**결과(2026-10-03) — 완료**: 기준 파일 `schemaVersion` 2 에 `boot`(spring-boot-dependencies 3.5.6 직접 362 + import 44종 → 1,473 좌표, 충돌 1건은 Maven 순서대로 직접 항목 유지)와 `rteTransitive`(모듈 18종 pom → 58 좌표, 버전·scope·`via`)를 넣었고 크기는 150KB 입니다. 기획과 달라진 점: (1) 표준프레임워크 저장소가 `maven-metadata.xml`·디렉터리 목록을 막아 두어 "최신 parent 버전" 대신 다음 patch 3개·minor·major 후보를 HEAD 로 탐침합니다 — 이 탐침이 기준(5.0.1)보다 새 parent 5.0.2 를 찾아 이번에 기준을 5.0.2 로 올렸습니다(차이는 RTE 버전뿐). (2) 태그 조회는 GitHub API 가 막히면 태그 페이지(HTML)로 대체합니다(`GITHUB_TOKEN` 이 있으면 API 에 씀). (3) 계열 규칙이 `org.springframework.social`·`.ldap` 까지 `org.springframework` 로 묶던 결함을 고쳐 groupId 정확 일치(jackson 만 하위 포함)로 좁히고 달력형 릴리스 트레인(`spring-cloud-dependencies`)은 계열에서 뺐습니다. (4) 공통컴포넌트 3.10 pom 의 `unknown` 17건 가운데 공개 기준이 있을 수 없는 국내 벤더·기관 배포 6건은 새 분류 `vendor`(사유 표시)로, EOL·이전 좌표 8건은 전환 규칙 `libraries` 에 교체 규칙을 추가해(`migrate_egovframe_project` 의 manual 항목으로도 나옵니다) 남은 `unknown` 은 `xerces:xercesImpl` 1건입니다. 검증: 공식 `egovframe-boot-web`·`egovframe-web` 템플릿 pom `unknown` 0, drift 테스트는 오프라인 주입 26단언 + CI 통합 실제 조회, 기준 생성은 `--cache`/`--offline` 으로 재현 가능(같은 입력 → 같은 파일).

## 이전 기획 (v0.29–v0.31, 완료)

v0.28.1 까지의 상태에서 다음 세 릴리스를 아래 순서로 진행합니다. 각 항목은 "완료 정의"를 만족해야 릴리스합니다. 기획 시점(2026-09-26)의 조사 근거는 맨 아래 "선행 조사 결과"에 있습니다. v0.29.0 은 2026-09-27 에 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다.

### v0.29.0 — `migrate_egovframe_project` 1단계: 전환 진단 (읽기 전용) — **완료**

**결과(2026-09-27)**: 완료 정의를 모두 충족했습니다 — 도구 24종, `test:migrate` 87단언·`test:migration-rules` 579단언 통과, `test:migration-rules-live` 61건(RTE 5.x·3.x 원본·parent·Jakarta 좌표) 실제 저장소 존재 확인, 공식 5.x `egovframe-web`·`egovframe-boot-web` 템플릿에서 항목 0건, 공식 `egovframe-common-components` v3.10.0 pom·web.xml·소스 일부에서 57건(auto 48·manual 9) 검출, 설계 문서 [docs/design-migration.md](docs/design-migration.md). 기획과 달라진 점: 규칙 근거를 "5.x 템플릿 pom + 공통컴포넌트 패키지 트리" 대신 **`egovframe-runtime` 저장소의 태그 3개(v3.10.0·v4.3.0-Final·v5.0.2-Final) 소스 트리 비교**로 잡아 클래스 단위 이동·제거를 기계적으로 도출했고(제거 38종은 큐레이션 사유 필수), 4.x 좌표(`org.egovframe.rte:org.egovframe.rte.*`)도 함께 다룹니다.

**목표**: 표준프레임워크 3.x/4.x 로 만든 기존 프로젝트를 5.x(Jakarta EE 9+, Spring 6) 기준으로 옮기기 위해 무엇을 바꿔야 하는지 파일·라인 단위로 보고합니다. 이 단계는 파일을 쓰지 않습니다. 진단 결과가 정확해야 2단계 자동 적용을 믿을 수 있으므로, 진단을 먼저 릴리스해 실제 프로젝트에서 검증합니다.

**범위 (포함)**
- Maven 좌표: `egovframework.rte:egovframework.rte.<layer>.<module>` → `org.egovframe.rte:egovframe-rte-<layer>-<module>` 대응표, RTE 버전 속성, 저장소 URL(`https://maven.egovframe.go.kr/maven/`) 유무, parent(`org.egovframe.web:egovframe-web-config-parent`, `org.egovframe.boot:egovframe-boot-starter-parent`) 사용 여부
- 자바 소스·XML: `egovframework.rte.*` import·bean class → `org.egovframe.rte.*`
- Jakarta 전환: `javax.servlet`·`javax.servlet.jsp`·`javax.validation`·`javax.persistence`·`javax.annotation`(Spring 6 에서 바뀐 것만) → `jakarta.*` 사용처 목록. `javax.sql`·`javax.xml` 등 JDK 내장 패키지는 대상에서 제외
- JSP/TLD: `web.xml` 스키마 버전, JSTL 좌표(`jakarta.servlet.jsp.jstl`)
- 자동 변환 불가 항목 보고: 3.x 에서 제거·변경된 RTE API(대응표에 `manual` 로 표시된 것), Spring 4→6 에서 사라진 클래스, `commons-dbcp`(1.x)·`log4j 1.x` 같은 교체 필요 라이브러리

**범위 (제외)**: 파일 수정, 빌드 실행, 공통컴포넌트 소스 자체의 버전 갱신(이는 `upgrade_egovframe_project` 영역)

**설계 요점**
- 규칙은 코드가 아니라 데이터로 둡니다: `catalog/migration-rules.json`(schemaVersion 1) 에 좌표 대응표·패키지 대응표·javax→jakarta 목록·수동 항목을 담고, 생성 스크립트가 공식 저장소(5.x 템플릿 pom, `egovframe-common-components` 5.x 패키지 트리)에서 근거를 대조합니다. 규칙 정합 테스트(`test:migration-rules`)가 대응표의 목적지 좌표·패키지가 실제 5.x 자산에 존재하는지 검증합니다.
- 도구 `migrate_egovframe_project(projectDir, target="5.x", format="json|markdown")` 은 `diagnose_egovframe_project` 의 스캔 결과(빌드 도구·RTE 버전·설치 컴포넌트)를 재사용하고, 항목마다 `{file, line, kind, from, to, auto|manual, reason}` 을 돌려줍니다. Markdown 요약(`generate_egovframe_report` 형식)도 제공합니다.
- 허용 root·읽기 전용 보장은 기존 도구와 동일합니다.

**검증 기준**
- 오프라인 픽스처: 3.10 스타일 pom·`egovframework.rte` import·`javax.servlet` 사용·XML bean 이 섞인 프로젝트로 항목 분류(auto/manual)·라인 위치·대응 좌표를 단언
- 실제 프로젝트: 공식 5.x `web-sample` 을 대상으로 "전환 항목 0건"(거짓 양성 없음) 확인
- 규칙 정합: 대응표의 모든 `to` 좌표가 `https://maven.egovframe.go.kr/maven/` 또는 Maven Central 메타데이터에 존재(네트워크 테스트, CI)

**완료 정의**: 도구 24종, 픽스처·규칙 정합 테스트 통과, 설계 문서 `docs/design-migration.md`(대응표 출처·수동 항목 근거·2단계 계획 포함)

### v0.30.0 — 전환 적용 + 의존성 점검

**`migrate_egovframe_project` 2단계 (적용)**
- 1단계 보고서의 `auto` 항목만 적용합니다: pom 좌표 치환, import·bean class 치환, `javax→jakarta` 치환. `manual` 항목은 결과에 그대로 남겨 사람이 처리하게 합니다.
- `dryRun` 기본값 `true`, 적용 시 `ProjectFileTransaction` 으로 파일·백업(`migration-backup/`)·보고서(`migration-plan.json`)를 하나의 transaction 으로 반영하고, 중간 실패 시 작업 전 상태로 복구합니다. 사용자 수정 여부와 무관하게 원본을 백업합니다(업그레이드 도구와 같은 원칙).
- 적용 후 `build_egovframe_project(goal=compile)` 을 권장 다음 단계로 안내하고, 컴파일 오류가 있으면 `manual` 항목과 연결해 보여 줍니다.
- 검증: 픽스처 프로젝트를 변환한 뒤 JDK 17 로 `mvn compile` 통과(CI 통합 테스트), 적용 중 fault-injection rollback

**`check_egovframe_dependencies(projectDir, offline=true)`**
- 프로젝트의 RTE·Spring·공통컴포넌트·주요 라이브러리 버전을 `catalog/dependency-baseline.json`(공식 5.x 템플릿에서 추출한 기준 버전)과 대조해 `outdated`·`unknown`·`ok` 로 분류합니다. 폐쇄망을 고려해 기본은 오프라인이며, `offline=false` 일 때만 OSV(`https://api.osv.dev`) 로 알려진 취약점을 조회합니다.
- 보안 설정 점검(구 `security_patch_advisor`)은 이 도구의 `checks` 항목으로 흡수합니다: CSRF 필터·`sec.security` 컴포넌트 설치 여부·`web.xml` 보안 헤더 필터 유무 등 존재 여부만 판정하고, 판정 근거(파일·라인)를 함께 돌려줍니다.

**완료 정의**: 도구 25종, 픽스처 변환 후 `mvn compile` 통과, 기준 버전 파일 생성 스크립트와 정합 테스트

**결과(2026-09-28) — 완료**: 도구 25종. 적용은 1단계가 auto 항목마다 붙이는 원문 오프셋 편집을 그대로 반영하는 방식으로 구현했고(`test:migrate` 132단언), 3.10 좌표·javax 픽스처 적용 후 JDK 17 `mvn compile` 통과(`test:migrate-integration`), 공식 공통컴포넌트 v3.10.0 자산에서 auto 48항목·86곳 적용 후 재진단 auto 0 을 확인했습니다. 의존성 기준은 공식 parent 2종의 pom 에서 생성(`scripts/generate-dependency-baseline.mjs`, 관리 좌표 139종 + BOM 계열 7종)했고 `test:dependencies` 68단언·`test:dependencies-live`(OSV) 로 검증했습니다. 기획과 달라진 점: parent 가 spring-* 를 BOM 으로 관리하므로 "계열 기준"(groupId 접두어) 개념을 추가했고, Spring Boot BOM 전체 목록은 담지 않고 `managed` 로 분류합니다. Jakarta 전환 규칙의 목적지 버전을 parent 기준 이상으로 맞췄습니다(jstl-api 3.0.2·jsp-api 4.0.0·validation-api 3.1.1·annotation-api 3.0.0·websocket-api 2.2.0).

### v0.31.0 — 운영 편의

- **`diagnose_egovframe_network`**: 도구가 쓰는 호스트(`codeload.github.com`·`raw.githubusercontent.com`·`media.githubusercontent.com`·`maven.egovframe.go.kr`·`registry.npmjs.org`)에 대한 접속 가능 여부·소요 시간·오류 종류(DNS·타임아웃·TLS·프록시 인증)를 보고하고, 환경변수 처방(`HTTPS_PROXY`+`NODE_USE_ENV_PROXY=1`, `NODE_OPTIONS=--dns-result-order=ipv4first`)을 안내합니다. 2026-09-21 새 노트북에서 `codeload.github.com` 접속 타임아웃으로 `test:templates` 가 실패했던 경험이 근거입니다. 기존 다운로드 경로가 실패할 때도 같은 처방을 오류 메시지에 붙입니다.
- **영문 README** 와 도구 설명의 영문 병기(응답 언어는 한국어 유지, `EGOVFRAME_LANG=en` 옵션 검토)
- **MCP Registry 등록** 과 `server.json` 메타데이터, Homebrew 탭은 후순위
- **`generate_agents_md`**: 프로젝트 진단 결과로 AI 코딩 도구용 `AGENTS.md`(빌드·테스트 명령, 설치 컴포넌트, 금지 사항)를 생성

**결과(2026-09-30) — 완료**: 도구 27종. 네트워크 진단은 호스트 7종(기획의 5종 + `repo1.maven.org`·`api.osv.dev`)을 실제로 프로브하고 실패를 8종으로 분류하며, Node 가 `--use-env-proxy` 를 지원하는지 런타임에서 감지해 `NODE_USE_ENV_PROXY=1` 처방을 냅니다. 기존 다운로드 경로(`fetchWithTimeout`)는 실패 시 같은 분류와 처방 한 줄을 오류에 붙입니다. 영문은 `README.en.md` 와 `EGOVFRAME_LANG=en` 도구 설명(27종 전부, handshake 테스트가 누락을 막음)으로 제공하고 응답은 한국어를 유지합니다. MCP Registry 는 `server.json`·`mcpName` 과 정합 테스트까지 준비했고 실제 게시(`mcp-publisher publish`)는 npm 배포 뒤 저장소 소유자가 실행합니다. Homebrew 탭은 후순위 그대로입니다.

### 릴리스 절차 (v0.35+, 매 버전 공통)

1. `main` 최신화 후 기능 브랜치 생성 → 패치 적용(`git am`) 또는 직접 커밋. 버전은 `package.json`·`server.json`(두 곳) 을 함께 올리고 README 변경 이력에 `- **X.Y.Z** — …` 항목을 쓴다(`test:release` 가 셋을 단언)
2. `npm ci && npm run prepublishOnly` 로컬 통과(Windows 클론은 `core.autocrlf` 무관하게 통과해야 함). 테스트 기대값은 플랫폼 중립이어야 한다 — 플랫폼 분기 함수는 `platform` 을 주입해 양쪽을 단언하고, `npm run check:portability` 가 0건이어야 한다
3. 푸시 → PR → CI 7개(ubuntu·windows × Node 18/20/22 + integration) 전부 통과 → squash 병합. **여기까지가 사람의 일입니다.**
4. 병합 뒤 `main` 의 CI 가 성공하면 `Release` 워크플로(`.github/workflows/release.yml`)가 `scripts/release-check.mjs` 로 전제(`server.json` 버전 일치·변경 이력 항목)를 확인하고 원격 상태(npm·태그·GitHub Release·MCP Registry)를 보아 **남은 단계만** 수행합니다: npm(OIDC trusted publishing, provenance 자동) → 게시된 커밋에 `vX.Y.Z` 태그 → GitHub Release(`scripts/release-notes.mjs`) → MCP Registry(GitHub OIDC). 조건이 안 맞으면 이유를 적고 성공 종료합니다(문서만 바꾼 병합은 아무것도 게시하지 않음)
5. 확인: Actions 의 `Release` 요약(단계별 결과), `npm view egovframe-scaffold-mcp version`, Releases 페이지, 레지스트리 검색. 도중에 끊기면(v0.36.1 처럼 npm 전파 지연, Registry 실패 등) 손댈 것 없이 다음 `main` 병합(또는 `Run workflow`)의 Release 가 이어서 합니다 — npm 만 돼 있으면 태그를 npm 이 기록한 `gitHead` 커밋에 만들므로 패키지와 태그가 같은 코드를 가리킵니다(그 커밋이 `main` 의 조상이 아니면 수동 태그를 안내하고 멈춤)

비상용 수동 절차(워크플로를 쓸 수 없을 때): `main` 에서 `node -p "require('./package.json').version"` 으로 버전 확인 **후** 태그를 `main` 커밋에 생성·푸시 → `npm publish` → `mcp-publisher publish`. 태그는 반드시 병합된 `main` 커밋에 답니다(v0.25.2·v0.28.0·v0.28.1·v0.30.0·v0.33.0 에서 잘못 단 적이 있어 자동화했습니다).

### 선행 조사 결과 (2026-10-04)

- **npm trusted publishing**: 2025-07-31 GA. npm CLI 11.5.1+·Node 22.14+, 워크플로 `permissions: id-token: write`, npmjs.com 에 trusted publisher(조직/사용자·저장소·워크플로 파일명·선택 environment) 등록. 공개 저장소·공개 패키지면 provenance 자동 첨부(`provenance=false` 로 끌 수 있음). self-hosted 러너 미지원, `workflow_call` 재사용 워크플로는 호출 워크플로 이름으로 검사되므로 단일 파일 `release.yml` 로 둡니다.
- **MCP Registry**: `mcp-publisher login github-oidc` 로 비밀 없이 로그인(`id-token: write`), `io.github.<owner>/*` 네임스페이스는 GitHub 계정 소유로 증명. 바이너리는 `github.com/modelcontextprotocol/registry/releases` 에서 OS/ARCH 별 tar.gz. npm 에 `mcpName` 이 있는 패키지가 **먼저** 게시돼 있어야 하므로 npm 단계 뒤에 실행. 저장소에는 아직 검색 결과 0건.
- **해석된 의존성**: 공식 `egovframe-web` 템플릿 pom(자리표시자만 채움)에 `maven-dependency-plugin:3.8.1:list -DincludeScope=runtime` → **67 artifact**, `cyclonedx-maven-plugin:2.9.3:makeBom -DschemaVersion=1.6` → pom 변경 없이 186KB JSON, component 69(purl·MD5/SHA 해시·라이선스 포함). 해석 집합을 v0.34 분류기로 판정하면 parent 직접 23·계열 13·RTE 전이 9·Boot BOM 4 가 `ok`, 기준 미만 11(RTE 5.0.0 7 + Boot BOM 4), 기준 없음 9(commons-collections 3·commons-logging·antlr 런타임 등), OSV 권고가 붙는 component 8(spring-webmvc/-core/-web/-webflux/-expression 6.2.11, log4j-core/-api 2.25.3, commons-configuration2 2.11.0). 선언만 보던 결과(조치 0)와 크게 다릅니다. 플러그인 최신: maven-dependency-plugin 3.11.0, cyclonedx-maven-plugin 2.9.3, cyclonedx-gradle-plugin 3.4.1(검증한 버전으로 고정).
- **SBOM 정책**: 과기정통부·국정원 SW 공급망 보안 로드맵(2026-06)은 2027년부터 공공기관이 도입 SW 의 SBOM 을 통합관리체계에 등록·공급망 위험을 상시 점검하고 공공 IT 사업에서 SBOM 과 취약점 대응 절차 제출을 요구하도록 단계화했습니다(형식은 SPDX/CycloneDX 를 특정하지 않음 — CycloneDX 1.6 JSON 을 기본으로 두고 SPDX 는 변환으로 대응).
- **4.x 자산**: `egovframe-common-components` 는 v4.3.2 가 4.x 마지막 태그(java 1,295개, 의존성 70건). pom 에 현행 진단을 돌리면 4.x 좌표 9·Jakarta 8·라이브러리 8·제거 모듈 1(auto 19·manual 11) 이 잡히고, 의존성 점검은 `project:*` groupId 의 system scope 로컬 jar 10건(ojdbc6·altibase·tibero5·cubrid·goldilocks8·smeapi·gpki 2·onepass)과 `javax.faces:javax.faces-api` 가 `unknown` 으로 남아 v0.36 소급·v0.37 코퍼스의 첫 수정 대상입니다.
- **릴리스 사고 기록(동기)**: v0.30.0 태그가 병합 전 커밋에(복구), v0.33.0 태그가 로컬 main 커밋에(복구), 0.32.0·0.33.0 npm 미배포(0.33.0 은 Windows 게이트 결함으로 의도적 건너뜀), #33·#36 Windows 게이트 실패 상태 병합. 모두 수동 절차 단계에서 발생.

### 선행 조사 결과 (2026-10-02)

- `@modelcontextprotocol/sdk` 설치 버전 1.29.0(최신 1.31.0)에서 `McpServer.tool()` 은 deprecated 이고 `registerTool()` 이 `title`·`inputSchema`·`outputSchema`·`annotations`(`readOnlyHint`·`destructiveHint`·`idempotentHint`·`openWorldHint`)를 받습니다. 현재 서버는 `tool()` 27회 호출이며 annotations·outputSchema 를 쓰지 않습니다.
- `egovframe-common-components` 는 v5.0.6 이 최신(카탈로그와 동일)이고, `src/main/java` 클래스 수는 v3.10.0 1,095 → v5.0.6 1,089, 제거 58·추가 52·단순명 기준 이름 변경 4 입니다. 패키지 구조(`egovframework.com.<domain>`)는 유지돼 대응표가 작습니다.
- `egovframe-runtime` 최신 태그는 v5.0.2-Final(규칙 카탈로그와 동일), 공식 parent 는 web·boot 모두 5.0.1 로 기준 카탈로그와 동일합니다 — 2026-10-02 기준 drift 없음.
- MCP Registry 에 `io.github.EricSeokgon/egovframe-scaffold-mcp` 검색 결과는 0건으로 아직 게시 전입니다.

### 선행 조사 결과 (2026-09-26)

- 공식 템플릿은 이미 **5.x** 입니다: `egovframe-web-sample` 은 `org.egovframe.web:egovframe-web-config-parent:5.0.1`, `egovframe-template-simple-backend` 는 `org.egovframe.boot:egovframe-boot-starter-parent:5.0.1`(프로젝트 5.0.2, Java 17). 의존성은 `jakarta.servlet`·`jakarta.validation`·`jakarta.json` 이고 일부 라이브러리는 `jakarta` classifier 를 씁니다. 따라서 전환 도구의 목적지는 "4.x" 가 아니라 **5.x(Jakarta)** 로 잡습니다.
- 5.x 실행환경 좌표는 `org.egovframe.rte:egovframe-rte-<layer>-<module>`(예: `egovframe-rte-ptl-mvc`, `egovframe-rte-psl-dataaccess`, `egovframe-rte-fdl-idgnr`, `egovframe-rte-fdl-property`)이며, 저장소는 Maven Central 과 `https://maven.egovframe.go.kr/maven/` 두 곳입니다. 3.x 의 `egovframework.rte:egovframework.rte.<layer>.<module>` 과 이름 규칙이 달라 대응표가 필요합니다.
- `egovframe-docs` 저장소에는 3.x→4.x/5.x 전환 가이드 문서가 없습니다(2026-09-26 기준). 대응표는 공식 5.x pom 과 `egovframe-common-components` 5.x 패키지 트리에서 도출해야 하며, 그 도출 스크립트와 근거를 `docs/design-migration.md` 에 남깁니다.
- `diagnose_egovframe_project` 는 RTE 버전을 pom 문자열 패턴으로 추정합니다. 전환 진단은 여기에 좌표 기반 판정(`egovframework.rte` groupId 존재 = 3.x 계열)을 더해 정확도를 올립니다.
- Initializr upstream 에서 발견한 문제 3건(v0.28.0 변경 이력 참조)은 별도 이슈로 제출할 후보입니다.

로드맵 근거:

- `egovframe-development`에는 공식 CRUD 마법사 입력과 두 템플릿 트리가 있으며, MCP가 같은 입력 체계를 사용하면 IDE와 대화형 도구의 경험을 맞출 수 있습니다.
- `egovframe-vscode-initializr`에는 기계 판독 가능한 프로젝트·context XML 카탈로그가 이미 있어 새 목록을 만들기보다 공통 스키마로 승격하는 편이 유지보수에 유리합니다.
- `egovframe-common-components` v5.0.6 분석 결과, 실제 실행에는 소스·Mapper·JSP 외 리소스·설정·기능별 의존성·보안 패치 추적이 필요합니다.

상세 기획과 조사 근거는 [egovframe-contribution-notes의 v0.20+ 로드맵](https://github.com/EricSeokgon/egovframe-contribution-notes/blob/main/scaffold-mcp_v020%ED%94%8C%EB%9F%AC%EC%8A%A4_%EB%A1%9C%EB%93%9C%EB%A7%B5.md)에서 관리합니다.

개발 기반 개선도 병행합니다: GitHub Actions와 `prepublishOnly` 전체 테스트 일치, lockfile 기반 재현 설치, Windows·한글 경로·대용량 zip 검증 강화. 단일 파일이던 `src/index.ts`(약 3,200줄)는 도메인별 모듈 14개로 분리했으며(공개 export·MCP 프로토콜 표면 불변), `index.ts`는 진입점과 공개 API 재수출만 담당합니다.

## 변경 이력

- **0.37.0** — 전환 준비도 평가서 + 회귀 코퍼스(도구 28종 유지). (1) `generate_egovframe_report(sections=["components"|"assessment"], resolve, resolveScope, resolveTimeoutMs, offline, sbomPath, topN, outputPath, dryRun, format)`: `assessment` 는 `diagnoseProject`·`migrateProject`·`checkDependencies`(보안 점검 포함)·SBOM 파일 확인을 한 번에 돌려 (1) 개요 (2) 전환 범위 — 종류별 표, 재조립 권고 컴포넌트, 제거된 API 참조 수, 수동 항목을 (종류, 대상) 으로 묶은 예상 수동 작업 상위 N (3) 의존성 — 판정 집계, 조치 목록(한 줄 조치 문구), 해석 요약, OSV 취약점, 벤더·기준 없음 참고 (4) 보안 설정 점검 (5) SBOM 요약 (6) 등급과 근거 — 전환 난이도(수동 항목·재조립 컴포넌트·제거 API 참조·좌표 세대)와 공급망 상태(기준 미만·전환/교체·취약점·보안 누락·parent/Java)를 요인별 구간 점수 합계로 A=0·B≤3·C≤7·D>7, 산식 전문을 리포트에 인쇄, 취약점 미조회·해석 실패는 주의로 표시. `format=json` 은 `outputSchema`(`structuredContent` 에서 Markdown 제외), `outputPath` 는 프로젝트 안 `.md` 새 파일만(기존 파일·`..`·절대·symlink 이탈 거부, transaction, `dryRun`). 기본 `sections=["components"]` 는 v0.16 리포트와 같은 본문. 도구 메타: 읽기 전용 힌트 제거(14 → 13종, 파일 생성·네트워크 가능), 비파괴, ko/en title·영문 설명. 새 모듈 `src/assessment.ts`(`MIGRATION_RUBRIC`·`SUPPLY_CHAIN_RUBRIC`·`computeGrade`·`assessProject`·`renderAssessmentMarkdown`)·`src/report.ts`(`generateProjectReport`), `resolveOutputPath` 를 SBOM·리포트 공용으로. (2) 회귀 코퍼스: `catalog/migration-corpus.json`(공식 `egovframe-common-components` v3.10.0 `aaebaa5`·v4.3.2 `bfa2ef5`, include 5경로, tolerance 1%)과 `scripts/corpus-lib.mjs`(sparse 부분 클론·커밋 검증·캐시 표식·측정·비교)·`scripts/generate-migration-corpus.mjs`(`--check`)·`test/migrate-corpus.mjs`(20단언, CI 통합 + `actions/cache`). 기대값: 3.10.0 항목 2,315(자동 1,507·수동 808, 재조립 159, 의존성 66)·4.3.2 항목 1,352(자동 635·수동 717, 재조립 155, 의존성 70), 두 세대 모두 확인 필요 클래스 0·기준 없음 `xerces:xercesImpl` 1·등급 D/D. 코퍼스가 새 결함을 드러내지는 않았습니다. (3) 릴리스 재개: `scripts/release-check.mjs` 가 npm 게시 여부·npm `gitHead`·태그·GitHub Release·MCP Registry 버전을 보고 남은 단계만 고르고(`mode=full|resume|none`, 단계별 출력), `release.yml` 은 단계별 `if` 와 요약, npm 전파 대기를 2분 → 10분·경고만으로(v0.36.1 Release #3 이 전파 지연으로 태그·Release·Registry 를 건너뛰고 재실행도 멈춘 결함). `test:release` 33 → 44단언. (4) 테스트: 신규 `test:assessment` 55단언(게이트), `test:output-schemas` 42 → 47(리포트 스키마·미선언 키), `handshake` outputSchema 7종·readOnly 13종, `test:dependencies-live` 에 공식 5.x 템플릿 전환 A 단언. 설계: [docs/design-assessment-report.md](docs/design-assessment-report.md). `server.json` 0.37.0.
- **0.36.1** — 첫 자동 배포(Release #2)가 npm 게시 단계의 `prepublishOnly` 안에서 `test:release` 로 멈춘 결함 수정(0.36.0 은 npm 에 게시되지 않았으므로 건너뜀). 원인은 워크플로가 `npm@latest` 를 설치해 npm 12 가 깔렸고, npm 12 의 `npm pack --json` 이 배열 대신 패키지 이름을 키로 한 객체를 돌려줘 tarball 검사가 `undefined` 를 읽은 것입니다. `test/release.mjs` 가 두 형식(및 앞선 경고 줄)을 모두 읽고(`parsePackJson`), 중첩 npm 호출에 부모 `npm_config_*`·lifecycle 환경을 넘기지 않으며, 실패 시 종료 코드와 출력 300자를 보고합니다(npm 10·12 로 검증). `release.yml` 은 npm 을 11 로 고정(trusted publishing 요건 ≥ 11.5.1 충족, 메이저 변경 차단), CI 의 `setup-java` 를 v5 로. 기능 변화 없음.
- **0.36.0** — 해석된 의존성 트리 + SBOM(도구 27 → 28종, 기존 파라미터 호환). (1) `src/dependency-tree.ts`: Maven `org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree -DoutputType=text -DoutputFile … -DappendOutput=true`(pom 변경 없음, 멀티 모듈은 루트별로 이어 붙음, `runtime` 이면 `-Dscope=runtime`)와 Gradle `dependencies --configuration runtimeClasspath|testRuntimeClasspath -q --console=plain` 의 출력을 파싱해 artifact 마다 깊이·트리 경로(`via`)·scope·요청↔해석 버전(`a:b:1.0 -> 1.2`)을 얻고, 같은 좌표는 가장 얕은 경로 하나로 줄입니다(`project :x`·`(c)`·`(n)` 제외, 루트 좌표 제외). 실행은 `build_egovframe_project` 의 Runner(타임아웃·프로세스 트리 종료·`mvnw`/`gradlew` 래퍼 감지)를 그대로 씁니다. (2) `check_egovframe_dependencies(resolve, resolveScope, resolveTimeoutMs)`: 선언에 없는 artifact 는 `origin: "transitive"` 항목(빌드 파일·라인 0·`via`·`depth`)으로 추가해 v0.34 분류기로 판정하고, 선언 좌표는 `treeVersion` 과 `resolution.differs`(가까운 선언이 이긴 결과)를 기록하며, parent 관리 좌표가 기준 미만 버전으로 해석되면 비고에 안내합니다. `resolution` 요약(artifact·직접·전이·판정 집계·명령·소요), OSV 조회는 전이까지 포함, 해석 실패·시간 초과는 선언 기준 결과에 이유를 붙입니다. Markdown 에 해석 요약·차이·전이 경로 열, outputSchema 확장. (3) 새 도구 `generate_egovframe_sbom(projectDir, outputPath="sbom/bom.cdx.json", bomFormat="cyclonedx-json", scope, enrich=true, offline=true, overwrite=false, dryRun=true, timeoutMs)`: Maven 은 `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom`(JSON·schema 1.6·`includeTestScope/ProvidedScope` 는 scope 에 따라)을 임시 디렉터리로 받아 해시·라이선스를 보존하고, Gradle 은 해석된 트리로 이 서버가 CycloneDX 1.6 문서(purl=`bom-ref`, 루트 좌표는 `settings.gradle`·`build.gradle`, 의존 그래프 `dependencies[]`)를 구성합니다. `enrich` 는 component 마다 `egovframe:status`·`egovframe:basis`·`egovframe:baseline` properties(재실행 시 갱신, 다른 속성 유지), `offline=false` 는 OSV 결과를 `vulnerabilities[]`(ID 정렬, 같은 ID 는 `affects` 로 합침, `source` OSV)로 넣고 실패는 `osvError` 로만 기록합니다. 출력은 프로젝트 안 상대 경로만(`..`·절대·드라이브·symlink 이탈 거부), 기존 파일은 `overwrite=true` 가 아니면 거부, transaction 으로 기록, `dryRun` 은 실행 없이 명령·경로만. 도구 메타(ko/en title, 비파괴·openWorld, outputSchema+structuredContent — 문서 본문은 파일에 있으므로 제외), 영문 설명. (4) 규칙 소급: `vendorCoordinates` 에 `project`(system scope 로컬 jar)·`com.goldilocks`, Jakarta artifact 에 `javax.faces:javax.faces-api → jakarta.faces:jakarta.faces-api:4.1.2`. 공통컴포넌트 4.3.2 pom 의 기준 없음 11 → 1. (5) 워크플로의 `actions/checkout`·`setup-node` 를 v5 로(Node 20 deprecated 경고 해소). 테스트: `test:dependencies` 104 → 129단언(파서·명령·가짜 runner resolve·실패·시간 초과·Gradle), 신규 `test:sbom` 37단언(게이트)·`test:sbom-live`(CI 통합: 공식 web 템플릿 실제 Maven 해석 ≥60·SBOM ≥60 component·OSV 취약점·Gradle 샘플), `test:output-schemas`·`handshake` 28종·6종 반영, `test:migration-rules` 632. 설계: [docs/design-dependency-check.md](docs/design-dependency-check.md) 해석·SBOM 절. `server.json` 0.36.0.
- **0.35.0** — 릴리스 자동화(배포 공급망; 도구 27종 유지, 서버 동작 변화 없음). (1) `.github/workflows/release.yml`: `main` 에서 CI 워크플로가 성공한 뒤(`workflow_run`, 수동 `workflow_dispatch` 가능) `scripts/release-check.mjs` 가 `package.json` 버전으로 네 조건 — `server.json` 두 `version` 일치, README 변경 이력에 해당 항목 존재, 원격 태그 `vX.Y.Z` 없음, npm 에 그 버전 없음 — 을 검사해 모두 맞을 때만 배포합니다(아니면 이유를 적고 성공 종료). 배포는 `mcp-publisher validate` → `npm publish --access public`(npm trusted publishing: OIDC·토큰 없음·공개 패키지라 provenance 자동; Node 22·npm 최신) → npm 반영 확인(재시도) → 검증된 `main` 커밋에 주석 태그 생성·푸시 → `scripts/release-notes.mjs` 가 변경 이력 항목에서 만든 본문(번호 단락·설치 스니펫·검증 안내)으로 GitHub Release → `mcp-publisher login github-oidc && mcp-publisher publish`(실패해도 릴리스는 유지, 경고) 순서입니다. 선행 조건은 npmjs.com 의 trusted publisher 1회 등록(`release.yml`). (2) `server.json` 의 `description` 이 MCP Registry 상한(100자)을 넘어 첫 등록이 실패할 상태였던 것을 `mcp-publisher validate` 로 발견해 98자로 줄였고 `test:registry` 가 100자 이하를 단언합니다. CI 통합 job 에 `mcp-publisher validate` 단계 추가. (3) 신규 `test:release`(게이트, 32단언): 판정 함수(조건별 거부·이유 누적), 변경 이력 항목 추출·릴리스 노트 렌더링, 현재 버전 항목 존재, `npm pack --dry-run` 의 tarball 내용(dist·catalog·설정 템플릿·README·LICENSE 포함, test·scripts·src·.github·소스맵 제외, 압축 600KB·풀면 2MB 상한). 스크립트 `release:check`·`release:notes`. README 릴리스 절차를 "PR 병합까지가 사람의 일" 로 고치고 수동 절차는 비상용으로 남겼습니다. `server.json` 0.35.0.
- **0.34.0** — 의존성 기준 완성 + 규칙·기준 drift 감시(도구 27종 유지, 기존 파라미터 호환). (1) `catalog/dependency-baseline.json` schemaVersion 2: 생성기가 Boot parent 의 상위와 같은 버전의 `spring-boot-dependencies`(Maven Central)를 받아 직접 항목과 BOM import 44종을 한 단계 풀어 `boot.managed`(1,473 좌표, Maven 해석 순서로 직접 항목 우선)에, `egovframe-runtime` 모듈 pom 18종(+root)의 test·optional 제외 의존성을 `rteTransitive.managed`(58 좌표, 버전·scope·끌어오는 모듈)에 기록합니다. 모든 pom 은 url·sha256 고정, `--cache`/`--offline` 으로 재현 가능, 파일 150KB. 기준 parent 를 5.0.2 로 올렸습니다(5.0.1 과의 차이는 RTE 버전). (2) `check_egovframe_dependencies`: 대조 순서 parent 직접 → 계열 → (Boot parent) Boot BOM → RTE 전이 / (그 밖) RTE 전이 → Boot BOM, 항목마다 `basis`(parent·family·boot-bom·rte-transitive·migration-rules) 표시, Markdown 에 출처 집계·출처 열. RTE 전이 버전보다 낮게 명시하면 충돌 가능 사유와 함께 기준 미만. Boot parent 프로젝트의 버전 없는 의존성은 Boot BOM 기준 버전을 함께 보입니다. 새 분류 `vendor`(국내 DBMS·GPKI·mGov 등 벤더·기관 배포 좌표, `catalog/migration-mapping.json` 의 `vendorCoordinates`, 사유 표시). 계열 규칙은 groupId 정확 일치(jackson 만 하위 groupId 포함)로 좁혀 `org.springframework.social` 같은 별도 프로젝트를 Spring 계열로 오판하던 결함을 고쳤고, 달력형 릴리스 트레인(`spring-cloud-dependencies` 2025.0.0)은 계열에서 빼 `releaseTrains` 에 적습니다. (3) 전환 규칙 `libraries` 에 EOL·이전 좌표 교체 규칙 8건 추가 — `mysql:mysql-connector-java`→`com.mysql:mysql-connector-j`, `ojdbc:ojdbc`→`com.oracle.database.jdbc:ojdbc11`, `org.codehaus.jackson:*`(Jackson 1), `xmlbeans:xbean`, `net.sf.ehcache:ehcache*`(Spring 6 에서 EhCache 2 지원 제거), `org.apache.httpcomponents:httpclient`(Spring 6 은 HttpClient 5), `org.antlr:antlr`(제거된 spring-modules-validation 의 전이), `org.springframework.social:*`. `migrate_egovframe_project` 진단에도 manual 항목으로 나옵니다. 공식 공통컴포넌트 v3.10.0 pom 의 '기준 없음' 17 → 1(`xerces:xercesImpl`), 공식 `egovframe-boot-web`·`egovframe-web` 템플릿 pom 0. (4) `sync_egovframe_templates` 에 `catalogs` 절(`src/catalog-drift.ts`): `egovframe-runtime`·`egovframe-common-components` 태그 목록(GitHub API → 실패 시 태그 페이지 HTML, `GITHUB_TOKEN` 선택)에서 규칙 `toTag` 보다 새 태그, 공식 parent 2종의 다음 patch 3개·minor·major 후보 HEAD 탐침(저장소가 `maven-metadata.xml`·목록을 막아 둠), parent pom·Boot BOM pom sha256 변화를 보고하고 변화가 있으면 갱신 절차를 붙입니다. 조회 실패는 항목별 오류로 남기고 drift 로 치지 않으며 파일은 고치지 않습니다. 영문 도구 설명·리소스 설명 갱신. 테스트: `test:dependencies` 68 → 104단언, `test:migration-rules` 613 → 628, 신규 `test:catalog-drift` 26단언(게이트)·`test:catalog-drift-live`(CI 통합, `GITHUB_TOKEN` 전달), `test:dependencies-live` 에 공식 템플릿·3.10 pom 기준 단언 4건. 설계: [docs/design-dependency-check.md](docs/design-dependency-check.md). `server.json` 0.34.0.
- **0.33.1** — Windows 빌드 오류 경로 수정. Maven·Gradle 컴파일 오류 파서가 `:` 를 파일명 경계로 보아 `C:\work\A.java` 를 `:\work\A.java` 로 잘라내던 문제를 고쳤습니다(드라이브 문자를 경로의 일부로 인식). 이 때문에 Windows 에서 `build_egovframe_project`·`test_egovframe_project` 의 오류 파일 경로가 깨지고 `migrate_egovframe_project(verify=true)` 가 오류를 수동 항목과 연결하지 못했으며, 릴리스 게이트 `test:migrate` 가 Windows 에서 실패했습니다(v0.33.0 CI windows 게이트 3건 실패의 원인). `test:migrate` 에 Windows 드라이브 경로 단언 3건 추가(162 → 165). 기능 변화 없음.
- **0.33.0** — 5.x 전환 3단계(검증) + 공통컴포넌트 대응표(도구 27종 유지). (1) `migrate_egovframe_project(verify=true)`: 진단 뒤 `compile` 을 실행해 컴파일 오류를 진단 항목과 연결합니다 — 같은 파일의 심볼 일치(`cannot find symbol … class Mapper` ↔ `class-removed Mapper`, `package X does not exist` ↔ 접두 일치, 수동 항목 우선) → 같은 파일 라인 ±3 의 수동 항목 → 규칙 카탈로그의 제거 클래스·`egovframework.rte`/`javax` 패키지 부재(적용 미완 안내) → 미분류. 수동 항목별 "해결될 오류 수" 내림차순 작업 목록을 만들고 오류와 무관한 수동 항목도 0건으로 붙여 빠짐이 없게 합니다. `parseBuildErrors` 가 javac 후속 줄 `symbol:`·`location:` 을 `BuildError.symbol/location` 으로 붙입니다(Maven·Gradle). 빌드 파일이 없으면 검증을 건너뛰고 이유를 적습니다. (2) 규칙 카탈로그 schemaVersion 2: 생성기가 `egovframe-common-components` v3.10.0 ↔ v5.0.6 소스 트리를 두 번째 근거로 비교해 `packages.components`(제거 54·이동 4·추가 52, commit 고정)를 기록합니다. 진단이 `egovframework.com.*` 참조 중 대응표의 제거 클래스는 `component-class-removed`(manual, 대체 `EgovMybaitsUtil`→`EgovMybatisUtil` 큐레이션), 이동 클래스는 `component-class-moved`(auto) 로 보고하며, 대응표에 없는 클래스는 사용자 코드일 수 있어 보고하지 않습니다. (3) 재조립 권고: 감지된 공통컴포넌트 디렉터리 안에 3.x 전환 항목이 있으면 컴포넌트당 `component-reassemble`(manual) 1건을 내고, `skipComponents=true` 면 그 디렉터리의 자동 항목을 수동으로 돌려 치환에서 뺍니다. 구조화 출력 스키마에 verify 필드 추가, 영문 도구 설명 갱신. 테스트: `test:migrate` 132 → 162단언, `test:migration-rules` 605단언, `test:migrate-integration` 에 실제 컴파일 오류 연결 3건. 설계: [docs/design-migration.md](docs/design-migration.md) 3단계 절. `server.json` 0.33.0.
- **0.32.0** — MCP 프로토콜 현대화(도구 27종 유지, 응답 본문 변경 없음). (1) SDK 1.29 에서 deprecated 된 `server.tool()` 27회를 `registerTool()` 로 바꾸고, `src/tool-meta.ts` 의 ko/en `title` 과 annotations 를 `tools/list` 에 노출합니다 — `readOnlyHint` 14종(목록·검색·상세·가이드·문서 검색·진단·검증·리포트·의존성 점검·네트워크 진단·upstream 대조 2종), `destructiveHint` 4종(`remove_egovframe_components`·`upgrade_egovframe_project`·`migrate_egovframe_project`·`generate_agents_md` — 인자에 따라 성격이 바뀌는 도구는 보수적으로 표시), `idempotentHint`(읽기 전용·빌드·테스트), `openWorldHint`(다운로드·OSV·네트워크 프로브·빌드). MCP 클라이언트가 읽기 전용 도구를 승인 없이 실행하거나 파괴 가능 도구에 확인을 요구하는 근거가 됩니다. (2) `format=json` 을 제공하던 5종(`diagnose_egovframe_project`·`validate_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network`)에 `src/output-schemas.ts` 의 zod `outputSchema` 를 선언하고 `structuredContent` 를 함께 돌려줍니다(`text` 유지; 전환 결과의 내부 편집 오프셋 `edits` 는 구조화 출력에서 제외). SDK 가 호출 시 결과를 스키마로 검증하므로 결과 인터페이스가 어긋나면 즉시 드러납니다. (3) 테스트 이식성 가드 — v0.30·v0.31 에서 Windows gate 만 두 번 깨진 원인(테스트의 POSIX 가정)을 `scripts/check-test-portability.mjs`(정규화 없는 `path.relative` 비교, `./mvnw` 리터럴, POSIX 절대 경로)로 잡아 `prepublishOnly` 에 넣었고, `collectAgentsFacts` 에 `platform` 주입을 추가해 linux·win32 양쪽을 단언합니다. 잠복해 있던 같은 유형 1건(`test/dependencies.mjs`)을 함께 고쳤습니다. `buildServer({ lang })` 은 title 에도 적용됩니다. 테스트: `test:output-schemas` 41단언, handshake 확장, `check:portability`. `server.json` 0.32.0.
- **0.31.0** — 운영 편의: 도구 25 → 27종. (1) `diagnose_egovframe_network` — 도구가 내려받는 호스트 7종에 DNS 조회와 HEAD 요청을 실제로 보내 도달 여부·소요 시간·실패 종류(DNS·타임아웃·TLS·프록시 인증·거부·재설정·도달 불가·HTTP 5xx)를 보고하고, 환경변수(`HTTPS_PROXY`·`NO_PROXY`·`NODE_USE_ENV_PROXY`·`NODE_OPTIONS`·`NODE_EXTRA_CA_CERTS`, 자격 증명 가림)와 Node 의 `--use-env-proxy` 지원 여부를 함께 보여 준 뒤 상황별 처방(프록시 사용·IPv4 우선·사내 CA·프록시 인증·DNS 허용 목록)을 bash/cmd/PowerShell 명령으로 안내합니다. `NODE_TLS_REJECT_UNAUTHORIZED=0` 은 경고합니다. 모든 다운로드 경로(`fetchWithTimeout`)가 실패할 때 같은 분류와 한 줄 처방을 오류 메시지에 붙입니다(2026-09-21 새 노트북의 `codeload` 타임아웃이 계기). (2) `generate_agents_md` — 진단 결과(빌드 도구·래퍼·RTE·5.x 전환 상태·DbType·기본 패키지·설정 디렉터리·설치 컴포넌트와 매니페스트 여부·백업 디렉터리)로 AI 코딩 도구용 `AGENTS.md` 를 만듭니다. 규칙 절은 이 서버의 도구가 지키는 원칙(좌표 체계·백업 디렉터리 미커밋·비밀 정보·parent 관리 좌표)을 옮긴 것이며, `dryRun`·`overwrite`·`fileName`(`CLAUDE.md` 등)·`lang`(ko/en)을 지원하고 transaction 으로 씁니다. (3) 영문 — `README.en.md` 와 `EGOVFRAME_LANG=en`(도구 설명 27종 영문, 응답은 한국어). (4) MCP Registry — `server.json`(`io.github.EricSeokgon/egovframe-scaffold-mcp`, npm 패키지·stdio·환경변수 2종 문서화)과 `package.json` `mcpName`, 정합 테스트 `test:registry`. `SERVER_VERSION` 을 `src/version.ts` 로 분리(순환 import 방지), `buildServer({lang})` 옵션 추가. 테스트: `test:network` 33단언·`test:agents-md` 22단언·`test:registry`, handshake 에 영문 설명 검증, CI 통합 job 에 `test:network-live`. 기존 25개 도구 하위 호환.
- **0.30.0** — 5.x 전환 적용(2단계) + 의존성 점검: 도구 24 → 25종. (1) `migrate_egovframe_project` 에 `apply`·`dryRun` 파라미터를 추가해 1단계 진단이 `auto` 로 표시한 항목을 실제로 치환합니다. 진단이 항목마다 원문 오프셋 기준 편집(`edits`)을 붙이고 적용은 이를 파일별로 뒤에서부터 반영하므로 미리보기와 실제 적용이 같은 근거를 씁니다 — RTE 좌표(groupId/artifactId/version 텍스트), RTE 버전 속성 이름·값(`<org.egovframe.rte.version>5.0.2`)과 `${속성}` 참조, 패키지 접두어·이름 변경·이동, `javax→jakarta` 패키지와 의존성 좌표(JSTL 은 glassfish 구현을 치환 결과에 없을 때만 삽입), 저장소 URL, Java 17, web.xml 여는 태그(xmlns·version·schemaLocation), gradle 문자열. 요소 이름·들여쓰기·주석은 유지하고 `manual` 항목은 건드리지 않습니다. `dryRun`(기본)은 파일별 변경 줄 미리보기만 돌려주고, 적용은 `withFileTransaction` 으로 원본을 `migration-backup/<시각>-<id>/` 에 보관한 뒤 치환하며 `migration-plan.json` 을 남기고 중간 실패 시 작업 전 상태로 복구합니다(쓰기 전 진단 시점 내용과 재대조). 적용 후 재진단 요약(`remaining`, auto 0 기대)과 `build_egovframe_project(goal="compile")` 안내를 붙입니다. 백업 디렉터리는 이후 스캔에서 제외합니다. `<source>${java.version}</source>` 처럼 속성 참조는 속성 항목이 담당하도록 진단을 조정했습니다. (2) `check_egovframe_dependencies` — 공식 5.x parent 2종(`egovframe-web-config-parent`·`egovframe-boot-starter-parent` 5.0.1)의 pom 을 표준프레임워크 저장소에서 내려받아 `catalog/dependency-baseline.json`(관리 좌표 139종, BOM import·버전 속성에서 도출한 계열 기준 7종, sha256 기록)을 생성하고(`scripts/generate-dependency-baseline.mjs`), 프로젝트 의존성을 기준 충족/기준 미만/parent 관리/전환 대상(3.x·4.x RTE·javax 좌표)/교체 필요(전환 규칙의 라이브러리 목록)/기준 없음/버전 없음 으로 분류합니다. 5.x parent 사용·버전, Java 버전(parent 관리 인식), 보안 설정 존재 점검 5종(sec.security 컴포넌트·CSRF·XSS 필터·보안 응답 헤더·HTTPS 저장소, 파일·라인 근거)을 함께 보고하며, `offline=false` 면 OSV `querybatch` 로 버전이 확정된 의존성의 알려진 취약점을 붙입니다(실패는 `osvError` 로만 기록). 리소스 `egovframe://catalog/dependency-baseline` 추가. Jakarta 전환 규칙의 목적지 버전을 parent 기준 이상으로 맞췄고(`test:migration-rules` 가 이를 검사), `fetchWithTimeout` 이 요청 옵션을 받습니다. 테스트: `test:migrate` 87 → 132단언, `test:dependencies` 68단언, `test:migration-rules` 597단언, CI 통합 job 에 `test:migrate-integration`(적용 후 JDK 17 `mvn compile`)·`test:dependencies-live`(OSV) 추가. 설계: [docs/design-migration.md](docs/design-migration.md)(2단계 절), [docs/design-dependency-check.md](docs/design-dependency-check.md). 기존 24개 도구 하위 호환.
- **0.29.0** — 5.x 전환 진단(1단계): `migrate_egovframe_project` 추가(도구 23 → 24). 표준프레임워크 3.x/4.x 프로젝트를 5.x(Jakarta EE 9+, Spring 6, Java 17) 로 옮길 때 바꿔야 할 것을 파일·라인 단위로 보고합니다 — RTE Maven 좌표(`egovframework.rte:egovframework.rte.<module>`·4.x 의 `org.egovframe.rte:org.egovframe.rte.<module>` → `org.egovframe.rte:egovframe-rte-<module>`, 18모듈)와 RTE 버전 속성·저장소 URL(http → https)·5.x parent 권고, Java 17 미만 컴파일 설정, Spring 6 미만 속성, 패키지 접두어(`egovframework.rte.*` → `org.egovframe.rte.*`)와 5.x 에서 이름이 바뀐 패키지 4건(`fdl.cryptography`→`fdl.crypto`, `security.securedobject`→`security.secureobject`, `security.config.internal`/`security.intercept`→`security.bean`), 제거된 클래스 38종(`@Mapper`→`@EgovMapper`, `AbstractServiceImpl`→`EgovAbstractServiceImpl`, `@CommandMap`·`SimpleUrlAnnotationHandlerMapping`·`RteFieldChecks` 제거 등 — 대체와 사유 동반), 제거된 RTE 모듈 `spring-modules-validation`, `javax→jakarta` 패키지 28종(JDK 내장 `javax.sql`·`javax.xml.*`·`javax.crypto` 등은 제외)과 의존성 좌표 26종, web.xml 스키마, 5.x 에서 사라진 `egov-security/egov-access/egov-crypto` XML 네임스페이스, 교체 필요 라이브러리(DBCP 1.x·Log4j 1.x·commons-fileupload·Tiles·JUnit 4·구버전 Hibernate Validator 등). 항목마다 `auto`(2단계에서 기계 치환)·`manual`(코드 수정 필요)을 표시하고 markdown/json 으로 반환하며, 파일은 쓰지 않습니다. 규칙은 코드가 아닌 `catalog/migration-rules.json`(schemaVersion 1)에 두고, 생성기 `scripts/generate-migration-rules.mjs` 가 `egovframe-runtime` 의 v3.10.0·v4.3.0-Final·v5.0.2-Final 태그 소스 트리를 비교해 좌표·패키지 이동·제거를 도출하되 제거 클래스에 큐레이션(`catalog/migration-mapping.json`) 사유가 없으면 실패합니다. 리소스 `egovframe://catalog/migration-rules` 추가. 오프라인 `test:migrate` 87단언(3.10 픽스처·5.x 픽스처 0건·읽기 전용)·`test:migration-rules` 579단언, CI 통합 job 의 `test:migration-rules-live` 가 목적지 좌표 61건의 실제 저장소 존재를 확인합니다. 공식 5.x 템플릿 2종에서 거짓 양성 0건, 공식 공통컴포넌트 v3.10.0 자산에서 57건 검출을 확인했습니다(설계: [docs/design-migration.md](docs/design-migration.md)). 기존 23개 도구 하위 호환.
- **0.28.1** — Windows 체크아웃 대응(npm 설치본 동작 변경 없음): `core.autocrlf` 가 켜진 Git 클론에서 동봉 설정 템플릿(`catalog/config-templates/*.hbs`)이 CRLF 로 체크아웃되어 렌더링 전 지문 대조가 실패하고 `generate_egovframe_config`·`test:config`·`test:template-catalog` 가 깨지던 문제를 고쳤습니다(PR #28). 지문을 줄바꿈 LF 정규화 기준으로 계산하도록 바꾸고(`templateSha256`, 생성기·렌더러·sync·테스트 공통), 카탈로그 지문을 그 기준으로 재생성했으며(템플릿 내용 불변), `.gitattributes` 로 해당 경로의 줄바꿈 변환을 막았습니다. `test:config` 에 CRLF 체크아웃 시뮬레이션 단언을 추가했습니다(506단언). npm 으로 설치한 0.28.0 은 tarball 이 LF 를 유지하므로 영향이 없었습니다.
- **0.28.0** — 설정 파일 생성: `generate_egovframe_config` 추가(도구 22 → 23). 공식 eGovFrame VSCode Initializr 의 설정 마법사 템플릿 21종(`templates/config`, Handlebars, Apache-2.0)을 `catalog/config-templates/` 에 commit·파일별 sha256 고정으로 동봉해 **네트워크 없이** Spring 설정 파일을 만듭니다 — datasource(DBCP/C3P0/JDBC·JNDI), transaction(datasource/JPA/JTA), cache(Ehcache 정의·Spring 캐시), logging(log4j2 console/file/rolling/time-rolling/jdbc), scheduling(Quartz bean job/method job/simple·cron trigger/scheduler), idGeneration(sequence/table/uuid), property. 형식은 xml(전 템플릿)·javaConfig(`@Configuration`)·yaml·properties(logging), 필드명과 기본값은 Initializr 웹뷰 폼과 같아 필드를 생략하면 IDE 와 같은 결과가 나옵니다. 템플릿에 없는 필드·선택지 밖 값·잘못된 파일명/클래스명/패키지는 거부하고, 출력 경로는 프로젝트 안이어야 하며(`..`·절대경로·symlink 이탈 거부) 기존 파일은 덮어쓰지 않습니다. 결과 컨텍스트의 비밀번호 필드는 가립니다. 렌더링 전에 동봉 파일 지문을 대조하고(줄바꿈을 LF 로 정규화해 Windows autocrlf 체크아웃에서도 동일 판정, `.gitattributes` 추가), `sync_egovframe_templates` 가 upstream 의 같은 파일과 대조해 `configTemplates.drift` 를 보고합니다. 리소스 `egovframe://catalog/config-templates` 로 템플릿별 형식·필드·기본값·선택지를 조회합니다. upstream 에서 발견한 문제 3건(존재하지 않는 `timeBasedRollingFile-java.hbs`, XML 내용인 `jdbc-properties.hbs`, 폼의 `txtPasswrd` 오타)은 큐레이션으로 제외·정정하고 설계 문서에 기록했습니다. 런타임 의존성에 `handlebars` 추가(`npm audit` 0건). 오프라인 457단언(`npm run test:config`), 49건 출력의 XML·YAML 파싱과 JavaConfig 2종 `mvn compile` 확인. 기존 22개 도구 하위 호환. 로드맵 후보 번호는 한 칸씩 뒤로 옮겼습니다.
- **0.27.0** — 공식 템플릿 커버리지 확대(10 → **22종**, Initializr 22종 기준 대응 9 → 21종): v0.26.0 의 통합 카탈로그가 계산해 준 미커버 13종 가운데, 단독 GitHub 저장소 없이 Initializr 저장소의 zip(Git LFS, `templates/projects/examples/`)으로만 배포되는 12종을 추가했습니다 — `web`·`boot-web`(빈 골격), `batch-file-scheduler`·`batch-file-commandline`·`batch-file-web`·`batch-db-scheduler`·`batch-db-commandline`·`batch-db-web`, `mobile-web`·`mobile-common-components`, `msa-portal-backend`·`msa-portal-frontend`(멀티 프로젝트). 브랜치는 움직이므로 Initializr **commit** 으로 다운로드 URL 을 고정하고 LFS 포인터의 **sha256·크기**로 내려받은 바이트를 검증하며, 다르면 아무것도 쓰지 않고 거부합니다(`ref` 를 직접 주면 검증을 건너뛰고 결과에 `archiveVerified: false` 와 경고를 남깁니다). zip 은 codeload 아카이브와 달리 최상위 폴더가 없어 루트를 잘라내지 않고, `pom.xml` 의 `###GROUP_ID###`·`###ARTIFACT_ID###`·`###NAME###`·`###VERSION###`·`###URL###` 자리표시자를 채운 뒤 기존 좌표 적용을 거칩니다. `Globals.DbType` 은 템플릿마다 다른 `globals.properties` 경로(배치는 `egovframework/batch/properties/`)를 찾아 적용합니다. `sync_egovframe_templates` 는 zip 본문 대신 LFS 포인터만 읽어 고정 지문과 대조한 `archivesChecked`·`archiveDrift` 를 보고하고, 통합 카탈로그의 `mcp.archive` 에 지문을 함께 싣습니다. 23MB 올인원인 `egov-template-common-components` 는 "공통컴포넌트는 `add_egovframe_components` 로 선택 조립한다"는 기존 큐레이션 결정에 따라 제외했습니다. 12종 전부 실생성해 자리표시자 0건을 확인했고 `batch-db-commandline`·`boot-web`·`mobile-web` 은 `mvn compile` 을 통과했습니다. zip 본문을 받기 위해 `media.githubusercontent.com` 접근이 추가로 필요합니다. 기존 10종·전체 도구 하위 호환. 로드맵의 후보 번호는 한 칸씩 뒤로 옮겼습니다(namespace 전환 v0.27 → v0.28 등).
- **0.26.0** — 공식 템플릿 카탈로그 단일화: `sync_egovframe_templates` 추가(도구 21 → 22). 그동안 같은 사실이 세 곳에 따로 적혀 있었습니다 — Initializr 는 `templates/templates-projects.json` 에 프로젝트 22종을 zip·pom 스냅샷으로, MCP 는 `TEMPLATES`(현 `src/project.ts`)에 10종을 공식 저장소 조달 방식으로, Development 는 `eGovFrameTemplates/wizards.xml` 에 설정 스니펫 마법사 8카테고리를 담고 있었고, v0.24.0 의 커버리지 확대도 이 둘을 **사람이 눈으로 대조**해 진행했습니다. 이번에 `schemaVersion: 1` 의 `catalog/templates.json` 하나로 합쳐 프로젝트마다 Initializr 쪽 zip·pom 과 MCP 쪽 저장소·브랜치·멀티프로젝트 여부를 나란히 두고, 커버리지(22종 중 대응 9종·미커버 13종·MCP 단독 2종)를 계산된 값으로 기록합니다. 매핑은 `catalog/template-mapping.json` 에서 큐레이션하며 자동 추론하지 않습니다 — 예컨대 Initializr 의 `egov-web`(빈 웹 골격)과 MCP 의 `web-sample`(게시판 샘플)은 이름이 비슷해도 다른 산출물이라 대응시키지 않고 근거를 note 로 남겼습니다. 생성기 `scripts/generate-template-catalog.mjs` 는 매핑에 없는 upstream 항목을 만나면 실패해 조용한 누락을 막고, `sync_egovframe_templates` 는 upstream 을 내려받아 추가·삭제·변경(필드 단위)과 sha256 을 대조해 보고하되 파일을 고쳐 쓰지 않습니다. `list_egovframe_templates` 응답에도 커버리지 요약이 붙습니다(카탈로그가 없으면 기존 동작 유지). 오프라인 148단언(`npm run test:template-catalog`), 기존 21개 도구 하위 호환. 생성기는 Windows 에서도 동작하도록 `dist/index.js` 로드와 직접 실행 판정을 file URL·realpath 기준으로 처리합니다.
- **0.25.3** — 기동 버그 수정 + CI 확장(도구 인터페이스 하위 호환).
  - **npx 기동 실패 수정(Linux·macOS)**: 진입점 판정이 `process.argv[1]`의 파일명 끝을 `import.meta.url`과 비교하는 방식이어서, npm이 POSIX에서 bin을 symlink(`node_modules/.bin/egovframe-scaffold-mcp → dist/index.js`)로 설치하면 진입점이 아니라고 판단해 서버를 띄우지 않고 오류 없이 종료했습니다. README가 안내하는 `npx -y egovframe-scaffold-mcp` 설정이 Linux·macOS에서 동작하지 않던 원인입니다(Windows는 `.cmd` shim이 `dist/index.js`를 직접 실행해 영향 없음, `node dist/index.js` 직접 실행도 영향 없음). 양쪽 경로를 realpath로 풀어 비교하도록 바꾸고, symlink 경유 기동을 회귀 테스트로 고정했습니다(`npm run test:handshake`).
  - **CI**: 릴리스 게이트를 ubuntu·windows × Node 18·20·22 매트릭스로 실행하고, 공식 저장소를 내려받는 통합 테스트는 별도 job(ubuntu/Node 20)으로 분리했습니다. bash 파이프라인이던 핸드셰이크 확인을 플랫폼 중립 테스트(`test:handshake`)로 대체해 `prepublishOnly`에 포함했고, 런타임 의존성 `npm audit`(high 이상) 단계를 추가했습니다.
  - **테스트**: 타임아웃 시 프로세스 트리 종료 회귀 테스트를 node 손자 프로세스 기반으로 바꿔 Windows(`taskkill /T /F` 경로)에서도 실행합니다.
  - **문서**: 게시 시점에 따라 틀어지던 "배포 상태" 문구를 npm 배지 단일 출처 방식으로 정리했습니다.
- **0.25.2** — 보안·안정성 보강(도구 인터페이스 하위 호환).
  - `generate_egovframe_ci`: `jdk` 값이 생성 워크플로 YAML에 검증 없이 삽입되어 따옴표·줄바꿈으로 임의 step을 끼워 넣을 수 있던 문제를 수정했습니다. 숫자·점 형식(`17`, `21`, `1.8`, `17.0.9`)만 허용하며 도구 스키마와 함수 양쪽에서 거부합니다. 위반 시 파일을 만들지 않습니다.
  - `build_egovframe_project`·`test_egovframe_project`: 타임아웃 시 직접 자식 프로세스만 종료해, `mvnw`/`gradlew`가 띄운 JVM이 출력 파이프를 붙잡은 채 살아남으면 타임아웃이 지나도 호출이 끝나지 않던 문제를 수정했습니다(재현: `timeoutMs` 1초 설정에 30초 후 반환). POSIX는 프로세스 그룹 단위 SIGKILL, Windows는 `taskkill /T /F`로 트리를 종료하고, 그래도 파이프가 닫히지 않으면 2초 유예 후 결과를 반환합니다. 실제 프로세스를 띄우는 회귀 테스트를 추가했습니다(`npm run test:build`).
  - MCP handshake의 서버 버전이 `0.23.0`으로 고정되어 있던 것을 `package.json` 버전을 읽도록 변경했습니다.
  - 의존성: `adm-zip` 0.6.1(0.6.0 이하 대상 symlink 추종·선언 크기 메모리 할당 권고 해소)과 MCP SDK 전이 의존성(hono·fast-uri·ip-address·qs)을 갱신해 `npm audit` 0건입니다.
  - 문서: `create_egovframe_project` 템플릿 목록을 실제 10종으로 정정했습니다.
- **0.25.1** — 문서 정정(코드 변경 없음): v0.25.0 시점까지 README 에 남아 있던 "npm 은 v0.23.0 까지 배포" 문구를 실제 배포 상태로 갱신했습니다. npm 패키지 페이지는 게시된 tarball 의 README 를 보여주므로, 문구 정정을 반영하려면 새 버전 게시가 필요해 패치 버전을 올렸습니다.
- **0.25.0** — 테스트 실행·리포트 구조화: `test_egovframe_project` 추가. `build_egovframe_project(goal=test)`가 종료 코드와 로그만 돌려주던 한계를 보완해, 빌드도구가 쓰는 JUnit XML 리포트(maven-surefire `target/surefire-reports`, gradle `build/test-results/test`)를 1차 근거로 읽습니다. 스위트별 통과·실패·오류·건너뜀과 실패 케이스의 메시지·예외 타입·스택트레이스 내 테스트 클래스 프레임(파일:라인)을 반환하고, `testFilter`는 빌드도구 문법 그대로(`-Dtest=… -Dsurefire.failIfNoSpecifiedTests=false` / `--tests …`) 전달하되 인자 해석을 깨는 문자를 거부합니다. 이번 실행 이전의 리포트는 mtime으로 제외하고, 종료 코드가 0이어도 리포트에 실패가 있으면(`testFailureIgnore`) 실패로 판정하며, 리포트가 없으면 컴파일 오류(로그 파싱)와 원인 후보를 안내합니다. 타임아웃·로그 상한·허용 root·dryRun은 build 도구와 동일. 오프라인 54단언(`npm run test:test`), 외부 의존성 없음. 기존 20개 도구 하위 호환.
- **0.24.0** — 공식 템플릿 커버리지 확대(7 → **10종**): eGovFrame VSCode Initializr 카탈로그(22항목)와 대조해 MCP가 다루지 않던 공식 자산을 식별하고, GitHub 공개 저장소로 제공되는 `msa-common-components`(MSA 공통컴포넌트, KRDS)·`mobile-device-api`(디바이스 API)·`ai-rag`(Spring AI·LangChain4j RAG 예제)를 추가했습니다. 세 템플릿 모두 하위 모듈을 가진 멀티 프로젝트이므로 `multiProject`로 표시해 좌표·DB 자동 재작성을 건너뛰고 하위 모듈 참조를 보호하며, 생성 결과에 좌표/DB 자동 적용이 없음을 명시합니다. `npm run test:templates`에 등록·표시·공식 저장소 경로 검증과 실제 아카이브를 내려받는 dryRun 통합 검증을 추가했습니다. 기존 7종·전체 도구 하위 호환.
- **0.21.1 (완료, v0.22.0에 통합)** — 사용자 프로젝트를 손상시키지 않는 실패·복구 경계를 우선 강화했습니다.
  - [PR #9](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/9): 설치 SHA-256과 현재 파일을 비교해 `unchanged/modified/unverified/missing`으로 분류하고 사용자 수정·기준선 미확인 파일을 기본 보존합니다. `force=true`는 기존 파일과 제거 계획을 `remove-backup/`에 보존한 뒤 제거하며, 중간 실패는 파일·POM·매니페스트를 작업 전 상태로 롤백합니다.
  - [PR #10](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/10): 재사용 가능한 `ProjectFileTransaction`을 도입하고 AI 파일·POM 백업/갱신·매니페스트를 한 transaction으로 commit합니다.
  - [PR #11](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/11): 프로젝트를 sibling staging에서 압축 해제·커스터마이징한 뒤 atomic rename하며, 실패·목적지 경합 시 부분 프로젝트를 노출하지 않습니다.
  - [PR #12](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/12): 프로젝트 생성→공통컴포넌트→선택적 AI 조립을 하나의 디렉터리 transaction으로 실행하고 모든 단계가 성공한 뒤에만 최종 경로를 공개합니다. 공식 템플릿·컴포넌트 rollback 통합 테스트와 CI gate를 포함합니다.
  - [PR #13](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/13): 직접 공통컴포넌트 조립의 파일·SQL·매니페스트를 공통 file transaction으로 commit하고, 중간 실패와 상위 symlink 경계 이탈에서 작업 전 상태로 복구합니다.
  - [PR #14](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/14): 컴포넌트 업그레이드의 대상 hash를 적용 직전에 재검증하고, 파일·고유 백업·`upgrade-plan.json`·매니페스트를 공통 transaction으로 반영합니다. 중간 실패와 상위 symlink 경계 이탈에서는 작업 전 상태로 복구합니다.
  - [PR #15](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/15): 공식 템플릿에 이미 포함된 `cmm`을 `providedComponents`로 확인·보존하고, recipe가 추가하는 bbs/login만 설치합니다. 기존 38파일을 덮거나 도구 소유로 기록하지 않으며 성공 조립·검증과 후반 rollback을 모두 통합 테스트합니다.
  - [PR #16](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/16): `EGOVFRAME_ALLOWED_ROOTS`를 전 도구 진입점에 적용하고 realpath 기준으로 symlink/junction 우회를 차단합니다. transaction 실패는 `RollbackReport`(`filesAttempted`·`restoredFiles`·`removedNewFiles`·`cleanedDirs`·`failures`·`ok`)를 제공합니다.
  - 상세 분석·검증·실패/복구 이력은 [`egovframe-contribution-notes/작업이력.md`](https://github.com/EricSeokgon/egovframe-contribution-notes/blob/main/%EC%9E%91%EC%97%85%EC%9D%B4%EB%A0%A5.md)를 단일 원장으로 사용합니다.
- **0.22.0** — 안전성 기반 완성: 모든 쓰기 도구를 롤백 가능한 transaction으로 통일하고(프로젝트 생성·레시피·직접 조립·AI 조립·업그레이드), 회귀 시 테스트가 실패하도록 판정을 강제했으며, 컴포넌트 제거 시 사용자 파일을 보호합니다. 신규 `EGOVFRAME_ALLOWED_ROOTS`로 **전 도구 공통 허용 root**를 강제(realpath 기반, symlink 우회 차단, 미설정 시 무제한 하위 호환)하고, transaction 실패 시 사람용 문구와 함께 기계가 읽는 `rollback-report: {json}`(복원·제거·정리 건수, 실패 목록)을 제공합니다. 레시피의 템플릿 컴포넌트 보존 픽스 포함. (#8–#16)
- **0.21.0** — 검증된 공통컴포넌트 완전 조립: `sync_egovframe_catalog`를 추가하고 common-components 공식 v5.0.6 태그·commit(`23d01889…`)·archive SHA-256/크기/파일 수를 고정했습니다. 카탈로그 schema v2를 190항목(리프 176+그룹 14)으로 재생성해 message bundle 278건, IDGN context 91건, scheduling context 18건, 웹 자산 662건, Spring/web fragment 26건과 Maven 좌표를 연결했습니다. `add_egovframe_components`가 이 자산을 함께 복사하며 동일 파일 재사용, 다른 내용 충돌 전체 거부, 쓰기 실패 롤백, DB 비사용 컴포넌트의 SQL 폴백 방지를 적용합니다. `sec.security` 신규 보안 패키지와 미매핑 upstream 경로를 CI에서 검증하고 매니페스트 schema v3에 source 고정 정보를 기록합니다. 기존 카탈로그 schema v1·매니페스트 v1/v2 하위 호환.

- **0.20.0** — CRUD 코드 생성: `generate_egovframe_crud` 추가. eGovFrame Development의 공식 `wizard.xml` 입력 그룹(author/createDate, DataAccess·Service·Web, mapper/VO/service/controller/JSP 경로)에 맞춰 VO·DefaultVO·EgovMapper 인터페이스·MyBatis XML·Service·ServiceImpl·Controller를 생성합니다. Classic은 MVC+JSP 2종, Boot는 REST Controller를 생성하고 `withTest`로 JUnit 5 계약 테스트를 추가합니다. PK 필수, SQL/Java 식별자·상대경로 검증, dryRun, 전체 충돌 사전 검사, 쓰기 실패 롤백을 적용했습니다. 오프라인 테스트(`npm run test:crud`)와 공식 simple-backend/Boot·web-sample/Classic Maven compile 통합 테스트를 추가했습니다. 프로젝트 직접 Maven 좌표만 변경해 parent·dependency를 보존하고, lockfile·npm 패키지 설계 문서·CI 전체 릴리스 게이트를 추가했으며 `adm-zip` 0.6.0으로 고위험 ZIP 취약점을 해소했습니다. 기존 17개 도구 하위 호환.

- **0.19.0** — CI 생성 + 문서 검색 deep: `generate_egovframe_ci` 추가(프로젝트에 GitHub Actions 빌드·테스트 워크플로 생성, maven/gradle 자동 감지·dryRun·기존 파일 거부). `search_egovframe_docs`에 `fetchTop` 옵션 추가 — 상위 결과 문서 본문을 내려받아 스니펫 제공(기본 0=오프라인). 테스트(`npm run test:ci`) 추가. 기존 도구 하위 호환.

- **0.18.0** — 컴포넌트 설명 + 리소스/프롬프트 확장: `explain_egovframe_component` 추가 — 컴포넌트 하나의 설명·직접/전이 의존성·이 컴포넌트에 의존하는 컴포넌트·참조 테이블·가이드 링크·설치 명령을 한 번에 반환(읽기 전용). 리소스 `egovframe://catalog/ai-components` 추가, 프롬프트 `scaffold_portal`·`maintain_existing`(진단→리포트→업그레이드) 추가. 테스트(`npm run test:explain`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.17.0** — 컴포넌트 업그레이드: `upgrade_egovframe_project` 추가 — 매니페스트 설치 컴포넌트를 upstream 최신본과 3-way 비교(설치 기준선 해시·현재 디스크·upstream)해 갱신합니다. 사용자가 수정한 파일은 `force` 없이 보존, `dryRun` 기본(계획 미리보기), 덮어쓰기 전 `upgrade-backup/`에 백업, 하드 충돌 시 아무것도 쓰지 않고 거부. 매니페스트 스키마 v2(파일별 해시 기준선) — `add_egovframe_components`가 이후 설치본에 해시 기록. 오프라인 판정 테스트(`npm run test:upgrade`) 추가. 기존 도구·기존 매니페스트(v1) 하위 호환(해시 없으면 보수 모드).

- **0.16.0** — 프로젝트 리포트: `generate_egovframe_report` 추가 — 프로젝트를 스캔해 설치 공통컴포넌트·참조 테이블·가이드 문서 링크·이슈를 Markdown 리포트로 생성합니다(읽기 전용, `diagnose`+카탈로그+가이드 매핑 재사용). 조립 결과 문서화/README 첨부용. 테스트(`npm run test:report`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.15.0** — 가이드 문서 검색: `search_egovframe_docs` 추가 — 카탈로그 가이드 매핑(제목·경로·연계 컴포넌트·카테고리)을 키워드로 점수순 검색하고 문서 URL과 조립용 컴포넌트 id를 반환합니다. 오프라인 동작(네트워크 불필요). 테스트(`npm run test:docs`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.14.0** — 프로젝트 진단 도구: `diagnose_egovframe_project` 추가 — 기존(스캐폴딩 도구로 만들지 않은 것 포함) 프로젝트를 읽기 전용으로 스캔해 빌드시스템(maven/gradle)·eGovFrame RTE 버전·`Globals.DbType`·설치된 공통컴포넌트(카탈로그 `pathPrefixes` 지문 매칭)·AI 계층·매니페스트 유무를 파악하고, 의존성 누락·DbType 미설정 등 이슈와 다음 단계 제안을 리포트합니다. 픽스처 테스트(`npm run test:diagnose`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.13.0** — MCP 리소스·프롬프트 + 레시피: `tools` 외에 `resources`(카탈로그·템플릿·가이드 읽기 전용 노출, 단일 컴포넌트는 resource template)와 `prompts`(`scaffold_board_login`·`scaffold_ai_chatbot`)를 지원해 MCP 3대 프리미티브를 완비. 레시피(`catalog/recipes.json`)와 `list_egovframe_recipes`·`apply_egovframe_recipe` 도구 추가 — 생성→컴포넌트→AI 계층 조립을 한 번에 오케스트레이션(각 단계 `dryRun` 전파·원자적 거부 계승). 정합성 테스트(`npm run test:recipes`) 추가. 기존 도구·카탈로그 불변(완전 하위 호환).

- **0.12.0** — 카탈로그 커버리지 확대(68 → **188항목**): 컴포넌트 단위를 2단계 패키지에서 **리프 패키지(서비스 단위, 최대 4단계)** 로 세분화해 리프 174종을 개별 선택 설치할 수 있습니다. 기존 2단계 id는 `children`을 가진 **그룹**으로 유지되어 하위 호환됩니다(그룹 요청 시 리프로 확장 설치, 그룹+리프 동시 요청 중복 제거). 리프 한글명은 Service 인터페이스 Javadoc에서 자동 추출(96종), 가이드 문서 매핑은 리프 우선으로 재계산(151종).

- **0.11.0** — 템플릿 확장: 공식 템플릿 2종 → **7종** (`simple-homepage`·`portal-site`·`enterprise-business`·`web-sample`·`msa-edu` 추가). 레거시 템플릿은 `egovProps/globals.properties`의 `Globals.DbType` 적용을 새로 지원, 멀티 프로젝트(`msa-edu`)는 좌표/DB 재작성을 건너뛰어 하위 모듈 참조를 보호. 템플릿별 빌드 안내(nextSteps) 분기, 통합 테스트(`npm run test:templates`) 추가.

- **0.10.0** — AI 컴포넌트 조립 M3: langchain4j 스택 실조립·제거 사이클 통합 검증(init-scripts/ai/·JPA 의존성·pom 원복), `validate_egovframe_project`에 **AI 실행 전제 진단(aiChecks)** 추가 — `application-ai.yml`의 ONNX 모델/토크나이저·임베딩 설정 경로를 `${user.home}`·환경변수 플레이스홀더까지 해석해 존재 확인, docker compose 기동 안내 (경고와 분리되어 ok 판정에 영향 없음).

- **0.9.0** — AI 컴포넌트 조립 M2(실조립): `add_ai_components`가 실제로 조립합니다 — 소스(`com.example.chat`)·설정(`application-ai.yml` 프로필, 기존 설정 불변)·UI·인프라(`docker-compose.ai.yml`·`Dockerfile.ai`·`k8s/ai/`) 복사(전체 사전 충돌 검사·원자적 거부), pom에 누락 좌표만 마커 주석 구간으로 삽입(exclusions 보존, `pom.xml.bak-ai` 백업), 매니페스트 기록으로 `remove_egovframe_components`가 파일·pom 삽입분을 함께 원복(바이트 단위 복원 검증), `validate_egovframe_project`에 pom 마커 진단 추가, 통합 테스트(`npm run test:ai-assembly`) 추가.

- **0.8.0** — AI 컴포넌트 조립 M1: `add_ai_components` dryRun 미리보기(파일 복사 계획·pom 의존성 diff·부모 POM 호환성 게이트·스택 상호 배타 검사), AI 카탈로그(`catalog/ai-components.json`, egovframe-ai-rag 모듈 스캔 자동 생성 `npm run generate:ai-catalog`), `list_egovframe_components`에 AI 컴포넌트 노출, 오프라인 테스트(`npm run test:ai`) 추가.

- **0.7.0** — `get_egovframe_guide`: 컴포넌트 id로 표준프레임워크 공식 가이드 문서(egovframe-docs)를 조회. 카탈로그에 문서 매핑 자동 생성(`--docs`, 지배적 패키지 참조 기준 45종) 추가. 한글명 큐레이션 12→27종.

- **0.6.0** — 컴포넌트별 테이블 선별 DDL(M4): 카탈로그에 매퍼 기반 참조 테이블 자동 추출(48/68종), `database` 지정 시 통합 스크립트에서 해당 컴포넌트 구문만 추출해 `ddl|dml/<컴포넌트id>.sql` 생성(테이블 미상 컴포넌트는 통합본 폴백), 매니페스트에 컴포넌트별 스크립트 귀속(제거 시 함께 정리).

- **0.5.0** — 조립 수명주기 완성: `search_egovframe_components`(키워드 검색), 설치 매니페스트(`.egovframe-components.json`) 기록, `remove_egovframe_components`(의존 보호·dryRun), `validate_egovframe_project`(파일 무결성·DbType↔DDL 일치 진단), 중복 설치 거부.

- **0.4.0** — 공통컴포넌트 선택 설치 M3: 저장소 구조 스캔으로 카탈로그 자동 생성(`scripts/generate-catalog.mjs`), 커버리지 3종 → 68종(2단계 패키지 단위, cmm 하위 통합). 이름·설명·의존성은 `catalog/overrides.json`으로 큐레이션(기본 의존성 휴리스틱: cmm).

- **0.3.0** — 공통컴포넌트 선택 설치 M2: `add_egovframe_components` 실제 조립 구현(의존성 포함 파일 복사, 전체 사전 충돌 검사 후 원자적 거부, zip-slip 방지, `database` 지정 시 DDL·DML 복사, zip 프로세스 캐시). 통합 테스트(`test:components`) 추가.

- **0.2.2** — 공통컴포넌트 선택 설치 M1: 컴포넌트 카탈로그(`catalog/components.json`, 대표 3종 cmm·bbs·login), `list_egovframe_components`·`add_egovframe_components`(dryRun 미리보기) 도구 추가, 카탈로그 오프라인 테스트 추가.

- **0.2.1** — 프론트엔드(simple-react) 템플릿의 `package.json` `name`을 프로젝트명으로 적용(백엔드는 기존대로 pom·DbType).
- **0.2.0** — 다운로드 타임아웃(30초), `ref`(브랜치/태그) 파라미터, `dryRun` 미리보기 모드 추가. `list_egovframe_templates`가 지원 DB 목록도 함께 반환.
- **0.1.0** — 최초 PoC: `create_egovframe_project`, `list_egovframe_templates`.

## 라이선스

Apache License 2.0
