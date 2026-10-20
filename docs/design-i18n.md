# 응답 영문화와 진행 알림 설계 (v1.2)

## 1. 문제

- 도구 설명(`tools/list`)은 v0.31 부터 `EGOVFRAME_LANG=en` 으로 영문이 되지만, 응답 본문(평가서·전환·의존성·SBOM 점검·보안약점·배포·납품 결과)은 한국어뿐이어서 해외 협력사·영문 클라이언트가 결과를 읽기 어려웠습니다.
- 리허설·오프라인 번들·`resolve=true` 점검·SBOM·빌드·테스트·납품 패키지처럼 수 분 걸리는 도구는 끝날 때까지 아무 보고가 없어 클라이언트가 멈춘 것인지 알 수 없었고, 중간에 그만둘 방법도 없었습니다(`notifications/progress` 송신 0건).

## 2. 응답 언어

### 2.1 선택

| 경로 | 지정 | 우선순위 |
|---|---|---|
| MCP 서버 | 환경 변수 `EGOVFRAME_LANG=en` (클라이언트 설정의 `env`) | — |
| CLI | `--lang ko\|en` | `--lang` > `EGOVFRAME_LANG` > 기본 `ko` |
| 라이브러리 | `setLang("en")` / `getLang()` / `langFromEnv(env)` (`dist/index.js` export) | 호출 시점의 전역 값 |

`en` 이 아닌 값은 모두 `ko` 입니다(`fr` 같은 다른 언어는 범위 밖). CLI 는 실행이 끝나면 이전 언어로 되돌리므로 같은 프로세스에서 여러 번 불러도(테스트·임베드) 서로 영향이 없습니다.

### 2.2 구현 — 사전 파일 대신 `L(ko, en)`

기획은 렌더러별 사전(`src/i18n/*.ts`)이었지만 **문자열이 쓰이는 자리에 두 언어를 나란히 두는 쪽**을 택했습니다(`src/lang.ts`).

