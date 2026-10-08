# 5.x 전환 설계 (v0.29.0 진단 · v0.30.0 적용 · v0.33.0 검증) — `migrate_egovframe_project`

## 배경

표준프레임워크 공식 템플릿·실행환경은 5.x(Jakarta EE 9+, Spring 6, Java 17)로 옮겨 갔지만, 현장에는 3.x(`egovframework.rte`)·4.x(`org.egovframe.rte` + 점 표기 artifactId + `javax.*`) 프로젝트가 남아 있습니다. 전환은 좌표·패키지·Jakarta 네임스페이스·제거된 API 가 한꺼번에 얽혀 있어 "무엇을 얼마나 바꿔야 하는지"를 먼저 정확히 세는 것이 자동 적용보다 앞서야 합니다. v0.29.0 은 이 **진단만** 제공하고 파일을 쓰지 않습니다. 진단이 실제 프로젝트에서 검증된 뒤 v0.30.0 에서 `auto` 항목을 transaction 으로 적용합니다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 규칙의 위치 | 코드가 아닌 데이터: `catalog/migration-rules.json`(schemaVersion 1) | 대응표는 실행환경 버전에 따라 바뀐다. 코드 수정 없이 재생성·검토·diff 할 수 있어야 한다 |
| 규칙의 근거 | **`eGovFramework/egovframe-runtime` 태그 3개의 소스 트리 비교** — `v3.10.0`(3.x 마지막), `v4.3.0-Final`(4.x 마지막), `v5.0.2-Final`(목표) | 좌표는 모듈 `pom.xml` 에서, 패키지·클래스 변화는 `src/main/java` 트리에서 기계적으로 나온다. 문서나 기억이 아니라 소스가 근거다. 기획 때 생각한 "5.x 템플릿 pom + 공통컴포넌트 패키지 트리"보다 실행환경 저장소가 정확하고 완전해서 근거를 바꿨다 |
| 생성기 | `scripts/generate-migration-rules.mjs --runtime-dir <clone>` (blob:none 부분 클론이면 충분, 없으면 임시 클론) | `git ls-tree` 로 트리를, `git show` 로 모듈 pom 만 읽는다. 태그 commit 을 결과에 기록한다 |
| 큐레이션 | `catalog/migration-mapping.json` — 제거 클래스의 대체·사유, Jakarta 패키지·좌표 목록, 교체 필요 라이브러리, 제거된 XML 네임스페이스, 빌드 규칙 | 트리 비교로 "없어졌다"는 알 수 있지만 "무엇으로 바꿔야 하는가"는 사람이 정해야 한다. **트리 비교로 나온 제거 클래스에 사유가 없으면 생성기가 실패**하고, 쓰이지 않는 사유가 남아 있어도 실패한다(규칙 부패 방지) |
| 클래스 판정 순서 | ① 제거·이동(원래 이름 기준) → ② 패키지 이름 변경 → ③ 접두어 변경 → ④ 5.x 트리에 없으면 `class-unknown` | `fdl.cryptography.config.EgovCryptoNameHandler` 처럼 "이름이 바뀐 패키지 안의 제거 클래스"를 접두어 치환으로 잘못 통과시키지 않기 위해 제거를 먼저 본다 |
| 패키지 이름 변경 도출 | 이동한 클래스의 (원 패키지, 목적 패키지) 쌍에서 공통 접미어를 걷어낸 뿌리 쌍을 후보로 삼고, 그 뿌리 아래 3.x 클래스가 모두 "목적지에 존재하거나 큐레이션된 제거"일 때만 rename 으로 인정. 아니면 클래스 단위 move | `cryptography.`→`crypto.`(15클래스), `security.securedobject.`→`security.secureobject.`(4), `security.config.internal.`→`security.bean.`(5), `security.intercept.`→`security.bean.`(3) 이 이렇게 나왔고, 클래스 단위 move 는 0 이었다 |
| Jakarta 패키지 | Spring 6 / Jakarta EE 9+ 에서 이름이 바뀐 `javax.*` 28종만 나열, JDK 내장(`javax.sql`·`javax.xml.parsers`·`javax.crypto`·`javax.naming`·`javax.annotation.processing`·`javax.transaction.xa` …)은 제외 | "`javax.` 를 전부 `jakarta.` 로" 는 틀린 규칙이다. 규칙 정합 테스트가 JDK 패키지 22종이 대상이 아님을 고정한다 |
| Jakarta 좌표 | `javax.servlet:javax.servlet-api`→`jakarta.servlet:jakarta.servlet-api:6.0.0` 등 26종, JSTL 은 API+구현(glassfish) 두 개 | 좌표 치환만으로 끝나는 것들. 버전은 5.x 템플릿·parent 가 쓰는 계열로 골랐고 실제 Maven Central 존재를 CI 에서 확인한다 |
| 교체 필요 라이브러리 | DBCP 1.x, Log4j 1.x, commons-fileupload, Tiles, JUnit 4, Spring/Spring Security 6 미만, Hibernate (Validator) 구버전, mybatis-spring 3 미만, POI 5 미만, `spring-modules-validation` | 좌표를 바꿔도 코드가 따라 바뀌어야 하므로 `manual`. 사유에 무엇을 고쳐야 하는지 적는다. 버전 조건은 `<properties>` 를 풀어 판단하고, parent 관리라 버전을 알 수 없으면 보류한다 |
| 스캔 범위 | `pom.xml`(다중 모듈)·`build.gradle(.kts)`·`.java`·`.xml`·`.jsp/.jspx/.jspf/.tag`·`web.xml`·`.properties/.yml`; `target/`·`build/`·`.git/`·`node_modules/` 등 제외, symlink 미추적, 2MB 초과·바이너리 건너뜀, 파일 수 상한 20,000 | 텍스트 정적 스캔. 라인 번호는 원문 오프셋으로 계산한다 |
| 결과 | `{file, line, kind, from, to, action: auto|manual, reason}` 배열 + `summary.byKind` + `sourceEra`(3.x/4.x/5.x) + Markdown | `auto` 는 v0.30 이 기계적으로 치환할 대상, `manual` 은 사람이 처리. 같은 (file, line, kind, from) 은 한 번만 보고 |
| 읽기 전용·허용 root | `enforceAllowedRoots` 적용, 어떤 파일도 쓰지 않음 | 다른 진단 도구와 동일. 테스트가 진단 전후 디스크 지문 불변을 단언한다 |

