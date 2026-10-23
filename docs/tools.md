# 도구 레퍼런스 (v1.4)

도구 35종의 파라미터·동작·예시입니다. 처음 쓰는 분은 [README 사용 시나리오](../README.md#사용-시나리오)부터 보세요. 응답은 기본 한국어이고 `EGOVFRAME_LANG=en`(CLI `--lang en`)이면 영문입니다(v1.2, [설계](design-i18n.md)); 장시간 도구는 `progressToken` 을 주면 진행 알림을 보내고 `notifications/cancelled` 로 취소됩니다. 공개 API 의 범위와 호환 규칙은 [버전 정책](versioning.md)에 있습니다.

## 도구 목록

| 도구 | 설명 |
|---|---|
| `create_egovframe_project` | 공식 템플릿을 내려받아 projectName(artifactId)·groupId·DB 타입을 적용한 새 프로젝트 생성 |
| `list_egovframe_templates` | 사용 가능한 공식 템플릿 목록 |
| `sync_egovframe_catalog` | 공식 common-components 태그·commit·archive SHA-256/크기/파일 수 검증, `sec.security`와 미매핑 upstream 경로 탐지 |
| `list_egovframe_components` | 선택 설치 가능한 공통컴포넌트 카탈로그 (공식 v5.0.7 고정, **리프 176종 + 그룹 14종** — 리프는 서비스 단위, 그룹 id는 하위 일괄 설치) |
| `add_egovframe_components` | 공통컴포넌트 완전 조립 — 소스·매퍼·JSP와 message·IDGN·scheduling·정적 자산·Spring/web fragment 복사, Maven 좌표 탐지, **컴포넌트별 선별 DDL·DML 생성**(`database`), archive 검증·충돌 전체 거부·쓰기 실패 롤백·`dryRun` |
| `search_egovframe_components` | 키워드로 컴포넌트 검색 (id·이름·설명, 점수순 상위 10건) |
| `remove_egovframe_components` | 설치 매니페스트 기반 트랜잭션 제거 — 의존 컴포넌트·사용자 수정 hash 보호, `dryRun` 분류, `force` 시 `remove-backup/` 백업 후 제거 |
| `validate_egovframe_project` | 조립 프로젝트 무결성 진단 — 파일 존재·DbType↔DB 스크립트 일치 |
| `get_egovframe_guide` | 컴포넌트의 공식 가이드 문서 조회 (egovframe-docs, 151종 매핑) |
| `add_ai_components` | 공식 [egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플 기반 AI RAG 챗봇 조립 — Spring AI(Redis Stack)·LangChain4j(PGVector) 스택 선택(상호 배타), 소스·설정(`application-ai.yml` 프로필)·UI·인프라 복사, **pom 누락 의존성만 마커 구간 삽입**(백업 생성, 제거 시 원복), 충돌 시 전체 거부, `dryRun` 미리보기 (설계: [docs/design-ai-components.md](design-ai-components.md)) |
| `list_egovframe_recipes` | 큐레이션된 레시피(템플릿+컴포넌트 번들) 목록 |
| `apply_egovframe_recipe` | 레시피 하나로 생성→컴포넌트(→AI 계층)까지 조립하고 전체 성공 시에만 최종 경로로 atomic commit. 공식 템플릿이 제공하는 공통기반은 확인·보존하고 추가 컴포넌트만 설치 (`dryRun` 지원) |
| `diagnose_egovframe_project` | 기존/레거시 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치 공통컴포넌트(pathPrefixes 지문)·설정 문제 진단 (읽기 전용) |
| `search_egovframe_docs` | 공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색 — 제목·경로·연계 컴포넌트, 문서 URL·조립용 id 반환 (오프라인) |
| `generate_egovframe_report` | 프로젝트 리포트 — `sections=["components"]`(기본) 설치 컴포넌트·참조 테이블·가이드 링크·이슈, `sections=["assessment"]` 5.x 전환 준비도 평가서(개요·전환 범위·의존성 조치·보안·SBOM·A–D 등급과 산식). Markdown/json, `outputPath` 로 새 파일 저장(선택) |
| `reassemble_egovframe_components` | 3.x/4.x 프로젝트에 복사된 공통컴포넌트 소스를 v5.0.7 로 재조립 — 원본 태그 식별(git blob id 대조), 원본·현재·목표 3-way 판정, 사용자 수정은 패치·작업 목록으로 보존, 5.x 에서 없어진 파일은 백업 후 삭제, 매니페스트 생성, dryRun 기본·transaction·verify(compile) |
| `rehearse_egovframe_migration` | **전환 리허설** — 프로젝트 사본에서 재조립 → 전환 적용 → 컴파일 → pom 맞춤(공식 공통컴포넌트 v5.0.7 기준 parent·좌표·버전·scope) → 컴파일. 두 시점의 오류 수(javac 상한 없이), 누락 패키지·후보 좌표·연쇄 오류, 남는 수동 항목·파일, 사라지는 오류 순 작업 목록, 사본 pom 패치. 원본 불변(지문 비교), 최근 결과는 평가서에 실측으로 |
| `upgrade_egovframe_project` | 설치 컴포넌트를 upstream과 3-way 비교해 갱신 — 사용자 수정 보존, dryRun 기본, 적용 직전 재검증, 파일·백업·매니페스트 단일 transaction (파괴적, 게이트) |
| `explain_egovframe_component` | 컴포넌트 하나의 상세(설명·직접/전이 의존성·역의존·참조 테이블·가이드 링크·설치 명령)를 한 번에 반환 (읽기 전용) |
| `generate_egovframe_ci` | CI 설정 생성 — `platform` 으로 GitHub Actions(기본)·GitLab CI(`.gitlab-ci.yml`)·Jenkins(`Jenkinsfile`, Declarative), maven/gradle 자동 감지, dryRun, 기존 파일 보호. `supplyChain=true` 면 SBOM → 최소 요소 점검 → 전환 준비도 평가서 게이트(`failOn` 기준 초과 시 실패, 보고서·SBOM 보관), `npmRegistry`·`offlineBundle` 환경 변수 |
| `build_egovframe_project` | 생성한 프로젝트를 실제로 빌드(compile·test·package) — maven/gradle·mvnw/gradlew 자동 감지, 타임아웃·로그 상한, 컴파일 오류 파일/라인 구조화, dryRun |
| `test_egovframe_project` | 테스트 실행 + JUnit XML 리포트(surefire·gradle) 구조화 — 스위트별 통과/실패/오류/건너뜀, 실패 케이스 메시지·예외 타입·테스트 파일/라인, `testFilter`, 이전 실행 리포트 제외, dryRun |
| `generate_egovframe_crud` | 공식 Development CRUD wizard 입력 체계 기반 코드 생성 — VO·Mapper(XML)·Service·Controller·JSP(선택)·JUnit 5(선택), Classic/Boot 분기, 전체 충돌 사전 검사 |
| `sync_egovframe_templates` | 공식 프로젝트 템플릿 통합 카탈로그(Initializr·MCP·Development) upstream 대조 — 추가/삭제/변경 항목과 MCP 커버리지 격차, zip 조달 템플릿의 고정 지문(sha256·크기)과 동봉 설정 템플릿의 변화 보고, 동봉 5.x 전환 규칙·의존성 기준 카탈로그의 drift(새 RTE·공통컴포넌트 태그, 새 parent 버전, 고정 pom sha256 변화)와 갱신 절차 보고, 네트워크 필요 |
| `generate_egovframe_config` | 공식 Initializr 설정 템플릿 21종으로 Spring 설정 파일 생성(오프라인 동봉) — datasource(DBCP/C3P0/JDBC·JNDI)·transaction(datasource/JPA/JTA)·cache·logging(log4j2 5종)·scheduling(Quartz 5종)·idGeneration(3종)·property, xml/javaConfig/yaml/properties, Initializr 폼과 같은 필드·기본값, 기존 파일 거부, dryRun |
| `migrate_egovframe_project` | 3.x/4.x 프로젝트의 5.x(Jakarta EE 9+·Spring 6·Java 17) 전환 — **진단**(기본, 읽기 전용): RTE Maven 좌표(`egovframework.rte:egovframework.rte.*`·`org.egovframe.rte:org.egovframe.rte.*` → `org.egovframe.rte:egovframe-rte-*`)·RTE 버전·저장소 URL·5.x parent, 패키지 접두어·이름 변경·제거 클래스(대체 안내), `javax→jakarta` 패키지·의존성 좌표, web.xml 스키마, 제거된 `egov-security/access/crypto` 네임스페이스, 교체 필요 라이브러리를 파일·라인 단위 `auto`/`manual` 항목으로 보고. **적용**(`apply=true`): auto 항목을 transaction 으로 치환, dryRun 기본, 원본 `migration-backup/` 보관·`migration-plan.json`, 실패 시 복구, 적용 후 재진단. **검증**(`verify=true`): compile 실행 후 컴파일 오류를 수동 항목과 연결한 작업 목록(해결될 오류 수 순). 공통컴포넌트 3.x→5.x 대응표(제거·이동 클래스)와 컴포넌트 단위 재조립 권고, `skipComponents` |
| `check_egovframe_dependencies` | 의존성 점검(읽기 전용) — 선언된 의존성(`resolve=true` 면 Maven `dependency:tree`·Gradle `dependencies` 로 해석한 전이 의존성까지, 트리 경로·선언/해석 버전 차이 포함)을 공식 5.x parent 기준(관리 좌표 139종 + Spring/Security/Boot 등 BOM 계열) + Spring Boot BOM 전체(1,473종) + RTE 모듈 전이 의존성(58종)과 대조해 기준 충족/기준 미만/parent 관리/전환 대상(3.x·4.x RTE·javax)/교체 필요(DBCP 1.x·Log4j 1.x·Jackson 1·Ehcache 2 등)/벤더 배포(국내 DBMS·GPKI)/기준 없음 분류(항목마다 기준 출처 표시), 5.x parent·Java 버전 판정, 보안 설정 존재 점검(sec.security·CSRF·XSS 필터·보안 헤더·HTTPS 저장소, 파일·라인 근거). 기본 오프라인, `offline=false` 면 OSV 취약점 조회 |
| `diagnose_egovframe_network` | 도구가 내려받는 호스트 7종(codeload·raw·media.githubusercontent, maven.egovframe.go.kr, repo1.maven.org, registry.npmjs.org, api.osv.dev)에 DNS 조회·HEAD 요청을 보내 도달 여부·소요 시간·실패 종류(DNS·타임아웃·TLS·프록시 인증·거부)를 보고하고, 환경에 맞는 처방(`HTTPS_PROXY`+`NODE_USE_ENV_PROXY=1`, `NODE_OPTIONS=--dns-result-order=ipv4first`, `NODE_EXTRA_CA_CERTS`)을 bash/cmd/PowerShell 명령으로 안내. 프로젝트 디렉터리 불필요, 파일 무기록 |
| `prepare_egovframe_offline_bundle` | **폐쇄망 오프라인 번들** — 인터넷 PC 에서 OSV Maven 덤프·고정 공통컴포넌트 아카이브·Initializr zip 템플릿·공통컴포넌트 태그 미러를 sha256 manifest 와 함께 새 디렉터리에 담음(dryRun 기본). 폐쇄망에서는 `EGOVFRAME_OFFLINE_BUNDLE` 로 다운로드·OSV·재조립 원본을 번들로 대체 |
| `generate_egovframe_sbom` | **SBOM 생성** — Maven/Gradle 프로젝트의 CycloneDX 1.6 JSON(기본) 또는 SPDX 2.3 JSON(`bomFormat="spdx-json"`)을 빌드 파일 변경 없이 생성(Maven: cyclonedx-maven-plugin makeAggregateBom, 해시·라이선스 포함 / Gradle: 해석된 의존성 트리로 구성). `enrich` 로 component 마다 기준 판정(`egovframe:status·basis·baseline`) 속성, `offline=false` 로 OSV 취약점을 `vulnerabilities[]` 에 포함. 출력은 프로젝트 안 경로(기본 `sbom/bom.cdx.json`, SPDX 는 `sbom/bom.spdx.json`), 기존 파일은 `overwrite` 없이는 거부, `dryRun`(기본)은 계획만 |
| `check_egovframe_sbom` | **SBOM 점검** — 기존 CycloneDX·SPDX 2.x SBOM(형식 자동 판별)의 최소 요소 7종(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각) 충족 여부와 빠진 component, 빌드 도구 없이 purl 로 기준 재판정·OSV 재조회(생성 이후 새 취약점), `baselinePath` 와 비교(추가·제거·버전·판정·취약점), `vex=true` 면 CycloneDX VEX 초안(`in_triage`, BOM-Link, 사람의 판단 보존, CycloneDX 입력만). SBOM 파일은 바꾸지 않음 |
| `check_egovframe_secure_coding` | **보안약점 점검** — 행안부·KISA 개발보안 가이드(2021) 구현단계 보안약점 중 정적 패턴 14개 항목(규칙 20종: SQL 삽입·XSS·경로 조작·URL 자동접속·OS 명령·XXE·약한 암호·난수·하드코드 정보·쿠키·오류 노출·빈 catch·역직렬화·디버그 코드)을 파일·라인·CWE·등급·조치·출처(공통컴포넌트 원본/수정본/매니페스트 없음·프로젝트·테스트)로. 예외 파일(사유·검토자), `baselinePath` 비교(새 항목), SARIF 2.1.0(`format=sarif`·`sarifPath`). 진단 보조이며 공인 진단을 대체하지 않음 |
| `generate_egovframe_deploy` | **컨테이너·배포 산출물** — Dockerfile(멀티 스테이지·Classic war → Tomcat 10.1(Servlet 6.1+ 는 11.0) ROOT, Boot jar → Temurin JRE, 비루트·HEALTHCHECK, `buildInImage=false` 면 미리 빌드한 산출물)·`.dockerignore`·`deploy/docker-compose.yml`(DbType 별 DB 컨테이너·초기화 SQL)·`deploy/k8s/<app>.yaml`(Deployment·Service·ConfigMap·Secret·선택 Ingress). DB 설정은 Boot 환경 변수·Classic 설정 파일 덮어쓰기, `imageRegistry`(폐쇄망), `dockerfilePath`(템플릿 자체 Dockerfile 과 공존). 새 파일만, `dryRun` 기본 |
| `prepare_egovframe_delivery` | **납품 패키지**(v1.1) — 평가서·의존성 조치 목록·SBOM(CycloneDX·SPDX)·SBOM 점검과 VEX 초안·보안약점(SARIF)·배포 산출물(·빌드)을 새 디렉터리 하나에 모으고 `delivery-manifest.json`(파일별 sha256·입력 지문·rootHash)과 목차 `index.md` 를 씀. 실패 항목은 이유와 함께 목차에 남김. `previousDelivery` 로 이전 차수 비교(diff.md)와 VEX 판단 보존, `verify=true` 로 받은 패키지 재검증, `zip`, dryRun 기본. 프로젝트는 읽기만 |
| `generate_agents_md` | 프로젝트 진단 결과로 AI 코딩 도구용 `AGENTS.md` 생성 — 빌드·테스트 명령(래퍼 감지), RTE·5.x 전환 상태, DbType, 기본 패키지·설정 디렉터리, 설치 컴포넌트(매니페스트 여부), 규칙(좌표·백업 디렉터리·비밀 정보·의존성 기준), MCP 도구 목록. 기존 파일은 `overwrite` 없이는 거부, `dryRun`, ko/en, 파일명 변경(`CLAUDE.md` 등) |

## create_egovframe_project 파라미터

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
- `alignParent` — (선택, 기본 `false`) `true`면 생성 직후 pom 의 5.x parent·RTE 버전을 최신 5.0.x 로 맞춤(v0.46). 공식 Initializr 템플릿은 parent 5.0.0(web·boot-web)·5.0.1(그 밖)로 만들어집니다

동작: 공식 템플릿 zip 다운로드 → 압축 해제(zip-slip 방지) → `pom.xml`의 groupId/artifactId/name 적용(부모 POM 좌표는 유지) → `application.properties`의 `Globals.DbType` 설정, 프론트엔드 템플릿은 `package.json`의 `name` 설정. 기존 디렉터리가 있으면 거부합니다. 다운로드에는 30초 타임아웃이 적용되어 무응답 시 무한 대기하지 않습니다. `dryRun`으로 먼저 안전하게 미리볼 수 있습니다.

## generate_egovframe_crud 핵심 파라미터

- `projectDir` — 대상 Maven/Gradle 프로젝트
- `tableName`, `entityName` — DB 테이블과 생성할 클래스명 (`entityName` 생략 시 테이블명에서 변환). `ddl` 을 주면 `tableName` 은 생략 가능(주면 DDL 의 테이블명과 같아야 함)
- `basePackage` — 기본 패키지. mapper·VO·service·impl·controller 패키지를 개별 재정의할 수도 있습니다.
- `fields` — `columnName`, `javaType`, `jdbcType`, `primaryKey`, `generated`, `nullable`, `label` 컬럼 스펙. 안전한 update/delete 생성을 위해 기본키가 최소 1개 필요합니다.
- `ddl`(v1.4) — `fields` 대신 `CREATE TABLE` 문. 컬럼·타입·`PRIMARY KEY`(인라인·테이블 제약)·`NOT NULL`·자동 증가(`AUTO_INCREMENT`·`IDENTITY`·`SERIAL`)·`COMMENT`(또는 `COMMENT ON COLUMN … IS`)를 읽어 필드를 만듭니다. COMMENT·DEFAULT 안의 콤마·괄호, COMMENT 의 "primary key" 문구, `'C:\'` 같은 끝 백슬래시와 `\'` 이스케이프에 속지 않습니다(공식 Initializr v5.0.7 DDL 파서 테스트와 같은 결과). `dialect` 가 `oracle`·`tibero` 면 `DATE` 를 `LocalDateTime` 으로 봅니다. 알 수 없는 타입은 String 으로 만들고 경고합니다.
- `search`(v1.4) — 목록 검색 대상 문자열 컬럼(최대 10). Mapper 목록·건수에 `<bind>` 로 만든 LIKE 패턴(방언 중립 — `||`·`CONCAT` 을 쓰지 않음)과 `searchCondition` 분기(없으면 전체 OR), classic 화면에 검색 조건 select 와 등록 화면의 `form:hidden` 검색 필드(이스케이프)를 넣습니다. 생략하면 v1.3 까지와 같은 출력입니다.
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

```text
generate_egovframe_crud(
  projectDir="/work/my-egov-app",
  basePackage="egovframework.example.notice",
  ddl="CREATE TABLE SAMPLE_NOTICE (NOTICE_ID BIGINT NOT NULL AUTO_INCREMENT COMMENT '공지 ID', SUBJECT VARCHAR(200) NOT NULL COMMENT '제목', WRITER VARCHAR(50), PRIMARY KEY (NOTICE_ID))",
  search=["SUBJECT", "WRITER"]
)
```

생성 전 모든 대상 경로를 검사하며 기존 파일이 하나라도 있으면 아무 파일도 쓰지 않습니다. 지원 타입과 출력 계약은 [CRUD 생성 설계](design-crud-generation.md)를 참고하세요.

## generate_egovframe_config 핵심 파라미터

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

기존 파일이 있으면 쓰지 않고 거부하며, 결과의 컨텍스트에서 비밀번호 필드는 가려집니다. 템플릿은 [eGovFramework/egovframe-vscode-initializr](https://github.com/eGovFramework/egovframe-vscode-initializr)(Apache-2.0)의 `templates/config` 를 commit·sha256 고정으로 동봉합니다. 설계와 upstream 에서 발견한 문제는 [설정 파일 생성 설계](design-config-generation.md)를 참고하세요.

## migrate_egovframe_project 파라미터

- `projectDir` — 진단할 프로젝트(허용 root 적용). `pom.xml`(다중 모듈 포함)·`build.gradle(.kts)`·`*.java`·`*.xml`·`*.jsp`·`web.xml`·`*.properties/yml` 을 읽으며 `target/`·`build/`·`.git/`·`node_modules/` 는 건너뜁니다
- `target` — `5.x`(기본) = 3.x/4.x → 5.x 전환, `5.0.2`·`5.1.0` 같은 `5.y.z` = 이미 5.x 인 프로젝트의 갱신(v0.46, 아래 "5.x 최신 유지"). `5.1.0` 은 v1.3 부터 — GitHub 태그 없이 저장소에 배포된 버전이라 명시할 때만 쓰고, 생략 시 기본 목표는 5.0.2 입니다
- `format` — `markdown`(기본, 수동 항목 → 자동 항목 순 요약) | `json`(항목 배열 `{file, line, kind, from, to, action, reason, edits?}` 과 `summary.byKind`, `sourceEra`)
- `apply` — `true` 면 2단계(적용). `dryRun`(기본 `true`)이면 파일별 변경 미리보기만, `false` 면 실제 치환
- `verify` — `true` 면 3단계(검증): 진단 뒤 `compile` 을 실행해 컴파일 오류를 수동 항목과 연결한 작업 목록을 반환(빌드 도구 필요, 파일 무기록)
- `skipComponents` — `true` 면 3.x 공통컴포넌트 디렉터리(재조립 권고 대상)의 자동 항목을 치환하지 않고 수동으로 남김

```text
migrate_egovframe_project(projectDir="/work/legacy-3.10-app")                       # 1단계 진단
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", apply=true)           # 적용 계획(미리보기)
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", apply=true, dryRun=false)  # 적용
migrate_egovframe_project(projectDir="/work/legacy-3.10-app", verify=true)   # 컴파일 → 오류 ↔ 수동 항목 작업 목록
migrate_egovframe_project(projectDir="/work/my-5x-app", target="5.0.2")             # 5.x 최신 유지 진단
migrate_egovframe_project(projectDir="/work/my-5x-app", target="5.0.2", apply=true, dryRun=false)  # parent·RTE 버전 갱신
migrate_egovframe_project(projectDir="/work/my-5x-app", target="5.1.0")             # 저장소 배포 5.1.0 까지(v1.3)
```

**5.x 최신 유지(v0.46)**: `target` 이 `5.0.x` 면 parent 버전·RTE 버전 속성·`org.egovframe.rte` 의존성의 리터럴 버전과 예전 parent 기본값을 그대로 덮어쓴 속성이 auto, 프로젝트의 실효 RTE 버전 이후 바뀐 API·동작을 소스(Java·XML·JSP)가 참조하는 곳(`rte-change`)과 공통컴포넌트 최신 유지 안내(`component-update`)가 manual 입니다. 3.x/4.x 프로젝트면 먼저 `target="5.x"` 로 전환하라고 안내합니다. 백업 디렉터리에는 `update-plan.json` 이 남습니다. 규칙의 근거와 공식 템플릿 실측은 [전환 설계 6단계](design-migration.md#6단계v0460-5x-최신-유지-migrate_egovframe_projecttarget502)에 있습니다.

**5.1.0(v1.3)**: 표준프레임워크 5.1.0 은 공식 Maven 저장소에 배포됐지만(2026-09-28~10-12) GitHub `v5.1.0-Final` 태그·공지가 아직 없습니다. 그래서 `target="5.1.0"` 의 변경 근거는 git 태그 비교가 아니라 저장소의 5.0.2·5.1.0 **sources jar 비교**(모듈 27종, jar 별 sha256 고정)이고, 결과 notes 에 그 사실을 적습니다. 5.1.0 단계에서 큐레이션한 변경은 배치 Writer 리소스 경로(`file:`), `EgovAbstractServiceImpl` 업무 예외 도우미, 엑셀 Content-Disposition, 리액티브 예외 응답, `psl-reactive-r2dbc` 의 BOM 제외 5건입니다. 공식 web·boot-web 템플릿은 5.0.2 → 5.1.0 갱신 뒤 JDK 17 compile 을 통과합니다(CI 통합). 기본 목표·`create_egovframe_project(alignParent=true)` 는 태그가 나올 때까지 5.0.2 그대로이며, 5.0.x 프로젝트를 진단하면 5.1.0 이 있다고 안내합니다.

`action` 이 `auto` 인 항목(좌표·RTE 버전 속성·패키지 접두어·패키지 이름 변경·`javax→jakarta` 패키지와 의존성 좌표·저장소 URL·Java 버전·web.xml 스키마)은 적용 단계가 원문 오프셋 기준으로 치환하고, `manual`(제거된 클래스·네임스페이스·교체 필요 라이브러리·Spring 버전·5.x parent 권고)은 사유와 대체 API 를 함께 남깁니다. 적용은 하나의 transaction 이며 원본을 `migration-backup/<시각>-<id>/` 에 보관하고 `migration-plan.json` 을 남깁니다. 중간에 실패하면 작업 전 상태로 되돌립니다. 규칙의 출처와 제거 클래스 38종의 대체 근거는 [전환 진단 설계](design-migration.md)를, 규칙 자체는 리소스 `egovframe://catalog/migration-rules` 를 참고하세요. 이 도구는 파일을 쓰지 않습니다.

## check_egovframe_dependencies 파라미터

- `projectDir` — 점검할 프로젝트(허용 root 적용). Maven(다중 모듈 pom, `<properties>` 해석) 또는 Gradle
- `offline` — `true`(기본) 오프라인 기준 대조만 | `false` OSV(`api.osv.dev`) 취약점 조회 추가
- `resolve` — `true` 면 빌드 도구로 의존성 트리를 해석해 전이 의존성까지 판정(Maven `maven-dependency-plugin:3.8.1:tree`, Gradle `dependencies --configuration runtimeClasspath`; 빌드 도구·저장소 접근 필요). `resolveScope` `runtime`(기본) | `all`(test·provided 포함), `resolveTimeoutMs`
- `format` — `markdown` | `json`

```text
check_egovframe_dependencies(projectDir="/work/my-egov-app", offline=false)
check_egovframe_dependencies(projectDir="/work/my-egov-app", resolve=true, offline=false)   # 실제로 실리는 artifact 전부
```

**멀티 모듈·MSA(v0.47)**: Maven `<modules>`·Gradle `include`·루트 빌드 파일 없는 독립 프로젝트 묶음(공식 `msa-edu` 의 `backend/*`)을 탐지해 항목마다 `module` 을 붙이고 `workspace.modules` 에 모듈별 요약을 냅니다. 모듈 pom 은 자기 parent 로 판정하고, Gradle 은 `set('x', 'v')`·`ext` 버전 변수와 공식 parent `mavenBom`(BOM 관리)을 읽습니다. `resolve=true` 는 독립 프로젝트마다 트리를 해석해 합칩니다. 5.x 최신 유지·SBOM·보안약점·평가서도 모듈별 표를 냅니다([설계](design-workspace.md)).

`resolve=true` 결과는 항목마다 `origin`(`declared`·`transitive`)과 전이 경로 `via`(예 `egovframe-rte-ptl-mvc → spring-webmvc`), 선언과 다르게 해석된 버전(`treeVersion`·`resolution.differs`)을 담고, parent 가 관리하는 좌표가 기준 미만 버전으로 해석되면 비고에 알립니다. 해석에 실패하면 선언 기준 결과에 이유를 붙여 돌려줍니다.

기준은 공식 5.x parent(`org.egovframe.web:egovframe-web-config-parent`·`org.egovframe.boot:egovframe-boot-starter-parent` 5.0.2)의 `properties`·`dependencyManagement`, Boot parent 가 상속하는 Spring Boot BOM 전체(`spring-boot-dependencies` 3.5.6 + import 한 단계), RTE 모듈 18종의 전이 의존성에서 추출한 `catalog/dependency-baseline.json`(schemaVersion 2) 이며, v1.3 부터 parent 5.1.0 을 쓰는 프로젝트는 `catalog/dependency-baseline-5.1.json`(parent 5.1.0 이 import 하는 BOM `egovframe-rte-root` 를 한 단계 풀고, Boot BOM 3.5.16 에 Boot parent 의 재정의 속성을 반영, RTE 모듈 27종 — AI 모듈 3종 포함)으로 판정합니다. `-egov.N` 재빌드 좌표(예: `spring-security 6.5.11-egov.1`)는 원 버전 이상으로 비교하고 OSV 는 원 버전으로 조회하며 note 에 재빌드라고 적습니다(SBOM 공급자는 eGovFramework). 기준은 리소스 `egovframe://catalog/dependency-baseline` 로 조회할 수 있습니다. 대조 순서는 parent 직접 → 계열 → (Boot parent 프로젝트) Boot BOM → RTE 전이, 그 밖은 RTE 전이 → Boot BOM 이고 항목마다 `basis` 로 출처를 적습니다. RTE 전이 버전보다 낮게 명시한 좌표는 "충돌 가능" 사유와 함께 기준 미만으로 봅니다. 국내 벤더·기관 배포 좌표(Altibase·Tibero·CUBRID·GPKI·mGov)는 `vendor`, 기준에 없는 좌표는 `unknown`(판단 보류)으로 두고 둘 다 조치 목록에 넣지 않습니다. 보안 점검은 설정의 존재 여부와 근거만 보고합니다(설계: [의존성 점검 설계](design-dependency-check.md)).

## generate_egovframe_sbom 파라미터

- `projectDir` — Maven 또는 Gradle 프로젝트(허용 root 적용)
- `bomFormat` — `cyclonedx-json`(기본, CycloneDX 1.6) | `spdx-json`(v0.43, SPDX 2.3 — CycloneDX 로 만든 뒤 변환)
- `outputPath` — 프로젝트 상대 경로(기본 `sbom/bom.cdx.json`, SPDX 는 `sbom/bom.spdx.json`; `..`·절대 경로·symlink 이탈 거부), `overwrite` — 기존 파일 덮어쓰기(기본 거부)
- `scope` — `runtime`(기본: compile+runtime) | `all`(test·provided 포함)
- `enrich` — `true`(기본) component 마다 `egovframe:status`·`egovframe:basis`·`egovframe:baseline` 속성 부착
- `offline` — `true`(기본) | `false` OSV 결과를 CycloneDX `vulnerabilities[]`(`affects` 로 component 참조)로 포함
- `dryRun` — `true`(기본) 실행 없이 명령·출력 경로만 | `false` 생성·기록, `timeoutMs`(기본 600000)
- v0.40: `supplier`(공급자 — 주 component 와 `metadata.supplier`, 기본 pom `<organization><name>`)·`author`(`metadata.authors`, 기본 supplier)·`componentName`·`componentVersion`(주 component 덮어쓰기), `fillSuppliers`(기본 enrich 와 같음 — 공급자가 없는 component 를 `catalog/sbom-rules.json` 공급자 표로 보완하고 `egovframe:supplierBasis=catalog` 로 표시). 응답의 `minimum` 이 최소 요소 7종 판정을 요약합니다.

```text
generate_egovframe_sbom(projectDir="/work/my-egov-app")                              # 계획만
generate_egovframe_sbom(projectDir="/work/my-egov-app", dryRun=false, offline=false)  # sbom/bom.cdx.json + OSV
generate_egovframe_sbom(projectDir="/work/my-egov-app", dryRun=false, supplier="○○기관", author="○○정보기술")  # 최소 요소까지
generate_egovframe_sbom(projectDir="/work/my-egov-app", dryRun=false, bomFormat="spdx-json", supplier="○○기관")  # sbom/bom.spdx.json (SPDX 2.3)
```

Maven 은 `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom` 을 좌표를 완전히 적어 호출하므로 pom 을 바꾸지 않으며(해시·라이선스 포함, 멀티 모듈 합산), Gradle 은 해석된 트리로 이 서버가 문서를 구성합니다(해시·라이선스 없음, 빌드 파일 변경 없음). 문서의 `metadata.tools` 에 이 서버가 기록됩니다. 기준 판정은 `check_egovframe_dependencies` 와 같은 규칙입니다(설계: [의존성 점검 설계](design-dependency-check.md)).

## check_egovframe_sbom 파라미터 (SBOM 점검)

- `sbomPath` — 점검할 SBOM(기본 `sbom/bom.cdx.json`; CycloneDX JSON 또는 SPDX 2.x JSON, 형식 자동 판별), `baselinePath` — 비교할 이전 SBOM(선택, 형식이 달라도 purl 좌표로 비교)
- `offline` — `true`(기본) | `false` OSV 재조회(생성 이후 새로 알려진 취약점·지금 조회되지 않는 취약점)
- `vex` — `true` 면 VEX 초안 작성·갱신(`vexPath`, 기본 `sbom/vex.cdx.json`, CycloneDX 입력만), `dryRun` — vex 미리보기
- SBOM 파일은 바꾸지 않습니다. VEX 는 새 파일로 만들고, 다음 실행은 기존 판단을 그대로 두고 새 항목만 덧붙입니다(깨진 VEX 는 덮어쓰지 않고 중단)

## SBOM 제출 준비

2027년까지 공공 분야에 도입되는 IT 시스템·SW 제품의 SBOM 제출이 제도화됩니다(SW 공급망 보안 로드맵, 2026-06). 제출물에는 "만들었다"보다 **빠진 요소가 없고, 이전 제출본과 무엇이 달라졌으며, 알려진 취약점을 어떻게 판단했는지**가 함께 있어야 합니다.

```text
generate_egovframe_sbom(projectDir, dryRun=false, offline=false, supplier="○○기관", author="○○정보기술")   # 1. 생성(최소 요소 포함)
check_egovframe_sbom(projectDir)                                     # 2. 최소 요소 7종 — 제출 가능/보완 필요
check_egovframe_sbom(projectDir, offline=false, vex=true)            # 3. 새 취약점 확인 + VEX 초안(in_triage)
#    → 담당자가 sbom/vex.cdx.json 의 analysis.state 를 not_affected(+justification)·exploitable·resolved 등으로 기록
check_egovframe_sbom(projectDir, baselinePath="sbom/bom-2026Q3.cdx.json", offline=false, vex=true)   # 4. 다음 제출 전: 비교 + 새 취약점만 VEX 에 추가
```

| 최소 요소 | CycloneDX 위치 | SPDX 2.3 위치 (v0.43) | 비고 |
|---|---|---|---|
| 공급자 | component `supplier`·`publisher`·`manufacturer` (주 component 는 `metadata.supplier` 도) | `PackageSupplier`(없으면 `PackageOriginator`) | 플러그인은 pom `<organization>` 이 있는 라이브러리만 `publisher` 를 채움 — 공식 web 템플릿 67종 중 17종(RTE 등)이 비어 공급자 표로 보완 |
| 구성요소명 · 버전 | `name` · `version` | `PackageName` · `PackageVersion`(`versionInfo`) | |
| 고유식별자 | `purl`(또는 `cpe`·`swid`) | `externalRefs` 의 `purl`(또는 `cpe23Type`·`cpe22Type`·`swid`) | |
| 의존관계 | `dependencies[]` 에 그 component 의 `bom-ref` 항목 | 그 패키지가 주어인 `DEPENDS_ON`(또는 `*_DEPENDENCY_OF` 의 대상) | 의존이 없어도 빈 `dependsOn` / `DEPENDS_ON NONE` 이 있어야 함(`NOASSERTION` 은 모름) |
| 작성자 | `metadata.authors`(또는 `metadata.manufacturer`) | `creationInfo.creators` 의 `Person:`·`Organization:` | 생성 도구(`metadata.tools` / `Tool:`)만으로는 작성 주체가 드러나지 않음 |
| 생성 시각 | `metadata.timestamp` | `creationInfo.created` | ISO 8601 — SPDX 는 필수 항목이라 원본에 없으면 변환 시각을 넣고 알림 |

규칙은 `catalog/sbom-rules.json` 데이터입니다(출처: NTIA 최소 요소 2021, SW 공급망 보안 가이드라인 1.0) — 국내 지침이 요소를 더하면 데이터로 추가합니다. CI 에서는 `npx -y egovframe-scaffold-mcp sbom-check --offline=false --fail-on "minimum,newVulns"` 로 제출 전 점검을 게이트로 걸 수 있습니다.

제출처가 SPDX 를 요구하면(가이드라인 1.0 은 SPDX·CycloneDX 를 모두 언급) `bomFormat="spdx-json"` 으로 같은 내용을 SPDX 2.3 JSON 으로 냅니다. 체크섬·선언 라이선스(이름만 있는 라이선스는 `LicenseRef-` + `hasExtractedLicensingInfos`)·OSV 권고(`SECURITY`/`advisory` externalRefs)·기준 판정(`egovframe:*` annotations)도 옮기므로, SPDX 로 낸 뒤 `check_egovframe_sbom(sbomPath="sbom/bom.spdx.json")` 의 재판정·비교가 CycloneDX 와 같은 결과를 냅니다. SPDX 3.0, 취약점 판단 자동화(VEX 상태는 사람의 결정), 중앙 저장소 제출 API 는 범위 밖입니다.

## 컨테이너·배포 산출물 (`generate_egovframe_deploy`)

```text
generate_egovframe_deploy(projectDir)                                          # 미리보기(dryRun) — 파일 내용과 사용법
generate_egovframe_deploy(projectDir, dryRun=false)                            # Dockerfile·.dockerignore·deploy/docker-compose.yml·deploy/k8s/<app>.yaml
generate_egovframe_deploy(projectDir, dryRun=false, imageRegistry="harbor.example.go.kr/dockerhub", buildInImage=false)   # 폐쇄망
generate_egovframe_deploy(projectDir, dryRun=false, dockerfilePath="deploy/Dockerfile", ingressHost="egov.example.go.kr")  # 템플릿 자체 Dockerfile 과 공존
```

| 프로젝트 | 실행 이미지 | DB 설정 주입 | 헬스체크 |
|---|---|---|---|
| Classic(war) — web·template·mobile 등 | `tomcat:10.1-jdk17-temurin`(Servlet 6.1 이상 직접 선언 시 11.0), WAR 를 `webapps/ROOT` 로 풀어 둠 | `globals.properties` 사본(DB 호스트·비밀번호만 바꿈)을 compose 볼륨·Kubernetes Secret 으로 `WEB-INF/classes/…` 에 덮어씀 | `/` |
| Boot(jar) — boot-web·simple-backend·batch-web 등 | `eclipse-temurin:17-jre`, `exec java $JAVA_OPTS -jar` | Spring 환경 변수(`Globals.mysql.Url` → `GLOBALS_MYSQL_URL`, `spring.datasource.url` → `SPRING_DATASOURCE_URL`) | actuator 프로브가 있으면 `/actuator/health/liveness`·`readiness`, 아니면 `/` |
| Boot 배치(웹 없음) | 위와 같음 | 위와 같음 | 없음(포트·Service 없이, Job·CronJob 안내) |
| 멀티 모듈·MSA(v0.47) | 서비스 모듈마다 위 규칙(자체 Dockerfile 이 있으면 그대로) | 모듈 설정은 Spring 환경 변수, 설정 서버 native 저장소는 `deploy/config-repo` 사본 | 서비스마다 위와 같음, compose `depends_on: service_healthy` |
| 라이브러리 jar·빌드 파일 없음 | — | — | 만들지 않고 이유를 돌려줌 |

- **DB**: mysql 8.4·mariadb 11.4·postgres 16 은 compose 에 DB 컨테이너를 붙이고 템플릿의 DDL·DATA 를 초기화 스크립트로 마운트합니다(`--lower-case-table-names=1`, utf8mb4). 오라클·티베로·알티베이스·큐브리드는 연결 정보만 쓰고, Kubernetes 는 클러스터 밖 DB 를 가정해 `CHANGE_ME_DB_HOST`·Secret 자리표시자를 둡니다.
- **보안 기본값**: 비루트(uid 10001)·`runAsNonRoot`·`seccompProfile RuntimeDefault`·`allowPrivilegeEscalation false`·`capabilities drop ALL`·리소스 요청/제한·startup/readiness/liveness 프로브.
- **폐쇄망**: 기반 이미지는 `ARG BASE_REGISTRY`(기본 `imageRegistry`)로 사내 레지스트리에서 받고, `# syntax` 지시어를 쓰지 않아 BuildKit 프론트엔드 이미지를 받지 않습니다. 컨테이너 안에서 Maven 저장소에 닿지 않으면 `buildInImage=false` 로 호스트에서 빌드한 산출물만 담습니다. 반입할 이미지: `tomcat:10.1-jdk17-temurin`·`eclipse-temurin:17-jre`·`eclipse-temurin:17-jdk`(미리 빌드할 때)·`maven:3.9-eclipse-temurin-17`(이미지 안에서 빌드할 때)·DB 이미지(`docker save`/`docker load` 또는 사내 Harbor 프록시 캐시).
- **멀티 모듈·MSA(v0.47)**: 서비스 모듈마다 이미지와 하나의 `deploy/docker-compose.yml`(+ `.env.example`)·`deploy/k8s/<서비스>.yaml` 을 만듭니다. 설정의 `localhost:포트`·`127.0.0.1:포트` 는 포트로 대상을 찾아(서비스 `server.port`·DB 3306/5432·RabbitMQ 5672·Redis 6379) 서비스 이름으로 바꾸고, 모르는 포트는 바꾸지 않고 보고합니다. `server.port=0` 서비스는 8080 으로 고정하고, RabbitMQ 는 원격 접속이 막힌 `guest` 대신 `egov` 계정을 씁니다. `modules=["egovboard"]` 처럼 일부만 고르면 먼저 띄워야 하는 서비스·인프라가 함께 들어갑니다. 공식 `msa-common-components` 는 실제 기동에서 6개 컨테이너 healthy·Eureka 등록·Gateway health UP 을 확인했습니다.
- **실측**: 공식 web(Classic)·boot-web(Boot) 템플릿은 hadolint 경고 0·kubeconform(쿠버네티스 1.31) 통과, 실제 빌드·기동에서 HTTP 200·healthy·uid 10001. 공식 simple-backend(Boot + MySQL)는 compose 로 readiness UP·`/mainPage` 가 MySQL 초기화 데이터를 돌려주고, 공식 portal-site(Classic + MySQL)는 설정 파일 덮어쓰기로 MySQL 사용자 `pst` 에 연결해 메인 페이지가 열립니다. 설계: [docs/design-deploy.md](design-deploy.md).

## 납품 전 보안약점 점검 (`check_egovframe_secure_coding`)

감리 대상 사업은 「소프트웨어 개발보안 가이드」(행정안전부·KISA, 2021)의 구현단계 보안약점 49개를 지켜야 하고, 납품 전 진단에서 지적된 항목은 재작업이 됩니다. 이 도구는 그중 정적 패턴으로 근거 있게 찾을 수 있는 항목을 먼저 찾아 진단 전에 고칠 목록을 만듭니다(데이터 흐름 분석이 아닌 패턴 기반 진단 보조 — 공인 진단을 대체하지 않습니다).

```text
check_egovframe_secure_coding(projectDir)                                            # 등급·항목·출처별 요약 + 상위 40건
check_egovframe_secure_coding(projectDir, format="json")                             # 전체(지문 포함) — 다음 비교의 baseline
check_egovframe_secure_coding(projectDir, baselinePath="reports/secure-prev.json")   # 새로 생긴 것만 🆕
check_egovframe_secure_coding(projectDir, sarifPath="egovframe-secure.sarif", overwrite=true)   # SARIF 2.1.0
check_egovframe_secure_coding(projectDir, topN=100)                                  # Markdown 상세 항목 수(기본 40)
```

`topN` 의 옛 이름 `top` 은 1.0.0 부터 deprecated 입니다. 2.0.0 까지는 받고 응답에 경고 한 줄을 붙입니다([버전 정책](versioning.md#3-폐기deprecation-절차)).

| 가이드 항목 (규칙) | 찾는 것 | 걸러 내는 것 |
|---|---|---|
| SQL 삽입 (`sql-mybatis-dollar`·`sql-ibatis-dollar`·`sql-jdbc-concat`) | 매퍼의 `${…}`·`$…$`, JDBC 호출의 문자열 연결 | XML 주석, 스프링 설정의 `${Globals…}`, `?` 바인딩 — ORDER BY 다음의 `${}` 는 중간(허용 목록 검증 안내) |
| 크로스사이트 스크립트 (`xss-jsp-request`·`xss-jsp-el-param`·`xss-cout-unescaped`) | `<%= request.getParameter %>`, 본문·HTML 속성의 `${param.x}`, `<c:out escapeXml="false">` | `<c:out>`·`fn:escapeXml`, `<c:if test>`·`<spring:message code>` 같은 태그 속성, 상수 값, JSP 주석 |
| 경로 조작·URL 자동접속·운영체제 명령어·XML 외부개체 | 요청 파라미터로 만든 파일 경로·리다이렉트, 명령 실행(같은 줄에 요청 값이면 높음), 보호 설정 없는 XML 파서 | 고정 경로, `disallow-doctype-decl` 등 보호 설정이 있는 파일 |
| 취약한 암호·부적절한 난수·하드코드된 중요정보·쿠키 | MD5·SHA-1·DES·ECB(`"AES"` 단독), 보안 문맥의 `Random`, 코드·설정·docker-compose 의 평문 비밀번호, HttpOnly·Secure 없는 쿠키 | `ENC(…)`·`${…}`·숫자·가림·자리표시자, 파라미터 이름·경로 상수, 메시지 번들 |
| 오류 정보노출·오류상황 대응 부재·역직렬화·디버그 코드 | `printStackTrace()`, 빈 `catch`(주석만 있어도), `ObjectInputStream.readObject`, `System.out` | 로그 처리한 catch |

- **출처**: 공통컴포넌트 매니페스트의 해시로 "원본(업그레이드·예외·upstream 보고)"과 "수정본(직접 수정)"을 나누고, 매니페스트 없이 복사된 공통컴포넌트는 재조립을 안내합니다. 같은 규칙으로 공식 공통컴포넌트 v4.3.2 는 516건(중간 314), **v5.0.7 은 38건**(중간 16)입니다.
- **예외**: `.egovframe-secure-ignore.json` 에 `{"ignores":[{"rule":"debug-code","path":"src/main/java/egovframework/com/**","reason":"upstream 원본, 업그레이드 대기","reviewer":"홍길동"}]}` — 사유·검토자가 없는 항목은 적용하지 않고 목록으로 돌려줍니다.
- **CI**: `npx -y egovframe-scaffold-mcp secure --project . --sarif-path egovframe-secure.sarif --overwrite --fail-on high`, 또는 `generate_egovframe_ci(supplyChain=true, secureCoding=true)` 게이트 단계(GitHub 는 code scanning 에 SARIF 업로드). 평가서 4절에 요약이 나오며 등급 산식에는 넣지 않습니다. 설계: [docs/design-secure-coding.md](design-secure-coding.md).

## generate_egovframe_report 파라미터 (전환 준비도 평가서)

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

평가서 6절의 등급은 두 축입니다. **전환 난이도** = 수동 전환 항목 수(0 / 1–20 / 21–100 / 101+ → 0–3점) + 재조립 권고 공통컴포넌트 수(0 / 1–5 / 6–20 / 21+) + 제거된 API 참조 수(0 / 1–10 / 11–100 / 101+) + 현재 좌표 세대(5.x 0 · 4.x 1 · 3.x 2), **공급망 상태** = 기준 미만 의존성 수(0 / 1–3 / 4–10 / 11+) + 전환 대상·교체 필요 수(같은 구간) + 알려진 취약점이 있는 의존성 수(0 / 1–2 / 3–9 / 10+, 미조회면 0점으로 계산하고 주의) + 보안 설정 누락 수(0 / 1–2 / 3+ → 0–2점) + 5.x parent·Java 기준(각 미달 +1). 합계로 **A=0 · B≤3 · C≤7 · D>7**. 산식 전문은 리포트 안에 인쇄되며, 공식 5.x 템플릿은 전환 A, 공식 공통컴포넌트 3.10.0·4.3.2 전체 트리는 두 축 모두 D 입니다(구간을 정한 근거와 예시: [docs/design-assessment-report.md](design-assessment-report.md)). 비용·공수는 산정하지 않습니다.

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

## reassemble_egovframe_components 파라미터 (공통컴포넌트 재조립)

- `projectDir` — 대상 프로젝트(허용 root 적용)
- `components` — 재조립할 컴포넌트 id(그룹 id 는 하위로 펼침). 미지정 시 `diagnose_egovframe_project` 가 감지한 컴포넌트 전부
- `sourceTag` — 원본 태그(기본 `auto`: 프로젝트 파일의 git blob id 를 좌표 세대에 맞는 공식 태그와 대조해 일치가 가장 많은 태그), 예: `v3.10.0`
- `database` — 지정 시 컴포넌트별 DDL·DML 을 `scripts/egovframe-components/<db>/` 에 함께 생성
- `dryRun` — `true`(기본) 분류·계획만(파일 내용을 내려받지 않음) | `false` 적용, `verify` — 적용 뒤 compile 해 오류를 작업 목록 파일에 붙임
- `format` — `markdown`(기본) | `json`(`outputSchema`)

파일마다 판정은 목표와 같음(유지)·원본 그대로(교체)·사용자 수정(소스는 교체 + 원본 대비 패치 보존, 메시지·설정 조각·웹 자산은 사용자본 유지 + 목표본 참고 저장)·5.x 신규(추가)·5.x 에서 제거(백업 후 삭제, 사용자 수정이면 패치도)·원본 미확인(백업 후 교체)·사용자 추가(유지)입니다. 백업·패치·`reassemble-plan.json` 은 `migration-backup/<시각>-reassemble-*/` 에, 매니페스트는 `.egovframe-components.json` 에 남습니다. 원본 태그 비교에는 git 이 필요하고, blob 없는 bare 미러를 `EGOVFRAME_CACHE_DIR`(기본 `~/.cache/egovframe-scaffold-mcp`)에 태그당 수백 KB 로 캐시합니다. 사용자 패치를 자동으로 다시 적용하지는 않습니다(5.x 소스가 많이 바뀌어 fuzz 적용이 오히려 위험).

## rehearse_egovframe_migration 파라미터 (전환 리허설)

- `projectDir` — 대상 프로젝트(읽기만 함, 허용 root 적용)
- `steps` — 기본 `["reassemble","migrate","verify","align-pom"]`(순서 고정, 일부만 고를 수 있음)
- `components`·`sourceTag` — 재조립 단계에 그대로 전달
- `keepWorkspace` — `true` 면 사본(`EGOVFRAME_CACHE_DIR/rehearsal/<이름>-*`)을 남기고 경로를 돌려줌(기본: 끝나면 삭제), `timeoutMs` — 컴파일 1회(기본 900000), `topN` — 작업 목록 수

사본은 빌드 산출물·VCS·백업 디렉터리를 빼고 만듭니다. 재조립을 전환 적용보다 먼저 하는 이유는 적용이 컴포넌트 소스를 바꾸면 원본 태그 지문이 깨지기 때문입니다(공식 4.3.2 트리를 거꾸로 돌리면 v5.0.1 로 오인되고 1,489개 파일이 "사용자 수정"이 됩니다). Maven 은 `-Dmaven.compiler.fork=true` 와 `JDK_JAVAC_OPTIONS=-Xmaxerrs 100000` 으로 javac 의 오류 100개 상한 없이 셉니다. pom 맞춤은 사본에만 적용하고 패치로 돌려주므로, 검토해서 실제 pom 에 반영하면 됩니다. 실측(공식 공통컴포넌트 v4.3.2 전체): 자동 단계 후 6,003건(JDK 17)·6,335건(JDK 21) → pom 맞춤 후 1건. javac 판본마다 같은 원인을 다른 모양으로 보고하므로(JDK 17 은 없는 패키지의 import 대신 쓰는 곳마다 "cannot find symbol") 분석은 파일의 import 문·타입 선언 파일·Lombok 사용 여부로 원인을 묶습니다. pom 에 소스 인코딩이 없으면 UTF-8 로 컴파일합니다(JDK 18+ 기본값).

3.x/4.x 프로젝트 전환 흐름:

```text
generate_egovframe_report(projectDir, sections=["assessment"])        # 평가서: 재조립 권고·수동 항목·등급
rehearse_egovframe_migration(projectDir)                               # 사본에서 전 과정 실측: 남는 컴파일 오류·pom 변경안(원본 불변)
reassemble_egovframe_components(projectDir)                            # 미리보기: 원본 태그·파일별 판정
reassemble_egovframe_components(projectDir, dryRun=false)              # 공통컴포넌트 v5.0.7 재조립 + 패치·작업 목록
migrate_egovframe_project(projectDir, apply=true, dryRun=false)        # 나머지 좌표·패키지·Jakarta 자동 치환
migrate_egovframe_project(projectDir, verify=true)                     # compile 오류 ↔ 수동 항목 작업 목록
```

## diagnose_egovframe_network / generate_agents_md

```text
diagnose_egovframe_network()                       # 호스트 7종 전부, 호스트당 10초
diagnose_egovframe_network(hosts=["codeload.github.com"], timeoutMs=20000)
generate_agents_md(projectDir="/work/my-egov-app", dryRun=true)   # 내용만
generate_agents_md(projectDir="/work/my-egov-app", lang="en", fileName="CLAUDE.md", overwrite=true)
```

네트워크 진단은 프록시 URL 의 자격 증명을 가려서 보고하며, `NODE_TLS_REJECT_UNAUTHORIZED=0` 이 설정돼 있으면 경고합니다. 다운로드가 실패하는 다른 도구들도 오류 메시지 끝에 같은 분류와 한 줄 처방을 붙입니다(`[네트워크 timeout] … 자세한 진단: diagnose_egovframe_network`). `AGENTS.md` 의 사실 항목은 `diagnose_egovframe_project`·`migrate_egovframe_project`·빌드 도구 감지에서 오고, 규칙 항목은 이 서버의 도구가 지키는 원칙입니다.

## sync_egovframe_catalog / 컴포넌트 조립

- 카탈로그는 common-components 공식 `v5.0.7` 태그와 commit `7912e13c…`에 고정됩니다(v0.38 에서 v5.0.6 → v5.0.7, v0.39 에서 upstream 이 태그를 옮겨 `3756ab2c…` → `7912e13c…` 로 재고정).
- `sync_egovframe_catalog()`는 태그 이동, archive SHA-256·크기·파일 수 불일치, `sec.security` 누락, 미매핑 Java·Mapper·JSP를 검사합니다.
- `add_egovframe_components`는 기존 파일이 upstream과 동일하면 재사용하고 내용이 다르면 전체 조립을 거부합니다.
- 감지된 `mavenDependencies`는 결과에 반환합니다. 프로젝트별 dependency management·버전 정책을 보호하기 위해 기존 `pom.xml`과 `web.xml`은 자동 덮어쓰지 않습니다.

상세 스키마와 안전 게이트는 [카탈로그 동기화·완전 조립 설계](design-catalog-sync.md)를 참고하세요.

## 납품 패키지 (`prepare_egovframe_delivery`)

```text
prepare_egovframe_delivery(projectDir, outputDir="/work/delivery/2026-10-1차")                      # 계획(dryRun) — 항목·위치
prepare_egovframe_delivery(projectDir, outputDir, dryRun=false, offline=false, supplier="○○기관")    # 생성(OSV 포함)
prepare_egovframe_delivery(projectDir, outputDir="…/2차", dryRun=false, previousDelivery="…/1차")   # 이전 차수와 비교(diff.md)
prepare_egovframe_delivery(projectDir, outputDir="…/1차", verify=true)                               # 받은 패키지 재검증
```

- `include` — 기본 `assessment`·`dependencies`·`sbom`·`sbom-check`·`secure-coding`·`deploy`. `build` 는 로컬 JDK·Maven/Gradle 로 `package` 를 실제 실행하므로 지정할 때만. `sbom-check` 는 `sbom` 이 있어야 합니다.
- `outputDir` — 없거나 비어 있어야 하고 프로젝트 밖을 권합니다(CI 는 작업 디렉터리 안 `egovframe-delivery/`). 스테이징 뒤 rename 하므로 중간 실패는 흔적이 없습니다.
- `previousDelivery` — 이전 패키지 디렉터리. 등급·SBOM(추가·제거·버전·새/해소 취약점)·OSV ID·보안약점 지문을 비교하고, 이전 `sbom/vex.cdx.json` 의 사람 판단을 이어 씁니다. 같은 입력이면 "달라진 점 없음"입니다.
- `verify` — `delivery-manifest.json` 의 파일별 sha256·크기와 rootHash 를 다시 계산해 일치·불일치·누락·manifest 밖 파일을 보고합니다.
- `zip` — `<outputDir>.zip` 도 만듭니다.
- CLI: `deliver --output-dir <dir> --write [--previous-delivery <dir>] [--offline=false] [--supplier …] [--zip] [--fail-on failed]` · `deliver --output-dir <dir> --verify [--fail-on invalid]`. `generate_egovframe_ci(supplyChain=true, delivery=true)` 가 게이트 끝에 같은 단계를 넣습니다.
- 설계: [design-delivery.md](design-delivery.md).

## 리소스·프롬프트 (MCP Resources/Prompts)

도구(tools)뿐 아니라 MCP의 리소스·프롬프트도 제공합니다 (MCP 3대 프리미티브 완비).

**Resources** (읽기 전용) — 지원 클라이언트에서 도구 호출 없이 카탈로그를 탐색·인용:

모든 도구는 MCP annotations(`readOnlyHint`·`destructiveHint`·`idempotentHint`·`openWorldHint`)와 ko/en `title` 을 노출합니다 — 읽기 전용 14종(목록·검색·진단·검증·리포트·점검·upstream 대조), 파괴 가능 4종(`remove_egovframe_components`·`upgrade_egovframe_project`·`migrate_egovframe_project(apply)`·`generate_agents_md(overwrite)`), 네트워크 사용 도구는 `openWorldHint`. `diagnose_egovframe_project`·`validate_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network` 는 `outputSchema` 를 선언하고 `structuredContent` 로 같은 결과를 구조화해 돌려줍니다(`text` 는 그대로).

- `egovframe://catalog/components` · `egovframe://catalog/components/{id}` · `egovframe://catalog/templates` · `egovframe://catalog/recipes` · `egovframe://catalog/ai-components` · `egovframe://catalog/config-templates` · `egovframe://catalog/migration-rules` · `egovframe://catalog/dependency-baseline`

**Prompts** — 가이드형 워크플로: `scaffold_board_login`, `scaffold_ai_chatbot`, `scaffold_portal`, `maintain_existing`

**레시피** — 자주 쓰는 조합을 한 번에 조립합니다. 예: `apply_egovframe_recipe(recipeId="board-login", projectName="my-egov-app", outputDir="~/work")`. 목록은 `catalog/recipes.json`에서 관리하며 기여 환영합니다.

## MCP Registry

[MCP Registry](https://registry.modelcontextprotocol.io) 용 메타데이터는 저장소의 `server.json`(이름 `io.github.EricSeokgon/egovframe-scaffold-mcp`)과 `package.json` 의 `mcpName` 이며, `npm run test:registry` 가 두 파일의 이름·버전·npm 좌표 일치를 검사합니다. 등록은 npm 배포 뒤 저장소 루트에서:

```bash
mcp-publisher login github     # GitHub device flow — io.github.EricSeokgon/ 네임스페이스 권한
mcp-publisher publish          # server.json 을 레지스트리에 게시
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EricSeokgon/egovframe-scaffold-mcp"
```

버전을 올릴 때 `server.json` 의 `version`·`packages[0].version` 도 함께 올립니다(릴리스 절차 참조).
