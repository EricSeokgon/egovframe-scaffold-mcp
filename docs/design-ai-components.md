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

## 9. 5.1.0 AI 모듈 기준 조립 (v1.20)

### 문제

이 문서의 조립은 공식 `egovframe-ai-rag` 샘플(Spring AI 1.0.1)을 복사한다. 5.1.0 parent 는 Spring AI 1.1.8(`-egov.1` 재빌드)·LangChain4j 1.18.1 을 관리하므로 5.1.0 프로젝트에 샘플을 넣으면 버전이 섞이고, 샘플이 직접 구현한 문서 추출·마스킹·가드는 5.1.0 에서 실행환경 모듈(`egovframe-rte-ai-core` + 어댑터 `ai-springai`·`ai-langchain4j`)이 됐다. 샘플 저장소는 2026-11 현재 5.1.0 모듈을 쓰지 않는다.

### 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 선택 | `base`: `auto`(기본 — Boot parent 5.1.0 이상이면 `rte-ai`) · `sample` · `rte-ai` | 5.0.x 프로젝트의 동작은 그대로. 5.1.0 에서 샘플을 원하면 명시 |
| 방식 | 복사가 아니라 **생성**(`catalog/ai-rte/` 의 템플릿 3개 + `EGOV-AI.md`), 컴포넌트 id `ai-rte-<stack>` | 공식 부품을 잇는 얇은 코드(약 250줄)라 프로젝트가 읽고 고칠 수 있다. 매니페스트·pom 마커·제거는 기존 AI 조립과 같은 규약 |
| 패키지 | `@SpringBootApplication` 클래스의 패키지 아래 `.ai` | 컴포넌트 스캔에 걸리도록. 못 찾으면 거부 |
| 벡터 저장소 | 두 스택 모두 **PGVector** | 어댑터의 재색인 라이터는 필터 삭제를 요구한다 — Spring AI `SimpleVectorStore` 는 실행환경 코드가 명시적으로 거부한다. PostgreSQL 은 공공에서 흔하고 core 의 어휘 검색(pg_trgm)과 같은 DB |
| 모델 | OpenAI 호환 클라이언트를 직접 구성(`spring-ai-openai`·`langchain4j-open-ai`, 스타터·자동구성 없음) | 폐쇄망의 Ollama·vLLM·사내 게이트웨이에 그대로 붙고, 자동구성 조건·속성 이름 변화에 묶이지 않는다 |
| 설정 | `@Value("${egov.ai.x:${EGOV_AI_X:기본}}")` — 설정 파일을 만들지 않음 | 비밀값이 소스·설정에 들어갈 자리가 없다(v1.13 외부화와 같은 방향) |
| 지연 연결 | 모델·저장소 Bean 은 `@Lazy` + `ObjectProvider` | 저장소가 없어도 앱이 뜬다(첫 AI 요청에서 실패) |
| 가드 | 서비스가 `EgovPromptInjectionGuard.inspect` 를 **검색보다 먼저** 호출 | 막힌 질의가 임베딩·검색·모델 호출을 쓰지 않는다. 어드바이저·가드레일을 함께 걸면 감사 로그가 두 번 남아 하나만 |
| 문서 조각의 위치 | 시스템 프롬프트(사용자 메시지에는 질문만) | 문서 안 문구가 사용자 지시처럼 읽히지 않게 |
| 임시 파일 이름 | 원래 이름의 SHA-256 앞 16바이트(ASCII), 표시용 `file_name` 은 원래 이름으로 | 문서 식별자가 파일 이름에서 나오므로 같은 이름이면 같은 식별자(재색인 정리). 한글 파일 이름을 못 쓰는 로캘(컨테이너 POSIX)에서 `InvalidPathException` 이 났다(실측) |
| 오류 응답 | 컨트롤러가 직접 JSON 400/500 | 공식 boot-web 은 `configureHandlerExceptionResolvers` 로 기본 해석기를 바꿔 `@ExceptionHandler` 가 동작하지 않는다(실측) |
| 파서 | `formats`(기본 hwp·hwpx·docx·pdf) 만 pom 에 | core 가 optional 로 두는 라이브러리 — 쓰지 않는 형식의 의존성·취약점 표면을 줄인다 |

