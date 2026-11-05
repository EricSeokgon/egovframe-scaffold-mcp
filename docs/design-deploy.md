# 컨테이너·배포 산출물 설계 (`generate_egovframe_deploy`, v0.45)

## 1. 문제

공공 정보시스템의 클라우드 네이티브 전환으로, 표준프레임워크 프로젝트도 컨테이너 이미지와 쿠버네티스 매니페스트를 함께 납품하는 일이 늘었습니다. 그런데 사업마다 Dockerfile 을 손으로 쓰고, 다음이 매번 달라집니다.

- 실행 단위: Classic(war)·Boot(jar)
- DB 종류와 초기화 스크립트
- DB 설정을 넣는 방법: `globals.properties` 냐 `application.properties` 냐

이 도구는 진단 결과로 같은 기준의 산출물을 만듭니다.

## 2. 분석 (`analyzeDeploy`)

| 항목 | 근거 |
|---|---|
| 빌드 도구·래퍼 | `pom.xml` / `build.gradle(.kts)`, `mvnw`·`gradlew` |
| 패키징 | Maven `<packaging>war</packaging>`, Gradle `war` 플러그인 |
| Boot 여부 | parent `spring-boot-starter-parent`·`egovframe-boot-starter-parent`, `spring-boot-maven-plugin`, Gradle `org.springframework.boot` |
| 웹 여부 | war 이거나 `spring-boot-starter-web`·`webflux`·`thymeleaf`(아니면 배치) |
| Tomcat 버전 | 기본 10.1(Servlet 6.0). pom 이 `jakarta.servlet-api` 6.1 이상을 직접 선언하면 11.0 |
| 포트·컨텍스트 경로 | Boot `server.port`·`server.servlet.context-path` |
| 헬스 경로 | actuator 와 `management.endpoint.health.probes.enabled=true` 가 있으면 `/actuator/health/liveness`·`readiness`, actuator 만 있으면 `/actuator/health`, 그 밖에는 `/` |
| DB | `Globals.DbType` 과 `Globals.<type>.Url`(Boot 템플릿) 또는 `Globals.Url`(Classic 템플릿), 그 밖에는 `spring.datasource.url` |
| 초기화 SQL | 파일 이름에 DB 종류와 `ddl`·`data` 가 들어간 `.sql`(얕은 경로 우선) |

다음 구조는 지원하지 않으며, 파일을 만들지 않고 이유를 돌려줍니다.

- 멀티 모듈: 모듈별 이미지가 필요하고, MSA 템플릿은 저장소에 자체 구성이 있습니다.
- 라이브러리 jar
- 빌드 파일이 없는 프론트엔드

## 3. Dockerfile

- **빌드 단계**(기본, 이미지 안에서 빌드)
  - `maven:3.9-eclipse-temurin-<JDK>` 에서 `mvn -B -q -DskipTests package` 를 실행합니다.
  - `RUN --mount=type=cache,target=/root/.m2` 로 로컬 저장소를 캐시하고, Maven 5xx 재시도 옵션을 붙입니다. `maven.egovframe.go.kr` 의 일시 502 대응입니다(v0.42 CI 실측).
  - Gradle 은 래퍼(`./gradlew`)가 있으면 JDK 이미지, 없으면 `gradle:8-jdk<JDK>` 를 씁니다.
  - 산출물은 `find … ! -name '*-plain.*'` 로 고릅니다(Gradle Boot 의 plain jar 제외).
- **미리 빌드**(`buildInImage=false`)
  - 컨테이너 안에서 Maven 저장소에 닿지 않는 폐쇄망용입니다.
  - 호스트에서 만든 `target/*.war`·`jar` 만 보내도록 `.dockerignore` 를 산출물 화이트리스트로 만듭니다.
- **Classic 실행**
  - `tomcat:10.1-jdk<JDK>-temurin` 을 씁니다.
  - WAR 를 **빌드 단계에서 풀어** `webapps/ROOT` 로 복사합니다. 실행 중 설정 파일(`WEB-INF/classes/…/globals.properties`)을 볼륨·Secret 으로 덮어쓸 수 있게 하려는 것입니다. 풀린 디렉터리가 있으면 Tomcat 은 WAR 를 다시 풀지 않습니다.
- **Boot 실행**: `eclipse-temurin:<JDK>-jre` 에서 `ENTRYPOINT ["sh","-c","exec java $JAVA_OPTS -jar /app/app.jar"]` 로 실행합니다(시그널 전달).
- **공통**
  - 비루트 사용자 uid 10001.
  - `TZ=Asia/Seoul`, `LANG=C.UTF-8`, `-Dfile.encoding=UTF-8 -XX:MaxRAMPercentage=75`.
  - `HEALTHCHECK curl -fsS`(웹만). 실측으로 두 기반 이미지 모두에 curl 이 있습니다.
