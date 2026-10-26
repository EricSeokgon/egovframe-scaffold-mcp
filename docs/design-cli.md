# 설계: CLI 모드와 CI 공급망 게이트 (v0.39)

코드는 `src/cli.ts`(명령·인자·`--fail-on`·종료 코드), `src/index.ts`(진입점 분기), `src/ci-config.ts`(`supplyChainJobYaml`)이고, 테스트는 `test/cli.mjs`·`test/ci.mjs` 입니다.

## 1. 문제

공공 사업의 빌드 서버(Jenkins·GitHub Actions·GitLab CI)에는 AI 클라이언트가 없습니다. 평가서·의존성 점검·SBOM 은 이 서버의 도구로만 만들 수 있어서, CI 에서 돌리려면 MCP 클라이언트를 따로 짜야 했습니다. 같은 분석을 사람 없이 돌리고, 등급·판정이 기준을 넘으면 파이프라인을 멈추게 합니다. 도구 로직은 그대로 두고 호출 통로만 하나 더 엽니다.

## 2. 진입점

| 실행 | 동작 |
|---|---|
| `npx egovframe-scaffold-mcp` (인자 없음) | 기존과 같은 MCP stdio 서버 |
| `npx egovframe-scaffold-mcp <명령> [옵션]` | 도구 하나를 실행하고 종료 |
| `--help` · `--version` | 사용법·버전 |

인자 유무로만 나누므로 MCP 클라이언트 설정(`npx -y egovframe-scaffold-mcp`)은 바뀌지 않습니다. 핸드셰이크 테스트가 인자 없는 기동을 계속 확인합니다.

## 3. 도구 호출 경로

CLI 는 같은 프로세스에 서버(`buildServer()`)를 만들고 SDK 의 `InMemoryTransport` 로 연결한 클라이언트로 `tools/call` 을 보냅니다. 그래서 입력 검증(zod)·허용 root·`outputSchema` 검증이 MCP 로 부를 때와 똑같이 적용되고, `--json` 출력은 MCP 의 `structuredContent` 와 같은 객체입니다(테스트가 라이브러리 결과와 비교). 핸들러를 직접 부르는 방법은 SDK 내부 필드(`_registeredTools`)에 기대게 되어 택하지 않았습니다.

## 4. 명령

| 명령 | 도구 | 고정·제한 | `--fail-on` 지표 |
|---|---|---|---|
| `assess` | `generate_egovframe_report` | `sections=["assessment"]` 고정, `outputPath`·`dryRun` 차단(파일은 `--out`) | `migration`·`supplyChain`(등급), `manual`·`reassemble`·`vulnerabilities`·`outdated`·`legacy`·`replace`·`securityMissing` |
| `check` | `check_egovframe_dependencies` | — | `ok`·`outdated`·`legacy`·`replace`·`unknown`·`unversioned`·`vulnerabilities`·`securityMissing` |
| `sbom` | `generate_egovframe_sbom` | 기본 dryRun, `--write` 로만 기록(`--dry-run` 직접 지정 차단) | `components`·`vulnerabilities`·`unknown`·`outdated` |
| `migrate` | `migrate_egovframe_project` | 진단만 — `apply`·`verify`·`dryRun`·`skipComponents` 차단 | `items`·`auto`·`manual`·`files` |
| `validate` | `validate_egovframe_project` | — | `invalid`·`missing`·`warnings` |
| `diagnose` | `diagnose_egovframe_project` | — | `issues`·`components` |
| `network` | `diagnose_egovframe_network` | — | `failed`·`ok` |

쓰기 도구(프로젝트 생성·조립·적용·재조립)는 노출하지 않습니다. 결과를 사람이 보고 판단해야 하는 일은 MCP 경로에 남깁니다.

옵션은 도구 파라미터와 같은 이름입니다(kebab-case 가능: `--resolve-scope all`, `--top-n 10`). 형 변환은 `tools/list` 가 주는 JSON Schema 의 타입을 따릅니다(boolean: `--x`·`--no-x`·`--x=false`, 숫자, 배열은 쉼표). 모르는 옵션은 도구 파라미터 목록과 함께 거부합니다. 공통 옵션은 `--project`(기본 현재 디렉터리)·`--json`·`--out`·`--step-summary`(Markdown 을 `$GITHUB_STEP_SUMMARY` 에 덧붙임)·`--fail-on`·`--write` 입니다.

## 5. `--fail-on` 과 종료 코드

