# 포트폴리오(기관 단위) 현황 설계 (`summarize_egovframe_portfolio`, v1.17.0)

## 1. 문제

기관·사업자는 프로젝트 수십 개의 전환 준비도·취약점·버전·운영 준비를 한 표로 봐야 합니다. 지금까지는 프로젝트마다 평가서(`generate_egovframe_report(sections=["assessment"])`)나 납품 패키지를 열어 봤습니다. 평가서·납품 패키지·생성 CI 아티팩트가 이미 구조화 JSON 이므로 새 분석은 필요 없습니다. 이 도구는 모으고, 비교하고, 표로 만드는 일만 합니다.

## 2. 입력과 판별

입력은 디렉터리 목록입니다. 끝이 `/*` 인 항목은 그 아래 디렉터리 전부로 펼칩니다(정렬, 숨김 제외). 디렉터리마다 다음 순서로 판별합니다.

| 순서 | 있는 파일 | 출처 | 읽는 것 |
|---|---|---|---|
| 1 | `delivery-manifest.json` | `delivery` | `assessment/assessment.json` |
| 2 | `egovframe-assessment.json` | `ci-artifact` | 그 파일(`assess --json-out`) |
| 3 | `egovframe-delivery/delivery-manifest.json` | `ci-artifact` | 그 아래 `assessment/assessment.json` |
| 4 | `pom.xml`·`build.gradle(.kts)` | `project` | 평가서 실행(`run=false` 면 실패 행) |

- JSON 은 `{assessment: …}` 로 감싼 형태와 평가서 원본을 모두 받습니다.
- 프로젝트 입력은 `assessProject` 를 `jobs`(기본 2, 상한 8)개씩 병렬로 실행합니다. `offline` 기본값은 true(OSV 조회 없음 — 취약 의존성 열은 `—`)입니다.
- 평가서에 v1.15 운영 준비 절이 들어 있으므로 운영 점검을 따로 돌리지 않습니다.
- 실패한 입력(판별 불가·JSON 깨짐·평가 예외)은 사유와 함께 맨 아래 행으로 남깁니다. 이름이 겹치면 `name#2` 처럼 번호를 붙입니다.

## 3. 행과 집계

행: 이름, 출처, RTE 버전(없으면 parent 버전)·세대(3.x/4.x/5.x), 전환 난이도·공급망·운영 준비 등급, 수동 전환 항목, 취약 의존성·권고 ID 수(OSV 를 조회한 평가서만), 노후 의존성, 보안약점 높음/중간, 공통컴포넌트 수, 평가일, 담당(`ownerMap` CSV `name,owner`).

집계: 세대·등급 분포, 취약 프로젝트 수, 그리고 **먼저 손댈 것** — 여러 프로젝트에 걸친 취약 좌표·보안약점 규칙·운영 미달 규칙 Top N(`topN`, 기본 10). 프로젝트 수가 많은 순으로 정렬합니다. 한 번 고치면 여러 프로젝트가 같이 좋아지는 것이 앞에 옵니다.

## 4. 비교·정렬·필터

- `previous`: 이전 `portfolio.json`. 이름으로 맞춰 등급 변화, 새로 생기거나 해소된 권고 ID, 신규 프로젝트, 빠진 프로젝트를 보여 줍니다.
- `sort`: `name`·`migration`·`supplyChain`·`operations`(나쁜 순)·`vulnerabilities`(많은 순). 실패 행은 항상 맨 아래입니다.
- `only`: `migration:C`(C 이하)·`supplyChain:D`·`operations:C`·`vulnerabilities>0`·`secure>0`·`manual>=10`·`era:4.x`·`failed`. 쉼표로 여러 조건을 주면 모두 만족하는 행만 남깁니다. 필터는 행에만 적용하고, 분포와 Top N 은 전체 기준입니다.

## 5. 출력

- Markdown 한 장: 기관명, 기준일, 분포, 표, 먼저 손댈 것, 변화, 실패.
- CSV: UTF-8 BOM, CRLF(엑셀에서 바로 열림).
- JSON: 구조화 출력(`PortfolioOutput`). 다음 달 `previous` 로 씁니다.
- `outputDir` 는 없거나 비어 있는 디렉터리여야 합니다. `portfolio.md`·`portfolio.csv`·`portfolio.json` 을 씁니다. CLI 는 `--write` 가 있어야 씁니다.
- CLI `--fail-on` 지표: `projects`·`failed`·`migrationD`·`supplyChainD`·`operationsD`·`vulnerableProjects`·`secureHigh`.

## 6. CI 아티팩트로 모으기

생성 CI(`generate_egovframe_ci(supplyChain=true)`)는 v1.17 부터 assess 단계에서 `--json-out egovframe-assessment.json` 을 써서 `egovframe-supply-chain` 아티팩트에 넣습니다. 모아 보는 쪽은 저장소별 아티팩트를 폴더 하나씩 내려받아 입력으로 줍니다.

```bash
# GitHub — 저장소마다 최신 성공 실행의 아티팩트(읽기 권한 토큰 필요)
for r in org/app-a org/app-b; do gh run download -R "$r" -n egovframe-supply-chain -D "artifacts/${r#*/}"; done
npx -y egovframe-scaffold-mcp portfolio --inputs "artifacts/*" --org "○○기관" --output-dir portfolio-2026-11 --write
```

`generate_egovframe_ci(portfolio=true)`(모아 보는 저장소용 워크플로 생성)는 미뤘습니다. 다른 저장소의 아티팩트를 받는 방법(GitHub 조직 토큰, GitLab 그룹 토큰·`needs:project`, Jenkins copyArtifact)과 권한이 기관마다 달라서, 생성한 워크플로가 대부분의 기관에서 손보지 않고는 돌지 않기 때문입니다.

## 7. 범위 밖

웹 대시보드·서버, 저장소 자동 탐색(기관 Git 서버가 다양), 프로젝트 사이 의존(공유 라이브러리) 그래프, 평가서에 없는 새 분석.
