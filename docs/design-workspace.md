# 멀티 모듈·MSA 작업공간 설계 (v0.47)

## 1. 문제

공식 MSA 템플릿 3종은 한 저장소에 빌드 단위가 여럿입니다. 지금까지의 도구는 루트 빌드 파일 하나를 기준으로 만들어져 있어서, 이 템플릿들에서는 결과가 대부분 비어 있었습니다(2026-10-16 실측).

| 템플릿 | 구조 | v0.46 의 결과 |
|---|---|---|
| `msa-common-components` | Maven 루트 pom + `<modules>` 11개, 모듈 parent `egovframe-boot-starter-parent` 5.0.1, 자체 Dockerfile 없음 | 의존성 373건 중 "버전 없음" 152(루트에 parent 가 없어 모듈 parent 를 보지 못함), 배포 산출물은 "멀티 모듈 — 범위 밖"으로 거부 |
| `msa-edu` | 루트 빌드 파일 없음, `backend/*` Gradle 독립 프로젝트 10개(서비스 9 + 공통 라이브러리), 서비스마다 Dockerfile | 의존성 0건(빌드 도구 미검출), 5.x 최신 유지 미검출 |
| `msa-portal-backend` | 같은 구조 9개 | 같음 |

## 2. 작업공간 탐지 (`src/workspace.ts`)

| 종류 | 근거 | 모듈 |
|---|---|---|
| `maven-modules` | 루트 pom 이 `packaging=pom` + `<modules>` | `<modules>` 를 재귀로 펼친 실행 단위 |
| `gradle-include` | `settings.gradle(.kts)` 의 `include` | include 된 디렉터리 |
| `independent` | 루트에 빌드 파일이 없고 깊이 2까지 하위 디렉터리에 `pom.xml`·`build.gradle` | 그 디렉터리 각각 |
| `single` | 루트 빌드 파일 하나 | 루트 하나(지금까지와 같음) |

- **모듈 정보**: 빌드 도구, packaging, Boot 여부, 웹 여부, 자체 Dockerfile 을 담습니다. 웹 여부에는 Spring Cloud 서버(config-server·eureka-server·gateway)도 포함합니다.
- **라이브러리 판정**: 실행 jar 로 다시 묶지 않는 모듈은 라이브러리로 봅니다. Maven 은 `<plugins>` 에 `spring-boot-maven-plugin` 이 없으면, Gradle 은 Boot 플러그인이 없거나 `bootJar { enabled = false }` 이면 라이브러리입니다.
- **parent 상속(`inheritsFrom`)**: Maven 모듈의 parent 가 작업공간 안의 pom(집계·공통 parent)이면 표시합니다. 이런 모듈은 단독 빌드가 안 되므로, 배포 산출물은 루트 컨텍스트에서 `mvn -pl <모듈> -am` 으로 빌드합니다.
- **YAML 읽기**: 평탄화(`flattenYaml`)는 맵과 스칼라만 다루고 리스트는 건너뜁니다. 런타임 의존성을 늘리지 않으려고 직접 구현했습니다.

## 3. 도구별 동작

### 3.1 의존성 점검 (`check_egovframe_dependencies`)

- **모듈 parent**: Maven 모듈 pom 은 자기 parent 로 판정합니다. 공식 parent 를 쓰는 모듈의 버전 없는 좌표는 "parent 관리"가 됩니다. 루트에 공식 parent 가 없으면 가장 낮은 모듈 parent 를 대표 parent 로 보고합니다(평가서 platform 요인).
- **Gradle 버전 변수**: `ext { set('x', 'v') }`·`x = 'v'`·`def x = 'v'`·`gradle.properties` 로 `${x}`·`$x` 를 풉니다.
- **Gradle BOM**: Boot 플러그인과 dependency-management 가 있거나 공식 parent 를 `mavenBom` 으로 가져오면, 버전 없는 좌표는 BOM 관리로 봅니다. 그 `mavenBom` 의 버전이 parent 버전입니다. BOM import 줄 자체는 의존성으로 세지 않습니다.
- **결과**: 항목마다 `module` 을 붙이고 `workspace.modules` 에 모듈별 요약을 냅니다. `resolve=true` 이면 독립 프로젝트마다 트리를 해석해 합칩니다.

### 3.2 5.x 최신 유지 (`migrate_egovframe_project(target="5.0.x")`)