## 근거 요약 (`egovframe-runtime`)

| 구분 | 3.x (v3.10.0) | 4.x (v4.3.0-Final) | 5.x (v5.0.2-Final) |
|---|---|---|---|
| groupId | `egovframework.rte` | `org.egovframe.rte` | `org.egovframe.rte` |
| artifactId | `egovframework.rte.fdl.cmmn` | `org.egovframe.rte.fdl.cmmn` | `egovframe-rte-fdl-cmmn` (parent `egovframe-rte-root`) |
| 패키지 | `egovframework.rte.*` | `org.egovframe.rte.*` | `org.egovframe.rte.*` |
| 모듈 | 18 + `spring-modules-validation` | 18 + `spring-modules-validation` | 18 + 신규 6(`fdl.reactive`, `psl.reactive.{cassandra,mongodb,r2dbc,redis}`, `ptl.reactive`); `spring-modules-validation` 제거 |
| `src/main/java` 클래스 | 303 (RTE 접두어) | 343 | 331 — 3.x 대비 그대로 238, 패키지 이름 변경 27, 제거 38 |
| 커스텀 XML 네임스페이스 | `egov-access`·`egov-crypto`·`egov-security` (`META-INF/spring.handlers`) | 동일 | **없음** → `EgovAccessConfiguration`·`EgovCryptoConfiguration`·`EgovSecurityConfiguration`(Java Config) |
| `javax`/`jakarta` | javax | javax | jakarta |

