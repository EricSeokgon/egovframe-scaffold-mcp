# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

**English summary: [README.en.md](README.en.md)**

전자정부 표준프레임워크(eGovFrame) 프로젝트의 **생성 → 조립 → 전환 → 납품 점검 → 배포**를 AI 도구 안에서, 그리고 빌드 서버의 명령 한 줄로 처리하는 [MCP(Model Context Protocol)](https://modelcontextprotocol.io) 서버입니다. Claude Desktop·Claude Code·Cursor·VS Code(Copilot) 등 MCP 를 지원하는 AI 도구에 붙이면 대화로 쓰고, AI 도구가 없는 CI 에서는 같은 패키지를 CLI 로 씁니다.

> [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 개념 증명(PoC)으로 시작한 커뮤니티 프로젝트입니다. 공식 산출물이 아닙니다.

**무엇을 해 주나**

- **새 프로젝트**: 공식 Initializr 템플릿 22종으로 프로젝트를 만들고, 공통컴포넌트(v5.0.7, 190항목)·AI RAG 계층·CRUD 코드·Spring 설정 파일을 조립합니다. 그 자리에서 빌드·테스트까지 돌립니다.
- **3.x/4.x → 5.x 전환**: 진단 → 사본 리허설 → 적용 → 컴파일 검증까지 한 흐름입니다. 공식 RTE·공통컴포넌트 저장소에서 만든 규칙(클래스 331종·컴포넌트 1,089종)으로 자동 치환과 수동 작업을 나눕니다. 이미 5.x 인 프로젝트는 최신 5.0.x 로 맞춥니다.
- **납품 전 점검**: 의존성 기준 대조·OSV 취약점, CycloneDX·SPDX SBOM 생성과 점검(최소 요소·비교·VEX), 행안부·KISA 개발보안 가이드 보안약점(SARIF), A–D 등급 전환 준비도 평가서를 냅니다.
- **배포·CI**: Dockerfile·docker-compose·Kubernetes 매니페스트(멀티 모듈·MSA 포함), GitHub Actions·GitLab CI·Jenkins 의 공급망 게이트를 만듭니다. 폐쇄망은 오프라인 번들로 지원합니다.

모든 쓰기 도구는 `dryRun` 미리보기를 제공하고, 실제 쓰기는 transaction 으로 실패 시 되돌립니다. 규칙과 기준은 코드가 아니라 공식 저장소에서 만든 데이터(`catalog/`)입니다.

## 빠른 시작

Node.js **22 이상**이 필요합니다. npm 에 배포되어 있어 설치 없이 `npx` 로 실행합니다.

**AI 도구에 연결** — MCP 클라이언트 설정(`mcpServers`)에 추가합니다. Claude Desktop 은 `claude_desktop_config.json`, Claude Code 는 `claude mcp add egovframe-scaffold -- npx -y egovframe-scaffold-mcp`, Cursor 는 `.cursor/mcp.json` 입니다.

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "npx",
      "args": ["-y", "egovframe-scaffold-mcp"]
    }
  }
}
```

연결되면 이렇게 말하면 됩니다.

> 표준프레임워크로 `my-egov-app` 프로젝트를 `~/work` 에 만들어줘. groupId 는 `egovframework.example`, DB 는 mysql. 게시판이랑 로그인 컴포넌트도 넣어서 빌드까지 해 줘.

**CLI 로 실행** — AI 도구 없이 프로젝트 디렉터리에서 바로 씁니다.

```bash
npx -y egovframe-scaffold-mcp assess --project . --offline=false --out assessment.md   # 전환 준비도 평가서
npx -y egovframe-scaffold-mcp check  --project . --resolve --offline=false            # 의존성·취약점 점검
npx -y egovframe-scaffold-mcp secure --project . --sarif-path egovframe-secure.sarif  # 보안약점 점검
```

**자주 쓰는 환경 변수** (클라이언트 설정의 `env` 또는 셸)

| 변수 | 용도 |
|---|---|
| `EGOVFRAME_LANG=en` | 도구 설명과 응답 본문(평가서·전환·의존성·SBOM·보안약점·배포·납품 결과의 라벨·헤더·사유)을 영문으로(v1.2). CLI 는 `--lang en` |
| `EGOVFRAME_ALLOWED_ROOTS` | 도구가 읽고 쓸 수 있는 디렉터리 제한(여러 개는 OS 경로 구분자로). 미설정 시 제한 없음 |
| `EGOVFRAME_OFFLINE_BUNDLE` | 폐쇄망 오프라인 번들 디렉터리([폐쇄망](#폐쇄망에서-쓰기)) |
| `EGOVFRAME_CACHE_DIR` | 공통컴포넌트 아카이브·태그 미러 캐시 위치(기본 `~/.cache/egovframe-scaffold-mcp`) |
| `EGOVFRAME_MAVEN_MIRROR` | 사내 Maven 미러(Nexus·Artifactory 프록시) URL — 빌드·테스트·SBOM·의존성 트리의 모든 Maven 요청을 이 미러로(v1.6). 표준프레임워크 저장소가 503 을 자주 낼 때 |
| `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1` | 사내 프록시 뒤에서 다운로드가 타임아웃될 때 |

## 사용 시나리오

### AI 도구에서 (개발자)

도구 이름을 몰라도 됩니다. 아래는 대화 예시와, 그때 실제로 쓰이는 도구입니다.

**새 프로젝트 만들고 조립하기**

> "`simple-backend` 템플릿으로 `~/work/portal` 을 만들고, 게시판·로그인·보안 컴포넌트를 넣어 줘. DB 는 postgres."

`create_egovframe_project` → `add_egovframe_components`(DDL·DML 포함) → `build_egovframe_project`. 자주 쓰는 조합은 레시피 하나로도 됩니다: `apply_egovframe_recipe(recipeId="board-login", …)`. AI 챗봇이 필요하면 `add_ai_components`(Spring AI 또는 LangChain4j), 화면·서비스가 필요하면 `generate_egovframe_crud`(v1.4 부터 `CREATE TABLE` 문을 그대로 `ddl` 로 주고 `search` 로 목록 검색 조건까지), 데이터소스·캐시·로깅 설정은 `generate_egovframe_config` 입니다.

**3.x/4.x 프로젝트를 5.x 로 옮기기**

> "`~/legacy/app` 을 5.x 로 전환하고 싶어. 먼저 얼마나 걸릴지 봐 줘."

1. `migrate_egovframe_project(projectDir)` — 읽기 전용 진단. 자동 치환 가능한 항목과 사람이 봐야 할 항목을 나눕니다.
2. `rehearse_egovframe_migration(projectDir)` — 프로젝트 사본에서 재조립 → 전환 적용 → JDK 17 컴파일 → pom 맞춤 → 컴파일을 실제로 돌려 남는 오류 수를 알려 줍니다. 원본은 건드리지 않습니다.
3. `reassemble_egovframe_components(projectDir, apply=true)` — 복사해 둔 공통컴포넌트 소스를 v5.0.7 로 바꾸고, 직접 수정한 부분은 패치로 남깁니다.
4. `migrate_egovframe_project(projectDir, apply=true, verify=true)` — 적용하고 컴파일해 오류를 수동 항목과 연결합니다. 백업과 작업 목록이 남습니다.

이미 5.x 라면 `migrate_egovframe_project(target="5.0.2")` 가 parent·RTE 버전을 최신 5.0.x 로 맞춥니다. 공식 Initializr 템플릿도 parent 가 5.0.0·5.0.1 로 나오므로 새 프로젝트에도 `create_egovframe_project(alignParent=true)` 로 같은 갱신을 적용할 수 있습니다.

**납품 전에 점검하기**

> "감리 전에 `~/work/portal` 의 보안약점·SBOM·평가서를 뽑아 줘."

- `check_egovframe_secure_coding(projectDir, sarifPath="egovframe-secure.sarif")` — 개발보안 가이드 보안약점. v1.5 부터 메서드 안 데이터 흐름으로 요청 값이 SQL·파일 경로·명령에 들어가는지 확인해 등급을 올리고, 상수만 쓰는 곳은 내려 오탐 소명 부담을 줄입니다. 공통컴포넌트 원본·수정본·프로젝트 코드로 출처를 나누고, `.egovframe-secure-ignore.json` 으로 검토한 예외를 관리합니다.
- `generate_egovframe_sbom(projectDir, dryRun=false, supplier="○○기관")` → `check_egovframe_sbom(projectDir, offline=false)` — CycloneDX SBOM 을 만들고 제출 최소 요소 7종과 생성 이후 새 취약점을 점검합니다.
- `generate_egovframe_report(projectDir, sections=["assessment"], outputPath="assessment.md")` — 전환 난이도·공급망 상태 등급(A–D)과 산식이 들어간 평가서.
- `prepare_egovframe_delivery(projectDir, outputDir="~/delivery/1차", dryRun=false, offline=false, supplier="○○기관")` — 위 산출물을 전부 한 디렉터리에 모읍니다(SBOM CycloneDX·SPDX, VEX 초안, SARIF, 배포 산출물 포함). 파일별 sha256 과 전체 지문(rootHash)이 든 `delivery-manifest.json` 과 목차가 생기고, 다음 차수에 `previousDelivery` 를 주면 달라진 점(등급·SBOM·새 취약점·새 보안약점)을 `diff.md` 로 냅니다. 받은 쪽은 `verify=true` 로 변조·누락을 확인합니다.

**배포 산출물 만들기**

> "이 프로젝트를 컨테이너로 띄울 수 있게 Dockerfile 이랑 compose, 쿠버네티스 매니페스트 만들어 줘."

`generate_egovframe_deploy(projectDir, dryRun=false)` — Classic war 는 Tomcat, Boot jar 는 Temurin JRE 기반의 비루트 이미지, DB 컨테이너가 붙은 compose, 프로브·리소스 제한이 있는 k8s 매니페스트를 만듭니다. 공식 MSA 템플릿 같은 멀티 모듈은 서비스마다 이미지를 만들고 `localhost` 참조를 서비스 이름으로 바꿉니다. 폐쇄망이면 `imageRegistry` 로 사내 레지스트리를 지정합니다.

**기존 프로젝트 파악하기**

`diagnose_egovframe_project` 가 빌드 도구·RTE 버전·DbType·설치된 공통컴포넌트를 읽고, `generate_agents_md` 가 그 결과로 AI 코딩 도구용 `AGENTS.md` 를 만듭니다. 공식 가이드 문서는 `search_egovframe_docs`·`get_egovframe_guide` 로 찾습니다.

### CI·DevOps

**빌드 서버에 게이트 넣기** — CLI 는 `--fail-on` 으로 기준을 넘으면 종료 코드 2 를 냅니다.

```bash
npx -y egovframe-scaffold-mcp sbom       --project . --write --offline=false --supplier "○○기관"
npx -y egovframe-scaffold-mcp sbom-check --project . --fail-on minimum            # 제출 최소 요소 미달이면 실패
npx -y egovframe-scaffold-mcp secure     --project . --sarif-path egovframe-secure.sarif --fail-on high
npx -y egovframe-scaffold-mcp assess     --project . --offline=false --step-summary --fail-on supplyChain:C
```

| 명령 | 하는 일 | `--fail-on` 지표 |
|---|---|---|
| `assess` | 전환 준비도 평가서 | `migration:C`·`supplyChain:C`(등급 이상이면 실패), `manual>20`, `vulnerabilities` |
| `check` | 의존성 점검(`--resolve` 면 전이 의존성까지) | `outdated`·`legacy`·`replace`·`unknown`·`vulnerabilities`·`securityMissing` |
| `sbom` / `sbom-check` | SBOM 생성(`--write` 필요) / 점검·비교·VEX | `minimum`·`gaps`·`newVulns`·`changed` |
| `secure` | 보안약점 점검(SARIF) | `high`·`medium`·`low`·`total`·`new` |
| `deliver` | 납품 패키지 생성(`--write`) / 받은 패키지 검증(`--verify`) | `failed`(실패 항목) / `invalid`·`mismatched`·`missing` |
| `migrate` / `rehearse` | 전환 진단(읽기 전용) / 사본 리허설 | `manual`·`auto` / `errors`·`automation` |
| `validate` · `diagnose` · `network` · `bundle` | 무결성·진단·네트워크 진단·오프라인 번들 | `invalid`·`issues`·`failed` |

공통 옵션은 `--project`(기본 현재 디렉터리)·`--json`(MCP 구조화 출력과 같은 객체)·`--out`·`--step-summary`(GitHub Actions 요약)·`--fail-on`·`--lang ko|en`(응답 언어, v1.2) 이고, 나머지는 도구 파라미터와 같은 이름(kebab-case)입니다. 종료 코드는 0 통과 · 2 기준 초과 · 3 실행 실패 · 64 사용법 오류입니다.

**CI 설정 파일 만들기** — 같은 게이트를 세 플랫폼에 만들어 줍니다.

```text
generate_egovframe_ci(projectDir, platform="github"|"gitlab"|"jenkins", supplyChain=true, secureCoding=true, delivery=true, supplier="○○기관", failOn="supplyChain:C")
```

SBOM → 최소 요소 점검 → 보안약점 → 평가서 순서로 실행하고 보고서·SBOM·SARIF 를 아티팩트로 남깁니다. `delivery=true` 면 끝에 납품 패키지(`egovframe-delivery/`)를 만들어 함께 보관합니다. GitHub 는 SARIF 를 code scanning 에 올립니다. 생성 파일은 공식 스키마 검증을 거치고, CI 통합 테스트에서 실제 Jenkins LTS 와 gitlab-ci-local 로 끝까지 실행해 확인합니다. `npmRegistry`·`offlineBundle` 로 사내 레지스트리와 폐쇄망 번들을 지정합니다.

**폐쇄망에서 쓰기** <a id="폐쇄망에서-쓰기"></a>

인터넷 PC 에서 번들을 만들어 옮기면 다운로드와 OSV 조회가 번들에서 이뤄집니다.

```bash
npx -y egovframe-scaffold-mcp bundle --output-dir ./egov-bundle --write                       # ≈110MB
npx -y egovframe-scaffold-mcp bundle --output-dir ./egov-bundle --templates web,boot-web --write   # 템플릿 골라 담기
export EGOVFRAME_OFFLINE_BUNDLE=/opt/egov-bundle    # 폐쇄망 PC (cmd: setx EGOVFRAME_OFFLINE_BUNDLE D:\egov-bundle)
```

번들에는 OSV Maven 전체 덤프, 공통컴포넌트 v5.0.7 아카이브, Initializr 템플릿 zip, 공식 태그 미러가 sha256 manifest 와 함께 들어갑니다. 파일은 쓸 때마다 manifest 와 대조하고, OSV 스냅숏이 30일(`EGOVFRAME_BUNDLE_MAX_AGE_DAYS`)을 넘으면 결과에 경고합니다. 컨테이너 기반 이미지는 번들에 없으므로 사내 레지스트리로 반입합니다. 네트워크 문제는 `diagnose_egovframe_network`(CLI `network`)가 호스트별 도달 여부와 처방을 냅니다.

### 감리·PM (결과물 읽기)

| 산출물 | 어디서 | 읽는 법 |
|---|---|---|
| **납품 패키지** | `deliver --write` / `prepare_egovframe_delivery` | 아래 산출물이 한 디렉터리에 들어 있고 `index.md` 가 목차입니다. `delivery-manifest.json` 의 `rootHash` 가 패키지 전체의 지문이라 공문에 한 줄로 인용할 수 있고, `deliver --verify` 로 받은 그대로인지 확인합니다. 차수 간 변화는 `diff.md` 에 있습니다 |
| **전환 준비도 평가서** | `assess` / `generate_egovframe_report(sections=["assessment"])` | 6절의 **전환 난이도**(수동 항목·재조립 대상·제거된 API 참조·좌표 세대)와 **공급망 상태**(기준 미만·취약점·보안 설정) 두 등급. A=문제 없음 … D=사업 계획 필요. 요인별 점수와 구간이 표로 나와 근거를 추적할 수 있습니다 |
| **SBOM** | `sbom` → `sbom-check` | CycloneDX 1.6(기본) 또는 SPDX 2.3. 점검 결과의 "제출 가능/보완 필요"는 NTIA 최소 요소 7종(공급자·구성요소명·버전·고유식별자·의존관계·작성자·생성 시각) 기준입니다. 차수 간 비교(`baselinePath`)로 추가·제거·새 취약점을 설명하고, VEX 초안으로 취약점 판단(영향 없음 등)을 기록합니다 |
| **보안약점 결과** | `secure` / `check_egovframe_secure_coding` | 개발보안 가이드(2021) 구현단계 항목별 건수와 등급(높음·중간·낮음), 파일·라인·CWE·조치. 공통컴포넌트 **원본**에서 나온 것은 업그레이드 대상, **수정본**·프로젝트 코드는 직접 조치입니다. 패턴 기반 보조 진단이며 공인 진단을 대체하지 않습니다 |
| **의존성 조치 목록** | `check` / `check_egovframe_dependencies` | 공식 5.x parent 기준으로 기준 미만(`outdated`)·전환 대상(`legacy`)·교체 필요(`replace`)를 나누고, `offline=false` 면 OSV 취약점 ID 를 붙입니다 |

모든 결과는 Markdown(사람용)과 JSON(`--json`, 구조화 출력)으로 받을 수 있어 감리 양식에 옮기거나 대시보드에 넣을 수 있습니다.

## 도구 목록 (37종)

파라미터와 동작 상세는 [docs/tools.md](docs/tools.md) 에 있습니다.

| 단계 | 도구 |
|---|---|
| 생성·조립 | `create_egovframe_project` · `list_egovframe_templates` · `apply_egovframe_recipe` · `list_egovframe_recipes` · `add_egovframe_components` · `remove_egovframe_components` · `add_ai_components` · `generate_egovframe_crud` · `generate_egovframe_config` |
| 카탈로그·문서 | `list_egovframe_components` · `search_egovframe_components` · `explain_egovframe_component` · `get_egovframe_guide` · `search_egovframe_docs` · `sync_egovframe_catalog` · `sync_egovframe_templates` |
| 빌드·진단 | `build_egovframe_project` · `test_egovframe_project` · `validate_egovframe_project` · `diagnose_egovframe_project` · `diagnose_egovframe_network` · `generate_agents_md` |
| 5.x 전환·유지 | `migrate_egovframe_project` · `rehearse_egovframe_migration` · `reassemble_egovframe_components` · `upgrade_egovframe_project` |
| 납품 점검 | `check_egovframe_dependencies` · `generate_egovframe_sbom` · `check_egovframe_sbom` · `fix_egovframe_dependencies` · `check_egovframe_secure_coding` · `fix_egovframe_secure_coding` · `generate_egovframe_report` · `prepare_egovframe_delivery` |
| 배포·CI·폐쇄망 | `generate_egovframe_deploy` · `generate_egovframe_ci` · `prepare_egovframe_offline_bundle` |

MCP 리소스(`egovframe://catalog/...`)로 카탈로그를 도구 호출 없이 읽을 수 있고, 프롬프트 `scaffold_board_login`·`scaffold_ai_chatbot`·`scaffold_portal`·`maintain_existing` 이 자주 쓰는 흐름을 안내합니다. 모든 도구에 `readOnlyHint`·`destructiveHint` 등 annotations 가 있어 클라이언트가 위험한 도구를 구분합니다.

