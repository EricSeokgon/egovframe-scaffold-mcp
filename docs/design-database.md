# DB 준비·적재 확인 설계 (v1.10, `prepare_egovframe_database`)

## 배경

공통컴포넌트는 DB 테이블이 있어야 뜹니다(전체 182개 + 뷰 1). 조립(`add_egovframe_components(database)`)은 카탈로그의 컴포넌트별 테이블 목록으로 통합 스크립트(`script/ddl·dml/<db>/`)에서 구문을 골라 `scripts/egovframe-components/<db>/ddl·dml/<id>.sql` 에 두지만, 적재는 사용자가 했습니다. upstream 에 열린 이슈 두 건(2026-09-27)이 모두 이 단계입니다.

- **#1386** — MySQL 8 공식 Docker 이미지의 초기화(`/docker-entrypoint-initdb.d`)로 넣으면 한글이 이중 인코딩됩니다. 초기화의 `mysql` 클라이언트가 스크립트를 latin1 로 읽어 utf8mb4 열에 다시 인코딩하기 때문입니다. 실측: `상담답변관리`(`EC8381EB…`)가 `C3ACC692…` 로 저장됨.
- **#1387** — latin1 클라이언트로 넣은 뒤 로그인 조회가 `Illegal mix of collations` 로 실패. 테이블에 문자셋·정렬 규칙이 없어 서버 기본값(버전·설정마다 다름)을 따르고, 연결 정렬 규칙과 섞이기 때문입니다.

추가로 실측에서 찾은 것: **선별본이 외래키 부모 테이블을 빠뜨립니다.** `bbs`·`cmm` 등 여러 컴포넌트의 목록에 `COMTCCMMNDETAILCODE` 가 있지만 그 부모 `COMTCCMMNCODE`·`COMTCCMMNCLCODE` 는 `sym.ccm.*` 에만 있어, 그것을 조립하지 않으면 정의가 없습니다. MySQL 은 원본 스크립트에 외래키가 있어도(검사 꺼짐) 넘어가지만 PostgreSQL 은 `relation "comtccmmncode" does not exist` 로 멈춥니다.

## 결정

- **문장 단위 재구성**: 파일을 그대로 이어 붙이지 않고 문장으로 나눕니다(따옴표·`''`·`--`·`/* */`·`$$` 를 지킴). 스키마(CREATE·ALTER·COMMENT·DROP)와 데이터(INSERT·UPDATE·DELETE·MERGE)를 가르고, 정규화한 본문이 같은 문장은 한 번만(선별본이 공유 테이블을 겹쳐 담음 — 공식 4종 조립에서 432개), 원본의 `SET`·`COMMIT`·`USE` 는 빼고 우리 머리말을 둡니다.
- **순서**: CREATE TABLE·VIEW 를 외래키(`REFERENCES`)·뷰(`FROM`·`JOIN`) 참조로 위상 정렬(원래 순서 안정, 순환은 원래 순서). 인덱스·ALTER·COMMENT 는 테이블 뒤 원래 순서. 데이터는 대상 테이블 순서(같은 테이블 안은 원래 순서) — 부모 행이 먼저.
- **빠진 참조 보완**: 선별본의 CREATE 가 참조하는데 정의가 없는 테이블을 통합 스크립트에서 연쇄로 가져옵니다(정의·인덱스·그 테이블의 INSERT). 통합 스크립트는 프로젝트의 `script/` 가 있으면 그것, 없으면 매니페스트에 기록된 고정 커밋(없으면 카탈로그 고정 커밋) 아카이브 — 조립 때와 같은 검증된 다운로드입니다. 카탈로그의 테이블 목록을 고치는 대신 여기서 보완한 이유: 목록은 upstream 매퍼에서 생성되고(재생성하면 다시 빠짐), 보완은 실제 적재가 요구하는 것만 정확히 더합니다.
- **문자셋을 스크립트에 고정**: MySQL·MariaDB 는 테이블마다 `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`(없으면 붙이고 다른 문자셋이면 바꿈, 이미 utf8mb4+COLLATE 면 그대로)와 첫 줄 `SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`. 클라이언트·서버 설정과 무관하게 같은 바이트·같은 정렬 규칙이 됩니다 — 사용자에게 "클라이언트 옵션을 맞추라"고 안내하는 대신 스크립트가 스스로 맞춥니다. `SET FOREIGN_KEY_CHECKS=0/1` 로 순환 참조도 견딥니다. PostgreSQL 은 `SET client_encoding='UTF8'` + `--encoding=UTF8` DB.
- **산출물은 새 파일만**: `scripts/egovframe-db/<db>/01-schema.sql`·`02-data.sql`·(`03-comment.sql`)·`docker-compose.db.yml`. 같은 내용이면 그대로, 다르면 거부 — 덮어쓰기 옵션이 없어 비파괴(`destructiveHint: false`)입니다. compose 는 배포 산출물(`catalog/deploy-rules.json`)과 같은 이미지·문자셋 인자, 설정 파일의 DB 이름·계정·포트, 비밀번호는 `DB_PASSWORD` 필수 환경 변수(파일에 쓰지 않음 — 보안약점 점검의 하드코드 비밀값 규칙과도 충돌하지 않음), 포트는 `127.0.0.1` 에만.
- **확인은 실제 DB 로**: `run=true` 는 준비본을 임시 디렉터리에 두고 공식 이미지의 초기화로 넣습니다(사용자가 compose 로 하는 것과 같은 경로). 초기화 완료 문구로 끝을 알고, 컨테이너가 멈추면 오류 줄을 모읍니다. 그 뒤 `information_schema` 테이블 수 = 준비한 수, 필수 행(`COMTNEMPLYRINFO`·`COMTNMENUINFO`·`COMTCCMMNCODE`·`COMTECOPSEQ`·`COMTNAUTHORINFO` 중 데이터에 있는 것)의 행 수 ≥ INSERT 수, 한글 왕복(데이터의 첫 한글 값을 키로 다시 읽어 HEX 비교 — 터미널 인코딩에 흔들리지 않게). Oracle·Tibero·Altibase·CUBRID·Goldilocks 는 공개 이미지 규칙이 없어 스크립트·명령만입니다.

## 범위 밖

운영 DB 적재(접속 정보는 개발용 compose 의 것), 스키마 비교·마이그레이션(Flyway 류), 데이터 이관, 상용 DB 컨테이너.

## 검증

- `test:database`(게이트, 52단언, 가짜 docker): 문장 나누기·분류·참조 순서, 문자셋 교정 3경우, PostgreSQL·Oracle 머리말, INSERT 해석·한글 확인 대상, 빠진 참조 연쇄 보완, 원본 선택(매니페스트 순서·이름 규칙·지정)·DbType 결정·별칭, 접속 정보, compose·명령, dryRun 무기록·같은 내용 재실행·다른 내용 거부, 거부 경계 6, run(데몬 없음·통과·초기화 오류·keep·Oracle), diagnose 의 DB 준비 줄, MCP·CLI.
- `test:database-live`(CI 통합, Docker): 공통컴포넌트 고정 커밋 전체를 MySQL 8.4·PostgreSQL 16 에 적재(오류 0·테이블 182·필수 행·한글), #1386 재현(원본은 이중 인코딩, 준비본은 그대로), #1387 조건(latin1 클라이언트: 원본은 깨짐, 준비본은 그대로·`utf8mb4_unicode_ci`), 조립 4종 PostgreSQL(빠진 참조 보완 후 통과), `docker compose config`. `DB_LIVE_REGISTRY` 로 이미지 레지스트리를 바꿉니다.