### 기획과 달라진 점

- 벡터 저장소는 Redis Stack 을 빼고 PGVector 하나로(위 표). 어휘 검색·RRF 융합은 연결하지 않고 `EGOV-AI.md` 에 방법만 — 밀집 검색만으로 왕복을 검증했다.
- 모델 접속 설정은 `externalize_egovframe_config` 를 거치지 않고 처음부터 환경 변수로 생성한다.
- HWP·HWPX 표본 문서 실측은 하지 못했다(표본을 만들 도구가 없음) — 파서 의존성 추가와 컴파일, Markdown·DOCX 추출까지 확인.
- 이 작업 환경에서 표준프레임워크 Maven 저장소가 막혀 AI 모듈 jar 3종은 `egovframe-runtime` `5.1.x` 브랜치(`cd9938f`)를 직접 빌드해 썼다. CI 는 공식 저장소의 배포본을 받는다.

### 검증

- 게이트 `test:ai-rte`(36단언, 오프라인): base 판정, parent 게이트, 패키지 탐지, 계획·형식별 의존성, 조립(파일·pom 마커·매니페스트), 생성 코드 불변식(환경 변수 자리표시자만·한도 기본값·가드가 검색보다 먼저·마스킹·재색인 라이터), 재조립·배타 거부, 충돌·fault-injection 롤백, 제거 원복, 보안약점 AI 규칙 3종.
- CI 통합 `test:ai-rte-live`(27단언): 공식 boot-web 5.1.0 에 두 스택을 조립해 `mvn package` → PGVector(Docker)·OpenAI 호환 스텁으로 기동 → 색인(한글 이름 Markdown·DOCX, `[RRN]` 치환, 재업로드 시 행 수 유지) → 질의 왕복 → 인젝션 차단(모델 호출 0) → 감사 로그 → 400 응답 → 보안약점 규칙 → remove 원복.

## 10. AI 조립 보강 (v1.22)

### 문제

v1.20 조립물은 밀집(벡터) 검색만 연결했다. 공공 문서 질의에는 조문 번호·문서 번호·고유명사·약어가 많고 임베딩은 이것을 구별하지 못한다. 실행환경은 어휘 검색(pg_trgm)과 RRF 융합 부품을 이미 제공한다. 또 HWP·HWPX·PDF 는 실제 문서로 확인하지 못했고, 배포 산출물은 조립물을 몰랐고, `/ai/**` 는 "보안 설정에 넣으세요"라는 문장뿐이었다.

