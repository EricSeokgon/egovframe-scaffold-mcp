# 납품 패키지 설계 (v1.1, `prepare_egovframe_delivery`)

## 1. 문제

감리·검수 때 내는 산출물은 지금까지 도구마다 따로 만들고 사람이 모았습니다.

| 산출물 | 만드는 도구 |
|---|---|
| 전환 준비도 평가서(등급·산식) | `generate_egovframe_report(sections=["assessment"])` |
| 의존성 조치 목록·OSV 취약점 | `check_egovframe_dependencies` |
| SBOM(CycloneDX·SPDX) | `generate_egovframe_sbom` ×2 |
| SBOM 최소 요소 점검·이전 비교·VEX 초안 | `check_egovframe_sbom` |
| 보안약점 결과·SARIF | `check_egovframe_secure_coding` |
| 컨테이너·배포 산출물 | `generate_egovframe_deploy` |
| 빌드 결과 | `build_egovframe_project` |

차수마다 같은 묶음을 내야 하고, 이전 차수와 무엇이 달라졌는지(새 취약점·새 보안약점·버전 변화·등급 변화)를 설명해야 합니다. 받는 쪽은 받은 파일이 만든 그대로인지 확인할 방법이 없었습니다.

## 2. 동작

`prepare_egovframe_delivery(projectDir, outputDir, include?, previousDelivery?, offline=true, supplier?, zip=false, verify=false, dryRun=true)`

- **기존 도구를 그대로 부릅니다.** 결과의 Markdown 과 JSON 을 함께 담아 사람도 기계도 읽습니다. 항목별 요약이 manifest 와 목차에 들어갑니다.
- **프로젝트는 읽기만 합니다.** SBOM 도 프로젝트의 `sbom/` 에 쓰지 않고(`generateSbom` 내부 옵션 `noWrite`) 패키지에만 씁니다. 배포 산출물은 dryRun 내용을 패키지에 담습니다.
- **새 디렉터리에만 씁니다.** `outputDir` 가 비어 있지 않으면 거부하고, 스테이징(`<outputDir>.partial-<pid>`)에 다 만든 뒤 rename 합니다. 중간에 실패하면 흔적이 남지 않습니다.
- **실패한 항목은 빼지 않습니다.** 그 항목의 파일만 빼고 목차에 "❌ 실패 — 이유"로 남깁니다. 빌드 도구가 없거나 오프라인이라 못 만든 것도 그렇게 적힙니다. CLI 는 `--fail-on failed` 로 단계 실패로 바꿀 수 있습니다.
- **dryRun(기본)은 계획만** 냅니다. 항목 목록과 출력 위치, 이전 차수 비교 여부만 돌려주고 아무것도 실행하지 않습니다.

### 2.1 패키지 구조

```
<outputDir>/
  index.md                       목차 — 항목·상태·파일·요약, 검증 방법, 파일 지문 표
  delivery-manifest.json         아래 3절
  diff.md · diff.json            previousDelivery 를 줬을 때
  assessment/assessment.{md,json}
  dependencies/dependencies.{md,json}
  sbom/bom.cdx.json · bom.spdx.json · vex.cdx.json · sbom.md
  sbom-check/sbom-check.{md,json}
  secure-coding/secure-coding.{md,json} · egovframe-secure.sarif
  deploy/Dockerfile · .dockerignore · deploy/docker-compose.yml · .env.example · k8s/*.yaml · deploy.md
  build/build.json · build.log   include 에 build 를 넣었을 때(로컬 JDK·Maven/Gradle 로 package 실행)
```

`zip=true` 면 같은 내용을 `<outputDir>.zip` 으로도 냅니다(디렉터리 이름이 최상위).

### 2.2 항목별 처리

| 항목 | 호출 | 비고 |
|---|---|---|
| `sbom` | `generateSbom(noWrite, offline, supplier)` | CycloneDX 를 만들고 `cdxToSpdx` 로 SPDX 2.3 도 냅니다. Maven 은 cyclonedx-maven-plugin, Gradle 은 의존성 트리 |
| `sbom-check` | `checkMinimumElements` · `recheckSbom` · `diffSboms` · `mergeVex` | 이 패키지의 SBOM 을 점검합니다. 이전 차수가 있으면 그 SBOM 과 비교하고, 이전 차수의 `sbom/vex.cdx.json` 을 이어 써 사람이 적은 판단(`analysis.state` 등)을 보존합니다 |
| `dependencies` | `checkDependencies(offline)` | 선언 의존성 기준(`resolve` 없음 — SBOM 이 해석 집합을 담음) |
| `secure-coding` | `checkSecureCoding(maxFindings=20000)` + `toSarif` | 전체 항목을 JSON 에, 상위 100건을 Markdown 에 |
| `assessment` | `assessProject(offline)` | 등급·산식 |
| `deploy` | `generateDeploy(dryRun)` | 대상이 아니면(라이브러리 jar 등) 실패 항목으로 |
| `build` | `runBuild(goal="package")` | 기본 제외. 실패하면 로그와 함께 실패 항목으로 |