공식 5.x 샘플의 관례(Initializr `egovframe-web`·`egovframe-boot-web` 템플릿, `egovframe-web-sample` v5.0.x): parent `org.egovframe.web:egovframe-web-config-parent` / `org.egovframe.boot:egovframe-boot-starter-parent` 가 RTE·Spring·Jakarta 버전을 관리하므로 의존성에 `<version>` 이 없고, 저장소는 `https://maven.egovframe.go.kr/maven/`, web.xml 은 `https://jakarta.ee/xml/ns/jakartaee` `version="5.0"`, JSP 의 JSTL taglib uri(`http://java.sun.com/jsp/jstl/core`)는 JSTL 3.0 에서도 그대로 쓴다(그래서 항목으로 보고하지 않는다).

## 제거 클래스 38종의 대체 근거

| 3.x 클래스(접두어 변경 후) | 대체 | 근거 |
|---|---|---|
| `fdl.cmmn.AbstractServiceImpl` | `EgovAbstractServiceImpl` | 5.x 트리에 후자만 남음 |
| `fdl.cmmn.exception.manager.AbsExceptionHandleManager`, `trace.manager.AbsTraceHandleManager` | `DefaultExceptionHandleManager`, `DefaultTraceHandleManager` | 추상 관리자 제거, Default 구현만 존재 |
| `psl.dataaccess.mapper.Mapper` | `EgovMapper` | MyBatis `@Mapper` 와 이름 충돌 회피. 5.x 템플릿 `context-mapper.xml` 이 `EgovMapper` 를 `annotationClass` 로 사용 |
| `fdl.idgnr.impl.Egov{Sequence,Table,UUId}IdGnrService` | 같은 이름 + `Impl` | 비-Impl 별칭 제거 |
| `fdl.access.bean.AccessDataSourceFactoryBean` | `fdl.access.bean.DataSourceFactoryBean` | 이름 변경 |
| `fdl.access.config.*`(2), `fdl.cryptography.config.{EgovCryptoConfigBeanDefinitionParser,EgovCryptoNameHandler}`, `fdl.security.config.*`(9), `fdl.security.config.internal.*` 중 6종 | `EgovAccessConfiguration` / `EgovCryptoConfiguration` / `EgovSecurityConfiguration`(+`EgovSecurityConfig`) | `spring.handlers` 가 5.x 에 없음 — XML 네임스페이스 파서·핸들러 전부 제거, Java Config 로 대체 |
| `fdl.security.intercept.CsrfAccessDeniedHandler` | `fdl.security.bean.EgovAccessDeniedHandler` | 5.x 신규 클래스 |
| `fdl.security.intercept.LookupAttributesMethodReplacer` | 없음 | 네임스페이스 내부용 |
| `fdl.xml.EgovConcrete{DOM,SAX}Factory`, `abstractXMLFactoryService` | `Egov{DOM,SAX}ValidatorService`, `EgovAbstractXMLFactoryService` | 팩터리 제거·이름 정리 |
| `ptl.mvc.bind.*`(4: `@CommandMap`, 인자 해석기 2, `EgovRequestMappingHandlerAdapter`) | 없음 | `@RequestParam Map` / `@ModelAttribute`, `<mvc:annotation-driven/>` |
| `ptl.mvc.handler.SimpleUrlAnnotationHandlerMapping` | 없음 | `RequestMappingHandlerMapping` |
| `ptl.mvc.validation.RteFieldChecks` | 없음 | `spring-modules-validation` 의존. `jakarta.validation` + hibernate-validator 8 |

전체 목록·사유·`presentIn4x` 플래그는 `catalog/migration-rules.json` 의 `packages.removed` 에 있습니다.

## 도구 인터페이스

```text
migrate_egovframe_project(projectDir, target="5.x", format="markdown"|"json")
```

`kind` 값: `coordinate` `coordinate-unknown` `rte-version` `parent` `repository` `removed-module` `jakarta-artifact` `library` `java-release` `spring-version` `package` `package-renamed` `class-moved` `class-removed` `class-unknown` `jakarta-package` `web-xml` `xml-namespace`. 리소스 `egovframe://catalog/migration-rules` 는 규칙(5.x 클래스 전체 목록은 제외)을 그대로 돌려줍니다.

## 검증

