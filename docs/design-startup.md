# 기동 검증 설계 (v1.11, `verify_egovframe_startup`)

## 배경

전환·갱신·조립 뒤 "컴파일은 되는데 뜨지 않는다"가 가장 흔한 다음 단계입니다. 빈 생성 실패, 설정 파일 경로, DB 접속, JDBC 드라이버, MyBatis 매퍼 XML 오류는 컴파일로 잡히지 않습니다. 지금까지 리허설(`rehearse_egovframe_migration`)은 compile 에서, 배포 산출물 검증(v0.45)은 컨테이너 빌드에서 끝났습니다.

실측에서 이미 하나를 찾았습니다: `create_egovframe_project(database="hsql")` 로 만든 **포털·업무 템플릿이 뜨지 않았습니다.** 두 템플릿은 `Globals.Hsql.AutoInit = false` 가 기본이라 DbType 만 hsql 로 바꾸면 빈 인메모리 DB 로 떠서 보안 설정이 `LETTNROLES_HIERARCHY` 를 조회하다 실패합니다. v1.11 에서 hsql 을 고르면 AutoInit 도 켭니다.

## 결정

- **프로젝트를 바꾸지 않는다**: Boot 는 `mvn -B spring-boot:run -Dspring-boot.run.arguments=--server.port=<빈 포트>`(Gradle `bootRun --args=…`). Classic war 는 패키징(`runBuild package`) 뒤 war 를 **캐시에 풀어 둔 고정 버전 Tomcat**(10.1.61, Servlet 6.1 이상이면 11.0.27)에 `ROOT.war` 로 두고, `CATALINA_BASE` 를 임시 디렉터리로 따로 둬서 `org.apache.catalina.startup.Bootstrap start` 를 `java` 로 직접 실행합니다. 둘 다 `-Djava.awt.headless=true`.
  - Cargo 를 쓰지 않은 이유: Cargo 의 내장 다운로더가 프록시 환경에서 Tomcat 배포본을 받지 못했고(HTTP 429, Maven 해석이 아님), 플러그인 버전·설정이 하나 더 늘어납니다. 직접 실행은 스크립트 실행 권한(zip 해제로 사라짐)과 OS 별 `catalina.sh/bat` 차이도 피합니다.
  - Tomcat 은 `catalog/deploy-rules.json` 의 `startup.tomcat` 에 버전·sha256 을 고정하고 사내 미러(`EGOVFRAME_MAVEN_MIRROR`) → Maven Central → archive.apache.org 순서로 받아 sha256 이 다르면 거부합니다. 폐쇄망은 `tomcatHome` 으로 설치된 Tomcat 을 씁니다.
  - `server.xml` 사본은 HTTP 포트를 바꾸고 `127.0.0.1` 에만 열고, 셧다운 포트를 끄고(-1) AJP 를 지웁니다.
- **기동 판정 = 완료 문구 + HTTP**: Boot `Started … in N seconds`, Tomcat `Server startup in [N] ms` 뒤 HTTP 로 확인(기본 `/`, Boot 에 actuator 가 있으면 `/actuator/health`, `path` 로 지정). 5xx·무응답이 아니면 기동(302 로그인 이동도 기동). 웹이 아니면 완료 문구만. Tomcat 은 웹앱 배포가 실패해도 서버는 떠 있으므로 `Context [] startup failed`·`One or more listeners failed to start` 같은 실패 문구를 보면 바로 멈춥니다.
- **원인 분류**: 가장 안쪽 `Caused by` 를 기준으로 종류를 정하고 처방을 한 줄 답니다 — 포트 사용 중, JDBC 드라이버 없음(드라이버 → 좌표 표), DB 접속 실패(JDBC URL — 로그에 없으면 설정 파일의 값 — 와 `prepare_egovframe_database`), DB 테이블 없음(접속은 됐는데 스키마가 없음), 매퍼 XML(파일·줄), 설정 누락(없는 XML import·placeholder), javax 네임스페이스(전환 잔여), 빈 생성 실패(**실제로 실패한 안쪽 빈**과 정의 파일 — 바깥 `sampleService` 가 아니라 클래스를 못 찾은 `leaveaTrace`), GUI 빈(화면 없는 환경), HTTP 오류, 시간 초과, 기동 전 빌드 실패·원격 저장소 장애(v1.6 판정).
  - 경로는 배포 사본·빌드 결과(`…/webapps/ROOT/WEB-INF/classes/…`, `target/classes/…`)를 프로젝트 원본(`src/main/resources/…`, `.class` → `src/main/java/….java`)으로 되돌려 보여줍니다.
  - 기동은 됐는데 health 가 503 이면 기동 뒤 로그(헬스 체크의 DB 연결)에서 다시 원인을 찾습니다.
- **끝내기**: 판정이 나면 build-runner 의 `signal` 로 프로세스 트리를 끝냅니다(Windows taskkill /T, POSIX 프로세스 그룹). 임시 `CATALINA_BASE` 는 지웁니다.

## 기획에서 미룬 것

- `database="compose"`(v1.10 의 compose DB 를 먼저 띄워 접속 정보 주입): Classic 템플릿은 접속 정보를 `globals.properties` 에서만 읽어 환경 변수로 덮을 수 없고, 파일을 바꾸면 "프로젝트를 바꾸지 않는다"가 깨집니다. 지금은 DB 접속 실패의 처방으로 `prepare_egovframe_database(run=true, keep=true)` 를 안내합니다. v1.13(설정 외부화)에서 자리표시자가 생기면 다시 다룹니다.
- `rehearse_egovframe_migration(startup=true)`·평가서의 "기동 여부" 줄: 리허설 사본은 공통컴포넌트 전체라 DB 없이는 뜨지 않아 의미 있는 결과가 나오지 않습니다(DB 연동이 먼저). v1.12(사용자 수정 재적용)의 사본 검증과 함께 넣습니다.
- 템플릿 7종 중 기획의 `portal`·`enterprise` 는 카탈로그 이름 `portal-site`·`enterprise-business`, `msa-edu` 일부 대신 `mobile-web` 을 넣었습니다.

## 검증

- `test:startup`(게이트, 32단언, 가짜 runner): 실제 실행에서 받은 로그 고정물 8종(`test/fixtures/startup/`: Boot 3·Tomcat 10.1 성공, 기동 뒤 DB 접속 거부, 드라이버 없음, 포트 사용 중, 매퍼 XML, 설정 누락, 빈 클래스 없음)과 합성 로그(javax·placeholder·없는 DB), 경로 되돌리기(Windows 경로 포함), CATALINA_BASE, Tomcat 캐시·sha256 거부·내려받는 순서, verifyStartup 흐름(Boot 성공·실패·503 의 DB 원인, Classic 패키징→Tomcat, 패키징 실패, 시간 초과, 빌드 실패, path·HTTP 500, 멀티 모듈 거부), MCP·CLI.
- `test:startup-live`(CI 통합): 공식 템플릿 7종(web·simple-homepage·portal-site·enterprise-business·mobile-web → Tomcat, boot-web·simple-backend → Boot)을 내장 HSQL 로 기동(각 2분 이내 — 로컬 실측 16–29초), 깨뜨린 사본 5종(매퍼 XML·설정 import·빈 클래스·mysql 접속·oracle 드라이버)의 분류, batch-db-web 의 GUI 빈 분류.
