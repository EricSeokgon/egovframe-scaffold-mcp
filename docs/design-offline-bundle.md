# 설계: 폐쇄망 오프라인 번들 (v0.42)

코드는 `src/offline-bundle.ts`(만들기·읽기·로컬 OSV·Maven 버전 비교)와 `src/offline-bundle-plan.ts`(카탈로그·템플릿 정의에서 받을 목록 구성)이고, 테스트는 `test/offline-bundle.mjs`(오프라인)·`test/bundle-live.mjs`(CI 통합)입니다.

## 1. 문제

공공 개발 환경은 대부분 망분리라, 인터넷 PC 에서 받은 자료를 승인을 거쳐 반입합니다. 이 서버가 실행 중에 인터넷을 쓰는 곳은 네 군데입니다.

| 쓰는 곳 | 도구 | 원래 출처 |
|---|---|---|
| 공통컴포넌트 아카이브 | `add_egovframe_components`·`upgrade_egovframe_project`·재조립·리허설 | codeload (카탈로그 고정 커밋, sha256 고정) |
| Initializr zip 템플릿 | `create_egovframe_project`(zip 조달 12종) | media.githubusercontent (LFS, sha256 고정) |
| OSV 취약점 조회 | `check_egovframe_dependencies`·`generate_egovframe_sbom`·`check_egovframe_sbom`·평가서(`offline=false`) | api.osv.dev querybatch |
| 재조립 원본 태그 | `reassemble_egovframe_components`·`rehearse_egovframe_migration` | github.com git(ls-remote·fetch) |

허용 요청은 기관마다 절차가 길고, OSV 처럼 POST API 는 프록시 정책상 막히는 경우가 많습니다. 반입 가능한 번들 하나로 같은 결과를 내는 것이 목표입니다.

## 2. 번들

```
<번들>/
  bundle-manifest.json            schemaVersion 1 · createdAt · serverVersion · catalog(repository·tag·commit)
                                  files[]: path · kind(osv|components|template) · url · sha256 · bytes · fetchedAt · (osv: lastModified·records)
                                  origin: path · repository · tags[] · bytes
  osv/Maven-all.zip               https://osv-vulnerabilities.storage.googleapis.com/Maven/all.zip
  archives/<repo>-<commit 12>.zip https://codeload.github.com/<repo>/zip/<고정 커밋>
  templates/<id>.zip              Initializr zip(고정 지문) / 저장소 템플릿(지정 시, codeload zip/<branch>)
  origin/<repo>.git               공식 공통컴포넌트 태그 전부, 태그마다 depth 1·내용 포함
```

| 결정 | 이유 |
|---|---|
| 파일을 **출처 URL 로 색인** | 다운로드 코드마다 번들 분기를 넣지 않고, 공용 `fetchWithTimeout`(GET)과 카탈로그 아카이브 다운로드 한 곳에서 manifest 의 같은 URL 을 찾아 대체한다. 새 GET 다운로드도 번들에 넣기만 하면 된다 |
| 쓸 때마다 **sha256·크기 검증**(프로세스당 1회), 다르면 거부 | 반입 매체·복사 과정의 손상과 변조를 막는다. 고정 지문이 있는 항목(아카이브·Initializr zip)은 만들 때도 고정값과 대조한다 |
| 원본 미러는 **내용 포함** | blob 없는 캐시(v0.38)는 패치를 만들 때 blob 을 원격에서 받는다. 22개 태그를 depth 1 로 모두 받아도 37MB(실측)라 내용까지 담아 패치 생성까지 폐쇄망에서 되게 한다 |
| 저장소 템플릿은 **지정할 때만** | 브랜치 기준이라 고정 지문이 없고 크기도 제각각이다. Initializr zip 12종(≈56MB)은 기본 포함 |
| **새(또는 빈) 디렉터리**에 임시 디렉터리를 거쳐 씀 | 반쯤 받은 번들이 남아 manifest 와 어긋나는 일을 막는다. 실패하면 아무것도 남지 않는다 |
| Maven 의존성 jar 는 **넣지 않음** | 프로젝트마다 다르고 기관 Nexus·Artifactory 미러로 해결하는 것이 표준이다(노트로 안내) |

## 3. 로컬 OSV

querybatch 와 같은 모양의 결과(`results[].vulns[].id`)를 덤프로 만든다. 레코드의 `affected[]` 중 `ecosystem: Maven` 만 색인하고(`withdrawn` 제외), 버전이 `versions` 목록에 있거나 `ECOSYSTEM` 범위(`introduced`·`fixed`·`last_affected`·`limit`) 안이면 해당한다. 범위 판정용 Maven 버전 비교는 ComparableVersion 의 요지를 따른다 — `.`·`-`·숫자/문자 경계로 나누고 끝의 0 과 빈 한정자는 무시, 숫자는 수로, 한정자는 alpha < beta < milestone < rc(=cr) < snapshot < (없음 = ga = final = release) < sp, 그 밖의 문자열은 그 뒤 사전순.

검증(2026-10-10, 같은 날 받은 덤프): 공식 web 템플릿 SBOM 67 component + 옛 버전 표본 6개(log4j-core 2.14.1·log4j 1.2.17·spring-webmvc 5.3.37·jackson-databind 2.9.8·commons-fileupload 1.3.3·mysql-connector-java 5.1.38)에서 온라인 querybatch 와 **질의 73/73·ID 134/134 일치**. 덤프는 하루 한 번 갱신되므로 CI 는 97% 이상 일치를 요구하고 차이를 로그로 남긴다.

OSV 를 쓴 결과에는 "오프라인 번들 스냅숏(원본 갱신일 기준, 레코드 수)" 노트를 붙이고, 기준일이 30일(`EGOVFRAME_BUNDLE_MAX_AGE_DAYS`)을 넘으면 경고한다.

## 4. 재조립 원본

`GitOriginSource` 는 번들 manifest 의 `origin.repository` 가 같으면 캐시 디렉터리 대신 번들 미러를 쓰고, 태그 목록은 `git for-each-ref`, 태그 확인은 `rev-parse` 로 한다(원격 `ls-remote`·`fetch` 없음). 번들에 없는 태그는 "번들을 새로 만드세요" 오류. CI 는 `GIT_ALLOW_PROTOCOL=file` 로 git 의 원격 접근을 막은 상태에서 4.3.2 코퍼스의 원본 태그 식별을 확인한다.

## 5. 검증

- `test:offline-bundle`(30단언, 오프라인): Maven 버전 순서·같은 표기, OSV 범위, 덤프 색인·질의, 번들 만들기(가짜 다운로드·로컬 git 원본, dryRun·manifest·고정 지문 불일치 거부·실패 무흔적·덮어쓰기 거부), 번들 읽기(fetch 훅·POST 제외·변조 거부·깨진 manifest·없는 경로), 원본 미러(태그·커밋·트리·blob·없는 태그), OSV 노트·30일 경고, 의존성 점검 연동, 네트워크 진단 처방
- `test:bundle-live`(CI 통합): 실제 번들(OSV·아카이브·web 템플릿·태그 미러) → 로컬 OSV = 온라인 → fetch 차단·git file 전용 상태에서 web 템플릿 생성·bbs 조립·재조립 미리보기·SBOM 재점검, 네트워크 시도 0건

## 6. 범위 밖

Maven 의존성 미러링, 번들 서명(manifest sha256 으로 대신 — 요청이 있으면 서명 추가), upstream 대조(`sync_egovframe_*`)·가이드 문서 조회의 오프라인화.