- **기반 이미지 레지스트리**: `ARG BASE_REGISTRY=<imageRegistry>` 로 바꿉니다(폐쇄망 사내 레지스트리·프록시 캐시).
- **`# syntax` 지시어 없음**: 폐쇄망에서 `docker/dockerfile` 이미지를 받지 않도록 쓰지 않습니다. BuildKit(Docker 23 이상 기본)의 내장 프론트엔드로 `RUN --mount` 를 씁니다.
- **경로**: 템플릿에 Dockerfile 이 이미 있으면(공식 simple-backend 등) `dockerfilePath`(예: `deploy/Dockerfile`)로 겹치지 않게 만듭니다. 이때 `.dockerignore` 는 BuildKit 규칙대로 `<경로>.dockerignore` 입니다.

## 4. DB 설정 주입

| 실행 | 방법 | 근거 |
|---|---|---|
| Boot | Spring Environment 의 시스템 환경 변수 매핑: `Globals.mysql.Url` → `GLOBALS_MYSQL_URL`, `spring.datasource.url` → `SPRING_DATASOURCE_URL` | 공식 simple-backend 의 데이터소스는 `env.getProperty("Globals.%s.Url")` 로 읽음 |
| Classic | `globals.properties` 사본(DB 호스트·비밀번호만 바꿈)을 compose 는 읽기 전용 볼륨, Kubernetes 는 Secret 의 `subPath` 로 `WEB-INF/classes/…` 위에 마운트 | Classic 템플릿은 `EgovProperties` 가 파일을 직접 읽어 환경 변수로 덮을 수 없음 |

- 비밀번호 기본값은 `CHANGE_ME` 입니다. compose 는 `.env` 의 `DB_PASSWORD`, Kubernetes 는 Secret 으로 넣습니다. 보안약점 점검의 자리표시자 예외와 맞물려 지적되지 않습니다.
- v1.13: 설정 파일에 `${EGOV_…_PASSWORD}`·`${EGOV_CRYPTO_CONFIG}` 같은 비밀 자리표시자가 있으면(`externalize_egovframe_config` 가 만든 것, `DeployProfile.secretEnv`) compose 의 app `environment`(`"${이름:-CHANGE_ME}"`)·`.env.example`·Kubernetes `Secret` 에 같은 이름의 자리를 만듭니다(ConfigMap 에는 넣지 않음). `EGOV_CRYPTO_CONFIG` 의 예시 값은 `file:/run/egov/egov-crypto-config.properties` 입니다. 반대로 외부화 도구는 이미 있는 `deploy/` 산출물에 변수를 덧붙입니다 — 어느 쪽을 먼저 돌려도 같은 결과.
- Kubernetes 의 DB 호스트는 `CHANGE_ME_DB_HOST` 입니다. 운영 DB 는 클러스터 밖(기관 DB)이 일반적이라 DB 를 클러스터에 띄우지 않습니다.

## 5. docker-compose

- **DB 컨테이너**: mysql 8.4·mariadb 11.4·postgres 16 을 같은 레지스트리 변수로 받습니다.
- **초기화**: 템플릿의 DDL·DATA 를 `docker-entrypoint-initdb.d/01-…`·`02-…` 로 마운트합니다.
- **MySQL·MariaDB 옵션**: `--lower-case-table-names=1`(표준프레임워크 SQL 은 대문자 테이블명)과 utf8mb4 를 줍니다.
- **기동 순서**: DB 헬스체크가 통과한 뒤 앱을 띄웁니다(`depends_on: condition: service_healthy`).
- **외부 DB**: 오라클·티베로·알티베이스·큐브리드 등은 DB 컨테이너 없이 앱만 띄우고 연결 정보를 그대로 씁니다.

## 6. Kubernetes

- **리소스**: ConfigMap(TZ·JAVA_OPTS·비밀이 아닌 DB 설정), Secret(비밀번호 또는 Classic 설정 파일), Deployment, Service(ClusterIP 80 → http), 선택 Ingress.
- **프로브**: startup(실패 30회까지 기다림)·readiness·liveness 가 같은 헬스 경로를 봅니다.
- **보안 설정**: `runAsNonRoot`·`runAsUser 10001`·`fsGroup`·`seccompProfile RuntimeDefault`·`allowPrivilegeEscalation false`·`capabilities drop ALL`.
- **리소스 요청·제한**: 250m/768Mi, 1/1536Mi.
- **배치**: 웹이 아닌 Boot 앱은 포트·프로브·Service 없이 만들고, 커맨드라인 배치는 Job·CronJob 으로 바꾸라고 안내합니다.

## 6-1. 관측 내보내기 (v1.16, `observability="otel"`)