### 2.3 이전 차수 비교(`previousDelivery`)

이전 패키지 디렉터리의 JSON 을 읽어 비교합니다. 시각·serialNumber 는 보지 않으므로 **같은 입력이면 `changed=false`** 입니다.

| 비교 | 근거 파일 | 내용 |
|---|---|---|
| 등급 | `assessment/assessment.json` | 전환 난이도·공급망 상태 등급의 이전 → 현재 |
| SBOM | `sbom/bom.cdx.json` | `diffSboms` — 추가·제거·버전 변경·판정 변화·새/해소 취약점 |
| 의존성 취약점 | `dependencies/dependencies.json` | OSV ID 집합의 추가·해소 |
| 보안약점 | `secure-coding/secure-coding.json` | 지문(fingerprint) 집합의 새 항목·해소, 총 건수 |
| 의존성 판정 | 같은 파일 | 판정별 건수 표 |

비교할 수 없는 항목(한쪽에 파일이 없음)은 `skipped` 에 이유를 적습니다.

## 3. manifest 와 검증

```json
{
  "schemaVersion": 1,
  "tool": { "name": "egovframe-scaffold-mcp", "version": "1.1.0" },
  "createdAt": "2026-10-19T…",
  "project": { "name": "dl-web", "buildTool": "maven", "fingerprint": "<sha256>", "fingerprintFiles": 312 },
  "items": [ { "id": "sbom", "label": "…", "status": "ok", "durationMs": 9800, "files": ["sbom/bom.cdx.json", …], "summary": { "components": 67, … } }, … ],
  "files": [ { "path": "assessment/assessment.md", "sha256": "…", "bytes": 12345 }, … ],
  "rootHash": "<sha256>",
  "previous": { "dir": "…/d1", "createdAt": "…", "rootHash": "…" }
}
```

- **입력 지문(`project.fingerprint`)**: 빌드 파일(pom·gradle·settings·gradle.properties)의 내용과 `src/` 아래 파일의 경로·크기를 정렬해 sha256 한 값입니다. 같은 소스로 만든 패키지인지 가립니다.
- **rootHash**: manifest 를 뺀 모든 파일의 `경로 sha256` 줄을 정렬해 이은 것의 sha256 입니다. 공문·메일에 한 줄로 인용하는 용도입니다.
- **verify**(`verify=true` 또는 CLI `deliver --verify --output-dir <dir>`): 파일마다 sha256·크기를 다시 계산해 **일치·불일치·누락**을 나누고, 누락이 없으면 rootHash 를 다시 계산해 대조합니다. manifest 에 없는 파일은 "manifest 밖"으로 알립니다. 전자서명·타임스탬프는 기관 인증서가 필요해 범위 밖입니다.

## 4. CLI 와 CI

- `deliver --project . --output-dir <dir> --write [--previous-delivery <dir>] [--offline=false] [--supplier …] [--zip] [--fail-on failed]`
- `deliver --output-dir <dir> --verify [--fail-on invalid]` — 종료 코드 0 일치 · 2 불일치
- `generate_egovframe_ci(supplyChain=true, delivery=true)` 는 게이트 끝에 `deliver --write --fail-on failed` 단계를 넣고 `egovframe-delivery/` 를 아티팩트로 남깁니다(세 플랫폼 공통). 작업 디렉터리 안에 만들어지므로 다음 실행에서는 fresh checkout 이라 섞이지 않습니다. 로컬에서는 프로젝트 밖 디렉터리를 권합니다.

## 5. 검증

- **게이트(`test:delivery`, 55단언)**: 입력 지문·rootHash, dryRun 무기록, 거부(프로젝트 안·sbom 없는 sbom-check·모르는 항목·manifest 없는 previousDelivery), 1차 생성(파일 16종·프로젝트 불변·manifest·SBOM 공급자와 OSV·VEX), verify(일치·수정·삭제·추가), 같은 입력 2차 차이 0, 3차(RTE 버전 변경·새 취약점·보안약점 해소·VEX 판단 보존·zip), 실패 항목 처리, 비어 있지 않은 디렉터리 거부·스테이징 잔여물 없음, CLI 정의, MCP 도구(verify·dryRun).
- **CI 통합(`test:delivery-live`)**: 공식 web 템플릿 — 1차(21초, SBOM 67 component·취약점 27·등급 A/B) → verify → 같은 입력 2차 차이 0 → hsqldb 2.7.4 → 2.5.1 사본은 버전 변경 1건·새 취약점 1·등급 B → C 만 → SBOM 한 줄 수정 시 verify 불일치 → CLI `--write`·`--verify`·`--fail-on` 종료 코드 → OSV 덤프만 담은 오프라인 번들로 fetch 없이 같은 취약점 27건.

## 6. 범위 밖

- 전자서명·타임스탬프, 기관별 서식 변환, 원격 제출
- `resolve=true` 의존성 트리(SBOM 이 해석 집합을 대신함)
- 멀티 모듈 작업공간의 모듈별 패키지(합본 하나로 냄)
