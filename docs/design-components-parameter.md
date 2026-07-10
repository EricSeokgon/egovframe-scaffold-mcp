# 설계 초안: 공통컴포넌트 선택 설치 (`components` 파라미터)

> 로드맵 1번 항목의 설계 문서입니다. [#1120](https://github.com/eGovFramework/egovframe-common-components/issues/1120) 제안의 후속이며, eGovFrame IDE의 "공통컴포넌트 조립" 마법사를 MCP 도구로 옮기는 것을 목표로 합니다.

## 1. 목표

`create_egovframe_project` 호출 시(또는 별도 도구로) 공통컴포넌트 253종 중 필요한 것만 골라 생성된 프로젝트에 조립한다.

```
"게시판과 로그인 컴포넌트를 포함한 표준프레임워크 프로젝트를 만들어줘"
→ create_egovframe_project({ ..., components: ["bbs", "login"] })
```

## 2. 배경: eGovFrame IDE 마법사의 동작

IDE의 공통컴포넌트 생성 마법사는 (1) 컴포넌트 선택 UI → (2) 선택 컴포넌트의 소스·리소스 복사 → (3) DB 타입별 DDL/DML 스크립트 안내 → (4) 의존 컴포넌트 자동 포함 순으로 동작한다. 이 로직을 헤드리스로 재현하는 것이 핵심이다.

공통컴포넌트 소스는 `egovframework/com/<분류>/<컴포넌트>` 패키지 구조를 따른다 (cmm 공통, cop 협업, uss 사용자지원, sym 시스템관리, sec 보안, utl 유틸리티 등).

## 3. 인터페이스 설계

### 3.1 신규 도구 (권장): `add_egovframe_components`

프로젝트 생성과 컴포넌트 조립을 분리 — 기존 프로젝트에도 추가 가능하다.

```jsonc
{
  "name": "add_egovframe_components",
  "params": {
    "projectDir": "대상 프로젝트 경로 (필수)",
    "components": ["bbs", "login"],   // 컴포넌트 id 또는 카테고리 id
    "database": "mysql",              // DDL 선택용. 미지정 시 프로젝트 설정 추론
    "includeDependencies": true,      // 의존 컴포넌트 자동 포함 (기본 true)
    "dryRun": false                   // 복사될 파일 수·스크립트 목록 미리보기
  }
}
```

`create_egovframe_project`에는 동일 의미의 `components` 파라미터를 추가해 내부적으로 이 도구를 호출한다.

### 3.2 카탈로그 도구: `list_egovframe_components`

카테고리·키워드로 컴포넌트를 탐색한다. AI 에이전트가 자연어 요청("게시판")을 컴포넌트 id(`bbs`)로 매핑하는 근거 데이터.

## 4. 컴포넌트 카탈로그 (메타데이터)

저장소에 `catalog/components.json`을 두고 빌드 시 검증한다.

```jsonc
{
  "id": "bbs",
  "name": "게시판",
  "category": "cop",
  "sourcePaths": [
    "src/main/java/egovframework/com/cop/bbs/**",
    "src/main/resources/egovframework/**/bbs/**",
    "src/main/webapp/**/cop/bbs/**"
  ],
  "sqlScripts": { "mysql": ["...bbs DDL/DML..."], "oracle": ["..."] },
  "dependsOn": ["cmm", "ems"],        // 컴포넌트 간 의존
  "mavenDependencies": []             // 추가 라이브러리 필요 시
}
```

- 초기 데이터는 공통컴포넌트 저장소의 패키지 구조·`src/script` DDL과 IDE 마법사 정의를 조사해 생성한다. (조사 항목: IDE 플러그인 `egovframe-development` 저장소의 컴포넌트 정의 파일)
- 253종 전수 등록은 단계적으로 진행하고, 카탈로그에 없는 id는 명확한 오류로 응답한다.

## 5. 조립 파이프라인

1. **해석**: `components` → 카탈로그 조회 → `dependsOn` 그래프를 위상 정렬해 설치 목록 확정 (순환 시 오류)
2. **다운로드**: egovframe-common-components 저장소 zip 1회 다운로드·캐시 (기존 템플릿 다운로드 로직 재사용, zip-slip 방지 동일 적용)
3. **복사**: `sourcePaths` 글롭에 해당하는 파일만 대상 프로젝트에 복사. 충돌(기존 파일 존재) 시 기본 거부, `--force` 없음 (안전 우선)
4. **패키지 적용**: 템플릿 생성과 동일하게 groupId 기반 조정은 하지 않고 `egovframework.com.*` 원본 패키지 유지 (IDE와 동일 동작) — README에 명시
5. **DB 스크립트**: 선택 DB의 DDL/DML을 `scripts/components/` 아래 복사하고 실행 안내 메시지 반환 (자동 실행하지 않음)
6. **보고**: 설치된 컴포넌트·파일 수·수동 후속 작업(웹.xml/컨텍스트 설정 등)을 구조화해 반환

## 6. 단계별 범위 (컨트리뷰션 일정 연동)

| 단계 | 범위 | 목표 시점 |
|---|---|---|
| M1 | 카탈로그 스키마 + `list_egovframe_components` + 대표 카테고리 3종(cmm·cop/bbs·sec/login) 수동 등록, `dryRun` 동작 | ~8/9 |
| M2 | 조립 파이프라인(복사·DB 스크립트·의존 해석) + smoke 테스트 | ~8/23 (v0.3) |
| M3 | 카탈로그 자동 생성 스크립트(저장소 구조 스캔) + 커버리지 확대 | ~9/6 |

리스크: 253종 전수 메타데이터 작성 비용 → M1~M2는 카테고리/대표 컴포넌트로 한정하고, 이슈 #1120에 커버리지 로드맵을 공개해 커뮤니티 기여를 받는다.

## 7. 검증 계획

- 단위: 카탈로그 스키마 검증(CI), 의존 위상 정렬, 글롭 매칭
- 통합(smoke): simple-backend 템플릿 생성 → bbs 조립 → `mvn -q compile` 통과 확인
- 프로토콜: tools/list에 신규 도구·파라미터 노출 확인

## 8. 열린 질문 (이슈 논의용)

1. 컴포넌트 id 체계 — IDE 마법사 표기와 패키지명 중 무엇을 표준으로 할지
2. Boot 기반 템플릿(simple-backend)과 레거시 XML 설정 컴포넌트 간 설정 방식 차이 처리
3. 공통 필수 컴포넌트(cmm) 자동 포함 여부 기본값
