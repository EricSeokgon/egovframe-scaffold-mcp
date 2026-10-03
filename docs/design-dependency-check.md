# 의존성 점검 설계 (v0.30.0 기준 · v0.34.0 기준 완성 · v0.36.0 해석 트리와 SBOM) — `check_egovframe_dependencies` · `generate_egovframe_sbom`

## 배경

표준프레임워크 프로젝트의 의존성 버전은 세 곳에서 정해진다 — 공식 5.x parent(`egovframe-web-config-parent`·`egovframe-boot-starter-parent`)의 `properties`/`dependencyManagement`, 실행환경(RTE) 모듈 pom 의 전이 의존성, 그리고 프로젝트가 직접 적은 버전. 운영 중인 프로젝트가 "공식 템플릿 기준보다 얼마나 뒤처졌는가"를 오프라인에서 답하는 것이 이 도구의 목적이며, 폐쇄망을 고려해 취약점 조회는 선택(`offline=false`)이다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 기준의 출처 | **공식 5.x parent pom 2종**을 표준프레임워크 Maven 저장소에서 내려받아 `catalog/dependency-baseline.json` 으로 동봉. 생성기 `scripts/generate-dependency-baseline.mjs`, pom sha256 기록 | 공식 템플릿이 실제로 관리하는 버전이 곧 기준이다. 문서가 아니라 pom 이 근거 |
| 계열 기준 | BOM import(`type pom`·`scope import`)와 버전 속성은 groupId 계열 규칙(`families`)으로 기록 — `org.springframework`(6.2.11), `org.springframework.security`(6.5.5), `org.springframework.boot`(3.5.6), `org.springframework.batch`, `org.springframework.cloud`, `com.fasterxml.jackson`, `dev.langchain4j` | parent 는 spring-* 를 낱개로 나열하지 않고 BOM 으로 관리한다. 개별 좌표가 목록에 없어도 계열로 대조한다 |
| RTE 버전 | 규칙 카탈로그(`migration-rules.json`)의 목표 버전을 기준으로 올린다(parent 가 더 낮게 관리하면 `parentVersion` 에 기록; 5.0.2 parent 부터는 일치) | 실행환경 릴리스가 parent 갱신보다 앞설 수 있다 |
| Boot BOM (v0.34) | v0.30 은 크기 때문에 담지 않았으나, 생성기가 Boot parent 의 상위 `spring-boot-starter-parent` 와 같은 버전의 `spring-boot-dependencies` pom 을 Maven Central 에서 받아 직접 항목 362 + BOM import 44종을 **한 단계** 풀어 `boot.managed`(`"groupId:artifactId": version`, 1,473종)에 넣는다. 직접 항목이 import 보다 우선하고 import 는 선언 순서대로 첫 번째가 이긴다(Maven 해석 순서; 충돌 1건 `jakarta.activation-api` 2.1.4 유지). 모든 pom 의 url·sha256 기록 | 릴리스 트레인 BOM(reactor·spring-data·micrometer-tracing)은 구성 artifact 버전이 BOM 버전과 달라 계열 규칙으로는 틀린다 — artifact 단위로 풀어야 맞는다. 압축 표기로 파일은 150KB(상한 200KB) |
| RTE 전이 (v0.34) | `egovframe-runtime` 모듈 pom 18종(규칙 카탈로그 `coordinates` 의 5.x 좌표)과 `egovframe-rte-root` 의 속성을 읽어 test·optional 을 뺀 `<dependencies>` 를 `rteTransitive.managed`(58종, 버전·scope·어느 모듈이 끌어오는지 `via`)에 기록 | mybatis·poi·jasypt·cxf 처럼 parent 가 관리하지 않는 라이브러리의 "맞는 버전"은 RTE 가 정한다. 프로젝트가 더 낮은 버전을 명시하면 Maven 은 가까운 선언을 택해 RTE 가 기대한 버전과 어긋난다 |
| 기준 우선순위 (v0.34) | parent 직접 → 계열 → (Boot parent 프로젝트) Boot BOM → RTE 전이, (그 밖) RTE 전이 → Boot BOM. 항목마다 `basis`(`parent`·`family`·`boot-bom`·`rte-transitive`·`migration-rules`) 를 적는다 | Boot 프로젝트는 Boot BOM 이 실제 버전을 정하고, 클래식 프로젝트는 RTE 가 끌어오는 버전이 더 가깝다. 사용자가 "왜 이 버전이 기준인가"를 바로 보게 한다 |
| 계열의 범위 (v0.34) | 계열은 groupId 가 정확히 같을 때만 적용하고 `matchSubgroups` 인 계열(`com.fasterxml.jackson`)만 하위 groupId 를 받는다. 달력형 릴리스 트레인(`spring-cloud-dependencies` 2025.0.0)은 계열에서 빼고 `releaseTrains` 에 기록 | `org.springframework.social`·`.ldap` 은 `org.springframework` 계열이 아니다(별도 프로젝트·버전). 트레인 번호와 artifact 버전은 다르다 |
| 분류 | `ok`(기준 이상) · `outdated`(기준 미만) · `managed`(5.x parent 가 관리 — Boot BOM 기준 버전도 함께 표시) · `legacy`(3.x/4.x RTE 좌표·javax 좌표 → `migrate_egovframe_project`) · `replace`(DBCP 1.x·Log4j 1.x·commons-fileupload·Tiles·JUnit 4·Spring/Security 6 미만, v0.34 추가 MySQL/Oracle 옛 좌표·Jackson 1·xmlbeans·Ehcache 2·HttpClient 4·ANTLR 3·Spring Social — 전환 규칙의 `libraries` 재사용) · `vendor`(v0.34, 국내 DBMS·GPKI 등 벤더·기관 배포 좌표 — 공개 저장소 기준 없음, 사유 표시) · `unknown`(기준 없음 — 판단 보류) · `unversioned`(버전 없고 parent 도 없음) | 모르는 것을 모른다고 말한다. `unknown`·`vendor` 는 조치 목록에 넣지 않는다 |
| 버전 해석 | `<properties>` 를 풀어 비교(루트 pom 속성은 모듈 pom 에 상속). 못 풀면 `unknown` | parent 가 정의한 속성(`${java.version}`)은 parent 기준으로 판정 |
| 보안 점검 | 존재 여부만 판정하고 근거(파일·라인·텍스트)를 남긴다 — `sec.security` 컴포넌트 설치, CSRF 설정, XSS 필터(HTMLTagFilter 등), 보안 응답 헤더, HTTPS 저장소 | 구 `security_patch_advisor` 구상을 흡수. "안전하다" 가 아니라 "설정이 보인다/보이지 않는다" 만 말한다 |
| 취약점 | `offline=false` 일 때 OSV `POST /v1/querybatch`(Maven 생태계, 100건 단위)로 버전이 확정된 의존성만 조회. 실패는 `osvError` 로 기록하고 나머지 결과는 유지 | 폐쇄망 기본 오프라인. 조회 함수는 주입 가능해 오프라인 테스트가 가능하다 |
| 읽기 전용 | 파일을 쓰지 않는다(테스트가 디스크 불변을 단언) | |