- **Maven 모듈 parent**: 모듈 pom 의 parent 는 이미 auto 항목이었습니다. 이번에 모듈 요약(`update.modules`)과 대표 parent 를 더했습니다.
- **Gradle 버전 변수**: 공식 parent BOM·RTE 좌표에 쓰이는 변수(`egovframeBootParentVersion`)를 parent 버전으로 봅니다.
  - 그 변수가 **공식 parent·RTE 에만** 쓰이면 정의를 바꾸는 auto 항목입니다.
  - **다른 좌표에도** 쓰이면 manual 항목입니다. 공식 msa-edu 는 같은 변수를 직접 배포한 `egovframe-cloud-module-common` 의 버전에도 씁니다. 이 좌표의 5.0.2 는 표준프레임워크 저장소에 없으므로(실측: 5.0.0 만 있음) 그대로 올리면 빌드가 깨집니다.
  - 실측: msa-edu 자동 4·수동 6, msa-portal-backend 자동 3·수동 6.
- **중복 의존성 선언(`duplicate-dependency`)**: 공식 `msa-common-components` 의 `EgovQuestionnaire` pom 은 CVE 보완용 `commons-configuration2`·`commons-lang3` 를 같은 `<dependencies>` 에 두 번 선언합니다. 로컬 Maven 3.9.11 은 경고만 내지만 GitHub Actions ubuntu-latest 의 Maven 은 "must be unique" 오류로 그 모듈을 읽지 않습니다.
  - 내용이 같으면 뒤 선언 블록을 지우는 auto, 버전·scope·exclusions 가 다르면 manual 입니다. 주석은 그대로 둡니다.
  - dependencyManagement·plugin 의존성·profile 은 보지 않습니다. classifier·type 이 다르면 다른 좌표입니다.
  - 실측: msa-common-components 자동 13(모듈 parent 11·중복 2).

### 3.3 배포 산출물 (`generate_egovframe_deploy`)

- **이미지**: 서비스 모듈마다 이미지를 만듭니다. 자체 Dockerfile 이 있으면 그대로 쓰고(msa-edu 9개), 없으면 모듈에 `Dockerfile`·`.dockerignore` 를 만듭니다(msa-common-components 11개). 라이브러리 모듈은 빼고 이유를 남깁니다.
- **localhost 참조**: 컨테이너에서는 `localhost` 가 자기 자신이라 서비스 사이 연결이 깨집니다. 설정의 `localhost:포트`·`127.0.0.1:포트` 와 `*.host: localhost`(+ 같은 단계의 `port`)를 포트로 대상을 찾아 바꿉니다.

  | 포트 | 대상 |
  |---|---|
  | 서비스 모듈의 `server.port`(0 이 아닌 값) | 그 서비스(compose 서비스 이름 = Kubernetes Service 이름) |
  | DB 기본 포트(3306·5432) | `db` |
  | 5672·6379 | `rabbitmq`·`redis`(규칙 `catalog/deploy-rules.json` 의 `infra`) |
  | 그 밖 | 바꾸지 않고 "대상을 모르는 참조"로 보고(검색 엔진 9200 등) |

  - **모듈 자신의 설정**(`application.yml`·`bootstrap.yml`·`.properties`)은 Spring 환경 변수로 덮어씁니다. 이름은 완화 바인딩 규칙을 따릅니다(점 → `_`, 대시 제거, 대문자: `search-locations` → `SEARCHLOCATIONS`).
  - **설정 서버가 내주는 파일**은 원격 속성이라 환경 변수보다 우선하므로 환경 변수로 덮을 수 없습니다. 설정 서버의 native 저장소(`classpath:/config`·`file:./config`)를 `deploy/config-repo/` 사본으로 만들어 바꾸고, 설정 서버에 `SPRING_CLOUD_CONFIG_SERVER_NATIVE_SEARCHLOCATIONS=file:/config-repo/` 와 읽기 전용 볼륨(Kubernetes 는 ConfigMap)으로 붙입니다.
  - **자기 자신을 가리키는 참조**(문서·브라우저용 URL)는 바꾸지 않습니다.
  - compose 에서 설정의 Spring 자리표시자(`${datasource.url:…}`)는 `$$` 로 막습니다. 그래야 compose 가 자기 변수로 치환하지 않습니다.