- `test:migrate`(87단언, 오프라인): 3.10 스타일 픽스처(pom·gradle·java·Spring XML·MyBatis XML·web.xml·JSP)에서 항목 종류·auto/manual·라인·대응 좌표, `target/` 제외, JDK `javax` 무시, 5.x 픽스처 0건, 진단 전후 디스크 불변, 오류 경로
- `test:migration-rules`(579단언, 오프라인): 스키마, 좌표 규칙성(18모듈, 3.x·4.x from, `egovframe-rte-<module>` to), rename/move/removed 의 5.x 트리 정합, 큐레이션 규칙 전부 사용, Jakarta 규칙성과 JDK 패키지 제외, 좌표 형식·버전
- `test:migration-rules-live`(61건, 네트워크, CI integration): RTE 5.x 24종·3.x 원본 18종·parent 2종·Jakarta 좌표가 `https://maven.egovframe.go.kr/maven/`·Maven Central 에 실제 존재(`<artifact>-<version>.pom` HEAD; 표준프레임워크 저장소는 `maven-metadata.xml` 을 제공하지 않고 일부 User-Agent 를 차단하므로 pom 파일로 확인)
- 실제 자산: Initializr `egovframe-web`·`egovframe-boot-web` 템플릿 → 항목 0건. `egovframe-common-components` v3.10.0 pom·web.xml·소스 12파일 → 57건(auto 48·manual 9: 좌표 9, Jakarta 좌표 10, 패키지 9, `javax` 13, 네임스페이스 4, 저장소 3, Java 2, 라이브러리 2, Spring 버전·RTE 버전·parent·제거 모듈·web.xml 각 1). `egovframe-web-sample` v4.3.0 pom → 11건(4.x 좌표 4 등)

## 규칙 갱신 절차

1. 새 실행환경 태그가 나오면 `catalog/migration-mapping.json` 의 `runtime.toTag`·`toVersion` 을 올린다.
2. `node scripts/generate-migration-rules.mjs --runtime-dir <egovframe-runtime clone>` 를 실행한다. 새로 제거된 클래스가 있으면 사유 없이 실패하므로 `removedClasses` 에 대체·사유를 추가한다.
3. `npm run test:migration-rules && npm run test:migrate`, 네트워크가 되면 `npm run test:migration-rules-live`.
4. 이 문서의 근거 표와 README 변경 이력을 갱신한다.

## 2단계(v0.30.0): 적용

| 항목 | 결정 | 이유 |
|---|---|---|
| 편집의 출처 | 1단계 스캔이 auto 항목마다 **원문 오프셋 기준 편집**(`edits: [{start, end, replacement}]`)을 붙인다. 적용은 이 편집을 파일별로 뒤에서부터 반영할 뿐, 텍스트를 다시 해석하지 않는다 | 진단이 본 것과 적용이 바꾸는 것이 같은 근거를 갖는다. dryRun 미리보기와 실제 적용이 같은 편집 목록을 쓴다 |
| 편집 종류 | 토큰 치환(패키지 접두어·이름 변경·이동·`javax→jakarta`·저장소 URL), pom 블록 안 `groupId`/`artifactId`/`version` 텍스트 치환, RTE 버전 속성 이름·값 치환(`<egovframework.rte.version>` → `<org.egovframe.rte.version>5.0.2</…>`, 참조 `${…}` 도 함께), Jakarta 구현 좌표 삽입(JSTL 의 glassfish — 치환 결과에 이미 있으면 생략), web.xml 여는 태그 재작성, Java 버전 값 치환, gradle 문자열 치환 | 요소 이름·들여쓰기·주석은 건드리지 않는다. `<source>${java.version}</source>` 처럼 속성 참조는 속성 쪽 항목이 담당한다 |
| 겹침 | 같은 파일의 편집을 오프셋 내림차순으로 적용하고 겹치는 편집은 건너뛰어 `conflicts` 에 보고 | 정상적으로는 겹침이 없다(토큰 판정이 한 줄에서 같은 from 을 한 항목으로 묶는다) |
| dryRun | 기본 `true`. 파일별 변경 줄 미리보기(전/후)만 돌려주고 디스크는 그대로 | 다른 쓰기 도구와 같은 원칙 |
| transaction | `withFileTransaction`: 파일별로 `migration-backup/<시각>-<uuid>/<원래 경로>` 에 원본을 먼저 쓰고 파일을 치환, `migration-plan.json`(항목 전체·적용 파일) 기록. 쓰기 전에 진단 때 읽은 내용과 현재 파일이 같은지 재검증 | 중간 실패 시 작업 전 상태로 복구(fault-injection 테스트로 확인). 백업 디렉터리는 이후 스캔에서 제외한다 |
| 적용 후 | 재진단해 `remaining` 요약을 돌려준다(auto 는 0 이어야 함). 다음 단계로 `build_egovframe_project(goal="compile")` 안내 | manual 항목은 결과에 그대로 남는다 |
| parent | 도입하지 않는다(프로젝트 구조 결정이므로 `manual` 권고 유지). `<version>` 이 있던 RTE 의존성은 `${org.egovframe.rte.version}` 속성으로 모은다 | |