| 항목 | 결정 | 이유 |
|---|---|---|
| 범위 | 앱이 OTLP 로 **내보내기까지** — 에이전트·수집기·환경 변수. 저장·조회(Grafana·Loki·Tempo)는 동봉하지 않음 | upstream 운영환경 가이드(`egovframe-operating-environment-msa`, 별 3)가 쓰는 저장 스택이 AGPL-3.0 이고 가이드 자체가 소스 공개 의무를 경고한다. 공공기관은 대개 기존 APM·로그 수집 체계가 있다 |
| 에이전트 | OpenTelemetry Java 에이전트 고정 버전(`catalog/deploy-rules.json` `observability.agent` — 버전·sha256·바이트·Maven Central URL). Dockerfile 의 `otel` 단계가 빌드 컨텍스트 `deploy/otel/opentelemetry-javaagent.jar` 를 먼저 쓰고, 없으면 `OTEL_AGENT_URL`(build-arg, compose `.env`)에서 받고, **어느 쪽이든 sha256 확인** 후 런타임 이미지의 `/opt/otel/` 에 복사 | 폐쇄망은 오프라인 번들(`include=["otel"]`)의 jar 를 두기만 하면 된다. 파이프 없는 `sha256sum -c` 로 hadolint DL4006 회피. `ADD --checksum` 은 Dockerfile 1.6 문법이 필요해 `# syntax` 지시어 없이(폐쇄망) 쓸 수 없다 |
| 켜는 방법 | 이미지에는 에이전트만 두고 `JAVA_TOOL_OPTIONS=-javaagent:…` 를 compose·k8s 가 준다 | 같은 이미지를 관측 없이도 쓴다(끄기 = 환경 변수 삭제). `JAVA_TOOL_OPTIONS` 는 Boot(`java -jar`)·Tomcat(`catalina.sh`) 양쪽 JVM 이 읽는다 |
| 환경 변수 | `OTEL_SERVICE_NAME`(=appName)·`OTEL_RESOURCE_ATTRIBUTES`(deployment.environment.name·service.version)·`OTEL_EXPORTER_OTLP_ENDPOINT`(http://otel-collector:4318)·`OTEL_EXPORTER_OTLP_PROTOCOL`(http/protobuf)·`OTEL_METRIC_EXPORT_INTERVAL`. k8s 는 앱 ConfigMap(비밀 아님) | 에이전트 2.x 기본값으로 trace·metric·log 를 모두 OTLP 로 보낸다(코드 수정 없음) |
| 수집기 | `otel/opentelemetry-collector`(core 배포판, Apache-2.0) 고정 버전 — otlp 수신(4317·4318), `memory_limiter`·`batch`, 기본 `debug` 내보내기, 기관 백엔드(`otlp_http/backend`·`prometheus`)는 주석 예시. compose 는 `deploy/otel/collector.yaml` 볼륨, k8s 는 ConfigMap + Deployment(비루트·읽기 전용 루트) + Service | contrib 배포판은 크고 구성 요소가 많다. 0.163 의 exporter 이름(`otlp_http`)으로 예시를 쓴다 |
| 기본값 | `observability="none"` — v1.15 와 바이트 동일한 산출물 | 기존 사용자의 산출물이 바뀌지 않게 |
| 다중 서비스 | 이번 버전은 단일 프로젝트만(안내 출력) | 서비스마다 같은 수집기를 공유하는 배치는 다음에 |

검증: 게이트 `test:observability`(33단언 — 산출물 구조·none 바이트 동일·Classic·미리 빌드·다중 서비스 안내·번들 항목·지문 불일치 거부·MCP), CI 통합 `test:observability-live`(공식 boot-web·web 을 compose 로 띄워 HTTP 1건 뒤 수집기에 span 120여·metric 30여·log 수십 도착, 같은 이미지를 `JAVA_TOOL_OPTIONS` 없이 띄우면 에이전트가 붙지 않음, 기동 시간 2배 이내 — 실측 boot-web 5.0s/4.5s·web 5.4s/4.2s, web 은 `deploy/otel/` jar 폐쇄망 경로·다운로드 주소는 닿지 않는 곳, hadolint·kubeconform 통과).

## 7. 검증

- **게이트** (`test:deploy`)
  - 분석: Classic·Boot(maria·context-path·actuator)·Gradle 배치·spring.datasource(PostgreSQL)·Oracle(Tomcat 11)·HSQL·지원 안 함 3종
  - 생성 파일 구조와 생성 `docker-compose.yml` 의 공식 Compose 스키마(compose-spec, draft 2020-12 고정물) 검증
  - Kubernetes 보안 설정·프로브·Secret 마운트
  - 입력 검증, 새 파일만(일부라도 있으면 아무것도 쓰지 않음)
- **CI 통합** (`test:deploy-live`)
  - 공식 web(Classic)·boot-web(Boot) 템플릿: hadolint 2.14 경고 0, kubeconform 0.7(쿠버네티스 1.31) 통과
  - 실제 `docker build`(이미지 안에서 Maven 빌드) → 기동 → HTTP 200 → HEALTHCHECK healthy → 실행 uid 10001
  - 공식 simple-backend: `docker compose up --build` → actuator readiness UP → `/mainPage` 가 MySQL 초기화 데이터를 돌려줌(환경 변수로 DB 연결)
  - 컨테이너 안에서 Maven 저장소에 닿지 않는 환경은 `DEPLOY_LIVE_PREBUILT=1` 로 미리 빌드 경로를 검증합니다.

## 8. 범위 밖

Helm 차트·Kustomize 오버레이, 레지스트리 push·클러스터 배포 실행, 운영 DB 이관, 멀티 모듈. 관측(v1.16)의 저장·대시보드(AGPL 스택)·Istio·수동 계측(span)·알림 규칙.