```ts
import { L, tr } from "./lang.js";
out.push(L(`## 항목별`, `## By item`));
out.push(L(`- **높음 ${h} · 중간 ${m}**`, `- **high ${h} · medium ${m}**`));
```

- 사전 키를 따로 관리하면 키 이름·누락·순서가 어긋나기 쉽고, 템플릿 보간이 있는 문장은 사전에 넣기 어렵습니다. `L()` 은 보간을 양쪽에 그대로 두고 diff 에서 ko·en 을 한 줄로 같이 봅니다.
- 모듈 상단의 라벨 상수(`STATUS_LABEL` 등)는 모듈 로드 시 한 번 평가되므로 **getter·함수**로 바꿔 실행 시점의 언어를 따르게 했습니다(그렇지 않으면 `setLang` 이 반영되지 않음).
- 대상 렌더러: 전환(`migrate`·`update`), 의존성, 평가서(`report`·`assessment`), SBOM 생성·점검, 보안약점(SARIF 포함), 배포·멀티 모듈 배포, 납품 패키지·검증, 리허설, CLI 요약·오류·usage. 도구 설명·파라미터 설명(`describe`)은 기존 `src/i18n.ts` 경로 그대로입니다.
- 공식 문서 검색 결과(원문 한국어), 프로젝트 파일에서 인용한 원문, 고유명사(공통컴포넌트 이름 등)는 번역하지 않습니다.

### 2.3 규칙 데이터 — `<필드>_en`

규칙 카탈로그의 문장 필드는 큐레이션 파일에 영문을 **같은 객체의 `<필드>_en`** 으로 둡니다. 렌더러는 `tr(obj, "reason")` 으로 읽고, `en` 인데 `reason_en` 이 없으면 한국어로 떨어집니다(빈 문자열이 되지 않음).

| 파일 | 필드 |
|---|---|
| `catalog/migration-mapping.json` → `migration-rules.json` | `reason_en`·`replacement_en`(제거 클래스·라이브러리·XML 네임스페이스·제거 모듈), `note_en`(벤더 좌표·Jakarta 좌표·버전 속성), `defaultReason_en`(공통컴포넌트), `evidence_en` |
| `catalog/update-mapping.json` → `update-rules.json` | `summary_en`·`reason_en`(5.x 변경), `note_en` |
| `catalog/secure-coding-rules.json` | `guideItem_en`·`message_en`·`fix_en`·`note_en`(상향·하향 사유), `disclaimer_en`, 출처 `name_en` |
| `catalog/sbom-rules.json` | `hint_en`·`basis_en`, 출처 `name_en` (요소 라벨은 기존 `labelEn`) |
| `catalog/deploy-rules.json` | `reason_en`(미지원 사유), `note_en`(런타임·인프라), `externalDatabases_en` |

- `scripts/generate-migration-rules.mjs` 는 큐레이션에 `_en` 이 빠지면 **실패**합니다(`requireEn`). `generate-update-rules.mjs` 는 큐레이션 객체를 그대로 옮기므로 `_en` 이 따라갑니다.
- `test/i18n.mjs` 가 일곱 파일을 모두 걸어 한국어 문장 필드마다 `_en` 이 있는지(그리고 거기에 한글이 없는지) 단언합니다 — 규칙 데이터의 `_en` 누락 0.

### 2.4 검증 — goldens

`test/i18n.mjs` (`npm run test:i18n`)

1. **ko 바이트 일치**: 고정 프로젝트 2개(`test/fixtures/i18n-fixture.mjs` — 3.10 레거시, 5.x 프로젝트)로 17개 출력(Markdown 11종 + 문장 필드 6종)을 만들어 `test/fixtures/i18n-golden-ko.json` 과 바이트 단위로 비교합니다. goldens 는 **영문화 전 코드**로 생성했으므로 "영문화가 한국어 출력을 바꾸지 않았다"는 증명입니다. 경로·소요 시간·버전·UUID·임시 디렉터리만 가립니다(Windows 경로 구분자 포함).
2. **en 한글 없음**: 같은 호출을 `en` 으로 다시 실행해 모든 줄에 한글이 없어야 합니다.
3. 언어 전환 API 와 CLI `--lang`·`EGOVFRAME_LANG` 우선순위·복원.

렌더러 문구를 **의도적으로** 바꿀 때만 `npm run i18n:golden` 으로 goldens 를 다시 만들고 PR 에서 diff 를 검토합니다. Markdown 문구는 공개 API 가 아니므로([버전 정책](versioning.md)) MINOR 안에서 바뀔 수 있습니다.

## 3. 진행 알림과 취소

### 3.1 프로토콜

- 클라이언트가 `tools/call` 의 `_meta.progressToken` 을 주면 서버가 `notifications/progress { progressToken, progress, total?, message }` 를 보냅니다(MCP 2025-11-25 안정 기능). 토큰이 없으면 아무것도 보내지 않습니다.
- 클라이언트의 `notifications/cancelled` 는 SDK 가 핸들러의 `extra.signal`(AbortSignal) 로 넘깁니다. 응답은 보내지 않습니다(SDK 가 버림).
- `tasks`(비동기 실행)는 SDK 1.32.1 에서도 `experimental/tasks` 아래라 보류를 유지합니다.

### 3.2 구현 — `src/progress.ts`

모듈은 MCP SDK 를 모르고 `Progress` 하나만 받습니다. `server.ts` 가 `progressFromExtra(extra)` 로 만들어 넘기고, CLI·라이브러리 호출은 생략(noop)합니다.

```ts
interface Progress { report(message: string, done: number, total?: number): void; readonly signal?: AbortSignal }
```

| 도우미 | 용도 |
|---|---|
| `stepper(progress, steps)` | 정해진 단계 목록 — `step(i)` 는 i번째 시작(취소도 확인), `finish()` 는 `total/total` |
| `subProgress(parent, from, to, total, prefix?)` | 상위 한 구간을 하위 작업이 0..n 으로 쓰게 함(납품 패키지 항목 3/7 안의 SBOM 단계 → 3.0~4.0) |
| `throwIfAborted(signal)` | 단계 경계에서 취소 확인 → `AbortError`(name `"AbortError"`) |
| `collectProgress()` | 테스트용 — 이벤트를 배열로 |

| 도구 | 단계 |
|---|---|
| `build_egovframe_project` · `test_egovframe_project` | 명령 시작 0/1 → 종료 1/1 |
| `check_egovframe_dependencies(resolve=true)` | 모듈마다 `dependency tree (module x)` |
| `generate_egovframe_sbom` | 모듈별 플러그인 실행(또는 Gradle 트리) → enrich → OSV → SPDX 변환 → 쓰기(해당 단계만) |
| `reassemble_egovframe_components` | 출처 식별 → 파일 분류 → 대상 파일 가져오기 → 쓰기 → (verify) 컴파일 |
| `rehearse_egovframe_migration` | 프로젝트 복사 → `steps` 에 있는 단계(재조립·전환 적용·컴파일·pom 정렬 컴파일) |
| `prepare_egovframe_offline_bundle` | 아티팩트 다운로드(항목마다 `download i/N`) → 원본 태그 미러 → 번들 쓰기 |
| `prepare_egovframe_delivery` | 항목마다 한 단계(하위 도구는 `subProgress`) → `write package` |

`progress` 는 단조 증가하고 메시지는 짧은 영문(언어 설정과 무관 — 클라이언트 UI 의 상태 줄용)입니다. dryRun 은 알림을 내지 않습니다(리허설·재조립의 계획 단계처럼 실제 작업이 있는 경우 제외).

### 3.3 취소

- `Runner`(`build-runner.ts`)가 `signal` 을 받아 **프로세스 트리**를 끝냅니다 — 기존 타임아웃 종료 경로(POSIX 프로세스 그룹 SIGKILL, Windows `taskkill /T /F`, 파이프 유예 2초)를 그대로 쓰고 결과에 `aborted: true` 를 돌려줍니다. 호출자는 이를 `AbortError` 로 바꿔 던집니다.
- 오프라인 번들의 `fetch` 는 타임아웃용 `AbortController` 를 취소 신호에도 연결하고, `git` 자식은 `kill()` 합니다.
- **파일은 되돌아갑니다**: `withFileTransaction`·`withDirectoryTransaction` 이 `AbortError` 를 감싸지 않고 롤백 뒤 그대로 다시 던집니다(재조립). 리허설은 복사본에서만 일하므로 작업공간만 지웁니다. 납품 패키지는 항목이 모두 끝난 뒤에야 스테이징을 만들므로 취소 시 출력이 없습니다. 오프라인 번들은 `.partial-*` 스테이징을 지웁니다.
- 실패한 항목을 결과에 기록하는 코드(납품 항목·리허설 단계·재조립 컴파일)는 `AbortError` 만은 삼키지 않고 전달합니다.

### 3.4 검증

| 테스트 | 내용 |
|---|---|
| `test/progress-runners.mjs` | 실제 자식 프로세스를 200ms 뒤 취소 → `aborted`, pid 소멸; `runBuild`·`runTests`·`resolveDependencyTree`·`checkDependencies(resolve)`·`generateSbom` 의 단계 순서·단조 증가·취소 시 `AbortError` |
| `test/progress-tools.mjs` | 납품·재조립·리허설·오프라인 번들의 단계 순서, 하위 진행 분수, 취소 뒤 부분 출력 없음·프로젝트 트리 해시 불변·작업공간 삭제 |
| `test/progress-mcp.mjs` | MCP 경계 — in-memory 클라이언트가 `progressToken` 으로 알림을 순서대로 받음, 토큰 없으면 없음, `notifications/cancelled` 로 가짜 `mvnw`(node 스크립트) 트리가 3초 안에 끝남 |

`npm run test:progress` 가 셋을 차례로 실행하고 `prepublishOnly` 에 들어 있습니다.
