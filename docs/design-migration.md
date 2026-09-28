# 5.x 전환 설계 (v0.29.0 진단 · v0.30.0 적용) — `migrate_egovframe_project`

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
