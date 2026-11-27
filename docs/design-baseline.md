# 점검 기준선 설계 (`baselinePath`, v1.26.0)

## 1. 문제

v1.21–v1.25 로 점검이 다섯 갈래(보안약점·운영·개인정보·접근 통제·정합성)가 됐지만 CI 게이트로는 쓰기 어려웠습니다. 손대지 않은 공식 공통컴포넌트 v5.0.7 만으로 접근 통제 277건(높음 49)·보안약점 38·운영 17·개인정보 7·매퍼 4·정합성 39 가 나옵니다(v1.26.1 의 카탈로그 고정 커밋 `36abd0d` 기준). 도움말이 권하던 `--fail-on high>0` 은 첫날부터 실패하고, 예외 파일(`.egovframe-*-ignore.json`)은 사유·검토자를 한 건씩 적는 용도라 수백 건을 넣을 수 없습니다. 결국 게이트를 끄게 됩니다.

필요한 것은 "지금 있는 것은 목록으로 관리하고, **새로 생기는 것만 막는다**"입니다. 보안약점 점검에는 v0.44 부터 이 장치(`baselinePath`)가 있었고, 이번에 나머지 점검으로 넓혔습니다.

## 2. 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 기준선 파일 | 그 도구의 **이전 JSON 결과 그대로**(`format=json`, CLI `--json-out`) | 형식을 하나 더 만들면 계약만 늘어난다. 결과에는 항목의 위치·근거가 함께 있어 사람이 읽을 수도 있다 |
| 지문 | `sha256(점검 \| 규칙·종류 \| 프로젝트 상대 경로 \| 대상 \| 순번)` 앞 32자 | 줄 번호를 넣으면 위에 한 줄만 끼워도 전부 새 항목이 된다 |
| 대상 | 접근 통제 = 컨트롤러·메서드·URL / 개인정보 = 테이블.컬럼(없으면 코드 줄) / 매퍼 = 문장 ID / 정합성 = 문장 쌍·VO 필드 / 운영 = 설정 키(값 제외)·XML 태그 | 사람이 "같은 문제"라고 부르는 단위. 값이 바뀌어도(풀 크기 5 → 6) 여전히 미달이면 같은 항목 |
| 번역 문구 | 지문에 넣지 않음 | `EGOVFRAME_LANG=en` 으로 만든 기준선과 ko 실행이 맞아야 한다 |
| 같은 키 여러 건 | 나온 순서대로 순번 | 오버로드된 핸들러·같은 문장을 두 번 부르는 DAO |
| 종류가 바뀐 항목 | 해결 1 + 새 항목 1 | `missing-ownership`(중간) → `sibling-mismatch`(높음) 처럼 등급이 오르는 재분류는 다시 봐야 한다 |
| 이름·경로가 바뀐 항목 | 해결 1 + 새 항목 1 | 파일 이동을 따라가려면 내용 비교가 필요하고 오판이 생긴다. 기준선을 다시 만들면 된다 |
| 잘못된 기준선 | 다른 도구의 결과·지문 없는 옛 결과(v1.25 이하)·JSON 아님 → **오류** | 조용히 "전부 새 항목"이나 "전부 통과"가 되면 게이트를 믿을 수 없다 |
| 잘린 기준선 | 알림(`notes`) — `validate` 는 `maxIssues` 로 넉넉히 | 잘린 뒤의 항목이 새 항목으로 보인다 |
| 기준선과 예외 파일 | 역할이 다르다 — 기준선은 "아직 판단하지 않은 것", 예외는 "판단한 것"(사유·검토자) | 기준선에 사유를 요구하면 수백 건을 못 넣고, 예외에 사유를 안 받으면 감리 근거가 없다 |
| 의존성 점검 | 기준선을 넣지 않음 | 취약점은 새로 공개되는 것이 핵심이라 가리면 안 된다. SBOM 비교·VEX 가 그 역할 |
| 보안약점 점검 | 지문 계산식·SARIF 기준선 그대로 | 이미 커밋된 기준선이 그대로 맞아야 한다(회귀 테스트로 고정) |

## 3. 쓰는 법

```text
# 1) 기준선 만들기(저장소 루트, 결과를 커밋)
npx -y egovframe-scaffold-mcp access   --project . --json-out .egovframe/baseline/access.json
npx -y egovframe-scaffold-mcp privacy  --project . --json-out .egovframe/baseline/privacy.json
npx -y egovframe-scaffold-mcp ops      --project . --json-out .egovframe/baseline/ops.json
npx -y egovframe-scaffold-mcp validate --project . --max-issues 5000 --json-out .egovframe/baseline/validate.json
npx -y egovframe-scaffold-mcp secure   --project . --json-out .egovframe/baseline/secure.json

# 2) 게이트 — 새 항목이 있으면 종료 코드 2
npx -y egovframe-scaffold-mcp access --project . --baseline-path .egovframe/baseline/access.json --fail-on "new>0"

# 3) CI 에 넣기 — 운영·개인정보·접근 통제·정합성 단계가 더해지고 secureCoding 이면 보안약점도 기준선과 비교
generate_egovframe_ci(projectDir, supplyChain=true, secureCoding=true, baselineDir=".egovframe/baseline")

# 4) 평가서 — 점검 절마다 새 항목·해결·그대로
generate_egovframe_report(projectDir, sections=["assessment"], baselineDir=".egovframe/baseline")
```

