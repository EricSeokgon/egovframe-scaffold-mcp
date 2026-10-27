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

## DDL 입력과 검색 조건 (v1.4)

공식 Initializr v5.0.7(2026-10-16)은 CRUD 코드 생성의 결함 9건을 고쳤습니다. 이 도구는 필드 목록을 직접 받아 대부분과 무관했지만, 공식 도구처럼 DDL 을 그대로 받는 입력과 검색 조건이 없었습니다.

- `src/ddl.ts` `parseCreateTable(ddl, { dialect })` — 주석을 지우고(문자열 안은 보존), 따옴표·괄호 깊이를 보며 최상위 콤마로 정의를 나누고, 키워드 판정은 문자열 리터럴을 지운 뒤에 합니다. 그래서 COMMENT·DEFAULT 안의 콤마·괄호와 "primary key" 문구에 속지 않습니다.
- 백슬래시: 표준 해석(백슬래시는 보통 문자)으로 따옴표 짝이 맞으면 그쪽을, 아니면 MySQL 식(`\'` 이스케이프)으로 해석합니다(`chooseBackslashMode`). `'C:\'` 와 `'user\'s'` 를 모두 받습니다. 공식 `ddlParser.spec.ts` 의 입력 12개와 분리 함수 경계 7개를 `test/crud-ddl.mjs` 가 같은 결과로 단언합니다.
- 타입: 문자열(VARCHAR·VARCHAR2·TEXT·CLOB…), 정수(INT·BIGINT·SERIAL…), `NUMBER(p,0)`(p≤9 Integer, ≤18 Long, 그 이상 BigDecimal), 소수(DECIMAL·NUMBER(p,s)), 실수, 불리언(BOOLEAN·BIT(1)), 날짜(DATE — Oracle·Tibero 는 LocalDateTime), 일시(DATETIME·TIMESTAMP), 시간대(TIMESTAMP WITH TIME ZONE·TIMESTAMPTZ → Instant), 이진(BLOB·BYTEA·RAW…). 모르는 타입은 String + 경고.
- 검색: `search` 컬럼(문자열)마다 `LIKE #{searchKeywordLike}` 를 쓰고 패턴은 `<bind name="searchKeywordLike" value="'%' + searchKeyword + '%'"/>` 로 만듭니다. 공식이 고친 `||` 결합은 MySQL 기본 설정(PIPES_AS_CONCAT 미적용)에서 논리 OR 라 검색어와 무관하게 전체 행을 돌려줍니다. 검색 조건은 목록과 건수에 같이 들어가며, 화면은 Spring form 태그(`form:select`·`form:hidden`)로만 출력해 이스케이프됩니다(공식이 고친 반사형 XSS 경계).
- `test:crud-search-live`(CI 통합)는 생성 Mapper 를 MyBatis 3.5.19 로 읽어 HSQLDB 의 MySQL·PostgreSQL·Oracle 문법 모드에서 같은 검색을 실행해 결과가 같음을 확인합니다. `test:crud-integration` 은 DDL·검색으로 만든 CRUD 를 공식 simple-backend(boot)·web-sample(classic)에서 함께 컴파일합니다.

## 목록 페이징 (v1.8)

v1.4 까지 목록은 전체 행을 가져왔습니다. `paging` 은 표준프레임워크 화면 관례(`DefaultVO` 의 `pageIndex`·`pageUnit`·`pageSize`·`firstIndex`·`recordCountPerPage`, `PaginationInfo`, `<ui:pagination>`)와 방언별 SQL 을 만듭니다.

- **SQL**: 공식 공통컴포넌트 v4.3.2 매퍼(`EgovArticle_SQL_*.xml`)와 같은 꼴입니다. MySQL·MariaDB·PostgreSQL(·HSQL)은 `ORDER BY` 뒤 `LIMIT #{recordCountPerPage} OFFSET #{firstIndex}`, Oracle·Tibero·Altibase·CUBRID(·Goldilocks)는 정렬한 목록을 `SELECT * FROM ( SELECT rownum rn, TB.* FROM ( … ) TB ) Z WHERE rn BETWEEN #{firstIndex} + 1 AND #{firstIndex} + #{recordCountPerPage}` 로 감쌉니다(12c 의 `OFFSET … FETCH` 는 Tibero·Altibase 에 없어 공통컴포넌트처럼 ROWNUM 하나로). 건수 쿼리는 페이징 없이 같은 검색 조건입니다.
- **방언**: `dialect` → `Globals.DbType`(공식 템플릿의 `globals.properties`, `maria`·`postgres` 별칭) → 설정 파일의 JDBC URL(`log4jdbc` 포함)·`<jdbc:embedded-database type="HSQL">`(공식 web-sample) 중 한 방언일 때. 셋 다 없거나 여럿이면 거부합니다.
- **classic**: 컨트롤러가 요청 값의 `pageIndex`(≥1)·`pageUnit`(1–100)·`pageSize`(1–20)를 제한한 뒤 `PaginationInfo` 로 `firstIndex`·`lastIndex`·`recordCountPerPage` 를 정하고 전체 건수를 넣습니다. 화면은 검색 폼에 `pageIndex` hidden(검색하면 1쪽으로)과 `<ui:pagination type="text" jsFunction="fn_egov_link_page">` — `paginationManager` 빈이 없으면 RTE 가 기본 텍스트 렌더러를 쓰므로 설정 파일을 만들지 않습니다(이미지 렌더러는 `type="image"` 와 `imageRenderer` 빈).
- **boot(REST)**: `GET /api/{entity}?page=1&size=10`(size 1–100) → `{content, totalCount, page, size}`.
- **기본값**: `pageUnit`·`pageSize` 는 `DefaultVO` 의 초기값으로 들어갑니다. `paging` 을 생략하면 v1.7 까지와 같은 바이트입니다.
- **검증**: `test:crud-paging`(게이트) — 방언 8종 SQL, 방언 결정 순서와 거부, classic·boot 코드, 생성물 보안약점 0건. `test:crud-search-live`(CI 통합) — 생성 Mapper 를 MyBatis 로 HSQLDB 의 MySQL·PostgreSQL(LIMIT/OFFSET)·Oracle(ROWNUM) 문법 모드에서 실행해 정렬된 페이지와 검색 페이지가 같음(`p1=[1,2] p2=[3] s1=[1] s2=[3]`). `test:crud-integration` — 공식 simple-backend(boot)·web-sample(classic)에 페이징 CRUD 를 더해 함께 컴파일(방언은 각 템플릿 설정에서).
- **범위 밖**: 키셋 페이징, 정렬 컬럼 선택(`ORDER BY ${…}` 는 SQL 삽입 위험 — 기본키 정렬만), Tibero·Altibase·CUBRID 실DB 실행(SQL 문자열 단위 확인).

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
