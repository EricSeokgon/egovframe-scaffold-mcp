# 버전 정책 (v1.0.0 부터)

`egovframe-scaffold-mcp` 는 [SemVer 2.0](https://semver.org/lang/ko/) 을 따릅니다. 1.0.0 부터는 아래 **공개 API** 를 호환되지 않게 바꿀 때만 MAJOR 를 올립니다.

## 1. 공개 API

| 대상 | 계약에 들어가는 것 | 들어가지 않는 것 |
|---|---|---|
| MCP 도구 | 도구 이름. 입력 파라미터의 이름·타입·필수 여부·기본값·허용값·범위 | 도구 설명·제목·annotations(힌트) |
| 구조화 출력 | 출력 스키마가 있는 13종의 `structuredContent` 필드·타입·필수 여부. `format=json` 본문은 같은 객체입니다 | 출력 스키마가 없는 21종의 응답 본문 |
| CLI | 명령(`assess`·`check`·`sbom`·`sbom-check`·`secure`·`rehearse`·`bundle`·`migrate`·`validate`·`diagnose`·`network`)과 연결된 도구, 종료 코드(0 통과·2 `--fail-on` 초과·3 실행 실패·64 사용법 오류) | 사람이 읽는 stderr 한 줄 요약 |
| 환경 변수 | `EGOVFRAME_ALLOWED_ROOTS`·`EGOVFRAME_BUNDLE_MAX_AGE_DAYS`·`EGOVFRAME_CACHE_DIR`·`EGOVFRAME_LANG`·`EGOVFRAME_OFFLINE_BUNDLE` | — |
| 실행 환경 | 지원 Node 최소 버전(`package.json` 의 `engines.node`, 1.0.0 은 `>=22`) | — |

공개 API 가 **아닌** 것:

- **Markdown 응답 문구**: 라벨·문장·표 구성은 MINOR·PATCH 에서도 바뀔 수 있습니다. 기계로 읽으려면 구조화 출력(`--json`)을 쓰세요.
- **카탈로그·규칙·기준 데이터의 내용**: 공식 태그를 따라가며 갱신하므로, 같은 프로젝트라도 판정 건수와 등급이 PATCH 에서 바뀔 수 있습니다.
- **내부 구현**: `dist/` 의 모듈별 export, `scripts/`, `test/`.

## 2. 버전 올리기

| 증가 | 언제 | 예 |
|---|---|---|
| **MAJOR** | 공개 API 가 호환되지 않게 바뀔 때 | 도구·파라미터·출력 필드 삭제나 이름 변경, 타입 변경, 선택 → 필수, 기본값 변경, 입력 허용값·범위 축소, 출력 필드 필수 → 선택, CLI 명령 삭제·종료 코드 변경, 환경 변수 삭제, Node 최소 버전 상향 |
| **MINOR** | 호환을 유지하며 더할 때 | 새 도구·선택 파라미터·출력 필드·CLI 명령·환경 변수, 입력 허용값·범위 확대, 새 템플릿·대응 범위 확대, 응답 언어 추가, deprecated 표시 |
| **PATCH** | 계약이 그대로일 때 | 버그 수정, 카탈로그·규칙·기준 데이터 갱신, 응답 문구·문서 |

- **버그 수정과 계약**: 버그를 고치다 계약이 바뀌면 그 등급을 따릅니다. 예를 들어 잘못된 기본값을 고치면 MAJOR 입니다. 그 MAJOR 를 미룰 수 없을 만큼 위험한 경우에만 PATCH 로 내고, 변경 이력에 "호환 예외"로 적습니다.
- **0.x 기간**: 0.x 동안(~0.47)은 SemVer §4 에 따라 MINOR 에서도 호환을 깰 수 있었습니다. 실제로는 v0.32 이후 도구·파라미터를 지우거나 이름을 바꾼 적이 없습니다.

## 3. 폐기(deprecation) 절차

1. **MINOR 에서 표시**: `src/deprecations.ts` 의 `DEPRECATED_PARAMS` 에 `{ use, since, removeIn }` 을 적고, 파라미터 설명을 `[deprecated <since> — <use> 를 쓰세요, <removeIn> 에서 제거]` 로 시작하게 합니다.
2. **옛 이름도 계속 받기**: 새 이름이 없을 때만 옛 이름의 값을 씁니다. 응답에는 별도 content 항목으로 경고 한 줄을 붙입니다. `format=json`·`sarif` 본문은 그대로 파싱되고, 구조화 출력은 바뀌지 않습니다.
3. **제거는 MAJOR 에서만**: 제거는 `removeIn` 의 MAJOR 에서만 합니다. 변경 이력에 표시한 버전과 제거 버전을 적습니다.

| deprecated | 대신 | 표시 | 제거 |
|---|---|---|---|
| `check_egovframe_secure_coding(top)` | `topN`(다른 도구와 같은 이름) | 1.0.0 | 2.0.0 |

## 4. 강제: API 계약 테스트

`test/fixtures/api-contract.json` 은 공개 API 의 스냅샷입니다. 머리말에는 `version`(스냅샷을 만든 버전), `base`(변경을 재는 기준 릴리스), `change`(base 이후 누적 등급 `none`·`minor`·`major`)가 있습니다.

- **`npm run test:api-contract`**(릴리스 게이트)
  - 지금 코드의 계약이 스냅샷과 다르면 실패하고, 변경마다 minor·major 를 보여 줍니다.
  - 분류기 자체도 단언합니다. 파라미터 삭제·필수 추가·기본값 변경·범위 축소·출력 필드 삭제·도구 삭제·종료 코드 변경·Node 상향은 major 이고, 선택 파라미터·출력 필드·도구·명령 추가와 범위 확대는 minor 입니다.
- **`npm run api-contract:update`**: 의도한 변경이면 이것으로 스냅샷을 갱신하고, diff(계약과 `change`)를 PR 에서 검토합니다.
  - 스냅샷이 다른 버전에서 만들어졌으면 그 버전이 새 `base` 가 됩니다.
  - 같은 버전 안에서 여러 번 갱신하면 등급이 누적됩니다.
- **`npm run test:release`**: `base` → `package.json` 버전의 증가 폭이 `change` 에 맞는지 봅니다.
  - major 면 MAJOR(0.x 는 MINOR), minor 면 MINOR 이상을 올려야 합니다.
  - 모자라면 게이트가 실패해 병합·배포되지 않습니다.

## 5. 지원 범위

- **유지 브랜치**: 최신 MAJOR 하나만 유지합니다. 이전 MAJOR 로 백포트하지 않습니다.
- **Node**: Node 는 지원이 끝나지 않은 LTS 만 지원하고, 그 범위는 CI 매트릭스(ubuntu·windows × Node 22·24)와 같습니다. 1.0.0 기준으로 Node 18(2025-04)과 Node 20(2026-04)은 지원이 끝나 `engines` 를 `>=22` 로 올렸습니다. 최소 버전을 올리는 것은 MAJOR 입니다.
- **MCP**: MCP 프로토콜·SDK 의 안정 기능만 계약에 넣습니다(실험 기능은 계약 밖).