## 근거 요약

| 출처 | 내용 |
|---|---|
| `org.egovframe.web:egovframe-web-config-parent:5.0.2` | parent 없음, `java.version` 17, `egovframe.rte.version` 5.0.2, `spring.framework.version` 6.2.11, dependencyManagement 106항목(RTE·Jakarta·commons·log4j2·jackson·mybatis-spring 없음 …). 5.0.1 과의 차이는 RTE 버전뿐 |
| `org.egovframe.boot:egovframe-boot-starter-parent:5.0.2` | 상위 `spring-boot-starter-parent:3.5.6`, dependencyManagement 72항목 + BOM import(spring-framework 6.2.11·spring-security 6.5.5·spring-cloud 2025.0.0), `spring.batch.version` 5.2.3, `spring.ai.version` 1.0.1 |
| `org.springframework.boot:spring-boot-dependencies:3.5.6` (v0.34) | Maven Central. 직접 362항목 + BOM import 44종(jackson·netty·jetty·micrometer 2종·reactor·spring-data·testcontainers·opentelemetry …) → artifact 1,473종 |
| `org.egovframe.rte:egovframe-rte-*:5.0.2` 모듈 pom 18종 + `egovframe-rte-root` (v0.34) | 표준프레임워크 저장소. test·optional 을 뺀 의존성 58종 — mybatis 3.5.19·mybatis-spring 3.0.5·poi 5.4.0·hibernate-core 6.6.12·jackson 2.18.2·cxf 4.1.5·jasypt 1.9.3 … |

합친 기준: 관리 좌표 139종 + 계열 6종(릴리스 트레인 1종 제외) + Boot BOM 1,473종 + RTE 전이 58종. RTE 모듈 24종은 5.0.2.