## 지원 범위와 제약

- 공식 자산에 고정됩니다: 공통컴포넌트 v5.0.7, Initializr 템플릿 22종(commit·sha256 고정), RTE 5.0.2 규칙. 표준프레임워크 5.1.0 은 GitHub 태그 없이 저장소에만 배포된 상태라(2026-10) parent 5.1.0 프로젝트의 의존성 판정과 `target="5.1.0"` 갱신만 지원하고, 그 근거는 저장소 sources jar 비교입니다(기본 목표는 5.0.2). 최신 main 의 변화는 `sync_egovframe_catalog`·`sync_egovframe_templates` 로 확인한 뒤 릴리스에서 반영합니다.
- 기존 `pom.xml`·`web.xml` 의 구조적 병합은 하지 않습니다(프로젝트별 설정 보호). 좌표 탐지와 마커 구간 삽입까지만 합니다.
- 빌드·테스트·리허설·SBOM(Maven 플러그인)은 로컬의 JDK 와 Maven/Gradle(또는 래퍼)을 씁니다.
- 5.x 전환 적용은 정적 텍스트 치환입니다. 리플렉션·문자열로 만든 클래스명, 프로젝트 밖 라이브러리 안의 `javax` 는 수동 항목으로 남습니다. 자바 패키지 디렉터리 이동은 하지 않습니다.
- 보안약점 점검은 정적 패턴이라 오탐·미탐이 있습니다. 공인 진단 도구의 보조로 쓰세요.
- 템플릿·컴포넌트를 받을 때 `codeload.github.com`·`raw.githubusercontent.com`·`media.githubusercontent.com`, 빌드에 `maven.egovframe.go.kr`·Maven Central, 취약점 조회에 `api.osv.dev` 에 접근합니다. 막혀 있으면 폐쇄망 번들을 쓰세요.