- **기동 순서**: 참조한 서비스·인프라를 `depends_on: condition: service_healthy` 로 겁니다. 자체 Dockerfile 서비스는 compose 에 healthcheck(actuator)를 붙입니다.
- **포트**:
  - `server.port=0`(임의 포트) 서비스는 `SERVER_PORT=8080` 으로 고정합니다. 헬스체크와 디스커버리 등록이 같은 포트를 보게 하기 위해서입니다.
  - 호스트 포트는 설정에 고정 포트가 있는 서비스만 발행합니다.
- **인프라**
  - DB 컨테이너의 계정·DB 이름·비밀번호 기본값은 설정에 적힌 값과 같게 둡니다. 앱은 설정 서버가 내주는 값을 그대로 쓰기 때문입니다.
  - 템플릿의 `docker-compose/<db>/init` SQL 디렉터리를 초기화로 붙입니다.
  - RabbitMQ 의 `guest` 는 원격 접속이 막혀 있어 `egov` 계정을 만들고, 앱의 `spring.rabbitmq.username·password` 를 환경 변수로 덮습니다.
- **Kubernetes**: 서비스마다 `deploy/k8s/<서비스>.yaml` 을 만듭니다. 서비스 참조는 Service DNS, 인프라는 `CHANGE_ME_<이름>_HOST`, 비밀은 Secret 으로 둡니다. 설정 저장소 ConfigMap 도 함께 만듭니다.
- **`modules`**: 일부 서비스만 고릅니다. 고른 서비스가 먼저 띄워야 하는 서비스·인프라는 함께 들어갑니다.

### 3.4 SBOM·보안약점·평가서

- **SBOM**: 루트 빌드 파일이 없는 독립 프로젝트 묶음은 프로젝트마다 SBOM 을 만들고 합칩니다. 주 component 는 작업공간이고, 모듈 주 component 는 component 로 넣으며, 의존관계는 합집합입니다. 모듈별 문서는 `sbom/modules/<모듈>.cdx.json` 에 남깁니다. Maven 멀티 모듈은 플러그인의 `makeAggregateBom` 이 이미 합본을 만듭니다.
- **보안약점**: `byModule`(모듈별 높음·중간·낮음)을 더했습니다.
- **평가서**: 1절에 모듈 표(의존성·기준 미만·전환·교체·최신 유지 자동/수동·보안약점)를 더했습니다. 등급 산식은 전체 합산 그대로입니다.

## 4. 검증

- **게이트(`test:workspace`, 55단언)**
  - 세 종류 탐지와 라이브러리·parent 상속 판정
  - YAML 평탄화, 참조 치환·환경 변수 이름, Gradle 변수
  - 모듈 parent 관리·대표 parent·Gradle BOM parent
  - Gradle 변수 auto/manual 과 적용
  - 다중 서비스 계획
    - 환경 변수·브로커 계정·기동 순서·모르는 포트
    - 설정 저장소 사본·DB 계정
    - 루트 컨텍스트 `-pl`
  - compose 공식 스키마와 `$$`, k8s 키 중복 없음·자리표시자
  - `modules` 와 의존 서비스 포함, 새 파일만
  - SBOM 합본, 보안약점·평가서 모듈 표
- **CI 통합(`test:workspace-live`)**
  - 공식 MSA 템플릿 3종에서 아래를 확인합니다.
    - 모듈 수·라이브러리 수
    - 모듈별 의존성(버전 없음 0)·5.x 최신 유지·보안약점·평가서 모듈 표
    - 생성 compose(공식 스키마·`docker compose config`)·kubeconform·hadolint
  - `msa-common-components` 를 실제로 띄웁니다.
    1. 5.0.2 로 갱신하고 루트 `mvn package` 를 실행합니다.
    2. ConfigServer·EurekaServer·GatewayServer·EgovBoard 와 MySQL·RabbitMQ 를 compose 로 띄웁니다.
    3. 6개 컨테이너 healthy, Eureka 에 GATEWAYSERVER·EGOVBOARD UP, Gateway health UP 을 확인합니다(개발 환경 실측 78초).
  - 저장소(브랜치 기준) 템플릿이라 건수는 로그로만 남기고 구조만 단언합니다.

## 5. 범위 밖

- 프론트엔드(React) 이미지, 서비스 메시·Helm 차트
- 템플릿에 이미 있는 k8s 매니페스트(`msa-edu/k8s`) 수정
- 설정 서버 Git 백엔드(native 만 사본으로 대응)
- 검색 엔진 등 규칙에 없는 인프라 컨테이너