v0.34 에서 표준프레임워크 저장소가 `maven-metadata.xml` 과 디렉터리 목록을 막아 두어(400/403) "최신 parent 버전"을 바로 알 수 없다는 것을 확인했다. drift 감시는 대신 고정 버전의 다음 patch 3개·minor·major 후보를 HEAD 로 탐침한다(기획 시점에는 5.0.1 로 고정돼 있었고 탐침이 5.0.2 를 찾아내 이번에 기준을 올렸다).

## 도구 인터페이스

```text
check_egovframe_dependencies(projectDir, offline=true, format="markdown"|"json")
```

```text
check_egovframe_dependencies(projectDir, offline=true, resolve=false, resolveScope="runtime", resolveTimeoutMs=300000, format="markdown"|"json")
generate_egovframe_sbom(projectDir, outputPath="sbom/bom.cdx.json", bomFormat="cyclonedx-json", scope="runtime", enrich=true, offline=true, overwrite=false, dryRun=true, timeoutMs=600000, format="markdown"|"json")
```

결과: `parent`(종류·상태), `java`, `findings[{file, line, groupId, artifactId, version, resolvedVersion, scope, status, baseline, basis, origin, via?, depth?, treeVersion?, note}]`, `resolution?{ran, success, scope, command, artifacts, direct, transitive, differs[], summary}`, `summary`, `checks[{id, title, status, evidence[], hint}]`, `vulnerabilities?`, `osvError?`. `baseline` 요약에 `bootBom`·`rteTransitive` 좌표 수가 붙고 Markdown 은 "기준 출처" 집계와 조치 표의 출처 열, 벤더 절을 보인다. 리소스 `egovframe://catalog/dependency-baseline` 가 기준을 그대로 돌려준다.

## 해석된 의존성 트리 (v0.36, `resolve=true`)

선언만 보면 공식 `egovframe-web` 템플릿은 조치 0건이지만 실제로 실리는 artifact 는 65개이고 그중 11개가 기준 미만, 8개 좌표에 OSV 권고(총 24건)가 붙어 있습니다. `src/dependency-tree.ts` 가 빌드 도구로 트리를 얻습니다.

| 항목 | 결정 | 이유 |
|---|---|---|
| Maven | `org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree -DoutputType=text -DoutputFile=<tmp> -DappendOutput=true`(`runtime` 이면 `-Dscope=runtime`). 플러그인 좌표를 완전히 적어 pom 에 선언이 없어도 돌고, 출력은 stdout 대신 파일로 받아 `[INFO]` 접두·멀티 모듈 이어 붙임을 안정적으로 다룬다 | 좌표 없이 `dependency:tree` 만 쓰면 프로젝트 pom 의 플러그인 관리 버전에 좌우된다 |
| Gradle | `dependencies --configuration runtimeClasspath`(`all` 은 `testRuntimeClasspath`) `-q --console=plain`, stdout 파싱. `a:b:1.0 -> 1.2` 는 1.2 로 해석(요청 1.0 기록), `(*)` 생략 표식, `(c)` 제약·`(n)` 미해석·`project :x` 는 제외 | Gradle 은 configuration 단위로만 해석한다. 멀티 프로젝트는 루트 configuration 만 본다 |
| 중복 | 같은 `groupId:artifactId` 는 가장 얕은 경로 하나만 남긴다(`via` = 루트에서의 artifactId 경로) | "왜 들어왔는가"에 답하기엔 가장 가까운 경로가 가장 유용하다 |
| 판정 | 선언에 없는 artifact 는 `origin: "transitive"` 항목(파일 = 빌드 파일, 라인 0)으로 v0.34 분류기에 그대로 태운다. 선언 좌표는 `treeVersion` 과 `resolution.differs` 로 선언↔해석 차이를 적고, parent 관리 좌표가 기준 미만으로 해석되면 비고에 안내 | 전이 의존성도 같은 기준·같은 출처 표기로 보여야 한다. Maven 은 가까운 선언이 이기므로 선언 버전과 다를 수 있다 |
| 실패 | 빌드 도구 없음·종료 코드·시간 초과는 `resolution.error` 와 노트로 알리고 선언 기준 결과를 그대로 돌려준다 | 해석은 부가 정보이지 전제 조건이 아니다 |
| 실행 | `build_egovframe_project` 의 Runner(타임아웃·프로세스 트리 종료·`mvnw`/`gradlew` 감지, Windows `.cmd`/`.bat`) 재사용, 테스트는 가짜 runner 와 실제 출력 픽스처(`test/fixtures/*-tree-*.txt`) | 플랫폼 분기를 한 곳에 둔다 |

## SBOM (v0.36, `generate_egovframe_sbom`)