## 버전 정책

1.0.0 부터 [SemVer 2.0](https://semver.org/lang/ko/) 을 따릅니다. **공개 API** 는 도구 이름과 입력 파라미터, 구조화 출력 16종의 필드, CLI 명령과 종료 코드, 환경 변수 `EGOVFRAME_*` 6종, 지원 Node 버전입니다. 이것을 지우거나 호환되지 않게 바꾸면 MAJOR, 더하면 MINOR, 버그 수정·데이터 갱신·문구는 PATCH 입니다. Markdown 응답 문구와 카탈로그 데이터의 내용은 공개 API 가 아니라 PATCH 에서도 바뀔 수 있습니다. 폐기할 파라미터는 옛 이름을 경고와 함께 계속 받다가 다음 MAJOR 에서만 지웁니다(현재: `check_egovframe_secure_coding` 의 `top` → `topN`, 2.0.0 제거). 계약 테스트가 매 릴리스에서 변경 등급과 버전 증가 폭을 맞춰 봅니다. 자세한 기준은 [docs/versioning.md](docs/versioning.md) 입니다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/tools.md](docs/tools.md) | 도구 37종 파라미터·동작·예시, MCP 리소스·프롬프트 |
| [docs/versioning.md](docs/versioning.md) | 버전 정책, 공개 API 범위, 폐기 절차 |
| [CHANGELOG.md](CHANGELOG.md) | 버전별 변경 이력 |
| [docs/development.md](docs/development.md) | 로컬 개발, 검증 체계, 릴리스 절차, 브랜치 보호 (기여자용) |
| [docs/planning.md](docs/planning.md) | 버전별 기획 원문·결과·선행 조사 기록(저장소 문서, npm 패키지에는 넣지 않음) |
| 설계 노트 | [응답 영문화·진행 알림](docs/design-i18n.md) · [납품 패키지](docs/design-delivery.md) · [전환](docs/design-migration.md) · [의존성 점검](docs/design-dependency-check.md) · [평가서](docs/design-assessment-report.md) · [보안약점](docs/design-secure-coding.md) · [배포](docs/design-deploy.md) · [멀티 모듈·MSA](docs/design-workspace.md) · [CLI·CI](docs/design-cli.md) · [오프라인 번들](docs/design-offline-bundle.md) · [AI 컴포넌트](docs/design-ai-components.md) · [CRUD](docs/design-crud-generation.md) · [설정 생성](docs/design-config-generation.md) · [템플릿 조달](docs/design-initializr-zip-templates.md) · [카탈로그 동기화](docs/design-catalog-sync.md) · [components 파라미터](docs/design-components-parameter.md) |

## 기여

이슈와 PR 을 환영합니다. 규칙·카탈로그는 데이터이므로 `catalog/*.json` 과 생성 스크립트(`scripts/generate-*.mjs`)를 함께 고치고, `npm run prepublishOnly` 가 통과해야 합니다. 공개 API 를 바꾸면 `npm run api-contract:update` 로 계약 스냅샷을 갱신해 PR 에 포함합니다. 자세한 절차는 [docs/development.md](docs/development.md) 입니다.

보안 취약점은 공개 이슈 대신 GitHub 비공개 제보(Security → Report a vulnerability)로 알려 주세요 — [SECURITY.md](SECURITY.md).

## 라이선스

[Apache License 2.0](LICENSE)
