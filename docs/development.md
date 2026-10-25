# 개발·검증·릴리스 (기여자용)

이 문서는 저장소를 고치거나 릴리스하는 사람을 위한 것입니다. 사용법은 [README](../README.md)를 보세요.

## 로컬 개발

```bash
npm install
npm run build            # dist/
npm run prepublishOnly   # 빌드 + 게이트 테스트 전부(릴리스 전 필수, Node 22 이상)
```

빌드 없이 소스로 MCP 서버를 띄우려면 클라이언트 설정에 `npx -y tsx /절대경로/src/index.ts` 를, 빌드한 것을 쓰려면 `node /절대경로/dist/index.js` 를 적습니다.

## 가이드 제목 카탈로그 갱신

`node scripts/generate-catalog.mjs --docs <egovframe-docs 경로>`는 가이드의 `title:` 앞 공백·탭 들여쓰기를 허용하며, 제목이 없으면 파일 이름을 사용합니다. 문서 검색은 동봉된 정적 카탈로그의 제목을 사용하므로 문서 원본만 수정해도 검색 제목이 즉시 바뀌지는 않습니다. 재생성 시 고정 소스 아카이브를 사용하고(`--zip`, 필요 시 `--archive-sha256`·`--archive-bytes`; 스크립트 머리말 참고), 제목 갱신과 무관한 문서 매핑·출처 지문 변경은 따로 검토하세요.

## 검증 체계

