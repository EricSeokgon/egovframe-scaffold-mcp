# 보안약점 점검 설계 (`check_egovframe_secure_coding`, v0.44)

## 1. 문제

행정안전부·한국인터넷진흥원 「전자정부 SW 개발·운영자를 위한 소프트웨어 개발보안 가이드」(2021 개정)는 설계단계 보안요구 20개와 구현단계 보안약점 49개를 두고, 정보시스템 감리 대상 사업에 적용됩니다. 납품 전 보안약점 진단에서 지적된 항목은 그대로 재작업이 됩니다.

v0.43 까지 이 서버는 의존성(기준·OSV)과 보안 설정(`sec.security`·CSRF·XSS 필터·보안 헤더)만 보고, 소스 코드의 패턴은 보지 않았습니다.

## 2. 범위

- **대상**: 구현단계 49개 중 **정적 패턴으로 오탐을 통제할 수 있는 항목**(현재 규칙 20종, 가이드 항목 14개)입니다.
- **방식**: 데이터 흐름(taint) 분석을 하지 않습니다. 결과에는 "공인 진단도구·진단원을 대체하지 않는 진단 보조"라고 적습니다.
- **목적**: 진단 전에 고칠 목록을 만들고, CI 에서 새로 생기는 패턴을 막는 것입니다.

## 3. 규칙은 데이터 (`catalog/secure-coding-rules.json`)

규칙마다 다음 필드를 둡니다.

| 필드 | 뜻 |
|---|---|
| `guideItem`·`category`·`cwe` | 가이드 항목 이름·7개 유형(입력데이터 검증 및 표현·보안기능·시간 및 상태·에러처리·코드오류·캡슐화·API 오용)·CWE |
| `severity` | 기본 등급(high·medium·low) |
| `targets` | `java`·`jsp`·`mapper`(MyBatis)·`sqlmap`(iBATIS)·`config`(`.properties`·`.yml`, 메시지 번들 제외) |
| `pattern`·`unless` | 줄 단위 정규식과 제외 조건(앞의 `(?i)` 는 대소문자 무시) |
| `fileHas`·`fileLacks` | 파일 전체 조건. 예: 보호 설정(`disallow-doctype-decl` 등)이 있으면 XXE 아님 |
| `downgrade`·`escalate`·`requireNear` | 주변 줄 조건. ORDER BY 다음의 `${}` 는 medium, 요청 파라미터와 같은 줄의 명령 실행은 high, 보안 문맥(token·password…)일 때만 난수 |
| `stripCustomTags` | JSP 접두어 태그(`<c:if test=…>`·`<spring:message code=…>`)를 지운 뒤 찾기. 태그 속성 안의 EL 은 출력되지 않음 |
| `scope: "file"` | 여러 줄 패턴(빈 `catch`) |

## 4. 오탐 통제

실측에서 확인한 사례를 규칙과 픽스처(`test/secure-coding.mjs`)로 고정했습니다.

- **주석**
  - Java 주석은 문자열·문자·텍스트 블록을 존중하는 작은 렉서로, 줄 수와 길이를 유지한 채 공백으로 바꿉니다.
  - XML 은 `<!-- -->` 를 지웁니다. 공식 공통컴포넌트 매퍼의 `${…}` 96건(v4.3.2)은 **전부** "`${searchKeyword}` 를 `#{searchKeyword}` 로 변경" 같은 주석이었습니다.
  - JSP 는 `<%-- --%>` 만 지웁니다. HTML 주석 안의 JSTL·EL 은 서버에서 실행되어 응답에 나가기 때문입니다.
- **XSS**
  - `<c:out value="${param.x}"/>` 와 `fn:escapeXml(param.x)` 는 안전합니다.
  - `<c:out value="</tr>" escapeXml="false"/>` 처럼 값이 상수이면 제외합니다.
  - 속성 값의 따옴표 안에 있는 `>`(`'<br/>'`)를 처리합니다. 이것을 놓치면 공식 공통컴포넌트의 `escapeXml="false"` 362건 중 170건을 놓칩니다.
