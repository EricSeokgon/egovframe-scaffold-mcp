# Initializr zip 조달 템플릿 설계 (v0.27.0)

## 배경

v0.26.0의 통합 카탈로그(`catalog/templates.json`)는 공식 프로젝트 22종 가운데 MCP가 9종만 다룬다는 것을 계산값으로 보여 주었습니다. 남은 13종 가운데 12종은 단독 GitHub 저장소가 없고, eGovFrame VSCode Initializr 저장소 안에 zip으로만 배포됩니다.

- 위치: `eGovFramework/egovframe-vscode-initializr` 의 `templates/projects/examples/*.zip`
- 저장 방식: Git LFS. 저장소에는 `oid sha256:…`·`size …` 를 담은 포인터만 있고, 본문은 `media.githubusercontent.com` 에서 받습니다.
- 구조: zip 루트가 곧 프로젝트 루트입니다(codeload 아카이브와 달리 `<repo>-<ref>/` 최상위 폴더가 없음).
- 좌표: `pom.xml` 의 groupId·artifactId·name·version·url 이 `###GROUP_ID###` 같은 자리표시자입니다. Initializr 는 같은 내용의 pom 템플릿으로 덮어쓰는데, zip 안의 `pom.xml` 과 그 템플릿이 동일함을 확인했으므로 MCP 는 zip 의 `pom.xml` 에서 자리표시자만 채웁니다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 조달 단위 | `TEMPLATES` 항목에 선택 필드 `archive` 추가 | 기존 10종(저장소 조달)의 동작과 타입을 그대로 둔다 |
| 고정 방식 | Initializr **commit** + LFS 포인터의 **sha256·bytes** | 브랜치는 움직인다. commit 으로 URL 을 고정하고 바이트까지 검증해 조사 시점과 같은 산출물임을 보장한다(공통컴포넌트 카탈로그의 v5.0.6 고정과 같은 원칙) |
| 검증 실패 | 아무 파일도 쓰지 않고 거부 | 검증은 압축 해제·transaction 시작 전에 끝난다 |
| `ref` 직접 지정 | 허용하되 지문 검증을 건너뛰고 결과에 `archiveVerified: false` 와 경고를 남긴다 | 최신 zip 을 시험해 볼 길은 열어 두되, 검증되지 않았음을 숨기지 않는다 |
| 멀티 프로젝트 | `msa-portal-backend`·`msa-portal-frontend` 는 `multiProject: true` | 하위 모듈 좌표를 건드리지 않는 기존 규칙과 동일 |
| DbType | `src/main/resources/**/globals.properties` 중 `Globals.DbType` 줄이 있는 파일에 적용 | 배치 템플릿은 `egovframework/batch/properties/`, 웹 템플릿은 `egovframework/egovProps/` 로 경로가 다르다 |
| 제외 | `egov-template-common-components`(23MB 올인원) | MCP 는 공통컴포넌트를 `add_egovframe_components` 로 선택 조립한다는 기존 큐레이션 결정을 유지 |

추가된 템플릿 id: `web`, `boot-web`, `batch-file-scheduler`, `batch-file-commandline`, `batch-file-web`, `batch-db-scheduler`, `batch-db-commandline`, `batch-db-web`, `mobile-web`, `mobile-common-components`, `msa-portal-backend`, `msa-portal-frontend`. 커버리지는 22종 중 9 → 21종입니다.

## upstream 변화 감지

`sync_egovframe_templates` 가 zip 본문을 받지 않고 **LFS 포인터(약 130바이트)** 만 `raw.githubusercontent.com` 에서 읽어 고정 지문과 대조합니다.

- 결과 필드: `archivesChecked`, `archiveDrift[]`(template·path·pinned/upstream sha256·bytes·error)
- 지문이 달라져도 **생성은 계속 동작**합니다. 다운로드 URL 이 고정 commit 을 가리키기 때문입니다. drift 는 "새 zip 이 나왔으니 검토하라"는 신호입니다.
- 포인터 하나를 읽지 못해도 동기화 전체가 실패하지 않고 항목별 `error` 로 보고합니다.

## 고정값 갱신 절차

1. `sync_egovframe_templates()` 를 실행해 `archiveDrift` 에 나온 템플릿과 upstream sha256·bytes 를 확인합니다.
2. 새 zip 을 검토합니다(구조 변화, 자리표시자, `globals.properties` 경로).
3. `src/project.ts` 의 `INITIALIZR_COMMIT` 을 새 commit 으로, 해당 항목의 `sha256`·`bytes` 를 포인터 값으로 바꿉니다. commit 은 전 항목이 공유하므로, 바뀌지 않은 zip 의 지문은 그대로 두면 됩니다(같은 객체).
4. `npm run build && npm run generate:template-catalog` 로 `catalog/templates.json` 을 다시 만듭니다.
5. `npm run test:pom && npm run test:template-catalog && npm run test:templates` 로 확인합니다.

## 필요한 네트워크

기존 `codeload.github.com`·`raw.githubusercontent.com` 에 더해 zip 본문을 받는 `media.githubusercontent.com` 이 필요합니다.

## 검증

- 오프라인: 자리표시자 치환(5개·비자리표시자 `######` 보존·parent 보존), globals 경로 판별, URL 구성, 12종 정의 유효성(`npm run test:pom`), LFS 포인터 해석·지문 drift·포인터 오류 보고(`npm run test:template-catalog`)
- 네트워크: `batch-file-commandline` 실생성(지문 검증·좌표·DbType·zip 루트 보존), 지문 불일치 거부와 무기록, `ref` 지정 시 검증 생략 표시, `msa-portal-backend` dryRun(`npm run test:templates`)
- 수동: 12종 전부 실생성해 자리표시자 0건 확인, `batch-db-commandline`·`boot-web`·`mobile-web` 은 `mvn compile` 통과
