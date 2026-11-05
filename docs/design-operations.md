# 운영 준비 점검 설계 (`check_egovframe_operations`, v1.15.0)

## 1. 문제

"기동은 되는데 운영에서 터진다"는 설정은 보안약점 점검(코드)·기동 검증(뜨는가)이 잡지 못합니다. 2026-11-04 공식 템플릿 6종 실측: `web`·`portal-site`·`enterprise-business`·`simple-homepage`·`simple-backend` 가 `jdbc:log4jdbc:` + `net.sf.log4jdbc.DriverSpy` 를 운영 설정에 그대로, 3종이 `egovframework` 로거 DEBUG, `web`·`boot-web` 은 콘솔 appender 만, Boot 2종에 `spring-boot-devtools`, HikariCP 는 `maximumPoolSize=10` 만, 모든 템플릿이 `Globals.DbType=hsql`. 템플릿으로 시작한 프로젝트는 이 값들을 운영에 가져갑니다. 포털 Q&A 의 운영환경 질문(커넥션 끊김·세션·업로드 용량·로그 폭증)이 이 유형입니다.

## 2. 선행 조사가 정한 것

- **공식 운영 기준 문서가 없다.** 포털 위키의 운영환경 가이드는 이 환경에서 열리지 않았고(400), GitHub `egovframe-docs` 의 `operation-guide` 는 Eclipse 개발환경 플러그인 운영자 가이드입니다. 그래서 기준은 **규칙 데이터**(`catalog/operations-rules.json`)이고, 규칙마다 `basis`(출처)를 적습니다 — 공식 템플릿 기본값 실측, HikariCP 설정 문서(기본 connectionTimeout 30s·maxLifetime 30m·'About Pool Sizing'), Spring Boot 레퍼런스(actuator 기본 health, `server.error.include-stacktrace` 기본 never, devtools 운영 jar 비활성), Servlet 6.0 web.xml·Tomcat 10.1. 기관이 기준을 다르게 보면 2.0 규칙 팩에서 덮어쓸 수 있는 구조입니다.
- **Boot 프로파일은 덮어쓴다.** `application-prod.properties` 가 정한 키는 `application.properties` 의 값을 운영에서 가립니다. 그래서 기본 파일의 그 줄은 보지 않고(properties 만 — yml 은 중첩 키라 보지 않음), 운영 프로파일 이름은 `prod`·`production`·`release`·`ops`·`real`·`live` 중 있는 것(또는 `profile` 파라미터), `dev`·`local`·`test` 류 프로파일 파일은 세트에서 뺍니다.

## 3. 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 규칙은 데이터 | `catalog/operations-rules.json` — id·분류·심각도·제목·`check`·message·fix·basis(ko/en). check 종류 `line`(줄 패턴·`unless`)·`lacks`(`requires` 에 맞는 파일에 `pattern` 이 없음)·`pom`(의존성 좌표)·`session-timeout`·`upload`·`profile`·`secrets` | 보안약점 규칙(v0.44)과 같은 방식 — i18n 검사·규칙 팩에 그대로 올라간다. 일곱 종류 가운데 네 가지는 값 해석(분·바이트·프로파일)이 필요해 코드 |
| 운영 설정 세트 | Boot: `application.*` + 운영 프로파일 파일. Classic: `globals.properties`·`context-*.xml`·`WEB-INF/web.xml`·`log4j2*`/`logback*`. 메시지 번들·매퍼 XML·validator·`src/test` 제외 | 운영에서 실제로 읽히는 파일만 |
| 주석·자리표시자 | XML 주석을 지우고(줄 번호 보존), properties 의 `#`·`!` 줄과 `${…}` 값은 `unless` 로 제외 | 공식 web 템플릿의 `DriverSpy` 는 주석 안에 있다 — 오탐 방지 |
| 비밀값 | `hardcoded-secret-config` 는 `check_egovframe_secure_coding` 의 `hardcoded-config-password` 를 호출해 같은 판정, 값은 가림(앞 2자 + `***`) | 두 도구의 결과가 어긋나지 않게, 응답이 비밀을 옮기지 않게 |
| 등급 | **규칙 단위**로 센다(같은 규칙의 여러 줄은 1) — A: 높음 0·중간 ≤1 / B: 높음 ≤1·중간 ≤3 / C: 높음 ≤3 / D | 템플릿 하나에 같은 규칙이 여러 줄 걸려도 "고칠 것 하나"다. 평가서 등급 산식에는 넣지 않는다 |
| 제안 | 미달 항목에 `suggestion`(바뀔 줄·값)을 붙이되 **쓰지 않는다** | 운영 값은 부하·DB 정책에 따라 다르고 "맞는 값"이 하나가 아니다. 명백한 것(DEBUG→INFO)도 사람이 적용한다 |
| 예외 | `.egovframe-ops-ignore.json` — `ignores[]`: rule·path(디렉터리 접두어 가능)·line?·reason(5자 이상)·reviewer. 보안약점 예외 파일과 같은 형식·같은 로더(`readIgnoreFile`) | 콘솔 로그를 플랫폼이 수집하는 환경처럼 "의도된 미달"을 사유와 함께 남긴다 |
| 평가서 | 4절 아래 「운영 준비 점검」(등급·미달 규칙 상위 8) — 구조화 출력 `assessment.operations` | 납품 패키지·CI 가 이미 평가서를 모은다 |
| CLI | `ops`, `--fail-on ops:C`(등급 지표)·`high>0` 등 | 생성 CI 의 공급망 게이트와 같은 모양 |

범위 밖(기획대로): 자동 수정, 부하 시험·용량 산정, 운영 WAS(JEUS·WebLogic) 설정 파일, OS·DB 서버 설정.

## 4. 검증

- 게이트 `test:operations`(50단언, 오프라인): 규칙 데이터 정합(17종·ko/en·분류·check 종류·id 중복 없음), 파일 분류(메시지 번들·매퍼·테스트·validator 제외), Classic 미달 전부(주석 제외, 세션 120→30 제안, 업로드 100MB+확장자 없음, 비밀값 가림, 풀 타임아웃 XML 1건)·통과 전부(A), Boot 프로파일(prod 세트·dev 제외·덮인 키 제외·`profile` 지정·운영 프로파일 없음), 예외 파일(사유·검토자·접두어·줄), rules 좁히기, 등급, Markdown, 평가서 절, MCP 42종(읽기 전용)·CLI `ops --fail-on ops:C`.
- CI 통합 `test:operations-live`: 공식 템플릿 6종의 등급·미달 규칙 = 실측 기대값(web C · boot-web B · 나머지 C), portal-site 사본에 제안 적용(실제 드라이버·INFO·풀 타임아웃·세션 30·50MB) → B 로 올라가고 내장 HSQL 로 여전히 기동(56초), 코퍼스 4.3.2 점검표.

## 5. 규칙 갱신 절차

템플릿이 바뀌거나(upstream 반영) 기관 기준이 생기면 `catalog/operations-rules.json` 의 규칙·`basis`·`surveyedAt` 을 고치고 `test/operations-live.mjs` 의 기대값을 다시 잽니다. 새 규칙은 미달·통과 픽스처 쌍을 `test/operations.mjs` 에 더합니다. 규칙 id 는 공개 API(평가서·CI 의 `--fail-on` 이 참조)라 바꾸면 MINOR, 지우면 MAJOR 입니다.