검증: `test:migrate` 132단언(편집 원문 일치, dryRun 무기록, fault-injection 롤백, 적용 후 파일 내용·백업·계획·재적용 무기록·manual 불변), `test:migrate-integration`(CI): 3.10 좌표·javax 픽스처를 적용한 뒤 JDK 17 로 `mvn compile` 통과, 실제 공통컴포넌트 v3.10.0 자산(pom·web.xml·소스 12파일) 적용 → auto 48항목·86곳, 재진단 auto 0.

## 3단계(v0.33.0): 검증 + 공통컴포넌트 대응표

| 항목 | 결정 | 이유 |
|---|---|---|
| 검증의 뜻 | `verify=true`: 진단 → `build_egovframe_project(goal=compile)` 실행 → 컴파일 오류를 진단 항목과 연결한 작업 목록 | 2단계 뒤 남는 일(수동 항목 처리)을 사람이 오류 로그에서 처음부터 찾지 않게 한다 |
| 오류 파서 | `parseBuildErrors` 가 javac 의 후속 줄 `symbol:`·`location:` 을 `BuildError.symbol/location` 으로 붙인다(Maven 의 `[ERROR]` 접두 처리) | "cannot find symbol" 만으로는 무엇이 없는지 알 수 없다 |
| 연결 순서 | ① 같은 파일 + 심볼 일치(항목 `from` 의 단순명 = `symbol`, 또는 `package X does not exist` 의 X 가 `from` 의 접두, 수동 항목 우선) → ② 같은 파일 + 라인 ±3 의 수동 항목 → ③ 규칙 카탈로그의 제거 클래스(RTE·공통컴포넌트) 심볼 또는 `egovframework.rte.*`/`javax.*` 패키지 부재(적용 미완 안내) → ④ unlinked | 심볼이 가장 확실하고, 라인 근접은 보조, 규칙 심볼은 "다른 파일의 상속·참조" 같은 간접 원인을 설명한다 |
| 작업 목록 | 수동 항목별 "해결될 오류 수" 내림차순, 오류와 연결되지 않은 수동 항목도 0건으로 뒤에 붙임 | 목록이 수동 항목 전체를 덮어야 빠뜨리는 것이 없다 |
| 공통컴포넌트 대응표 | 생성기가 `egovframe-common-components` v3.10.0 ↔ v5.0.6 트리를 비교해 `packages.components`(제거 54·이동 4·추가 52, 조사 시점) 기록. 제거는 공통 사유 + 알려진 대체(`EgovMybaitsUtil`→`EgovMybatisUtil`)만 큐레이션 | 공통컴포넌트는 upstream 복사본이라 RTE 처럼 항목별 사유를 요구하지 않는다. 대응표에 없는 `egovframework.com.*` 는 사용자 코드일 수 있어 보고하지 않는다 |
| 재조립 권고 | 감지된 컴포넌트 디렉터리 안에 전환 항목(접두어·javax·이름 변경·제거)이 있으면 컴포넌트당 `component-reassemble`(manual) 1건. `skipComponents=true` 면 그 디렉터리의 auto 항목을 manual 로 돌리고 편집을 제거 | 5.x 공통컴포넌트는 내용이 바뀌었으므로 텍스트 치환보다 원본 재조립이 안전하다. 그래도 치환하고 싶은 사람은 기본값으로 둔다 |
| 읽기 전용 | verify 는 파일을 쓰지 않는다(빌드 산출물은 빌드 도구의 것) | |

