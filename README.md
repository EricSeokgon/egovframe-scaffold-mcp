# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

**English summary: [README.en.md](README.en.md)** · 도구 설명을 영문으로 받으려면 `EGOVFRAME_LANG=en`

전자정부 표준프레임워크(eGovFrame) 프로젝트 스캐폴딩·조립·진단을 제공하는 **MCP(Model Context Protocol) 서버** — 커뮤니티 PoC

> [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 개념 증명(Proof of Concept) 구현입니다.
> [#628](https://github.com/eGovFramework/egovframe-common-components/issues/628)(eGovFrame MCP Server 제안)을 "프로젝트 생성 → 컴포넌트 조립 → 진단·업그레이드" 수명주기로 구체화했습니다.

Claude, VS Code(Copilot), Cursor 등 MCP를 지원하는 AI 도구에서 **대화 중 즉시** 표준프레임워크
프로젝트를 만들고 공통컴포넌트·AI 계층을 조립할 수 있습니다. 기존 프로젝트 진단, 리포트, 안전한 upstream 재동기화도 지원합니다.

현재 v0.45.0은 **도구 34종(title·annotations·구조화 출력 13종) + CLI 명령 11종, 공식 템플릿 22종, 설정 템플릿 21종, 5.x 전환 규칙(RTE 18모듈·클래스 331종 + 공통컴포넌트 1,089종 근거)과 적용·검증·재조립·사본 리허설, 의존성 기준(공식 parent 관리 좌표 139종+계열 6종+Spring Boot BOM 1,473종+RTE 전이 58종)·해석된 의존성 트리·CycloneDX·SPDX SBOM 생성·점검(최소 요소·비교·VEX), 개발보안 가이드 보안약점 점검(SARIF), 컨테이너·배포 산출물(Dockerfile·docker-compose·Kubernetes), GitHub·GitLab·Jenkins CI 공급망 게이트, 규칙·기준 drift 감시, 폐쇄망 오프라인 번들, 네트워크 진단·AGENTS.md 생성, 공통컴포넌트 카탈로그 190항목(리프 176종+그룹 14종, v5.0.7)**을 제공합니다.

## 진행 현황 (2026-10-16)

- **소스 기준**: v0.47.0(`package.json`), 도구 34종 + CLI 명령 11종·공식 템플릿 22종·설정 템플릿 21종·카탈로그 190항목(공통컴포넌트 v5.0.7).
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
- **v0.47.0 추가**: 멀티 모듈·MSA 대응 — 새 `src/workspace.ts` 가 Maven `<modules>`·Gradle `include`·루트 빌드 파일 없는 독립 프로젝트 묶음을 탐지하고(라이브러리 모듈·작업공간 안 parent 상속 판정), 의존성 점검·5.x 최신 유지·SBOM·보안약점·평가서가 모듈별 결과와 합계를 냅니다. 공식 MSA 템플릿에서 의존성 판정은 `msa-edu` 0 → 280건·`msa-portal-backend` 0 → 256건, `msa-common-components` 의 "버전 없음" 152 → 0(모듈 parent 관리)이 되었습니다. Gradle 버전 변수(`set('egovframeBootParentVersion', …)`)는 공식 parent·RTE 에만 쓰이면 auto, 다른 좌표(`egovframe-cloud-module-common`)에도 쓰이면 manual 입니다. `generate_egovframe_deploy` 는 서비스 모듈마다 이미지(자체 Dockerfile 재사용)와 하나의 compose·서비스별 Kubernetes 매니페스트를 만들고, 설정의 `localhost:포트` 를 서비스·DB·RabbitMQ·Redis 이름으로 바꿉니다(모듈 설정은 Spring 환경 변수, 설정 서버 native 저장소는 `deploy/config-repo` 사본). 선택 파라미터 `modules` 로 일부 서비스만 고릅니다. CI 통합에서 `msa-common-components` 를 5.0.2 로 갱신·빌드해 ConfigServer·EurekaServer·GatewayServer·EgovBoard 를 compose 로 띄우고 Eureka 등록·Gateway health UP 을 확인합니다. 도구 수는 34종 그대로입니다. 설계: [docs/design-workspace.md](docs/design-workspace.md).
- **v0.46.0 추가**: 5.x 최신 유지와 생성 CI 실행 검증 — `migrate_egovframe_project(target="5.0.2")` 가 이미 5.x 인 프로젝트를 최신 5.0.x 로 맞춥니다. parent·RTE 버전 속성·RTE 의존성 리터럴 버전은 auto, 그 사이 바뀐 RTE API·동작(보안 설정 `@Bean` 시그니처·엑셀 수식 주입 방지·XML XXE 차단·테이블 ID 생성 행 잠금 등 11건)을 프로젝트가 참조하는 곳과 공통컴포넌트 최신 유지 안내는 manual 이고, `apply`·`verify` 는 전환과 같습니다. 규칙은 `egovframe-runtime` 5.0.0·5.0.1·5.0.2 태그와 공식 parent pom 으로 만든 `catalog/update-rules.json` 입니다. 공식 web·boot-web 템플릿(parent 5.0.0)은 갱신 뒤 JDK 17 compile 이 통과하고, 의존성 기준 미만이 6 → 4·3 → 1, 공급망 등급이 C → B 가 됩니다. `create_egovframe_project(alignParent=true)` 는 생성 직후 같은 갱신을 적용하고, 평가서 2절에 "5.x 최신 유지" 요약이 붙습니다. 생성 `Jenkinsfile` 은 공식 Jenkins LTS(플러그인 56종 버전 고정)에서 선언형 문법 검증 후 실제로 실행해 모든 단계 성공·산출물 보관을, 생성 `.gitlab-ci.yml` 은 gitlab-ci-local 로 build·supply-chain job 성공·산출물을 CI 에서 확인합니다. 도구 수는 34종 그대로입니다.
- **v0.45.0 추가**: 컨테이너·배포 산출물 — 새 도구 **`generate_egovframe_deploy`**(34번째)가 진단(빌드 도구·war/jar·Boot·웹·actuator·DbType·설정 파일)으로 Dockerfile(멀티 스테이지 Maven/Gradle 빌드 → Classic war 는 Tomcat 10.1 에 ROOT 로 풀어서, Boot jar 는 Temurin JRE — 비루트·HEALTHCHECK·Asia/Seoul·UTF-8, `buildInImage=false` 면 미리 빌드한 산출물), `deploy/docker-compose.yml`(앱 + DbType 별 mysql·mariadb·postgres 컨테이너, 템플릿 DDL·DATA 초기화), Kubernetes 매니페스트(Deployment 프로브·비루트 securityContext·리소스, Service, ConfigMap, Secret, 선택 Ingress)를 만듭니다. DB 설정은 Boot 는 Spring 환경 변수(`Globals.mysql.Url` → `GLOBALS_MYSQL_URL`), Classic 은 `globals.properties` 사본을 볼륨·Secret 으로 덮어쓰고, 기반 이미지는 `imageRegistry`(Dockerfile `BASE_REGISTRY`)로 사내 레지스트리에서 받습니다. 공식 web(Classic)·boot-web(Boot) 템플릿은 hadolint 경고 0·kubeconform 통과 후 실제 `docker build` → 기동 → HTTP 200·healthy·uid 10001, 공식 simple-backend 는 `docker compose up` 으로 MySQL 초기화 데이터가 API 로 나오는 것까지 CI 에서 확인합니다.
- **v0.44.0 추가**: 납품 전 보안약점 점검 — 새 도구 **`check_egovframe_secure_coding`**(33번째)이 행정안전부·KISA 「소프트웨어 개발보안 가이드」(2021, 구현단계 보안약점 49개) 중 정적 패턴으로 오탐을 통제할 수 있는 14개 항목(규칙 20종 — SQL 삽입·크로스사이트 스크립트·경로 조작·URL 자동접속·운영체제 명령어·XML 외부개체·취약한 암호·부적절한 난수·하드코드된 중요정보·쿠키·오류 정보노출·오류상황 대응 부재·역직렬화·디버그 코드)을 소스에서 찾습니다. 규칙은 데이터(`catalog/secure-coding-rules.json`)이고, 주석(공식 공통컴포넌트 매퍼의 `${…}` 96건은 전부 "#{} 로 변경" 주석)·`<c:out>`·커스텀 태그 속성·자리표시자 같은 오탐을 실측으로 걸러 냅니다. 항목마다 공통컴포넌트 원본·수정본·매니페스트 없음·프로젝트·테스트 출처를 붙이고, 예외 파일(사유·검토자 필수)·이전 결과와 비교(새 항목만)·**SARIF 2.1.0**(GitHub code scanning, OASIS 공식 스키마 통과)을 지원합니다. 같은 규칙으로 공식 공통컴포넌트는 v4.3.2 516건 → **v5.0.7 38건**(`escapeXml="false"` 304 → 6)이라 업그레이드 효과가 숫자로 보이고, 공식 web·boot-web 템플릿은 0건입니다. 평가서 4절, CLI `secure`, `generate_egovframe_ci(secureCoding=true)` 게이트 단계(GitHub 은 SARIF 업로드).
- **v0.43.0 추가**: CI·제출 형식 다변화 — `generate_egovframe_ci(platform="gitlab"|"jenkins")` 가 GitHub Actions 와 같은 빌드·공급망 게이트를 `.gitlab-ci.yml`(JUnit·CycloneDX 리포트)·`Jenkinsfile`(Declarative, Linux `sh`·Windows `bat` 공용)로 만들고, 게이트에 **SBOM 최소 요소 점검**(`sbom-check --fail-on minimum`)을 세 플랫폼 모두 추가했습니다. 사내 npm 레지스트리(`npmRegistry`)·오프라인 번들 경로(`offlineBundle`)는 환경 변수로 들어가고, 공급자 단서가 없으면 게이트가 실패할 것을 미리 알립니다. SBOM 은 **SPDX 2.3 JSON** 으로도 냅니다 — `generate_egovframe_sbom(bomFormat="spdx-json")` 이 패키지·`DEPENDS_ON` 관계(의존 없음은 `NONE`)·purl·공급자·creators·created·체크섬·선언 라이선스·OSV 권고·기준 판정(annotations)을 담고, `check_egovframe_sbom` 은 형식을 자동 판별해 SPDX 도 같은 최소 요소 7종·재판정·비교로 점검합니다(VEX 는 CycloneDX 만). 공식 web 템플릿을 실제 Maven 으로 만든 SBOM 은 SPDX 로 바꿔도 component 67·최소 요소 판정(요소별 충족 수까지)이 같고 SPDX ↔ CycloneDX 비교 차이 0 이며, 생성 `.gitlab-ci.yml` 은 GitLab 공식 CI 스키마를, SPDX 출력은 공식 spdx-spec v2.3 스키마를 통과합니다. 도구 수는 32종 그대로입니다.
- **v0.42.0 추가**: 폐쇄망(망분리) 운영 — 새 도구 **`prepare_egovframe_offline_bundle`**(32번째)이 인터넷 PC 에서 OSV Maven 취약점 전체 덤프(≈10MB, 7,190건)·고정 공통컴포넌트 아카이브(sha256 검증)·Initializr zip 템플릿(고정 지문)·재조립용 공식 공통컴포넌트 태그 22개 미러(≈37MB)를 한 디렉터리에 담고 `bundle-manifest.json`(파일별 sha256·크기·출처 URL·받은 시각)을 씁니다. 폐쇄망 PC 에서 `EGOVFRAME_OFFLINE_BUNDLE` 만 지정하면 다운로드는 번들 파일을 지문 검증 후 쓰고(변조 거부), `offline=false` 의 OSV 조회는 로컬 덤프로 판정하며(스냅숏 기준일 표시, 30일 넘으면 경고), 재조립은 번들 미러를 씁니다. 같은 날 받은 덤프의 로컬 판정이 온라인 OSV 와 **질의 73/73·ID 134/134 일치**했고, 네트워크를 막은 상태에서 프로젝트 생성·공통컴포넌트 조립·재조립 미리보기·SBOM 재점검이 번들만으로 끝나는 것(네트워크 시도 0건)을 CI 에서 확인합니다. CLI `bundle`, 네트워크 진단의 오프라인 번들 처방.
- **v0.41.0 추가**: 전환 리허설 — 새 도구 **`rehearse_egovframe_migration`**(31번째)이 프로젝트를 건드리지 않고 사본에서 공통컴포넌트 재조립 → 전환 자동 항목 적용 → 컴파일 → pom 을 공식 공통컴포넌트 v5.0.7 기준으로 맞춤 → 다시 컴파일까지 돌려 "자동 단계 뒤 사람이 고칠 것이 실제로 몇 건인가"를 잽니다(javac 의 오류 100개 상한 없이 전부 셈, 실행 전후 지문으로 원본 불변 확인). 공식 공통컴포넌트 **v4.3.2 전체 트리**(6,523 파일)는 자동 단계 뒤 컴파일 오류 **6,003건**(CI·JDK 17, JDK 21 은 6,335건) 중 4건을 뺀 전부가 누락 패키지와 그 연쇄(pom 의존성, 그 때문에 Lombok 이 돌지 못한 getter 등)였고, pom 을 맞추면 **1건**(GPKI 벤더 jar 의 javax 참조)만 남습니다 — CI 가 이 값을 기대값으로 고정합니다. 실측 중 찾은 두 결함도 고쳤습니다: 재조립은 전환 적용보다 **먼저** 해야 원본 태그가 식별되고(반대로 하면 4.3.2 가 v5.0.1 로 오인), 4.x 의 `org.egovframe.rte` 좌표가 5.x 로 분류되던 문제와 Maven 경고·fork 형식이 컴파일 오류로 잘못 읽히던 문제를 바로잡았습니다. 평가서 6절에 최근 리허설 실측이 함께 나옵니다.
- **v0.40.0 추가**: SBOM 운영 — 새 도구 **`check_egovframe_sbom`**(30번째)이 이미 만든 CycloneDX SBOM 을 제출물로서 점검합니다. (1) 최소 요소 7종(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각, NTIA 최소 요소 = 국내 SW 공급망 보안 가이드라인 핵심 구성요소)을 component 마다 세어 "제출 가능/보완 필요"를, (2) 빌드 도구 없이 purl 만으로 기준 판정과 OSV 를 다시 해 생성 이후 바뀐 판정·새로 알려진 취약점을, (3) 이전 SBOM 과의 추가·제거·버전·판정·취약점 차이를, (4) `vex=true` 면 CycloneDX VEX 초안(새 취약점은 `in_triage`, 사람이 적은 판단은 보존)을 냅니다. `generate_egovframe_sbom` 은 `supplier`·`author` 옵션(기본 pom `<organization>`)과 공급자 표로 최소 요소를 생성 단계에서 채웁니다. 공식 web 템플릿 SBOM 은 공급자(주 component 포함 18종)·작성자가 비어 "보완 필요", 옵션으로 다시 만들면 "제출 가능"이고, SBOM·VEX 모두 CycloneDX 1.6 공식 스키마를 통과합니다. CLI `sbom-check`, 평가서 5절에 최소 요소·VEX 상태. 기획 세 버전(v0.38–v0.40)이 모두 완료됐습니다.
- **v0.39.0 추가**: CLI 모드와 CI 공급망 게이트 — `npx egovframe-scaffold-mcp <assess|check|sbom|migrate|validate|diagnose|network>` 가 AI 클라이언트 없이 같은 분석을 실행하고 종료합니다(인자 없는 실행은 기존 stdio 서버). `--json` 은 MCP `structuredContent` 와 같은 객체이고, `--fail-on supplyChain:C`·`vulnerabilities`·`manual>20` 같은 기준을 넘으면 종료 코드 2 로 파이프라인을 멈춥니다. `generate_egovframe_ci(supplyChain=true)` 는 SBOM 생성 → 평가서(등급을 PR 요약에) → 아티팩트로 이어지는 게이트 job 을 만듭니다(생성 결과는 CI 에서 actionlint 로 검사). MCP SDK 1.32.1(프로토콜 2025-11-25)로 올렸습니다.
- **v0.38.0 추가**: 공통컴포넌트 재조립 실행 — 새 도구 **`reassemble_egovframe_components`**(29번째)가 3.x/4.x 프로젝트에 복사된 공통컴포넌트 소스의 원본 태그를 공식 저장소 태그와 git blob id 로 대조해 찾고(파일 내용은 내려받지 않음), 원본·현재·목표로 파일마다 3-way 판정한 뒤 v5.0.7 로 다시 조립합니다. 사용자 수정은 원본 대비 unified diff 패치로 보존하고 작업 목록으로 돌려주며, 매니페스트를 남겨 이후 `upgrade`·`validate`·`remove` 가 그대로 적용됩니다. 공통컴포넌트 카탈로그·전환 규칙의 대응표를 upstream 새 태그 **v5.0.7**(2026-10-06)로 올렸습니다. 공식 v3.10.0 트리의 `cmm`·`bbs` 를 고친 픽스처에서 원본 v3.10.0 식별(99%), 780개 파일이 v5.0.7 tree 와 일치, `validate` 누락 0·`upgrade` 변경 0 을 CI 에서 확인합니다.
- **v0.37.0 추가**: 전환 준비도 평가서 + 회귀 코퍼스 — `generate_egovframe_report(sections=["assessment"])` 가 진단·전환 진단·의존성·보안 설정·SBOM 확인을 한 번에 돌려 여섯 절(개요·전환 범위·의존성 조치 목록·보안·SBOM·**등급과 근거**)의 평가서를 만듭니다. 전환 난이도와 공급망 상태를 각각 A–D 로 매기되 요인·구간·점수 산식을 리포트에 그대로 인쇄해 사람이 재계산할 수 있고(테스트가 실제로 재계산), `format=json`(`outputSchema`)·`outputPath`(새 파일만, transaction) 를 지원합니다. 회귀 코퍼스 `test:migrate-corpus` 가 공식 공통컴포넌트 **v3.10.0·v4.3.2** 부분 트리(커밋 고정, sparse 클론 ≈3초)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 의 기대값과 ±1% 안인지 CI 에서 단언합니다 — 4.x→5.x 경로를 실제 자산으로 처음 확인했고 두 세대 모두 확인 필요 클래스 0·기준 없음 1(`xerces`)입니다. 릴리스 워크플로는 끊긴 배포를 이어 갑니다(npm 의 `gitHead` 커밋에 태그, 전파 대기 10분·경고만). 기획 세 버전(v0.35–v0.37)이 모두 완료됐습니다(설계: [docs/design-assessment-report.md](docs/design-assessment-report.md)).
- **v0.36.0 추가**: 해석된 의존성 트리 + SBOM — `check_egovframe_dependencies(resolve=true)` 가 Maven(`dependency:tree`)·Gradle(`dependencies`)로 전이 의존성까지 해석해 기준·OSV 와 대조합니다(항목마다 `origin`·트리 경로 `via`, 선언과 다르게 해석된 버전은 `differs`). 공식 `egovframe-web` 템플릿은 선언 19건·조치 0 이지만 해석하면 65 artifact 중 기준 미만 11·OSV 권고 24건이 보입니다. 새 도구 **`generate_egovframe_sbom`**(28번째)이 빌드 파일 변경 없이 CycloneDX 1.6 JSON 을 만들고(Maven 은 cyclonedx-maven-plugin 으로 해시·라이선스 포함, Gradle 은 해석 트리로 구성) component 마다 기준 판정(`egovframe:status·basis·baseline`)을, `offline=false` 면 OSV 결과를 `vulnerabilities[]` 로 넣습니다 — 2027년부터 단계화되는 공공기관 SBOM 등록·제출에 쓸 수 있는 형식입니다.
- **v0.35.0 추가**: 릴리스 자동화 — `main` 에서 CI 가 성공하면 `release.yml` 이 네 조건(`server.json` 버전 일치·변경 이력 항목·태그 없음·npm 미배포)을 검사해 npm(OIDC trusted publishing, provenance 자동) → 그 커밋에 태그 → GitHub Release(변경 이력에서 추출) → MCP Registry(GitHub OIDC) 순으로 게시합니다. 사람은 PR 병합만 합니다. 게이트에 `test:release`(판정 함수·릴리스 노트·`npm pack` 내용·크기 상한)와 `server.json` 설명 100자 제한(레지스트리 검증 조건 — 실제 `mcp-publisher validate` 로 발견한 결함 수정)을 추가했습니다.
- **v0.34.0 추가**: 의존성 기준 완성 + 규칙·기준 drift 감시 — `check_egovframe_dependencies` 의 기준에 **Spring Boot BOM 전체**(`spring-boot-dependencies` 3.5.6 직접 항목 + BOM import 44종을 한 단계 풀어 1,473 좌표)와 **RTE 모듈 18종의 전이 의존성**(58 좌표, 어느 모듈이 끌어오는지)을 더해 항목마다 기준 출처(parent 직접·계열·Boot BOM·RTE 전이·전환 규칙)를 표시하고, 국내 벤더·기관 배포 좌표는 `vendor` 로, EOL·이전 좌표(옛 MySQL/Oracle 드라이버·Jackson 1·xmlbeans·Ehcache 2·HttpClient 4·ANTLR 3·Spring Social)는 교체 규칙으로 분류해 공식 공통컴포넌트 3.10 pom 의 '기준 없음'을 17 → 1 로 줄였습니다. `sync_egovframe_templates` 가 동봉 규칙·기준의 upstream drift(`egovframe-runtime`·공통컴포넌트 새 태그, 공식 parent 새 버전, 고정 pom sha256 변화)를 갱신 절차와 함께 보고합니다. 기준 parent 를 5.0.2 로 올렸습니다.
- **v0.33.0 추가**: `migrate_egovframe_project` 3단계 — `verify=true` 가 compile 을 실행해 컴파일 오류를 수동 항목과 연결하고 "처리하면 해결될 오류 수" 순 작업 목록을 냅니다(javac `symbol:`/`location:` 파싱). 규칙 카탈로그(schemaVersion 2)에 공통컴포넌트 3.x→5.x 대응표(`egovframe-common-components` v3.10.0↔v5.0.6, 제거 54·이동 4)를 추가해 `egovframework.com.*` 제거·이동 클래스를 진단하고, 3.x 공통컴포넌트 소스가 섞인 프로젝트에는 컴포넌트 단위 재조립 권고(`skipComponents` 로 치환 제외)를 냅니다.
- **다음 계획**: v0.48 납품 패키지 → v0.49 응답 영문화·진행 알림. [다음 버전 기획](#다음-버전-기획-v047v049) 참조.
- **배포 상태**: npm 최신 배포 버전은 상단 npm 배지와 [npm 패키지 페이지](https://www.npmjs.com/package/egovframe-scaffold-mcp)를 단일 출처로 확인합니다. 이 문서의 버전 표기는 저장소 소스(`package.json`) 기준이며, git 태그 `vX.Y.Z`가 해당 배포본의 커밋을 가리킵니다.

## 제공 도구

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
| `add_ai_components` | 공식 [egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플 기반 AI RAG 챗봇 조립 — Spring AI(Redis Stack)·LangChain4j(PGVector) 스택 선택(상호 배타), 소스·설정(`application-ai.yml` 프로필)·UI·인프라 복사, **pom 누락 의존성만 마커 구간 삽입**(백업 생성, 제거 시 원복), 충돌 시 전체 거부, `dryRun` 미리보기 (설계: [docs/design-ai-components.md](docs/design-ai-components.md)) |
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
- `alignParent` — (선택, 기본 `false`) `true`면 생성 직후 pom 의 5.x parent·RTE 버전을 최신 5.0.x 로 맞춤(v0.46). 공식 Initializr 템플릿은 parent 5.0.0(web·boot-web)·5.0.1(그 밖)로 만들어집니다

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
- `target` — `5.x`(기본) = 3.x/4.x → 5.x 전환, `5.0.2` 같은 `5.0.x` = 이미 5.x 인 프로젝트의 갱신(v0.46, 아래 "5.x 최신 유지")
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
```

**5.x 최신 유지(v0.46)**: `target` 이 `5.0.x` 면 parent 버전·RTE 버전 속성·`org.egovframe.rte` 의존성의 리터럴 버전과 예전 parent 기본값을 그대로 덮어쓴 속성이 auto, 프로젝트의 실효 RTE 버전 이후 바뀐 API·동작을 소스(Java·XML·JSP)가 참조하는 곳(`rte-change`)과 공통컴포넌트 최신 유지 안내(`component-update`)가 manual 입니다. 3.x/4.x 프로젝트면 먼저 `target="5.x"` 로 전환하라고 안내합니다. 백업 디렉터리에는 `update-plan.json` 이 남습니다. 규칙의 근거와 공식 템플릿 실측은 [전환 설계 6단계](docs/design-migration.md#6단계v0460-5x-최신-유지-migrate_egovframe_projecttarget502)에 있습니다.

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

**멀티 모듈·MSA(v0.47)**: Maven `<modules>`·Gradle `include`·루트 빌드 파일 없는 독립 프로젝트 묶음(공식 `msa-edu` 의 `backend/*`)을 탐지해 항목마다 `module` 을 붙이고 `workspace.modules` 에 모듈별 요약을 냅니다. 모듈 pom 은 자기 parent 로 판정하고, Gradle 은 `set('x', 'v')`·`ext` 버전 변수와 공식 parent `mavenBom`(BOM 관리)을 읽습니다. `resolve=true` 는 독립 프로젝트마다 트리를 해석해 합칩니다. 5.x 최신 유지·SBOM·보안약점·평가서도 모듈별 표를 냅니다([설계](docs/design-workspace.md)).

`resolve=true` 결과는 항목마다 `origin`(`declared`·`transitive`)과 전이 경로 `via`(예 `egovframe-rte-ptl-mvc → spring-webmvc`), 선언과 다르게 해석된 버전(`treeVersion`·`resolution.differs`)을 담고, parent 가 관리하는 좌표가 기준 미만 버전으로 해석되면 비고에 알립니다. 해석에 실패하면 선언 기준 결과에 이유를 붙여 돌려줍니다.

기준은 공식 5.x parent(`org.egovframe.web:egovframe-web-config-parent`·`org.egovframe.boot:egovframe-boot-starter-parent` 5.0.2)의 `properties`·`dependencyManagement`, Boot parent 가 상속하는 Spring Boot BOM 전체(`spring-boot-dependencies` 3.5.6 + import 한 단계), RTE 모듈 18종의 전이 의존성에서 추출한 `catalog/dependency-baseline.json`(schemaVersion 2) 이며 리소스 `egovframe://catalog/dependency-baseline` 로 조회할 수 있습니다. 대조 순서는 parent 직접 → 계열 → (Boot parent 프로젝트) Boot BOM → RTE 전이, 그 밖은 RTE 전이 → Boot BOM 이고 항목마다 `basis` 로 출처를 적습니다. RTE 전이 버전보다 낮게 명시한 좌표는 "충돌 가능" 사유와 함께 기준 미만으로 봅니다. 국내 벤더·기관 배포 좌표(Altibase·Tibero·CUBRID·GPKI·mGov)는 `vendor`, 기준에 없는 좌표는 `unknown`(판단 보류)으로 두고 둘 다 조치 목록에 넣지 않습니다. 보안 점검은 설정의 존재 여부와 근거만 보고합니다(설계: [의존성 점검 설계](docs/design-dependency-check.md)).

### generate_egovframe_sbom 파라미터

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

Maven 은 `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom` 을 좌표를 완전히 적어 호출하므로 pom 을 바꾸지 않으며(해시·라이선스 포함, 멀티 모듈 합산), Gradle 은 해석된 트리로 이 서버가 문서를 구성합니다(해시·라이선스 없음, 빌드 파일 변경 없음). 문서의 `metadata.tools` 에 이 서버가 기록됩니다. 기준 판정은 `check_egovframe_dependencies` 와 같은 규칙입니다(설계: [의존성 점검 설계](docs/design-dependency-check.md)).

### check_egovframe_sbom 파라미터 (SBOM 점검)

- `sbomPath` — 점검할 SBOM(기본 `sbom/bom.cdx.json`; CycloneDX JSON 또는 SPDX 2.x JSON, 형식 자동 판별), `baselinePath` — 비교할 이전 SBOM(선택, 형식이 달라도 purl 좌표로 비교)
- `offline` — `true`(기본) | `false` OSV 재조회(생성 이후 새로 알려진 취약점·지금 조회되지 않는 취약점)
- `vex` — `true` 면 VEX 초안 작성·갱신(`vexPath`, 기본 `sbom/vex.cdx.json`, CycloneDX 입력만), `dryRun` — vex 미리보기
- SBOM 파일은 바꾸지 않습니다. VEX 는 새 파일로 만들고, 다음 실행은 기존 판단을 그대로 두고 새 항목만 덧붙입니다(깨진 VEX 는 덮어쓰지 않고 중단)

### SBOM 제출 준비

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

### 컨테이너·배포 산출물 (`generate_egovframe_deploy`)

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
- **실측**: 공식 web(Classic)·boot-web(Boot) 템플릿은 hadolint 경고 0·kubeconform(쿠버네티스 1.31) 통과, 실제 빌드·기동에서 HTTP 200·healthy·uid 10001. 공식 simple-backend(Boot + MySQL)는 compose 로 readiness UP·`/mainPage` 가 MySQL 초기화 데이터를 돌려주고, 공식 portal-site(Classic + MySQL)는 설정 파일 덮어쓰기로 MySQL 사용자 `pst` 에 연결해 메인 페이지가 열립니다. 설계: [docs/design-deploy.md](docs/design-deploy.md).

### 납품 전 보안약점 점검 (`check_egovframe_secure_coding`)

감리 대상 사업은 「소프트웨어 개발보안 가이드」(행정안전부·KISA, 2021)의 구현단계 보안약점 49개를 지켜야 하고, 납품 전 진단에서 지적된 항목은 재작업이 됩니다. 이 도구는 그중 정적 패턴으로 근거 있게 찾을 수 있는 항목을 먼저 찾아 진단 전에 고칠 목록을 만듭니다(데이터 흐름 분석이 아닌 패턴 기반 진단 보조 — 공인 진단을 대체하지 않습니다).

```text
check_egovframe_secure_coding(projectDir)                                            # 등급·항목·출처별 요약 + 상위 40건
check_egovframe_secure_coding(projectDir, format="json")                             # 전체(지문 포함) — 다음 비교의 baseline
check_egovframe_secure_coding(projectDir, baselinePath="reports/secure-prev.json")   # 새로 생긴 것만 🆕
check_egovframe_secure_coding(projectDir, sarifPath="egovframe-secure.sarif", overwrite=true)   # SARIF 2.1.0
```

| 가이드 항목 (규칙) | 찾는 것 | 걸러 내는 것 |
|---|---|---|
| SQL 삽입 (`sql-mybatis-dollar`·`sql-ibatis-dollar`·`sql-jdbc-concat`) | 매퍼의 `${…}`·`$…$`, JDBC 호출의 문자열 연결 | XML 주석, 스프링 설정의 `${Globals…}`, `?` 바인딩 — ORDER BY 다음의 `${}` 는 중간(허용 목록 검증 안내) |
| 크로스사이트 스크립트 (`xss-jsp-request`·`xss-jsp-el-param`·`xss-cout-unescaped`) | `<%= request.getParameter %>`, 본문·HTML 속성의 `${param.x}`, `<c:out escapeXml="false">` | `<c:out>`·`fn:escapeXml`, `<c:if test>`·`<spring:message code>` 같은 태그 속성, 상수 값, JSP 주석 |
| 경로 조작·URL 자동접속·운영체제 명령어·XML 외부개체 | 요청 파라미터로 만든 파일 경로·리다이렉트, 명령 실행(같은 줄에 요청 값이면 높음), 보호 설정 없는 XML 파서 | 고정 경로, `disallow-doctype-decl` 등 보호 설정이 있는 파일 |
| 취약한 암호·부적절한 난수·하드코드된 중요정보·쿠키 | MD5·SHA-1·DES·ECB(`"AES"` 단독), 보안 문맥의 `Random`, 코드·설정·docker-compose 의 평문 비밀번호, HttpOnly·Secure 없는 쿠키 | `ENC(…)`·`${…}`·숫자·가림·자리표시자, 파라미터 이름·경로 상수, 메시지 번들 |
| 오류 정보노출·오류상황 대응 부재·역직렬화·디버그 코드 | `printStackTrace()`, 빈 `catch`(주석만 있어도), `ObjectInputStream.readObject`, `System.out` | 로그 처리한 catch |

- **출처**: 공통컴포넌트 매니페스트의 해시로 "원본(업그레이드·예외·upstream 보고)"과 "수정본(직접 수정)"을 나누고, 매니페스트 없이 복사된 공통컴포넌트는 재조립을 안내합니다. 같은 규칙으로 공식 공통컴포넌트 v4.3.2 는 516건(중간 314), **v5.0.7 은 38건**(중간 16)입니다.
- **예외**: `.egovframe-secure-ignore.json` 에 `{"ignores":[{"rule":"debug-code","path":"src/main/java/egovframework/com/**","reason":"upstream 원본, 업그레이드 대기","reviewer":"홍길동"}]}` — 사유·검토자가 없는 항목은 적용하지 않고 목록으로 돌려줍니다.
- **CI**: `npx -y egovframe-scaffold-mcp secure --project . --sarif-path egovframe-secure.sarif --overwrite --fail-on high`, 또는 `generate_egovframe_ci(supplyChain=true, secureCoding=true)` 게이트 단계(GitHub 는 code scanning 에 SARIF 업로드). 평가서 4절에 요약이 나오며 등급 산식에는 넣지 않습니다. 설계: [docs/design-secure-coding.md](docs/design-secure-coding.md).

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

### reassemble_egovframe_components 파라미터 (공통컴포넌트 재조립)

- `projectDir` — 대상 프로젝트(허용 root 적용)
- `components` — 재조립할 컴포넌트 id(그룹 id 는 하위로 펼침). 미지정 시 `diagnose_egovframe_project` 가 감지한 컴포넌트 전부
- `sourceTag` — 원본 태그(기본 `auto`: 프로젝트 파일의 git blob id 를 좌표 세대에 맞는 공식 태그와 대조해 일치가 가장 많은 태그), 예: `v3.10.0`
- `database` — 지정 시 컴포넌트별 DDL·DML 을 `scripts/egovframe-components/<db>/` 에 함께 생성
- `dryRun` — `true`(기본) 분류·계획만(파일 내용을 내려받지 않음) | `false` 적용, `verify` — 적용 뒤 compile 해 오류를 작업 목록 파일에 붙임
- `format` — `markdown`(기본) | `json`(`outputSchema`)

파일마다 판정은 목표와 같음(유지)·원본 그대로(교체)·사용자 수정(소스는 교체 + 원본 대비 패치 보존, 메시지·설정 조각·웹 자산은 사용자본 유지 + 목표본 참고 저장)·5.x 신규(추가)·5.x 에서 제거(백업 후 삭제, 사용자 수정이면 패치도)·원본 미확인(백업 후 교체)·사용자 추가(유지)입니다. 백업·패치·`reassemble-plan.json` 은 `migration-backup/<시각>-reassemble-*/` 에, 매니페스트는 `.egovframe-components.json` 에 남습니다. 원본 태그 비교에는 git 이 필요하고, blob 없는 bare 미러를 `EGOVFRAME_CACHE_DIR`(기본 `~/.cache/egovframe-scaffold-mcp`)에 태그당 수백 KB 로 캐시합니다. 사용자 패치를 자동으로 다시 적용하지는 않습니다(5.x 소스가 많이 바뀌어 fuzz 적용이 오히려 위험).

### rehearse_egovframe_migration 파라미터 (전환 리허설)

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

### diagnose_egovframe_network / generate_agents_md

```text
diagnose_egovframe_network()                       # 호스트 7종 전부, 호스트당 10초
diagnose_egovframe_network(hosts=["codeload.github.com"], timeoutMs=20000)
generate_agents_md(projectDir="/work/my-egov-app", dryRun=true)   # 내용만
generate_agents_md(projectDir="/work/my-egov-app", lang="en", fileName="CLAUDE.md", overwrite=true)
```

네트워크 진단은 프록시 URL 의 자격 증명을 가려서 보고하며, `NODE_TLS_REJECT_UNAUTHORIZED=0` 이 설정돼 있으면 경고합니다. 다운로드가 실패하는 다른 도구들도 오류 메시지 끝에 같은 분류와 한 줄 처방을 붙입니다(`[네트워크 timeout] … 자세한 진단: diagnose_egovframe_network`). `AGENTS.md` 의 사실 항목은 `diagnose_egovframe_project`·`migrate_egovframe_project`·빌드 도구 감지에서 오고, 규칙 항목은 이 서버의 도구가 지키는 원칙입니다.

### sync_egovframe_catalog / 컴포넌트 조립

- 카탈로그는 common-components 공식 `v5.0.7` 태그와 commit `7912e13c…`에 고정됩니다(v0.38 에서 v5.0.6 → v5.0.7, v0.39 에서 upstream 이 태그를 옮겨 `3756ab2c…` → `7912e13c…` 로 재고정).
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


## CI 에서 쓰기 (CLI 모드)

AI 클라이언트가 없는 빌드 서버에서는 같은 패키지를 명령으로 실행합니다. 인자가 없으면 MCP 서버, 명령이 있으면 그 도구를 한 번 실행하고 종료합니다.

```bash
npx -y egovframe-scaffold-mcp assess --project . --offline=false --out assessment.md --fail-on supplyChain:C
npx -y egovframe-scaffold-mcp check --project . --resolve --json --fail-on "vulnerabilities,outdated>10"
npx -y egovframe-scaffold-mcp sbom --project . --write --offline=false
npx -y egovframe-scaffold-mcp sbom-check --project . --offline=false --fail-on "minimum,newVulns"
npx -y egovframe-scaffold-mcp migrate --project . --fail-on manual
npx -y egovframe-scaffold-mcp rehearse --project . --fail-on "errors>50"
```

| 명령 | 도구 | 비고 |
|---|---|---|
| `assess` | `generate_egovframe_report(sections=["assessment"])` | 등급 지표 `migration`·`supplyChain`(예: `supplyChain:C` = C 이상이면 실패) |
| `check` | `check_egovframe_dependencies` | `outdated`·`legacy`·`replace`·`unknown`·`vulnerabilities`·`securityMissing` |
| `sbom` | `generate_egovframe_sbom` | `--write` 가 있어야 파일을 씀(기본 계획만), `--bom-format spdx-json` 이면 SPDX 2.3 |
| `bundle` | `prepare_egovframe_offline_bundle` | 인터넷 PC 용, `--output-dir` 필수, `--write` 가 있어야 받음(기본 목록만) |
| `rehearse` | `rehearse_egovframe_migration` | 사본에서 실측(원본 불변), 지표 `errors`(최종)·`automation`·`aligned`·`files`·`unlinked`·`failedSteps` |
| `secure` | `check_egovframe_secure_coding` | `high`·`medium`·`low`·`total`·`new`(baseline 대비), `--sarif-path` 로 SARIF |
| `sbom-check` | `check_egovframe_sbom` | CycloneDX·SPDX 자동 판별, `minimum`(보완 필요면 1)·`gaps`·`newVulns`·`changed`·비교 `added`·`removed`·`versionChanged`·`diffVulns`·VEX `triage`, `--write` 면 VEX 작성·갱신 |
| `migrate` | `migrate_egovframe_project` | 진단만(`--apply` 차단), `manual`·`auto`·`items` |
| `validate` · `diagnose` · `network` | 같은 이름의 도구 | `invalid`·`missing` · `issues` · `failed` |

옵션은 도구 파라미터와 같은 이름(kebab-case 가능)이고, 공통 옵션은 `--project`·`--json`(MCP `structuredContent` 와 같은 객체)·`--out`·`--step-summary`(Markdown 을 `$GITHUB_STEP_SUMMARY` 에)·`--fail-on` 입니다. 종료 코드는 **0 통과 · 2 `--fail-on` 기준 초과 · 3 실행 실패 · 64 사용법 오류**, 본문은 stdout·한 줄 요약은 stderr 입니다. 쓰기 도구(생성·조립·적용·재조립)는 CLI 에 노출하지 않습니다.

### CI 설정 생성: GitHub Actions · GitLab CI · Jenkins

`generate_egovframe_ci(projectDir, platform, supplyChain=true)` 가 세 플랫폼에 같은 빌드와 같은 게이트를 만듭니다. 게이트는 SBOM 생성(`sbom --write --offline=false`) → **최소 요소 7종 점검**(`sbom-check --fail-on minimum`, v0.43) → 전환 준비도 평가서(`assess --fail-on <failOn>`) 순서이고, CLI 의 종료 코드 2(기준 초과)·3(실행 실패)는 job 실패입니다. 보고서(`egovframe-assessment.md`·`egovframe-sbom-check.md`)와 `sbom/bom.cdx.json` 은 실패해도 보관하며, 패키지 버전은 생성 시점의 서버 버전으로 고정됩니다.

| platform | 파일 | 빌드 | 게이트 |
|---|---|---|---|
| `github`(기본) | `.github/workflows/egovframe-ci.yml` | `mvn -B verify` · `./gradlew build` | 별도 job, 등급을 PR 요약(`--step-summary`)에, upload-artifact |
| `gitlab` | `.gitlab-ci.yml` | `maven:3.9-eclipse-temurin-<JDK>`(Gradle 은 `eclipse-temurin:<JDK>`) 이미지, 로컬 저장소 캐시, JUnit 리포트 | `supply-chain` job(`needs: []`), Node 가 없으면 apt 로 설치 시도, `artifacts:reports:cyclonedx` |
| `jenkins` | `Jenkinsfile`(Declarative) | `stage('Build')` — Linux `sh`·Windows `bat` 공용 | `SBOM` → `SBOM check` → `Assessment` 단계, `post { always { archiveArtifacts } }` |

```text
generate_egovframe_ci(projectDir="/work/my-egov-app", platform="gitlab", supplyChain=true, supplier="○○기관")
generate_egovframe_ci(projectDir="/work/my-egov-app", platform="jenkins", supplyChain=true, failOn="supplyChain:C",
                      npmRegistry="https://nexus.example.go.kr/repository/npm-group/", offlineBundle="/opt/egov-bundle")
```

- v0.44: `secureCoding=true` 면 sbom-check 다음에 보안약점 점검(`secure --fail-on high`, `egovframe-secure.sarif`) 단계가 들어갑니다. GitHub 는 `security-events: write` 권한으로 code scanning 에 SARIF 를 올리며(Advanced Security 가 없는 비공개 저장소에서도 게이트가 흔들리지 않게 `continue-on-error`), GitLab·Jenkins 는 SARIF 를 아티팩트로 보관합니다.
- `npmRegistry` 는 `NPM_CONFIG_REGISTRY`(npx 가 이 서버를 받는 사내 레지스트리), `offlineBundle` 은 `EGOVFRAME_OFFLINE_BUNDLE`(러너·에이전트에서 본 번들 경로)로 들어갑니다. 값은 따옴표·`$`·줄바꿈 없는 URL·절대 경로만 허용합니다(설정 파일 주입 차단).
- 공급자 단서가 없으면(`supplier` 미지정, pom `<organization><name>` 없음) SBOM 의 주 component 공급자·작성자가 비어 `sbom-check` 단계가 실패하므로, 생성 응답이 이를 미리 알립니다.
- GitLab 이미지는 공개 Docker Hub 기준입니다. 폐쇄망에서는 사내 레지스트리의 같은 이미지(JDK + Node.js 18 이상)로 바꾸세요. Jenkins 는 Pipeline 기본 단계(`sh`·`bat`·`archiveArtifacts`)만 쓰며 에이전트에 JDK·Maven·Node.js 가 있어야 합니다.
- 생성 `.gitlab-ci.yml` 은 테스트에서 GitLab 공식 CI 스키마로 검증하고, `Jenkinsfile` 은 Declarative 구조를 단언합니다. 설계: [docs/design-cli.md](docs/design-cli.md).
- **실행 검증(v0.46, CI 통합 `test:ci-run-live`)**: 공식 web 템플릿에 `supplyChain`·`secureCoding`·`supplier` 로 만든 파일을 실제 빌드 서버에서 돌립니다. 아직 배포 전인 버전을 쓰도록 `npx -y egovframe-scaffold-mcp@<버전>` 만 같은 버전의 `npm pack` 산출물로 바꾸고 나머지는 생성 그대로입니다.

  | 플랫폼 | 실행기 | 확인 |
  |---|---|---|
  | Jenkins | 공식 `jenkins/jenkins:2.580.1-lts-jdk21` + 플러그인 56종(의존성까지 버전 고정, `test/fixtures/jenkins/plugins.txt`), Pipeline from SCM | 선언형 문법 검증(`pipeline-model-converter/validate`) 통과 → 결과 SUCCESS · Build → SBOM → SBOM check → Secure coding → Assessment · 보관 산출물 5종(CycloneDX 1.6, component 67종) |
  | GitLab | `gitlab-ci-local` 4.76.1(Docker 실행기) | build·supply-chain job 성공 · 산출물(평가서·SBOM 점검·CycloneDX·SARIF 2.1.0) · SBOM 최소 요소 "제출 가능" |


## 폐쇄망에서 쓰기 (오프라인 번들)

공공 개발 환경은 대부분 망분리라 인터넷 PC 에서 받은 자료를 반입해 씁니다. 이 서버가 실행 중에 인터넷을 쓰는 곳(공통컴포넌트 아카이브·Initializr zip 템플릿 다운로드, OSV 취약점 조회, 재조립 원본 태그 조회)을 번들 하나로 대신합니다.

```bash
# 1) 인터넷 PC — 번들 만들기(≈110MB: OSV 10 · 아카이브 45 · web 템플릿 15 · 태그 미러 37, 템플릿 12종 전부면 ≈150MB)
npx -y egovframe-scaffold-mcp bundle --output-dir ./egov-bundle --write
npx -y egovframe-scaffold-mcp bundle --output-dir ./egov-bundle --templates web,boot-web --write   # 템플릿 골라 담기

# 2) 폐쇄망 PC — 옮긴 디렉터리를 지정(MCP 클라이언트 설정의 env 에도 같은 값)
export EGOVFRAME_OFFLINE_BUNDLE=/opt/egov-bundle        # cmd: setx EGOVFRAME_OFFLINE_BUNDLE D:\egov-bundle
```

| 번들 항목 | 대신하는 것 | 검증 |
|---|---|---|
| `osv/Maven-all.zip` (OSV Maven 전체 덤프) | `offline=false` 의 OSV 조회(`check_egovframe_dependencies`·`generate_egovframe_sbom`·`check_egovframe_sbom`·평가서) | 결과에 "스냅숏 YYYY-MM-DD 기준" 표시, 30일(`EGOVFRAME_BUNDLE_MAX_AGE_DAYS`) 넘으면 경고 |
| `archives/…-7912e13ca5a0.zip` (공통컴포넌트 v5.0.7) | `add_egovframe_components`·재조립·업그레이드의 아카이브 다운로드 | 카탈로그 고정 sha256·크기·파일 수 |
| `templates/<id>.zip` (Initializr zip 템플릿) | `create_egovframe_project` 의 zip 템플릿 | 템플릿 고정 sha256·크기 |
| `origin/…git` (공식 태그 22개, 내용 포함) | 재조립·리허설의 원본 태그 식별·패치 | 원격 조회 없이 로컬 미러만 |

컨테이너 이미지는 번들에 담지 않습니다 — `generate_egovframe_deploy` 가 쓰는 기반 이미지는 `docker save`/`docker load` 나 사내 레지스트리로 반입하고 `imageRegistry` 로 지정하세요(「컨테이너·배포 산출물」 참조).

번들 파일은 쓸 때마다 manifest 의 sha256·크기와 대조하고 다르면 거부합니다. 번들에 없는 URL 은 평소처럼 네트워크로 가므로, 저장소 템플릿(`simple-backend` 등)이 필요하면 `--templates` 로 지정해 함께 담으세요. Maven 의존성 jar 는 번들에 넣지 않습니다 — 기관 Nexus·Artifactory 미러를 `settings.xml` 에 지정하세요. upstream 대조 도구(`sync_egovframe_*`)와 가이드 문서 조회는 인터넷이 필요합니다. 설계: [docs/design-offline-bundle.md](docs/design-offline-bundle.md).

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
- 동기화 레벨: 공식 v5.0.7 태그→commit, SHA-256·크기·파일 수, `sec.security`, 미매핑 경로 0건 검증 (`npm run test:catalog-sync-live`, 네트워크 필요)
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
- 프로토콜 레벨(추가): `EGOVFRAME_LANG=en` 으로 띄운 서버의 도구 34종 설명이 모두 영문이고 표에 빠진 도구가 없는지, `tools/list` 에 `title`·annotations(readOnly 13종·destructive 5종)·`outputSchema` 13종이 노출되는지 확인 (`npm run test:handshake`)
- SBOM·해석 레벨: Maven·Gradle 트리 파서(실제 출력 픽스처), `resolve=true` 의 전이 항목·경로·선언/해석 차이·실패 경로, CycloneDX 문서 구성·보강·취약점 병합·출력 경로 거부·overwrite·dryRun (`npm run test:dependencies`, `npm run test:sbom`, 네트워크 불필요); CI 통합이 공식 `egovframe-web` 템플릿을 실제 Maven 으로 해석하고 SBOM 을 생성 (`npm run test:sbom-live`)
- 오프라인 번들 레벨: Maven 버전 비교(숫자·한정자 순서·같은 표기), OSV 범위(여러 구간·fixed·last_affected), 덤프 색인(Maven 만·철회 제외·GIT 범위 무시)과 querybatch 같은 모양의 결과, 번들 만들기(dryRun·manifest 지문·고정 지문 불일치 거부·실패 시 무흔적·덮어쓰기 거부·로컬 git 원본 미러), 번들 읽기(fetch 훅·POST 제외·변조 거부·깨진 manifest), 원본 미러(태그·커밋·트리·blob, 없는 태그 안내), OSV 출처 노트와 30일 경고, 의존성 점검 연동, 네트워크 진단 처방 (`npm run test:offline-bundle`, 30단언, 네트워크 불필요); CI 통합이 실제 번들을 만들고 로컬 OSV 와 온라인 OSV 를 대조(97% 이상 일치 요구, 실측 100%)한 뒤 fetch 를 막고 생성·조립·재조립 미리보기·SBOM 재점검을 번들만으로 확인 (`npm run test:bundle-live`)
- 전환 리허설 레벨: pom 맞춤(parent 추가·교체, 누락 좌표, 버전·scope, parent 관리 속성, 주석·dependencyManagement·plugin 제외, 멱등), 누락 패키지·연쇄·수동 항목 분류와 후보 좌표, Maven fork 형식·경고 제외 파서, 사본 제외 규칙·원본 지문 불변, 단계 순서(재조립 → 적용 → 컴파일 → pom 맞춤 → 컴파일)·javac 상한 해제 인자, 단계 실패 계속, 기록과 평가서 6절 (`npm run test:rehearse`, 38단언, 네트워크 불필요); CI 통합이 공식 공통컴포넌트 v4.3.2 전체 트리를 실제로 리허설해 재조립·적용 수와 오류 6,003(±10%, 누락 패키지·연쇄 95% 이상)→≤5 를 단언 (`npm run test:rehearse-live`)
- 5.x 최신 유지 레벨: 규칙 데이터(버전·근거 태그 commit·parent 2종 × 3버전·변경 11건), pom·Gradle 계획(속성 참조·비 RTE 좌표 불변, 예전 parent 기본값만 바꾸고 의도한 고정값 보존), 변경 클래스 참조 탐지(접두어만 같은 클래스·와일드카드 import), 구간(target 5.0.1, 실효 버전 5.0.1), 3.x 거부, dryRun 무기록·fault-injection 롤백·적용·백업·재진단, 가짜 runner verify 의 오류 ↔ 변경 항목 연결, `alignPom`, 평가서 2절, outputSchema, MCP `tools/call`(target=5.0.2·잘못된 target·기본 5.x) (`npm run test:update`, 55단언, 네트워크 불필요). 공식 web·boot-web 의 갱신 → JDK 17 compile·기준 미만·공급망 등급 실측 고정과 alignParent 생성은 CI 통합 `test:update-live`
- CI 실행 레벨: 생성 `Jenkinsfile` 을 공식 Jenkins LTS·고정 플러그인에서 선언형 문법 검증 후 실행(SUCCESS·5단계·보관 산출물), 생성 `.gitlab-ci.yml` 을 gitlab-ci-local 로 실행(두 job·산출물·SARIF·최소 요소) (`npm run test:ci-run-live`, CI 통합, Docker 필요)
- 배포 산출물 레벨: 분석(Classic war·Boot jar·Gradle 배치·Boot `server.port`·context-path·actuator 프로브·Servlet 6.1 → Tomcat 11·`Globals.<type>.Url`/`Globals.Url`/`spring.datasource.url`·DB 별칭·초기화 SQL 선택·지원 안 함 3종), Dockerfile(멀티 스테이지·캐시 마운트·5xx 재시도·WAR 풀기·비루트·HEALTHCHECK·레지스트리 ARG·미리 빌드), 생성 `docker-compose.yml` 의 공식 Compose 스키마(compose-spec 고정물) 통과·DB 컨테이너·초기화 순서·설정 볼륨, Kubernetes(보안 설정·프로브·ConfigMap/Secret 분리·Classic Secret subPath·Ingress), 입력 주입 거부·새 파일만·부분 충돌 시 무기록 (`npm run test:deploy`, 49단언, 네트워크 불필요). 실제 빌드·기동·compose 는 CI 통합 `test:deploy-live`(hadolint·kubeconform 포함)
- 작업공간 레벨(v0.47, `test:workspace` 55단언): Maven 모듈·Gradle include·독립 프로젝트 탐지와 라이브러리·parent 상속 판정, YAML 평탄화, 모듈 parent 관리·Gradle 버전 변수·BOM parent, Gradle 변수 auto/manual 과 적용, 다중 서비스 계획(참조 치환·환경 변수 이름·브로커 계정·기동 순서·설정 저장소 사본·DB 계정·루트 컨텍스트 `-pl`), compose 공식 스키마·`$$`·k8s 키 중복 없음, `modules`, SBOM 합본, 보안약점·평가서 모듈 표.
- MSA 템플릿 레벨(v0.47, CI 통합 `test:workspace-live`): 공식 MSA 템플릿 3종의 모듈 수·라이브러리 수·모듈별 의존성(버전 없음 0)·5.x 최신 유지·보안약점·평가서 모듈 표, 생성 compose(공식 스키마·`docker compose config`)·kubeconform·hadolint, `msa-common-components` 5.0.2 갱신 → 루트 `mvn package` → compose 기동(ConfigServer·EurekaServer·GatewayServer·EgovBoard·MySQL·RabbitMQ healthy, Eureka 등록, Gateway health UP).
- 보안약점 점검 레벨: 규칙 20종 데이터 검증(가이드 7개 유형·항목·CWE·컴파일), Java·XML·JSP 주석 제거(문자열·텍스트 블록 보존, HTML 주석 안 EL 유지), 규칙마다 양성·음성 픽스처(오탐 방지 사례 — `<c:out>`·커스텀 태그 속성·`fn:escapeXml`·상수 c:out·`ENC()`·자리표시자·파라미터 이름·보호 설정 있는 XML 파서 등), ORDER BY 강등·요청 값 동반 승격·보안 문맥 난수, 출처(매니페스트 원본·수정본·매니페스트 없음), 예외 파일(사유·검토자 없으면 미적용), baseline(JSON·SARIF, 줄 이동에도 같은 항목), SARIF 2.1.0 OASIS 공식 스키마(테스트 고정물) (`npm run test:secure-coding`, 52단언, 네트워크 불필요). 공식 공통컴포넌트 v3.10.0·v4.3.2 의 규칙별 건수는 회귀 코퍼스 기대값(±1%), 공식 템플릿은 CI 통합 `test:secure-live`(Initializr 고정 템플릿은 단언, 저장소 브랜치 템플릿은 drift 로그)
- SPDX 레벨: 실제 플러그인 출력 고정물을 SPDX 2.3 으로 바꿔 공식 spdx-spec v2.3 스키마 통과, 패키지 68·`DEPENDS_ON` 간선 수 = CycloneDX 의존 간선·의존 없음 `NONE`·체크섬·라이선스(LicenseRef)·DESCRIBES, 되읽었을 때 최소 요소 요소별 충족 수·purl·의존 간선·기준 판정(annotations)·취약점(advisory) 보존, 다른 도구 모양 SPDX(`DEPENDENCY_OF`·`NOASSERTION`·여러 DESCRIBES·Person/Organization/Tool)의 필드 대응, `bomFormat="spdx-json"` 생성·SPDX 입력 점검(형식 판별·CycloneDX 와 같은 판정·SPDX↔CycloneDX 비교 차이 0·VEX 거부)·outputSchema (`npm run test:spdx`, 43단언, 네트워크 불필요). 실제 Maven SBOM 의 SPDX 판정 일치는 CI 통합 `test:sbom-live` 가 확인
- SBOM 운영 레벨: 실제 플러그인 출력 고정물(공식 web 템플릿 67 component)로 최소 요소 7종(빠진 항목별)·공급자 표 보완·purl 재판정·가짜 OSV(새/사라진 ID)·비교(추가·제거·버전·판정·취약점)·VEX 생성/판단 보존/같은 ID 의 새 영향 component·깨진 VEX 중단을 단언하고, 생성 SBOM·VEX 를 CycloneDX 1.6 공식 JSON 스키마(specification 1.6.1)로 검증 (`npm run test:sbom-check`, 54단언, 네트워크 불필요); CI 통합이 실제 SBOM 으로 보완 필요(주 component 공급자·작성자) → supplier·author 로 보완(환경에 따른 다른 공백은 `info:` 로그), 두 SBOM 비교 차이 0, 실제 OSV VEX 초안·판단 보존을 확인 (`npm run test:sbom-live`)
- 메타데이터·구조화 출력 레벨: `TOOL_META` ↔ 등록 도구 일치, 읽기 전용·파괴·네트워크 힌트 배정, 영문 title, 7종 도구의 실제 결과(진단·검증·전환 진단/적용·의존성·네트워크·리포트, 빈 프로젝트 포함)가 `outputSchema` 를 통과하고 최상위 키가 전부 선언돼 있으며 잘못된 값은 거부 (`npm run test:output-schemas`, 47단언, 네트워크 불필요). MCP 프로토콜 경유 호출 시 SDK 가 `structuredContent` 를 스키마로 검증합니다
- 테스트 이식성 레벨: `scripts/check-test-portability.mjs` 가 `test/*.mjs` 에서 Windows 에서 깨지는 가정(정규화 없는 `path.relative` 비교, `./mvnw` 리터럴 기대값, POSIX 절대 경로)을 찾아 실패시킵니다(`npm run check:portability`, 게이트 포함, 의도된 줄은 `// portability: ok <사유>`). 플랫폼 분기 함수(`resolveCommand`·`collectAgentsFacts`)는 `platform` 주입으로 linux·win32 양쪽을 단언합니다
- 문서 검색 레벨: `search_egovframe_docs`의 키워드 매칭·점수 정렬·컴포넌트 매핑·빈질의/미존재어 처리 검증 (`npm run test:docs`, 네트워크 불필요)
- 리포트 레벨: 픽스처로 `generate_egovframe_report`의 컴포넌트·테이블·가이드 링크 렌더링 검증 (`npm run test:report`, 네트워크 불필요)
- 평가서 레벨: 등급 산식 경계(구간·등급)와 리포트 숫자로의 재계산, 3.x(공통컴포넌트 소스·교체 라이브러리·http 저장소·벤더)·4.x 소형·5.x parent 픽스처의 절별 내용과 등급(5.x 는 전환 범위 0·A), OSV 조회·실패 시 취약점 요인, SBOM 요약·깨진 파일, 절 조립·중복 제거, `outputPath` 저장·dryRun·기존 파일/프로젝트 밖/절대 경로/symlink/.md 아님 거부, `structuredContent` 스키마 (`npm run test:assessment`, 55단언, 네트워크 불필요). CI 통합이 공식 5.x 템플릿 2종에서 전환 A 를 확인 (`npm run test:dependencies-live`)
- CLI 레벨: 인자 해석(`--x`·`--x=v`·`--no-x`)·스키마 형 변환·모르는 옵션, `--fail-on` 등급·임계값·오류, 종료 코드 0/2/3/64, 쓰기 옵션 차단, `--json` = 라이브러리 결과, `--out`·`--step-summary`, 실제 프로세스(인자 유무로 서버/CLI) (`npm run test:cli`, 32단언, 네트워크 불필요). CI 생성 레벨에 공급망 게이트 job·`failOn` 주입 거부 추가(`npm run test:ci`), CI 통합에서 생성 워크플로를 `actionlint` 로 검사하고 4.3.2 코퍼스 트리로 CLI 평가서를 실행해 job 요약에 등급을 남깁니다
- 재조립 레벨: 메모리 원본 저장소로 원본 태그 식별(세대 후보·지정·없는 태그), 8가지 판정(CRLF 체크아웃 포함)·처리, dryRun 무기록, 적용 후 파일·백업·자산 참고본·패치(원문 바이트 보존)·매니페스트·계획 파일, `validate` 누락 0, 매니페스트 관리 컴포넌트 거부, fault-injection rollback, 목표 내용 blob 불일치 거부, verify 오류 연결 (`npm run test:reassemble`, 46단언, 네트워크 불필요). CI 통합이 공식 v3.10.0 트리의 `cmm`·`bbs` 를 고친 픽스처를 실제 git 원본·sha256 검증 아카이브로 재조립해 v5.0.7 tree 일치·패치·`validate`·`upgrade` 변경 0 을 확인 (`npm run test:reassemble-live`)
- 회귀 코퍼스 레벨: 공식 공통컴포넌트 v3.10.0·v4.3.2 부분 트리(커밋 고정, sparse 클론, 캐시)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 기대값과 ±1% 안인지, 세대 판정·확인 필요 클래스 0·기준 없음은 `xerces` 뿐·계획=자동 전부·재조립 권고·등급 D/D·60초 미만을 단언 (`npm run test:migrate-corpus`, 20단언, git·네트워크 필요, CI 통합). 기대값 갱신은 `npm run generate:migration-corpus`(`--check` 는 차이만)
- 업그레이드 레벨: 3-way 판정 6분류(unchanged/update/user-modified/conflict/added/removed)·v1 보수모드·정상 적용/백업 계획·파일/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:upgrade`, 네트워크 불필요)
- 컴포넌트 설명 레벨: `explain_egovframe_component`의 의존성(직접·전이)·역의존·테이블·가이드 URL·미존재 예외 검증 (`npm run test:explain`, 네트워크 불필요)
- CI 생성 레벨: `generate_egovframe_ci`의 maven/gradle 감지·YAML·dryRun 무기록·기존 파일 거부·빌드파일 부재 예외·`jdk`·`failOn`·`supplier`·환경 변수 주입 입력 거부, 세 플랫폼 공통 게이트 명령(sbom → sbom-check → assess), 생성 `.gitlab-ci.yml` 의 GitLab 공식 CI 스키마(v19.4.1-ee 고정물) 통과, `Jenkinsfile` 의 Declarative 구조(pipeline·agent·options·stages·post, 괄호 짝, 단계 순서)·Windows 경로 이스케이프, 공급자 단서 없을 때 게이트 실패 예고 (`npm run test:ci`, 네트워크 불필요)
- CRUD 생성 레벨: 공식 wizard 그룹, Classic/Boot 분기, DB 생성키, JUnit 5, dryRun, PK·경로 검증, 충돌 시 전체 무기록 검증 (`npm run test:crud`, 네트워크 불필요)
- CRUD 컴파일 레벨: 공식 simple-backend/Boot CRUD 7파일과 web-sample/Classic CRUD 9파일 생성 → JDK 17에서 `mvn -q -DskipTests compile` (`npm run test:crud-integration`, 네트워크 필요, CI 실행)
- 안전성 레벨: 19개 도구 공통 허용 root의 미설정 호환·격리·`..` 이탈·symlink 우회·다중 root·비대상 인자 무해 6케이스와 구조화 rollback 필드를 검증합니다 (`npm run test:allowed-roots`, `npm run test:transaction`, 네트워크 불필요).

## 현재 지원 범위와 알려진 제약

- 공통컴포넌트 실행 자산과 Maven 좌표 탐지는 지원합니다. 기존 `pom.xml`·`web.xml`의 구조적 노드 병합은 프로젝트별 dependency management·설정 경로를 보호하기 위해 자동 수행하지 않습니다.
- 카탈로그는 공식 v5.0.7 태그·commit·archive 지문에 고정됩니다. 최신 main 변경은 `sync_egovframe_catalog(ref="main")` 결과를 검토한 뒤 생성 스크립트로 승격합니다.
- `build_egovframe_project`·`test_egovframe_project`는 로컬에 설치된 JDK와 maven/gradle(또는 프로젝트 래퍼)을 사용합니다. DB 등 외부 의존성이 필요한 테스트는 그 환경이 준비되지 않으면 오류(error)로 집계됩니다.
- 자바 패키지 구조 변경(groupId에 맞춘 소스 디렉터리 이동)은 미지원입니다. 현재는 IDE rename refactoring을 권장합니다.
- `migrate_egovframe_project` 의 적용은 진단이 `auto` 로 표시한 항목만 치환합니다. 정적 텍스트 스캔이므로 리플렉션·문자열 조립으로 만든 클래스명, 프로젝트 밖 라이브러리 안의 `javax` 사용, Spring Security 6·Hibernate 6 등 라이브러리 자체의 API 변경으로 인한 코드 수정 범위는 보고하지 않습니다(라이브러리 단위로 `manual` 안내만 합니다).
- 템플릿·컴포넌트·가이드 원본을 받을 때 GitHub(`codeload.github.com`, `raw.githubusercontent.com`, zip 조달 템플릿은 `media.githubusercontent.com`) 네트워크 접근이 필요합니다.

## 로드맵

v0.31.0까지 프로젝트·CRUD 생성, 검증된 공통컴포넌트 실행 자산 조립, 안전성 기반(테스트 판정 강제·사용자 파일 보호·전 도구 트랜잭션·허용 root·구조화 rollback 보고), 생성→검증 루프(실제 빌드·오류 구조화·테스트 리포트 구조화), 공식 템플릿 카탈로그 단일화와 커버리지 확대(22종 중 21종), 설정 파일 생성, 5.x 전환(진단·적용), 의존성 점검, 운영 편의(네트워크 진단·AGENTS.md·영문 설명·레지스트리 메타데이터)를 완료했습니다.

v0.32–v0.34 로 MCP 프로토콜 현대화, 5.x 전환 3단계(검증)와 공통컴포넌트 대응표, 의존성 기준 완성과 규칙·기준 drift 감시를, v0.35–v0.37 로 릴리스 자동화, 해석된 의존성 트리와 SBOM, 전환 준비도 평가서와 회귀 코퍼스를, v0.38–v0.40 으로 공통컴포넌트 재조립 실행, CLI 모드와 CI 공급망 게이트, SBOM 운영(최소 요소·비교·VEX)을, v0.41–v0.43 으로 전환 리허설, 폐쇄망 오프라인 번들, GitLab·Jenkins CI 와 SPDX 를 마쳤습니다(기획 원문과 결과: [v0.41–v0.43](#이전-기획-v041v043-완료) · [v0.38–v0.40](#이전-기획-v038v040-완료) · [v0.35–v0.37](#이전-기획-v035v037-완료)). v0.44–v0.46 으로 보안약점 점검, 컨테이너·배포 산출물, 5.x 최신 유지와 생성 CI 실행 검증을 마쳤습니다([v0.44–v0.46](#이전-기획-v044v046-완료)). 다음 세 버전(v0.47–v0.49)의 범위는 [다음 버전 기획](#다음-버전-기획-v047v049)에 있습니다. Homebrew 탭은 후순위에서 내렸습니다(npx 로 충분).

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
| **v0.38 완료** | 공통컴포넌트 재조립 실행 | 평가서의 "재조립 권고"를 실행하는 `reassemble_egovframe_components`: 3.x/4.x 소스의 원본 태그를 지문으로 찾아 3-way 비교(원본·현재·5.0.7) → 공통컴포넌트 최신 v5.0.7(`7912e13`) 로 조립 + 사용자 수정은 패치·작업 목록으로 보존, 매니페스트 생성(이후 upgrade·validate 적용), dryRun·transaction·compile 검증 |
| **v0.39 완료** | CLI 모드 + CI 공급망 게이트 | `npx egovframe-scaffold-mcp <assess\|check\|sbom\|migrate\|validate>` — AI 클라이언트 없이 CI·배치에서 같은 분석을 실행(JSON/Markdown, `--fail-on` 등급·판정 임계값, 종료 코드), `generate_egovframe_ci` 의 공급망 게이트 단계(평가서·SBOM 아티팩트), SDK 1.32(프로토콜 2025-11-25) |
| **v0.40 완료** | SBOM 운영: 최소 요소·비교·VEX | `check_egovframe_sbom`: 기존 SBOM 의 최소 요소(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성시각) 충족 점검, 빌드 도구 없이 purl 로 OSV 재조회, 이전 SBOM 과 비교(추가·제거·버전 변경·새 취약점), CycloneDX VEX 초안 생성; `generate_egovframe_sbom` 에 공급자·작성자 메타데이터 — 2027년 공공 SBOM 제출 제도화 대비 |
| **v0.41 완료** | 전환 리허설 | `rehearse_egovframe_migration`: 프로젝트 사본에서 migrate apply → reassemble → JDK 17 compile 을 돌려 남는 컴파일 오류 수·분포와 "처리하면 오류가 가장 많이 줄어드는 작업" 목록을 실측(원본 불변), 평가서 등급 옆 실측 표시, CLI `rehearse` — 공식 공통컴포넌트 v4.3.2 전체 트리 기대값 고정 |
| **v0.42 완료** | 폐쇄망 운영: 오프라인 번들 | `prepare_egovframe_offline_bundle`: OSV Maven 덤프·고정 컴포넌트 아카이브·Initializr zip·원본 태그 미러 + sha256 manifest, `EGOVFRAME_OFFLINE_BUNDLE` 로 모든 다운로드·OSV 조회를 번들로 대체(스냅숏 기준일 표시·오래됨 경고) |
| **v0.43 완료** | CI·제출 형식 다변화 | `generate_egovframe_ci(platform=gitlab\|jenkins)`(GitLab 공식 스키마 통과·Declarative Jenkinsfile)와 세 플랫폼 게이트에 `sbom-check --fail-on minimum`, 사내 npm 레지스트리·오프라인 번들 변수, SBOM SPDX 2.3 JSON 출력·점검(공식 spdx-spec v2.3 스키마, 실제 Maven SBOM 에서 CycloneDX 와 판정 일치) |
| **v0.44 완료** | 보안약점 점검 | `check_egovframe_secure_coding`: 행안부·KISA 개발보안 가이드 구현단계 보안약점 중 정적 패턴 항목(SQL 삽입·XSS·경로 조작·XXE·약한 암호·하드코드 정보·오류 노출 등)을 데이터 규칙으로, 공통컴포넌트 출처 구분, SARIF 2.1.0·CI 게이트·평가서 4절 |
| **v0.45 완료** | 컨테이너·배포 산출물 | `generate_egovframe_deploy`: Classic war(Tomcat 10.1)·Boot jar 멀티 스테이지 Dockerfile, DbType 별 docker-compose, Kubernetes 매니페스트, 폐쇄망 레지스트리 — hadolint·kubeconform·실제 빌드·기동 검증 |
| **v0.46 완료** | 5.x 최신 유지 + CI 실행 검증 | `migrate_egovframe_project(target="5.0.2")`: parent·RTE 버전 auto, 바뀐 RTE API·동작 참조 manual(규칙 `catalog/update-rules.json`), `create(alignParent=true)`, 평가서 2절 — 공식 web·boot-web 갱신 후 compile·기준 미만 감소·등급 C → B. 생성 `Jenkinsfile`(Jenkins LTS·고정 플러그인)·`.gitlab-ci.yml`(gitlab-ci-local) 실제 실행 검증 |
| **v0.47 완료** | 멀티 모듈·MSA 대응 | 공식 MSA 템플릿 3종(Maven 11 모듈·Gradle 독립 10·9)의 모듈 탐지, 의존성(0 → 280·256건)·SBOM·5.x 최신 유지·보안약점·평가서 모듈별 판정, 다중 서비스 compose·Kubernetes, `msa-common-components` 실제 기동(Eureka·Gateway UP) |
| **v0.48 계획** | 납품 패키지 | 새 도구 `prepare_egovframe_delivery`(35종): 평가서·SBOM·VEX·보안약점·배포 검증을 한 묶음 + sha256 manifest·목차·이전 차수 비교, `deliver --verify` |
| **v0.49 계획** | 응답 영문화 + 진행 알림 | `--lang en` 응답 본문·규칙 사유 영문, 장시간 도구의 MCP 진행 알림과 취소 시 정리 |

## 다음 버전 기획 (v0.47–v0.49)

v0.46.0 까지 끝난 상태(2026-10-16, 도구 34종 + CLI 명령 11종, npm 0.46.0 자동 배포)에서 다음 세 릴리스를 아래 순서로 진행합니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 문서·저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **실제 사업 구조로 넓히기** 입니다 — 지금까지 단일 프로젝트를 기준으로 만든 도구를 공식 MSA 템플릿 같은 멀티 모듈·다중 서비스 구조에 적용하고(v0.47), 각 도구의 결과를 감리·검수에 내는 한 묶음의 납품 패키지로 모으며(v0.48), 영문 응답과 장시간 도구의 진행 보고로 운영 환경을 넓힙니다(v0.49). 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-16)"에 있습니다.

### v0.47.0 — 멀티 모듈·MSA 프로젝트 대응

**목표**: 공식 MSA 템플릿 3종은 지금 도구에서 대부분 비어 보입니다. Gradle 독립 프로젝트 묶음인 `msa-edu`(백엔드 10개)·`msa-portal-backend`(9개)는 루트에 빌드 파일이 없어 의존성 점검이 0건이고, 5.x 최신 유지는 Gradle 의 `egovframeBootParentVersion` 변수(18개 프로젝트 모두 5.0.0)를 읽지 못해 버전을 미검출로 봅니다. Maven 멀티 모듈인 `msa-common-components`(11 모듈)는 배포 산출물 생성이 "멀티 모듈 — 범위 밖"으로 거부됩니다. 공공 클라우드 전환 사업이 MSA 구조를 쓰는 만큼, 모듈 구조를 알아보고 모듈별로 같은 판정을 내리게 합니다.

**범위 (포함)**
- **작업공간 탐지(`src/workspace.ts`)**: Maven `<modules>`(재귀), Gradle `settings.gradle(.kts)` 의 `include`, 빌드 파일 없는 루트 아래의 독립 프로젝트(`backend/*`·`msa-*`)를 모듈 목록(경로·빌드 도구·packaging·Boot 여부·자체 Dockerfile 유무·라이브러리 모듈 여부)으로 만듭니다.
- **의존성 점검·SBOM**: 모듈별 판정과 합산(결과에 모듈 열), `resolve=true` 도 모듈별로 실행합니다. Gradle 의 `set('…Version', …)`·`ext` 버전 변수를 읽고, SBOM 은 모듈별 문서와 합본(CycloneDX 주 component 아래 모듈 component)을 냅니다.
- **5.x 최신 유지**: Gradle 버전 변수(`egovframeBootParentVersion`)를 parent 버전과 같은 auto 항목으로 다룹니다. Maven 모듈 parent 는 이미 처리되므로(실측 11건) 모듈별 요약만 더합니다.
- **배포 산출물**: 서비스 모듈마다 이미지(자체 Dockerfile 이 있으면 그대로 쓰고 없으면 생성)와 하나의 `deploy/docker-compose.yml`·서비스별 Kubernetes 매니페스트를 만듭니다. Spring Cloud 구성(config → discovery → gateway → 서비스)은 헬스체크 기반 기동 순서를 줍니다. 라이브러리 모듈(`egovframe-cloud-module-common` 등)은 이미지에서 뺍니다.
- **평가서·보안약점**: 모듈별 표를 더합니다(등급 산식은 전체 합산 그대로).
- 각 도구에 선택 파라미터 `modules`(모듈 일부만) — 도구 수는 그대로입니다.

**범위 (제외)**: 프론트엔드(React) 이미지, 서비스 메시·Helm 차트, 모듈 간 순환 의존 해소, 템플릿에 이미 있는 k8s 매니페스트(`msa-edu/k8s`, 80개) 수정

**검증 기준**: 공식 `msa-common-components`·`msa-edu`·`msa-portal-backend` 에서 모듈 수와 모듈별 의존성 판정 수(실측 고정, 0건이던 두 템플릿 포함), 5.x 최신 유지가 Gradle 18개 프로젝트의 5.0.0 을 auto 로 보고하고 적용 뒤 한 서비스가 compile, 생성 compose 가 공식 Compose 스키마·`docker compose config` 를 통과하고 매니페스트가 kubeconform 을 통과, CI 통합에서 `msa-common-components` 를 빌드해 ConfigServer·EurekaServer·GatewayServer·EgovBoard 를 compose 로 띄워 health UP(DB 는 템플릿의 MySQL compose 사용)

**완료 정의**: 도구 34종(변화 없음), `docs/design-workspace.md`(모듈 탐지 규칙·도구별 동작), README 각 도구 절에 `modules`

**결과 (2026-10-16 완료)**: 작업공간 탐지·모듈별 판정·다중 서비스 배포 산출물을 넣었습니다. 공식 템플릿 실측 — `msa-common-components`(Maven 11 모듈, 라이브러리 0): 의존성 373건·버전 없음 152 → 0, 최신 유지 자동 11(모듈 parent), kubeconform 40개 리소스 통과, compose 로 4개 서비스 + MySQL·RabbitMQ healthy·Eureka 에 GATEWAYSERVER·EGOVBOARD UP·Gateway health UP. `msa-edu`(Gradle 독립 10, 라이브러리 1): 의존성 0 → 280건, 최신 유지 자동 4·수동 6, 보안약점 89. `msa-portal-backend`(9): 0 → 256건, 자동 3·수동 6, 보안약점 16. 기획과 달라진 점: (1) Gradle 버전 변수 `egovframeBootParentVersion` 은 공식 템플릿이 직접 배포한 `egovframe-cloud-module-common`(저장소에 5.0.0 만 있음)의 버전에도 쓰여, 모두 auto 로 올리면 빌드가 깨집니다. 그래서 공식 parent·RTE 에만 쓰이는 변수만 auto 이고 나머지는 이유를 단 manual 입니다("18개 프로젝트 auto" 대신). 같은 이유로 Gradle 서비스의 갱신 뒤 compile 은 검증 기준에서 빼고 Maven 템플릿의 실제 빌드·기동으로 대신했습니다. (2) 선택 파라미터 `modules` 는 산출물을 고르는 `generate_egovframe_deploy` 에만 넣었습니다. 점검 도구는 결과의 모듈 열로 거를 수 있어 파라미터를 늘리지 않았습니다. (3) 설정 서버가 내주는 설정은 환경 변수로 덮을 수 없어(원격 속성 우선) native 저장소 사본(`deploy/config-repo`)을 만듭니다. 설계: [docs/design-workspace.md](docs/design-workspace.md).

### v0.48.0 — 납품 패키지 (`prepare_egovframe_delivery`)

**목표**: 감리·검수 때 내는 산출물(전환 준비도 평가서, SBOM 의 CycloneDX·SPDX, VEX, 보안약점 결과와 SARIF, 의존성 조치 목록, 배포 산출물 검증 결과, 빌드·테스트 결과)은 지금 도구마다 따로 만들고 사람이 모읍니다. 차수마다 같은 묶음을 내야 하고, 이전 차수와 무엇이 달라졌는지(새 취약점·새 보안약점·버전 변화)를 설명해야 합니다.

**범위 (포함)**
- **새 도구 `prepare_egovframe_delivery`**(35번째): `prepare_egovframe_delivery(projectDir, outputDir, include?, previousDelivery?, offline=true, zip=false, dryRun=true)`.
  - 기존 도구를 그대로 불러 산출물을 한 디렉터리에 모으고, `delivery-manifest.json`(파일별 sha256·크기·만든 도구와 버전·입력 지문·시각)과 목차 `index.md` 를 씁니다.
  - 실패한 항목은 빼지 않고 이유와 함께 목차에 남깁니다. 빌드 도구가 없거나 오프라인이라 못 만든 것도 그렇게 적습니다.
  - `previousDelivery` 를 주면 이전 묶음과 비교한 절(SBOM 추가·제거·버전, 새 OSV ID, 새 보안약점 지문, 등급 변화)을 만듭니다.
  - 새 디렉터리에만 씁니다(오프라인 번들과 같은 방식). `zip=true` 면 같은 내용을 zip 으로 냅니다.
- **검증 명령**: `--verify` 로 받은 쪽이 manifest 지문을 다시 계산해 변조 여부를 봅니다(CLI `deliver`·`deliver --verify`).
- **CI 게이트**: `generate_egovframe_ci(delivery=true)` 가 납품 패키지를 아티팩트로 남기는 단계를 더합니다.

**범위 (제외)**: 전자서명·타임스탬프(기관 인증서 필요), 산출물 양식(기관별 서식) 변환, 원격 제출

**검증 기준**: 공식 web 템플릿 패키지 생성 → manifest 재검증 통과, 같은 입력으로 두 번 만든 패키지 비교 차이 0(시각 제외), 의존성 하나를 내린 사본과 비교하면 그 차이만 검출, 파일 하나를 바꾸면 `--verify` 실패, dryRun 무기록·중간 실패 무흔적, 오프라인 번들 모드(`EGOVFRAME_OFFLINE_BUNDLE`)에서 OSV 포함 생성

**완료 정의**: 도구 35종, `docs/design-delivery.md`, README 「납품 패키지」 절

### v0.49.0 — 응답 영문화 + 장시간 도구 진행 알림

**목표**: 영문 도구 설명(v0.31)은 있지만 응답 본문(평가서·전환·의존성·SBOM 점검·보안약점·배포 결과)은 한국어뿐입니다. 해외 협력사·영문 클라이언트에서 쓰기 어렵습니다. 또 리허설·오프라인 번들·`resolve=true` 점검·빌드처럼 수 분 걸리는 도구가 끝날 때까지 아무 보고가 없어, 클라이언트가 멈춘 것인지 알 수 없습니다.

**범위 (포함)**
- **응답 영문화**: `EGOVFRAME_LANG=en`·CLI `--lang en` 이 Markdown 응답의 라벨·헤더·안내문까지 영문으로 바꿉니다.
  - 렌더러마다 문자열을 사전(`src/i18n/*.ts`)으로 옮깁니다.
  - 규칙 데이터의 사유(전환 제거 클래스·5.x 변경·보안약점·배포 안내)는 `reason_en` 필드를 더합니다. 큐레이션 파일에 함께 적고, 생성기가 빠진 것을 실패시킵니다.
  - 구조화 출력(`structuredContent`)의 키는 그대로이고, `reason` 등 문장 필드만 언어를 따릅니다.
- **진행 알림**: MCP `notifications/progress`(안정 기능)를 씁니다. 클라이언트가 `progressToken` 을 주면 리허설·재조립·오프라인 번들·SBOM·`resolve=true` 점검·빌드·테스트·납품 패키지가 단계별 진행을 보고합니다.
- **취소**: `notifications/cancelled` 를 받으면 자식 프로세스 트리를 끝내고 transaction 을 되돌립니다(이미 있는 타임아웃 종료 경로 재사용).
- `tasks`(비동기 실행)는 SDK 에서 안정 API 가 되면 같은 버전에서 판단합니다. 아니면 보류를 유지합니다.

**범위 (제외)**: 그 밖의 언어, 공식 문서 검색 결과(원문 한국어)의 번역

**검증 기준**: 영문 모드에서 대상 렌더러 출력에 한글이 없음(고유명사·원문 인용 제외 목록으로 단언), 한국어 출력은 바이트 단위로 이전과 같음, 규칙 데이터의 `reason_en` 누락 0, 진행 알림 순서·단계 수 단언, 취소 시 자식 프로세스가 남지 않고 파일이 작업 전 상태(Windows 포함)

**완료 정의**: 도구 35종(변화 없음), README.en 에 영문 응답 예시, `docs/design-i18n.md`

### 보류·운영 항목

- **MCP `tasks`**: SDK 1.32.1(최신, 2026-10-05)에서도 `experimental/tasks` 아래에 있습니다. v0.49 에서 다시 확인합니다.
- **Initializr upstream**: 템플릿 parent 5.0.0·5.0.1 문제(v0.46 의 `alignParent` 가 우회)를 포함한 기존 4건은 upstream 이슈로 제출할 가치가 있습니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.
- **브랜치 보호**: v0.46 에서 운영 절차를 [브랜치 보호](#브랜치-보호-소유자-1회)로 확정했습니다. 적용했는지 확인하고 이 항목을 지웁니다.

### 선행 조사 결과 (2026-10-16)

- **upstream 태그**: 2026-10-12 이후 새 태그 없음 — `egovframe-runtime` v5.0.2-Final, `egovframe-common-components` v5.0.7, `egovframe-vscode-initializr` v5.0.6·`main` `bc18641`, `egovframe-development` v5.0.2, `egovframe-ai-rag` v5.0.0. 공식 parent 최신 5.0.2(5.0.3 없음).
- **공식 MSA 템플릿 구조**:
  - `msa-common-components`: Maven 루트 pom + 모듈 11개(ConfigServer·EurekaServer·GatewayServer + 서비스 8), 모듈 parent `egovframe-boot-starter-parent` 5.0.1, 자체 Dockerfile 없음, MySQL·Redis compose 만 있음.
  - `msa-edu`: 루트 빌드 파일 없는 Gradle 독립 프로젝트 `backend/*` 10개(서비스 9 + 공통 라이브러리), 서비스마다 Dockerfile, k8s 매니페스트 80개.
  - `msa-portal-backend`: 같은 구조로 9개.
  - 두 Gradle 템플릿의 18개 프로젝트 모두 `set('egovframeBootParentVersion', '5.0.0')`·`springCloudVersion` 2025.0.0 · Spring Boot 플러그인 3.5.6 입니다.
- **지금 도구의 결과(실측)**

  | 템플릿 | 의존성 점검 | 5.x 최신 유지 | 배포 산출물 | 보안약점 |
  |---|---|---|---|---|
  | `msa-common-components` | findings 373(기준 충족 168·버전 미지정 152·기준 없음 35) | 자동 11(모듈 parent 5.0.1) | 멀티 모듈로 거부 | 8건 |
  | `msa-edu` | 빌드 도구 미검출, 0건 | RTE 미검출, 0건 | — | 89건 |
  | `msa-portal-backend` | 빌드 도구 미검출, 0건 | RTE 미검출, 0건 | — | 16건 |

- **진행 알림·영문 응답**: 서버 코드에 `notifications/progress` 송신이 없고(0건), 응답 Markdown 은 한국어만 있습니다. SDK 1.32.1 은 progress·cancellation 을 안정 API 로 제공합니다.

## 이전 기획 (v0.44–v0.46, 완료)

v0.43.0 까지 끝난 상태(2026-10-12, 도구 32종 + CLI 명령 10종, npm 0.43.0 자동 배포)에서 다음 세 릴리스를 아래 순서로 진행했습니다. 세 버전 모두 2026-10-15 까지 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 문서·저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **납품 품질** 입니다 — 감리·보안약점 진단에서 지적되는 코드 패턴을 미리 찾고(v0.44), 공공 클라우드 전환에 맞춰 컨테이너·배포 산출물을 같은 기준으로 만들며(v0.45), 만든 5.x 프로젝트를 최신 기준으로 유지하고 생성한 CI 를 실제 빌드 서버에서 돌려 확인합니다(v0.46). 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-12)"에 있습니다.

### v0.44.0 — 보안약점 점검 (`check_egovframe_secure_coding`)

**목표**: 행정안전부·KISA 「소프트웨어 개발보안 가이드」(2021, 설계단계 20개·구현단계 49개 보안약점)는 정보시스템 감리 대상 사업에 적용되고, 납품 전 보안약점 진단에서 지적된 항목은 그대로 재작업이 됩니다. 지금 서버는 의존성·보안 설정(`sec.security`·CSRF·XSS 필터·보안 헤더)까지만 보고 **소스 코드 패턴**은 보지 않습니다. 공통컴포넌트·생성 코드·사용자 코드에서 정적 패턴으로 근거 있게 잡을 수 있는 구현단계 항목을 먼저 찾아, 진단 전에 고칠 목록을 만듭니다.

**범위 (포함)**
- 새 도구 `check_egovframe_secure_coding(projectDir, rules?, paths?, baselinePath?, format="markdown"|"json"|"sarif", outputPath?)`(33번째, 읽기 전용): 규칙은 `catalog/secure-coding-rules.json` 데이터 — 항목마다 가이드의 보안약점 이름·유형(입력데이터 검증 및 표현·보안기능·에러처리·코드오류·캡슐화·API 오용), CWE 번호, 대상 파일 종류, 패턴, 예외 조건, 심각도, 조치 예시를 둡니다. 1차 규칙(구현단계 49개 중 정적 패턴으로 오탐을 통제할 수 있는 것):
  - **SQL 삽입**: MyBatis·iBATIS 매퍼의 `${…}`(정렬 컬럼처럼 값 목록 검증이 필요한 경우를 구분해 안내), JDBC 문자열 연결 `executeQuery("…" + …)`
  - **크로스사이트 스크립트**: JSP 의 `<%= request… %>`·`${param.…}` 직접 출력, `<c:out escapeXml="false">`
  - **경로 조작**·**신뢰되지 않는 URL 리다이렉트**: `new File(request.getParameter(…))`, `sendRedirect(request.getParameter(…))`
  - **XML 외부 개체 참조(XXE)**: 외부 엔티티를 막지 않은 `DocumentBuilderFactory`·`SAXParserFactory`·`XMLInputFactory`
  - **취약한 암호화 알고리즘·해시**: `MessageDigest.getInstance("MD5"|"SHA-1")`, `Cipher.getInstance("DES…"|"…/ECB/…")`
  - **적절하지 않은 난수**: 보안 문맥(토큰·비밀번호·세션)의 `java.util.Random`
  - **하드코드된 중요정보**: 비밀번호·키 문자열 상수(테스트·예제 경로는 별도 등급)
  - **오류 메시지 정보노출**·**오류 상황 대응 부재**: `printStackTrace()`, 빈 `catch`
  - **신뢰할 수 없는 데이터의 역직렬화**: `ObjectInputStream.readObject` 직접 사용
  - **쿠키·세션 보안 속성**: `HttpOnly`·`Secure` 없이 만드는 `Cookie`, `web.xml`/Boot 설정의 세션 쿠키 속성
- 결과: 항목별 파일·라인·코드 한 줄·조치 예시, 공통컴포넌트 매니페스트로 **공통컴포넌트 출처**(upstream 원본 그대로인지·사용자 수정인지)를 표시해 "공통컴포넌트 업그레이드로 해결" 과 "직접 수정" 을 나눕니다. `baselinePath` 와 비교(새로 생긴 것만), 예외 처리 파일(`.egovframe-secure-ignore.json` — 규칙·경로·사유·검토자, 사유 없는 예외 거부).
- **SARIF 2.1.0** 출력 — GitHub code scanning(`upload-sarif`)과 GitLab 보안 리포트에 그대로 올라가게 합니다. `generate_egovframe_ci(supplyChain=true)` 게이트에 `secure --fail-on high` 단계(세 플랫폼)를 선택으로 더합니다.
- 평가서 4절(보안)에 보안약점 건수·심각도·출처 요약, 공급망 등급 산식에 반영할지는 실측 후 결정(산식 변경 시 문서화). CLI `secure`(지표 `high`·`medium`·`total`·`new`).

**범위 (제외)**: 설계단계 20개 항목(요구사항·설계 문서 대상), 데이터 흐름(taint) 분석 — 패턴 기반이며 공인 진단도구를 대체하지 않는다는 점을 결과에 명시, 자동 수정(조치 예시까지)

**검증 기준**: 규칙마다 양성·음성 픽스처(오탐 방지 사례 포함), 공식 공통컴포넌트 v3.10.0·v4.3.2 회귀 코퍼스와 공식 5.x 템플릿 2종의 규칙별 건수를 `catalog/migration-corpus.json` 에 기대값으로 고정(±1%), 공식 템플릿에서 높음 등급 0건이 아니면 근거를 README 에 기록, SARIF 출력이 OASIS SARIF 2.1.0 공식 JSON 스키마(테스트 고정물) 통과, Windows 게이트 통과

**완료 정의**: 도구 33종, `docs/design-secure-coding.md`(규칙 표·근거·오탐 통제), README 「납품 전 보안약점 점검」 절과 CI 예시(SARIF 업로드)

**결과(2026-10-13) — 완료**: `src/secure-coding.ts`(규칙 엔진·주석 제거·출처·예외·지문·SARIF)와 규칙 데이터 20종(가이드 항목 14개). 실측: 공식 공통컴포넌트 v3.10.0 495건·v4.3.2 516건(둘 다 높음 0 — 중간은 대부분 `<c:out escapeXml="false">` 302/304건, 낮음은 디버그 출력·`printStackTrace`), **v5.0.7 전체 트리 38건**(`escapeXml="false"` 6·디버그 7), 공식 web·boot-web 템플릿 0건, 저장소 템플릿은 simple-backend 11(디버그)·simple-homepage 7(`escapeXml="false"`)·portal-site 6(docker-compose·설정 평문 비밀번호)·enterprise-business 1. 계획과 달라진 점: (a) **주석 제거가 오탐 통제의 핵심**이었습니다 — 선행 조사에서 센 매퍼의 `${…}` 96건(v4.3.2)은 전부 "`${searchKeyword}` 를 `#{searchKeyword}` 로 변경" 주석이라 실제 SQL 삽입 패턴은 0 입니다. 반대로 JSP 의 HTML 주석 안 EL 은 서버에서 실행되므로 지우지 않습니다. (b) JSP 의 EL 은 **태그 속성 안이면 출력되지 않는다**는 점을 규칙(`stripCustomTags`)에 넣어 `<c:if test="${param.x}">`·`<spring:message code="${param.x}">` 오탐을 없앴고, `<c:out>` 값 안의 `'<br/>'` 때문에 170건을 놓치던 정규식을 따옴표 단위로 고쳤습니다. (c) 공급망 등급 산식에는 넣지 않았습니다 — 패턴 기반이라 확정 판정이 아니고, 공통컴포넌트 전체를 담은 트리는 이미 D 입니다. (d) GitLab 의 보안 대시보드는 SARIF 를 직접 받지 않아 아티팩트 보관으로 바꿨고, GitHub 업로드는 Advanced Security 가 없는 비공개 저장소에서도 게이트 판정을 흔들지 않게 `continue-on-error` 로 둡니다. (e) 공식 템플릿 기대값은 Initializr 고정 commit 템플릿만 단언하고, 브랜치 기준 저장소 템플릿은 차이를 로그로 남깁니다(upstream 변경 가능).

### v0.45.0 — 컨테이너·배포 산출물 (`generate_egovframe_deploy`)

**목표**: 공공 정보시스템의 클라우드 네이티브 전환이 진행되면서 표준프레임워크 프로젝트도 컨테이너 이미지와 쿠버네티스 매니페스트를 함께 납품하는 일이 늘었습니다. 지금은 사업마다 Dockerfile 을 손으로 쓰며 Classic(war)·Boot(jar)·DB 종류·`globals.properties` 설정 주입이 매번 달라집니다. 진단 결과(빌드 도구·패키징·DbType·템플릿 종류)로 같은 기준의 배포 산출물을 만듭니다.

**범위 (포함)**
- 새 도구 `generate_egovframe_deploy(projectDir, targets=["docker","compose","k8s"], jdk="17", imageRegistry?, appName?, dryRun=true)`(34번째, 새 파일만):
  - **Dockerfile**(멀티 스테이지): 빌드 스테이지(Maven/Gradle·래퍼, 의존성 캐시 레이어) → 실행 스테이지 — Classic `war` 는 `tomcat:10.1-jdk17-temurin`(Jakarta EE 9+ 를 지원하는 Tomcat 10.1, ROOT 배포), Boot `jar` 는 `eclipse-temurin:17-jre`. 비루트 사용자, `HEALTHCHECK`, 시간대(`Asia/Seoul`)·인코딩, `.dockerignore`.
  - **docker-compose**: 앱 + DbType 에 맞는 DB(mysql·mariadb·postgres; oracle·tibero·altibase·cubrid 는 외부 DB 로 연결 정보만), `globals.properties`·`application.yml` 의 DB 키를 환경 변수로 덮어쓰는 방법(템플릿별 키 표를 데이터로).
  - **Kubernetes**: Deployment(readiness·liveness 프로브, 리소스 요청·제한, 비루트 securityContext)·Service·ConfigMap·Secret(값은 자리표시자)·선택 Ingress.
  - `imageRegistry` 로 기반 이미지 레지스트리를 바꿔 폐쇄망(사내 Harbor 등)에 대응하고, 오프라인 번들 문서에 이미지 반입 절차를 더합니다.
- 템플릿 종류별 지원표: Classic web·template 4종(war), Boot web·simple-backend·batch-web(jar), 배치 commandline·scheduler(jar, Service 없음), MSA·모바일·프론트엔드 템플릿은 1차 제외(자체 배포 구성이 있거나 정적 자산)를 데이터로 두고 미지원이면 이유를 돌려줍니다.

**범위 (제외)**: Helm 차트·Kustomize 오버레이, 레지스트리 push·클러스터 배포 실행, 운영 DB 이관

**검증 기준**: 생성 Dockerfile 이 hadolint(고정 버전) 경고 0, 매니페스트가 kubeconform(쿠버네티스 1.31 공식 스키마) 통과, CI 통합에서 공식 `egov-web`(Classic war)·`egov-boot-web`(Boot jar) 템플릿으로 실제 `docker build` → 컨테이너 기동 → HTTP 200 과 HEALTHCHECK healthy, docker-compose(mysql) 기동 후 앱이 DB 에 연결, 게이트에서는 템플릿 종류별 생성 결과 구조 단언·dryRun 무기록·기존 파일 거부

**완료 정의**: 도구 34종, `docs/design-deploy.md`, README 「컨테이너·배포 산출물」 절(폐쇄망 이미지 반입 포함)

**결과(2026-10-13) — 완료**: `src/deploy.ts`(분석·렌더러)와 규칙 데이터 `catalog/deploy-rules.json`(기반 이미지·DB 서비스·외부 DB·지원 안 함). 실측: 공식 web(Classic)·boot-web(Boot) 템플릿의 Dockerfile 은 hadolint 2.14 경고 0, 매니페스트는 kubeconform 0.7(쿠버네티스 1.31) 통과, 빌드·기동 후 HTTP 200·HEALTHCHECK healthy·실행 uid 10001. 공식 simple-backend(Boot + MySQL 8.4)는 `docker compose up` 후 readiness UP·`/mainPage` 가 초기화 데이터(공지 게시물)를 돌려줘 환경 변수 주입이 동작함을 확인했고, 공식 portal-site(Classic + MySQL)는 설정 파일 덮어쓰기로 사용자 `pst`·비밀번호 `CHANGE_ME` 로 연결돼 메인 페이지가 열렸습니다. 계획과 달라진 점: (a) **Classic 의 DB 설정은 환경 변수로 덮을 수 없었습니다** — Classic 템플릿은 `EgovProperties` 가 `globals.properties` 를 직접 읽어서, WAR 를 이미지 안에서 풀어 두고 설정 파일 사본을 볼륨·Secret 으로 덮어쓰는 방식으로 바꿨습니다(Boot 템플릿은 Spring `Environment` 로 읽어 환경 변수가 그대로 동작). (b) Classic 템플릿의 키는 `Globals.Url`·`Globals.UserName`(Boot 템플릿은 `Globals.<DbType>.Url`)이라 두 형식을 모두 읽습니다. (c) 공식 simple-backend·portal-site 등은 **자체 Dockerfile·compose·k8s 를 갖고 있어** 덮어쓰지 않고 알리며, `dockerfilePath`(예: `deploy/Dockerfile`, `.dockerignore` 는 BuildKit 규칙대로 `<경로>.dockerignore`)로 공존시킵니다. (d) 폐쇄망을 위해 `# syntax` 지시어를 쓰지 않고(BuildKit 내장 프론트엔드), 컨테이너 안에서 Maven 저장소에 닿지 않는 환경을 위해 `buildInImage=false`(미리 빌드한 산출물) 경로를 더했습니다 — 개발 환경 실측도 이 경로로 했고, CI 는 이미지 안에서 빌드합니다. (e) Servlet 6.1 이상을 직접 선언한 프로젝트는 Tomcat 11.0 을 고릅니다(5.x 공식 parent 는 Servlet 5.0·fileupload2 servlet6 이라 기본 10.1).

### v0.46.0 — 5.x 최신 유지 + 생성 CI 실행 검증

**목표**: 공식 Initializr 템플릿은 여전히 parent 5.0.0 으로 만들어져(공식 parent 최신 5.0.2) 새 프로젝트가 만들어지는 순간부터 기준 미만입니다. 3.x/4.x → 5.x 전환(`migrate`)은 있지만 **5.x 안의 갱신**(parent·RTE 5.0.x·Spring Boot 패치, 공통컴포넌트 5.0.x → 5.0.7)은 사람이 합니다. 또 v0.43 의 GitLab·Jenkins 설정은 스키마·구조만 확인했고 실제 빌드 서버에서 돌려 보지 않았습니다.

**범위 (포함)**
- `migrate_egovframe_project(target="5.0.2")` — 이미 5.x 인 프로젝트의 갱신 모드: parent 버전, RTE 모듈 좌표, parent 관리 속성(`spring.version` 등)을 공식 parent 5.0.2 기준으로 맞추는 auto 항목과 5.0.0 → 5.0.2 사이 RTE 변경(공식 `egovframe-runtime` 태그 비교로 생성한 규칙 데이터)의 manual 항목, `apply=true`(transaction·백업)와 `verify=true`(compile). 공통컴포넌트는 기존 `upgrade_egovframe_project` 로 5.0.7 까지 이어 주는 안내와 평가서 2절 "5.x 최신 유지" 항목.
- `create_egovframe_project(alignParent=true)` 선택 옵션 — 생성 직후 같은 갱신을 적용(기본은 공식 템플릿 그대로).
- 생성 CI 실행 검증(CI 통합): (1) **Jenkins** — 공식 `jenkins/jenkins` LTS 컨테이너에 Pipeline 플러그인을 고정 버전으로 설치하고, 선언형 문법 검증(declarative linter) 후 생성 `Jenkinsfile` 을 공식 web 템플릿 작업공간에서 실제로 실행해 Build·SBOM·SBOM check·Assessment 단계와 보관 산출물을 확인, (2) **GitLab** — 생성 `.gitlab-ci.yml` 을 로컬 실행기로 돌려 build·supply-chain job 성공과 산출물을 확인(실행기 선택은 선행 조사에서 확정).
- 보류였던 브랜치 보호 설정을 README 운영 절차로 확정.

**범위 (제외)**: 5.x 의 마이너 이상 갱신(5.1 등 미출시), Jenkins·GitLab 서버 설정 자동화, 공통컴포넌트 사용자 수정의 자동 재적용

**검증 기준**: Initializr 고정 commit 의 공식 web·boot-web 템플릿을 5.0.2 로 갱신 → JDK 17 `mvn compile` 통과·의존성 점검 기준 미만 감소(실측값 고정)·평가서 공급망 등급 변화 기록, 갱신 dryRun 무기록·fault-injection 롤백, Jenkins·GitLab 실행 검증 통과(CI 통합)

**완료 정의**: 도구 34종(변화 없음), `docs/design-migration.md` 에 5.x 갱신 절, README 「CI 설정 생성」 절에 실행 검증 결과

**결과 (2026-10-15 완료)**: `target="5.0.2"` 갱신 모드와 `alignParent`, 평가서 2절 요약을 넣었습니다. 규칙은 runtime 태그 3개·공식 parent pom 6개·큐레이션 11건으로 만들고, 큐레이션 클래스가 그 단계에서 실제로 바뀌었는지 생성기가 확인합니다. 공식 web·boot-web 은 parent 5.0.0 → 5.0.2 한 곳만 바뀌고 compile 이 통과하며, 기준 미만 6 → 4·3 → 1(RTE 전이 `fdl-cmmn`·`fdl-logging` 5.0.0 이 빠짐), 공급망 등급 C → B 입니다. 계획과 다른 점: (1) parent 5.0.0 → 5.0.2 의 속성 차이는 RTE 버전 하나뿐이라 "parent 관리 속성" auto 는 예전 기본값을 복사한 경우만 바꾸는 규칙으로 두었습니다. (2) RTE 변경은 시그니처 차이 2건 외에는 보안점검 반영에 따른 동작 변경이라 manual 사유에 영향과 대처를 적었습니다. (3) GitLab 실행기는 `gitlab-ci-local`(Docker 실행기)로 정했습니다. (4) Jenkins 공식 이미지의 JDK 17 판은 2.541.3 에서 끊겨 최신 LTS(2.580.1)의 JDK 21 판을 쓰고 release 17 로 컴파일합니다. (5) 패키지가 풀린 크기 상한(2MB)에 닿아 생성기 입력인 `catalog/*-mapping.json` 을 패키지에서 빼고 상한을 2.5MB 로 올렸습니다.

### 보류·운영 항목 (당시)

- **브랜치 보호(소유자 1회)**: 운영 절차로 확정했습니다 — 아래 [브랜치 보호](#브랜치-보호-소유자-1회) 참조.
- **Initializr upstream**: 템플릿 pom parent 5.0.0 문제를 포함한 기존 4건은 upstream 이슈로 제출할 가치가 있습니다(v0.46 의 갱신 모드는 그동안의 우회).
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.
- **응답 본문 영문화**: 평가서·점검 결과의 라벨·헤더 영문화(`--lang en`)는 계속 후순위입니다.
- **MCP 신기능**: `tasks`(장시간 도구의 비동기 실행)는 SDK 1.32.1 에서도 `experimental/tasks` 아래에 있어 보류합니다. 안정 API 로 올라오면 리허설·번들·배포 이미지 빌드처럼 수 분 걸리는 도구부터 적용합니다.

### 선행 조사 결과 (2026-10-12)

- **upstream 태그**: `egovframe-runtime` 최신 v5.0.2-Final, `egovframe-common-components` v5.0.7(`7912e13`), `egovframe-vscode-initializr` 최신 태그 v5.0.6(`84d3682`)·`main` `bc18641`, `egovframe-development` v5.0.2, `egovframe-ai-rag` v5.0.0 — 지난 기획(2026-10-07) 이후 새 태그 없음.
- **개발보안 기준**: 행정안전부·KISA 「전자정부 SW 개발·운영자를 위한 소프트웨어 개발보안 가이드」(2021 개정)는 설계단계 보안요구 20개·구현단계 보안약점 49개를 두고, 정보시스템 감리 대상 사업에 적용됩니다(개발보안 의무화 2012-12). 항목 이름·유형은 가이드 원문 표기로 규칙 데이터에 옮깁니다.
- **코퍼스 실측(패턴 빈도, 회귀 코퍼스 부분 트리)**: 공식 공통컴포넌트 v3.10.0 / v4.3.2 — MyBatis·iBATIS 매퍼 중 `${…}` 를 쓰는 파일 42 / 48개(84 / 96건), JSP 스크립틀릿 출력 `<%=` 192 / 195건, `printStackTrace()` 22 / 47건, 약한 해시·암호 호출 1 / 1건, `new Random(` 4 / 3건. 매퍼의 `${…}` 는 정렬 컬럼·테이블 접두어처럼 바인딩으로 바꿀 수 없는 경우가 섞여 있어 규칙의 예외 조건(허용 목록 검증 여부)이 오탐 통제의 핵심입니다.
- **배포 기반 이미지**: Docker Hub 공식 `tomcat:10.1-jdk17-temurin`(Jakarta EE 9+ 서블릿 — 5.x 템플릿의 `jakarta.servlet-api` 5.0 과 호환)과 `eclipse-temurin:17-jre` 태그가 있습니다.
- **Jenkins 실행 검증**: `jenkinsci/jenkinsfile-runner` 는 2022년 이후 이미지 갱신이 없어(마지막 태그 1.0-beta-32) 쓰지 않고, 공식 `jenkins/jenkins` LTS + 고정 플러그인 방식으로 검증합니다.
- **도구 의존성**: `@modelcontextprotocol/sdk` 최신 1.32.1(동봉과 같음), `tasks` 는 여전히 `experimental` 경로.

## 이전 기획 (v0.41–v0.43, 완료)

v0.40.0 까지 끝난 상태(2026-10-07, 도구 30종 + CLI 명령 8종, 테스트 약 1,600건, npm 0.40.0 자동 배포)에서 다음 세 릴리스를 아래 순서로 진행했습니다. 세 버전 모두 2026-10-12 까지 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **현장에서 그대로 쓰기** 입니다 — 자동 단계를 모두 돌린 뒤 사람이 고칠 것이 실제로 얼마나 남는지를 사본에서 재고(v0.41), 망분리된 공공 개발 환경에서도 인터넷 없이 같은 결과를 내며(v0.42), GitHub Actions 와 CycloneDX 밖의 빌드 서버·제출 형식(Jenkins·GitLab, SPDX)으로 넓힙니다(v0.43). 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-07)"에 있습니다.

### v0.41.0 — 전환 리허설 (`rehearse_egovframe_migration`)

**목표**: 평가서(v0.37)는 전환 난이도를 등급으로, `migrate_egovframe_project`(apply)와 `reassemble_egovframe_components` 는 각 단계의 실행을 맡지만, "자동 단계를 전부 돌린 뒤 컴파일 오류가 몇 개 남고, 무엇부터 고치면 가장 많이 줄어드는가"는 아직 실제로 재 보지 않습니다. 사용자 프로젝트를 건드리지 않고 사본에서 전 과정을 돌려 남는 작업을 실측합니다.

**범위 (포함)**
- 새 도구 `rehearse_egovframe_migration(projectDir, steps=["migrate","reassemble","verify"], components?, sourceTag="auto", keepWorkspace=false, timeoutMs)`(31번째, 프로젝트는 읽기 전용): (1) 사본 작성 — 캐시 디렉터리(`EGOVFRAME_CACHE_DIR/rehearsal/<시각>`)에 복사(`.git`·`target`·`build`·`node_modules`·`migration-backup` 제외, 원본 파일 수·바이트 기록) (2) 사본에 `migrate apply` → `reassemble`(dryRun=false) → JDK 17 compile (3) 결과 — 단계별 변경 파일 수, 컴파일 성공 여부, 남은 오류 수와 파일·패키지·오류 종류별 분포, 오류 ↔ 수동 항목·재조립 작업 목록 연결(v0.33 연결 로직 재사용), "이 작업을 처리하면 오류 N개가 사라진다" 순 상위 작업 목록. 단계 실패는 그 지점까지의 결과와 이유로 돌려줍니다.
- `keepWorkspace=true` 면 사본 경로를 돌려 사람이 열어 볼 수 있게 하고, 기본은 끝나면 지웁니다. 원본은 실행 전후 디렉터리 지문(경로·크기·mtime)이 같음을 결과에 적습니다.
- 평가서 6절: 프로젝트에 리허설 결과(`--out` 로 남긴 `rehearsal.json`, 또는 `generate_egovframe_report(rehearsal=true)` 로 즉석 실행)가 있으면 등급 옆에 "실측: 자동 전환 후 컴파일 오류 N건"을 함께 표시합니다(등급 산식은 바꾸지 않음).
- CLI `rehearse`(지표 `errors`·`files`·`unlinked`, 예: `--fail-on errors>200`).

**범위 (제외)**: 남은 오류의 자동 수정(사람·AI 클라이언트의 일), 테스트 실행(컴파일까지), Gradle 멀티 프로젝트

**검증 기준**: 공식 공통컴포넌트 **v4.3.2 전체 트리**(선행 조사: 루트 pom 하나의 war 모듈, 6,523 파일, Java 1.8·Spring 5.3.37·의존성 70개)를 CI 통합에서 리허설해 자동 전환·재조립 뒤 남는 컴파일 오류 수와 상위 작업을 `catalog/migration-corpus.json` 에 기대값(±10%)으로 고정합니다 — v0.37 코퍼스가 "진단 항목 수"를 고정했다면 이번에는 "남는 오류 수"를 고정합니다. 원본 지문 불변, 단계별 실패 경로(가짜 runner), `keepWorkspace` 정리 확인.

**완료 정의**: 도구 31종, `docs/design-migration.md` 「리허설」 절, README 흐름 예시를 "진단 → 평가서 → 리허설 → 적용" 으로 갱신

**결과(2026-10-08) — 완료**: `src/rehearse.ts`. 실측(공식 공통컴포넌트 v4.3.2 전체 트리, 6,523 파일, 전 과정 약 1분): 재조립(원본 v4.3.2 식별, 교체 2,258·추가 69·삭제 62) → 전환 적용(자동 61건, 수동 38건 남음) → 컴파일 오류 **6,003건**(CI·JDK 17; 로컬 JDK 21 은 6,335건, 파일 503 — 4건을 뺀 전부가 누락 패키지 `jakarta.annotation`·`org.egovframe.rte.ptl.reactive.validation`·`jakarta.websocket`… 와 그 연쇄) → pom 맞춤(parent `egovframe-web-config-parent` 5.0.2 추가, 좌표 25 추가, 버전 44·scope 3 정리) → **1건**(`EgovCertInfoUtil` — GPKI 벤더 jar 가 `javax.servlet` 을 참조). 계획과 달라진 점: (a) **단계 순서를 재조립 → 적용으로 바꿨습니다** — 계획대로 적용을 먼저 하면 적용이 컴포넌트 소스를 바꿔 원본 태그가 v5.0.1 로 오인되고 1,489개 파일이 사용자 수정으로 분류됩니다(실측). (b) 자동 단계 뒤 오류의 대부분이 pom 의존성이라 **pom 맞춤 단계**(`align-pom`, 사본 전용, 공식 고정 태그 pom 기준)를 더해 "코드 작업"을 분리했습니다. (c) javac 기본 상한(100)을 피하려고 Maven 은 fork + `-Xmaxerrs` 로 셉니다. 첫 CI 실행에서 JDK 17 이 같은 원인을 JDK 21 과 다른 모양으로 보고해(없는 패키지 import 대신 사용처마다 `cannot find symbol`, 다른 오류 때문에 Lombok 이 멈춰 getter 가 없음) 누락 의존성 비율이 15% 로 나왔으므로, 분석이 파일의 import 문·타입 선언 파일·Lombok 사용으로 원인을 묶게 고쳤고(두 JDK 모두 99.9%), pom 에 소스 인코딩이 없으면 `-Dproject.build.sourceEncoding=UTF-8` 을 줍니다(JDK 17 + POSIX 로케일의 한글 주석 오류 방지). (d) 리허설 결과는 프로젝트 안 파일이 아니라 캐시 디렉터리(`EGOVFRAME_CACHE_DIR/rehearsal/records`)에 남기고 평가서가 읽습니다(프로젝트 읽기 전용 유지). 함께 고친 결함: 4.x 의 `org.egovframe.rte` 좌표를 5.x 세대로 분류하던 문제(재조립 후보 태그가 5.x 로만 좁혀짐), Maven 출력의 `[WARNING]`·린트 경고 줄을 컴파일 오류로 세던 문제(`build_egovframe_project`·`verify` 에도 영향).

### v0.42.0 — 폐쇄망(망분리) 운영: 오프라인 번들

**목표**: 공공 개발 환경은 대부분 망분리라 인터넷 PC 에서 받은 자료를 반입해 씁니다. 지금은 OSV 조회·공통컴포넌트 아카이브·Initializr zip·재조립 원본 태그·upstream 대조가 실행 시점에 인터넷을 씁니다. 반입 가능한 번들 하나로 같은 결과를 내게 합니다.

**범위 (포함)**
- 새 도구 `prepare_egovframe_offline_bundle(outputDir, include=["osv","components","templates","origin"], dryRun=true)`(32번째, 인터넷 쪽에서 실행): OSV Maven 전체 덤프(`osv-vulnerabilities/Maven/all.zip`)·고정 공통컴포넌트 아카이브(카탈로그 sha256 검증분)·Initializr zip 템플릿·재조립용 원본 태그 bare 미러를 한 디렉터리에 담고 `bundle-manifest.json`(파일별 sha256·크기·출처 URL·받은 시각·서버 버전)을 씁니다.
- 폐쇄망 쪽: `EGOVFRAME_OFFLINE_BUNDLE=<dir>` 가 있으면 모든 다운로드가 번들에서 먼저 찾고(지문 검증, 불일치 거부), `offline=false` 의 OSV 조회(`check_egovframe_dependencies`·`generate_egovframe_sbom`·`check_egovframe_sbom`·평가서)는 로컬 덤프로 대체합니다 — `affected[].versions` 목록 대조를 기본으로, 목록 없이 `ECOSYSTEM` 범위만 있는 레코드는 Maven 버전 비교로. 결과에 "OSV 스냅숏 YYYY-MM-DD 기준"을 표시하고 기준일이 오래되면(기본 30일) 경고합니다.
- `diagnose_egovframe_network` 의 처방에 번들 경로를 추가하고, CLI `bundle` 명령과 `server.json` 환경변수 `EGOVFRAME_OFFLINE_BUNDLE` 을 더합니다.

**범위 (제외)**: Maven 의존성 jar 미러링(기관 Nexus·Artifactory 미러 설정 안내만), 번들 서명(manifest sha256 으로 대신, 요청 시 추가)

**검증 기준**: 같은 날 받은 덤프로 공식 web 템플릿 SBOM(67 component)의 로컬 OSV 결과가 온라인 `querybatch` 결과와 같은 ID 집합(차이가 있으면 원인 — 철회·범위 표기 — 를 기록), 프록시를 막은 상태에서 프로젝트 생성(zip 템플릿)·컴포넌트 조립·재조립·SBOM 점검이 번들만으로 성공, 지문이 다른 번들 파일 거부

**완료 정의**: 도구 32종, README 「폐쇄망에서 쓰기」 절, `docs/design-offline-bundle.md`

**결과(2026-10-10) — 완료**: `src/offline-bundle.ts`(번들 만들기·읽기·로컬 OSV·Maven 버전 비교)와 `src/offline-bundle-plan.ts`. 실측: 번들 106.8MB(OSV 덤프 9.9MB·7,190건, 아카이브 44.7MB, web 템플릿 14.8MB, 태그 22개 미러 37.3MB), 만드는 데 약 10초. 같은 날 받은 덤프의 로컬 판정이 온라인 querybatch 와 공식 web 템플릿 SBOM 67 component + 옛 버전 표본 6개에서 **질의 73/73·ID 134/134 일치**, fetch 를 막고 git 을 file 프로토콜로 제한한 상태에서 web 템플릿 생성·bbs 조립(797파일)·4.3.2 재조립 미리보기(원본 v4.3.2 식별)·SBOM 재점검(OSV 27건)이 네트워크 시도 0건으로 끝났습니다. 계획과 달라진 점: (a) 다운로드 훅을 도구마다 두지 않고 공용 `fetchWithTimeout`(와 카탈로그 아카이브 다운로드)에서 manifest 의 URL 과 맞춰 대체해, 앞으로 생기는 GET 다운로드도 번들에 넣기만 하면 됩니다. (b) 원본 미러는 blob 없는 캐시가 아니라 태그마다 내용까지 받은 미러로 담았습니다 — 22개 태그가 37MB 라 패치 생성까지 폐쇄망에서 됩니다. (c) 저장소 템플릿(브랜치 기준)은 고정 지문이 없어 기본에서 빼고 `templates` 로 지정할 때만 담습니다. (d) 번들은 새(또는 빈) 디렉터리에만 임시 디렉터리를 거쳐 쓰고 실패하면 남기지 않습니다.

### v0.43.0 — CI·제출 형식 다변화: Jenkins·GitLab, SPDX

**목표**: 공공 사업의 빌드 서버는 GitHub Actions 보다 Jenkins·GitLab 이 흔하고, SBOM 제출 형식은 아직 특정되지 않아(가이드라인 1.0 은 SPDX·CycloneDX 를 모두 언급) SPDX 를 요구받을 수 있습니다. v0.39 의 게이트와 v0.40 의 점검을 그 환경까지 넓힙니다.

**범위 (포함)**
- `generate_egovframe_ci(platform="github"|"gitlab"|"jenkins")`: `.gitlab-ci.yml`·`Jenkinsfile`(Declarative)로 빌드·테스트와 공급망 게이트(같은 CLI 명령 — `sbom --write` → `sbom-check --fail-on minimum` → `assess --fail-on <failOn>`, 종료 코드 2 를 실패로, 아티팩트 보관). 사내 npm 레지스트리·오프라인 번들 경로를 변수로 받습니다. 게이트 job 에 `sbom-check` 단계를 추가하는 것은 GitHub 쪽에도 같이 적용합니다.
- SPDX: `generate_egovframe_sbom(bomFormat="spdx-json")` — CycloneDX 문서를 SPDX **2.3** JSON 으로 변환(패키지·`DEPENDS_ON` 관계·purl `externalRefs`·`supplier`·`creationInfo.creators`·`created`), `check_egovframe_sbom` 이 SPDX 2.3 입력도 읽어 최소 요소 7종을 SPDX 필드에 대응시켜 점검(VEX 는 CycloneDX 로만).
- 테스트: 생성 `.gitlab-ci.yml` 을 GitLab 공식 CI JSON 스키마로, SPDX 출력은 공식 `spdx-spec` v2.3 스키마로 검증(v0.40 과 같이 테스트 고정물 + ajv).

**범위 (제외)**: SPDX 3.0, 그 밖의 CI(Azure DevOps·Bamboo 등), Jenkins 플러그인 설치·서버 설정

**검증 기준**: 공식 web 템플릿 SBOM 을 SPDX 로 바꿔도 최소 요소 7종 판정과 component 수가 같고 SPDX 2.3 스키마 통과, 생성 `.gitlab-ci.yml` 스키마 통과, `Jenkinsfile` 은 Declarative 구조(pipeline·agent·stages·post) 단언 — 실제 Jenkins 실행은 보류 항목으로 남깁니다

**완료 정의**: 도구 32종(변화 없음), README 「CI 에서 쓰기」 에 GitLab·Jenkins 예시와 「SBOM 제출 준비」 에 SPDX, `docs/design-cli.md` 플랫폼 절

**결과(2026-10-11) — 완료**: `src/ci-config.ts`(세 플랫폼이 같은 게이트 명령 목록 `supplyChainCommands` 를 씀)와 `src/spdx.ts`(`cdxToSpdx`·`spdxToCdx`). 실측: 공식 web 템플릿을 실제 Maven·cyclonedx-maven-plugin 으로 만든 SBOM(67 component, OSV 27건)을 SPDX 2.3 으로 바꾸면 패키지 68·관계 165 로 공식 spdx-spec v2.3 스키마를 통과하고, SPDX 를 점검한 결과가 CycloneDX 점검과 **component 67·최소 요소 7종의 요소별 충족 수(68/68 …)·판정 ready 까지 같으며** 둘을 비교하면 차이 0 입니다. 생성 `.gitlab-ci.yml` 은 maven·gradle·게이트 유무·환경 변수 조합 4가지 모두 GitLab 공식 CI 스키마(v19.4.1-ee 고정물)를 통과합니다. 계획과 달라진 점: (a) **SPDX 점검은 별도 규칙을 두지 않고** SPDX 를 내부 CycloneDX 모양으로 옮겨 같은 최소 요소·재판정·비교 코드를 그대로 씁니다 — 대응(공급자 = `PackageSupplier`/`PackageOriginator`, 의존관계 = 그 패키지가 주어인 `DEPENDS_ON`, 작성자 = `creators` 의 Person·Organization)은 `src/spdx.ts` 머리 주석과 「SBOM 제출 준비」 표에 있습니다. (b) "의존 없음"과 "모름"을 구분하려고 의존이 없는 패키지는 `DEPENDS_ON NONE`(SPDX 2.3 §11.1)으로 쓰고, `NOASSERTION` 은 모름으로 읽습니다. (c) 기준 판정(`egovframe:*`)과 OSV 결과를 SPDX 의 annotations·`SECURITY`/`advisory` externalRefs 로 옮겨, SPDX 로 낸 뒤에도 재판정의 "생성 이후 바뀐 판정"·"새로 알려진 취약점"이 동작합니다. (d) 생성 시각은 SPDX 필수 항목이라 원본에 없으면 변환 시각을 넣고 알립니다(이 경우만 판정이 달라질 수 있음). (e) 게이트의 `sbom-check --fail-on minimum` 은 공급자 단서(`supplier` 또는 pom `<organization>`)가 없으면 실패하므로 `supplier` 파라미터를 더하고 생성 응답이 미리 알립니다. (f) GitLab 은 JUnit 리포트와 `artifacts:reports:cyclonedx`, Jenkins 는 Linux·Windows 에이전트 공용 실행(`isUnix()` 로 `sh`/`bat`)을 넣었습니다. Jenkins 실제 실행 검증은 보류 항목으로 남깁니다.

### 보류·운영 항목 (당시)

- **Jenkins 실행 검증**: 생성 `Jenkinsfile` 은 Declarative 구조만 단언합니다. 실제 Jenkins(컨테이너)에서 돌리는 통합 검증은 아직 없습니다.
- **브랜치 보호(소유자 1회)**: `main` 에 "Require status checks to pass"(gate 6 + integration)를 켜면 실패 상태 병합이 재발하지 않습니다. `gh api -X PUT repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection --input protection.json`(`required_status_checks.contexts` 에 체크 이름 7개, `enforce_admins: false`, `required_pull_request_reviews: null`, `restrictions: null`).
- **Initializr upstream**: 최신 태그 `v5.0.6`(`84d3682`)과 `main`(`bc18641`) 모두 템플릿 pom 의 parent 가 여전히 5.0.0 입니다(공식 parent 최신 5.0.2). 기존 3건과 함께 upstream 이슈로 제출할 가치가 있습니다.
- **sbom-live 간헐 실패 — 원인 확인·해결(v0.43)**: CI 러너에서 cyclonedx-maven-plugin 출력에 `metadata.timestamp` 가 빠지는 경우가 있어(로컬에서는 재현 안 됨) 최소 요소 '생성 시각'이 비었습니다. v0.40 PR 의 첫 실패와 v0.43 PR 의 SPDX 판정 불일치(SPDX 는 생성 시각이 필수라 변환 시각이 들어감)가 같은 원인이었고, 이제 생성기가 비어 있으면 생성 시각을 넣고 알립니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.
- **응답 본문 영문화**: 평가서·점검 결과의 라벨·헤더 영문화(`--lang en`)는 계속 후순위입니다.
- **MCP 신기능**: `tasks`(장시간 도구의 비동기 실행)는 SDK 에서 실험 단계라 보류 — v0.41 리허설이 수 분 걸리는 첫 도구라 안정화되면 가장 먼저 적용합니다. `elicitInput` 은 dryRun 패턴으로 충분해 쓰지 않습니다.

### 선행 조사 결과 (2026-10-07)

- **upstream 태그**: `egovframe-runtime` 최신 v5.0.2-Final(동봉 규칙과 같음), `egovframe-common-components` v5.0.7(2026-10-07 `7912e13` 으로 재태깅 — v0.39 에서 반영), `egovframe-vscode-initializr` 최신 태그 v5.0.6(`84d3682`)·`main` `bc18641`(고정 commit `f8f5725`), 템플릿 pom parent 는 v5.0.6·`main` 모두 5.0.0.
- **리허설 대상**: 공식 공통컴포넌트 v4.3.2 는 루트에 `pom.xml` 하나(`war`)인 단일 Maven 모듈로 6,523 파일, `java.version` 1.8·Spring 5.3.37·`<dependency>` 70개 — 그대로 JDK 17 컴파일까지 가는 실자산 리허설에 쓸 수 있습니다(v0.38 재조립 테스트가 쓰는 v5.0.7 아카이브·원본 태그 미러를 재사용).
- **OSV 오프라인 덤프**: `https://osv-vulnerabilities.storage.googleapis.com/Maven/all.zip` 은 10,356,728 bytes(2026-10-06 19:47 GMT 갱신, 매일 갱신)이고 레코드 7,168건·해제 24MB 입니다. `affected` 의 범위는 `ECOSYSTEM` 13,321·`SEMVER` 121 이며 11,700 개 `affected` 에 명시 버전 목록이 있어 대부분 목록 대조만으로 판정됩니다. 표본으로 `org.springframework:spring-webmvc` 6.2.11 은 로컬 덤프에서 12건이 나옵니다(온라인과의 일치는 v0.42 검증 기준).
- **SPDX**: `spdx/spdx-spec` 태그 `v2.3` 의 `schemas/spdx-schema.json`(45,312 bytes)을 테스트 고정물로 쓸 수 있습니다.
- **도구 의존성**: `@modelcontextprotocol/sdk` 최신 1.32.1(2026-10-05, 동봉과 같음). `@cyclonedx/cyclonedx-library` 10.3.0 은 Node ≥20.18 이라 게이트(Node 18 포함)에서는 v0.40 처럼 ajv + 공식 스키마 고정물 방식을 유지합니다.

## 이전 기획 (v0.38–v0.40, 완료)

v0.37.0 까지 끝난 상태(2026-10-05, 도구 28종, 테스트 약 1,500건, npm 0.36.1 까지 자동 배포·0.37.0 배포 진행)에서 다음 세 릴리스를 아래 순서로 진행했습니다. 세 버전 모두 2026-10-07 까지 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **평가에서 실행으로** 입니다 — 평가서가 가장 큰 수작업으로 지목한 공통컴포넌트 재조립을 도구가 수행하고(v0.38), 같은 분석을 AI 클라이언트 없이 CI 와 배치에서 돌리며(v0.39), SBOM 을 만드는 데서 그치지 않고 제출물로서 검증·비교·추적합니다(v0.40). 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-05)"에 있습니다.

### v0.38.0 — 공통컴포넌트 재조립 실행 (`reassemble_egovframe_components`)

**목표**: 코퍼스가 보여 준 대로 3.x/4.x 프로젝트의 수동 전환 항목 대부분은 복사해 넣은 공통컴포넌트 소스 안에 있습니다(4.3.2 트리: 수동 717건 중 제거된 공통컴포넌트 클래스 524·재조립 권고 155). 지금은 "`add_egovframe_components` 로 5.0.6 을 다시 조립하고 사용자 수정은 백업과 diff 로 옮기세요"라고 안내만 합니다. 이 과정을 도구가 수행하되, 사용자가 손댄 파일을 한 줄도 잃지 않게 합니다.

**범위 (포함)**
- **선행: 공통컴포넌트 v5.0.7 대응** — upstream 이 2026-10-06 `v5.0.7` 을 냈습니다(v5.0.6 대비 1,672파일, 주로 `uss`·`sym`·`cop` 매퍼·JSP·`uss/ion`·`cop/smt`). 재조립 대상 버전이 곧 이 태그이므로, 먼저 컴포넌트 카탈로그(`generate:catalog`)·전환 규칙의 공통컴포넌트 대응표(`components.toTag`)·`sync_egovframe_catalog` 고정을 v5.0.7 로 올리고 회귀 코퍼스 기대값을 갱신합니다(drift 감시가 CI 에서 이미 경고 중).
- 새 도구 `reassemble_egovframe_components(projectDir, components?, sourceTag="auto", database?, dryRun=true, verify=false)`(29번째): (1) `diagnose_egovframe_project` 가 감지한 컴포넌트 중 전환 항목이 있는 것(평가서의 재조립 권고와 같은 기준)을 대상으로 삼고 `components` 로 좁힐 수 있습니다. (2) **원본 태그 식별** — 프로젝트의 컴포넌트 파일 해시를 세대에 맞는 후보 태그(3.x: v3.9.0·v3.10.0 / 4.x: v4.0.0–v4.3.2, 공식 저장소 태그 21종 중)의 같은 경로와 대조해 일치 비율이 가장 높은 태그를 고릅니다. 후보 트리는 v0.37 코퍼스의 sparse 부분 클론을 **컴포넌트 접두어 단위**로 재사용해(태그당 수 MB) `.egov-cache` 에 캐시하고, `sourceTag` 로 고정할 수 있습니다. (3) **3-way 분류** — 원본(식별한 태그)·현재·5.0.6 의 파일 해시로 `unchanged`(교체)·`user-modified`(교체 + 사용자 변경을 unified diff 패치로 보존)·`added`(사용자 파일, 유지)·`removed-in-5.x`(5.0.6 에 없는 파일, 백업 후 제거 — `sec/rnc` 실명확인·`utl/sec` 등 코퍼스에서 확인된 미대응 디렉터리는 작업 목록에 올림)로 나눕니다. `upgrade_egovframe_project` 의 `classifyUpgrade` 와 같은 규칙이며 매니페스트 대신 원본 태그가 기준선입니다. (4) **조립** — `add_egovframe_components` 의 계획기로 5.0.6 파일(소스·매퍼·JSP·메시지·설정 조각·DB 스크립트)을 내려받아 넣고 매니페스트(`.egovframe-components.json`, 해시 포함)를 기록해 이후 `upgrade`·`validate`·`remove` 수명주기 도구가 적용되게 합니다. 모든 변경은 하나의 transaction, 원본은 `migration-backup/<timestamp>/`, 사용자 패치는 `migration-backup/<timestamp>/patches/<component>/*.patch` 와 `reassemble-plan.json`(파일별 분류·패치 경로·작업 목록). (5) **작업 목록** — 사용자 수정 파일마다 "5.0.6 의 같은 파일에 이 패치를 다시 적용" 항목을, 5.x 에 없는 파일마다 "대체 방법" 항목을 내고, `verify=true` 면 `build_egovframe_project(compile)` 을 돌려 v0.33 의 연결 규칙으로 오류를 항목에 붙입니다. 결과는 Markdown·`format=json`(`outputSchema`), 도구 메타는 파괴적(destructive, 기존 파일 교체)·openWorld.
- `migrate_egovframe_project` 진단의 `component-reassemble` 항목 `to` 에 새 도구 호출을 안내하고, 평가서 2절의 재조립 권고에 "원본 태그 추정"을 미리 보여 줍니다(일치 비율).
- 회귀 코퍼스 확장: 4.3.2 트리에서 `cmm`·`bbs` 를 재조립(dryRun)했을 때 분류 건수(unchanged 전부, user-modified 0)와 원본 태그 식별(v4.3.2, 일치 100%)을 기대값으로 고정하고, 한 파일을 바꾼 뒤 `user-modified` 1·패치 1 을 단언합니다.

**범위 (제외)**: 사용자 패치의 자동 재적용(5.0.6 소스가 많이 바뀌어 fuzz 적용은 오히려 위험 — 패치와 작업 목록까지), 컴포넌트 밖 애플리케이션 코드가 호출하는 제거 클래스의 수정(기존 `class-removed` 수동 항목 유지), DB 스키마 변경 스크립트 실행

**검증 기준**: 공식 5.x 템플릿에 공통컴포넌트 v3.10.0 의 `bbs`(+의존 `cmm`) 소스를 복사하고 파일 2개를 수정한 픽스처에서 — 원본 태그 v3.10.0 식별, 분류(unchanged·user-modified 2·added 0·removed-in-5.x ≥ 0), dryRun 무기록, 적용 후 5.0.6 파일 해시 일치·패치 2개·매니페스트 생성·`validate_egovframe_project` 통과, JDK 17 `mvn compile` 통과(CI 통합), fault-injection rollback. 코퍼스 기대값 갱신. Windows 게이트 3개 통과

**완료 정의**: 도구 29종, `docs/design-migration.md` 에 재조립 절(원본 태그 식별·3-way·보존 규칙), README 에 흐름 예시(진단 → 평가서 → 재조립 → apply → verify)

**결과(2026-10-06) — 완료**: 선행 작업으로 컴포넌트 카탈로그(190항목, 아카이브 sha256·크기·파일 수 6,604)와 전환 규칙의 공통컴포넌트 대응표를 v5.0.7 로 올렸습니다(제거 클래스 54 → 55, `EgovDtaUseStatsContoller` 추가; 회귀 코퍼스 기대값 변화 없음). 원본 태그 식별은 계획한 "파일 해시 대조"를 git blob id 로 구현해, 태그마다 blob 없는 shallow fetch(≈1초·수백 KB)와 `ls-tree` 만으로 끝나고 파일 내용은 사용자 수정 파일의 패치를 만들 때 그 blob 하나만 받습니다. CRLF 체크아웃도 LF 정규화 id 로 같은 파일로 봅니다. 계획과 다른 점: (a) 메시지·설정 조각·웹 자산은 사용자 수정이면 덮어쓰지 않고 유지하며 목표본을 참고로 저장(설정 파일 교체가 실행 환경을 깨뜨릴 위험), (b) CI 통합의 `mvn compile` 은 넣지 않았습니다 — `cmm`·`bbs` 만으로는 5.0.7 의 다른 컴포넌트 참조 때문에 단독 컴파일이 성립하지 않아, 대신 쓴 파일 전부가 v5.0.7 tree 의 blob 과 같은지(780개)와 `validate`·`upgrade` 정합을 단언합니다, (c) 평가서의 "원본 태그 추정" 미리보기는 평가서가 기본 오프라인이라 넣지 않고 재조립 dryRun 으로 대신합니다. 부수 수정: `upgrade_egovframe_project` 가 조립 때 함께 설치된 자산 파일을 upstream 에 없는 것으로 보고하던 결함(재조립 픽스처에서 621건 "removed"), 만료 토큰(401)이면 비인증으로 다시 조회.

### v0.39.0 — CLI 모드 + CI 공급망 게이트

**목표**: 공공 사업의 빌드 서버(Jenkins·GitHub Actions·GitLab CI)에는 AI 클라이언트가 없습니다. 평가서·의존성 점검·SBOM 을 그 자리에서 사람 없이 돌리고, 등급·판정이 기준을 넘으면 파이프라인을 멈추게 합니다. 도구 로직은 그대로 두고 호출 통로만 하나 더 엽니다.

**범위 (포함)**
- CLI: `npx egovframe-scaffold-mcp <command> [options]` — 인자가 없으면 지금처럼 MCP stdio 서버로 뜨고(기존 호환), 명령이 있으면 그 도구를 실행하고 종료합니다. 명령은 읽기 전용·dryRun 도구로 한정: `assess`(평가서), `check`(의존성), `sbom`(`--write` 없으면 dryRun), `migrate`(진단만), `validate`, `diagnose`, `network`. 공통 옵션 `--project <dir>`, `--json`(structuredContent 그대로), `--out <file>`, `--lang ko|en`(라벨·헤더), 도구별 옵션은 MCP 파라미터와 같은 이름(`--resolve`, `--offline=false`, `--scope all`). 허용 root·네트워크 처방·오류 메시지는 MCP 경로와 동일. 구현은 `src/cli.ts` 가 `server.ts` 의 핸들러를 직접 호출(프로토콜 왕복 없음).
- 게이트 옵션 `--fail-on`: `assess` 에 `migration:C`·`supplyChain:C`(이 등급 이상이면 종료 코드 2), `check` 에 `outdated`·`legacy`·`replace`·`vulnerabilities`(건수 임계값 `vulnerabilities>0`), `migrate` 에 `manual>0`. 종료 코드 규약: 0 통과 · 2 기준 초과 · 3 실행 실패(빌드 도구 없음·네트워크) · 64 인자 오류. 결과 요약은 stderr 한 줄, 본문은 stdout — 파이프라인 로그와 아티팩트 둘 다에 맞춥니다.
- `generate_egovframe_ci(supplyChain=true)`: 생성하는 워크플로에 "공급망 게이트" job 을 추가 — `npx egovframe-scaffold-mcp@<이 버전> assess --json --out assessment.json --fail-on supplyChain:D` 와 `sbom --write --offline=false`, 결과를 아티팩트로 업로드, PR 요약(`$GITHUB_STEP_SUMMARY`)에 등급 표. 기존 빌드·테스트 job 은 그대로.
- SDK `@modelcontextprotocol/sdk` 1.29 → 1.32(프로토콜 2025-11-25): 변경 없는 업그레이드인지 핸드셰이크·구조화 출력 테스트로 확인하고, 실험 단계인 `tasks`(장시간 도구의 비동기 실행)는 안정화될 때까지 쓰지 않습니다(선행 조사 참조).
- 테스트: CLI 오프라인 스위트(명령·옵션 매핑·종료 코드·JSON 동일성 — 같은 입력에 MCP `structuredContent` 와 CLI `--json` 이 같은 객체), CI 생성 스냅샷, 통합 job 에서 생성된 워크플로 YAML 을 `actionlint` 로 검사하고 CLI 로 평가서를 실제 실행.

**범위 (제외)**: 쓰기 도구의 CLI 노출(프로젝트 생성·조립·적용은 사람이 결과를 보는 MCP 경로로 유지), 대화형 프롬프트, 응답 본문 전체의 영문화(`--lang en` 은 평가서·점검 결과의 라벨·헤더까지 — 사유 문장은 한국어 유지)

**검증 기준**: `npx egovframe-scaffold-mcp assess --project <공식 5.x 템플릿> --json` 이 MCP 호출과 같은 JSON, `--fail-on migration:B` 로 코퍼스 트리에서 종료 코드 2, 인자 없는 실행은 기존 핸드셰이크 테스트 통과(stdio 서버), 생성 워크플로가 GitHub Actions 에서 실제로 등급 표를 남김(이 저장소의 통합 job 에서 1회)

**완료 정의**: 도구 29종(변화 없음) + CLI 명령 7종, README 「CI 에서 쓰기」 절, `docs/design-cli.md`

**결과(2026-10-06) — 완료**: `src/cli.ts` 는 핸들러를 직접 부르지 않고 SDK 의 `InMemoryTransport` 로 같은 서버에 붙은 클라이언트가 `tools/call` 을 보내게 했습니다 — 입력 검증·허용 root·outputSchema 검증이 MCP 경로와 같아 `--json` 동일성이 구조적으로 보장되고 SDK 내부 필드에 기대지 않습니다. 계획보다 늘어난 것: 명령 7종에 `diagnose`·`network` 포함, `--fail-on` 지표를 명령별로 정의(평가서의 등급 2종·건수 8종 등), `sbom` 은 `--write` 로만 기록. 계획과 다른 점: (a) `--lang en` 라벨 영문화는 넣지 않았습니다(렌더러마다 바꾸는 일이라 별도로), (b) 생성 워크플로의 "실제 Actions 실행"은 이 저장소 통합 job 에서 `actionlint` 검사와 CLI 평가서 실행(job 요약에 등급 표)으로 대신했습니다 — 게이트 job 자체는 npm 에 이 버전이 게시돼야 돌 수 있기 때문입니다. SDK 는 1.29 → 1.32.1(프로토콜 2025-11-25)로 올렸고 기존 테스트가 변화 없이 통과했습니다(`tasks` 는 실험 단계라 미사용).

### v0.40.0 — SBOM 운영: 최소 요소·비교·VEX

**목표**: 2027년까지 공공 분야 IT 시스템·SW 제품의 SBOM 제출이 제도화됩니다(선행 조사). 제출물은 "만들었다"가 아니라 **빠진 요소가 없고, 이전 제출본과 무엇이 달라졌으며, 알려진 취약점에 대해 어떤 판단을 했는지**가 함께 있어야 합니다. v0.36 의 생성기에 그 세 가지를 붙입니다.

**범위 (포함)**
- 새 도구 `check_egovframe_sbom(projectDir, sbomPath="sbom/bom.cdx.json", baselinePath?, offline=true, vex=false, format)`(30번째, 읽기 전용·선택적 쓰기): (1) **최소 요소 점검** — 문서·component 마다 공급자(`supplier`/`publisher`)·구성요소명·버전·고유식별자(`purl`/`cpe`)·의존관계(`dependencies[]` 에 참조)·작성자(`metadata.authors`/`tools`)·생성 시각(`metadata.timestamp`)의 충족 여부를 세어 "제출 가능/보완 필요"와 빠진 component 목록을 냅니다(NTIA 최소 요소 7종을 기본 규칙으로 두고 국내 가이드라인이 요구를 추가하면 데이터로 반영). (2) **빌드 도구 없는 재점검** — SBOM 의 purl 만으로 기준 판정(v0.34 분류기)과 OSV 조회를 다시 해 "생성 이후 새로 알려진 취약점"을 보고합니다(운영 중 주기 점검용). (3) **비교** — `baselinePath`(이전 SBOM)와 component 집합을 비교해 추가·제거·버전 변경·판정 변화·새 취약점을 표로 냅니다(배포 전후·제출본 간 차이). (4) **VEX 초안** — `vex=true` 면 발견된 취약점마다 CycloneDX VEX 문서(`vulnerabilities[].analysis.state=in_triage`, `affects` 로 component 참조, `bom-link` 로 원본 SBOM 참조)를 `sbom/vex.cdx.json` 에 새 파일로 씁니다. 판단(`not_affected`·`exploitable` 등)은 사람이 채우고, 다음 실행은 기존 VEX 의 판단을 보존하며 새 취약점만 추가합니다.
- `generate_egovframe_sbom` 에 `supplier`·`author`·`componentName`·`componentVersion` 옵션(없으면 pom 의 `organization`·`name`·`version` 에서, 그래도 없으면 비워 두고 점검이 보완 필요로 표시)과 `metadata.lifecycles`(build) 기록 — 최소 요소를 생성 단계에서 채웁니다.
- 평가서 5절(SBOM)이 최소 요소 충족·마지막 점검일·VEX 유무를 함께 보여 줍니다.
- 테스트: 최소 요소 규칙(빠진 항목별), purl 재판정·OSV 가짜 조회, 비교(추가·제거·버전·취약점), VEX 생성·보존·bom-link, 공식 web 템플릿 SBOM 에 대한 실제 OSV 재점검(CI 통합).

**범위 (제외)**: SPDX 출력·변환(요청이 생기면 CycloneDX → SPDX 변환기 연동), 취약점 판단 자동화(VEX 상태는 사람의 결정), 중앙 저장소 제출 API 연동(제도 확정 전)

**검증 기준**: v0.36 이 만든 공식 web 템플릿 SBOM(69 component)이 최소 요소 점검에서 어떤 항목이 비는지 보고(예상: supplier·authors), 보강 옵션으로 다시 만들면 통과, 두 SBOM 비교에서 의도한 차이만 보고, VEX 재실행 시 사람이 적은 상태 보존

**완료 정의**: 도구 30종, `docs/design-dependency-check.md` 에 SBOM 운영 절, README 「SBOM 제출 준비」 절

**결과(2026-10-07) — 완료**: `src/sbom-check.ts`(규칙 `catalog/sbom-rules.json` — 요소마다 인정 필드 경로를 데이터로 두고 의존관계·생성 시각만 특수 검사)와 `generate_egovframe_sbom` 의 메타데이터 옵션. 실측: 공식 web 템플릿에 cyclonedx-maven-plugin 2.9.3 을 실제로 돌린 SBOM(67 component, 계획의 69 는 v0.36 당시 해석 수)은 **공급자 50/68**(주 component·RTE·AspectJ·Micrometer 등 pom `<organization>` 이 없는 18종)과 **작성자**(플러그인은 `metadata.tools` 만 기록)가 비어 "보완 필요"였고, 나머지 5요소는 68/68 이었습니다. 계획과 달라진 점: (a) 라이브러리 공급자는 옵션으로 채울 수 없어 **공급자 표**(`suppliers`, groupId 접두어 10건, 항목마다 pom 근거)를 두고 비어 있는 component 만 채우며 `egovframe:supplierBasis=catalog` 로 출처를 남깁니다 — 이 표와 `supplier`·`author` 로 다시 만들면 7요소 모두 충족합니다. (b) 주 component 이름은 pom `<name>` 대신 artifactId 를 그대로 두고(`componentName` 으로만 덮어씀), (c) `fillSuppliers` 기본값은 `enrich` 를 따릅니다(enrich=false 면 문서를 원형 그대로). (d) SBOM 에 `vulnerabilities[]` 가 없으면(offline 생성) 재조회 결과를 "새로 알려진 것"이 아니라 "기록되지 않은 것"으로 표시합니다. (e) VEX 는 판단이 끝난 ID 에 새 영향 component 가 생기면 그 판단을 넓히지 않고 같은 ID 의 새 `in_triage` 항목을 만듭니다. 생성 SBOM·VEX 는 CycloneDX specification 1.6.1 공식 JSON 스키마로 테스트에서 검증합니다(스키마는 테스트 고정물, 패키지 미포함). CLI 명령 `sbom-check` 를 더했습니다(지표 `minimum`·`newVulns` 등, `--write` 로 VEX).

### 보류·운영 항목 (당시)

- **브랜치 보호(소유자 1회)**: `main` 에 "Require status checks to pass"(gate 6 + integration)를 켜면 #33·#36 같은 실패 상태 병합이 재발하지 않습니다. `gh api -X PUT repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection --input protection.json`(`required_status_checks.contexts` 에 체크 이름 7개, `enforce_admins: false`, `required_pull_request_reviews: null`, `restrictions: null`)으로 한 번에 설정할 수 있습니다.
- **MCP Registry 등록 확인**: v0.37.0 자동 배포(Release #4)가 첫 게시입니다. 실패하면 다음 `main` 병합의 Release 가 Registry 단계만 다시 시도합니다(v0.37 재개 판정).
- **Initializr upstream**: 고정 commit(`f8f5725`)과 현재 `main`(`bc18641`) 모두 템플릿 pom 의 parent 가 5.0.0 입니다(공식 parent 최신 5.0.2). 평가서가 공식 템플릿의 공급망 등급을 B 로 매기는 이유 중 하나이므로 upstream 이슈로 제출할 가치가 있습니다(기존 3건과 함께).
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다. v0.40 의 purl 재판정에서도 같은 결과입니다.
- **응답 본문 영문화**: v0.39 의 `--lang en` 으로 평가서·점검 결과의 라벨·헤더까지 넓히고, 사유 문장 전체의 영문화는 계속 후순위입니다. Homebrew 탭은 후순위에서 내렸습니다(npx 로 충분).

### 선행 조사 결과 (2026-10-05)

- **재조립 가능성(코퍼스)**: 3.10.0 트리의 java 디렉터리 454개 중 5.0.6 카탈로그 접두어에 대응하는 컴포넌트 id 153종(java 1,095개 중 1,085개 = 99%), 미대응은 `com/sec/rnc`(실명확인)·`com/utl/sec` 6개 디렉터리·10개 파일뿐. 4.3.2 는 154종·미대응 3개 디렉터리·5개 파일. 즉 재조립은 거의 전부에 적용되고, 5.x 에 없는 소수만 작업 목록으로 남습니다. 공식 공통컴포넌트 저장소 태그는 21종(v3.9.0·v3.10.0·v3.10.0-FINAL·v4.0.0–v4.3.2·v5.0.0–v5.0.6)이라 원본 태그 후보가 유한하고, v0.37 의 sparse 부분 클론(접두어 단위)으로 후보를 싸게 받을 수 있습니다.
- **공급망 보안 제도**: 과기정통부·국정원의 SW 공급망 보안 로드맵(2026-06-24, 9개 분야)은 개발 단계 보안 내재화·SBOM 확산·위협 탐지·제도 정비를 담고, "공공분야에 도입되는 IT시스템 및 소프트웨어 제품에 대한 SBOM 제출을 2027년까지 제도화"가 명시됐습니다. SW 공급망 보안 가이드라인 1.0(2024-05)은 SBOM 유효성 검증·구성요소 관리·SBOM 기반 관리 방안을 다루며 형식(SPDX/CycloneDX)은 특정하지 않습니다. SBOM 핵심 구성요소는 NTIA 최소 요소와 같은 7종(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각)으로 통용됩니다 — v0.40 의 점검 규칙 기본값.
- **MCP SDK·프로토콜**: `@modelcontextprotocol/sdk` 최신 1.32.0(2026-10-02), 동봉 1.29.0. 최신 프로토콜 `2025-11-25`(`tasks/*` 요청은 SDK 에서 `experimental` 네임스페이스 — 장시간 도구의 비동기 실행이지만 클라이언트 지원과 API 안정성이 확인되기 전까지 보류), `elicitInput`(서버가 사용자 입력을 요청)은 안정 API 로 존재하나 승인 UX 는 dryRun 패턴으로 충분해 쓰지 않습니다. 업그레이드는 v0.39 에서 테스트 변화 없음을 확인하며 수행.
- **CycloneDX**: cyclonedx-maven-plugin 최신 2.9.3(동봉과 같음), CycloneDX 1.6 은 VEX 를 같은 스키마의 `vulnerabilities[].analysis`(state·justification·response·detail)와 `bom-link` 로 표현하므로 별도 포맷 없이 VEX 문서를 낼 수 있습니다.
- **upstream 상태**: `egovframe-runtime` 최신 태그 v5.0.2-Final(동봉 규칙과 같음), `egovframe-common-components` v5.0.6(같음 — 단 2026-10-06 `v5.0.7` 이 나와 v0.38 선행 작업으로 반영), Initializr `main` 은 `bc18641`(고정 commit `f8f5725` 이후 변경이 있으나 템플릿 pom 의 parent 는 여전히 5.0.0).
- **CLI 선례**: Node MCP 서버가 같은 바이너리로 CLI 명령을 겸하는 패턴(인자 없음 → stdio 서버, 명령 → 실행 후 종료)은 기존 `bin` 과 핸드셰이크 테스트(인자 없는 기동)를 그대로 유지할 수 있습니다. 종료 코드 규약은 `sysexits`(64 = 사용법 오류)를 따릅니다.

## 이전 기획 (v0.35–v0.37, 완료)

v0.34.0 까지 끝난 상태(2026-10-04, 도구 27종, 테스트 약 1,300건, npm 0.33.1 배포·0.34.0 배포 대기)에서 다음 세 릴리스를 아래 순서로 진행했습니다. 세 버전 모두 2026-10-05 까지 완료했으며 기획 원문은 기록으로 남기고 결과를 항목 아래에 적었습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 이번 세 버전의 공통 주제는 **배포와 운영을 사람 손에서 떼어 내는 것**(v0.35), **선언된 의존성이 아니라 실제로 실리는 의존성을 보는 것**(v0.36), **지금까지 만든 분석을 한 장의 평가서와 회귀 코퍼스로 묶는 것**(v0.37)입니다. 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-04)"에 있습니다.

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

운영 메모(당시): npm trusted publisher 는 0.36.1 에서 등록·첫 OIDC 게시가 됐고, MCP Registry 첫 등록은 v0.37.0 자동 배포로 넘겼습니다.

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

### 브랜치 보호 (소유자 1회)

v0.42 에서 실패한 CI 상태로 병합한 적이 있어(#51), `main` 에 필수 상태 검사 7개를 겁니다. 저장소 소유자가 한 번만 실행합니다.

```cmd
echo {"required_status_checks":{"strict":false,"contexts":["gate (ubuntu-latest, node 18)","gate (ubuntu-latest, node 20)","gate (ubuntu-latest, node 22)","gate (windows-latest, node 18)","gate (windows-latest, node 20)","gate (windows-latest, node 22)","integration (official templates & components)"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}> protection.json
gh api -X PUT repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection --input protection.json
gh api repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection/required_status_checks --jq ".contexts | length"
```

- 마지막 명령이 `7` 이면 적용된 것입니다. 이름은 CI 워크플로의 job 이름과 같아야 하므로, job 이름이나 매트릭스를 바꾸면 이 목록도 같이 바꿉니다.
- `enforce_admins: false` 라 소유자는 긴급할 때 직접 푸시할 수 있습니다. 리뷰 필수는 걸지 않습니다(1인 저장소).
- `Release` 워크플로는 `main` 의 CI 성공 뒤에 돌기 때문에 상태 검사에 넣지 않습니다.

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

- **0.47.0** — 멀티 모듈·MSA 대응(도구 34종 유지). (1) `src/workspace.ts` — `detectWorkspace`(`maven-modules`·`gradle-include`·`independent`·`single`, 모듈별 빌드 도구·packaging·Boot·웹·라이브러리·자체 Dockerfile·작업공간 안 parent 상속), `flattenYaml`. (2) 의존성 점검: 모듈 pom 의 자기 parent 판정·대표 parent, Gradle 버전 변수(`gradleVariables`)·공식 parent `mavenBom`(BOM 관리·parent 버전), 항목 `module`·`workspace.modules`, 독립 프로젝트별 `resolve`. (3) 5.x 최신 유지: Gradle 버전 변수 auto/manual(다른 좌표에도 쓰이면 manual), `update.modules`. (4) `generate_egovframe_deploy` 다중 서비스: `src/deploy-workspace.ts` — 서비스 모듈별 Dockerfile(루트 컨텍스트 `mvn -pl … -am`, 자체 Dockerfile 재사용), `deploy/docker-compose.yml`·`.env.example`·`deploy/k8s/<서비스>.yaml`, `localhost:포트` 치환(`rewriteLocal`·`springEnvName`), 설정 서버 native 저장소 사본 `deploy/config-repo`·ConfigMap, 규칙 `infra`(RabbitMQ·Redis), `server.port=0` 고정, 선택 파라미터 `modules`, 구조화 출력 `workspace`. 단일 프로젝트 분석은 `application.yml` 을 읽고 actuator 프로브 키를 판정합니다. (5) SBOM: 독립 프로젝트별 SBOM 합본(`mergeModuleBoms`, `sbom/modules/*.cdx.json`), 보안약점 `byModule`, 평가서 1절 모듈 표. (6) 테스트: `test:workspace`(55단언, 게이트), `test:workspace-live`(공식 MSA 템플릿 3종·compose 실제 기동, CI 통합). 설계 `docs/design-workspace.md`.
- **0.46.0** — 5.x 최신 유지 + 생성 CI 실행 검증(도구 34종 유지). (1) `migrate_egovframe_project` 의 `target` 에 `5.0.x` 를 받는 갱신 모드: `src/update.ts` — `planPomUpdate`(parent 버전·RTE 버전 속성·`org.egovframe.rte` 리터럴 버전·예전 parent 기본값을 복사한 속성)·`planGradleUpdate`·`findClassReference`(FQN·import·와일드카드 import)·`updateProject`(실효 RTE 버전 = 관리 버전과 리터럴 중 최저, 구간 안의 변경 중 참조하는 것만 `rte-change`, 공통컴포넌트 `component-update`, 3.x/4.x 는 전환 안내)·`applyUpdate`(transaction·백업·`update-plan.json`·fault-injection)·`verifyUpdate`(compile 오류 ↔ 변경 항목)·`renderUpdateMarkdown`. 서버는 `target` 을 `5.x | 5.0.x` 로 받고 구조화 출력에 `update` 를 더했습니다. (2) 규칙 `catalog/update-rules.json` 과 생성기 `scripts/generate-update-rules.mjs`(`generate:update-rules`): `egovframe-runtime` v5.0.0·5.0.1·5.0.2-Final 태그와 단계별 변경 클래스, 공식 parent 2종 × 3버전의 속성·Boot parent, 큐레이션 `catalog/update-mapping.json` 11건(보안 설정 Bean 시그니처·엑셀 수식 주입 방지·XML XXE·파일 경로 검증·약한 기본 암호 경고·테이블 ID 행 잠금·날짜 유틸 검증·리액티브 예외 메시지·엑셀 일괄 등록·HTMLTagFilter·`getTokens` 반환 타입) — 큐레이션 클래스가 그 단계에서 바뀌지 않았으면 생성 실패. 규칙 drift 절차에 재생성 단계 추가. (3) `create_egovframe_project(alignParent=true)`(`alignPom`, dryRun 미리보기 포함), 평가서 2절 "5.x 최신 유지" 요약. (4) CI 실행 검증 `test/ci-run-live.mjs`: 공식 web 템플릿의 생성 `Jenkinsfile` 을 `jenkins/jenkins:2.580.1-lts-jdk21` + 고정 플러그인 56종(`test/fixtures/jenkins/plugins.txt`)·Pipeline from SCM 으로 선언형 검증 후 실행(SUCCESS·5단계·보관 산출물), 생성 `.gitlab-ci.yml` 을 gitlab-ci-local 4.76.1 로 실행(두 job·산출물·SARIF·최소 요소). 배포 전 버전은 `npm pack` 산출물로 실행하고 프록시 뒤 실행(CA·apt https·Maven 설정)을 지원합니다. (5) 테스트: `test:update`(55단언, 게이트), `test:update-live`(공식 web·boot-web 갱신 → compile·기준 미만 6→4·3→1·공급망 C→B 실측 고정, alignParent 생성), `test:ci-run-live`, catalog-drift 절차 4단계, release(규칙 파일 포함·`*-mapping.json` 제외). (6) 패키지에서 생성기 입력 `catalog/*-mapping.json` 을 빼고, `test:release` 의 풀린 크기 상한을 2MB → 2.5MB 로 올렸습니다(0.46.0 은 2.09MB, 압축 상한 600KB 는 그대로). (7) README 에 브랜치 보호 운영 절차(필수 상태 검사 7개).
- **0.45.0** — 컨테이너·배포 산출물(도구 33 → 34종). (1) 새 도구 `generate_egovframe_deploy(projectDir, targets=["docker","compose","k8s"], jdk="17"|"21", imageRegistry="docker.io/library", image?, appName?, buildInImage=true, dockerfilePath="Dockerfile", ingressHost?, dryRun=true, format)`: `src/deploy.ts` — `analyzeDeploy`(빌드 도구·래퍼·war/jar·Boot·웹·actuator 프로브·Tomcat 10.1/11·포트·컨텍스트 경로·DB: `Globals.<type>.Url`/`Globals.Url`/`spring.datasource.url`, 별칭, 초기화 SQL, 지원 안 함 3종), `renderDockerfile`(멀티 스테이지 Maven·Gradle 캐시 마운트·Maven 5xx 재시도·plain 산출물 제외·WAR 풀기·비루트 uid 10001·TZ·UTF-8·MaxRAMPercentage·HEALTHCHECK·`ARG BASE_REGISTRY`·미리 빌드 경로), `.dockerignore`(미리 빌드 시 산출물 화이트리스트), `renderCompose`(DB 컨테이너 mysql 8.4·mariadb 11.4·postgres 16, 초기화 마운트, 헬스체크 후 기동, `.env.example`), `renderClassicConfig`(설정 사본), `renderKubernetes`(ConfigMap·Secret·Deployment 프로브·보안 설정·리소스·Service·Ingress). 규칙 데이터 `catalog/deploy-rules.json`. 새 파일만(하나라도 있으면 무기록), 템플릿 자체 배포 구성 안내. 도구 메타 비읽기·비파괴, outputSchema(13종), 영문 설명, AGENTS.md. (2) 테스트: 신규 `test:deploy` 49단언(게이트, 공식 Compose 스키마 고정물), `test:deploy-live`(CI 통합: hadolint 2.14·kubeconform 0.7 sha256 고정 다운로드, 공식 web·boot-web 빌드·기동·헬스·비루트, simple-backend compose + MySQL 데이터 확인, `DEPLOY_LIVE_PREBUILT=1` 로 미리 빌드 경로), `output-schemas`·`handshake` 34종·13종. 설계: [docs/design-deploy.md](docs/design-deploy.md). `server.json` 0.45.0.
- **0.44.0** — 보안약점 점검(도구 32 → 33종). (1) 새 도구 `check_egovframe_secure_coding(projectDir, rules?, paths?, includeTests=true, baselinePath?, sarifPath?, overwrite=false, maxFindings=2000, top=40, format="markdown"|"json"|"sarif")`: `src/secure-coding.ts` — 규칙 데이터 `catalog/secure-coding-rules.json`(schemaVersion 1, 20종·가이드 항목 14개, 유형·CWE·등급·대상·패턴·`unless`·`fileHas`/`fileLacks`·`downgrade`/`escalate`/`requireNear`·`stripCustomTags`·`scope`), Java 주석 렉서·XML/JSP 주석 제거(줄 수 유지), 대상 판별(java·jsp·mapper·sqlmap·config, 메시지 번들 제외), 테스트 코드 등급 낮춤, 출처(매니페스트 해시로 원본·수정본·매니페스트 없음·프로젝트·테스트), 예외 파일 `.egovframe-secure-ignore.json`(사유 5자 이상·검토자 필수, glob·라인), 지문(규칙·파일·정규화한 줄·순번)과 baseline(JSON·SARIF), SARIF 2.1.0(규칙·CWE taxonomy·security-severity·partialFingerprints) 기록(transaction, overwrite). 도구 메타 비읽기·비파괴·멱등, outputSchema(12종), 영문 설명, AGENTS.md. (2) 평가서 4절에 보안약점 요약(등급 산식 미반영), 회귀 코퍼스 기대값에 규칙별 건수(`scripts/corpus-lib.mjs` `secure`), `catalog/migration-corpus.json` `secureTemplates`. (3) CLI `secure`(명령 11종, 지표 high·medium·low·total·new), `generate_egovframe_ci(secureCoding=true)` — 세 플랫폼 게이트에 `secure --fail-on high` 단계, GitHub 은 `security-events: write`·`upload-sarif`(continue-on-error), GitLab·Jenkins 는 SARIF 보관. (4) 테스트: 신규 `test:secure-coding` 52단언(게이트, OASIS SARIF 2.1.0 스키마 고정물)·`test:secure-live`(CI 통합: 공식 템플릿 건수·SARIF 스키마), `test:ci` 에 secureCoding(GitHub 권한·업로드, GitLab 스키마, Jenkins 단계), `output-schemas`·`handshake` 33종·12종, `cli` 11종, CI 통합의 actionlint 대상 워크플로에 SARIF 업로드 포함. 설계: [docs/design-secure-coding.md](docs/design-secure-coding.md). `server.json` 0.44.0.
- **0.43.0** — CI·제출 형식 다변화: GitLab·Jenkins, SPDX(도구 32종 유지). (1) `generate_egovframe_ci` 에 `platform="github"|"gitlab"|"jenkins"`: `src/ci-config.ts` — `generateGitlabCi`(`.gitlab-ci.yml`, `maven:3.9-eclipse-temurin-<JDK>`·`eclipse-temurin:<JDK>` 이미지, 로컬 저장소 캐시, JUnit 리포트, `supply-chain` job 은 `needs: []`·Node 준비·`artifacts:reports:cyclonedx`)·`generateJenkinsfile`(Declarative — options·environment·`Build`/`SBOM`/`SBOM check`/`Assessment` 단계·`post { always { archiveArtifacts } }`, `isUnix()` 로 `sh`/`bat`), 세 플랫폼 공통 게이트 명령 `supplyChainCommands`(sbom → **`sbom-check --fail-on minimum`**(GitHub 게이트에도 추가) → assess), 새 파라미터 `supplier`(SBOM 공급자)·`npmRegistry`(`NPM_CONFIG_REGISTRY`)·`offlineBundle`(`EGOVFRAME_OFFLINE_BUNDLE`) — 모두 형식 제한으로 설정 파일 주입 차단, 공급자 단서가 없으면 게이트 실패 예고(`notes`). (2) SPDX 2.3: `src/spdx.ts` — `cdxToSpdx`(패키지·`DESCRIBES`·`DEPENDS_ON`(의존 없음 `NONE`)·purl/cpe/swid externalRefs·supplier/originator·creators·created·체크섬·선언 라이선스(`LicenseRef-` + `hasExtractedLicensingInfos`)·OSV 권고 `SECURITY`/`advisory`·`egovframe:*` annotations, serialNumber UUID 로 결정적 namespace)·`spdxToCdx`(점검용, `*_DEPENDENCY_OF` 뒤집기·`NOASSERTION` 은 모름). `generate_egovframe_sbom(bomFormat="spdx-json")`(기본 경로 `sbom/bom.spdx.json`, 최소 요소는 SPDX 를 되읽어 판정), `check_egovframe_sbom` 이 CycloneDX·SPDX 2.x 자동 판별(`document.format`, 형식이 다른 baseline 은 purl 로 비교, SPDX 의 `vex=true` 는 거부). CLI `sbom --bom-format spdx-json`. (3) 테스트: 신규 `test:spdx` 43단언(게이트, 공식 spdx-spec v2.3 스키마 고정물), `test:ci` 에 GitLab 공식 CI 스키마(gitlab v19.4.1-ee 고정물, devDependency `yaml`)·Jenkinsfile 구조·주입 거부, `test:sbom-live`(CI 통합)에 실제 Maven SBOM 의 SPDX 스키마·판정 일치, `test:sbom-check` 의 비 CycloneDX 거부 단언을 SPDX 3.0 등으로 갱신. (4) CI: integration job 의 Maven 이 원격 저장소 5xx(502 등)를 3초 간격 최대 5회 재시도(#53). (5) `generate_egovframe_sbom`: cyclonedx-maven-plugin 출력에 `metadata.timestamp` 가 없으면(CI 러너에서 실측) 생성 시각으로 채우고 알림 — v0.40 이후 간헐적이던 sbom-live 최소 요소 실패의 원인. `server.json` 0.43.0.
- **0.42.0** — 폐쇄망 오프라인 번들(도구 31 → 32종). (1) 새 도구 `prepare_egovframe_offline_bundle(outputDir, include=["osv","components","templates","origin"], templates?, dryRun=true, format)`: `src/offline-bundle.ts`·`src/offline-bundle-plan.ts` — OSV Maven 전체 덤프(`osv-vulnerabilities/Maven/all.zip`, 레코드 수·원본 갱신 시각 기록), 카탈로그 고정 커밋의 공통컴포넌트 아카이브(sha256·크기 검증), 템플릿(기본: 고정 지문이 있는 Initializr zip 12종, 저장소 템플릿은 지정 시 codeload zip), 공식 공통컴포넌트 태그 전부의 내용 포함 bare 미러(`git fetch --depth 1 +refs/tags/*`)를 임시 디렉터리에 받아 `bundle-manifest.json`(schemaVersion 1, 파일별 path·kind·url·sha256·bytes·fetchedAt)과 함께 새(또는 빈) 디렉터리로 옮김, 고정 지문 불일치·실패 시 무흔적. 도구 메타 비읽기·비파괴·openWorld, outputSchema(11종), 영문 설명, AGENTS.md 도구 목록. (2) `EGOVFRAME_OFFLINE_BUNDLE`: `fetchWithTimeout`(GET)과 카탈로그 아카이브 다운로드가 manifest 의 같은 URL 을 지문 검증 후 번들에서 돌려줌(변조 거부, 프로세스당 1회 검증), `defaultOsvQuery` 가 로컬 덤프로 판정(`buildOsvIndex`·`queryOsvIndex`·`inOsvRange`·`compareMavenVersions` — Maven ComparableVersion 요지, `versions` 목록 또는 ECOSYSTEM 범위, 철회 제외), `GitOriginSource` 가 번들 미러를 씀(`for-each-ref` 태그 목록, 원격 fetch 없음, 없는 태그 안내), OSV 를 쓴 결과(의존성 점검·SBOM 생성·SBOM 점검)에 스냅숏 기준일 노트와 30일 경고(`EGOVFRAME_BUNDLE_MAX_AGE_DAYS`). (3) `diagnose_egovframe_network` 가 실패 시 오프라인 번들 처방(bash·cmd·PowerShell)과 사용 중 표시, CLI `bundle`(`--write` 로만 받음, `--output-dir` 는 현재 디렉터리 기준), `server.json` 환경변수 `EGOVFRAME_OFFLINE_BUNDLE`(4종). (4) 테스트: 신규 `test:offline-bundle` 30단언(게이트)·`test:bundle-live`(CI 통합: 실제 번들, 로컬 OSV = 온라인, fetch 차단 상태의 생성·조립·재조립·SBOM 재점검), `registry` 환경변수 4종, `output-schemas`·`handshake` 32종·11종, `cli` 명령 10종. 설계: [docs/design-offline-bundle.md](docs/design-offline-bundle.md). (5) 런타임 의존성 `handlebars` 4.7.9 → 4.7.10(GHSA-xw65-4hp5-5hc7·GHSA-8r5x-fm3f-whwj·GHSA-p8wg-vrv2-v86f, `npm audit --omit=dev` 게이트). `server.json` 0.42.0.
- **0.41.0** — 전환 리허설(도구 30 → 31종). (1) 새 도구 `rehearse_egovframe_migration(projectDir, steps=["reassemble","migrate","verify","align-pom"], components?, sourceTag="auto", keepWorkspace=false, timeoutMs=900000, topN=20, format)`: `src/rehearse.ts` — 사본(`EGOVFRAME_CACHE_DIR/rehearsal`, 빌드 산출물·VCS·백업 제외, 작업 디렉터리가 프로젝트 안이면 거부)에서 재조립 → 전환 적용 → 컴파일(Maven 은 `-Dmaven.compiler.fork=true`·`JDK_JAVAC_OPTIONS=-Xmaxerrs 100000`) → `alignPomToReference`(공식 공통컴포넌트 고정 태그 pom 기준: parent 추가·교체, 누락 좌표 추가(test 제외), 버전·scope 정렬, parent 가 정의하는 속성의 프로젝트 재정의 삭제, 주석·dependencyManagement·plugin·profiles 제외, 멱등) → 컴파일. `analyzeErrors`(누락 패키지 — "package X does not exist"·symbol 의 package·파일 import 문으로 찾은 타입의 패키지, 연쇄 — 같은 파일·누락 패키지가 있는 파일이 선언한 타입의 멤버·Lombok 생성 멤버, 기타; 연쇄는 파일의 첫 누락 패키지에 귀속, 후보 좌표 `packageHint`, 기타 오류는 수동 항목·규칙과 연결, 디렉터리·파일 상위), 작업 목록(pom 맞춤이 없애는 오류 수 → 누락 패키지 → 파일), pom 패치(400줄 상한), 실행 전후 지문(`fingerprintTree`)으로 원본 불변 확인, 단계 실패는 기록하고 계속, 최근 결과를 `rehearsal/records/<경로 해시>.json` 에 저장. 도구 메타 비읽기·비파괴·멱등·openWorld, outputSchema(10종), 영문 설명, AGENTS.md 도구 목록. (2) 평가서 6절에 최근 리허설 실측(등급 산식과 별개), 맺음말의 재조립 안내를 `reassemble_egovframe_components`(전환 적용보다 먼저)로 정정. (3) CLI `rehearse`(지표 `errors`·`automation`·`aligned`·`files`·`unlinked`·`failedSteps`). (4) 수정: `parseBuildErrors` 가 Maven `[WARNING]`·javac 린트 경고(`[removal]` 등) 줄을 오류로 세던 문제와 fork 형식의 `error:` 접두, 4.x 의 `org.egovframe.rte` 좌표(버전 4.*)를 5.x 세대로 분류하던 문제(재조립 후보 태그가 5.x 로만 좁혀짐). `runBuild(extraArgs, env)`·`ResolvedCommand.env`, pom 에 소스 인코딩이 없으면 리허설 컴파일에 UTF-8. (5) 테스트: 신규 `test:rehearse` 42단언(게이트)·`test:rehearse-live`(CI 통합: 공식 v4.3.2 전체 트리 리허설 기대값 `catalog/migration-corpus.json` 의 `rehearsal`), `test:output-schemas` 54·`handshake` outputSchema 10종·`test:cli` 명령 9종. 설계: [docs/design-migration.md](docs/design-migration.md) 리허설 절. `server.json` 0.41.0.
- **0.40.0** — SBOM 운영: 최소 요소·비교·VEX(도구 29 → 30종). (1) 새 도구 `check_egovframe_sbom(projectDir, sbomPath="sbom/bom.cdx.json", baselinePath?, offline=true, vex=false, vexPath="sbom/vex.cdx.json", dryRun=false, format)`: `src/sbom-check.ts` — 최소 요소 7종(`catalog/sbom-rules.json`: 공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각, 출처 NTIA 2021·SW 공급망 보안 가이드라인 1.0)을 주 component 포함 component 마다 세어 `ready`/`needs-work`·빠진 component(최대 20)·힌트, purl 만으로 v0.34 분류기 재판정(SBOM 의 `egovframe:status` 와 다른 것)과 OSV 재조회(`newIds`·`goneIds`, SBOM 에 기록이 없으면 "미기록"으로 표시), `baselinePath` 비교(groupId:artifactId 기준 추가·제거·버전·판정 변화·새/사라진 취약점), `vex=true` 면 CycloneDX VEX(`analysis.state=in_triage`, `affects` 는 BOM-Link `urn:cdx:<serial>/<version>#<bom-ref>`, serial 이 없으면 bom-ref) — 기존 VEX 의 판단·임의 필드 보존, in_triage 항목은 affects 덧붙임, 판단 끝난 ID 의 새 영향은 별도 항목, 탐지되지 않는 ID 는 지우지 않고 `notDetected`, 변경 없으면 파일 그대로, 깨진 VEX 는 중단. SBOM 은 바꾸지 않고 VEX 만 transaction 으로 기록. 도구 메타 비읽기·비파괴·openWorld, outputSchema(9종), 영문 설명, AGENTS.md 도구 목록. (2) `generate_egovframe_sbom(supplier, author, componentName, componentVersion, fillSuppliers)`: `metadata.supplier`·주 component `supplier`·`metadata.authors`(기본 pom `<organization><name>`), `metadata.lifecycles`(build), 공급자 없는 component 를 공급자 표로 보완(`egovframe:supplierBasis=catalog`), 응답 `minimum` 요약. `enrichBom` 재실행이 `egovframe:status·basis·baseline` 만 갱신하도록(다른 `egovframe:*` 보존). (3) 평가서 5절에 최소 요소 판정·VEX 항목/상태/마지막 점검 시각. (4) CLI `sbom-check`(지표 `minimum`·`gaps`·`changed`·`vulnerabilities`·`newVulns`·`added`·`removed`·`versionChanged`·`diffVulns`·`triage`, `--write` → VEX, `--vex` 직접 지정 차단). (5) 테스트: 신규 `test:sbom-check` 54단언(게이트, 실제 플러그인 출력 고정물·CycloneDX 1.6.1 공식 스키마 검증 — devDependencies `ajv`·`ajv-formats`), `test:sbom` 41·`test:cli` 36·`test:assessment` 57·`test:output-schemas` 53 단언, `handshake` outputSchema 9종, `test:sbom-live` 에 실제 SBOM 최소 요소·보강·비교·OSV VEX·판단 보존. 설계: [docs/design-dependency-check.md](docs/design-dependency-check.md) SBOM 운영 절. `server.json` 0.40.0.
- **0.39.0** — CLI 모드 + CI 공급망 게이트(도구 29종 유지). (0) upstream 이 2026-10-07 `v5.0.7` 태그를 `3756ab2` → `7912e13` 으로 옮겨(README·권한 그룹·북마크 메뉴 컨트롤러·메뉴 이동 JSP 수정 3파일 추가) 카탈로그 고정 검증이 실패했으므로 컴포넌트 카탈로그(아카이브 sha256 `a1a4b9a7…`, 46,904,430 bytes, 6,604 files)와 전환 규칙의 `components.toCommit` 을 새 커밋으로 재고정했습니다(판정·코퍼스 기대값 변화 없음). (1) `src/cli.ts`: `npx egovframe-scaffold-mcp <assess|check|sbom|migrate|validate|diagnose|network> [옵션]` — 인자 없는 실행은 기존 stdio 서버(`index.ts` 분기), 명령은 같은 프로세스의 서버에 `InMemoryTransport` 로 붙은 클라이언트가 `tools/call`(입력 검증·허용 root·outputSchema 검증 동일). 옵션은 도구 파라미터 이름(kebab-case, `tools/list` JSON Schema 로 형 변환), 공통 `--project`·`--json`(structuredContent)·`--out`·`--step-summary`·`--fail-on`·`--write`, 쓰기 옵션 차단(`migrate --apply`·`sbom --dry-run` 등). `--fail-on` 식(`metric`·`metric>N`·`metric>=N`·`grade:C`, 명령별 지표), 종료 코드 0/2/3/64, 본문 stdout·한 줄 요약 stderr, `--help`·`--version`. (2) `generate_egovframe_ci(supplyChain, failOn="supplyChain:D", osv=true)`: SBOM → 평가서(`--step-summary`) → 아티팩트(`if: always()`) 게이트 job, 패키지 버전 고정, `failOn` 형식 제한(`CI_FAIL_ON_RE`, YAML 주입 차단). (3) `@modelcontextprotocol/sdk` 1.29 → 1.32.1. (4) 테스트: 신규 `test:cli` 32단언(게이트), `test:ci` 공급망 게이트·주입 거부, CI 통합에 생성 워크플로 `actionlint` 1.7.7 검사와 코퍼스 트리 CLI 평가서(job 요약). 설계: [docs/design-cli.md](docs/design-cli.md). `server.json` 0.39.0.
- **0.38.0** — 공통컴포넌트 재조립 실행(도구 28 → 29종). (1) 새 도구 `reassemble_egovframe_components(projectDir, components?, sourceTag="auto", database?, dryRun=true, verify=false, timeoutMs, format)`: `src/component-origin.ts`(공식 `egovframe-common-components` 의 blob 없는 bare 미러 `GitOriginSource` — 태그별 `--depth 1 --filter=blob:none` fetch·`ls-tree`·지연 `cat-file`, 테스트용 `MemoryOriginSource`, `gitBlobId`·CRLF 정규화 `blobIdsOf`, 캐시 `EGOVFRAME_CACHE_DIR`)와 `src/reassemble.ts`(대상 컴포넌트 선정 — 감지 컴포넌트·그룹 펼침·매니페스트 관리 컴포넌트 거부, 최장 접두어 소유 판정, 좌표 세대별 후보 태그 점수·동점은 높은 버전·짧은 이름, 8가지 판정과 5가지 처리, 목표 내용의 blob 검증, 하나의 transaction 으로 교체·추가·삭제·백업·자산 참고본·패치·SQL·매니페스트·`reassemble-plan.json`, `verify` 컴파일 오류를 작업 목록에 연결, Markdown·outputSchema). 도구 메타 destructive·openWorld(5종), 영문 설명, `server.json` 환경변수 `EGOVFRAME_CACHE_DIR`. `ProjectFileTransaction.removeFile`(rollback 시 복원), `buildComponentSqlPlan` 분리(조립·재조립 공유). (2) **공통컴포넌트 v5.0.7**: 컴포넌트 카탈로그(`generate-catalog.mjs --archive-sha256/--archive-bytes` 로 codeload 아카이브 지문 고정, sha256 `44a518c1…`, 46,903,152 bytes, 6,604 files), 전환 규칙 `components.toTag` v5.0.7(제거 55·이동 4), `migrate_egovframe_project` 의 재조립 권고가 새 도구를 안내. (3) 수정: `upgrade_egovframe_project` 가 컴포넌트 자산 파일(메시지·IDGN·웹 자산 등)을 upstream 비교에 넣지 않아 전부 "removed" 로 보고하던 결함, `sync_egovframe_catalog` 의 GitHub API 호출이 만료 토큰(401)이면 비인증으로 재시도. 0.37.0 배포 전 `main` 에 들어간 CI 수정(카탈로그 검증 GitHub API 인증, `proxy-addr` 2.0.8, drift 감시 비차단·탐침 재시도)도 이 버전 기록에 남깁니다. (4) 테스트: 신규 `test:reassemble` 46단언(게이트)·`test:reassemble-live`(CI 통합), `test:migrate-corpus` 에 공식 트리 재조립 미리보기(원본 100%·사용자 수정 0), `output-schemas`·`handshake` 29종·outputSchema 8종·destructive 5종, `registry` 환경변수 3종. 설계: [docs/design-migration.md](docs/design-migration.md) 재조립 절. `server.json` 0.38.0.
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