- 결과: 항목마다 `fingerprint`·`isNew`, 요약 `new`(기준선이 없으면 `null`), `baseline { path, findings, resolved }`. Markdown 은 비교 한 줄과 🆕 표시.
- `baselinePath` 는 프로젝트 상대 경로입니다. `.egovframe/` 처럼 점으로 시작하는 디렉터리는 점검이 읽지 않습니다.
- 항목을 고친 뒤 기준선을 다시 만들면 목록이 줄어듭니다. 새 항목을 받아들이기로 했다면 기준선을 다시 만들어 커밋합니다(그 변경이 리뷰에 보입니다).
- 기준선 파일은 결과 전체라 큽니다(공통컴포넌트 전체의 접근 통제 결과 ≈ 590KB). 읽는 것은 `findings[].fingerprint`(validate 는 `mapper.issues`·`consistency.issues`)와 결과 종류를 가리는 몇 개 필드뿐입니다.

## 4. 함께 바뀐 것

- **CLI**: `ops`·`privacy`·`access` 에 지표 `new`, `validate` 에 `mapperNew`·`consistencyNew`·`new`(둘의 합), `assess` 에 `new`(평가서가 비교한 점검의 합). 요약 한 줄에 "새 항목 N · 해결 M".
- **생성 CI**(`baselineDir`): 세 플랫폼의 게이트에 `ops`·`privacy`·`access`·`validate` 단계(`--fail-on "new>0"`), 보고서 보관. 기준선을 만드는 명령은 결과 안내에 나옵니다. 기준선 파일이 없으면 그 단계는 실행 실패(3)입니다.
- **평가서**(`baselineDir`): 그 디렉터리에 파일이 있는 점검만 비교해 절마다 한 줄, 구조화 출력의 각 절에 `baseline { path, previous, new, resolved }`.
- **포트폴리오**: 기준선과 비교한 평가서면 행에 `newFindings`, CSV 열 추가, 분포 절에 합계.
- **납품 패키지 차수 비교**: `privacy`·`access` 항목이 두 차수 모두에 있으면 새 항목·해소 건수(`diff.json` 의 `checks`). v1.26 이전 패키지는 지문이 없어 건너뛰고 이유를 남깁니다.

## 5. 검증

- 게이트 `test:baseline`(75단언, 오프라인): 지문 계산식 고정, 줄 삽입·응답 언어에 흔들리지 않음, 이름 변경 = 해결 1 + 새 항목 1, 고치면 해결, 기준선 읽기 오류 여섯 가지, 보안약점 지문 불변, CLI 종료 코드, 생성 CI 세 플랫폼과 `baselineDir` 검증, 평가서·포트폴리오·납품 비교, MCP 출력 스키마.
- CI 통합 `test:baseline-live`(25단언): 공통컴포넌트 v5.0.6 결과를 기준선으로 v5.0.7 을 점검.

  | 점검 | v5.0.6 | v5.0.7 | 새 항목 | 해결 |
  |---|---|---|---|---|
  | 운영 | 17 | 17 | 1 | 1 |
  | 개인정보 | 7 | 7 | 0 | 0 |
  | 접근 통제 | 343 | 277 | 39 | 105 |
  | 매퍼 | 11 | 4 | 0 | 7 |
  | 정합성 | 85 | 39 | 0 | 46 |

  새 항목·해결 건수는 지문을 쓰지 않고 항목의 원래 필드로 계산한 집합 차와 같습니다. (v1.26.1 에서 옮겨진 v5.0.7 태그 기준으로 다시 잰 값입니다. v1.26.0 의 표본 `7912e13` 에서는 접근 통제 283건·새 항목 42·해결 102, 매퍼 10건·해결 1 이었습니다.) 접근 통제의 새 항목 39건 중 19건은 같은 메서드가 다른 종류로 다시 분류된 것입니다(형제 핸들러에 소유권 검증이 생기면서 `missing-ownership` → `sibling-mismatch`).
- 같은 테스트에서: v5.0.7 의 Java·XML·설정·SQL 4,800개 파일 위에 줄을 끼워 넣은 사본은 다섯 갈래 모두 새 항목 0·해결 0. 손대지 않은 코드는 기준선이 있으면 생성 CI 의 게이트 네 단계를 통과하고(기준선 없이 `high>0` 이면 높음 49건으로 실패), 검증 없는 삭제 핸들러 하나를 넣으면 접근 통제 단계만 종료 코드 2. 기준선 비교로 늘어나는 시간은 20ms 안팎(핸들러 1,206개).

## 6. 한계

- 파일을 옮기거나 메서드 이름을 바꾸면 해결 1 + 새 항목 1 로 보입니다.
- 운영 점검에서 설정 키가 없는 항목(예: "업로드 상한 키 없음")은 규칙·파일로만 구분합니다.
- 기준선은 "새로 생긴 것"만 막습니다. 원래 있던 높음 항목은 평가서·납품 패키지에서 계속 보이고, 줄여 가는 것은 사람의 일입니다.