검증: `test:migrate` 162단언(대응표 판정, 재조립 권고, skipComponents, `linkBuildError` 8케이스, javac 후속 줄 파싱, 가짜 runner verify 4케이스), `test:migration-rules` 605단언(공통컴포넌트 출처·근거·형식·큐레이션 반영), `test:migrate-integration`(CI): 적용 후 컴파일 통과 → 제거 클래스 참조 파일 추가 → 실제 `mvn compile` 오류 3건 전부 수동 항목 2건에 연결.

## 4단계(v0.38.0): 공통컴포넌트 재조립 (`reassemble_egovframe_components`)

3·4단계까지는 "공통컴포넌트는 5.x 원본을 다시 조립하라"는 권고만 냈다. 회귀 코퍼스에서 4.3.2 트리의 수동 항목 717건 중 524건이 복사된 공통컴포넌트 소스 안의 제거 클래스였으므로, 권고를 실행하는 도구를 둔다. 목표는 사용자가 손댄 파일을 한 줄도 잃지 않고 5.x(카탈로그 고정 v5.0.7) 원본으로 바꾸는 것이다.

| 결정 | 내용 | 이유 |
|---|---|---|
| 기준선 | 매니페스트 대신 **원본 태그**(공식 저장소에서 그 프로젝트가 복사해 온 버전)를 3-way 의 기준으로 쓴다 | 3.x/4.x 프로젝트에는 매니페스트가 없다. 원본을 알아야 "사용자가 고쳤는가"를 판정할 수 있다 |
| 원본 태그 식별 | 프로젝트 파일의 git blob id 를 좌표 세대(`sourceEra`)에 맞는 공식 태그들의 같은 경로 blob id 와 대조, 일치 파일 수가 가장 많은 태그. 동점은 높은 버전·짧은 이름(v3.10.0 vs v3.10.0-FINAL). `sourceTag` 로 지정 가능 | blob id 는 트리만 받으면 알 수 있어 파일 내용을 내려받지 않는다 |
| 원본 저장소 | `GitOriginSource`: 공식 저장소를 `--bare --filter=blob:none --depth 1` 로 미러하고 필요한 태그만 같은 방식으로 fetch(태그당 ≈1초·수백 KB). 패치를 만들 때만 그 blob 을 지연 조회. 캐시 `EGOVFRAME_CACHE_DIR` | 아카이브(46MB)를 태그마다 받는 것보다 수백 배 작다 |
| 줄바꿈 | 현재 파일은 원문과 CRLF→LF 정규화본 두 id 로 대조 | Windows `core.autocrlf` 체크아웃이 "사용자 수정"으로 오판되지 않게 |
| 소유 | 경로의 컴포넌트는 카탈로그 리프 중 접두어가 가장 긴 것. 자산(메시지·IDGN·스케줄링·웹 자산·설정 조각)은 카탈로그의 경로 목록 | `add_egovframe_components` 와 같은 범위 |
| 목표 내용 | 적용 시 카탈로그 고정 아카이브(sha256 검증)에서 읽고, 각 파일의 blob id 가 목표 태그 tree 와 같은지 다시 확인 | 조립 도구와 같은 공급 경로 + 태그 이동·아카이브 불일치 차단 |

판정(원본 O · 현재 C · 목표 T)과 처리:

| 판정 | 조건 | 소스 | 설정·자산 |
|---|---|---|---|
| 목표와 같음 | C = T | 유지 | 유지 |
| 원본 그대로 | C = O ≠ T | 교체 | 교체 |
| 사용자 수정 | C ≠ O, T 있음 | 교체 + 패치(O→C) | **유지** + 목표본 참고 저장 |
| 원본 미확인 | O 없음, C ≠ T | 백업 후 교체 | 유지 + 목표본 참고 저장 |
| 5.x 신규 | C 없음, T 있음 | 추가 | 추가 |
| 5.x 에서 제거 | O 있음, T 없음 | 백업 후 삭제(사용자 수정이면 패치도) | — |
| 사용자 추가 | O·T 없음 | 유지 | — |

