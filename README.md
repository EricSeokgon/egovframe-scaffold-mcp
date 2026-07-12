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
| `list_egovframe_components` | 선택 설치 가능한 공통컴포넌트 카탈로그 (저장소 스캔 자동 생성, 68종) |
| `add_egovframe_components` | 공통컴포넌트 선택 조립 — 의존성 포함 소스·매퍼·JSP 복사, **컴포넌트별 선별 DDL·DML 생성**(`database`), 충돌 시 전체 거부, `dryRun` 미리보기 |
| `search_egovframe_components` | 키워드로 컴포넌트 검색 (id·이름·설명, 점수순 상위 10건) |
| `remove_egovframe_components` | 설치 매니페스트 기반 컴포넌트 제거 — 의존 컴포넌트 보호, `dryRun` 미리보기 |
| `validate_egovframe_project` | 조립 프로젝트 무결성 진단 — 파일 존재·DbType↔DB 스크립트 일치 |
| `get_egovframe_guide` | 컴포넌트의 공식 가이드 문서 조회 (egovframe-docs, 45종 매핑) |
| `add_ai_components` | **(신규, M1 미리보기)** 공식 [egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플 기반 AI RAG 챗봇 조립 — Spring AI(Redis Stack)·LangChain4j(PGVector) 스택 선택, 파일 복사 계획·pom 의존성 diff·호환성 진단 (설계: [docs/design-ai-components.md](docs/design-ai-components.md)) |

### create_egovframe_project 파라미터

- `projectName` — 프로젝트명(artifactId). 소문자·숫자·하이픈 (예: `my-egov-app`)
- `groupId` — 자바 groupId (예: `egovframework.example`)
- `database` — `hsql`(기본) | `mysql` | `oracle` | `altibase` | `tibero` (템플릿 `Globals.DbType` 지원 값)
- `template` — `simple-backend`(기본, Spring Boot REST) | `simple-react`
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

## 검증

- 함수 레벨: 실제 템플릿(약 296파일) 생성, pom 좌표·DbType 적용, 중복 생성 거부, `dryRun` 미리보기(무기록) 확인 (`npm run smoke`)
- 카탈로그 레벨: 무결성(중복 id·의존 존재)·위상 정렬·순환 감지·미리보기 검증 (`npm run test:catalog`, 네트워크 불필요)
- 조립 레벨: 실제 공통컴포넌트 저장소로 bbs+login(+cmm) 조립, 파일 복사·DB 스크립트·충돌 전체 거부 검증 (`npm run test:components`)
- 수명주기 레벨: 설치 매니페스트 기록, 중복 설치 거부, 의존 컴포넌트 제거 보호, 제거·검증 동작 (`npm run test:components`)
- 프로토콜 레벨: MCP initialize / tools/list 핸드셰이크 및 `ref`·`dryRun` 파라미터 노출 확인

## PoC 범위와 한계 (알려진 제약)

- 자바 패키지 구조 변경(groupId에 맞춘 소스 디렉터리 이동)은 미지원 — IDE rename refactoring 권장
- 공통컴포넌트 선택 조립(253종 중 선택 설치)은 로드맵 항목 — 현재는 공식 템플릿 단위 생성
- 네트워크로 GitHub(codeload.github.com) 접근 필요

## 로드맵 (제안)

1. 공통컴포넌트 선택 설치 — **M3 완료(v0.4.0)**: 저장소 스캔 기반 카탈로그 자동 생성(`npm run generate:catalog`, 68종) + 조립 파이프라인. 남은 항목: 컴포넌트별 테이블 선별 DDL, 이름·의존성 큐레이션 확대(`catalog/overrides.json` 기여 환영) (설계: [docs/design-components-parameter.md](docs/design-components-parameter.md))
2. 실행환경 보일러플레이트(egovframe-msa 등) 템플릿 추가
3. AI 컴포넌트 조립(`add_ai_components`) — **M1 완료(v0.8.0)**: AI 카탈로그(egovframe-ai-rag 스캔 자동 생성) + dryRun 미리보기(의존성 diff·호환성 게이트). M2(v0.9.0): 실조립(복사+pom 병합+설정 프로필화) (설계: [docs/design-ai-components.md](docs/design-ai-components.md))
4. 검증 후 eGovFramework 조직 공식 저장소 편입 제안

## 변경 이력

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
