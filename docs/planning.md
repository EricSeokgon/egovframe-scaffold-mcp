# 기획·로드맵 기록

버전별 기획 원문과 결과, 선행 조사를 그대로 남긴 기록입니다. 현재 사용법은 [README](../README.md), 변경 내용은 [CHANGELOG](../CHANGELOG.md)를 보세요.

## 진행 현황 (버전별 요약) (2026-10-27)

- **소스 기준**: v1.8.0(`package.json`), 도구 36종 + CLI 명령 13종·공식 템플릿 22종·설정 템플릿 21종·카탈로그 190항목(공통컴포넌트 v5.0.7).
- **안전성 기준선 완료**: [PR #7](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/7)~[#16](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/16)을 반영해 provenance·strict assertion·safe remove와 프로젝트 생성/레시피/직접 조립/AI 조립/업그레이드 transaction을 갖췄습니다.
- **v0.22.0 추가**: `EGOVFRAME_ALLOWED_ROOTS`를 19개 도구 진입점에 적용해 `..`·symlink/junction 이탈을 차단하고, 실패 시 rollback 결과를 구조화해 반환합니다. [PR #16](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/16)은 7파일(+340/−31), 로컬 16종 스위트 전체 통과 후 병합됐습니다.
- **v0.23.0 추가**: `build_egovframe_project` — 생성한 프로젝트를 실제로 빌드(maven/gradle·mvnw/gradlew 자동 감지)하고 컴파일·테스트 오류를 파일/라인 단위로 구조화해 생성→검증 루프를 완성합니다. 타임아웃·로그 상한·허용 root·dryRun 포함. [PR #18](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/18)은 4파일(+458/−3), 오프라인 40단언과 실제 spawn 경로를 검증했습니다.
- **v0.24.0 추가**: 공식 템플릿 커버리지 7 → 10종(`msa-common-components`·`mobile-device-api`·`ai-rag`, 모두 멀티 프로젝트). [PR #19](https://github.com/EricSeokgon/egovframe-scaffold-mcp/pull/19).
- **v0.25.0 추가**: `test_egovframe_project` — 테스트를 실행하고 빌드도구가 남기는 JUnit XML 리포트(surefire·gradle)를 읽어 스위트·케이스 단위로 결과를 구조화합니다. 실패 케이스의 메시지·예외 타입·테스트 파일/라인, `testFilter`(클래스/메서드 패턴), 이전 실행 리포트 제외, 종료 코드가 0이어도 리포트에 실패가 있으면 실패로 판정. 오프라인 54단언(`npm run test:test`).
- **v0.25.2 추가**: 보안·안정성 보강 — `generate_egovframe_ci`의 `jdk` 입력 검증(생성 YAML 주입 차단), 빌드·테스트 타임아웃 시 프로세스 트리 종료(래퍼가 띄운 JVM 때문에 타임아웃이 걸려도 호출이 끝나지 않던 문제 해결), MCP handshake 서버 버전을 `package.json`과 일치, 의존성 갱신으로 `npm audit` 0건.
- **v0.25.3 추가**: Linux·macOS에서 `npx egovframe-scaffold-mcp`(bin symlink 경유) 실행 시 서버가 기동하지 않고 종료되던 문제 수정, CI를 ubuntu·windows × Node 18·20·22 매트릭스로 확장.
- **v0.26.0 추가**: `sync_egovframe_templates` + `catalog/templates.json` — 그동안 Initializr(프로젝트 22종 zip 카탈로그)·MCP(`TEMPLATES` 10종 저장소 조달)·Development(`wizards.xml` 설정 마법사)에 흩어져 있던 "어떤 공식 프로젝트가 있는가"를 하나의 스키마로 합쳤습니다. 매핑은 `catalog/template-mapping.json` 에서 큐레이션하고(자동 추론 없음), upstream 과의 추가·삭제·변경과 MCP 커버리지 격차(현재 22종 중 9종 대응)를 도구로 조회합니다. 오프라인 148단언(`npm run test:template-catalog`).
- **v0.27.0 추가**: 공식 템플릿 커버리지 10 → **22종**(Initializr 22종 기준 대응 9 → 21종). 단독 저장소가 없는 배치 6종·빈 골격(`web`·`boot-web`)·모바일 2종·MSA 포털 2종을 Initializr 의 zip(Git LFS)으로 조달하며, commit 과 sha256·크기를 고정해 내려받은 바이트를 검증합니다. `sync_egovframe_templates` 가 zip 지문의 upstream 변화도 함께 보고합니다(설계: [docs/design-initializr-zip-templates.md](design-initializr-zip-templates.md)).
- **v0.28.0 추가**: `generate_egovframe_config` — 공식 Initializr 설정 템플릿 21종(datasource·transaction·cache·logging·scheduling·idGeneration·property)을 패키지에 동봉해 **오프라인**으로 Spring 설정 파일을 생성합니다. xml·javaConfig·yaml·properties 형식, Initializr 폼과 같은 필드명·기본값, 기존 파일 보호. 리소스 `egovframe://catalog/config-templates` 로 필드·기본값·선택지를 조회할 수 있고, `sync_egovframe_templates` 가 동봉 템플릿의 upstream 변화를 보고합니다(설계: [docs/design-config-generation.md](design-config-generation.md)).
- **v0.29.0 추가**: `migrate_egovframe_project` 1단계 — 3.x/4.x 프로젝트를 5.x(Jakarta EE 9+, Spring 6, Java 17) 기준으로 스캔해 RTE Maven 좌표·패키지·제거/이동 클래스·`javax→jakarta`·web.xml 스키마·제거된 `egov-*` XML 네임스페이스·교체 필요 라이브러리를 파일·라인 단위로 보고합니다(**읽기 전용**, auto/manual 구분). 규칙은 `egovframe-runtime` 태그(v3.10.0·v4.3.0-Final·v5.0.2-Final) 소스 트리 비교로 생성한 `catalog/migration-rules.json` 에 두고, 목적지 좌표 61건이 실제 Maven 저장소에 있음을 CI 에서 확인합니다. 공식 5.x 템플릿 2종에서 항목 0건(설계: [docs/design-migration.md](design-migration.md)).
- **v0.30.0 추가**: `migrate_egovframe_project` 2단계(`apply=true`) — 진단의 auto 항목을 하나의 transaction 으로 실제 치환합니다(dryRun 기본, 원본 `migration-backup/` 보관, `migration-plan.json`, 실패 시 복구). 3.10 좌표·javax 픽스처를 적용한 뒤 JDK 17 `mvn compile` 통과를 CI 에서 확인합니다. `check_egovframe_dependencies` — 공식 5.x parent 2종에서 추출한 기준(관리 좌표 139종 + BOM 계열 7종, `catalog/dependency-baseline.json`)과 의존성을 대조해 기준 충족/미만/parent 관리/전환 대상/교체 필요/기준 없음으로 분류하고, 보안 설정(sec.security·CSRF·XSS 필터·보안 헤더·HTTPS 저장소) 존재 여부를 근거와 함께 보고합니다. 기본 오프라인, `offline=false` 면 OSV 취약점 조회(설계: [docs/design-dependency-check.md](design-dependency-check.md)).
- **v0.31.0 추가**: 운영 편의 — `diagnose_egovframe_network`(도구가 쓰는 호스트 7종에 DNS·HEAD 프로브, 실패 종류 분류, HTTPS_PROXY+NODE_USE_ENV_PROXY·IPv4 우선·사내 CA 처방을 bash/cmd/PowerShell 명령으로), 모든 다운로드 실패 메시지에 같은 처방 한 줄 부착, `generate_agents_md`(진단 결과로 AI 코딩 도구용 AGENTS.md, ko/en), 영문 README(`README.en.md`)와 `EGOVFRAME_LANG=en` 영문 도구 설명, MCP Registry 메타데이터(`server.json`·`mcpName`). 기획 3개 버전(v0.29–v0.31)이 모두 완료됐습니다.
- **v0.32.0 추가**: MCP 프로토콜 현대화 — 도구 27종을 `registerTool` 로 전환해 `title`(ko/en)과 annotations(`readOnlyHint` 14종·`destructiveHint` 4종·`idempotentHint`·`openWorldHint`)를 `tools/list` 에 노출하고, `format=json` 을 제공하던 5종(`diagnose_egovframe_project`·`validate_egovframe_project`·`migrate_egovframe_project`·`check_egovframe_dependencies`·`diagnose_egovframe_network`)은 `outputSchema` 와 `structuredContent` 를 함께 돌려줍니다(기존 `text` 유지). 테스트 이식성 가드(`scripts/check-test-portability.mjs`, 게이트 포함)와 플랫폼 주입 단언으로 Windows 전용 실패 재발을 막습니다.
- **v1.5.0 추가**: 보안약점 점검 정밀화 — 메서드 안 데이터 흐름(`src/java-flow.ts`)으로 요청 값이 SQL·파일 경로·OS 명령·리다이렉트에 들어가면 등급을 올리고 상수만이면 내리며, 변수를 거친 흐름도 찾습니다(SARIF `codeFlows`). 표본 정밀도(높음) 33% → 100%.
- **v1.4.0 추가**: Initializr v5.0.7 정렬 + DDL 기반 CRUD — `generate_egovframe_crud(ddl, dialect, search)` 가 CREATE TABLE 문을 공식 Initializr v5.0.7 과 같은 경계로 해석하고, 방언 중립 LIKE(`<bind>`) 검색과 이스케이프된 검색 필드를 만듭니다. Initializr 고정 commit 을 v5.0.7 태그로 옮기고 설정 템플릿 3개의 upstream 수정을 반영했습니다.
- **v1.3.0 추가**: 표준프레임워크 5.1.0 대응 — 저장소에 배포된 5.1.0(GitHub 태그 없음)을 parent 계열별 의존성 기준(`dependency-baseline-5.1.json`, BOM `egovframe-rte-root` 전개)과 `target="5.1.0"` 갱신 규칙(저장소 sources jar 비교, 근거 `maven-sources`)으로 지원하고, `-egov.N` 재빌드 좌표를 원 버전으로 비교·OSV 조회합니다. 기본 목표는 태그가 나올 때까지 5.0.2.
- **v1.2.0 추가**: 응답 영문화 + 진행 알림(도구 35종 유지) — `EGOVFRAME_LANG=en`·CLI `--lang en` 이 평가서·전환·의존성·SBOM 생성/점검·보안약점(SARIF 포함)·배포·납품·리허설 응답과 CLI 요약·오류·usage 를 영문으로 냅니다(`src/lang.ts` 의 `L(ko, en)`·`tr()`, 규칙 데이터 7파일의 `<필드>_en`, 생성기가 누락을 실패시킴). 한국어 출력은 goldens(`test/fixtures/i18n-golden-ko.json`)와 바이트 단위로 같습니다. 장시간 도구 8종(빌드·테스트·`resolve=true` 점검·SBOM·재조립·리허설·오프라인 번들·납품)은 클라이언트가 `progressToken` 을 주면 `notifications/progress` 를 단계별로 보내고, `notifications/cancelled` 는 자식 프로세스 트리를 끝내고 트랜잭션을 되돌립니다(`src/progress.ts`). 설계: [docs/design-i18n.md](design-i18n.md).
- **v1.1.0 추가**: 납품 패키지 — 새 도구 `prepare_egovframe_delivery`(35번째)가 평가서·의존성 조치 목록·SBOM(CycloneDX·SPDX)·SBOM 점검과 VEX 초안·보안약점(SARIF)·배포 산출물을 새 디렉터리 하나에 모으고 `delivery-manifest.json`(파일별 sha256·입력 지문·rootHash)과 목차를 씁니다. 이전 차수와 비교(`previousDelivery` → `diff.md`), 받은 패키지 재검증(`verify=true`, CLI `deliver --verify`), `generate_egovframe_ci(delivery=true)`. 공식 web 템플릿 실측 21초·SBOM 67 component. 설계: [design-delivery.md](design-delivery.md).
- **v1.0.0 (안정화)**: 0.x 를 끝내고 공개 API 를 고정했습니다 — [버전 정책](versioning.md)(SemVer 2.0)이 도구 이름·입력 파라미터·구조화 출력 13종·CLI 명령과 종료 코드·환경 변수·지원 Node 를 공개 API 로 정하고, MAJOR·MINOR·PATCH 기준과 폐기 절차를 둡니다. 새 게이트 `test:api-contract` 가 계약 스냅샷(`test/fixtures/api-contract.json`)과 비교해 변경을 minor·major 로 분류하고, `test:release` 가 버전 증가 폭이 모자라면 배포를 막습니다. 1.0 전 이름 정리로 `check_egovframe_secure_coding` 의 `top` 을 다른 도구와 같은 `topN` 으로 바꿨습니다(`top` 은 2.0.0 까지 경고와 함께 계속 받음). 지원 Node 는 22 이상(18·20 지원 종료)이고, CI 는 ubuntu·windows × Node 22·24 입니다. 새 기능은 없으며 도구는 34종 그대로입니다.
- **v0.47.0 추가**: 멀티 모듈·MSA 대응 — 새 `src/workspace.ts` 가 Maven `<modules>`·Gradle `include`·루트 빌드 파일 없는 독립 프로젝트 묶음을 탐지하고(라이브러리 모듈·작업공간 안 parent 상속 판정), 의존성 점검·5.x 최신 유지·SBOM·보안약점·평가서가 모듈별 결과와 합계를 냅니다. 공식 MSA 템플릿에서 의존성 판정은 `msa-edu` 0 → 280건·`msa-portal-backend` 0 → 256건, `msa-common-components` 의 "버전 없음" 152 → 0(모듈 parent 관리)이 되었습니다. Gradle 버전 변수(`set('egovframeBootParentVersion', …)`)는 공식 parent·RTE 에만 쓰이면 auto, 다른 좌표(`egovframe-cloud-module-common`)에도 쓰이면 manual 입니다. `generate_egovframe_deploy` 는 서비스 모듈마다 이미지(자체 Dockerfile 재사용)와 하나의 compose·서비스별 Kubernetes 매니페스트를 만들고, 설정의 `localhost:포트` 를 서비스·DB·RabbitMQ·Redis 이름으로 바꿉니다(모듈 설정은 Spring 환경 변수, 설정 서버 native 저장소는 `deploy/config-repo` 사본). 선택 파라미터 `modules` 로 일부 서비스만 고릅니다. CI 통합에서 `msa-common-components` 를 5.0.2 로 갱신·빌드해 ConfigServer·EurekaServer·GatewayServer·EgovBoard 를 compose 로 띄우고 Eureka 등록·Gateway health UP 을 확인합니다. 도구 수는 34종 그대로입니다. 설계: [docs/design-workspace.md](design-workspace.md).
- **v0.46.0 추가**: 5.x 최신 유지와 생성 CI 실행 검증 — `migrate_egovframe_project(target="5.0.2")` 가 이미 5.x 인 프로젝트를 최신 5.0.x 로 맞춥니다. parent·RTE 버전 속성·RTE 의존성 리터럴 버전은 auto, 그 사이 바뀐 RTE API·동작(보안 설정 `@Bean` 시그니처·엑셀 수식 주입 방지·XML XXE 차단·테이블 ID 생성 행 잠금 등 11건)을 프로젝트가 참조하는 곳과 공통컴포넌트 최신 유지 안내는 manual 이고, `apply`·`verify` 는 전환과 같습니다. 규칙은 `egovframe-runtime` 5.0.0·5.0.1·5.0.2 태그와 공식 parent pom 으로 만든 `catalog/update-rules.json` 입니다. 공식 web·boot-web 템플릿(parent 5.0.0)은 갱신 뒤 JDK 17 compile 이 통과하고, 의존성 기준 미만이 6 → 4·3 → 1, 공급망 등급이 C → B 가 됩니다. `create_egovframe_project(alignParent=true)` 는 생성 직후 같은 갱신을 적용하고, 평가서 2절에 "5.x 최신 유지" 요약이 붙습니다. 생성 `Jenkinsfile` 은 공식 Jenkins LTS(플러그인 56종 버전 고정)에서 선언형 문법 검증 후 실제로 실행해 모든 단계 성공·산출물 보관을, 생성 `.gitlab-ci.yml` 은 gitlab-ci-local 로 build·supply-chain job 성공·산출물을 CI 에서 확인합니다. 도구 수는 34종 그대로입니다.
- **v0.45.0 추가**: 컨테이너·배포 산출물 — 새 도구 **`generate_egovframe_deploy`**(34번째)가 진단(빌드 도구·war/jar·Boot·웹·actuator·DbType·설정 파일)으로 Dockerfile(멀티 스테이지 Maven/Gradle 빌드 → Classic war 는 Tomcat 10.1 에 ROOT 로 풀어서, Boot jar 는 Temurin JRE — 비루트·HEALTHCHECK·Asia/Seoul·UTF-8, `buildInImage=false` 면 미리 빌드한 산출물), `deploy/docker-compose.yml`(앱 + DbType 별 mysql·mariadb·postgres 컨테이너, 템플릿 DDL·DATA 초기화), Kubernetes 매니페스트(Deployment 프로브·비루트 securityContext·리소스, Service, ConfigMap, Secret, 선택 Ingress)를 만듭니다. DB 설정은 Boot 는 Spring 환경 변수(`Globals.mysql.Url` → `GLOBALS_MYSQL_URL`), Classic 은 `globals.properties` 사본을 볼륨·Secret 으로 덮어쓰고, 기반 이미지는 `imageRegistry`(Dockerfile `BASE_REGISTRY`)로 사내 레지스트리에서 받습니다. 공식 web(Classic)·boot-web(Boot) 템플릿은 hadolint 경고 0·kubeconform 통과 후 실제 `docker build` → 기동 → HTTP 200·healthy·uid 10001, 공식 simple-backend 는 `docker compose up` 으로 MySQL 초기화 데이터가 API 로 나오는 것까지 CI 에서 확인합니다.
- **v0.44.0 추가**: 납품 전 보안약점 점검 — 새 도구 **`check_egovframe_secure_coding`**(33번째)이 행정안전부·KISA 「소프트웨어 개발보안 가이드」(2021, 구현단계 보안약점 49개) 중 정적 패턴으로 오탐을 통제할 수 있는 14개 항목(규칙 20종 — SQL 삽입·크로스사이트 스크립트·경로 조작·URL 자동접속·운영체제 명령어·XML 외부개체·취약한 암호·부적절한 난수·하드코드된 중요정보·쿠키·오류 정보노출·오류상황 대응 부재·역직렬화·디버그 코드)을 소스에서 찾습니다. 규칙은 데이터(`catalog/secure-coding-rules.json`)이고, 주석(공식 공통컴포넌트 매퍼의 `${…}` 96건은 전부 "#{} 로 변경" 주석)·`<c:out>`·커스텀 태그 속성·자리표시자 같은 오탐을 실측으로 걸러 냅니다. 항목마다 공통컴포넌트 원본·수정본·매니페스트 없음·프로젝트·테스트 출처를 붙이고, 예외 파일(사유·검토자 필수)·이전 결과와 비교(새 항목만)·**SARIF 2.1.0**(GitHub code scanning, OASIS 공식 스키마 통과)을 지원합니다. 같은 규칙으로 공식 공통컴포넌트는 v4.3.2 516건 → **v5.0.7 38건**(`escapeXml="false"` 304 → 6)이라 업그레이드 효과가 숫자로 보이고, 공식 web·boot-web 템플릿은 0건입니다. 평가서 4절, CLI `secure`, `generate_egovframe_ci(secureCoding=true)` 게이트 단계(GitHub 은 SARIF 업로드).
- **v0.43.0 추가**: CI·제출 형식 다변화 — `generate_egovframe_ci(platform="gitlab"|"jenkins")` 가 GitHub Actions 와 같은 빌드·공급망 게이트를 `.gitlab-ci.yml`(JUnit·CycloneDX 리포트)·`Jenkinsfile`(Declarative, Linux `sh`·Windows `bat` 공용)로 만들고, 게이트에 **SBOM 최소 요소 점검**(`sbom-check --fail-on minimum`)을 세 플랫폼 모두 추가했습니다. 사내 npm 레지스트리(`npmRegistry`)·오프라인 번들 경로(`offlineBundle`)는 환경 변수로 들어가고, 공급자 단서가 없으면 게이트가 실패할 것을 미리 알립니다. SBOM 은 **SPDX 2.3 JSON** 으로도 냅니다 — `generate_egovframe_sbom(bomFormat="spdx-json")` 이 패키지·`DEPENDS_ON` 관계(의존 없음은 `NONE`)·purl·공급자·creators·created·체크섬·선언 라이선스·OSV 권고·기준 판정(annotations)을 담고, `check_egovframe_sbom` 은 형식을 자동 판별해 SPDX 도 같은 최소 요소 7종·재판정·비교로 점검합니다(VEX 는 CycloneDX 만). 공식 web 템플릿을 실제 Maven 으로 만든 SBOM 은 SPDX 로 바꿔도 component 67·최소 요소 판정(요소별 충족 수까지)이 같고 SPDX ↔ CycloneDX 비교 차이 0 이며, 생성 `.gitlab-ci.yml` 은 GitLab 공식 CI 스키마를, SPDX 출력은 공식 spdx-spec v2.3 스키마를 통과합니다. 도구 수는 32종 그대로입니다.
- **v0.42.0 추가**: 폐쇄망(망분리) 운영 — 새 도구 **`prepare_egovframe_offline_bundle`**(32번째)이 인터넷 PC 에서 OSV Maven 취약점 전체 덤프(≈10MB, 7,190건)·고정 공통컴포넌트 아카이브(sha256 검증)·Initializr zip 템플릿(고정 지문)·재조립용 공식 공통컴포넌트 태그 22개 미러(≈37MB)를 한 디렉터리에 담고 `bundle-manifest.json`(파일별 sha256·크기·출처 URL·받은 시각)을 씁니다. 폐쇄망 PC 에서 `EGOVFRAME_OFFLINE_BUNDLE` 만 지정하면 다운로드는 번들 파일을 지문 검증 후 쓰고(변조 거부), `offline=false` 의 OSV 조회는 로컬 덤프로 판정하며(스냅숏 기준일 표시, 30일 넘으면 경고), 재조립은 번들 미러를 씁니다. 같은 날 받은 덤프의 로컬 판정이 온라인 OSV 와 **질의 73/73·ID 134/134 일치**했고, 네트워크를 막은 상태에서 프로젝트 생성·공통컴포넌트 조립·재조립 미리보기·SBOM 재점검이 번들만으로 끝나는 것(네트워크 시도 0건)을 CI 에서 확인합니다. CLI `bundle`, 네트워크 진단의 오프라인 번들 처방.
- **v0.41.0 추가**: 전환 리허설 — 새 도구 **`rehearse_egovframe_migration`**(31번째)이 프로젝트를 건드리지 않고 사본에서 공통컴포넌트 재조립 → 전환 자동 항목 적용 → 컴파일 → pom 을 공식 공통컴포넌트 v5.0.7 기준으로 맞춤 → 다시 컴파일까지 돌려 "자동 단계 뒤 사람이 고칠 것이 실제로 몇 건인가"를 잽니다(javac 의 오류 100개 상한 없이 전부 셈, 실행 전후 지문으로 원본 불변 확인). 공식 공통컴포넌트 **v4.3.2 전체 트리**(6,523 파일)는 자동 단계 뒤 컴파일 오류 **6,003건**(CI·JDK 17, JDK 21 은 6,335건) 중 4건을 뺀 전부가 누락 패키지와 그 연쇄(pom 의존성, 그 때문에 Lombok 이 돌지 못한 getter 등)였고, pom 을 맞추면 **1건**(GPKI 벤더 jar 의 javax 참조)만 남습니다 — CI 가 이 값을 기대값으로 고정합니다. 실측 중 찾은 두 결함도 고쳤습니다: 재조립은 전환 적용보다 **먼저** 해야 원본 태그가 식별되고(반대로 하면 4.3.2 가 v5.0.1 로 오인), 4.x 의 `org.egovframe.rte` 좌표가 5.x 로 분류되던 문제와 Maven 경고·fork 형식이 컴파일 오류로 잘못 읽히던 문제를 바로잡았습니다. 평가서 6절에 최근 리허설 실측이 함께 나옵니다.
- **v0.40.0 추가**: SBOM 운영 — 새 도구 **`check_egovframe_sbom`**(30번째)이 이미 만든 CycloneDX SBOM 을 제출물로서 점검합니다. (1) 최소 요소 7종(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각, NTIA 최소 요소 = 국내 SW 공급망 보안 가이드라인 핵심 구성요소)을 component 마다 세어 "제출 가능/보완 필요"를, (2) 빌드 도구 없이 purl 만으로 기준 판정과 OSV 를 다시 해 생성 이후 바뀐 판정·새로 알려진 취약점을, (3) 이전 SBOM 과의 추가·제거·버전·판정·취약점 차이를, (4) `vex=true` 면 CycloneDX VEX 초안(새 취약점은 `in_triage`, 사람이 적은 판단은 보존)을 냅니다. `generate_egovframe_sbom` 은 `supplier`·`author` 옵션(기본 pom `<organization>`)과 공급자 표로 최소 요소를 생성 단계에서 채웁니다. 공식 web 템플릿 SBOM 은 공급자(주 component 포함 18종)·작성자가 비어 "보완 필요", 옵션으로 다시 만들면 "제출 가능"이고, SBOM·VEX 모두 CycloneDX 1.6 공식 스키마를 통과합니다. CLI `sbom-check`, 평가서 5절에 최소 요소·VEX 상태. 기획 세 버전(v0.38–v0.40)이 모두 완료됐습니다.
- **v0.39.0 추가**: CLI 모드와 CI 공급망 게이트 — `npx egovframe-scaffold-mcp <assess|check|sbom|migrate|validate|diagnose|network>` 가 AI 클라이언트 없이 같은 분석을 실행하고 종료합니다(인자 없는 실행은 기존 stdio 서버). `--json` 은 MCP `structuredContent` 와 같은 객체이고, `--fail-on supplyChain:C`·`vulnerabilities`·`manual>20` 같은 기준을 넘으면 종료 코드 2 로 파이프라인을 멈춥니다. `generate_egovframe_ci(supplyChain=true)` 는 SBOM 생성 → 평가서(등급을 PR 요약에) → 아티팩트로 이어지는 게이트 job 을 만듭니다(생성 결과는 CI 에서 actionlint 로 검사). MCP SDK 1.32.1(프로토콜 2025-11-25)로 올렸습니다.
- **v0.38.0 추가**: 공통컴포넌트 재조립 실행 — 새 도구 **`reassemble_egovframe_components`**(29번째)가 3.x/4.x 프로젝트에 복사된 공통컴포넌트 소스의 원본 태그를 공식 저장소 태그와 git blob id 로 대조해 찾고(파일 내용은 내려받지 않음), 원본·현재·목표로 파일마다 3-way 판정한 뒤 v5.0.7 로 다시 조립합니다. 사용자 수정은 원본 대비 unified diff 패치로 보존하고 작업 목록으로 돌려주며, 매니페스트를 남겨 이후 `upgrade`·`validate`·`remove` 가 그대로 적용됩니다. 공통컴포넌트 카탈로그·전환 규칙의 대응표를 upstream 새 태그 **v5.0.7**(2026-10-06)로 올렸습니다. 공식 v3.10.0 트리의 `cmm`·`bbs` 를 고친 픽스처에서 원본 v3.10.0 식별(99%), 780개 파일이 v5.0.7 tree 와 일치, `validate` 누락 0·`upgrade` 변경 0 을 CI 에서 확인합니다.
- **v0.37.0 추가**: 전환 준비도 평가서 + 회귀 코퍼스 — `generate_egovframe_report(sections=["assessment"])` 가 진단·전환 진단·의존성·보안 설정·SBOM 확인을 한 번에 돌려 여섯 절(개요·전환 범위·의존성 조치 목록·보안·SBOM·**등급과 근거**)의 평가서를 만듭니다. 전환 난이도와 공급망 상태를 각각 A–D 로 매기되 요인·구간·점수 산식을 리포트에 그대로 인쇄해 사람이 재계산할 수 있고(테스트가 실제로 재계산), `format=json`(`outputSchema`)·`outputPath`(새 파일만, transaction) 를 지원합니다. 회귀 코퍼스 `test:migrate-corpus` 가 공식 공통컴포넌트 **v3.10.0·v4.3.2** 부분 트리(커밋 고정, sparse 클론 ≈3초)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 의 기대값과 ±1% 안인지 CI 에서 단언합니다 — 4.x→5.x 경로를 실제 자산으로 처음 확인했고 두 세대 모두 확인 필요 클래스 0·기준 없음 1(`xerces`)입니다. 릴리스 워크플로는 끊긴 배포를 이어 갑니다(npm 의 `gitHead` 커밋에 태그, 전파 대기 10분·경고만). 기획 세 버전(v0.35–v0.37)이 모두 완료됐습니다(설계: [docs/design-assessment-report.md](design-assessment-report.md)).
- **v0.36.0 추가**: 해석된 의존성 트리 + SBOM — `check_egovframe_dependencies(resolve=true)` 가 Maven(`dependency:tree`)·Gradle(`dependencies`)로 전이 의존성까지 해석해 기준·OSV 와 대조합니다(항목마다 `origin`·트리 경로 `via`, 선언과 다르게 해석된 버전은 `differs`). 공식 `egovframe-web` 템플릿은 선언 19건·조치 0 이지만 해석하면 65 artifact 중 기준 미만 11·OSV 권고 24건이 보입니다. 새 도구 **`generate_egovframe_sbom`**(28번째)이 빌드 파일 변경 없이 CycloneDX 1.6 JSON 을 만들고(Maven 은 cyclonedx-maven-plugin 으로 해시·라이선스 포함, Gradle 은 해석 트리로 구성) component 마다 기준 판정(`egovframe:status·basis·baseline`)을, `offline=false` 면 OSV 결과를 `vulnerabilities[]` 로 넣습니다 — 2027년부터 단계화되는 공공기관 SBOM 등록·제출에 쓸 수 있는 형식입니다.
- **v0.35.0 추가**: 릴리스 자동화 — `main` 에서 CI 가 성공하면 `release.yml` 이 네 조건(`server.json` 버전 일치·변경 이력 항목·태그 없음·npm 미배포)을 검사해 npm(OIDC trusted publishing, provenance 자동) → 그 커밋에 태그 → GitHub Release(변경 이력에서 추출) → MCP Registry(GitHub OIDC) 순으로 게시합니다. 사람은 PR 병합만 합니다. 게이트에 `test:release`(판정 함수·릴리스 노트·`npm pack` 내용·크기 상한)와 `server.json` 설명 100자 제한(레지스트리 검증 조건 — 실제 `mcp-publisher validate` 로 발견한 결함 수정)을 추가했습니다.
- **v0.34.0 추가**: 의존성 기준 완성 + 규칙·기준 drift 감시 — `check_egovframe_dependencies` 의 기준에 **Spring Boot BOM 전체**(`spring-boot-dependencies` 3.5.6 직접 항목 + BOM import 44종을 한 단계 풀어 1,473 좌표)와 **RTE 모듈 18종의 전이 의존성**(58 좌표, 어느 모듈이 끌어오는지)을 더해 항목마다 기준 출처(parent 직접·계열·Boot BOM·RTE 전이·전환 규칙)를 표시하고, 국내 벤더·기관 배포 좌표는 `vendor` 로, EOL·이전 좌표(옛 MySQL/Oracle 드라이버·Jackson 1·xmlbeans·Ehcache 2·HttpClient 4·ANTLR 3·Spring Social)는 교체 규칙으로 분류해 공식 공통컴포넌트 3.10 pom 의 '기준 없음'을 17 → 1 로 줄였습니다. `sync_egovframe_templates` 가 동봉 규칙·기준의 upstream drift(`egovframe-runtime`·공통컴포넌트 새 태그, 공식 parent 새 버전, 고정 pom sha256 변화)를 갱신 절차와 함께 보고합니다. 기준 parent 를 5.0.2 로 올렸습니다.
- **v0.33.0 추가**: `migrate_egovframe_project` 3단계 — `verify=true` 가 compile 을 실행해 컴파일 오류를 수동 항목과 연결하고 "처리하면 해결될 오류 수" 순 작업 목록을 냅니다(javac `symbol:`/`location:` 파싱). 규칙 카탈로그(schemaVersion 2)에 공통컴포넌트 3.x→5.x 대응표(`egovframe-common-components` v3.10.0↔v5.0.6, 제거 54·이동 4)를 추가해 `egovframework.com.*` 제거·이동 클래스를 진단하고, 3.x 공통컴포넌트 소스가 섞인 프로젝트에는 컴포넌트 단위 재조립 권고(`skipComponents` 로 치환 제외)를 냅니다.
- **v1.9.0 완료**: 취약 의존성 자동 조치 `fix_egovframe_dependencies`(도구 37종·CLI `fix-deps`) — parent 상향·고정 해제·좌표 교체·취약 버전 상향, 공식 msa-common-components 권고 47 → 3·compile 통과([결과](#v190-결과-2026-10-29)).
- **v1.10.0 완료**: DB 준비·적재 확인 `prepare_egovframe_database`(도구 38종·CLI `db`) — 공통컴포넌트 전체 MySQL 8.4·PostgreSQL 16 적재 통과, upstream #1386·#1387 재현과 해결, 선별본이 빠뜨린 참조 테이블 보완([결과](#v1100-결과-2026-10-29)).
- **다음 계획**: v1.11 기동 검증([다음 버전 기획](#다음-버전-기획-v19v111)). 그 뒤 유지보수 자동화(v1.12–v1.14) → 운영 전환·조직 단위(v1.15–v1.17) → 2.0 계약 정리([장기 로드맵](#장기-로드맵-2026-11--2027-v112-이후)). [다음 버전 기획](#다음-버전-기획-v16v18) 참조.
- **배포 상태**: npm 최신 배포 버전은 상단 npm 배지와 [npm 패키지 페이지](https://www.npmjs.com/package/egovframe-scaffold-mcp)를 단일 출처로 확인합니다. 이 문서의 버전 표기는 저장소 소스(`package.json`) 기준이며, git 태그 `vX.Y.Z`가 해당 배포본의 커밋을 가리킵니다.

## 로드맵

v0.31.0까지 프로젝트·CRUD 생성, 검증된 공통컴포넌트 실행 자산 조립, 안전성 기반(테스트 판정 강제·사용자 파일 보호·전 도구 트랜잭션·허용 root·구조화 rollback 보고), 생성→검증 루프(실제 빌드·오류 구조화·테스트 리포트 구조화), 공식 템플릿 카탈로그 단일화와 커버리지 확대(22종 중 21종), 설정 파일 생성, 5.x 전환(진단·적용), 의존성 점검, 운영 편의(네트워크 진단·AGENTS.md·영문 설명·레지스트리 메타데이터)를 완료했습니다.

v0.32–v0.34 로 MCP 프로토콜 현대화, 5.x 전환 3단계(검증)와 공통컴포넌트 대응표, 의존성 기준 완성과 규칙·기준 drift 감시를, v0.35–v0.37 로 릴리스 자동화, 해석된 의존성 트리와 SBOM, 전환 준비도 평가서와 회귀 코퍼스를, v0.38–v0.40 으로 공통컴포넌트 재조립 실행, CLI 모드와 CI 공급망 게이트, SBOM 운영(최소 요소·비교·VEX)을, v0.41–v0.43 으로 전환 리허설, 폐쇄망 오프라인 번들, GitLab·Jenkins CI 와 SPDX 를 마쳤습니다(기획 원문과 결과: [v0.41–v0.43](#이전-기획-v041v043-완료) · [v0.38–v0.40](#이전-기획-v038v040-완료) · [v0.35–v0.37](#이전-기획-v035v037-완료)). v0.44–v0.46 으로 보안약점 점검, 컨테이너·배포 산출물, 5.x 최신 유지와 생성 CI 실행 검증을 마쳤습니다([v0.44–v0.46](#이전-기획-v044v046-완료)). v0.47 로 멀티 모듈·MSA 대응을 마쳤습니다([v0.47](#이전-기획-v047-완료)). v1.0.0 으로 0.x 를 끝내고 공개 API 를 고정했으며([버전 정책](versioning.md)), v1.1–v1.2 로 납품 패키지와 응답 영문화·진행 알림을 마쳤습니다([v1.0–v1.2](#이전-기획-v10v12-완료)). v1.3–v1.5 로 표준프레임워크 5.1.0 대응, DDL 기반 CRUD, 보안약점 데이터 흐름을 마쳤습니다([v1.3–v1.5](#이전-기획-v13v15-완료)). v1.6–v1.8 로 외부 저장소 장애 내성, 보안약점 자동 조치, CRUD 목록 페이징을 마쳤습니다([v1.6–v1.8](#이전-기획-v16v18-완료)). 다음 v1.9–v1.11 의 범위는 [다음 버전 기획](#다음-버전-기획-v19v111)에 있습니다. Homebrew 탭은 후순위에서 내렸습니다(npx 로 충분).

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
| **v1.0 완료** | 안정화: 버전 정책 + 공개 API 고정 | `docs/versioning.md`(SemVer, 공개 API 범위·폐기 절차), `test:api-contract` 계약 스냅샷·분류기와 `test:release` 버전 증가 폭 검사, secure_coding `top` → `topN`(deprecated 별칭), Node 22 이상·CI Node 22·24 |
| **v1.1 완료** | 납품 패키지 | 새 도구 `prepare_egovframe_delivery`(35종): 평가서·SBOM·VEX·보안약점·배포 검증을 한 묶음 + sha256 manifest·목차·이전 차수 비교, `deliver --verify` |
| **v1.2 완료** | 응답 영문화 + 진행 알림 | `EGOVFRAME_LANG=en`·`--lang en` 으로 응답 본문·규칙 사유·CLI 문구 영문(ko 출력은 goldens 와 바이트 동일), 장시간 도구 8종의 `notifications/progress` 와 `notifications/cancelled` 시 프로세스 트리 종료·롤백 |
| **v1.3 완료** | 표준프레임워크 5.1.0 대응 | 저장소에 배포된 5.1.0(BOM `egovframe-rte-root`)으로 의존성 기준·5.x 최신 유지·전환 목표·SBOM 판정, `-egov.N` 재빌드 좌표, jar·sources jar 근거(태그 생기면 교체) |
| **v1.4 완료** | Initializr v5.0.7 정렬 + DDL 기반 CRUD | `generate_egovframe_crud(ddl, search)`: CREATE TABLE 해석(공식 결함 경계 고정), 방언 중립 LIKE `<bind>`, 검색 필드 이스케이프, 템플릿 카탈로그 v5.0.7 |
| **v1.5 완료** | 보안약점 정밀화 | 메서드 안 데이터 흐름으로 등급 상·하향, SARIF `codeFlows`, 오탐 표본 정밀도 수치 (배포는 1.5.1 — 기여 수정 #72·#73 포함) |
| **v1.6 완료** | 외부 저장소 장애 내성 | 생성 CI·빌드 도구의 Maven 재시도·미러(`mavenMirror`·`EGOVFRAME_MAVEN_MIRROR`), 일시 장애 분류(`failureKind`), 실제 mvn 장애 주입 테스트, SDK 1.32.2·zod 4 |
| **v1.7 완료** | 보안약점 자동 조치 | 새 도구 `fix_egovframe_secure_coding`(36종): 규칙으로 정할 수 있는 항목만 dryRun·transaction 으로 고치고 재점검으로 확인, HTMLTagFilter 프로젝트의 c:out 은 낮음·수동 |
| **v1.8 완료** | CRUD 목록 페이징 | `generate_egovframe_crud(paging)`: 방언별 페이징 SQL(LIMIT/OFFSET·공통컴포넌트와 같은 ROWNUM)·`PaginationInfo`·`ui:pagination`·boot page/size, 실제 MyBatis·HSQLDB 실행 검증 |
| **v1.9 완료** | 취약 의존성 자동 조치 | 새 도구 `fix_egovframe_dependencies`(37종): parent 상향·기준보다 낮게 고정한 버전 제거·패키지가 같은 좌표 교체·OSV `fixed` 와 저장소 배포 목록으로 같은 major 안 상향을 dryRun·transaction 으로 적용하고 compile 로 확인(실패 시 되돌림), 평가서·납품 패키지에 조치 내역 |
| **v1.10 완료** | DB 준비·검증 | 새 도구 `prepare_egovframe_database`(38종): 조립 선별본·공통컴포넌트 전체를 문장 단위로 정리(참조 순서·중복 제거·빠진 참조 보완)하고 MySQL 문자셋 고정, 적재용 스크립트·compose·명령, Docker 로 적재해 테이블·필수 행·한글 확인 |
| **v1.11 계획** | 기동 검증 | 새 도구 `verify_egovframe_startup`(39종): 컴파일 다음 단계 — 실제로 띄워 Spring 컨텍스트 기동 오류(빈·설정·DB)를 구조화하고 URL 을 두드림. 전환 리허설에 연결 |
| **v1.12–v1.14** | 유지보수 자동화 | 사용자 수정 자동 재적용(3-way), 설정·비밀값 외부화, 프로젝트 구조 지도·변경 영향 — [장기 로드맵](#장기-로드맵-2026-11--2027-v112-이후) |
| **v1.15–v1.17** | 운영 전환·조직 단위 | 운영 준비 점검, 관측(OTel) 산출물, 포트폴리오 현황 |
| **2.0** | 계약 정리 | 폐기 제거, 도구 묶기, 기관별 규칙 팩, MCP tasks, 5.1 기본값 |

## 다음 버전 기획 (v1.9–v1.11)

v1.8.0 까지 끝난 상태(2026-10-27, 도구 36종 + CLI 명령 13종)에서 다음 세 릴리스를 아래 순서로 진행합니다. 이번 기획은 **"정말 필요한가"를 먼저 물었습니다** — 포털·GitHub 조직·실제 이슈·우리 도구의 실측에서 사용자가 반복해서 부딪히는 일만 골랐고, 그렇지 않은 후보는 [검토했지만 뺀 후보](#검토했지만-뺀-후보)에 이유와 함께 적었습니다. 세 버전은 하나의 흐름입니다: 의존성을 안전하게 올리고(v1.9) → DB 를 준비하고(v1.10) → 실제로 띄워 확인합니다(v1.11). 지금 도구는 "컴파일 통과"까지 확인하고, 그다음(기동·DB)은 사용자가 손으로 합니다.

### v1.9.0 — 취약 의존성 자동 조치 (`fix_egovframe_dependencies`)

**왜 필요한가**: 공공 사업은 보안 점검·감리에서 알려진 취약점(CVE)이 있는 라이브러리를 지적받고, 개발자는 "어느 버전으로 올려야 parent 와 충돌하지 않는지"를 하나씩 찾습니다. `check_egovframe_dependencies` 는 OSV 로 찾기만 하고 고치지 않습니다. 실측: 공식 `egovframe-msa-common-components` 11개 모듈을 GitHub Advisory 기준으로 재면 권고 170건(critical 21·high 58)인데, 모듈이 **parent BOM 보다 낮은 버전을 직접 고정**(tomcat-embed·logback 등)한 것이 수를 키웠고, parent 를 5.1.0 으로 올리고 그 고정을 지우면 34건으로 줄며, 남는 것(commons-lang 2.x 등)은 좌표 교체가 필요했습니다([선행 조사](#선행-조사-결과-2026-10-27)). 우리 도구는 이미 이 세 가지를 따로 알고 있습니다 — 기준 미만(`outdated`)·교체 필요(`replace`)·parent 상향(`update`). 이것을 한 번에 적용하고 검증하는 도구가 없습니다.

**범위 (포함)**
- 새 도구 `fix_egovframe_dependencies`(37종, CLI `fix-deps`), 기본 dryRun. 조치 종류(결과에 종류별로):
  1. **고정 해제**: parent(또는 Boot BOM)가 관리하는 좌표에 그보다 낮은 `<version>` 을 직접 적은 것 → `<version>` 을 지워 parent 에 맡김(`dependencyManagement` 의 같은 항목도). 공식 MSA 모듈의 170 → 68건 구간입니다.
  2. **parent 상향**: 5.0.x → 최신 5.0.x 또는 5.1.0 — 기존 `update` 의 자동 항목을 그대로 씁니다(`target` 파라미터).
  3. **취약 버전 상향**: 위 둘 뒤에도 OSV 에 남는 좌표는 OSV `affected[].ranges[].events.fixed` 의 **가장 낮은 수정 버전**이 같은 major 이고 기준 이상이면 `dependencyManagement` 에 그 버전을 넣습니다(직접 선언이면 그 버전으로). major 가 바뀌어야 하면 수동 항목(사유: API 변경 가능).
  4. **좌표 교체**: 전환 규칙의 `libraries`(commons-lang → commons-lang3, mysql-connector-java → mysql-connector-j, ojdbc, Jackson 1 → 2 등) 중 **좌표만 바뀌고 패키지가 같은 것**만 자동, 패키지가 바뀌는 것(Jackson 1→2, Ehcache 2→3 등)은 수동.
- **적용**: pom.xml(멀티 모듈이면 모듈 pom 포함)만 원문 오프셋 편집, 파일 트랜잭션·백업(`migration-backup/<시각>-deps-fix-…/`), `dryRun=false` 일 때 `mvn compile`(기존 `runBuild`, v1.6 의 일시 장애 구분)과 OSV 재조회로 **전·후 취약점 수**를 결과에 적습니다. 컴파일이 깨지면 롤백하고 어느 조치가 깨뜨렸는지 이분 탐색하지 않고 전체를 되돌린 뒤 수동 안내(단순함 우선).
- Gradle: 조치 1·3 만(버전 문자열 치환), 2·4 는 안내.
- 결과를 평가서 3절(의존성 조치)과 납품 패키지에 "조치 내역(전·후)"으로 넣습니다 — v1.7 에서 미룬 항목을 같이 합니다(`fix_egovframe_secure_coding` 의 `secure-fix-plan.json` 도 함께).

**범위 (제외)**: 전이 의존성(트리 안쪽)의 취약점을 `dependencyManagement` 로 억지로 올리기(런타임 호환 위험 — 보고만), Spring Boot 자체의 major 상향, 테스트 실행

**검증 기준**
- 단위(게이트): 고정 해제·버전 상향·좌표 교체 편집의 pom 원문 보존(주석·들여쓰기), OSV `fixed` 선택 규칙(같은 major·기준 이상·`fixed` 없음), 멀티 모듈, dryRun 무기록·롤백·멱등, Gradle 치환
- CI 통합(실자산): 공식 `msa-common-components`(v0.47 부터 멀티 모듈 코퍼스로 씀) 에서 조치 뒤 compile 통과와 OSV 건수 감소를 수치로(목표: 외부 측정과 같은 방향 — 고정 해제+parent 로 절반 이하). 공식 web·boot-web 템플릿은 조치 0건(회귀)
- `test:update-live` 와 같은 방식으로 5.1.0 재배포에 흔들리지 않게 기대값은 범위(이하)로

**완료 정의**: 도구 37종, `docs/design-dependency-check.md` 「자동 조치」절, api-contract minor(도구·CLI 명령 추가), CHANGELOG

#### v1.9.0 결과 (2026-10-29)

- 도구 37종·CLI 명령 14종(`fix-deps`)·구조화 출력 16종, api-contract minor. 설계: [design-dependency-check.md 「자동 조치」](design-dependency-check.md#자동-조치-v19-fix_egovframe_dependencies), 사용법: [tools.md](tools.md#취약-의존성-자동-조치-fix_egovframe_dependencies-v19).
- 기획과 달라진 점: (1) parent 관리 버전(버전을 적지 않은 좌표)의 취약점은 `dependencyManagement` 에 넣지 않고 수동 보고 — 계열의 다른 artifact 가 parent 버전에 남아 버전이 섞입니다. (2) parent 관리 버전에 권고가 있으면 고정을 풀지 않고 고정 버전을 올립니다(5.1.0 목표에서 tomcat 10.1.52 → 관리 10.1.55 도 취약). (3) OSV `fixed` 를 그대로 쓰지 않고 저장소 `maven-metadata.xml` 로 실제 배포 버전을 고릅니다(guava `33.7.2` → `33.7.2-jre`, 배포되지 않은 tomcat `10.1.58` 건너뜀). (4) 좌표 교체는 전환 규칙에 commons-lang 이 없고 패키지가 바뀌는 교체가 대부분이라 3종(mysql-connector-java·ojdbc·xbean)만 자동. (5) v1.7 에서 미룬 조치 내역을 평가서 3절·납품 패키지에 함께 넣었습니다(보안약점 조치 포함).
- 실측: 공식 msa-common-components 는 10-27 조사 뒤 upstream 이 고정 버전을 parent 보다 높게 올려 두어(5.0.4) 기획 당시 수치(170 → 34)와 달라졌습니다. 오늘 기준 선언 권고 47 → 3(목표 5.0.2), → 1(목표 5.1.0), 적용 후 루트 compile 통과·재실행 조치 0. 공식 web·boot-web 은 parent 상향 말고 0건.

### v1.10.0 — DB 준비·검증 (`prepare_egovframe_database`)

**왜 필요한가**: 공통컴포넌트는 DB 테이블 수백 개가 있어야 뜹니다. 지금 도구는 조립 때 DbType 별 DDL·DML 을 선별해 `scripts/egovframe-components/` 에 두지만, 적재는 사용자가 합니다. upstream 에 지금 열린 이슈 2건(2026-09-27)이 모두 이 적재 문제입니다 — MySQL 8 Docker 이미지에서 초기화 스크립트의 한글 이중 인코딩(#1386), latin1 클라이언트로 적재하면 로그인 조회가 `Illegal mix of collations` 로 실패(#1387). 즉 "스크립트는 있는데 어떻게 넣어야 하는지"가 첫 장벽입니다.

**범위 (포함)**
- 새 도구 `prepare_egovframe_database`(38종, CLI `db`), 기본 dryRun(계획만).
  - **대상 스크립트**: 설치 매니페스트(또는 `components` 파라미터)의 컴포넌트에서 조립 때와 같은 선별 규칙으로 DDL → DML 순서를 만들고, 의존 컴포넌트(`cmm` 등)를 앞에 둡니다. 재조립·CRUD(`generate_egovframe_crud` 의 `ddl`)가 만든 테이블도 선택 포함.
  - **문자셋 교정**: MySQL·MariaDB 는 `CREATE TABLE` 에 `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` 가 없으면 붙이고, 적재 명령에 `--default-character-set=utf8mb4` 를 씁니다(#1386·#1387 의 원인 둘 다). PostgreSQL 은 `UTF8` DB 생성, Oracle 계열은 `NLS_LANG` 안내.
  - **산출물**: `scripts/egovframe-db/<db>/00-schema.sql … 99-data.sql` 과 **docker-compose.db.yml**(MySQL 8·MariaDB·PostgreSQL 공식 이미지, 문자셋 설정, 초기화 스크립트 마운트, 포트·계정은 `globals.properties` 의 값과 맞춤), 적재 명령(bash·cmd) 안내. Oracle·Tibero·Altibase·CUBRID 는 컨테이너 없이 스크립트·명령만.
  - **적재·확인**(`run=true`, Docker 필요): compose 로 DB 를 띄워 스크립트를 넣고 **테이블 수·필수 행(관리자 계정 `COMVNUSERMASTER`, 메뉴·코드)·한글 왕복(저장 후 읽어 같은지)** 을 확인한 뒤 결과를 돌려줍니다(컨테이너는 `keep=true` 가 아니면 내림).
- `diagnose_egovframe_project` 가 DB 준비 상태(스크립트 유무·compose 유무)를 한 줄 더 보고합니다.

**범위 (제외)**: 운영 DB 로의 적재(개발·테스트 DB 만, 접속 정보는 compose 의 것), 스키마 비교·마이그레이션(Flyway 류), 데이터 이관

**검증 기준**
- 단위(게이트): 선별·순서·문자셋 교정(이미 있으면 그대로)·compose 생성(공식 이미지 태그 고정)·dryRun 무기록
- CI 통합(Docker): 공식 공통컴포넌트 전체(코퍼스 v4.3.2·현재 v5.0.7) 의 MySQL 8·PostgreSQL 적재 — 오류 0, 테이블 수 기대값, 한글 왕복 통과, **#1387 재현 조건(latin1 클라이언트)에서 교정본은 통과**
- `test:components` 가 조립한 프로젝트의 선별 스크립트와 이 도구의 결과가 같은 테이블 집합

**완료 정의**: 도구 38종, `docs/design-database.md`(새 문서), CHANGELOG

#### v1.10.0 결과 (2026-10-29)

- 도구 38종·CLI 명령 15종(`db`)·구조화 출력 17종, `diagnose_egovframe_project` 에 DB 준비 상태(`dbScripts`), api-contract minor. 설계: [design-database.md](design-database.md), 사용법: [tools.md](tools.md#db-준비적재-확인-prepare_egovframe_database-v110).
- 기획과 달라진 점: (1) **선별본이 외래키 부모 테이블을 빠뜨리는 문제**를 실측에서 찾아(`COMTCCMMNDETAILCODE` → `COMTCCMMNCODE` → `COMTCCMMNCLCODE`, MySQL 은 외래키 검사 해제로 가려졌고 PostgreSQL 은 실패) 통합 스크립트에서 연쇄 보완을 넣었습니다. (2) 원본을 파일째 잇지 않고 문장 단위로 다시 짰습니다(중복 제거·참조 순서) — 조립 4종에서 같은 문장 432개가 겹쳤습니다. (3) compose 에 비밀번호를 쓰지 않고 `DB_PASSWORD` 필수 변수로 — 기획의 "계정은 globals.properties 와 맞춤" 중 비밀번호만 뺐습니다. (4) 코퍼스 v4.3.2 적재와 "`test:components` 선별 결과와 같은 테이블 집합"은 뺐습니다 — v4.3.2 코퍼스는 부분 트리라 `script/` 가 없고, 보완 때문에 테이블 집합은 선별본보다 큰 것이 맞습니다.
- 실측: 공통컴포넌트 v5.0.7 전체 테이블 182·뷰 1·문장 407+976, MySQL 8.4 16초·PostgreSQL 16 5초 오류 0. 원본은 MySQL Docker 초기화와 latin1 클라이언트에서 한글이 깨지고 준비본은 그대로입니다.

### v1.11.0 — 기동 검증 (`verify_egovframe_startup`)

**왜 필요한가**: 전환·갱신·조립 뒤 "컴파일은 되는데 뜨지 않는다"가 가장 흔한 다음 단계입니다 — 빈 생성 실패(`BeanCreationException`), 설정 파일 경로, DB 접속, MyBatis 매퍼 XML 오류는 컴파일로 잡히지 않습니다. 포털 Q&A 의 오래된 질문들(드라이버 인식 실패 등)도 기동 단계 문제입니다. 지금 리허설(`rehearse_egovframe_migration`)은 compile 에서 끝나고, 배포 산출물 검증(v0.45)은 컨테이너 빌드까지만 봅니다.

**범위 (포함)**
- 새 도구 `verify_egovframe_startup`(39종, CLI `startup`): 프로젝트를 실제로 띄워 기동 결과를 구조화합니다.
  - **실행 방식**: Boot 는 `mvn spring-boot:run`(또는 빌드된 jar), Classic war 는 프로젝트를 바꾸지 않고 Cargo Maven 플러그인의 내장 Tomcat 10.1 을 명령줄로 호출(`org.codehaus.cargo:cargo-maven3-plugin:run`), Gradle 은 `bootRun`. 포트는 빈 포트를 골라 주입.
  - **판정**: 로그에서 `Started …`/`Server startup in` 또는 지정 URL(`/`, actuator health, 로그인 화면)의 HTTP 응답으로 **기동 성공**, 실패면 Spring 의 원인 사슬을 구조화 — 빈 이름·클래스·`Caused by` 의 마지막 원인·관련 설정 파일(`context-*.xml`·`application.yml`)·DB 접속 오류(URL·드라이버)·매퍼 XML 파싱 오류(파일·줄). 시간 제한 뒤 프로세스 트리 종료(v1.2 의 Runner 재사용).
  - **처방**: 원인 종류별 한 줄 — 드라이버 없음(의존성 추가 좌표), DB 접속 거부(v1.10 의 `prepare_egovframe_database` 안내), 빈 누락(공통컴포넌트 설정 파일 — 카탈로그의 컴포넌트별 설정 자산과 대조), Jakarta 네임스페이스 오류(전환 잔여 항목과 연결).
  - **DB**: `database=compose` 면 v1.10 의 compose DB 를 먼저 띄우고 접속 정보를 주입합니다.
- `rehearse_egovframe_migration(startup=true)`: compile 뒤 기동까지 리허설(사본에서). 평가서에 "기동 여부" 한 줄.

**범위 (제외)**: 화면 기능 테스트(로그인 흐름 등 — URL 응답까지만), 성능, 운영 WAS(JEUS·WebLogic 등)에서의 기동

**검증 기준**
- 단위(게이트): 로그 파서 — Boot 3·Classic(Tomcat 10.1) 실측 로그 고정물에서 원인 사슬·빈 이름·설정 파일·DB 오류·매퍼 오류 추출, 성공 판정, 시간 초과 종료
- CI 통합: 공식 템플릿 7종(web·boot-web·simple-backend·simple-homepage·portal·enterprise·msa-edu 일부)이 **내장 HSQL 로 기동 성공**, 일부러 깨뜨린 사본(빈 설정 삭제·잘못된 JDBC URL·매퍼 XML 오류)에서 원인 종류가 맞게 분류, 공통컴포넌트 조립 프로젝트는 v1.10 의 MySQL compose 와 함께 기동
- 시간: 템플릿 기동 검증이 CI 통합에서 각 2분 이내

**완료 정의**: 도구 39종, `docs/design-startup.md`(새 문서), 리허설 설계 갱신, CHANGELOG

### 장기 로드맵 (2026-11 ~ 2027, v1.12 이후)

v1.9–v1.11 다음의 방향입니다. 세 버전 단위 기획은 직전 버전이 끝날 때 선행 조사로 다시 확인하고 쓰므로, 여기서는 **왜·무엇·어디까지**만 적고 범위·검증은 그때 정합니다. 순서는 의존 관계와 수요 근거 순이며, 한 분기에 3 릴리스(MINOR) 정도의 속도를 유지합니다.

**우선순위 기준** — 기획마다 이 네 가지를 묻고, 둘 이상 "아니오"면 뺍니다.
1. 지금 사용자가 손으로 반복하는 일인가(포털 Q&A·upstream 이슈·우리 실측에 근거가 있는가)
2. 결과를 기계적으로 검증할 수 있는가(실자산·CI 통합에서 수치로)
3. 기존 도구의 다음 한 걸음인가(새 영역보다 끊긴 흐름 잇기)
4. 표준프레임워크 자체가 아니라 **그것을 쓰는 프로젝트**의 문제인가(프레임워크 문제는 upstream 에 보고)

#### 2단계 — 유지보수 자동화 (v1.12–v1.14, 2026-12 ~ 2027-02)

유지보수 사업에서 반복되는 "업그레이드할 때마다 다시 하는 일"을 없앱니다.

| 버전 | 주제 | 왜 | 무엇 | 의존 |
|---|---|---|---|---|
| v1.12 | **사용자 수정 자동 재적용** (`reassemble`·`upgrade` 의 `reapplyPatches`) | 재조립·업그레이드가 남기는 `patches/` 를 사람이 하나씩 다시 붙입니다. 공통컴포넌트는 연 1회 이상 올라오므로 매번 반복 | 원본·현재·목표 3-way 병합(`git merge-file`)으로 충돌 없는 패치만 적용하고, 충돌은 표식 없이 작업 목록으로. 적용 뒤 compile(v0.41 리허설)과 기동(v1.11)까지 사본에서 확인. "조용한 오동작" 우려는 **적용 전후 지문·충돌 0·기동 성공** 세 조건으로 막음 | v1.11 |
| v1.13 | **설정·비밀값 외부화** (`externalize_egovframe_config`) | `globals.properties` 의 DB 비밀번호 하드코딩(보안약점 `hardcoded-config-password`, 공통컴포넌트 코퍼스 18건)은 모든 보안 점검의 단골 지적. v1.7 에서 "배포 방식에 따라 답이 다름"으로 미룸 | 배포 대상(v0.45 의 Dockerfile·compose·k8s)에 맞춰 환경 변수·k8s Secret·Jasypt(`ENC(...)`) 중 하나로 옮기고 설정 파일은 자리표시자로. 로컬 개발용 `.env.example` 생성, 생성 CI(v0.43)에 비밀 주입 자리. 적용 뒤 기동(v1.11)으로 확인 | v1.11 |
| v1.14 | **프로젝트 구조 지도·변경 영향** (`map_egovframe_project`) | 인수인계·유지보수 투입 때 "이 테이블을 바꾸면 어디가 영향받나"를 코드 검색으로 찾습니다. 공공 SI 는 인수인계 문서를 의무로 남김 | 테이블 → 매퍼 XML(`resultMap`·SQL) → Mapper 인터페이스 → Service → Controller → JSP/REST URL 의 그래프를 만들어 `impact(table|class|url)` 조회와 인수인계용 Markdown(화면 목록·URL 표·DB 접근 표)을 냅니다. 이미 있는 재료: 카탈로그의 컴포넌트별 테이블, 보안약점 점검의 파일 분류, 데이터 흐름의 메서드 파서 | — |

#### 3단계 — 운영 전환과 조직 단위 운영 (v1.15–v1.17, 2027 상반기)

개발이 끝난 뒤 운영으로 넘기는 단계와, 한 기관이 여러 프로젝트를 다루는 상황을 다룹니다.

| 버전 | 주제 | 왜 | 무엇 | 의존 |
|---|---|---|---|---|
| v1.15 | **운영 준비 점검** (`check_egovframe_operations`) | 기동은 되는데 운영에서 터지는 설정: 커넥션 풀 크기·타임아웃, 세션 타임아웃, 파일 업로드 상한·경로, 로그 수준·로테이션, 캐시, 공통컴포넌트의 운영 플래그(`Globals.*`). 포털 Q&A 의 운영환경 질문 유형 | 설정 파일을 읽어 운영 기준(공식 운영환경 가이드·템플릿 기본값)과 대조한 점검표와 수정 제안. 평가서에 "운영 준비" 절 | v1.13 |
| v1.16 | **관측(OTel·로그) 산출물** | v5.0 운영환경 가이드가 OpenTelemetry 를 채택. 배포 산출물(v0.45)에 에이전트·수집기 옵션이 없음 | `generate_egovframe_deploy(observability=true)`: OTel Java 에이전트 주입, 수집기 compose/k8s, 구조화 로그(JSON) 설정, 기본 대시보드. 수요 근거가 약해(upstream 저장소 별 2) **요청이 들어오면** 앞당기고 아니면 뒤로 | v0.45 |
| v1.17 | **포트폴리오(기관 단위) 현황** (CLI `portfolio`) | 기관·사업자는 프로젝트 수십 개의 전환 준비도·취약점·버전을 한 표로 봐야 함. 지금은 프로젝트마다 평가서 | 여러 프로젝트(또는 저장소 목록)를 돌아 평가서 요약을 모아 Markdown·CSV·JSON 한 장으로. 생성 CI 가 올리는 평가서 아티팩트를 모으는 모드도 | v0.37 |

#### 4단계 — 2.0 (2027 하반기)

1.x 가 쌓은 것을 정리하는 MAJOR 입니다. 기능보다 **계약 정리**가 목적이며, 1.x 마지막 버전과 같은 기능으로 시작합니다.

- **폐기 제거**: 1.0 부터 deprecated 로 둔 파라미터(`top` 등)와 2.0 이전에 deprecated 될 것들 제거([버전 정책](versioning.md)의 절차대로 최소 2 MINOR 전에 예고).
- **도구 묶기**: 39종 안팎의 도구를 역할별 입구로 정리(예: `check_*` 5종을 `check_egovframe_project(sections=…)` 하나로도 부를 수 있게 — 기존 이름은 2.x 동안 별칭 유지). AI 클라이언트의 도구 목록이 길어지는 문제에 대한 답.
- **규칙 팩**: 보안약점·의존성 기준·운영 점검 규칙을 기관이 덮어쓰거나 추가할 수 있는 **규칙 팩 디렉터리**(`EGOVFRAME_RULE_PACKS`) — 기관별 금지 라이브러리, 사내 BOM, 추가 보안 규칙. 동봉 규칙은 그대로 두고 팩이 위에 얹힘.
- **MCP 신기능**: `tasks` 가 안정되면 장시간 도구(리허설·적재·기동·번들)를 비동기 작업으로. 구조화 출력을 전 도구로.
- **5.1 기본값**: 공식 태그·공지가 나오면 전환 목표·생성 기본 parent 를 5.1 로(1.x 에서 MINOR 로 먼저 할 수도 있음 — 태그 시점에 결정).

#### 계속하는 일 (버전과 무관)

- **upstream 추적**: `sync_egovframe_templates` 의 drift 감시가 알리는 새 태그·parent·템플릿을 **분기마다** 반영(카탈로그·기준·규칙 재생성). 5.1.0 은 태그 전 재배포가 잦아 CI 가 알림만 내고 사람이 판단.
- **외부 기여·보안 제보**: PR 은 기존 게이트 통과 뒤 다음 PATCH/MINOR 에 포함, 제보는 `SECURITY.md` 절차로 기획보다 먼저.
- **upstream 에 돌려주기**: 우리 실측에서 찾은 프레임워크 자체의 문제(템플릿 parent 5.0.0, Initializr CRUD 결함, 5.1.0 parent 의 EE 9 혼재 등)는 이슈·PR 로 제출. 도구에 우회를 넣기보다 원인을 고치는 쪽.
- **측정**: 분기마다 npm 다운로드·이슈 유형·도구별 호출 빈도(사용자 보고 기준)를 보고 다음 3 릴리스의 우선순위를 다시 매깁니다. 쓰이지 않는 도구는 2.0 에서 묶거나 뺍니다.

### 검토했지만 뺀 후보

"있으면 좋다"와 "꼭 필요하다"를 나누기 위해 적어 둡니다. 근거가 생기면 다시 올립니다.

| 후보 | 뺀 이유 |
|---|---|
| React 프런트(`egovframe-template-simple-react`, 조직에서 가장 많은 별 261) 화면 생성 | 백엔드 REST(`generate_egovframe_crud(profile=boot)`)는 이미 있고, 화면 코드는 프로젝트마다 디자인·상태 관리가 달라 생성물이 곧 버려짐. 템플릿 자체는 카탈로그(`egov-boot-simple-frontend`)에 있음 |
| 웹 접근성(KWCAG) 정적 점검 | 공공 사이트에 필수이지만 axe 류 전용 도구가 성숙해 있고, JSP 정적 패턴으로는 오탐이 많음. 생성 JSP 가 기본 규칙(label·scope·lang)을 지키는 것으로 충분 |
| Istio·OpenTelemetry 운영환경 산출물 | 해당 upstream 저장소 별 2개 — 수요 근거 부족. 배포 산출물(v0.45)에 OTel 에이전트 옵션 정도면 됨(요청 시) |
| iBATIS(sqlMap) → MyBatis 변환 | 공통컴포넌트는 3.10 부터 이미 MyBatis(코퍼스에 sqlMap 0개). 3.x 초기 프로젝트에 남아 있을 수 있으나 표본이 없어 규칙을 검증할 수 없음 — 표본이 들어오면 재검토 |
| 감리 체크리스트 자동 매핑 | 평가서·납품 패키지가 이미 근거 자료를 묶음. 기관마다 다른 체크리스트 서식을 맞추는 일은 도구보다 문서 작업 |
| `globals.properties` 비밀값 외부화(Jasypt·환경 변수) | 필요하지만 배포 방식(k8s Secret·환경 변수·암호화)에 따라 답이 달라 v1.11 기동 검증 이후 배포 산출물과 함께 설계 |

### 보류·운영 항목

- **MCP `tasks`**: SDK 1.32.2(2026-10-23)에서도 `experimental/tasks` 입니다. 안정 API 가 되면 장시간 도구(v1.10 적재·v1.11 기동)에 적용합니다.
- **5.1.0 공식화**: `egovframe-runtime` 에 `v5.1.0-Final` 태그·5.1 브랜치가 없고, 저장소의 5.1.0 parent 는 10-26·10-27 두 번 같은 버전 번호로 재배포됐습니다. 태그가 생기면 v1.3 근거를 `git-tag` 로 다시 만들고 전환 기본 목표를 5.1.0 으로 올립니다(MINOR).
- **외부 기여·보안 제보**: #70 의 비공개 제보 경로를 열었습니다(`SECURITY.md`). 제보가 오면 기획보다 먼저 처리합니다.
- **Initializr upstream**: 템플릿 parent 5.0.0·5.0.1 문제 등 기존 4건은 upstream 이슈로 제출할 가치가 있습니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.

### 선행 조사 결과 (2026-10-27)

- **포털(egovframe.go.kr)**: 최신 공지는 v5.0.0 배포(실행환경 OSS 업그레이드, VS Code Extension, AI RAG 예제, Istio·OpenTelemetry 운영환경 가이드, Flutter 디바이스 API 9종). 강조 서비스는 교육·호환성확인(유료, 레벨 1·2, 평균 3–4주, 확인 SW 635건)·적용점검. 5.1.0 공지는 없음.
- **GitHub 조직(23개 저장소)**: 별 순 `egovframe-template-simple-react` 261 · `msa-edu` 165 · `template-simple-backend` 98 · `common-components` 75 · `runtime` 49 · `development` 30. 2026-08 이후 활동은 ai-rag·vscode-initializr·simple-backend·common-components·docs·runtime·msa-edu(8월 초~10일). `runtime` 열린 이슈 0, `common-components` 열린 이슈 2건 — 둘 다 MySQL 8 적재의 문자셋 문제(#1386 한글 이중 인코딩, #1387 `Illegal mix of collations` 로 로그인 실패, 2026-09-27).
- **외부 측정(기여자 leejongyoung 의 msa-common-components 분석)**: parent 5.0.1 → 5.1.0 이행 시 GitHub Advisory 권고 170 → 68(parent 만) → 34(고정 오버라이드 제거), 11개 모듈 중 9개는 parent 변경만으로 빌드, `EgovBoard` 는 commons-lang 2 → 3, `EgovSearch` 는 compiler plugin 3.8.1 → 3.14.0 필요. 메인테이너는 라이브러리를 연 1회 일괄 상향.
- **포털 Q&A 표본**: 오래된 질문(2021, Oracle 드라이버 `No suitable driver`)도 기동 단계 문제. Q&A 목록 페이지는 이 세션에서 열 수 없어 표본이 적음.
- **우리 도구의 빈 곳**: 취약점은 찾기만(`check_egovframe_dependencies`), DB 스크립트는 만들기만(`add_egovframe_components`·`reassemble`), 검증은 compile 까지(`build`·`migrate(verify)`·`rehearse`). 세 기획이 각각 그 다음 한 걸음입니다.
- **공통컴포넌트 코퍼스**: 3.10.0·4.3.2 모두 sqlMap(iBATIS) 0개, MyBatis 매퍼만 — iBATIS 변환 후보를 뺀 근거.

## 이전 기획 (v1.6–v1.8, 완료)

v1.5.1 까지 끝난 상태(2026-10-26, 도구 35종 + CLI 명령 12종)에서 다음 세 릴리스를 아래 순서로 진행합니다. 출발점은 두 가지 실측입니다. 첫째, 표준프레임워크 Maven 저장소(`maven.egovframe.go.kr`)의 일시 장애(503·연결 끊김)가 이 저장소 CI 를 반복해서 깨뜨렸고, 이 도구가 만든 CI·빌드도 사용자 환경에서 같은 장애를 그대로 맞습니다. 둘째, 공식 공통컴포넌트 v4.3.2 의 보안약점 점검 결과 516건 중 488건이 기계적으로 고칠 수 있는 세 규칙(`xss-cout-unescaped` 304·`debug-code` 155·`print-stack-trace` 29)이라, 감리 대응에서 "찾기"보다 "고치기"가 비용입니다. 세 버전 모두 공개 API 를 깨지 않는 MINOR 입니다(v1.7 은 도구 추가).

### v1.6.0 — 외부 저장소 장애 내성

**목표**: 원격 저장소의 일시 장애를 생성물과 도구가 스스로 견디고, 견디지 못하면 "코드 문제가 아님"을 구분해 알립니다. 지금은 생성 CI(`generate_egovframe_ci` 의 GitHub·GitLab·Jenkins)가 `mvn -B verify` 를 재시도 없이 실행하고, `build_`·`test_egovframe_project`·`rehearse_egovframe_migration` 은 503 을 컴파일 실패와 같은 "실패"로 보고합니다. 생성 Dockerfile 만 v0.45 부터 Maven HTTP 재시도를 씁니다.

**범위 (포함)**
- **생성 CI 의 Maven 재시도**: 세 플랫폼 생성물에 `MAVEN_ARGS`(HTTP 재시도 5회·5xx 포함, Maven 3.9 `aether.connector.http.retryHandler.*`)를 넣고, 명령 단위 재시도(일시 장애 문구일 때만 두 번째부터 `-U`)를 둡니다. 저장소 CI 의 `scripts/mvn-retry.sh` 와 같은 판정 문구를 씁니다.
- **미러**: 선택 파라미터 `mavenMirror`(URL)와 환경 변수 `EGOVFRAME_MAVEN_MIRROR` — 생성 CI·Dockerfile·빌드 도구가 `settings.xml` 의 `<mirror>`(대상 `egovframe`·`central`)로 사내 Nexus·Artifactory 프록시를 씁니다. 기존 폐쇄망 레지스트리 변수와 같은 자리에 둡니다.
- **일시 장애 분류**: `build_`·`test_egovframe_project`·`rehearse_egovframe_migration`·`migrate(verify)` 결과에 `failureKind`(`"compile" | "test" | "repository-unavailable" | "timeout" | "other"`)와 실패한 저장소 URL·상태 코드를 더합니다. `repository-unavailable` 이면 `diagnose_egovframe_network` 처방을 붙이고, 선택 파라미터 `retryTransient`(기본 1회)로 다시 실행합니다.
- **CI 쪽 정리**: `test:ci-run-live` 의 Jenkins 컨테이너 안 Maven 에도 같은 재시도를 적용합니다. 외부 기여 #71(audit 이 Node 22 에서 실제 실행)을 반영합니다. 릴리스가 main CI 일시 실패로 건너뛰어진 경우(1.5.0) 다시 배포하는 절차를 `docs/development.md` 에 적습니다(`release.yml` 의 `workflow_dispatch` 는 이미 있음).
- **SDK**: `@modelcontextprotocol/sdk` 1.32.1 → 1.32.2.

**범위 (제외)**: 저장소 응답 캐시 서버 내장, Gradle 생성물의 미러(Gradle 은 `init.gradle` 이 필요해 후속), 영구 장애 우회(다른 저장소로 자동 전환)

**검증 기준**
- 장애 주입 테스트(게이트): 처음 N 회 503·연결 끊김을 내고 그다음 정상 응답하는 로컬 HTTP 저장소를 미러로 두고, 생성 CI 의 Maven 명령·`build_egovframe_project` 가 성공하는지, N 이 재시도 한도를 넘으면 `failureKind: "repository-unavailable"` 인지
- 컴파일 오류는 재시도하지 않음(시도 횟수 1)
- 생성물: GitLab 공식 스키마·Jenkins 선언형 문법 검증 그대로, `test:ci-run-live` 에서 세 플랫폼 실행 통과

**완료 정의**: 도구 35종 그대로, `docs/tools.md`·`docs/design-deploy.md` 갱신, CHANGELOG

**결과 (2026-10-26 완료)**: 도구 35종 그대로, 계약 변화는 선택 파라미터 `retryTransient`(build·test)·`mavenMirror`(ci)와 환경 변수 `EGOVFRAME_MAVEN_MIRROR`(minor). 일시 장애 판정은 "저장소 실패 문맥 + 5xx·연결 끊김·타임아웃 원인"이 함께 있을 때만이고, 실측 로그 4종(Maven 3.9 `status: 503`·옛 `status code: 502`·Gradle·연결 끊김)을 고정했습니다. 처음 N 번 503 을 내는 로컬 저장소를 미러로 둔 실제 `mvn` 에서 요청 재시도(1회 실행)·명령 재시도(`-U`, 2회)·`repository-unavailable` 판정을 게이트에서 확인합니다(약 10초). 생성 CI 의 셸 재시도는 가짜 `mvn` 으로 sh·bash 에서 실제 실행합니다. 이 과정에서 저장소 CI 의 `mvn-retry.sh` 가 Maven 3.9 의 `status: 503` 형식을 놓쳐 2026-10-25 Jenkins 실패를 막지 못한 것을 찾아 고쳤습니다. 기획과 달라진 점: (1) 생성 Dockerfile 의 미러는 넣지 않았습니다(이미 요청 재시도가 있고, 빌드 인자·settings 반입 방식이 폐쇄망 레지스트리 설계와 함께 정해져야 함). (2) 생성 CI 는 `MAVEN_ARGS` 대신 명령줄에 인자를 넣습니다 — Jenkins `environment`·GitLab `variables` 의 `MAVEN_ARGS` 는 에이전트가 쓰는 값(프록시 settings 등)을 덮기 때문입니다. (3) 설계는 `docs/design-cli.md` 6.2 에 적었습니다(CI 생성 설계가 있는 곳). (4) 기획에 없던 의존성 정리: #71 로 CI audit 이 실제로 돌면 zod 3 의 high advisory 로 실패하므로 zod 4 로 올렸고, 계약 비교기가 zod 4 JSON Schema 의 안전 정수 범위·`$ref` 구체화를 실질 변화로 보지 않게 했습니다. SDK 1.32.2 에서 마지막 진행 알림이 응답 뒤로 밀려 사라지던 것은 모든 도구 처리기가 응답 전에 알림을 다 보내도록(`flushProgress`) 고쳤습니다. #71 자체는 기여 PR 로 병합합니다. (5) 기획 중 CI 에서 5.1.0 이 같은 버전 번호로 재배포(web parent 가 Jakarta EE 9)된 것을 찾아, 5.1 기준을 다시 만들고 생성기·판정을 Maven 우선순위(출처별 버전·BOM 구성원)에 맞췄습니다([설계](design-dependency-check.md#510-재배포와-maven-우선순위-v16)).

### v1.7.0 — 보안약점 자동 조치 (`fix_egovframe_secure_coding`)

**목표**: `check_egovframe_secure_coding` 이 찾은 항목 중 **동작이 바뀌지 않음을 규칙으로 보장할 수 있는 것**만 고칩니다. 감리 소명 대신 조치 결과(전·후 건수, 변경 패치)를 제출할 수 있게 합니다.

**범위 (포함)**
- 새 도구 `fix_egovframe_secure_coding`(36종, destructive): 입력은 프로젝트와 규칙·파일 필터, 기본 `dryRun=true`(패치·건수만), 적용은 기존 transaction(백업·실패 복구)과 허용 root 를 따릅니다.
- 조치 규칙(데이터, `catalog/secure-coding-fixes.json`):
  - `xss-cout-unescaped`: 줄바꿈 치환(`fn:replace(x, crlf, '<br/>')`)은 `fn:replace(fn:escapeXml(x), crlf, '<br/>')` 로, 단순 값은 `escapeXml="false"` 제거. HTML 을 의도한 값(에디터 본문 등, 규칙에 이름 목록)은 고치지 않고 수동 항목으로 남김
  - `print-stack-trace`·`debug-code`: 클래스에 로거 필드(`LOGGER`·`log`·`logger`, SLF4J·Commons Logging·Log4j2)가 있으면 그 로거 호출로 바꾸고, 없으면 수동 항목
  - `cookie-flags`: `new Cookie(...)` 뒤 `setHttpOnly(true)`·`setSecure(true)` 추가(이미 있으면 건너뜀)
- 결과: 규칙별 고친 수·남은 수와 사유, 파일별 패치, 다시 점검한 지문 비교(사라진 지문 = 고친 항목). 평가서 4절과 납품 패키지에 "조치 내역"을 넣을 수 있게 합니다.
- CLI `fix`(기본 dryRun, `--apply`).

**범위 (제외)**: 약한 암호·해시 교체(데이터 호환), 하드코드 비밀 이동(배포 설정 필요), SQL 결합 수정, 공통컴포넌트 원본을 고칠지에 대한 정책 판단(관리 대상 컴포넌트는 기본 제외, `includeComponents` 로 포함)

**검증 기준**
- 공식 공통컴포넌트 v5.0.7·v4.3.2 에서 조치 후 재점검: 대상 규칙 건수 감소를 수치로, 다른 규칙 지문 변화 없음
- 조치 후 compile(CI 통합, JDK 17) 통과, JSP 는 Jasper 사전 컴파일(`jspc`)로 문법 확인
- 단위: 규칙별 고침·건너뜀 경계(이미 escape 된 값, 로거 없음, 주석 안), 두 번 적용해도 같은 결과(멱등)

**완료 정의**: 도구 36종, `docs/design-secure-coding.md` 조치 절, `api-contract` minor(도구 추가), CHANGELOG

**결과 (2026-10-26 완료)**: 도구 36종·CLI 명령 13종(`fix`), 계약 변화는 도구·명령 추가와 `check_egovframe_secure_coding` 출력 `htmlTagFilter`(minor). 공식 코퍼스를 보다가 **표준프레임워크 공통컴포넌트와 공식 템플릿 대부분이 `HTMLTagFilter` 를 등록**한다는 것을 확인했습니다. 이 필터는 요청 값을 엔티티로 저장하므로 `escapeXml="false"` 는 두 번 escape 를 피하려는 설계이고, 지우면 화면이 바뀝니다. 그래서 (1) 점검은 이 경우 c:out 항목을 낮음으로 보고 사유를 적고(코퍼스 중간 330·314 → 28·10), (2) 자동 조치는 c:out 을 수동으로 둡니다(`ignoreHtmlTagFilter`). 필터가 없는 프로젝트에서는 c:out 대부분을 고칩니다(필터를 걷어낸다고 가정한 코퍼스에서 289·291건, 본문 필드 13건 수동). 공식 코퍼스의 `System.out.println` 은 3.10.0 에서 16건을 고치고 로거 없는 27건은 수동입니다. 모든 조치 계획에서 재점검(규칙·파일·코드 줄별 건수)이 계획과 일치합니다. 기획과 달라진 점: (1) 고칠 수 있는 범위를 "동작이 바뀌지 않음"에서 "결과를 규칙으로 정할 수 있고 화면·로그 외 동작을 바꾸지 않음"으로 정했고, `cookie-flags` 는 제안만 냅니다(Secure·HttpOnly 가 쿠키 전송·스크립트를 바꿈). (2) JSP 의 Jasper 사전 컴파일은 하지 않았습니다 — 바꾸는 것이 속성 하나와 EL 함수 하나여서, 대신 고친 Java 를 `javac` 로 컴파일합니다. (3) 평가서·납품 패키지에 조치 내역을 넣는 것은 다음으로 미뤘습니다(조치 결과는 백업 디렉터리의 `secure-fix-plan.json` 에 남음).

### v1.8.0 — CRUD 목록 페이징

**목표**: `generate_egovframe_crud` 의 목록이 전체 행을 가져옵니다(v1.4 결과의 범위 밖 항목). 표준프레임워크 화면 관례(`PaginationInfo`·`<ui:pagination>`)와 방언별 페이징 SQL 을 생성해 실사용 목록을 바로 쓰게 합니다.

**범위 (포함)**
- 선택 파라미터 `paging`(기본 false, true 면 페이지 크기 10·페이지 수 10 — 값 지정 가능)
- Mapper: `dialect` 별 페이징
  - MySQL·MariaDB·CUBRID·Altibase·HSQL: `LIMIT #{recordCountPerPage} OFFSET #{firstIndex}`
  - PostgreSQL: `LIMIT … OFFSET …`
  - Oracle·Tibero: `OFFSET … ROWS FETCH NEXT … ROWS ONLY`(12c 이상), `oracleLegacy` 옵션이면 `ROWNUM` 감싸기
  - 건수 쿼리는 v1.4 검색 조건을 그대로 씀
- classic: VO 에 `firstIndex`·`recordCountPerPage`(공식 `ComDefaultVO` 와 같은 이름), Controller 에 `PaginationInfo`, JSP 에 `<ui:pagination>` 과 렌더러 빈 설정(없을 때만 생성, 있으면 건너뜀)
- boot(REST): `page`·`size` 파라미터와 `{content, totalCount, page, size}` 응답

**범위 (제외)**: 키셋 페이징, 정렬 컬럼 선택(`ORDER BY ${}` 는 v1.7 관점에서도 위험 — 고정 PK 정렬만)

**검증 기준**
- `test:crud-search-live` 확장: HSQLDB 의 MySQL·PostgreSQL·Oracle 문법 모드에서 같은 데이터·같은 페이지 결과(첫·중간·마지막 페이지, 검색과 함께)
- Tibero·Altibase·CUBRID 는 SQL 문자열 단위 테스트
- 생성 CRUD 의 compile(공식 simple-backend·web-sample), 생성물 보안약점 0건, `paging` 생략 시 v1.7 과 바이트 동일

**완료 정의**: 도구 36종 그대로, `docs/design-crud-generation.md` 갱신, CHANGELOG

**결과 (2026-10-27 완료)**: 도구 36종 그대로, 계약 변화는 `generate_egovframe_crud` 의 선택 파라미터 3개(minor). HSQLDB 의 MySQL·PostgreSQL 문법 모드(LIMIT/OFFSET)와 Oracle 문법 모드(ROWNUM 감싸기)에서 정렬된 페이지·검색 페이지가 같았고(`p1=[1,2] p2=[3] s1=[1] s2=[3]`), 공식 simple-backend·web-sample 에서 페이징 CRUD 가 컴파일됩니다. 기획과 달라진 점: (1) Oracle 계열은 12c `OFFSET … FETCH` 대신 공식 공통컴포넌트 매퍼와 같은 ROWNUM 감싸기 하나로 했습니다(Tibero·Altibase 호환, `oracleLegacy` 옵션 불필요). (2) 렌더러 빈 설정은 만들지 않습니다 — `paginationManager` 빈이 없으면 RTE 의 `PaginationTag` 가 기본 텍스트 렌더러를 씁니다(`type="text"`). (3) 방언 결정에 설정 파일의 JDBC URL·Spring 내장 HSQL 을 더했습니다(공식 web-sample 은 `Globals.DbType` 이 없음). (4) 요청 값의 페이지 번호·크기 범위 제한을 컨트롤러에 넣었습니다(큰 `pageUnit` 으로 전체 행을 가져오지 못하게).

### 보류·운영 항목 (당시)

- **MCP `tasks`**: SDK 1.32.2(2026-10-23)에서도 `experimental/tasks` 입니다. 안정 API 가 되면 장시간 도구에 적용합니다.
- **5.1.0 공식화**: 2026-10-26 기준 `egovframe-runtime` 에 `v5.1.0-Final` 태그·5.1 브랜치가 없습니다. 태그가 생기면 v1.3 근거를 `git-tag` 로 다시 만들고 전환 기본 목표를 5.1.0 으로 올립니다(MINOR).
- **외부 기여**: #76(가이드 제목 들여쓰기 처리, 카탈로그 제목 갱신)은 main 위 게이트 통과를 확인했습니다. 들어오는 기여 수정은 다음 PATCH 또는 진행 중인 MINOR 에 함께 배포합니다.
- **Initializr upstream**: 템플릿 parent 5.0.0·5.0.1 문제 등 기존 4건은 upstream 이슈로 제출할 가치가 있습니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.

### 선행 조사 결과 (2026-10-26)

- **upstream 태그**: `egovframe-runtime` `v5.0.2-Final`(브랜치 `5.0.x` 최신), `egovframe-common-components` `v5.0.7`, `egovframe-vscode-initializr` `v5.0.7`, `egovframe-development` `v5.0.2`, `egovframe-ai-rag` `v5.0.0`, `egovframe-msa-edu` `v5.0.0` — 모두 2026-10-22 조사와 같음
- **표준프레임워크 Maven 저장소 장애**
  - 2026-10-25 CI: `test:ci-run-live` 의 Jenkins 빌드가 `egovframe-web-config-parent:5.0.0` 을 받다 503 으로 실패(재실행으로 통과). 이 저장소 CI 는 v0.42·v0.45 때부터 `scripts/mvn-retry.sh` 로 버팁니다.
  - 2026-10-26 조사 중 `maven-metadata.xml` 요청이 연결 끊김
  - 1.5.0 은 main CI 가 성공하지 않아 배포 조건을 채우지 못했고(태그·npm 없음), 1.5.1(2026-10-25)이 그 내용을 함께 배포했습니다.
- **생성물의 현재 상태**: `generate_egovframe_ci` 세 플랫폼 모두 `mvn -B verify` 를 재시도 옵션 없이 실행합니다. 생성 Dockerfile 은 `-Daether.connector.http.retryHandler.serviceUnavailable=429,500,502,503,504`·`count=5` 를 씁니다.
- **보안약점 분포**(공식 공통컴포넌트 v4.3.2, 516건, 모두 관리되지 않는 컴포넌트 출처): `xss-cout-unescaped` 304(다수가 `fn:replace(x, crlf, '<br/>')` + `escapeXml="false"`), `debug-code` 155, `print-stack-trace` 29, `hardcoded-config-password` 18, `hardcoded-secret` 5, `empty-catch` 3, `os-command` 2. MyBatis `${}` 는 주석 안에만 있어 0건입니다.
- **CRUD 생성물**: 목록 쿼리에 페이징이 없고 `PaginationInfo` 를 쓰지 않습니다.
- **MCP SDK**: 1.32.2(2026-10-23) 최신, `tasks` 는 여전히 experimental, zod `^3.25 || ^4.0` 그대로.

## 이전 기획 (v1.3–v1.5, 완료)

v1.2.0 까지 끝난 상태(2026-10-22, 도구 35종 + CLI 명령 12종)에서 다음 세 릴리스를 아래 순서로 진행합니다. 출발점은 선행 조사에서 확인한 **표준프레임워크 5.1.0 의 저장소 배포**입니다. 공식 Maven 저장소에 RTE 5.1.0 모듈·parent 2종·새 BOM `egovframe-rte-root` 가 2026-09-28~10-12 에 올라왔지만 GitHub 태그(`v5.1.0-Final`)와 공식 공지는 아직 없습니다. 지금 도구는 5.0.2 를 최신으로 보므로 5.1.0 프로젝트를 "기준 없음"·"버전 미검출"로 다루고, 5.0.x 프로젝트에 5.1.0 갱신을 안내하지 못합니다. 세 버전 모두 공개 API 를 깨지 않는 MINOR 입니다(도구 이름·기존 파라미터 그대로, 선택 파라미터·허용값 추가만).

### v1.3.0 — 표준프레임워크 5.1.0 대응

**목표**: 5.1.0 이 저장소에 배포됐으므로 의존성 점검·5.x 최신 유지·전환·SBOM 이 5.1.0 을 기준으로 판정하게 합니다. GitHub 태그가 없어 지금까지의 "소스 트리 태그 비교" 방식을 쓸 수 없으므로, **저장소의 jar·sources jar 로 근거를 만드는 경로**를 더하고 태그가 생기면 같은 결과로 바꿉니다.

**범위 (포함)**
- **의존성 기준 재생성**: `generate-dependency-baseline.mjs` 가 parent 5.1.0 의 새 구조를 읽게 합니다.
  - 5.1.0 parent 는 RTE 모듈을 직접 나열하지 않고 `org.egovframe.rte:egovframe-rte-root:5.1.0` BOM 을 import 합니다(web parent 의 `dependencyManagement` 항목 106 → 222, boot parent 72 → 24). BOM import 를 한 단계 풀어 기준에 넣습니다.
  - Spring Boot 3.5.6 → 3.5.16, Spring 6.2.11 → 6.2.19, Spring Cloud 2025.0.0 → 2025.0.3, Spring AI 1.0.1 → 1.1.8 등 기준 버전이 함께 오릅니다.
  - 5.0.2 기준은 지우지 않고 **parent 버전별 기준**으로 둡니다. 프로젝트가 쓰는 parent(5.0.x 또는 5.1.0)에 맞는 기준으로 판정하고, 5.1.0 이 더 새 기준임을 안내합니다.
- **`-egov.N` 재빌드 좌표**: 5.1.0 은 `spring-security 6.5.11-egov.1`·`spring-integration 6.5.10-egov.1`·`spring-ai-* 1.1.8-egov.1` 처럼 공식 저장소에만 있는 재빌드본을 씁니다.
  - 버전 비교는 `6.5.11-egov.1` 을 `6.5.11` 이상으로 봅니다.
  - OSV 조회는 원 버전(`6.5.11`)으로 하되 결과에 "egov 재빌드 — 패치 반영 여부는 공급자 확인"을 붙입니다.
  - SBOM 공급자는 eGovFrame 으로 적습니다.
- **5.x 최신 유지 5.0.x → 5.1.0**: `update-rules.json` 에 5.1.0 단계를 더합니다.
  - 근거는 저장소의 5.0.2·5.1.0 jar 클래스 목록 비교입니다. 실측으로 기존 모듈 24종에서 제거 0·추가 64 클래스, 새 모듈 3종입니다(`ai-core` 43·`ai-langchain4j` 21·`ai-springai` 18 클래스).
  - 바뀐 API·동작은 sources jar diff 로 큐레이션합니다(기존 `generate-update-rules.mjs` 와 같은 검증: 클래스가 그 단계에서 실제로 바뀌었는지).
  - 근거 종류(`evidence.kind: "maven-sources"` / `"git-tag"`)를 결과와 평가서에 적습니다. 태그가 생기면 drift 감시가 알리고 `git-tag` 근거로 다시 생성합니다.
- **전환(3.x/4.x → 5.x) 목표 버전**: `migrate_egovframe_project` 의 `target` 허용값에 `5.1.0` 을 더합니다(기본값은 공식 공지 전까지 5.0.2 유지 — 결과에 5.1.0 안내). 새 AI 모듈 3종을 좌표 카탈로그에 넣습니다.
- **drift 감시**: `sync_egovframe_templates` 가 이미 parent 5.1.0 을 찾아 경고합니다. 여기에 `egovframe-rte-root` BOM 과 GitHub 태그 유무를 더해 "저장소 배포만 있음(태그 없음)" 상태를 구분해 보고합니다.

**범위 (제외)**: 공통컴포넌트 5.1(아직 v5.0.7 이 최신), Initializr 템플릿의 5.1.0 parent 반영(upstream 템플릿이 바뀌면 v1.4 에서), 5.1.0 을 `create_egovframe_project` 기본값으로 바꾸기

**검증 기준**
- 5.1.0 parent 프로젝트의 의존성 점검에서 "기준 없음"이 5.0.2 parent 프로젝트 수준 이하
- `-egov.N` 좌표 분류 단위 테스트
- 5.0.2 프로젝트를 5.1.0 으로 갱신 후 CI 통합에서 compile 성공(공식 web 템플릿·boot 템플릿)
- 규칙 데이터에 근거 종류·sha256 기록, drift 감시가 태그 없음을 구분

**완료 정의**: 도구 35종 그대로, `docs/design-dependency-check.md`·`docs/tools.md` 갱신, CHANGELOG

**결과 (2026-10-22 완료)**: 도구 35종 그대로, 계약 변화는 `migrate_egovframe_project.target` 의 pattern 확장 하나(minor — 검토한 확장을 `PATTERN_WIDENINGS` 에 적고 옛 값 표본이 새 pattern 에도 맞음을 단언). 5.1 기준은 관리 좌표 334종(web 339·boot 141, BOM 전개 포함)·계열 13종·Boot BOM 1471종·RTE 전이 76종입니다. 5.1.0 단계 규칙은 sources jar 27종(새 AI 모듈 3종)에서 바뀐 클래스 161개 중 5건을 큐레이션했습니다. 공식 web·boot-web 템플릿은 5.0.2 → 5.1.0 갱신 뒤 JDK 17 compile 을 통과하고(로컬 18·6초), 5.1 기준에서 기준 미만은 web 4·boot-web 3입니다. 기획과 달라진 점: 3.x/4.x → 5.x 전환의 목표는 5.0.2 그대로 두고(전환 규칙의 근거가 git 태그라 5.1.0 은 태그 이후), `target="5.1.0"` 은 이미 5.x 인 프로젝트의 갱신에만 받습니다. 새 AI 모듈은 전환 좌표가 아니라 의존성 기준(BOM)에 들어갔습니다. Boot parent 의 속성 재정의를 반영하는 생성기 수정으로 5.0.2 기준도 재생성했습니다. 패키지 크기 상한을 올렸습니다(압축 593KB).

### v1.4.0 — Initializr v5.0.7 정렬 + DDL 기반 CRUD 생성

**목표**: Initializr v5.0.7(2026-10-16)은 CRUD 코드 생성의 결함을 대거 고쳤습니다 — COMMENT 안 "primary key" 문구로 PK 오분류, COMMENT·DEFAULT 안 콤마·괄호로 컬럼 분리 실패, MyBatis LIKE 검색의 `||` 결합(MySQL 에서 조건 무시), JSP 검색 파라미터 반사형 XSS, Thymeleaf 화면 구조 오류. `generate_egovframe_crud` 는 필드 목록을 직접 받아 이 결함은 없지만, 공식 도구처럼 **DDL 을 그대로 받는 입력**과 **검색 조건**이 없어 실사용에서 손이 많이 갑니다.

**범위 (포함)**
- `generate_egovframe_crud` 에 선택 파라미터 `ddl`(CREATE TABLE 문)을 더합니다. 컬럼·타입·PK·NOT NULL·COMMENT 를 읽어 `fields` 를 만듭니다(둘 다 주면 거부). Initializr v5.0.7 이 고친 경계(COMMENT·DEFAULT 안 콤마·괄호, COMMENT 문구로 PK 오분류)를 단위 테스트로 고정합니다. DB 방언은 MySQL·MariaDB·PostgreSQL·Oracle·Tibero·Altibase·CUBRID·HSQL 입니다.
- 선택 파라미터 `search`(검색 대상 컬럼): Mapper 의 LIKE 를 방언 중립 `<bind>` 로 생성하고, JSP·Thymeleaf 검색 필드를 `c:out`·`th:value` 로 이스케이프합니다(생성 결과에 `check_egovframe_secure_coding` 을 돌려 0건임을 테스트에서 단언).
- 템플릿 카탈로그를 Initializr v5.0.7 기준으로 갱신합니다(msa-common-components zip 지문 — 모바일 신분증 소스 제거, 동봉 설정 템플릿 49개 재대조).

**범위 (제외)**: 화면 디자인 테마, 다중 테이블 조인 CRUD

**검증 기준**: 공식 Initializr v5.0.7 의 DDL 파서 테스트 케이스와 같은 입력에서 같은 컬럼·PK 결과, 생성 CRUD 의 compile(CI 통합, Classic·Boot), LIKE 검색이 MySQL·PostgreSQL 에서 같은 결과(HSQL 모드 단위 테스트), 생성물 보안약점 0건

**완료 정의**: 도구 35종 그대로, `docs/design-crud-generation.md` 갱신

**결과 (2026-10-23 완료)**: 도구 35종 그대로, 계약 변화는 `generate_egovframe_crud` 의 선택 파라미터 3개 추가와 `tableName` 필수 → 선택(minor). 공식 `ddlParser.spec.ts` 의 입력 12개·분리 경계 7개가 같은 결과입니다. 백슬래시 판정은 "표준 해석으로 따옴표 짝이 맞으면 표준, 아니면 MySQL 식"으로 공식과 같은 결과를 냈습니다. 기획과 달라진 점: LIKE 검증을 단위 테스트 대신 CI 통합 `test:crud-search-live` 로 실제 MyBatis·HSQLDB(MySQL·PostgreSQL·Oracle 문법 모드) 실행으로 했고, Thymeleaf 화면은 이 도구에 없어(classic JSP·boot REST) 해당 수정은 대상이 아닙니다. Initializr 고정 commit 을 v5.0.7 태그로 옮기면서 동봉 설정 템플릿 3개가 upstream 수정(`txAdvisor` 가 트랜잭션 매니저를 받음)으로 바뀌었습니다. 목록 페이징(LIMIT/ROWNUM)은 방언별이라 여전히 범위 밖입니다.

### v1.5.0 — 보안약점 점검 정밀화: 메서드 안 데이터 흐름

**목표**: `check_egovframe_secure_coding` 은 패턴 기반이라 SQL 삽입·XSS·경로 조작·OS 명령에서 오탐(상수만 결합)과 미탐(변수를 거쳐 들어오는 요청 값)이 함께 있습니다. 감리 대응에서 오탐은 소명 비용이 큽니다.

**범위 (포함)**
- 메서드 안 지역 변수 흐름(요청 파라미터·헤더·쿠키·`@RequestParam`/`@PathVariable` → 대입·문자열 결합 → 위험 호출)을 따라가는 경량 분석기를 더합니다(Java 소스 토큰 기반, 외부 파서 의존 없음).
- 규칙에 `flow: "required" | "escalate"` 를 두어, 흐름이 확인되면 등급을 올리고 상수만 결합된 경우는 내립니다(사유를 결과에 적음).
- 결과 JSON·SARIF 에 흐름 경로(`codeFlows`)를 넣습니다.
- 이전 결과와 비교할 때 같은 지문을 유지합니다(등급 변화만 표시).

**범위 (제외)**: 메서드 간·클래스 간 흐름, 설계단계 20개 항목, 자동 수정

**검증 기준**: 공식 공통컴포넌트 v5.0.7·MSA 템플릿 3종의 결과에서 오탐으로 분류한 표본(사람이 판정한 고정물)의 정밀도 향상을 수치로, 기존 고정물 결과 회귀 없음(지문 동일), 분석 시간 증가 2배 이내

**완료 정의**: 도구 35종 그대로, `docs/design-secure-coding.md` 갱신

**결과 (2026-10-24 완료)**: 도구 35종 그대로, 계약 변화는 선택 파라미터 `dataFlow` 와 출력 필드 `findings[].flow`·`dataFlow`(minor). 사람이 판정한 표본(TP 5·FP 6)에서 높음 정밀도 33% → 100%, 재현율(중간 이상) 40% → 100%, 중간 이상 오탐 5 → 0건입니다. 공식 공통컴포넌트 v5.0.7·MSA 템플릿(msa-edu·msa-common-components) 실측에서는 흐름 규칙 대상(JDBC·파일·명령·리다이렉트)이 대부분 서비스 메서드 안이라 판정은 판단 불가가 많았고 항목·지문 변화는 없었습니다. 처음 구현에서 MSA 템플릿에 새로 잡힌 3건은 모두 방어된 코드(`normalize().startsWith(base)`·`isSafeFilename`·DB 조회로 덮어쓴 VO)여서 검증 조건·덮어쓰기·조회 결과를 흐름에서 끊도록 고쳤습니다. 분석 시간은 1.1–1.9배(줄 번호 표·소스 없는 메서드 건너뛰기·위험 호출 사전 거르기로 처음 4–7배에서 줄임). 기획과 달라진 점: 오탐 표본은 공식 자산에 흐름 대상 표본이 적어 고정물로 만들었고, 실자산은 회귀(지문 유지)와 시간으로 확인합니다.

### 보류·운영 항목 (당시)

- **MCP `tasks`**: SDK 1.32.1(2026-10-05, 최신)에서도 `experimental/tasks` 입니다. 안정 API 가 되면 장시간 도구에 적용합니다(v1.2 진행 알림·취소로 당장의 필요는 해소).
- **5.1.0 공식화**: GitHub `v5.1.0-Final` 태그·공지가 나오면 v1.3 의 근거를 `git-tag` 로 다시 만들고 전환 기본 목표를 5.1.0 으로 올립니다(MINOR).
- **Initializr upstream**: 템플릿 parent 5.0.0·5.0.1 문제 등 기존 4건은 upstream 이슈로 제출할 가치가 있습니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.

### 선행 조사 결과 (2026-10-22)

- **upstream 태그**
  - `egovframe-runtime`: `v5.0.2-Final` 그대로(브랜치 `5.0.x` 최신, 5.1 브랜치·태그 없음)
  - `egovframe-common-components`: `v5.0.7`
  - `egovframe-vscode-initializr`: **`v5.0.7`(2026-10-16) 새 태그** — CRUD 생성 결함 9건 수정, msa-common-components 에서 모바일 신분증 소스 제거, adm-zip 0.6.0(CVE-2026-39244)
  - `egovframe-development`: `v5.0.2`
  - `egovframe-ai-rag`: `v5.0.0`
- **표준프레임워크 5.1.0 저장소 배포**(`maven.egovframe.go.kr`)
  - `egovframe-rte-*` 5.1.0(2026-09-28~), `egovframe-web-config-parent` 5.1.0(10-11), `egovframe-boot-starter-parent` 5.1.0(10-12), BOM `egovframe-rte-root` 5.1.0(10-11). jar·sources jar 모두 있습니다.
  - parent 구조: RTE 모듈 대신 `egovframe-rte-root` BOM import. web parent 의 관리 항목 106 → 222(LangChain4j 모듈 대거 추가), boot parent 72 → 24(`spring-boot-starter-parent` 3.5.16 상속).
  - 버전: Spring Boot 3.5.16, Spring 6.2.19, Spring Security `6.5.11-egov.1`, Spring Integration `6.5.10-egov.1`, Spring Cloud 2025.0.3, Spring AI 1.1.8(`-egov.1` 재빌드 포함), Hibernate 6.6.58, JUnit Jupiter 6.1.3, Java 17.
  - 클래스 비교(jar): 기존 24 모듈 제거 0·추가 64(ptl-mvc 14, fdl-cmmn 10, fdl-filehandling 10, bat-core 8, fdl-string 7 등), 새 모듈 `ai-core`·`ai-langchain4j`·`ai-springai`. `psl-reactive-r2dbc` 는 5.1.0 jar 가 있지만 `egovframe-rte-root` BOM 에서 빠졌습니다.
- **지금 도구의 반응**: `sync_egovframe_templates` 의 drift 감시가 parent 5.1.0 을 이미 찾아 경고합니다("기준 재생성 필요"). 의존성 기준·5.x 갱신 규칙은 5.0.2 가 최신입니다.
- **MCP SDK**: 1.32.1 이 최신(`tasks` 는 experimental).

## 이전 기획 (v1.0–v1.2, 완료)

v0.47.0 까지 끝난 상태(2026-10-16, 도구 34종 + CLI 명령 11종)에서 세 릴리스를 기획했고, 2026-10-22 까지 모두 완료했습니다(1.0.0·1.1.0·1.2.0). 도구 34종의 이름·파라미터·구조화 출력이 사실상 굳어 있고 npm 으로 자동 배포되고 있어, **0.x 를 끝내고 v1.0.0 으로 공개 API 를 고정**합니다. 원래 v0.48(납품 패키지)·v0.49(응답 영문화·진행 알림)로 잡았던 기획은 호환을 깨지 않는 추가 기능이라 버전 정책에 따라 v1.1·v1.2 로 번호만 바꿨습니다. 공통 원칙은 이전과 같습니다 — 규칙은 데이터로, 근거는 공식 문서·저장소에서, 쓰기 도구는 dryRun·transaction, 각 버전은 "완료 정의"를 만족해야 릴리스합니다. 선행 조사 근거는 맨 아래 "선행 조사 결과 (2026-10-16)"에 있습니다.

### v1.0.0 — 안정화: 버전 정책 + 공개 API 고정

**목표**: SemVer 에서 0.x 는 "공개 API 가 아직 안정되지 않았다"는 뜻이라, 이용자는 MINOR 마다 깨질 수 있다고 봐야 합니다. 실제로는 v0.32 이후 도구 이름·파라미터를 지우거나 바꾼 적이 없습니다. 무엇을 지키는지 문서로 정하고, 테스트로 강제하고, 1.0 이후 고치기 어려운 이름은 지금 정리합니다. 새 기능은 넣지 않습니다.

**범위 (포함)**
- **버전 정책 `docs/versioning.md`**(SemVer 2.0)
  - **공개 API**: MCP 도구 이름과 입력 파라미터(이름·타입·필수 여부·기본값), 구조화 출력(`structuredContent`) 스키마의 필드, CLI 명령·옵션·종료 코드(0·2·3·64), 환경 변수(`EGOVFRAME_*`), 지원 Node 버전.
  - **공개 API 가 아닌 것**: Markdown 응답 문구, 카탈로그·규칙 데이터의 내용(판정 건수가 바뀔 수 있음), `dist/` 의 내부 모듈 export, 테스트·스크립트.
  - **MAJOR**: 공개 API 의 삭제·이름 변경·타입 변경, 결과가 달라지는 기본값 변경, 종료 코드 변경, Node 최소 버전 상향.
  - **MINOR**: 새 도구·선택 파라미터·출력 필드·CLI 명령, 새 템플릿·대응 범위 확대, 응답 문구·언어 추가.
  - **PATCH**: 버그 수정, 카탈로그·규칙·기준 데이터 갱신(공식 태그 추적), 문서.
  - **폐기 절차**: MINOR 에서 deprecated 로 표시합니다. 도구 설명에 `[deprecated]` 와 대체 수단을 적고, 쓰면 응답에 경고를 남깁니다. 실제 제거는 다음 MAJOR 에서만 합니다.
- **API 계약 테스트(`test:api-contract`, 게이트)**: 도구 34종의 이름·파라미터·출력 스키마 필드, CLI 명령·옵션·종료 코드를 `test/fixtures/api-contract.json` 스냅샷과 비교합니다.
  - 다르면 실패하면서 변경을 추가(MINOR)·삭제·변경(MAJOR)으로 분류합니다.
  - `test:release` 는 그 분류와 `package.json` 의 버전 증가 폭이 맞는지 봅니다. 예를 들어 MAJOR 변경인데 MINOR 만 올렸으면 릴리스하지 않습니다.
  - 스냅샷은 `npm run api-contract:update` 로만 갱신하고, PR 에서 diff 로 검토합니다.
- **1.0 전 이름 정리(마지막 기회)**: 점검한 뒤 바꿀지는 이 버전에서 결정합니다. 바꾸는 것은 옛 이름을 1.x 동안 deprecated 별칭으로 계속 받습니다.
  - 개수 제한 파라미터가 `top`·`topN`·`limit`·`maxFindings`·`fetchTop` 으로 섞여 있습니다.
  - 출력 경로 파라미터가 `outputDir`·`outputPath` 로 섞여 있습니다.
  - `format=json` 과 구조화 출력이 겹칩니다. 지금 출력 스키마가 있는 도구는 34종 중 13종이며, 1.0 에서 계약으로 둘 범위를 확정합니다.
- **Node 22 이상**: Node 18(2025-04)과 Node 20(2026-04)은 지원이 끝났습니다. `engines` 를 `>=22` 로 올리고, CI 매트릭스를 ubuntu·windows × Node 22·24 로 바꿉니다. 오프라인 번들·CLI·README 설치 안내의 Node 요구 버전도 맞춥니다.
- README·README.en 의 0.x 표현과 「진행 현황」을 정리하고, 「버전 정책」 절을 만들어 `docs/versioning.md` 로 연결합니다.

**범위 (제외)**: 새 도구·새 기능, LTS 브랜치 운영(1.x 만 유지하고 백포트 없음), 패키지 이름 변경

**검증 기준**: 계약 스냅샷이 0.47.0 의 실제 API 와 같음. 파라미터 하나를 지운 사본은 MAJOR 로, 선택 파라미터 하나를 더한 사본은 MINOR 로 분류됨. 버전 증가 폭이 모자라면 `test:release` 가 실패함. deprecated 별칭으로 부르면 새 이름과 같은 결과에 경고가 붙음. Node 22·24 매트릭스와 CI 통합이 모두 통과함.

**완료 정의**: 도구 34종(변화 없음), `docs/versioning.md`, README 「버전 정책」 절, npm `1.0.0` 자동 배포·MCP Registry 1.0.0

**결과 (2026-10-16 완료)**: 버전 정책·계약 테스트·deprecated 장치를 넣고, 지원 Node 를 22 이상으로 올렸습니다. 1.0 전 이름을 점검한 결과는 아래와 같습니다.

| 후보 | 결정 | 이유 |
|---|---|---|
| `check_egovframe_secure_coding(top)` | `topN` 으로 바꾸고 `top` 은 deprecated(2.0.0 제거) | 같은 뜻(Markdown 상위 N건)을 `rehearse`·`report` 는 `topN` 으로 씁니다 |
| `maxFindings`(secure_coding) | 유지 | 응답에 담는 항목 수 상한으로, 표시 개수와 뜻이 다릅니다 |
| `limit`·`fetchTop`(get_egovframe_guide) | 유지 | 검색 결과 수와 본문을 받을 상위 수로, 뜻이 다릅니다 |
| `outputDir`·`outputPath` | 유지 | 디렉터리(create·ai·bundle·config)와 파일(sbom·report)을 일관되게 나눠 쓰고 있습니다 |
| 구조화 출력 13/34 | 13종만 계약 | 나머지 21종은 생성·조회 도구라 Markdown 본문이 결과입니다. 출력 스키마 추가는 MINOR 로 언제든 할 수 있습니다 |

계약 스냅샷은 0.47.0 의 실제 API 로 만들고, 1.0.0 에서 다시 갱신했습니다. 분류 결과는 major 이고, 근거는 `engines` `>=18` → `>=22` 와 `top` 기본값 제거(별칭 처리를 위해 기본 40 을 처리기로 옮김) 두 가지입니다. minor 는 `topN` 추가와 deprecated 표시입니다.

생성 CI 도 Node 22 를 쓰게 했습니다. 생성 `.gitlab-ci.yml` 은 이미지의 배포판 nodejs 가 22 미만이면 npm 레지스트리의 `node@22` 를 받습니다(Ubuntu 24.04 의 nodejs 는 18). Jenkins 실행 검증 이미지도 같은 방식으로 준비합니다.

기획과 달라진 점: deprecated 별칭으로 부르면 경고를 `structuredContent` 가 아닌 별도 content 항목으로 냅니다. 구조화 출력 스키마를 바꾸지 않고, `format=json`·`sarif` 본문이 그대로 파싱되도록 하기 위해서입니다.

### v1.1.0 — 납품 패키지 (`prepare_egovframe_delivery`)

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

**결과 (2026-10-19 완료)**: `prepare_egovframe_delivery`(35번째)와 CLI `deliver`, `generate_egovframe_ci(delivery=true)` 를 넣었습니다. 공식 web 템플릿 실측 — 패키지 생성 21초(SBOM 67 component·취약점 27·등급 전환 A/공급망 B, 파일 21개), verify 전부 일치, 같은 입력 2차는 차이 0, hsqldb 를 2.7.4 → 2.5.1 로 내린 사본은 SBOM 버전 변경 1건·새 취약점 1건·공급망 등급 B → C 만 검출, SBOM 한 줄을 고치면 verify 불일치, OSV 덤프만 담은 오프라인 번들로 fetch 없이 같은 취약점 27건. 기획과 달라진 점: (1) manifest 에 패키지 전체 지문 `rootHash`(모든 파일의 경로·sha256 을 정렬해 이은 것의 sha256)를 더했습니다 — 공문·메일에 한 줄로 인용하기 위해서입니다. (2) 프로젝트에 아무것도 쓰지 않습니다. SBOM 도 프로젝트 `sbom/` 이 아니라 패키지에만 씁니다(`generateSbom` 내부 옵션 `noWrite`). (3) `--verify` 는 별도 명령이 아니라 같은 도구의 `verify=true`(CLI `deliver --verify`)입니다 — CLI 명령과 도구가 1:1 이라는 규칙을 지키기 위해서입니다. (4) 빌드 결과(`build`)는 기본 포함에서 뺐습니다. 로컬 JDK·Maven/Gradle 로 `package` 를 실제 실행해 시간이 걸리고 환경에 따라 실패하므로, 지정할 때만 담습니다. (5) CI 의 패키지 위치는 작업 디렉터리 안 `egovframe-delivery/` 입니다(GitLab·Jenkins 아티팩트는 작업 디렉터리 안이어야 함). 로컬에서는 프로젝트 밖을 권합니다. 설계: [design-delivery.md](design-delivery.md).

### v1.2.0 — 응답 영문화 + 장시간 도구 진행 알림

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

**완료 정의**: 도구 35종(변화 없음), README.en 에 영문 응답 예시, `docs/design-i18n.md`. Markdown 응답 문구는 공개 API 가 아니므로(v1.0 버전 정책) MINOR 입니다

**결과 (2026-10-20 완료)**: 도구 35종 그대로, 계약 변화 없음(`api-contract` change `none`, 1.1.0 → 1.2.0 MINOR). 기획과 달라진 점: 렌더러별 사전 파일(`src/i18n/*.ts`) 대신 문자열 자리에서 `L(ko, en)` 을 쓰고 모듈 상단 라벨 상수는 getter·함수로 바꿨습니다(사전 키 관리·보간 문제, [설계 2.2](design-i18n.md#22-구현--사전-파일-대신-lko-en)). CLI 요약·오류·usage 도 같이 영문화했습니다. 규칙 데이터는 `migration-mapping`·`migration-rules`·`update-mapping`·`update-rules`·`secure-coding-rules`·`sbom-rules`·`deploy-rules` 7파일에 `_en` 을 넣었고(`test:i18n` 이 누락 0 단언, 생성기 `requireEn`), goldens 17개는 영문화 전 코드로 만들어 바이트 일치를 단언합니다. 진행 알림은 `src/progress.ts`(`Progress`·`stepper`·`subProgress`·`AbortError`)로 모듈이 SDK 를 모르게 했고, 취소는 `Runner` 의 `signal` 이 기존 타임아웃 종료 경로(프로세스 그룹·`taskkill /T`)를 재사용합니다. `withFileTransaction` 은 `AbortError` 를 롤백 뒤 그대로 다시 던집니다. `tasks` 는 SDK 1.32.1 에서도 experimental 이라 보류 유지. 테스트 `test:i18n`(44)·`test:progress`(38+41+10).

### 보류·운영 항목 (당시)

- **MCP `tasks`**: SDK 1.32.1(최신, 2026-10-05)에서도 `experimental/tasks` 아래에 있습니다. v1.2 에서 다시 확인합니다.
- **Initializr upstream**: 템플릿 parent 5.0.0·5.0.1 문제(v0.46 의 `alignParent` 가 우회)를 포함한 기존 4건은 upstream 이슈로 제출할 가치가 있습니다.
- **기준 없음 잔여**: `xerces:xercesImpl` 은 공개 기준이 없어 그대로 둡니다.
- **브랜치 보호**: v0.46 에서 운영 절차를 [브랜치 보호](development.md#브랜치-보호-소유자-1회)로 확정했습니다. 적용했는지 확인하고 이 항목을 지웁니다.

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

## 이전 기획 (v0.47, 완료)

v0.46.0 까지 끝난 상태(2026-10-16)에서 v0.47–v0.49 세 버전을 기획했고, v0.47 을 2026-10-16 에 완료했습니다. 이후 버전 정책을 정하면서 v0.48·v0.49 는 v1.1·v1.2 로 번호를 바꿔 [다음 버전 기획](#이전-기획-v10v12-완료)으로 옮겼습니다. 기획 원문과 결과는 아래와 같습니다.

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

**결과 (2026-10-16 완료)**: 작업공간 탐지·모듈별 판정·다중 서비스 배포 산출물을 넣었습니다. 공식 템플릿 실측 — `msa-common-components`(Maven 11 모듈, 라이브러리 0): 의존성 373건·버전 없음 152 → 0, 최신 유지 자동 13(모듈 parent 11·중복 의존성 선언 2), kubeconform 40개 리소스 통과, compose 로 4개 서비스 + MySQL·RabbitMQ healthy·Eureka 에 GATEWAYSERVER·EGOVBOARD UP·Gateway health UP. `msa-edu`(Gradle 독립 10, 라이브러리 1): 의존성 0 → 280건, 최신 유지 자동 4·수동 6, 보안약점 89. `msa-portal-backend`(9): 0 → 256건, 자동 3·수동 6, 보안약점 16. 기획과 달라진 점: (1) Gradle 버전 변수 `egovframeBootParentVersion` 은 공식 템플릿이 직접 배포한 `egovframe-cloud-module-common`(저장소에 5.0.0 만 있음)의 버전에도 쓰여, 모두 auto 로 올리면 빌드가 깨집니다. 그래서 공식 parent·RTE 에만 쓰이는 변수만 auto 이고 나머지는 이유를 단 manual 입니다("18개 프로젝트 auto" 대신). 같은 이유로 Gradle 서비스의 갱신 뒤 compile 은 검증 기준에서 빼고 Maven 템플릿의 실제 빌드·기동으로 대신했습니다. (2) 선택 파라미터 `modules` 는 산출물을 고르는 `generate_egovframe_deploy` 에만 넣었습니다. 점검 도구는 결과의 모듈 열로 거를 수 있어 파라미터를 늘리지 않았습니다. (3) 설정 서버가 내주는 설정은 환경 변수로 덮을 수 없어(원격 속성 우선) native 저장소 사본(`deploy/config-repo`)을 만듭니다. (4) 공식 `msa-common-components` 의 `EgovQuestionnaire` pom 은 `commons-configuration2`·`commons-lang3` 를 같은 `<dependencies>` 에 두 번 선언합니다. 로컬 Maven 3.9.11 은 경고만 내지만 GitHub Actions 의 Maven 은 "must be unique" 오류로 프로젝트를 읽지 않아, 5.x 최신 유지에 `duplicate-dependency` 항목을 더했습니다(내용이 같으면 뒤 선언을 지우는 auto, 버전·scope 가 다르면 manual). (5) 같은 템플릿의 10개 서비스는 `log4j-slf4j2-impl` 을 선언하면서 `spring-boot-starter-logging`(logback·`log4j-to-slf4j`)도 함께 실어 SLF4J 공급자가 둘입니다. 로컬에서는 logback 이 잡혀 뜨지만 GitHub Actions 에서는 log4j 쪽이 잡혀 ConfigServer 가 "log4j-slf4j2-impl cannot be present with log4j-to-slf4j" 로 기동에 실패했습니다. 그래서 배포 산출물이 그런 서비스에 `JAVA_TOOL_OPTIONS=-Dslf4j.provider=ch.qos.logback.classic.spi.LogbackServiceProvider` 를 넣고 안내를 남깁니다(공식 `msa-edu` 는 `egovframe-rte-fdl-logging` 을 빼서 같은 충돌을 피하고 있어 해당 없음). 설계: [docs/design-workspace.md](design-workspace.md).

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

- **브랜치 보호(소유자 1회)**: 운영 절차로 확정했습니다 — 아래 [브랜치 보호](development.md#브랜치-보호-소유자-1회) 참조.
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

**결과(2026-09-27)**: 완료 정의를 모두 충족했습니다 — 도구 24종, `test:migrate` 87단언·`test:migration-rules` 579단언 통과, `test:migration-rules-live` 61건(RTE 5.x·3.x 원본·parent·Jakarta 좌표) 실제 저장소 존재 확인, 공식 5.x `egovframe-web`·`egovframe-boot-web` 템플릿에서 항목 0건, 공식 `egovframe-common-components` v3.10.0 pom·web.xml·소스 일부에서 57건(auto 48·manual 9) 검출, 설계 문서 [docs/design-migration.md](design-migration.md). 기획과 달라진 점: 규칙 근거를 "5.x 템플릿 pom + 공통컴포넌트 패키지 트리" 대신 **`egovframe-runtime` 저장소의 태그 3개(v3.10.0·v4.3.0-Final·v5.0.2-Final) 소스 트리 비교**로 잡아 클래스 단위 이동·제거를 기계적으로 도출했고(제거 38종은 큐레이션 사유 필수), 4.x 좌표(`org.egovframe.rte:org.egovframe.rte.*`)도 함께 다룹니다.

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