식은 쉼표로 여러 개: `metric`(0 초과), `metric>N`·`metric>=N`, 등급 지표는 `grade:C`(C 이상이면 실패 — A<B<C<D). 등급 지표에 임계값을 쓰거나 일반 지표에 등급을 쓰면 사용법 오류입니다.

| 코드 | 의미 |
|---|---|
| 0 | 통과 |
| 2 | `--fail-on` 기준 초과 |
| 3 | 실행 실패(도구 오류·없는 디렉터리·네트워크 등) |
| 64 | 사용법 오류(`sysexits` 의 EX_USAGE) |

본문(Markdown 또는 JSON)은 stdout, 한 줄 요약은 stderr 입니다 — 파이프라인 로그에는 요약이, 아티팩트에는 본문이 남습니다.

## 6. CI 공급망 게이트 (`generate_egovframe_ci(supplyChain=true)`)

기존 빌드 job 옆에 `supply-chain` job 을 추가합니다: checkout → setup-java(빌드 도구 캐시) → setup-node 22 → `npx -y egovframe-scaffold-mcp@<이 버전> sbom --write --overwrite --offline=false` → `assess --offline=false --out egovframe-assessment.md --step-summary --fail-on <failOn>` → 아티팩트 업로드(`if: always()`). 패키지 버전을 생성 시점의 서버 버전으로 고정해 규칙·기준이 바뀌어도 게이트 결과가 저절로 바뀌지 않게 합니다. `failOn` 은 YAML 에 그대로 들어가므로 `CI_FAIL_ON_RE` 로 형식을 제한합니다(주입 거부 테스트). 생성 결과는 CI 통합에서 `actionlint` 로 검사합니다.

v0.43 에서 `sbom` 과 `assess` 사이에 `sbom-check --out egovframe-sbom-check.md --step-summary --fail-on minimum` 단계가 들어갔습니다(최소 요소 7종이 빠지면 종료 코드 2). 아티팩트에 `egovframe-sbom-check.md` 가 더해집니다.

## 6.1 플랫폼 (v0.43: `platform="github"|"gitlab"|"jenkins"`)

세 플랫폼은 **같은 게이트 명령 목록**(`supplyChainCommands` — sbom → sbom-check → assess)을 공유하고, 플랫폼마다 그것을 실행하는 껍데기만 다릅니다. 그래서 규칙·종료 코드·아티팩트 이름이 플랫폼 사이에 어긋나지 않습니다. `--step-summary` 는 GitHub 에서만 붙입니다.

| | GitHub Actions | GitLab CI | Jenkins (Declarative) |
|---|---|---|---|
| 파일 | `.github/workflows/egovframe-ci.yml` | `.gitlab-ci.yml` | `Jenkinsfile` |
| 실행 환경 | `ubuntu-latest` + setup-java·setup-node | `maven:3.9-eclipse-temurin-<JDK 주 버전>`(Gradle: `eclipse-temurin:<JDK>`), 게이트 job 은 Node 가 없으면 apt 로 설치 시도 | `agent any` — 에이전트에 JDK·Maven·Node.js |
| 빌드 | `mvn -B verify` / `./gradlew build` | 같음 + JUnit 리포트, 로컬 저장소 캐시(`MAVEN_OPTS`·`GRADLE_USER_HOME`) | 같음, `isUnix()` 로 `sh`/`bat` |
| 게이트 | 별도 job | `supply-chain` job(`needs: []` 로 빌드와 병렬) | `SBOM` → `SBOM check` → `Assessment` 단계 |
| 보관 | upload-artifact(`if: always()`) | `artifacts: when: always` + `reports: cyclonedx` | `post { always { archiveArtifacts allowEmptyArchive: true } }` |
| 환경 변수 | job `env` | `variables` | `environment` |

입력값은 설정 파일에 그대로 들어가므로 모두 형식을 제한합니다: `jdk`(숫자·점), `failOn`(`CI_FAIL_ON_RE`), `supplier`(문자·숫자·공백·`.,&()_-`, 명령줄에 큰따옴표로), `npmRegistry`(http(s) URL, 따옴표·공백·`$` 불가), `offlineBundle`(절대 경로, 영문·숫자·`._-/\:`·공백). YAML 은 작은따옴표 스칼라, Groovy 는 작은따옴표 문자열(역슬래시 이스케이프)로 씁니다.

