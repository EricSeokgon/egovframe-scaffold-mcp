# 기관 규칙 팩 설계 (`EGOVFRAME_RULE_PACKS`, v1.23.0)

## 1. 문제

보안약점(23종)·운영 점검(20종)·의존성 기준·개인정보 사전은 모두 동봉 데이터이고, 프로젝트가 할 수 있는 것은 예외 파일(`.egovframe-*-ignore.json`)로 끄는 것뿐입니다. 기관·사업자는 자체 기준이 있습니다 — 금지 라이브러리, 사내 최소 버전, 추가 보안 규칙, 세션 시간 같은 임계값, 기관의 컬럼 이름 규칙과 암호화 솔루션. 포트폴리오(v1.17)로 수십 개 프로젝트를 한 표에 놓을 때 기준이 기관과 다르면 표가 쓸모없습니다.

## 2. 형식

팩은 디렉터리 하나이고 `rule-pack.json` 이 있어야 합니다. 절은 그 자리에 쓰거나 같은 디렉터리의 JSON 파일 이름으로 가리킵니다(`"secureCoding": "secure-coding.json"`).

```json
{
  "schemaVersion": 1,
  "name": "moj-standard",
  "version": "2026.11",
  "description": "기관 개발 표준",
  "secureCoding": {
    "rules": [{ "id": "org-catch-generic-exception", "guideItem": "포괄 예외 처리", "category": "error", "cwe": 396, "severity": "low",
                "targets": ["java"], "pattern": "catch\\s*\\(\\s*Exception\\s+\\w+\\s*\\)", "message": "…", "fix": "…" }],
    "severity": { "print-stack-trace": "high" },
    "disable": ["debug-code"]
  },
  "operations": {
    "rules": [{ "id": "org-open-in-view", "category": "database", "severity": "medium", "title": "JPA open-in-view 켜짐",
                "check": { "kind": "line", "targets": ["properties", "yaml"], "pattern": "(?i)^\\s*spring\\.jpa\\.open-in-view\\s*[=:]\\s*true" },
                "message": "…", "fix": "…", "basis": "기관 표준 3.2" }],
    "thresholds": { "session-timeout": { "maxMinutes": 30 }, "upload-limits": { "maxBytes": 20971520 } },
    "disable": ["no-production-profile"]
  },
  "dependencies": {
    "banned": [{ "groupId": "org.hsqldb", "artifactId": "hsqldb", "reason": "운영 배포본에 내장 DB 금지", "replacement": "기관 표준 DBMS 드라이버" }],
    "minimum": [{ "groupId": "org.apache.commons", "artifactId": "commons-text", "version": "1.10.0", "reason": "CVE-2022-42889" }]
  },
  "privacy": {
    "items": [{ "id": "employee-no", "grade": "general", "label": "사번", "columns": "EMPL_NO|EMP_NO" }],
    "cryptoCalls": ["OrgCipher\\s*\\.\\s*seal"], "sqlCryptoFunctions": ["XX1\\.ENC_VARCHAR2"], "maskCalls": []
  }
}
```

| 절 | 할 수 있는 것 | 결과에 남는 것 |
|---|---|---|
| `secureCoding` | 규칙 추가·같은 id 덮어쓰기(`pattern`·`unless`·`fileHas`·`fileLacks`·`scope`), `severity` 조정, `disable` | 항목·`byRule` 의 `source` |
| `operations` | 규칙 추가(check 종류 `line`·`lacks`·`pom`), `thresholds`(`session-timeout.maxMinutes`·`upload-limits.maxBytes`), `severity`, `disable` | 점검표·항목의 `source` |
| `dependencies` | `banned`(좌표, `artifactId` 없으면 groupId 전체, `versionBelow` 면 그 미만만) → `replace`, `minimum` 미만 → `outdated` | 항목의 `source`·사유 |
| `privacy` | `items`(컬럼 사전, 같은 id 덮어쓰기 — 동봉 사전보다 먼저 대조), 암호화·SQL 암호화·마스킹 호출 사전 추가 | 컬럼의 `rulePack` |

