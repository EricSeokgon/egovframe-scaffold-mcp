# CRUD 코드 생성 설계

## 목표

`generate_egovframe_crud`는 eGovFrame Development의 공식 CRUD `wizard.xml` 입력 구조를 MCP에서 사용할 수 있게 옮긴 도구다. IDE가 받는 DataAccess·Service·Web 그룹과 경로 입력을 유지하면서, 대화형 호출에 필요한 명시적 컬럼 스펙과 안전 게이트를 추가한다.

참조 기준은 `eGovFramework/egovframe-development` 커밋 `38496989daed6f57d8d238fc12f4f4f8374412f2`의 다음 자산이다.

- `egovframework.dev.imp.codegen.template.templates/eGovFrameTemplates/crud/wizard.xml`
- 같은 디렉터리의 VO·Mapper·Service·Controller·JSP Velocity 템플릿

공식 템플릿을 그대로 내장하지 않고, 입력·출력 계층과 메서드 관례를 코드 네이티브 렌더러로 구현한다.

## 입력 모델

필수 입력:

- `projectDir`: `pom.xml`, `build.gradle`, `build.gradle.kts` 중 하나가 있는 프로젝트
- `tableName`: 스키마 수식어가 없는 단일 SQL 식별자
- `basePackage`: Java 패키지
- `fields`: 1~100개의 컬럼 정의

컬럼 정의:

| 필드 | 설명 |
|---|---|
| `columnName` | SQL 컬럼명 |
| `propertyName` | Java 프로퍼티명. 생략 시 camelCase 변환 |
| `javaType` | 지원 Java 타입. 기본 `String` |
| `jdbcType` | MyBatis JDBC 타입. 생략 시 Java 타입에서 추론 |
| `primaryKey` | update/delete/select 조건에 사용할 기본키. 최소 1개 필수 |
| `generated` | DB 생성키. 단일 기본키에서만 허용 |
| `nullable` | NULL 허용 메타데이터 |
| `label` | Javadoc·JSP 표시명 |

지원 Java 타입은 `String`, `Integer`, `Long`, `Double`, `BigDecimal`, `Boolean`, `LocalDate`, `LocalDateTime`, `Instant`, `byte[]`이다.

## 공식 wizard 대응

| wizard 입력 | MCP 입력 |
|---|---|
| `author`, `createDate` | 같은 이름 유지 |
| `checkDataAccess` | DefaultVO·VO·Mapper·Mapper XML 생성 |
| `mapperFolder`, `mapperPackage`, `voPackage` | 같은 이름 유지, 생략 시 `basePackage` 기준 기본값 |
| `checkService` | Service·ServiceImpl 생성 |
| `servicePackage`, `implPackage` | 같은 이름 유지 |
| `checkWeb` | Controller 생성 |
| `controllerPackage`, `jspFolder` | 같은 이름 유지 |
| JSP 출력 조건 | `profile=classic`과 `includeJsp=true` |

Service는 DataAccess에, Web은 Service에 의존한다. 상위 그룹만 켜고 하위 그룹을 끄는 조합은 생성 전에 거부한다.

## 출력

Classic 프로필은 Spring MVC `.do` 경로와 목록·등록 JSP를 만든다. Boot 프로필은 동일한 서비스 계층 위에 `/api/{entity}` REST Controller를 만든다.

MyBatis XML은 기본키 조건으로 select/update/delete를 만들고, `generated=true`인 단일 기본키에는 `useGeneratedKeys`를 설정한다. 검색·페이징용 DefaultVO는 공식 출력 구조와 호환되는 최소 필드를 제공한다.

`withTest=true`는 JUnit 5 서비스 계약 테스트를 `src/test/java`에 추가한다. 이 테스트는 생성된 서비스 인터페이스의 CRUD 메서드 집합을 확인한다.

## 안전 게이트

1. SQL·Java 식별자와 패키지 형식을 검증한다.
2. mapper/JSP 폴더는 프로젝트 기준 상대경로만 허용하고 `..`·절대경로를 거부한다.
3. 기본키가 없는 update/delete 생성을 거부한다.
4. 생성할 전체 경로를 먼저 계산해 기존 파일이 하나라도 있으면 아무것도 쓰지 않는다.
5. 실제 쓰기 중 오류가 발생하면 이번 호출에서 생성한 파일을 역순으로 제거한다.
6. `dryRun=true`는 동일한 검증과 파일 계획을 수행하되 디스크를 변경하지 않는다.

## 검증

`npm run test:crud`는 네트워크 없이 다음을 확인한다.

- Classic 10파일(테스트 포함)과 Boot 7파일 생성
- wizard DataAccess 단독 그룹
- Mapper namespace·PK WHERE·DB 생성키
- Java 타입 import와 컬럼→프로퍼티 변환
- JSP/REST 프로필 분기
- PK 누락·경로 이탈 거부
- 기존 사용자 파일 보존과 전체 충돌 무기록

`npm run test:crud-integration`은 공식 simple-backend/Boot와 web-sample/Classic 조합을 내려받아 CRUD를 생성하고 JDK 17에서 Maven compile을 수행한다. 이 검증은 네트워크와 Maven이 필요하므로 GitHub Actions에서 실행한다.