모든 변경은 하나의 transaction 이다(새로 추가한 `ProjectFileTransaction.removeFile` 로 삭제도 rollback 대상). `migration-backup/<시각>-reassemble-*/` 에 `originals/`(교체·삭제 전 원본), `patches/<컴포넌트>/<경로>.patch`(`git diff --no-index` 결과, 원문 바이트 보존 — EUC-KR 소스 대응), `reference/`(유지한 설정·자산의 목표본), `reassemble-plan.json` 을 남기고 매니페스트(`.egovframe-components.json`, 파일별 hash·srcHash)를 기록해 이후 `upgrade_egovframe_project`·`validate_egovframe_project`·`remove_egovframe_components` 가 그대로 동작하게 한다. 사용자 패치는 자동으로 다시 적용하지 않는다 — 5.x 소스가 크게 바뀌어 fuzz 적용은 조용한 오동작을 만들 수 있다. 대신 작업 목록(`reapply-patch`·`removed-in-5x`·`unverified-replaced`·`review-config`)을 돌려주고, `verify=true` 면 compile 오류 수를 그 파일에 붙인다.

검증: `test:reassemble`(메모리 원본 저장소, 46단언), `test:reassemble-live`(공식 v3.10.0 트리의 `cmm`·`bbs` + 수정 2파일 → 원본 v3.10.0 99%, 교체·추가 780개 파일 = v5.0.7 tree blob, 패치 2, `validate` 누락 0, `upgrade` 미리보기 변경 0), `test:migrate-corpus`(공식 3.10.0·4.3.2 트리 자체의 재조립 미리보기 — 원본 100%·사용자 수정 0). 단독 `mvn compile` 은 넣지 않았다: `cmm`·`bbs` 만으로는 5.0.7 의 다른 컴포넌트 참조 때문에 컴파일이 성립하지 않으며, 쓴 파일이 공식 tree 와 바이트 단위로 같다는 단언이 더 강한 근거다.

## 5단계(v0.41.0): 전환 리허설 (`rehearse_egovframe_migration`)

평가서는 난이도를 등급으로, 재조립·적용 도구는 각 단계의 실행을 맡지만 "자동 단계를 전부 돌리면 컴파일 오류가 몇 개 남는가"는 실제로 컴파일해 봐야 압니다. 리허설은 프로젝트 사본에서 전 과정을 돌려 그 수를 재고, 프로젝트는 읽기만 합니다. 코드는 `src/rehearse.ts`, 테스트는 `test/rehearse.mjs`(오프라인)·`test/rehearse-live.mjs`(CI 통합)입니다.