## 3. 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 지정 | 도구 파라미터 `rulePacks`(디렉터리 배열) 또는 환경 변수 `EGOVFRAME_RULE_PACKS`(OS 경로 구분자). 파라미터가 있으면 환경 변수는 보지 않음 | 기관은 MCP 클라이언트 설정·CI 에 환경 변수 하나로, 시험할 때는 파라미터로 |
| 얹는 방식 | 동봉 규칙은 그대로 두고 팩을 순서대로 적용 — **뒤 팩이 이김**. id 가 같으면 덮어쓰고 새 id 는 추가 | 기관 팩 위에 사업 팩을 얹는 두 단계가 흔하다 |
| 팩 없음 | 결과에 `rulePacks`·`source` 필드가 아예 없음 | 기존 사용자의 출력이 바뀌지 않는다(게이트가 확인) |
| 데이터만 | 정규식·좌표·숫자·문장. 보안약점의 데이터 흐름(`flow`)·근접 조건(`downgrade` 등)과 운영의 내장 check 종류(`session-timeout`·`upload`·`profile`·`secrets`·`egov-security`)는 팩 규칙에 쓸 수 없음 | 임의 코드 실행이 없다. 내장 종류는 규칙 id 와 묶인 전용 판정이라 임계값만 연다 |
| 검증 | 로드할 때 형식·알 수 없는 키·정규식 컴파일(2,000자 이하)·id 형식과 중복·분류·대상·check 종류·없는 규칙을 가리키는 `severity`/`disable`/`thresholds`·좌표·버전을 보고, 문제를 **전부** 모아 거부 | 한 번에 고칠 수 있게. 잘못된 팩으로 조용히 덜 점검하는 것이 가장 나쁘다 |
| 실패 | 팩이 잘못되면 점검 도구가 실행되지 않고 `RulePackError` | 기준이 빠진 결과를 "통과"로 읽지 않게 |
| 지문 | 팩 파일 전부의 sha256(줄바꿈 정규화). 결과의 `rulePacks[]` 에 이름·버전·sha256·절 — 경로는 넣지 않음 | 평가서·납품 패키지·포트폴리오에서 어떤 기준으로 본 것인지 대조. 경로는 사람마다 다르다 |
| 허용 루트 | 팩 경로도 `EGOVFRAME_ALLOWED_ROOTS` 검사를 받음. 절이 가리키는 파일은 팩 디렉터리 안의 `.json` 이름만, 파일당 2MB 이하 | 팩이 다른 곳의 파일을 읽는 통로가 되지 않게 |
| 평가서 | `assessment.rulePacks` 와 머리말 한 줄. 네 점검에 같은 팩 | 등급 산식은 그대로이고 입력(건수)만 달라진다 |
| 포트폴리오 | 행에 `rulePacks`(이름 버전), 모두 같으면 "같은 기준" 안내, 다르면 비교 전에 경고 | 다른 기준으로 본 등급을 나란히 놓는 실수를 막는다 |
| 목록 | 새 도구 `list_egovframe_rules`(CLI `rules`, 읽기 전용): 적용 중인 규칙·출처·끈 규칙, 팩 검증 | 팩을 만든 사람이 적용 결과를 확인하는 곳. CI 에서 `rules` 가 0 으로 끝나면 팩이 유효 |
| 생성 CI | `generate_egovframe_ci(rulePacks="<경로>")` → 게이트 단계의 `EGOVFRAME_RULE_PACKS` | 저장소 안 상대 경로 또는 러너의 절대 경로 |

범위 밖: 팩 배포·서명 체계(기관 Git·사내 저장소에 두면 충분), 원격 URL 에서 받기, 전환·갱신 규칙의 팩화(근거 검증이 필요한 생성 데이터), 사내 BOM 가져오기(`minimum` 목록으로 대신), 납품 패키지 매니페스트의 팩 항목(동봉 평가서에 들어 있음).

## 4. 알아 둘 것

- 운영 점검의 `rules` 파라미터는 동봉 규칙 id 만 받습니다(입력 스키마의 enum). 팩 규칙은 `rules` 를 주지 않을 때 함께 돕니다.
- `fix_egovframe_secure_coding`·`externalize_egovframe_config` 처럼 동봉 규칙의 판정을 재사용하는 조치 도구는 팩의 영향을 받지 않습니다(고치는 범위가 팩으로 바뀌지 않게).
- 의존성의 `minimum` 은 동봉 판정이 `legacy`·`replace` 인 좌표를 바꾸지 않습니다(전환이 먼저).
- 개인정보 팩 항목은 동봉 사전보다 먼저 대조합니다. 등급은 동봉 4종 중에서 고릅니다.

## 5. 검증

- 게이트 `test:rule-packs`(31단언, 오프라인): 경로 해석, 팩 없음 = 그대로, 네 절의 추가·덮어쓰기·등급·끄기·임계값과 출처, 여러 팩의 우선순위, 파일로 가리킨 절, 잘못된 팩의 사유 전부, 허용 루트, 환경 변수, 평가서·포트폴리오, 규칙 목록·CLI, 생성 CI, MCP.
- CI 통합 `test:rule-packs-live`(27단언): 예시 팩(보안 규칙 1·세션 임계값 30분·금지 좌표 hsqldb)을 공식 템플릿 6종에 적용 — 팩 규칙 항목 수(simple-backend 4·simple-homepage 9·enterprise-business 10, 보고한 줄을 원본에서 독립 확인), 세션 규칙 상태 변화(simple-backend·portal-site·enterprise-business 통과 → 미달), 금지 좌표 6종 모두 1건, 동봉 규칙의 결과는 그대로. 포트폴리오 여섯 행에 팩 이름.
