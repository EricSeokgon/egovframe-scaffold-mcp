# egovframe-scaffold-mcp

[![CI](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/EricSeokgon/egovframe-scaffold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/egovframe-scaffold-mcp)](https://www.npmjs.com/package/egovframe-scaffold-mcp)

전자정부 표준프레임워크(eGovFrame) 프로젝트 스캐폴딩 **MCP(Model Context Protocol) 서버** — PoC

> [eGovFramework/egovframe-common-components#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 개념 증명(Proof of Concept) 구현입니다.
> [#628](https://github.com/eGovFramework/egovframe-common-components/issues/628)(eGovFrame MCP Server 제안)을 "프로젝트 생성" 단일 기능으로 구체화했습니다.

Claude, VS Code(Copilot), Cursor 등 MCP를 지원하는 AI 도구에서 **대화 중 즉시** 표준프레임워크
프로젝트 골격을 생성할 수 있습니다. eGovFrame IDE 설치 없이 공식 템플릿 기반으로 시작합니다.

## 제공 도구

| 도구 | 설명 |
|---|---|
| `create_egovframe_project` | 공식 템플릿을 내려받아 projectName(artifactId)·groupId·DB 타입을 적용한 새 프로젝트 생성 |
| `list_egovframe_templates` | 사용 가능한 공식 템플릿 목록 |
| `list_egovframe_components` | 선택 설치 가능한 공통컴포넌트 카탈로그 (저장소 스캔 자동 생성, **리프 174종 + 그룹 14종** — 리프는 서비스 단위, 그룹 id는 하위 일괄 설치) |
| `add_egovframe_components` | 공통컴포넌트 선택 조립 — 의존성 포함 소스·매퍼·JSP 복사, **컴포넌트별 선별 DDL·DML 생성**(`database`), 충돌 시 전체 거부, `dryRun` 미리보기 |
| `search_egovframe_components` | 키워드로 컴포넌트 검색 (id·이름·설명, 점수순 상위 10건) |
| `remove_egovframe_components` | 설치 매니페스트 기반 컴포넌트 제거 — 의존 컴포넌트 보호, `dryRun` 미리보기 |
| `validate_egovframe_project` | 조립 프로젝트 무결성 진단 — 파일 존재·DbType↔DB 스크립트 일치 |
| `get_egovframe_guide` | 컴포넌트의 공식 가이드 문서 조회 (egovframe-docs, 45종 매핑) |
| `add_ai_components` | 공식 [egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플 기반 AI RAG 챗봇 조립 — Spring AI(Redis Stack)·LangChain4j(PGVector) 스택 선택(상호 배타), 소스·설정(`application-ai.yml` 프로필)·UI·인프라 복사, **pom 누락 의존성만 마커 구간 삽입**(백업 생성, 제거 시 원복), 충돌 시 전체 거부, `dryRun` 미리보기 (설계: [docs/design-ai-components.md](docs/design-ai-components.md)) |
| `list_egovframe_recipes` | 큐레이션된 레시피(템플릿+컴포넌트 번들) 목록 |
| `apply_egovframe_recipe` | 레시피 하나로 생성→컴포넌트(→AI 계층)까지 순차 조립 (`dryRun` 지원) |
| `diagnose_egovframe_project` | 기존/레거시 프로젝트를 스캔해 빌드시스템·RTE 버전·DbType·설치 공통컴포넌트(pathPrefixes 지문)·설정 문제 진단 (읽기 전용) |
| `search_egovframe_docs` | 공식 가이드 문서(egovframe-docs) 인덱스를 키워드로 검색 — 제목·경로·연계 컴포넌트, 문서 URL·조립용 id 반환 (오프라인) |
| `generate_egovframe_report` | 프로젝트를 스캔해 설치 컴포넌트·참조 테이블·가이드 링크·이슈를 Markdown 리포트로 생성 (읽기 전용) |
| `upgrade_egovframe_project` | 설치 컴포넌트를 upstream과 3-way 비교해 갱신 — 사용자 수정 보존, dryRun 기본, 백업, 충돌 시 원자적 거부 (파괴적, 게이트) |
| `explain_egovframe_component` | 컴포넌트 하나의 상세(설명·직접/전이 의존성·역의존·참조 테이블·가이드 링크·설치 명령)를 한 번에 반환 (읽기 전용) |
| `generate_egovframe_ci` | GitHub Actions CI 워크플로(빌드·테스트) 생성 — maven/gradle 자동 감지, dryRun, 기존 파일 보호 |

### create_egovframe_project 파라미터

- `projectName` — 프로젝트명(artifactId). 소문자·숫자·하이픈 (예: `my-egov-app`)
- `groupId` — 자바 groupId (예: `egovframework.example`)
- `database` — `hsql`(기본) | `mysql` | `oracle` | `altibase` | `tibero` (템플릿 `Globals.DbType` 지원 값)
- `template` — `simple-backend`(기본, Spring Boot REST) | `simple-react` | `simple-homepage` | `portal-site` | `enterprise-business` | `web-sample` | `msa-edu`
  - 레거시 템플릿(simple-homepage·portal-site·enterprise-business·web-sample)은 `egovProps/globals.properties`의 `Globals.DbType`에 DB 타입을 적용합니다.
  - `msa-edu`는 멀티 프로젝트(backend/frontend/k8s)라 좌표·DB 자동 적용 없이 원본 그대로 생성하고 README 안내를 반환합니다.
- `outputDir` — 생성 위치 상위 디렉터리
- `ref` — (선택) 내려받을 브랜치/태그. 미지정 시 템플릿 기본 브랜치. 예: `main`, `v4.3.0`
- `dryRun` — (선택, 기본 `false`) `true`면 디스크에 쓰지 않고 생성 예정 파일 수·적용 설정만 미리보기

동작: 공식 템플릿 zip 다운로드 → 압축 해제(zip-slip 방지) → `pom.xml`의 groupId/artifactId/name 적용(부모 POM 좌표는 유지) → `application.properties`의 `Globals.DbType` 설정, 프론트엔드 템플릿은 `package.json`의 `name` 설정. 기존 디렉터리가 있으면 거부합니다. 다운로드에는 30초 타임아웃이 적용되어 무응답 시 무한 대기하지 않습니다. `dryRun`으로 먼저 안전하게 미리볼 수 있습니다.

## 설치·사용

[npm에 배포되어](https://www.npmjs.com/package/egovframe-scaffold-mcp) 설치 없이 바로 실행할 수 있습니다:

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

소스에서 직접 빌드하려면:

```bash
npm install
npm run build
```

Claude Desktop / Claude Code 설정 예 (`mcpServers`):

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "node",
      "args": ["/절대경로/egovframe-scaffold-mcp/dist/index.js"]
    }
  }
}
```

빌드 없이 실행하려면 (로컬 클론 후):

```json
{
  "mcpServers": {
    "egovframe-scaffold": {
      "command": "npx",
      "args": ["-y", "tsx", "/절대경로/egovframe-scaffold-mcp/src/index.ts"]
    }
  }
}
```

사용 예 (AI 도구에서):

> "표준프레임워크로 `my-egov-app` 프로젝트를 `~/work`에 만들어줘. groupId는 `egovframework.example`, DB는 mysql."


## 리소스·프롬프트 (MCP Resources/Prompts)

도구(tools)뿐 아니라 MCP의 리소스·프롬프트도 제공합니다 (MCP 3대 프리미티브 완비).

**Resources** (읽기 전용) — 지원 클라이언트에서 도구 호출 없이 카탈로그를 탐색·인용:
- `egovframe://catalog/components` · `egovframe://catalog/components/{id}` · `egovframe://catalog/templates` · `egovframe://catalog/recipes`

**Prompts** — 가이드형 워크플로: `scaffold_board_login`, `scaffold_ai_chatbot`

**레시피** — 자주 쓰는 조합을 한 번에 조립합니다. 예: `apply_egovframe_recipe(recipeId="board-login", projectName="my-egov-app", outputDir="~/work")`. 목록은 `catalog/recipes.json`에서 관리하며 기여 환영합니다.

## 검증

- 함수 레벨: 실제 템플릿(약 296파일) 생성, pom 좌표·DbType 적용, 중복 생성 거부, `dryRun` 미리보기(무기록) 확인 (`npm run smoke`)
- 카탈로그 레벨: 무결성(중복 id·의존 존재)·위상 정렬·순환 감지·미리보기 검증 (`npm run test:catalog`, 네트워크 불필요)
- 조립 레벨: 실제 공통컴포넌트 저장소로 bbs+login(+cmm) 조립, 파일 복사·DB 스크립트·충돌 전체 거부 검증 (`npm run test:components`)
- 수명주기 레벨: 설치 매니페스트 기록, 중복 설치 거부, 의존 컴포넌트 제거 보호, 제거·검증 동작 (`npm run test:components`)
- 프로토콜 레벨: MCP initialize / tools/list 핸드셰이크 및 `ref`·`dryRun` 파라미터 노출 확인

레시피 레벨: `catalog/recipes.json`의 컴포넌트 id 존재·의존성 정합 검증 (`npm run test:recipes`, 네트워크 불필요)
진단 레벨: 픽스처(pom·DbType·컴포넌트 패키지)로 `diagnose_egovframe_project`의 빌드·버전·DbType·컴포넌트 지문·의존성 검출 검증 (`npm run test:diagnose`, 네트워크 불필요)
문서 검색 레벨: `search_egovframe_docs`의 키워드 매칭·점수 정렬·컴포넌트 매핑·빈질의/미존재어 처리 검증 (`npm run test:docs`, 네트워크 불필요)
리포트 레벨: 픽스처로 `generate_egovframe_report`의 컴포넌트·테이블·가이드 링크 렌더링 검증 (`npm run test:report`, 네트워크 불필요)
업그레이드 레벨: 3-way 판정 6분류(unchanged/update/user-modified/conflict/added/removed)·v1 보수모드·매니페스트 부재 예외 검증 (`npm run test:upgrade`, 네트워크 불필요)
컴포넌트 설명 레벨: `explain_egovframe_component`의 의존성(직접·전이)·역의존·테이블·가이드 URL·미존재 예외 검증 (`npm run test:explain`, 네트워크 불필요)
CI 생성 레벨: `generate_egovframe_ci`의 maven/gradle 감지·YAML·dryRun 무기록·기존 파일 거부·빌드파일 부재 예외 검증 (`npm run test:ci`, 네트워크 불필요)
## PoC 범위와 한계 (알려진 제약)

- 자바 패키지 구조 변경(groupId에 맞춘 소스 디렉터리 이동)은 미지원 — IDE rename refactoring 권장
- 공통컴포넌트 선택 조립(253종 중 선택 설치)은 로드맵 항목 — 현재는 공식 템플릿 단위 생성
- 네트워크로 GitHub(codeload.github.com) 접근 필요

## 로드맵 (제안)

CI 생성·문서 deep 검색 — **완료(v0.19.0)**: `generate_egovframe_ci`로 CI 워크플로 생성, `search_egovframe_docs` fetchTop 스니펫.

컴포넌트 설명·워크플로 — **완료(v0.18.0)**: `explain_egovframe_component`로 컴포넌트 상세 일괄 조회, 포털·유지보수 프롬프트 및 AI 카탈로그 리소스 확장.

컴포넌트 업그레이드 — **완료(v0.17.0)**: `upgrade_egovframe_project`로 설치 컴포넌트 재동기화(안전 게이트: dryRun·백업·충돌 거부·사용자 수정 보존).

프로젝트 리포트 — **완료(v0.16.0)**: `generate_egovframe_report`로 설치 컴포넌트·테이블·가이드를 Markdown 문서화. (컴포넌트 재동기화 `upgrade`는 파괴적 변경이라 별도 버전에서 dryRun·백업 게이트와 함께 도입 예정.)

가이드 문서 검색 — **완료(v0.15.0)**: `search_egovframe_docs`로 문서 인덱스 키워드 검색 (MCP 패밀리 docs-mcp 씨앗).

레거시 프로젝트 진단 — **완료(v0.14.0)**: `diagnose_egovframe_project`로 기존 프로젝트의 구성·설치 컴포넌트·설정 문제를 스캔.

MCP 규격 완성 — **완료(v0.13.0)**: `tools`에 더해 `resources`·`prompts` 지원, 레시피(`list`/`apply`) 도구 2종 추가. MCP 3대 프리미티브 완비.

1. 공통컴포넌트 선택 설치 — **커버리지 확대 완료(v0.12.0)**: 리프 패키지 단위 174종 + 그룹 14종(기존 2단계 id 하위 호환, children 확장), Service Javadoc 기반 한글명 자동 추출(96종), 가이드 문서 매핑 151종. 이름·의존성 큐레이션은 `catalog/overrides.json` 기여 환영 (설계: [docs/design-components-parameter.md](docs/design-components-parameter.md))
2. 실행환경 보일러플레이트 템플릿 추가 — **완료(v0.11.0)**: simple-homepage·portal-site·enterprise-business·web-sample·msa-edu 5종 추가 (레거시 globals.properties DbType 적용, 멀티 프로젝트 안전 처리)
3. AI 컴포넌트 조립(`add_ai_components`) — **M3 완료(v0.10.0)**: 두 스택(spring-ai·langchain4j) 실조립 검증 + AI 실행 전제 진단. 남은 검토: 패키지 재배치 옵션([egovframe-ai-rag#65](https://github.com/eGovFramework/egovframe-ai-rag/issues/65) 피드백 대기) (설계: [docs/design-ai-components.md](docs/design-ai-components.md))
4. 검증 후 eGovFramework 조직 공식 저장소 편입 제안

## 변경 이력

- **0.19.0** — CI 생성 + 문서 검색 deep: `generate_egovframe_ci` 추가(프로젝트에 GitHub Actions 빌드·테스트 워크플로 생성, maven/gradle 자동 감지·dryRun·기존 파일 거부). `search_egovframe_docs`에 `fetchTop` 옵션 추가 — 상위 결과 문서 본문을 내려받아 스니펫 제공(기본 0=오프라인). 테스트(`npm run test:ci`) 추가. 기존 도구 하위 호환.

- **0.18.0** — 컴포넌트 설명 + 리소스/프롬프트 확장: `explain_egovframe_component` 추가 — 컴포넌트 하나의 설명·직접/전이 의존성·이 컴포넌트에 의존하는 컴포넌트·참조 테이블·가이드 링크·설치 명령을 한 번에 반환(읽기 전용). 리소스 `egovframe://catalog/ai-components` 추가, 프롬프트 `scaffold_portal`·`maintain_existing`(진단→리포트→업그레이드) 추가. 테스트(`npm run test:explain`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.17.0** — 컴포넌트 업그레이드: `upgrade_egovframe_project` 추가 — 매니페스트 설치 컴포넌트를 upstream 최신본과 3-way 비교(설치 기준선 해시·현재 디스크·upstream)해 갱신합니다. 사용자가 수정한 파일은 `force` 없이 보존, `dryRun` 기본(계획 미리보기), 덮어쓰기 전 `upgrade-backup/`에 백업, 하드 충돌 시 아무것도 쓰지 않고 거부. 매니페스트 스키마 v2(파일별 해시 기준선) — `add_egovframe_components`가 이후 설치본에 해시 기록. 오프라인 판정 테스트(`npm run test:upgrade`) 추가. 기존 도구·기존 매니페스트(v1) 하위 호환(해시 없으면 보수 모드).

- **0.16.0** — 프로젝트 리포트: `generate_egovframe_report` 추가 — 프로젝트를 스캔해 설치 공통컴포넌트·참조 테이블·가이드 문서 링크·이슈를 Markdown 리포트로 생성합니다(읽기 전용, `diagnose`+카탈로그+가이드 매핑 재사용). 조립 결과 문서화/README 첨부용. 테스트(`npm run test:report`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.15.0** — 가이드 문서 검색: `search_egovframe_docs` 추가 — 카탈로그 가이드 매핑(제목·경로·연계 컴포넌트·카테고리)을 키워드로 점수순 검색하고 문서 URL과 조립용 컴포넌트 id를 반환합니다. 오프라인 동작(네트워크 불필요). 테스트(`npm run test:docs`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.14.0** — 프로젝트 진단 도구: `diagnose_egovframe_project` 추가 — 기존(스캐폴딩 도구로 만들지 않은 것 포함) 프로젝트를 읽기 전용으로 스캔해 빌드시스템(maven/gradle)·eGovFrame RTE 버전·`Globals.DbType`·설치된 공통컴포넌트(카탈로그 `pathPrefixes` 지문 매칭)·AI 계층·매니페스트 유무를 파악하고, 의존성 누락·DbType 미설정 등 이슈와 다음 단계 제안을 리포트합니다. 픽스처 테스트(`npm run test:diagnose`) 추가. 기존 도구 불변(완전 하위 호환).

- **0.13.0** — MCP 리소스·프롬프트 + 레시피: `tools` 외에 `resources`(카탈로그·템플릿·가이드 읽기 전용 노출, 단일 컴포넌트는 resource template)와 `prompts`(`scaffold_board_login`·`scaffold_ai_chatbot`)를 지원해 MCP 3대 프리미티브를 완비. 레시피(`catalog/recipes.json`)와 `list_egovframe_recipes`·`apply_egovframe_recipe` 도구 추가 — 생성→컴포넌트→AI 계층 조립을 한 번에 오케스트레이션(각 단계 `dryRun` 전파·원자적 거부 계승). 정합성 테스트(`npm run test:recipes`) 추가. 기존 도구·카탈로그 불변(완전 하위 호환).

- **0.12.0** — 카탈로그 커버리지 확대(68 → **188항목**): 컴포넌트 단위를 2단계 패키지에서 **리프 패키지(서비스 단위, 최대 4단계)** 로 세분화해 리프 174종을 개별 선택 설치할 수 있습니다. 기존 2단계 id는 `children`을 가진 **그룹**으로 유지되어 하위 호환됩니다(그룹 요청 시 리프로 확장 설치, 그룹+리프 동시 요청 중복 제거). 리프 한글명은 Service 인터페이스 Javadoc에서 자동 추출(96종), 가이드 문서 매핑은 리프 우선으로 재계산(151종).

- **0.11.0** — 템플릿 확장: 공식 템플릿 2종 → **7종** (`simple-homepage`·`portal-site`·`enterprise-business`·`web-sample`·`msa-edu` 추가). 레거시 템플릿은 `egovProps/globals.properties`의 `Globals.DbType` 적용을 새로 지원, 멀티 프로젝트(`msa-edu`)는 좌표/DB 재작성을 건너뛰어 하위 모듈 참조를 보호. 템플릿별 빌드 안내(nextSteps) 분기, 통합 테스트(`npm run test:templates`) 추가.

- **0.10.0** — AI 컴포넌트 조립 M3: langchain4j 스택 실조립·제거 사이클 통합 검증(init-scripts/ai/·JPA 의존성·pom 원복), `validate_egovframe_project`에 **AI 실행 전제 진단(aiChecks)** 추가 — `application-ai.yml`의 ONNX 모델/토크나이저·임베딩 설정 경로를 `${user.home}`·환경변수 플레이스홀더까지 해석해 존재 확인, docker compose 기동 안내 (경고와 분리되어 ok 판정에 영향 없음).

- **0.9.0** — AI 컴포넌트 조립 M2(실조립): `add_ai_components`가 실제로 조립합니다 — 소스(`com.example.chat`)·설정(`application-ai.yml` 프로필, 기존 설정 불변)·UI·인프라(`docker-compose.ai.yml`·`Dockerfile.ai`·`k8s/ai/`) 복사(전체 사전 충돌 검사·원자적 거부), pom에 누락 좌표만 마커 주석 구간으로 삽입(exclusions 보존, `pom.xml.bak-ai` 백업), 매니페스트 기록으로 `remove_egovframe_components`가 파일·pom 삽입분을 함께 원복(바이트 단위 복원 검증), `validate_egovframe_project`에 pom 마커 진단 추가, 통합 테스트(`npm run test:ai-assembly`) 추가.

- **0.8.0** — AI 컴포넌트 조립 M1: `add_ai_components` dryRun 미리보기(파일 복사 계획·pom 의존성 diff·부모 POM 호환성 게이트·스택 상호 배타 검사), AI 카탈로그(`catalog/ai-components.json`, egovframe-ai-rag 모듈 스캔 자동 생성 `npm run generate:ai-catalog`), `list_egovframe_components`에 AI 컴포넌트 노출, 오프라인 테스트(`npm run test:ai`) 추가.

- **0.7.0** — `get_egovframe_guide`: 컴포넌트 id로 표준프레임워크 공식 가이드 문서(egovframe-docs)를 조회. 카탈로그에 문서 매핑 자동 생성(`--docs`, 지배적 패키지 참조 기준 45종) 추가. 한글명 큐레이션 12→27종.

- **0.6.0** — 컴포넌트별 테이블 선별 DDL(M4): 카탈로그에 매퍼 기반 참조 테이블 자동 추출(48/68종), `database` 지정 시 통합 스크립트에서 해당 컴포넌트 구문만 추출해 `ddl|dml/<컴포넌트id>.sql` 생성(테이블 미상 컴포넌트는 통합본 폴백), 매니페스트에 컴포넌트별 스크립트 귀속(제거 시 함께 정리).

- **0.5.0** — 조립 수명주기 완성: `search_egovframe_components`(키워드 검색), 설치 매니페스트(`.egovframe-components.json`) 기록, `remove_egovframe_components`(의존 보호·dryRun), `validate_egovframe_project`(파일 무결성·DbType↔DDL 일치 진단), 중복 설치 거부.

- **0.4.0** — 공통컴포넌트 선택 설치 M3: 저장소 구조 스캔으로 카탈로그 자동 생성(`scripts/generate-catalog.mjs`), 커버리지 3종 → 68종(2단계 패키지 단위, cmm 하위 통합). 이름·설명·의존성은 `catalog/overrides.json`으로 큐레이션(기본 의존성 휴리스틱: cmm).

- **0.3.0** — 공통컴포넌트 선택 설치 M2: `add_egovframe_components` 실제 조립 구현(의존성 포함 파일 복사, 전체 사전 충돌 검사 후 원자적 거부, zip-slip 방지, `database` 지정 시 DDL·DML 복사, zip 프로세스 캐시). 통합 테스트(`test:components`) 추가.

- **0.2.2** — 공통컴포넌트 선택 설치 M1: 컴포넌트 카탈로그(`catalog/components.json`, 대표 3종 cmm·bbs·login), `list_egovframe_components`·`add_egovframe_components`(dryRun 미리보기) 도구 추가, 카탈로그 오프라인 테스트 추가.

- **0.2.1** — 프론트엔드(simple-react) 템플릿의 `package.json` `name`을 프로젝트명으로 적용(백엔드는 기존대로 pom·DbType).
- **0.2.0** — 다운로드 타임아웃(30초), `ref`(브랜치/태그) 파라미터, `dryRun` 미리보기 모드 추가. `list_egovframe_templates`가 지원 DB 목록도 함께 반환.
- **0.1.0** — 최초 PoC: `create_egovframe_project`, `list_egovframe_templates`.

## 라이선스

Apache License 2.0