### 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 선택 | `search`: `dense`(기본) · `hybrid` | 기존 사용자의 생성물을 바꾸지 않는다. 설정 클래스는 v1.20 과 바이트 동일(게이트가 해시로 고정) |
| 템플릿 | `EgovAiConfig.hybrid.java.tpl`·`EgovAiRagService.hybrid.java.tpl` 을 따로 둔다 | 조건 분기 문법 없이 dense 템플릿을 그대로 둔다 |
| 어휘 채널 | `EgovPgTrgmLexicalSearch`(같은 PostgreSQL, 표·본문 컬럼은 저장소가 만든 것) | 저장소를 더 두지 않는다. RediSearch 구현도 있지만 저장소가 PGVector 다 |
| 조각 식별자 | 어휘 채널은 `metadata->>'id'` 를 돌려준다. LangChain4j 라이터는 이 값을 넣지만 Spring AI 쪽은 넣지 않아 색인 때 `metadata.id = 문서 id` 를 넣는다 | 두 채널의 키가 같아야 융합된다 — 다르면 어휘 결과가 모두 "없는 문서"가 된다 |
| 어휘 단독 조각 | 본문을 조회해 **포함**(Spring AI 는 JDBC 조회 람다, LangChain4j 는 `EgovJdbcSegmentLookup`), `rerankOnly` 를 쓰지 않음 | 임베딩이 놓친 문서를 찾는 것이 목적이다 |
| 연결 | 검색기 Bean 안에서 `JdbcTemplate`·`DataSourceTransactionManager` 를 만든다(Bean 으로 내놓지 않음) | 프로젝트의 `DataSource`·`JdbcTemplate`·트랜잭션 관리자 주입과 겹치지 않게. 임계값 설정(`set_config(…, true)`)은 같은 트랜잭션이어야 한다 |
| 스키마 | 첫 사용 때 `CREATE EXTENSION IF NOT EXISTS pg_trgm` + GIN 색인. `EGOV_AI_LEXICAL_INIT=false` 면 하지 않고 `EGOV-AI.md` 의 SQL 을 DBA 가 적용 | 실행환경 스키마 파일은 "DBA 가 명시적으로 적용"이 원칙이고 표 이름이 다르다 |
| 조정 | `EGOV_AI_LEXICAL_THRESHOLD`(0.3)·`EGOV_AI_LEXICAL_WEIGHT`(1.0) | pg_trgm 기본 임계값 0.6 은 질문 문장 안의 낱말 하나를 놓친다(실측) |
| 실패 | 어휘 채널 오류는 밀집 결과로 넘어가지 않고 전파(실행환경 검색기의 정책 그대로) | 확장이 없는 줄 모르고 운영하는 것을 막는다 |
| 추출 실패 | 문서가 0건이고 실패가 있으면 `IllegalArgumentException` → 400. 사유의 임시 파일 이름은 올린 이름으로 바꾼다. dense 에도 적용 | v1.20 은 200 + `failures` 에 임시 경로·예외 클래스가 나갔다(CWE-209). 이 한 군데가 dense 서비스 클래스의 v1.20 대비 차이다 |
| 접근 통제 | `detectAiAccessControl`: `SecurityFilterChain` Bean 이 있는 클래스 → 보안 스타터 의존성 → `spring-boot-starter-security` → 인증 인터셉터 → 없음. 조각은 `EGOV-AI.md` 에만 | 보안 설정은 역할·경로 규칙이 프로젝트마다 달라 쓰지 않는다. 대신 "어느 파일의 어디에"까지 가리킨다 |
| 배포 | `detectAiAssembly`(매니페스트의 `ai-rte-*`) → compose 에 `ai-db`(pgvector 이미지, `AI_PGVECTOR_IMAGE`)·`EGOV_AI_*`·`host.docker.internal`, Kubernetes 는 ConfigMap·Secret 자리만 | Kubernetes 는 기존 DB 와 같은 규약(기관 DB 를 가리키는 자리표시자). 조립물이 없으면 산출물이 그대로 |

### 기획과 달라진 점

- 오프라인 번들 `include` 에 PGVector 이미지를 넣지 않았다. 번들은 URL 로 받는 파일만 다루고 컨테이너 이미지는 범위 밖이다(v1.16 수집기 이미지와 같음).
- Kubernetes 에 PGVector 워크로드를 만들지 않고 자리표시자만 둔다.
- PDF 표본은 ASCII 본문이다(표준 14 글꼴은 한글을 담지 못하고 CI 에 한글 글꼴이 없다). 한글 추출은 HWP·HWPX·Markdown·DOCX 로 확인했다.
- dense 생성물은 "v1.20 과 바이트 동일"이 아니라 설정 클래스만 동일하다(서비스 클래스의 추출 실패 처리, `EGOV-AI.md` 의 접근 통제 절이 바뀜).

### 검증

- 게이트 `test:ai-hybrid`(32단언, 오프라인): dense 설정 클래스 해시(v1.20), hybrid 생성 코드 불변식, 추출 실패 처리, 접근 통제 판정 4종·조각, 배포 산출물 블록·조립물이 없을 때 그대로, remove 원복, MCP 파라미터.
- CI 통합 `test:ai-hybrid-live`(32단언): 두 스택 hybrid 로 `mvn package`·기동 → 임베딩이 같은 문서 6건과 문서 번호·조문 번호가 든 문서 1건 — 밀집 상위 4에 없음을 SQL 로 독립 확인한 뒤 질의 결과에 들어옴 → `test/fixtures/EgovSampleDocs.java` 로 만든 HWP·HWPX·PDF 추출·색인 → 2,001쪽 PDF·압축 폭탄 400 → 생성한 compose 로 앱 + `ai-db` 기동·색인·질의(spring-ai).