| 항목 | 결정 | 이유 |
|---|---|---|
| 사본 | `EGOVFRAME_CACHE_DIR/rehearsal/<이름>-*` 에 `fs.cpSync`(`.git`·`target`·`build`·`node_modules`·`.gradle`·`.idea`·`*-backup` 제외, symlink 는 링크 그대로). 작업 디렉터리가 프로젝트 안이면 거부(재귀 복사). 기본은 끝나고 삭제, `keepWorkspace=true` 면 경로 반환 | 원본을 건드리지 않는 것이 리허설의 전제. 실행 전후 `fingerprintTree`(경로·크기·mtime 의 sha256)로 확인해 결과에 적는다 |
| 순서 | **재조립 → 전환 적용 → 컴파일 → pom 맞춤 → 컴파일** | 적용(javax→jakarta 등)이 컴포넌트 소스를 바꾸면 git blob 지문으로 원본 태그를 찾을 수 없다. 실측: 공식 4.3.2 트리를 적용 → 재조립 순으로 돌리면 원본이 v5.0.1 로 오인되고 1,489개 파일이 "사용자 수정"으로 분류됐다(재조립 3분 20초). 순서를 바꾸면 v4.3.2 식별·사용자 수정 0·18초 |
| 오류 수 | Maven 은 `-Dmaven.compiler.fork=true` + 환경 변수 `JDK_JAVAC_OPTIONS=-Xmaxerrs 100000`(javac 실행 파일이 읽음) | javac 는 기본 100개에서 보고를 멈추고 maven-compiler-plugin 에는 이를 바꾸는 사용자 속성이 없다. fork 하면 javac 실행 파일이 환경 변수를 읽는다. Gradle 은 정확히 100건이면 상한 가능성을 노트로 알린다 |
| pom 맞춤 | 기준 = 카탈로그 고정 태그의 공식 공통컴포넌트 `pom.xml`(재조립과 같은 sha256 검증 아카이브). parent 를 기준 parent 로(없으면 추가, 다르면 교체), 기준의 주 의존성 중 없는 것 추가(test 제외), 있는 것은 버전 표기·scope 를 기준과 같게(기준에 버전이 없으면 프로젝트의 `<version>` 제거 → parent 관리), 기준 의존성이 parent 의 속성을 쓰는데 프로젝트가 같은 속성을 재정의하면(예: `spring.maven.artifact.version`=5.3.37) 그 정의 삭제. 주석·`dependencyManagement`·`build`(plugin)·`profiles` 안은 건드리지 않음. 멱등 | 자동 단계 뒤 오류의 대부분은 코드가 아니라 의존성이다(실측 94%). pom 을 기준에 맞춘 뒤 남는 오류가 "코드 작업"이다. 사본에만 적용하고 패치로 돌려줘 사람이 검토해 반영한다 |
| 오류 분석 | "package X does not exist" = 누락 패키지, 같은 파일의 다른 오류 = 연쇄(그 파일의 첫 누락 패키지에 귀속), 나머지는 `linkBuildError` 로 수동 항목·규칙과 연결. 누락 패키지마다 기준 pom 에서 후보 좌표(groupId 접두어 + artifactId 토큰) | 연쇄를 따로 세지 않으면 "cannot find symbol 5,000건"이 코드 문제처럼 보인다 |
| 기록 | 최근 결과를 `EGOVFRAME_CACHE_DIR/rehearsal/records/<프로젝트 경로 sha256 16자>.json`(패치 본문 제외)에 저장하고 평가서 6절이 읽어 "실측"으로 표시(등급 산식에는 넣지 않음) | 프로젝트 읽기 전용을 지키면서 평가서와 연결 |
| 메타 | 비읽기(캐시에 사본·빌드 실행)·비파괴(프로젝트 불변)·멱등·openWorld(원본 태그 미러·아카이브·Maven 저장소), outputSchema | |

실측(2026-10-08, 공식 공통컴포넌트 v4.3.2 `bfa2ef5` 전체 트리 6,523 파일, JDK 21·Maven 3.9.11, 약 1분):

| 단계 | 결과 |
|---|---|
| 재조립 | 원본 v4.3.2 식별, 컴포넌트 165종, 교체 2,258·추가 69·삭제 62·유지 1,784 |
| 전환 적용 | 자동 61건(26파일), 수동 38건 남음(xml-namespace 13·class-removed 13·library 8·parent·spring-version·removed-module·component-class-removed) |
| 컴파일 ① | 오류 6,335건 / 503파일 = 누락 패키지 514 + 연쇄 5,465 + 기타 356 (`jakarta.annotation` 664·`org.egovframe.rte.ptl.reactive.validation` 312 …) |
| pom 맞춤 | parent `org.egovframe.web:egovframe-web-config-parent:5.0.2` 추가, 좌표 25 추가, 버전 44·scope 3 정리 |
| 컴파일 ② | 오류 1건 — `EgovCertInfoUtil`(GPKI 벤더 jar 가 `javax.servlet.http.HttpServletRequest` 를 참조) |

CI 통합(`test:rehearse-live`)은 이 값을 `catalog/migration-corpus.json` 의 `rehearsal` 에 기대값으로 두고(오류 ±10%, pom 맞춤 후 ≤5) 매번 확인합니다. 전체 트리(≈220MB)는 코퍼스 캐시에 넣지 않고 커밋 고정 아카이브(≈38MB)를 임시 디렉터리에 받습니다.

범위 밖: 남은 오류의 자동 수정, 테스트 실행(컴파일까지), Gradle 의 pom 맞춤.