| 항목 | 결정 | 이유 |
|---|---|---|
| 형식 | CycloneDX **1.6 JSON**(`bomFormat`·`specVersion`·`serialNumber`·`metadata.tools`·`components[]`·`dependencies[]`·`vulnerabilities[]`). SPDX 는 범위 밖(변환으로 대응) | SW 공급망 보안 로드맵(2026-06)은 형식을 특정하지 않는다. CycloneDX 는 취약점·속성 확장을 문서 안에 둘 수 있다 |
| Maven | `org.cyclonedx:cyclonedx-maven-plugin:2.9.3:makeAggregateBom -DoutputFormat=json -DoutputName=bom -DoutputDirectory=<tmp> -DschemaVersion=1.6 -DincludeTestScope=<all> -DincludeProvidedScope=<all> -DincludeSystemScope=true`. pom 변경 없음, 멀티 모듈 합산, 해시·라이선스는 플러그인이 넣는 그대로 | 공식 플러그인이 가장 정확한 component 메타데이터(해시·라이선스·evidence)를 낸다 |
| Gradle | 기획은 init script 로 `cyclonedx-gradle-plugin` 적용이었으나, 해석된 트리로 이 서버가 문서를 직접 구성하는 쪽으로 바꿨다(`buildBomFromTree`: purl=`bom-ref`, 루트 좌표는 `settings.gradle`·`build.gradle`, 트리 경로로 `dependencies[]` 그래프) | 플러그인 2.x/3.x 의 task·속성 이름 차이와 init script 의 classpath 해석을 피하고, 가짜 runner 로 오프라인 검증이 가능하다. 대가(해시·라이선스 없음)는 응답 노트와 `metadata.tools` 에 드러낸다 |
| 보강(enrich) | component 마다 `properties` 에 `egovframe:status`·`egovframe:basis`·`egovframe:baseline`(v0.34 분류기, parent 종류는 pom 의 parent 좌표로). 재실행 시 `egovframe:*` 만 갱신 | SBOM 을 받는 쪽이 "이 버전이 공식 기준에 맞는가"를 따로 돌리지 않아도 된다 |
| 취약점 | `offline=false` 면 OSV `querybatch` 결과를 `vulnerabilities[]`(`id`, `source: OSV`, `affects[].ref` = component `bom-ref`)로. 같은 ID 는 하나로 합치고 실패는 `osvError` 로만 | CycloneDX VEX 와 같은 자리에 둬 후속 도구가 읽을 수 있다 |
| 쓰기 | 프로젝트 안 상대 경로만(기본 `sbom/bom.cdx.json`; `..`·절대·드라이브·symlink 이탈 거부), 기존 파일은 `overwrite=true` 가 아니면 거부, `withFileTransaction`, `dryRun`(기본)은 실행 없이 명령·경로만 | 다른 쓰기 도구와 같은 안전 규칙 |
| 메타 | `openWorldHint`(빌드 도구가 저장소 접근)·비파괴(새 파일, overwrite 명시)·`outputSchema`(문서 본문은 파일에 있으므로 구조화 출력에서 제외) | |

실측(2026-10-04): 공식 `egovframe-web` 템플릿 → 해석 65 artifact(직접 14), SBOM 67 component·205KB·OSV 24건(spring-webmvc/-core/-web/-webflux/-expression 6.2.11, log4j-core/-api 2.25.3, commons-configuration2 2.11.0 등); Gradle 샘플(ptl-mvc·h2) → 40~46 artifact. 공통컴포넌트 4.3.2 pom 은 `project:*` system scope 좌표를 `vendor` 로, `javax.faces` 를 Jakarta 규칙으로 소급해 기준 없음 11 → 1.

## drift 감시 (v0.34, `sync_egovframe_templates` 의 `catalogs` 절)

`src/catalog-drift.ts` 의 `checkCatalogDrift` 가 (1) `egovframe-runtime`·`egovframe-common-components` 의 태그 목록(GitHub API, 실패하면 태그 페이지 HTML 로 대체 — 비인증 API 한도 60회/시간을 피하려 `GITHUB_TOKEN` 이 있으면 쓴다)에서 규칙의 `toTag` 보다 새 태그, (2) parent 2종의 다음 버전 후보 탐침, (3) parent pom·Boot BOM pom 의 sha256 변화를 보고한다. 조회 실패는 항목별 `error` 로 남고 drift 로 치지 않으며, 변화가 있으면 갱신 절차(아래 절과 같은 내용)를 결과에 붙인다. 파일은 고치지 않는다. 오프라인 테스트는 `fetchText`·`fetchStatus` 주입으로 최신·drift·실패 세 경로를 단언하고, CI 통합의 `test:catalog-drift-live` 가 실제 조회 성공과 고정 pom 재배포 없음을 확인한다.

