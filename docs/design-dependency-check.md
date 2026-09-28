# 의존성 점검 설계 (v0.30.0) — `check_egovframe_dependencies`

## 배경

표준프레임워크 프로젝트의 의존성 버전은 세 곳에서 정해진다 — 공식 5.x parent(`egovframe-web-config-parent`·`egovframe-boot-starter-parent`)의 `properties`/`dependencyManagement`, 실행환경(RTE) 모듈 pom 의 전이 의존성, 그리고 프로젝트가 직접 적은 버전. 운영 중인 프로젝트가 "공식 템플릿 기준보다 얼마나 뒤처졌는가"를 오프라인에서 답하는 것이 이 도구의 목적이며, 폐쇄망을 고려해 취약점 조회는 선택(`offline=false`)이다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 기준의 출처 | **공식 5.x parent pom 2종**을 표준프레임워크 Maven 저장소에서 내려받아 `catalog/dependency-baseline.json` 으로 동봉. 생성기 `scripts/generate-dependency-baseline.mjs`, pom sha256 기록 | 공식 템플릿이 실제로 관리하는 버전이 곧 기준이다. 문서가 아니라 pom 이 근거 |
| 계열 기준 | BOM import(`type pom`·`scope import`)와 버전 속성은 groupId 계열 규칙(`families`)으로 기록 — `org.springframework`(6.2.11), `org.springframework.security`(6.5.5), `org.springframework.boot`(3.5.6), `org.springframework.batch`, `org.springframework.cloud`, `com.fasterxml.jackson`, `dev.langchain4j` | parent 는 spring-* 를 낱개로 나열하지 않고 BOM 으로 관리한다. 개별 좌표가 목록에 없어도 계열로 대조한다 |
| RTE 버전 | 규칙 카탈로그(`migration-rules.json`)의 목표 5.0.2 를 기준으로 올린다(parent 는 5.0.1 관리, `parentVersion` 에 기록) | 실행환경 릴리스가 parent 갱신보다 앞설 수 있다 |
| Boot BOM | `spring-boot-dependencies` 전체 목록은 담지 않는다(수백 항목). Boot parent 를 쓰는 프로젝트의 버전 없는 의존성은 `managed` 로 분류 | 파일 크기·유지 비용 대비 실익이 적다 |
| 분류 | `ok`(기준 이상) · `outdated`(기준 미만) · `managed`(5.x parent 가 관리) · `legacy`(3.x/4.x RTE 좌표·javax 좌표 → `migrate_egovframe_project`) · `replace`(DBCP 1.x·Log4j 1.x·commons-fileupload·Tiles·JUnit 4·Spring/Security 6 미만 등, 전환 규칙의 `libraries` 재사용) · `unknown`(기준 없음 — 판단 보류) · `unversioned`(버전 없고 parent 도 없음) | 모르는 것을 모른다고 말한다. `unknown` 은 조치 목록에 넣지 않는다 |
| 버전 해석 | `<properties>` 를 풀어 비교(루트 pom 속성은 모듈 pom 에 상속). 못 풀면 `unknown` | parent 가 정의한 속성(`${java.version}`)은 parent 기준으로 판정 |
| 보안 점검 | 존재 여부만 판정하고 근거(파일·라인·텍스트)를 남긴다 — `sec.security` 컴포넌트 설치, CSRF 설정, XSS 필터(HTMLTagFilter 등), 보안 응답 헤더, HTTPS 저장소 | 구 `security_patch_advisor` 구상을 흡수. "안전하다" 가 아니라 "설정이 보인다/보이지 않는다" 만 말한다 |
| 취약점 | `offline=false` 일 때 OSV `POST /v1/querybatch`(Maven 생태계, 100건 단위)로 버전이 확정된 의존성만 조회. 실패는 `osvError` 로 기록하고 나머지 결과는 유지 | 폐쇄망 기본 오프라인. 조회 함수는 주입 가능해 오프라인 테스트가 가능하다 |
| 읽기 전용 | 파일을 쓰지 않는다(테스트가 디스크 불변을 단언) | |

## 근거 요약

| 출처 | 내용 |
|---|---|
| `org.egovframe.web:egovframe-web-config-parent:5.0.1` | parent 없음, `java.version` 17, `egovframe.rte.version` 5.0.1, `spring.framework.version` 6.2.11, dependencyManagement 106항목(RTE·Jakarta·commons·log4j2·jackson·mybatis-spring 없음 …) |
| `org.egovframe.boot:egovframe-boot-starter-parent:5.0.1` | 상위 `spring-boot-starter-parent:3.5.6`, dependencyManagement 72항목 + BOM import(spring-framework 6.2.11·spring-security 6.5.5·spring-cloud 2025.0.0), `spring.batch.version` 5.2.3, `spring.ai.version` 1.0.1 |

합친 기준: 관리 좌표 139종 + 계열 7종. RTE 모듈 24종은 5.0.2.

## 도구 인터페이스

```text
check_egovframe_dependencies(projectDir, offline=true, format="markdown"|"json")
```

결과: `parent`(종류·상태), `java`, `findings[{file, line, groupId, artifactId, version, resolvedVersion, scope, status, baseline, note}]`, `summary`, `checks[{id, title, status, evidence[], hint}]`, `vulnerabilities?`, `osvError?`. 리소스 `egovframe://catalog/dependency-baseline` 가 기준을 그대로 돌려준다.

## 검증

- `test:dependencies`(68단언, 오프라인): 기준 카탈로그 스키마·출처·RTE 5.x 모듈 포함·계열 규칙, 분류 함수(3.x/4.x/5.x RTE·javax·DBCP·Log4j·Spring 4/6.1/기준·parent 관리·버전 없음·기준 밖·미해결 속성), 3.10 픽스처(속성 해석·라인·scope·보안 근거·http 저장소), OSV 모의(질의 대상·결과 매핑·실패 처리), 5.x parent 픽스처(managed·outdated·Java parent 관리·보안 ok), gradle, 빈 디렉터리, 디스크 불변
- `test:dependencies-live`(CI): log4j 1.2.17 픽스처를 `offline=false` 로 점검해 OSV 결과가 붙는지 확인
- 실제 자산: 공식 5.x `egovframe-web` 템플릿 → parent 관리 19건·조치 0건, 공식 공통컴포넌트 v3.10.0 pom → legacy 18·replace 3·outdated 17, 같은 pom 을 `migrate_egovframe_project` 로 적용한 뒤 → legacy 0·outdated 21(기준 미만 라이브러리는 전환 도구의 범위 밖)

## 기준 갱신 절차

1. 새 parent 릴리스가 나오면 `node scripts/generate-dependency-baseline.mjs --web <ver> --boot <ver>` (또는 `PARENTS` 기본값 갱신).
2. RTE 목표 버전은 `catalog/migration-mapping.json` 의 `runtime.toVersion` 이 정한다 — 먼저 전환 규칙을 재생성한다.
3. `npm run test:dependencies`, 필요하면 `test:migration-rules`(Jakarta 목적지 버전이 기준 이상인지 검사).
