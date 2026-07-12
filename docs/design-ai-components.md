# 설계 초안: AI 컴포넌트 조립 (`add_ai_components`)

> 로드맵 후속 도구 항목의 설계 문서입니다. 공식 [eGovFramework/egovframe-ai-rag](https://github.com/eGovFramework/egovframe-ai-rag) 샘플(Spring AI·LangChain4j RAG)을 기존 eGovFrame Boot 프로젝트에 조립하는 MCP 도구를 정의합니다. `add_egovframe_components`(설계: [design-components-parameter.md](design-components-parameter.md))와 동일한 안전 원칙(전체 사전 충돌 검사·원자적 거부·dryRun·매니페스트)을 따릅니다.

## 1. 목표

기존 eGovFrame Boot 프로젝트에 RAG 기반 AI 질의응답 기능(문서 업로드→임베딩→하이브리드 검색→LLM 응답, 채팅 UI 포함)을 대화 한 번으로 추가한다.

```
"내 프로젝트에 Spring AI 기반 RAG 챗봇을 붙여줘. 벡터 저장소는 Redis로."
→ add_ai_components({ projectDir: "...", stack: "spring-ai" })
```

## 2. 배경: 조립 소스와 호환성 근거

공식 `egovframe-ai-rag` 저장소는 동일 기능을 두 스택으로 구현한 샘플 2종을 제공한다 (2026-07 기준).

| 모듈 | AI 프레임워크 | 벡터 저장소 | 규모 |
|---|---|---|---|
| `spring-ai-rag-redis-stack` | Spring AI 1.0.1 | Redis Stack | main 50파일 + test 15파일 |
| `langchain4j-ai-rag-postgre` | LangChain4j 1.8.0 | PostgreSQL(PGVector) | main 54파일 + test 14파일 |

**조립 성립의 핵심 근거**: 두 샘플과 `egovframe-template-simple-backend`가 모두 부모 POM `egovframe-boot-starter-parent:5.0.0`(JDK 17, Spring Boot 3.5.6)을 공유한다. 즉 BOM 충돌 없이 의존성 추가만으로 같은 프로젝트에서 컴파일 가능하다. 공통 전제는 Ollama ≥ 0.17.1(CVE-2026-7482 회피)과 ONNX 임베딩 모델, Docker 기반 벡터 저장소다.

샘플 구성 요소(두 스택 공통 구조):

- **Java 소스** — `com.example.chat` 패키지: config(RAG 파이프라인·하이브리드 검색·RRF 융합), ETL(PDF·DOCX·HWP·HWPX·Markdown 리더, PII 마스킹 변환기), service/controller, 채팅 세션 관리
- **리소스** — `application.yml`(약 160줄), `log4j2-spring.xml`, `templates/chat.html` + `static/js/*`(채팅 UI)
- **인프라** — `docker-compose.yml`(벡터 저장소), `Dockerfile`, `k8s/*`
- **추가 의존성** — Spring AI 스택: `spring-ai-client-chat`·`spring-ai-rag`·`spring-ai-starter-vector-store-redis`·`spring-ai-starter-model-ollama`·`spring-ai-starter-model-transformers` 등 + `hwplib`·`hwpxlib`·`thymeleaf` / LangChain4j 스택: `langchain4j{,-ollama,-pgvector,-embeddings,-reactor}` + `data-jpa`·`webflux`·`postgresql` 등

## 3. 인터페이스 설계

```jsonc
{
  "name": "add_ai_components",
  "params": {
    "projectDir": "대상 프로젝트 경로 (필수)",
    "stack": "spring-ai",        // "spring-ai" | "langchain4j" (필수)
    "includeInfra": true,         // docker-compose·Dockerfile·k8s 복사 (기본 true)
    "includeUi": true,            // chat.html·static/js 채팅 UI 복사 (기본 true)
    "includeTests": false,        // 샘플 테스트 복사 (기본 false)
    "ref": "main",                // (선택) egovframe-ai-rag 브랜치/태그
    "dryRun": false               // 파일·의존성·설정 변경 미리보기
  }
}
```

- 두 스택은 같은 패키지(`com.example.chat`)·같은 UI 경로를 쓰므로 **상호 배타**다 — 카탈로그 `conflictsWith`로 선언하고, 이미 다른 스택이 설치돼 있으면 거부한다.
- 결과는 `AddComponentsResult`를 확장해 `dependencyChanges`(pom에 추가된 좌표 목록), `configFiles`, `nextSteps`(Ollama·ONNX·docker compose up 절차)를 구조화 반환한다.
- 검색·목록 노출: `list_egovframe_components` 응답에 `kind: "ai"` 항목으로 병합해 별도 목록 도구를 늘리지 않는다 (id: `ai-rag-spring-ai`, `ai-rag-langchain4j`).

## 4. AI 카탈로그 (`catalog/ai-components.json`)

공통컴포넌트 카탈로그와 소스 저장소가 다르므로 파일을 분리하되 스키마는 확장 형태로 유지한다.

```jsonc
{
  "schemaVersion": 1,
  "source": { "repo": "eGovFramework/egovframe-ai-rag", "branch": "main", "surveyedAt": "2026-07-12" },
  "components": [
    {
      "id": "ai-rag-spring-ai",
      "name": "AI RAG 챗봇 (Spring AI + Redis Stack)",
      "kind": "ai",
      "modulePath": "spring-ai-rag-redis-stack",
      "conflictsWith": ["ai-rag-langchain4j"],
      "requires": { "java": "17", "parent": "egovframe-boot-starter-parent:5.0.0" },
      "copyGroups": {
        "source":  ["src/main/java/com/example/chat/**"],
        "config":  ["src/main/resources/application.yml → src/main/resources/application-ai.yml", "src/main/resources/log4j2-spring.xml"],
        "ui":      ["src/main/resources/templates/chat.html", "src/main/resources/static/js/**"],
        "infra":   ["docker-compose.yml → docker-compose.ai.yml", "Dockerfile → Dockerfile.ai", "k8s/**"],
        "tests":   ["src/test/**"]
      },
      "mavenDependencies": [ /* pom.xml에서 추출한 좌표+exclusions 원문 */ ],
      "mavenProperties": { "spring-ai.version": "1.0.1" },
      "prerequisites": ["ollama>=0.17.1", "onnx-embedding-model", "docker"]
    }
    // ai-rag-langchain4j 동일 구조
  ]
}
```

- `mavenDependencies`는 샘플 pom에서 **exclusions 포함 원문**을 추출해 보존한다 (샘플은 log4j2 사용을 위해 전 의존성에서 `spring-boot-starter-logging`을 제외 — 이를 누락하면 로깅 이중화로 기동 실패).
- 카탈로그 생성은 `scripts/generate-catalog.mjs`에 `--ai` 모드를 추가해 자동화한다 (모듈 스캔 + pom 파싱).

## 5. 조립 파이프라인

기존 `addComponents` 파이프라인을 재사용하되, 공통컴포넌트에 없던 3단계(호환성 게이트·pom 병합·설정 프로필화)가 추가된다.

1. **호환성 게이트**: 대상 `pom.xml`의 parent 좌표·`java.version`을 `requires`와 대조. 불일치 시 명확한 오류(레거시 XML 템플릿·JDK 11 프로젝트는 거부하고 업그레이드 가이드 링크 안내). 매니페스트에서 `conflictsWith` 검사.
2. **다운로드**: `egovframe-ai-rag` zip 1회 다운로드·프로세스 캐시 (기존 로직 재사용, zip-slip 방지 동일).
3. **파일 복사**: `copyGroups` 중 옵션에 해당하는 그룹만 복사. 전체 사전 충돌 검사 후 하나라도 충돌하면 원자적 거부. 패키지는 `com.example.chat` **원본 유지** (공통컴포넌트의 `egovframework.com.*` 유지 원칙과 동일 — groupId 재배치는 미지원으로 README에 명시).
4. **pom 병합 (신규)**: 대상 pom을 파싱해 `mavenDependencies` 중 **누락된 좌표만** `<dependencies>`에 삽입, `mavenProperties` 동일 처리. 이미 있는 좌표는 버전이 달라도 건드리지 않고 보고만 한다(안전 우선). 병합 전 원본을 `pom.xml.bak-ai`로 백업.
5. **설정 프로필화 (신규)**: 샘플 `application.yml`(~160줄)은 대상 설정과 병합하지 않고 `application-ai.yml`로 복사한다. 실행은 `--spring.profiles.active=ai` (또는 기존 설정에 `spring.profiles.include: ai` 한 줄 추가를 nextSteps로 안내). 기존 설정 파일을 절대 수정하지 않는다.
6. **인프라 복사**: 루트 충돌 가능 파일은 접미사로 회피(`docker-compose.ai.yml`·`Dockerfile.ai`), `k8s/`는 `k8s/ai/`로.
7. **매니페스트·보고**: `.egovframe-components.json`에 `kind: "ai"`로 기록(→ `remove_egovframe_components`가 pom 삽입분·복사 파일을 함께 정리, `validate_egovframe_project`가 프로필 파일·의존성 존재를 진단). `nextSteps`: ① Ollama 설치·모델 pull ② ONNX 임베딩 모델 익스포트·배치 ③ `docker compose -f docker-compose.ai.yml up -d` ④ ai 프로필로 기동 ⑤ `/chat` 접속.

## 6. 단계별 범위

| 단계 | 범위 | 목표 |
|---|---|---|
| M1 | AI 카탈로그 스키마·생성 스크립트(`--ai`), `add_ai_components` dryRun(파일 계획·의존성 diff 미리보기), `list_egovframe_components` kind:"ai" 노출 | v0.8.0 (~7월 말) |
| M2 | 실제 조립: 복사 + pom 병합 + 프로필화 + 매니페스트, remove/validate 연동, 통합 테스트(`test:ai` — simple-backend 생성→spring-ai 조립→`mvn -q compile`) | v0.9.0 (~8월 중순) |
| M3 | langchain4j 스택 검증 완료, `includeTests`, k8s 그룹, 진단 확장(ONNX 모델 경로·docker 서비스 감지) | v0.10.0 |

리스크와 완화:

- **pom 병합은 첫 파일 수정 행위** (기존 도구는 복사만 했음) → 누락 좌표 삽입만 허용, 기존 항목 불변, 백업 생성, dryRun에 diff 제공으로 최소화.
- **업스트림 샘플 구조 변경** → 카탈로그에 `surveyedAt`·`ref` 고정, CI에서 주기적 재생성 검증. 설계 확정 후 `egovframe-ai-rag`에 이슈로 공유해 (#1120·#628 흐름과 동일하게) 업스트림 피드백을 받는다.
- **실행 전제(GPU·Ollama·Docker)가 무거움** → 도구는 어떤 것도 자동 실행하지 않고 조립+안내만 담당. dryRun과 nextSteps로 기대치를 명확히 한다.

## 7. 검증 계획

- 단위: AI 카탈로그 스키마 검증(CI, 네트워크 불필요), conflictsWith·requires 게이트, pom 병합(누락 삽입·기존 불변·exclusions 보존·백업)
- 통합(smoke): simple-backend 템플릿 생성 → `add_ai_components(stack: "spring-ai")` → `mvn -q compile` 통과 → remove 후 pom 원복 확인
- 프로토콜: tools/list에 신규 도구·파라미터 노출 확인

## 8. 열린 질문 (이슈 논의용)

1. 패키지 재배치 — `com.example.chat` 유지가 원칙이나, AI 샘플은 공통컴포넌트와 달리 "예제" 성격이 강해 groupId 재배치 요구가 클 수 있다. M3에서 옵션 제공할지.
2. `create_egovframe_project`에 `aiStack` 파라미터를 추가해 생성+조립을 한 번에 할지 (components 파라미터와 동일 패턴).
3. 프론트엔드(simple-react) 프로젝트에 채팅 UI만 조립하는 시나리오를 지원할지.
4. 업스트림에 "조립 가능한 모듈 구조"(패키지·설정 분리) 개선을 제안할지 — 채택되면 카탈로그가 대폭 단순해진다.
