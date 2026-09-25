# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

전자정부 표준프레임워크(eGovFrame) 프로젝트 스캐폴딩·조립·진단을 제공하는 **MCP(Model Context Protocol) 서버** — 커뮤니티 PoC

> [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 개념 증명(Proof of Concept) 구현입니다.
> [#628](https://github.com/eGovFramework/egovframe-common-components/issues/628)(eGovFrame MCP Server 제안)을 "프로젝트 생성 → 컴포넌트 조립 → 진단·업그레이드" 수명주기로 구체화했습니다.

Claude, VS Code(Copilot), Cursor 등 MCP를 지원하는 AI 도구에서 **대화 중 즉시** 표준프레임워크
프로젝트를 만들고 공통컴포넌트·AI 계층을 조립할 수 있습니다. 기존 프로젝트 진단, 리포트, 안전한 upstream 재동기화도 지원합니다.

현재 v0.28.0은 **도구 23종, 공식 템플릿 22종, 설정 템플릿 21종, 공통컴포넌트 카탈로그 190항목(리프 176종+그룹 14종)**을 제공합니다.

## 진행 현황 (2026-09-13)

- **소스 기준**: v0.28.0(`package.json`), 도구 23종·공식 템플릿 22종·설정 템플릿 21종·카탈로그 190항목.
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
| `generate_egovframe_report` | 프로젝트를 스캔해 설치 컴포넌트·참조 테이블·가이드 링크·이슈를 Markdown 리포트로 생성 (읽기 전용) |
| `upgrade_egovframe_project` | 설치 컴포넌트를 upstream과 3-way 비교해 갱신 — 사용자 수정 보존, dryRun 기본, 적용 직전 재검증, 파일·백업·매니페스트 단일 transaction (파괴적, 게이트) |
| `explain_egovframe_component` | 컴포넌트 하나의 상세(설명·직접/전이 의존성·역의존·참조 테이블·가이드 링크·설치 명령)를 한 번에 반환 (읽기 전용) |
| `generate_egovframe_ci` | GitHub Actions CI 워크플로(빌드·테스트) 생성 — maven/gradle 자동 감지, dryRun, 기존 파일 보호 |
| `build_egovframe_project` | 생성한 프로젝트를 실제로 빌드(compile·test·package) — maven/gradle·mvnw/gradlew 자동 감지, 타임아웃·로그 상한, 컴파일 오류 파일/라인 구조화, dryRun |
| `test_egovframe_project` | 테스트 실행 + JUnit XML 리포트(surefire·gradle) 구조화 — 스위트별 통과/실패/오류/건너뜀, 실패 케이스 메시지·예외 타입·테스트 파일/라인, `testFilter`, 이전 실행 리포트 제외, dryRun |
| `generate_egovframe_crud` | 공식 Development CRUD wizard 입력 체계 기반 코드 생성 — VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5(선택), Classic/Boot 분기, 전체 충돌 사전 검사 |
| `sync_egovframe_templates` | 공식 프로젝트 템플릿 통합 카탈로그(Initializr·MCP·Development) upstream 대조 — 추가/삭제/변경 항목과 MCP 커버리지 격차, zip 조달 템플릿의 고정 지문(sha256·크기)과 동봉 설정 템플릿의 변화 보고, 네트워크 필요 |
| `generate_egovframe_config` | 공식 Initializr 설정 템플릿 21종으로 Spring 설정 파일 생성(오프라인 동봉) — datasource(DBCP/C3P0/JDBC·JNDI)·transaction(datasource/JPA/JTA)·cache·logging(log4j2 5종)·scheduling(Quartz 5종)·idGeneration(3종)·property, xml/javaConfig/yaml/properties, Initializr 폼과 같은 필드·기본값, 기존 파일 거부, dryRun |

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

- `egovframe://catalog/components` · `egovframe://catalog/components/{id}` · `egovframe://catalog/templates` · `egovframe://catalog/recipes` · `egovframe://catalog/ai-components`

**Prompts** — 가이드형 워크플로: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`

**레시피** — 자주 쓰는 조합을 한 번에 조립합니다. 예: `apply_egovframe_recipe(recipeId="board-login", projectName="my-egov-app", outputDir="~/work")`. 목록은 `catalog/recipes.json`에서 관리하며 기여 환영합니다.

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
- 설정 생성 레벨: 동봉 템플릿 지문·카탈로그 무결성, 49건 전 형식 기본값 렌더링, 분기·필드 덮어쓰기, 필드·선택지·파일명·패키지 거부, dryRun 무기록, 충돌 거부, 비밀번호 가림, `..`·절대경로·symlink 이탈 거부 (`npm run test:config`, 457단언, 네트워크 불필요)
- 템플릿 카탈로그 레벨: `catalog/templates.json` 스키마·커버리지 계산·큐레이션 매핑 정합·변환기·upstream 차이 계산(추가/삭제/필드 변경) 검증 (`npm run test:template-catalog`, 256단언, zip 지문·동봉 설정 템플릿 drift·LFS 포인터 해석 포함, 네트워크 불필요)
- 동기화 레벨: 공식 v5.0.6 태그→commit, SHA-256·크기·파일 수, `sec.security`, 미매핑 경로 0건 검증 (`npm run test:catalog-sync-live`, 네트워크 필요)
- 조립 레벨: 실제 공통컴포넌트 저장소로 bbs+login+sec.security(+cmm) 843파일 조립, message·IDGN·웹 자산·공용 fragment·Maven 좌표·선별 DB 스크립트·충돌 전체 거부·파일/SQL/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:components`)
- 수명주기 레벨: 설치 매니페스트 기록, 중복 설치 거부, 의존 컴포넌트 제거 보호, 제거·검증 동작 (`npm run test:components`)
- 프로토콜 레벨: 빌드된 서버를 실제 프로세스로 띄워 MCP initialize / tools/list 핸드셰이크, `serverInfo.version`↔`package.json` 일치, 핵심 도구 노출, `jdk` 패턴 제약 노출 확인 (`npm run test:handshake`, 네트워크 불필요)
- 플랫폼 레벨: CI가 릴리스 게이트를 ubuntu·windows × Node 18·20·22 매트릭스로 실행하고, 공식 저장소를 내려받는 통합 테스트는 ubuntu/Node 20에서 실행합니다. 타임아웃 시 프로세스 트리 종료는 POSIX·Windows 모두 실제 프로세스로 검증합니다 (`npm run test:build`).
- 레시피 레벨: `catalog/recipes.json`의 컴포넌트 id·의존성·템플릿 제공 컴포넌트 정합 검증 (`npm run test:recipes`, 네트워크 불필요). 공식 `simple-backend`의 기존 `cmm`을 보존하고 board-login의 bbs 88파일·login 41파일·SQL 4건(총 133파일)을 조립한 뒤 검증하며, 컴포넌트 이후 fault injection의 전체 staging rollback도 확인 (`npm run test:recipe-transaction`)
- 진단 레벨: 픽스처(pom·DbType·컴포넌트 패키지)로 `diagnose_egovframe_project`의 빌드·버전·DbType·컴포넌트 지문·의존성 검출 검증 (`npm run test:diagnose`, 네트워크 불필요)
- 문서 검색 레벨: `search_egovframe_docs`의 키워드 매칭·점수 정렬·컴포넌트 매핑·빈질의/미존재어 처리 검증 (`npm run test:docs`, 네트워크 불필요)
- 리포트 레벨: 픽스처로 `generate_egovframe_report`의 컴포넌트·테이블·가이드 링크 렌더링 검증 (`npm run test:report`, 네트워크 불필요)
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
- 템플릿·컴포넌트·가이드 원본을 받을 때 GitHub(`codeload.github.com`, `raw.githubusercontent.com`, zip 조달 템플릿은 `media.githubusercontent.com`) 네트워크 접근이 필요합니다.

## 로드맵

v0.28.0까지 프로젝트·CRUD 생성, 검증된 공통컴포넌트 실행 자산 조립, 안전성 기반(테스트 판정 강제·사용자 파일 보호·전 도구 트랜잭션·허용 root·구조화 rollback 보고), 생성→검증 루프(실제 빌드·오류 구조화·테스트 리포트 구조화), 그리고 공식 템플릿 카탈로그 단일화와 커버리지 확대(22종 중 21종), 설정 파일 생성을 완료했습니다.

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
| **v0.29 후보** | `migrate_egovframe_namespace` | 3.x→4.x import·XML bean·빌드 좌표 전환. dryRun·백업·원자적 거부와 자동 변환 불가 API 보고 |
| **v0.30 후보** | `check_egovframe_dependencies` + `security_patch_advisor` | 폐쇄망 최소 버전 규칙과 선택적 CVE 조회, CSRF·보안 설정·공식 패치 기준 점검 |
| **v0.31+ 후보** | 접근성·배포·AI 컨텍스트 | 영문 응답/README, Homebrew·MCP Registry, `generate_agents_md`, 네트워크 진단(프록시·IPv6 안내) |

로드맵 근거:

- `egovframe-development`에는 공식 CRUD 마법사 입력과 두 템플릿 트리가 있으며, MCP가 같은 입력 체계를 사용하면 IDE와 대화형 도구의 경험을 맞출 수 있습니다.
- `egovframe-vscode-initializr`에는 기계 판독 가능한 프로젝트·context XML 카탈로그가 이미 있어 새 목록을 만들기보다 공통 스키마로 승격하는 편이 유지보수에 유리합니다.
- `egovframe-common-components` v5.0.6 분석 결과, 실제 실행에는 소스·Mapper·JSP 외 리소스·설정·기능별 의존성·보안 패치 추적이 필요합니다.

상세 기획과 조사 근거는 [egovframe-contribution-notes의 v0.20+ 로드맵](https://github.com/EricSeokgon/egovframe-contribution-notes/blob/main/scaffold-mcp_v020%ED%94%8C%EB%9F%AC%EC%8A%A4_%EB%A1%9C%EB%93%9C%EB%A7%B5.md)에서 관리합니다.

개발 기반 개선도 병행합니다: GitHub Actions와 `prepublishOnly` 전체 테스트 일치, lockfile 기반 재현 설치, Windows·한글 경로·대용량 zip 검증 강화. 단일 파일이던 `src/index.ts`(약 3,200줄)는 도메인별 모듈 14개로 분리했으며(공개 export·MCP 프로토콜 표면 불변), `index.ts`는 진입점과 공개 API 재수출만 담당합니다.

## 변경 이력

- **0.28.0** — 설정 파일 생성: `generate_egovframe_config` 추가(도구 22 → 23). 공식 eGovFrame VSCode Initializr 의 설정 마법사 템플릿 21종(`templates/config`, Handlebars, Apache-2.0)을 `catalog/config-templates/` 에 commit·파일별 sha256 고정으로 동봉해 **네트워크 없이** Spring 설정 파일을 만듭니다 — datasource(DBCP/C3P0/JDBC·JNDI), transaction(datasource/JPA/JTA), cache(Ehcache 정의·Spring 캐시), logging(log4j2 console/file/rolling/time-rolling/jdbc), scheduling(Quartz bean job/method job/simple·cron trigger/scheduler), idGeneration(sequence/table/uuid), property. 형식은 xml(전 템플릿)·javaConfig(`@Configuration`)·yaml·properties(logging), 필드명과 기본값은 Initializr 웹뷰 폼과 같아 필드를 생략하면 IDE 와 같은 결과가 나옵니다. 템플릿에 없는 필드·선택지 밖 값·잘못된 파일명/클래스명/패키지는 거부하고, 출력 경로는 프로젝트 안이어야 하며(`..`·절대경로·symlink 이탈 거부) 기존 파일은 덮어쓰지 않습니다. 결과 컨텍스트의 비밀번호 필드는 가립니다. 렌더링 전에 동봉 파일 지문을 대조하고, `sync_egovframe_templates` 가 upstream 의 같은 파일과 대조해 `configTemplates.drift` 를 보고합니다. 리소스 `egovframe://catalog/config-templates` 로 템플릿별 형식·필드·기본값·선택지를 조회합니다. upstream 에서 발견한 문제 3건(존재하지 않는 `timeBasedRollingFile-java.hbs`, XML 내용인 `jdbc-properties.hbs`, 폼의 `txtPasswrd` 오타)은 큐레이션으로 제외·정정하고 설계 문서에 기록했습니다. 런타임 의존성에 `handlebars` 추가(`npm audit` 0건). 오프라인 457단언(`npm run test:config`), 49건 출력의 XML·YAML 파싱과 JavaConfig 2종 `mvn compile` 확인. 기존 22개 도구 하위 호환. 로드맵 후보 번호는 한 칸씩 뒤로 옮겼습니다.
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