## 검증

- `test:sbom`(36단언, 오프라인; v0.36): purl·트리→문서 구성(머리말·도구·루트·component·의존 그래프)·보강(재실행 유지)·취약점 병합, 출력 경로 거부(`..`·절대·드라이브·symlink)·명령(플러그인 좌표·범위·Windows 래퍼), dryRun 무기록·스키마, 가짜 플러그인 출력으로 기록·보존·보강·취약점·overwrite 거부·enrich=false·OSV 실패·플러그인 실패·시간 초과, 가짜 Gradle 트리 문서
- `test:sbom-live`(CI 통합, v0.36): 공식 `egovframe-web` 템플릿을 실제 Maven 으로 해석(≥60 artifact, 전이 경로)·SBOM 생성(≥60 component, purl·속성·해시·라이선스·OSV `vulnerabilities[]`), Gradle 샘플 해석·SBOM(런너에 gradle 이 있을 때)
- `test:dependencies`(129단언, 오프라인; v0.36 — Maven·Gradle 트리 파서(실제 출력 픽스처)·명령·가짜 runner 로 resolve 항목·경로·차이·parent 안내·OSV 포함·실패·시간 초과·Gradle all 범위 추가; v0.34 — 기준 스키마 2·Boot BOM import 전부 풀림·릴리스 트레인 분리·RTE 전이 모듈 sha256·파일 200KB·basis·Boot/RTE 우선순위·vendor·EOL 좌표 교체 규칙·Boot 템플릿형 pom unknown 0 추가): 기준 카탈로그 스키마·출처·RTE 5.x 모듈 포함·계열 규칙, 분류 함수(3.x/4.x/5.x RTE·javax·DBCP·Log4j·Spring 4/6.1/기준·parent 관리·버전 없음·기준 밖·미해결 속성), 3.10 픽스처(속성 해석·라인·scope·보안 근거·http 저장소), OSV 모의(질의 대상·결과 매핑·실패 처리), 5.x parent 픽스처(managed·outdated·Java parent 관리·보안 ok), gradle, 빈 디렉터리, 디스크 불변
- `test:dependencies-live`(CI): log4j 1.2.17 픽스처를 `offline=false` 로 점검해 OSV 결과가 붙는지 확인; v0.34 — 공식 `egovframe-boot-web`·`egovframe-web` 템플릿 pom(Initializr 고정 commit)에서 기준 없음 0건, 공식 공통컴포넌트 v3.10.0 pom 에서 기준 없음 5건 이하
- 실제 자산(v0.34): 공식 5.x `egovframe-boot-web` 템플릿 → parent 관리 15건(Boot BOM 기준 버전 표시)·기준 없음 0, `egovframe-web` → parent 관리 19·기준 없음 0, 공식 공통컴포넌트 v3.10.0 pom 66건 → 기준 없음 **17 → 1**(`xerces:xercesImpl`), 벤더 6(Altibase·Tibero·CUBRID·mGov·GPKI 2), 교체 3 → 12(옛 MySQL/Oracle 좌표·Jackson 1·xmlbeans·Ehcache 2·HttpClient 4·ANTLR 3·Spring Social·DBCP1·Log4j1·fileupload), RTE 전이로 mybatis 3.1.1 → 3.5.19 기준 미만 판정

## 기준 갱신 절차

1. `sync_egovframe_templates` 의 "규칙·의존성 기준 카탈로그 drift" 절(또는 CI 통합의 `test:catalog-drift-live` 경고)이 새 parent 버전·새 RTE 태그를 알려 준다.
2. 새 parent 릴리스가 나오면 `node scripts/generate-dependency-baseline.mjs --web <ver> --boot <ver>` (또는 `PARENTS` 기본값 갱신). Boot BOM·RTE 모듈 pom 도 함께 다시 내려받는다(`--cache <dir>` 로 보관하면 `--offline <dir>` 로 재현 가능; 생성은 결정적이라 같은 입력에서 같은 파일이 나온다).
3. RTE 목표 버전은 `catalog/migration-mapping.json` 의 `runtime.toTag` 가 정한다 — 먼저 전환 규칙을 재생성한다(RTE 전이 의존성은 이 버전의 모듈 pom 에서 읽는다).
4. `npm run test:dependencies`, 필요하면 `test:migration-rules`(Jakarta 목적지 버전이 기준 이상인지 검사).
