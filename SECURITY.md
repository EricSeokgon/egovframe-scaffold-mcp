# 보안 정책

## 지원 버전

| 버전 | 보안 수정 |
|---|---|
| 최신 1.x (npm `latest`) | 지원 |
| 그 이전 버전 | 최신 버전으로 올려 주세요 |

보안 수정은 최신 버전에 PATCH(또는 진행 중인 MINOR)로 배포합니다. 버전 정책은 [docs/versioning.md](docs/versioning.md)를 보세요.

## 취약점 제보

**공개 이슈·PR·토론에 올리지 마세요.** 이 저장소의 GitHub 비공개 취약점 제보를 써 주세요.

1. 저장소의 **Security** 탭으로 갑니다.
2. **Report a vulnerability** 를 누릅니다. 바로 가기: <https://github.com/EricSeokgon/egovframe-scaffold-mcp/security/advisories/new>

제보에 담아 주시면 좋은 것:

- 영향받는 버전과 도구 이름(예: `apply_egovframe_recipe`), CLI 명령
- 재현 절차: 입력, 환경(OS·Node 버전·`EGOVFRAME_ALLOWED_ROOTS` 등), 기대 결과와 실제 결과
- 영향: 허용 범위 밖 파일 읽기·쓰기, 명령 실행, 다운로드 위·변조, 생성 코드의 보안약점 등
- 가능하면 패치나 수정 방향

## 처리 절차

| 단계 | 목표 |
|---|---|
| 접수 확인 | 3 영업일 안 |
| 영향 판단과 수정 계획 공유 | 10 영업일 안 |
| 수정 배포 | 심각도에 따라. 배포 전까지 제보자와 비공개 advisory 안에서 협의 |

- 수정이 배포되면 GitHub Security Advisory 를 공개하고, 필요하면 CVE 를 요청합니다.
- 제보자가 원하면 advisory 와 CHANGELOG 에 이름을 적습니다.
- 공개 시점은 제보자와 함께 정합니다. 수정 전에는 세부 내용을 공개하지 않습니다.

## 범위

포함:

- 이 저장소의 MCP 서버·CLI(`egovframe-scaffold-mcp` npm 패키지) 코드
- 이 도구가 생성하는 코드·설정(CRUD·CI·배포 산출물 등)의 보안 결함
- 동봉 카탈로그·고정 지문(아카이브 sha256 등)을 우회하는 방법

제외(각 프로젝트에 제보해 주세요):

- 전자정부 표준프레임워크 실행환경·공통컴포넌트 자체의 취약점 → [eGovFramework](https://github.com/eGovFramework)
- MCP SDK·Node.js·의존 라이브러리의 취약점 → 해당 프로젝트. 이 패키지가 그 취약점에 영향을 받는 방식이라면 여기에 제보해도 됩니다