- **비밀번호**
  - 코드: 파라미터 이름·세션 키·경로 상수(`PASSWORD_PARAM = "password"`, `..._URL = "/uss/pwd/…"`)와 `${…}` 자리표시자는 제외합니다.
  - 설정: `ENC(…)`, 숫자 값(`ExpirePwdDay = 180`), 가림(`*****`), 자리표시자(`YOUR_CLIENT_SECRET`), 주석, 메시지 번들은 제외합니다.
- **테스트 코드**(`src/test`): 찾되 등급을 low 로 낮추고 출처를 `test` 로 표시합니다.

## 5. 출처

공통컴포넌트 매니페스트(`.egovframe-components.json`)의 파일별 해시로 출처를 나눕니다.

| 출처 | 판정 | 안내 |
|---|---|---|
| `component` | 매니페스트 해시와 같음(upstream 원본) | 공통컴포넌트 업그레이드로 해결되는지 확인, 아니면 사유를 남겨 예외 처리 또는 upstream 보고 |
| `component-modified` | 해시 다름 | 직접 수정 |
| `component-unmanaged` | `egovframework/com/` 경로지만 매니페스트 없음 | `reassemble_egovframe_components` 로 재조립하면 원본·수정본이 구분됨 |
| `project` · `test` | 그 밖 | 직접 수정 |

실측으로 보면 upstream 업그레이드의 효과가 큽니다. 같은 규칙으로 v4.3.2 트리는 516건, v5.0.7 전체 트리는 38건입니다. 예를 들어 `escapeXml="false"` 는 304건에서 6건으로, 디버그 출력은 155건에서 7건으로 줄었습니다.

## 6. 예외·비교·SARIF

- **예외** (`.egovframe-secure-ignore.json`)
  - 형식: `{"ignores":[{"rule","path"(glob),"line"?,"reason","reviewer"}]}`
  - 사유(5자 이상)와 검토자가 없으면 그 항목은 적용하지 않고 목록으로 돌려줍니다. 감리에서 "왜 예외인가"에 답할 수 있게 하려는 것입니다.
- **지문**
  - `규칙|파일|정규화한 코드 줄|같은 줄 순번` 의 sha256 앞 32자입니다.
  - 줄이 밀려도 같은 항목으로 봅니다. `baselinePath` 는 이 도구의 JSON 결과와 SARIF(`partialFingerprints["egovframe/v1"]`)를 모두 읽습니다.
- **SARIF 2.1.0**
  - 규칙에 `security-severity`(8.0/5.0/2.0)와 `external/cwe/cwe-N` 태그를 붙이고, CWE taxonomy 를 함께 냅니다.
  - OASIS 공식 스키마(draft-04, 테스트 고정물)로 검증합니다.
  - GitHub code scanning 은 이 SARIF 를 그대로 받습니다. GitLab 의 보안 대시보드는 자체 형식만 받기 때문에 아티팩트로만 보관합니다.

## 7. 연결

- **평가서**: 4절(보안)에 높음·중간·낮음, 출처, 항목 상위 6개를 넣습니다. 등급 산식에는 넣지 않습니다(패턴 기반이라 확정 판정이 아님).
- **회귀 코퍼스**: 공식 공통컴포넌트 v3.10.0·v4.3.2 의 규칙별 건수를 `catalog/migration-corpus.json` 기대값(±1%)으로 고정합니다.
- **CLI**: `secure`(지표 `high`·`medium`·`low`·`total`·`new`, `--sarif-path`).
- **CI**: `generate_egovframe_ci(supplyChain=true, secureCoding=true)` 가 sbom-check 다음에 `secure --fail-on high` 단계를 넣습니다.
  - GitHub 는 `upload-sarif` 를 `continue-on-error` 로 둡니다. Advanced Security 가 없는 비공개 저장소에서도 게이트 판정이 흔들리지 않게 하려는 것입니다.
  - GitLab·Jenkins 는 SARIF 를 보관합니다.

## 8. 범위 밖

- 설계단계 20개
- 데이터 흐름 분석
- 자동 수정(조치 예시까지)
- 가이드 49개 중 패턴으로 근거 있게 잡기 어려운 항목(부적절한 인가, TOCTOU, Null 역참조 등)