검증: 생성 `.gitlab-ci.yml` 은 GitLab 공식 CI JSON 스키마(gitlab `v19.4.1-ee` 의 `app/assets/javascripts/editor/schema/ci.json`, 테스트 고정물)로, `Jenkinsfile` 은 구조 단언(pipeline·agent·options·stages·post, 문자열 밖 괄호 짝, 단계 순서)으로 확인합니다. GitHub 워크플로는 기존대로 CI 통합에서 `actionlint` 로 검사합니다. Jenkins 의 실제 실행은 보류입니다.

## 6.2 원격 저장소 일시 장애 (v1.6)

표준프레임워크 Maven 저장소(`maven.egovframe.go.kr`)는 503·연결 끊김을 자주 냅니다. 생성 CI 의 Maven 빌드 단계는 세 겹으로 버팁니다.

1. **요청 재시도**: `-Daether.connector.http.retryHandler.count=5`·`interval=10000`·`serviceUnavailable=429,500,502,503,504`(Maven 3.9 Resolver — 모르는 Maven 은 무시). 생성 Dockerfile(v0.45)과 같은 방식에 간격을 더했습니다.
2. **명령 재시도**: 실패 로그에 **저장소 실패 문맥**(`Could not transfer`·`transfer failed`·`Non-resolvable`·`Could not resolve` 등)과 **일시 장애 원인**(`status: 5xx`·`status code: 5xx`·`Connection reset`·`timed out`·`Service Unavailable` 등)이 함께 있을 때만 30초·60초 뒤 `-U` 로 다시(최대 3회). 컴파일·테스트 실패, 404 는 다시 실행하지 않습니다. 문구 목록은 `src/maven-resilience.ts` 의 `TRANSIENT_CONTEXT`·`TRANSIENT_CAUSE` 하나이고 세 플랫폼이 그것으로 만듭니다.
3. **미러**: `mavenMirror` 면 모든 저장소(`*`)를 그 URL 로 보내는 settings 를 작업 디렉터리 `.egovframe-ci-settings.xml` 에 쓰고 `-gs` 로 씁니다(사용자 settings 의 인증·미러는 그대로). 게이트의 CLI 단계는 `EGOVFRAME_MAVEN_MIRROR` 로 받습니다.

| | GitHub Actions | GitLab CI | Jenkins |
|---|---|---|---|
| 껍데기 | `shell: bash`(pipefail) + `tee` 로 로그를 흘리며 | `sh` 한 줄(`set -e` 에서도 안전한 `&& s=0 \|\| s=$?`), 실행 뒤 로그 출력 | `mvnResilient(goals)` — `sh`/`bat` 의 `returnStatus`·`readFile`, 클로저·정규식 없이(샌드박스·CPS 안전) |
| 미러 settings | `printf` 단계 | 스크립트 첫 줄 `printf` | `writeFile` |
| 게이트 CLI | job `env` | `variables` | `environment` |

MAVEN_ARGS 는 쓰지 않습니다 — Jenkins `environment` 나 GitLab `variables` 에 넣으면 에이전트·러너가 이미 쓰는 값(프록시 settings 등)을 덮기 때문입니다.

MCP 도구(`build_`·`test_egovframe_project`, 이를 쓰는 전환 검증·리허설·5.x 갱신·재조립·납품)는 같은 판정으로 `failureKind`(`compile`·`test`·`repository-unavailable`·`timeout`·`other`)·`repository`(URL·상태)·`failureHint` 를 돌려주고, `retryTransient`(기본 1)만큼 `-U`(Gradle `--refresh-dependencies`)로 다시 실행합니다. Maven 실행에는 `MAVEN_ARGS` 로 요청 재시도와 `EGOVFRAME_MAVEN_MIRROR` 미러(`-gs` 임시 settings)를 더합니다 — 이미 재시도가 지정돼 있으면 그대로 둡니다.

## 7. 범위 밖

- Azure DevOps·Bamboo 등 다른 CI, Jenkins 플러그인 설치·서버 설정(v0.43 범위 밖).

- `--lang en`(평가서·점검 결과의 라벨 영문화)은 넣지 않았습니다. 응답 본문의 영문화는 도구마다 렌더러를 바꾸는 일이라 별도 버전에서 다룹니다.
- MCP 프로토콜 `2025-11-25` 의 `tasks`(장시간 도구의 비동기 실행)는 SDK 에서 실험 단계라 쓰지 않습니다. SDK 는 1.32.1 로 올렸고, 기존 테스트는 변화 없이 통과했습니다.