- 함수 레벨: 실제 템플릿(약 296파일) 생성, pom 좌표·DbType 적용, 중복 생성 거부, `dryRun` 미리보기(무기록) 확인 (`npm run smoke`)
- Maven 좌표 레벨: 프로젝트 직접 groupId/artifactId/name만 변경하고 parent·dependency artifactId 보존 (`npm run test:pom`, 네트워크 불필요)
- 카탈로그 레벨: schema v2, 고정 source/archive 지문, 자산 메타데이터, 무결성·위상 정렬·미리보기 검증 (`npm run test:catalog`, `npm run test:catalog-sync`, 네트워크 불필요)
- zip 조달 레벨: 자리표시자 치환·globals 경로 판별·12종 정의 유효성(`npm run test:pom`, 네트워크 불필요), `batch-file-commandline` 실생성으로 지문 검증·좌표·DbType·zip 루트 보존, 지문 불일치 거부와 무기록, `ref` 지정 시 검증 생략 표시(`npm run test:templates`, 네트워크 필요, CI 실행)
- 설정 생성 레벨: 동봉 템플릿 지문·카탈로그 무결성, 49건 전 형식 기본값 렌더링, 분기·필드 덮어쓰기, 필드·선택지·파일명·패키지 거부, dryRun 무기록, 충돌 거부, 비밀번호 가림, `..`·절대경로·symlink 이탈 거부, CRLF 체크아웃 시뮬레이션 (`npm run test:config`, 506단언, 네트워크 불필요)
- 템플릿 카탈로그 레벨: `catalog/templates.json` 스키마·커버리지 계산·큐레이션 매핑 정합·변환기·upstream 차이 계산(추가/삭제/필드 변경) 검증 (`npm run test:template-catalog`, 256단언, zip 지문·동봉 설정 템플릿 drift·LFS 포인터 해석 포함, 네트워크 불필요)
- 동기화 레벨: 공식 v5.0.7 태그→commit, SHA-256·크기·파일 수, `sec.security`, 미매핑 경로 0건 검증 (`npm run test:catalog-sync-live`, 네트워크 필요)
- 조립 레벨: 실제 공통컴포넌트 저장소로 bbs+login+sec.security(+cmm) 843파일 조립, message·IDGN·웹 자산·공용 fragment·Maven 좌표·선별 DB 스크립트·충돌 전체 거부·파일/SQL/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:components`)
- 수명주기 레벨: 설치 매니페스트 기록, 중복 설치 거부, 의존 컴포넌트 제거 보호, 제거·검증 동작 (`npm run test:components`)
- 프로토콜 레벨: 빌드된 서버를 실제 프로세스로 띄워 MCP initialize / tools/list 핸드셰이크, `serverInfo.version`↔`package.json` 일치, 핵심 도구 노출, `jdk` 패턴 제약 노출 확인 (`npm run test:handshake`, 네트워크 불필요)
- 릴리스 레벨: 배포 판정(버전·`server.json`·변경 이력·태그·npm 네 조건)과 릴리스 노트 추출, `npm pack --dry-run` 의 tarball 내용(포함·제외·크기 상한), `server.json` 설명 100자 제한 (`npm run test:release`·`npm run test:registry`, 네트워크 불필요); CI 통합이 `mcp-publisher validate` 로 레지스트리 스키마를 실제 검증
- 플랫폼 레벨: CI가 릴리스 게이트를 ubuntu·windows × Node 22·24 매트릭스로(v1.0, 이전 18·20·22) 실행하고, 공식 저장소를 내려받는 통합 테스트는 ubuntu/Node 22에서 실행합니다. 타임아웃 시 프로세스 트리 종료는 POSIX·Windows 모두 실제 프로세스로 검증합니다 (`npm run test:build`).
- 레시피 레벨: `catalog/recipes.json`의 컴포넌트 id·의존성·템플릿 제공 컴포넌트 정합 검증 (`npm run test:recipes`, 네트워크 불필요). 공식 `simple-backend`의 기존 `cmm`을 보존하고 board-login의 bbs 88파일·login 41파일·SQL 4건(총 133파일)을 조립한 뒤 검증하며, 컴포넌트 이후 fault injection의 전체 staging rollback도 확인 (`npm run test:recipe-transaction`)
- 진단 레벨: 픽스처(pom·DbType·컴포넌트 패키지)로 `diagnose_egovframe_project`의 빌드·버전·DbType·컴포넌트 지문·의존성 검출 검증 (`npm run test:diagnose`, 네트워크 불필요)
- 전환 진단 레벨: 3.10 스타일 픽스처(pom·gradle·java·Spring XML·MyBatis XML·web.xml·JSP)에서 항목 종류·auto/manual·라인·대응 좌표를 단언하고, 5.x 스타일 픽스처에서 항목 0건과 진단 전후 디스크 불변을 확인 (`npm run test:migrate`, 87단언, 네트워크 불필요). 규칙 카탈로그는 스키마·좌표 규칙성·제거 클래스의 대체가 동봉된 5.x 소스 트리에 존재하는지·JDK 내장 `javax.*` 제외·큐레이션과 생성물 일치를 검증 (`npm run test:migration-rules`, 579단언, 네트워크 불필요). 목적지 좌표(RTE 5.x 24종·3.x 원본 18종·parent 2종·Jakarta 좌표)가 표준프레임워크 Maven 저장소와 Maven Central 에 실제로 존재하는지는 CI 통합 job 에서 확인 (`npm run test:migration-rules-live`, 61건, 네트워크 필요)
- 전환 검증 레벨: 공통컴포넌트 대응표 판정(제거·이동·사용자 클래스 무시), 재조립 권고와 `skipComponents`, `linkBuildError` 8케이스(심볼·패키지 부재·라인 근접·규칙 심볼·javax 부재·무관), javac `symbol:`/`location:` 파싱(maven·gradle), 가짜 runner 로 verify 결과·작업 목록·Markdown·빌드 파일 없음 (`npm run test:migrate` 에 포함, 총 162단언). 실제 `mvn compile` 오류 3건이 수동 항목 2건에 전부 연결되는지는 CI 통합 job (`npm run test:migrate-integration`)
- 전환 적용 레벨: 3.10 픽스처에 대해 auto 항목의 편집 원문 일치, dryRun 무기록, fault-injection 롤백(내용·mtime 불변), 적용 후 pom·java·XML·web.xml·gradle·JSP 내용, 백업·`migration-plan.json`, 재적용 무기록, manual 항목 불변을 단언 (`npm run test:migrate`, 132단언, 네트워크 불필요). 3.10 좌표·javax 픽스처를 적용한 뒤 JDK 17 로 `mvn compile` 통과는 CI 통합 job 에서 확인 (`npm run test:migrate-integration`, 네트워크·JDK·Maven 필요)
- 의존성 점검 레벨: 기준 카탈로그 스키마·출처 sha256·RTE 5.x 모듈·BOM 계열, 분류 함수 12케이스, 3.10·5.x parent·gradle·빈 디렉터리 픽스처, OSV 모의 질의·매핑·실패 처리, 디스크 불변 (`npm run test:dependencies`, 68단언, 네트워크 불필요). 실제 OSV 조회는 CI 통합 job (`npm run test:dependencies-live`)
- 네트워크 진단 레벨: 오류 분류 8종, 프로브·DNS 주입으로 7가지 시나리오(전부 도달, 405/404/407/503, 프록시+타임아웃, 프록시 없음+IPv6 혼재, TLS, DNS, 필터)의 처방·안내·자격 증명 가림·셸별 명령을 단언하고, `fetchWithTimeout` 실패 메시지에 처방이 붙는지 확인 (`npm run test:network`, 33단언, 네트워크 불필요). 실제 호스트 7종 프로브는 CI 통합 job (`npm run test:network-live`) — 진단 자체의 이상과 러너 네트워크 붕괴(5개 미만 도달)는 실패, 30초 뒤 재확인에도 남는 상대 서버 쪽 장애(timeout·5xx·reset)는 경고(v1.0.2)
- AGENTS.md 레벨: 5.x(매니페스트·래퍼·컴포넌트 2종·백업 디렉터리)와 3.x gradle 픽스처, 빈 디렉터리에서 사실 수집·ko/en 렌더링·dryRun 무기록·기존 파일 거부·overwrite·파일명 검증·staging 정리 (`npm run test:agents-md`, 22단언, 네트워크 불필요)
- 레지스트리 메타데이터 레벨: `server.json` ↔ `package.json` 의 이름(`mcpName`)·버전·npm 좌표·스키마 URL·환경변수 문서화 정합 (`npm run test:registry`, 네트워크 불필요)
- 프로토콜 레벨(추가): `EGOVFRAME_LANG=en` 으로 띄운 서버의 도구 34종 설명이 모두 영문이고 표에 빠진 도구가 없는지, `tools/list` 에 `title`·annotations(readOnly 13종·destructive 5종)·`outputSchema` 13종이 노출되는지 확인 (`npm run test:handshake`)
- SBOM·해석 레벨: Maven·Gradle 트리 파서(실제 출력 픽스처), `resolve=true` 의 전이 항목·경로·선언/해석 차이·실패 경로, CycloneDX 문서 구성·보강·취약점 병합·출력 경로 거부·overwrite·dryRun (`npm run test:dependencies`, `npm run test:sbom`, 네트워크 불필요); CI 통합이 공식 `egovframe-web` 템플릿을 실제 Maven 으로 해석하고 SBOM 을 생성 (`npm run test:sbom-live`)
- 오프라인 번들 레벨: Maven 버전 비교(숫자·한정자 순서·같은 표기), OSV 범위(여러 구간·fixed·last_affected), 덤프 색인(Maven 만·철회 제외·GIT 범위 무시)과 querybatch 같은 모양의 결과, 번들 만들기(dryRun·manifest 지문·고정 지문 불일치 거부·실패 시 무흔적·덮어쓰기 거부·로컬 git 원본 미러), 번들 읽기(fetch 훅·POST 제외·변조 거부·깨진 manifest), 원본 미러(태그·커밋·트리·blob, 없는 태그 안내), OSV 출처 노트와 30일 경고, 의존성 점검 연동, 네트워크 진단 처방 (`npm run test:offline-bundle`, 30단언, 네트워크 불필요); CI 통합이 실제 번들을 만들고 로컬 OSV 와 온라인 OSV 를 대조(97% 이상 일치 요구, 실측 100%)한 뒤 fetch 를 막고 생성·조립·재조립 미리보기·SBOM 재점검을 번들만으로 확인 (`npm run test:bundle-live`)
- 전환 리허설 레벨: pom 맞춤(parent 추가·교체, 누락 좌표, 버전·scope, parent 관리 속성, 주석·dependencyManagement·plugin 제외, 멱등), 누락 패키지·연쇄·수동 항목 분류와 후보 좌표, Maven fork 형식·경고 제외 파서, 사본 제외 규칙·원본 지문 불변, 단계 순서(재조립 → 적용 → 컴파일 → pom 맞춤 → 컴파일)·javac 상한 해제 인자, 단계 실패 계속, 기록과 평가서 6절 (`npm run test:rehearse`, 38단언, 네트워크 불필요); CI 통합이 공식 공통컴포넌트 v4.3.2 전체 트리를 실제로 리허설해 재조립·적용 수와 오류 6,003(±10%, 누락 패키지·연쇄 95% 이상)→≤5 를 단언 (`npm run test:rehearse-live`)
- 5.x 최신 유지 레벨: 규칙 데이터(버전·근거 태그 commit·parent 2종 × 3버전·변경 11건), pom·Gradle 계획(속성 참조·비 RTE 좌표 불변, 예전 parent 기본값만 바꾸고 의도한 고정값 보존), 변경 클래스 참조 탐지(접두어만 같은 클래스·와일드카드 import), 구간(target 5.0.1, 실효 버전 5.0.1), 3.x 거부, dryRun 무기록·fault-injection 롤백·적용·백업·재진단, 가짜 runner verify 의 오류 ↔ 변경 항목 연결, `alignPom`, 평가서 2절, outputSchema, MCP `tools/call`(target=5.0.2·잘못된 target·기본 5.x) (`npm run test:update`, 55단언, 네트워크 불필요). 공식 web·boot-web 의 갱신 → JDK 17 compile·기준 미만·공급망 등급 실측 고정과 alignParent 생성은 CI 통합 `test:update-live`
- CI 실행 레벨: 생성 `Jenkinsfile` 을 공식 Jenkins LTS·고정 플러그인에서 선언형 문법 검증 후 실행(SUCCESS·5단계·보관 산출물), 생성 `.gitlab-ci.yml` 을 gitlab-ci-local 로 실행(두 job·산출물·SARIF·최소 요소) (`npm run test:ci-run-live`, CI 통합, Docker 필요)
- 배포 산출물 레벨: 분석(Classic war·Boot jar·Gradle 배치·Boot `server.port`·context-path·actuator 프로브·Servlet 6.1 → Tomcat 11·`Globals.<type>.Url`/`Globals.Url`/`spring.datasource.url`·DB 별칭·초기화 SQL 선택·지원 안 함 3종), Dockerfile(멀티 스테이지·캐시 마운트·5xx 재시도·WAR 풀기·비루트·HEALTHCHECK·레지스트리 ARG·미리 빌드), 생성 `docker-compose.yml` 의 공식 Compose 스키마(compose-spec 고정물) 통과·DB 컨테이너·초기화 순서·설정 볼륨, Kubernetes(보안 설정·프로브·ConfigMap/Secret 분리·Classic Secret subPath·Ingress), 입력 주입 거부·새 파일만·부분 충돌 시 무기록 (`npm run test:deploy`, 49단언, 네트워크 불필요). 실제 빌드·기동·compose 는 CI 통합 `test:deploy-live`(hadolint·kubeconform 포함)
- 공개 API 계약 레벨(v1.0, `test:api-contract` 50단언, 게이트 맨 앞): 계약 스냅샷 일치(도구 34·구조화 출력 13·CLI 명령 11·종료 코드·환경 변수·`engines`), 분류기 23경우(파라미터 삭제·필수 추가·기본값·범위 축소·출력 필드 삭제·도구 삭제·종료 코드·Node 상향 → major, 선택 파라미터·출력 필드·도구·명령 추가·범위 확대·deprecated → minor), 버전 증가 폭 9경우, deprecated 별칭(`top` → `topN` 본문 동일·별도 경고 항목·`format=json` 본문 파싱 유지). `test:release` 는 이번 릴리스의 증가 폭(0.47.0 → 1.0.0, major)을 단언합니다.
- 납품 패키지 레벨(v1.1, `test:delivery` 55단언): 입력 지문·rootHash, dryRun 무기록, 거부 4종, 1차 생성(파일 16종·프로젝트 불변·manifest·SBOM 공급자와 OSV·VEX), verify(일치·수정·삭제·추가), 같은 입력 2차 차이 0, 3차(RTE 버전 변경·새 취약점·보안약점 해소·VEX 판단 보존·zip), 실패 항목 처리, 비어 있지 않은 디렉터리 거부·스테이징 잔여물 없음, CLI 정의, MCP 도구. CI 통합 `test:delivery-live`: 공식 web 템플릿 생성 → verify → 2차 차이 0 → 의존성 내린 사본 diff → 변조 verify → CLI → OSV 덤프 오프라인 번들.
- 작업공간 레벨(v0.47, `test:workspace` 55단언): Maven 모듈·Gradle include·독립 프로젝트 탐지와 라이브러리·parent 상속 판정, YAML 평탄화, 모듈 parent 관리·Gradle 버전 변수·BOM parent, Gradle 변수 auto/manual 과 적용, 다중 서비스 계획(참조 치환·환경 변수 이름·브로커 계정·기동 순서·설정 저장소 사본·DB 계정·루트 컨텍스트 `-pl`), compose 공식 스키마·`$$`·k8s 키 중복 없음, `modules`, SBOM 합본, 보안약점·평가서 모듈 표.
- MSA 템플릿 레벨(v0.47, CI 통합 `test:workspace-live`): 공식 MSA 템플릿 3종의 모듈 수·라이브러리 수·모듈별 의존성(버전 없음 0)·5.x 최신 유지·보안약점·평가서 모듈 표, 생성 compose(공식 스키마·`docker compose config`)·kubeconform·hadolint, `msa-common-components` 5.0.2 갱신 → 루트 `mvn package` → compose 기동(ConfigServer·EurekaServer·GatewayServer·EgovBoard·MySQL·RabbitMQ healthy, Eureka 등록, Gateway health UP).
- 보안약점 점검 레벨: 규칙 20종 데이터 검증(가이드 7개 유형·항목·CWE·컴파일), Java·XML·JSP 주석 제거(문자열·텍스트 블록 보존, HTML 주석 안 EL 유지), 규칙마다 양성·음성 픽스처(오탐 방지 사례 — `<c:out>`·커스텀 태그 속성·`fn:escapeXml`·상수 c:out·`ENC()`·자리표시자·파라미터 이름·보호 설정 있는 XML 파서 등), ORDER BY 강등·요청 값 동반 승격·보안 문맥 난수, 출처(매니페스트 원본·수정본·매니페스트 없음), 예외 파일(사유·검토자 없으면 미적용), baseline(JSON·SARIF, 줄 이동에도 같은 항목), SARIF 2.1.0 OASIS 공식 스키마(테스트 고정물) (`npm run test:secure-coding`, 52단언, 네트워크 불필요). 공식 공통컴포넌트 v3.10.0·v4.3.2 의 규칙별 건수는 회귀 코퍼스 기대값(±1%), 공식 템플릿은 CI 통합 `test:secure-live`(Initializr 고정 템플릿은 단언, 저장소 브랜치 템플릿은 drift 로그)
- SPDX 레벨: 실제 플러그인 출력 고정물을 SPDX 2.3 으로 바꿔 공식 spdx-spec v2.3 스키마 통과, 패키지 68·`DEPENDS_ON` 간선 수 = CycloneDX 의존 간선·의존 없음 `NONE`·체크섬·라이선스(LicenseRef)·DESCRIBES, 되읽었을 때 최소 요소 요소별 충족 수·purl·의존 간선·기준 판정(annotations)·취약점(advisory) 보존, 다른 도구 모양 SPDX(`DEPENDENCY_OF`·`NOASSERTION`·여러 DESCRIBES·Person/Organization/Tool)의 필드 대응, `bomFormat="spdx-json"` 생성·SPDX 입력 점검(형식 판별·CycloneDX 와 같은 판정·SPDX↔CycloneDX 비교 차이 0·VEX 거부)·outputSchema (`npm run test:spdx`, 43단언, 네트워크 불필요). 실제 Maven SBOM 의 SPDX 판정 일치는 CI 통합 `test:sbom-live` 가 확인
- SBOM 운영 레벨: 실제 플러그인 출력 고정물(공식 web 템플릿 67 component)로 최소 요소 7종(빠진 항목별)·공급자 표 보완·purl 재판정·가짜 OSV(새/사라진 ID)·비교(추가·제거·버전·판정·취약점)·VEX 생성/판단 보존/같은 ID 의 새 영향 component·깨진 VEX 중단을 단언하고, 생성 SBOM·VEX 를 CycloneDX 1.6 공식 JSON 스키마(specification 1.6.1)로 검증 (`npm run test:sbom-check`, 54단언, 네트워크 불필요); CI 통합이 실제 SBOM 으로 보완 필요(주 component 공급자·작성자) → supplier·author 로 보완(환경에 따른 다른 공백은 `info:` 로그), 두 SBOM 비교 차이 0, 실제 OSV VEX 초안·판단 보존을 확인 (`npm run test:sbom-live`)
- 메타데이터·구조화 출력 레벨: `TOOL_META` ↔ 등록 도구 일치, 읽기 전용·파괴·네트워크 힌트 배정, 영문 title, 7종 도구의 실제 결과(진단·검증·전환 진단/적용·의존성·네트워크·리포트, 빈 프로젝트 포함)가 `outputSchema` 를 통과하고 최상위 키가 전부 선언돼 있으며 잘못된 값은 거부 (`npm run test:output-schemas`, 47단언, 네트워크 불필요). MCP 프로토콜 경유 호출 시 SDK 가 `structuredContent` 를 스키마로 검증합니다
- 테스트 이식성 레벨: `scripts/check-test-portability.mjs` 가 `test/*.mjs` 에서 Windows 에서 깨지는 가정(정규화 없는 `path.relative` 비교, `./mvnw` 리터럴 기대값, POSIX 절대 경로)을 찾아 실패시킵니다(`npm run check:portability`, 게이트 포함, 의도된 줄은 `// portability: ok <사유>`). 플랫폼 분기 함수(`resolveCommand`·`collectAgentsFacts`)는 `platform` 주입으로 linux·win32 양쪽을 단언합니다
- 문서 검색 레벨: `search_egovframe_docs`의 키워드 매칭·점수 정렬·컴포넌트 매핑·빈질의/미존재어 처리 검증 (`npm run test:docs`, 네트워크 불필요)
- 리포트 레벨: 픽스처로 `generate_egovframe_report`의 컴포넌트·테이블·가이드 링크 렌더링 검증 (`npm run test:report`, 네트워크 불필요)
- 평가서 레벨: 등급 산식 경계(구간·등급)와 리포트 숫자로의 재계산, 3.x(공통컴포넌트 소스·교체 라이브러리·http 저장소·벤더)·4.x 소형·5.x parent 픽스처의 절별 내용과 등급(5.x 는 전환 범위 0·A), OSV 조회·실패 시 취약점 요인, SBOM 요약·깨진 파일, 절 조립·중복 제거, `outputPath` 저장·dryRun·기존 파일/프로젝트 밖/절대 경로/symlink/.md 아님 거부, `structuredContent` 스키마 (`npm run test:assessment`, 55단언, 네트워크 불필요). CI 통합이 공식 5.x 템플릿 2종에서 전환 A 를 확인 (`npm run test:dependencies-live`)
- CLI 레벨: 인자 해석(`--x`·`--x=v`·`--no-x`)·스키마 형 변환·모르는 옵션, `--fail-on` 등급·임계값·오류, 종료 코드 0/2/3/64, 쓰기 옵션 차단, `--json` = 라이브러리 결과, `--out`·`--step-summary`, 실제 프로세스(인자 유무로 서버/CLI) (`npm run test:cli`, 32단언, 네트워크 불필요). CI 생성 레벨에 공급망 게이트 job·`failOn` 주입 거부 추가(`npm run test:ci`), CI 통합에서 생성 워크플로를 `actionlint` 로 검사하고 4.3.2 코퍼스 트리로 CLI 평가서를 실행해 job 요약에 등급을 남깁니다
- 재조립 레벨: 메모리 원본 저장소로 원본 태그 식별(세대 후보·지정·없는 태그), 8가지 판정(CRLF 체크아웃 포함)·처리, dryRun 무기록, 적용 후 파일·백업·자산 참고본·패치(원문 바이트 보존)·매니페스트·계획 파일, `validate` 누락 0, 매니페스트 관리 컴포넌트 거부, fault-injection rollback, 목표 내용 blob 불일치 거부, verify 오류 연결 (`npm run test:reassemble`, 46단언, 네트워크 불필요). CI 통합이 공식 v3.10.0 트리의 `cmm`·`bbs` 를 고친 픽스처를 실제 git 원본·sha256 검증 아카이브로 재조립해 v5.0.7 tree 일치·패치·`validate`·`upgrade` 변경 0 을 확인 (`npm run test:reassemble-live`)
- 회귀 코퍼스 레벨: 공식 공통컴포넌트 v3.10.0·v4.3.2 부분 트리(커밋 고정, sparse 클론, 캐시)에 진단·dryRun 적용·의존성 점검·평가서를 돌려 `catalog/migration-corpus.json` 기대값과 ±1% 안인지, 세대 판정·확인 필요 클래스 0·기준 없음은 `xerces` 뿐·계획=자동 전부·재조립 권고·등급 D/D·60초 미만을 단언 (`npm run test:migrate-corpus`, 20단언, git·네트워크 필요, CI 통합). 기대값 갱신은 `npm run generate:migration-corpus`(`--check` 는 차이만)
- 업그레이드 레벨: 3-way 판정 6분류(unchanged/update/user-modified/conflict/added/removed)·v1 보수모드·정상 적용/백업 계획·파일/매니페스트 fault-injection rollback·상위 symlink 경계 검증 (`npm run test:upgrade`, 네트워크 불필요)
- 컴포넌트 설명 레벨: `explain_egovframe_component`의 의존성(직접·전이)·역의존·테이블·가이드 URL·미존재 예외 검증 (`npm run test:explain`, 네트워크 불필요)
- CI 생성 레벨: `generate_egovframe_ci`의 maven/gradle 감지·YAML·dryRun 무기록·기존 파일 거부·빌드파일 부재 예외·`jdk`·`failOn`·`supplier`·환경 변수 주입 입력 거부, 세 플랫폼 공통 게이트 명령(sbom → sbom-check → assess), 생성 `.gitlab-ci.yml` 의 GitLab 공식 CI 스키마(v19.4.1-ee 고정물) 통과, `Jenkinsfile` 의 Declarative 구조(pipeline·agent·options·stages·post, 괄호 짝, 단계 순서)·Windows 경로 이스케이프, 공급자 단서 없을 때 게이트 실패 예고 (`npm run test:ci`, 네트워크 불필요)
- CRUD 생성 레벨: 공식 wizard 그룹, Classic/Boot 분기, DB 생성키, JUnit 5, dryRun, PK·경로 검증, 충돌 시 전체 무기록 검증 (`npm run test:crud`, 네트워크 불필요)
- CRUD 컴파일 레벨: 공식 simple-backend/Boot CRUD 7파일과 web-sample/Classic CRUD 9파일 생성 → JDK 17에서 `mvn -q -DskipTests compile` (`npm run test:crud-integration`, 네트워크 필요, CI 실행)
- 보안약점 데이터 흐름 레벨(v1.5, `test:secure-flow` 18단언): 파라미터·request·append·for-each·업로드 파일명 → 위험 호출의 tainted 판정과 경로 줄, 상수·정화(parseInt·filePathBlackList)·서비스 메서드 파라미터(판단 불가)·VO getter, 사람이 판정한 표본(TP 5·FP 6)의 정밀도·재현율·오탐 수 전후 비교, 흐름으로 찾은 항목 note, SARIF codeFlows 공식 스키마, 지문 유지, outputSchema. `test:secure-coding` 에 `dataFlow=false` 동일성. CI 통합 `test:secure-live` 가 템플릿 7종 지문 유지·시간 2배 이내
- DDL·검색 CRUD 레벨(v1.4, `test:crud-ddl` 41단언): 공식 Initializr v5.0.7 `ddlParser.spec.ts` 의 입력 12개·분리 경계 7개·거부 3종을 같은 결과로, MySQL·PostgreSQL·Oracle·HSQL 타입·자동 증가·COMMENT ON COLUMN, `ddl` 생성물 = 같은 필드를 `fields` 로 준 생성물(바이트 동일), `<bind>` LIKE·`||`/CONCAT 없음·searchCondition 분기, 화면 이스케이프, 생성 CRUD 보안약점 0건, 거부 5종. CI 통합 `test:crud-search-live` 가 생성 Mapper 를 MyBatis 로 HSQLDB 3개 문법 모드에서 실행
- 표준프레임워크 5.1.0 레벨(v1.3): 5.1 기준(BOM `egovframe-rte-root`·Spring 6.2.19·Boot 3.5.16·Security `6.5.11-egov.1`·AI 모듈)과 계열별 기준 선택, parent 5.1.0 픽스처의 managed·outdated·`-egov.N` 판정과 OSV 원 버전 조회, 5.0.x 프로젝트의 5.1.0 안내(`test:dependencies`); 5.1.0 단계 규칙(저장소 sources jar 27종 sha256·새 AI 모듈·근거 `maven-sources`), `target="5.1.0"` 진단(`test:update`); SBOM 의 재빌드 공급자·5.1 기준(`test:sbom`); drift 의 태그 없음·태그 생김·BOM 재배포(`test:catalog-drift`); 입력 pattern 확장의 계약 분류(`test:api-contract`); CI 통합 `test:update-live` 가 공식 web·boot-web 템플릿을 5.0.2 → 5.1.0 으로 갱신해 JDK 17 compile
- 응답 영문화 레벨(v1.2, `test:i18n` 44단언): 고정 프로젝트 2개로 17개 출력(전환·의존성·평가서·5.x 갱신·보안약점·배포·SBOM 점검·SBOM·납품·검증)을 `ko` 로 만들어 goldens(`test/fixtures/i18n-golden-ko.json`, 영문화 전 코드로 생성)와 바이트 비교, `en` 으로 다시 만들어 한글 0줄, 규칙 데이터 7파일의 한국어 문장 필드마다 `_en` 존재, `setLang`·`langFromEnv`·CLI `--lang`/`EGOVFRAME_LANG` 우선순위와 복원. 렌더러 문구를 바꿀 때만 `npm run i18n:golden` 으로 goldens 갱신
- 진행 알림·취소 레벨(v1.2, `test:progress` = `progress-runners` 38 + `progress-tools` 41 + `progress-mcp` 10 단언): 실제 자식 프로세스 취소(pid 소멸), 러너·의존성 해석·SBOM·납품·재조립·리허설·오프라인 번들의 단계 순서·단조 증가·하위 진행 분수, 취소 시 `AbortError`·부분 출력 없음·프로젝트 트리 불변·작업공간 삭제, MCP in-memory 클라이언트의 `progressToken` 알림 순서·토큰 없으면 무알림·`notifications/cancelled` 로 가짜 `mvnw` 트리 종료
- 안전성 레벨: 19개 도구 공통 허용 root의 미설정 호환·격리·`..` 이탈·symlink 우회·다중 root·비대상 인자 무해 6케이스와 구조화 rollback 필드를 검증합니다 (`npm run test:allowed-roots`, `npm run test:transaction`, 네트워크 불필요).

## 릴리스 절차 (매 버전 공통)

1. `main` 최신화 후 기능 브랜치 생성 → 패치 적용(`git am`) 또는 직접 커밋. 버전은 `package.json`·`server.json`(두 곳) 을 함께 올리고 `CHANGELOG.md` 에 `- **X.Y.Z** — …` 항목을 쓴다(`test:release` 가 셋을 단언)
2. `npm ci && npm run prepublishOnly` 로컬 통과(Windows 클론은 `core.autocrlf` 무관하게 통과해야 함). 테스트 기대값은 플랫폼 중립이어야 한다 — 플랫폼 분기 함수는 `platform` 을 주입해 양쪽을 단언하고, `npm run check:portability` 가 0건이어야 한다
3. 푸시 → PR → CI 5개(ubuntu·windows × Node 22/24 + integration, v1.0 이전은 7개) 전부 통과 → squash 병합. 공개 API 를 바꿨으면 `npm run api-contract:update` 로 스냅샷을 갱신하고 그 diff 와 버전 증가 폭을 PR 에서 함께 검토합니다([버전 정책](versioning.md)). **여기까지가 사람의 일입니다.**
4. 병합 뒤 `main` 의 CI 가 성공하면 `Release` 워크플로(`.github/workflows/release.yml`)가 `scripts/release-check.mjs` 로 전제(`server.json` 버전 일치·변경 이력 항목)를 확인하고 원격 상태(npm·태그·GitHub Release·MCP Registry)를 보아 **남은 단계만** 수행합니다: npm(OIDC trusted publishing, provenance 자동) → 게시된 커밋에 `vX.Y.Z` 태그 → GitHub Release(`scripts/release-notes.mjs`) → MCP Registry(GitHub OIDC). 조건이 안 맞으면 이유를 적고 성공 종료합니다(문서만 바꾼 병합은 아무것도 게시하지 않음)
5. 확인: Actions 의 `Release` 요약(단계별 결과), `npm view egovframe-scaffold-mcp version`, Releases 페이지, 레지스트리 검색. 도중에 끊기면(v0.36.1 처럼 npm 전파 지연, Registry 실패 등) 손댈 것 없이 다음 `main` 병합(또는 `Run workflow`)의 Release 가 이어서 합니다 — npm 만 돼 있으면 태그를 npm 이 기록한 `gitHead` 커밋에 만들므로 패키지와 태그가 같은 코드를 가리킵니다(그 커밋이 `main` 의 조상이 아니면 수동 태그를 안내하고 멈춤)

비상용 수동 절차(워크플로를 쓸 수 없을 때): `main` 에서 `node -p "require('./package.json').version"` 으로 버전 확인 **후** 태그를 `main` 커밋에 생성·푸시 → `npm publish` → `mcp-publisher publish`. 태그는 반드시 병합된 `main` 커밋에 답니다(v0.25.2·v0.28.0·v0.28.1·v0.30.0·v0.33.0 에서 잘못 단 적이 있어 자동화했습니다).

## 브랜치 보호 (소유자 1회)

v0.42 에서 실패한 CI 상태로 병합한 적이 있어(#51), `main` 에 필수 상태 검사를 겁니다. v1.0 에서 매트릭스를 Node 22·24 로 바꿔 7개 → 5개가 되었습니다 — **1.0.0 PR 을 병합하기 전에** 아래를 다시 실행해야 옛 이름(node 18·20)의 검사를 기다리지 않습니다. 저장소 소유자가 한 번만 실행합니다.

```cmd
echo {"required_status_checks":{"strict":false,"contexts":["gate (ubuntu-latest, node 22)","gate (ubuntu-latest, node 24)","gate (windows-latest, node 22)","gate (windows-latest, node 24)","integration (official templates & components)"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}> protection.json
gh api -X PUT repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection --input protection.json
gh api repos/EricSeokgon/egovframe-scaffold-mcp/branches/main/protection/required_status_checks --jq ".contexts | length"
```

- 마지막 명령이 `5` 이면 적용된 것입니다. 이름은 CI 워크플로의 job 이름과 같아야 하므로, job 이름이나 매트릭스를 바꾸면 이 목록도 같이 바꿉니다.
- `enforce_admins: false` 라 소유자는 긴급할 때 직접 푸시할 수 있습니다. 리뷰 필수는 걸지 않습니다(1인 저장소).
- `Release` 워크플로는 `main` 의 CI 성공 뒤에 돌기 때문에 상태 검사에 넣지 않습니다.

## MCP Registry

[MCP Registry](https://registry.modelcontextprotocol.io) 용 메타데이터는 저장소의 `server.json`(이름 `io.github.EricSeokgon/egovframe-scaffold-mcp`)과 `package.json` 의 `mcpName` 이며, `npm run test:registry` 가 두 파일의 이름·버전·npm 좌표 일치를 검사합니다. 등록은 npm 배포 뒤 저장소 루트에서:

```bash
mcp-publisher login github     # GitHub device flow — io.github.EricSeokgon/ 네임스페이스 권한
mcp-publisher publish          # server.json 을 레지스트리에 게시
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EricSeokgon/egovframe-scaffold-mcp"
```

버전을 올릴 때 `server.json` 의 `version`·`packages[0].version` 도 함께 올립니다(릴리스 절차 참조).
