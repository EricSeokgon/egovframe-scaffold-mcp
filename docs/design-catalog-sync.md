# 공통컴포넌트 카탈로그 동기화·완전 조립 설계

## 기준 upstream

- 저장소: `eGovFramework/egovframe-common-components`
- 공식 태그: `v5.0.6`
- 태그 commit: `23d01889e01fcfa486d28d7a2ec4adb51fbaf3ad`
- 보안 패치 수준: `v5.0.6`
- 조사일: `2026-07-22`

공식 Development IDE의 `ComponentAssembleOperation`은 컴포넌트 zip을 복사하면서 `pom.xml`, `web.xml`, `context-common.xml`, validator, DispatcherServlet 설정을 별도 병합한다. MCP 구현은 같은 자산 범주를 카탈로그에 명시하되, 사용자 프로젝트의 XML·POM 구조를 추정해 덮어쓰지 않는다.

## 카탈로그 schema v2

`catalog/components.json`의 `source`는 `repository`, `tag`, `commit`, `surveyedAt`, `securityPatchLevel`, `archive.sha256/bytes/files`를 기록한다. 컴포넌트에는 다음 선택 필드를 추가한다.

- `messageBundles`: 컴포넌트 패키지의 다국어 properties
- `idgnContexts`: Java `@Resource` bean 참조와 테이블을 기준으로 연결한 ID 생성기 context
- `schedulingContexts`: 패키지 참조·파일 코드 기준 스케줄러 context
- `webAssets`: CSS·JavaScript·이미지·HTML
- `webFragments`: 공통 Spring·Spring MVC XML과 루트 JSP
- `mavenDependencies`: Java import 분석으로 탐지한 Maven 좌표

기존 schema v1 카탈로그와 매니페스트 v1/v2는 읽을 수 있다. 신규 조립 매니페스트는 source 고정 정보와 아카이브 무결성을 포함하는 schema v3을 기록한다.

## `sync_egovframe_catalog`

1. GitHub API에서 요청 ref를 40자리 commit으로 해석한다.
2. 공식 태그가 카탈로그 고정 commit과 다르면 즉시 거부한다.
3. commit codeload zip을 내려받아 100 MiB·20,000파일 상한, zip-slip 경로, SHA-256·크기·파일 수를 검증한다.
4. `sec.security` 보안 패키지와 카탈로그 미매핑 Java·Mapper·JSP 경로를 보고한다.
5. 고정 commit의 archive 지문이 다르면 파일을 쓰기 전에 거부한다.

## 조립 안전 경계

- 소스·Mapper·JSP뿐 아니라 카탈로그의 실행 자산을 함께 복사한다.
- 기존 파일이 upstream과 바이트 단위로 같으면 재사용하고, 다르면 전체 조립을 거부한다.
- 쓰기 중 오류가 발생하면 이번 호출에서 만든 파일을 롤백한다.
- DB 비사용 컴포넌트는 통합 SQL 폴백을 유발하지 않는다.
- Maven 좌표는 구조화 반환한다. 대상 POM의 dependency management와 버전 정책이 프로젝트마다 달라 자동 삽입하지 않는다.
- `web.xml`·기존 Spring XML의 노드 병합도 자동 덮어쓰기 대신 공식 가이드와 `webFragments` 목록으로 안내한다.

## 검증

- `npm run test:catalog-sync`: 합성 zip의 해시·파일 수·보안 패키지·미매핑 탐지와 고정 메타데이터 검증
- `npm run test:catalog-sync-live`: 공식 `v5.0.6` 태그·commit·archive 지문과 전체 경로 매핑 검증
- `npm run test:components`: `bbs`, `login`, `sec.security`, `cmm` 실제 조립에서 message·IDGN·웹 자산·공용 fragment·선별 SQL·매니페스트 v3 검증
