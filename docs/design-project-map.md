# 프로젝트 구조 지도·변경 영향 설계 (`map_egovframe_project`, v1.14.0)

## 1. 문제

인수인계·유지보수 투입 때 "이 테이블을 바꾸면 어디가 영향받나", "이 화면은 어느 서비스·매퍼를 타나"를 코드 검색으로 찾습니다. 공공 SI 는 인수인계 문서(화면 목록·프로그램 목록·테이블 정의서)를 의무로 남기는데 손으로 만듭니다. 공통컴포넌트 5.0.7 만 해도 Java 1,097 · 매퍼 XML 1,224(네임스페이스 149 × DB 8종) · JSP 788 · Controller 164 라 사람이 따라가기엔 큽니다.

## 2. 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 해석 방식 | 정적 — 파일·정규식·간단한 심볼 테이블(`src/project-map.ts`). 런타임 추적·바이트코드 분석 없음 | 빌드 없이, 어떤 프로젝트든, 1초 안에. 5.0.7 전체 0.7초 |
| 노드 | `table` · `mapper`(네임스페이스) · `class`(역할) · `url` · `view` | 인수인계 표 3종이 필요로 하는 단위 |
| 매퍼 단위 | XML 파일이 아니라 **네임스페이스**. `_SQL_mysql`·`_SQL_oracle` 같은 DB 별 사본은 한 노드로, 같은 id 의 문장은 테이블 합집합 | 공통컴포넌트는 매퍼마다 DB 8종 사본 — 파일 단위면 그래프가 8배 |
| 테이블 추출 | SQL 본문(CDATA·동적 태그 제거)에서 `FROM`·`JOIN`·`INTO`·`UPDATE`·`DELETE FROM` 뒤 식별자(쉼표 조인·스키마 접두어 포함), 괄호 서브쿼리는 건너뜀, `${…}`·`#{…}` 는 미해석으로 셈, SQL 키워드(`DUAL`·`WAIT`·`ROWNUM`…)는 제외 | 파서 없이 공통컴포넌트 1,260 문장에서 카탈로그 테이블 170 전부를 찾았다 |
| 클래스 → 매퍼 | `EgovComAbstractDAO`/`EgovAbstractMapper` 의 `selectList("네임스페이스.id")` 류 문자열(네임스페이스는 FQN 또는 단순명으로 대조), `@Mapper` 인터페이스는 FQN = 네임스페이스. iBatis 식 `id="네임스페이스.문장"` 도 짧은 id 로 맞춘다 | 3.x 부터 5.x 까지 공통컴포넌트와 Boot 템플릿이 쓰는 두 규약 |
| 주입 | `@Resource(name="빈")` 은 빈 이름(`@Service("빈")`)으로 구현체에, `@Autowired`·생성자 주입은 타입으로 — 인터페이스면 구현체가 하나일 때 구현체로. `implements` 간선은 따로 | 공통컴포넌트는 빈 이름 주입, Boot 는 타입 주입 |
| URL | 클래스 `@RequestMapping` + 메서드 `@*Mapping`(괄호 없는 `@GetMapping` 포함, `RequestMethod.X`·HTTP 메서드를 detail 로). `forward:`·`redirect:` 는 Controller → URL `links` | 화면 목록의 열 |
| 화면 | `return "…/…"`·`new ModelAndView("…")`·`setViewName` 의 `/` 를 포함한 리터럴을 뷰 이름으로, JSP·Thymeleaf 파일에 접미 일치. 못 찾으면 이름 그대로 노드(미해석으로 셈). 화면 안의 `/….do`·`@{/…}`·`form action` 은 화면 → URL `links`(정적 자원 경로 제외). 아무 데도 닿지 않는 JSP(조각·정적)는 노드로 두지 않음 | 788 JSP 중 영향 분석에 의미 있는 것만 |
| 영향 방향 | "사용" 간선은 위 → 아래(view→url→class→mapper→table). 테이블은 위로, URL·화면은 아래로(+ 링크하는 화면·렌더링하는 Controller 한 단계), 클래스는 양쪽. 테이블은 끝점(다른 매퍼로 번지지 않음). 닿은 화면이 링크하는 모든 URL 로 번지지 않게 화면의 링크는 시작 화면에서만 | `impact(url)` 이 프로젝트 전체로 번지던 첫 구현의 교훈 |
| 문장 단위 정밀도 | 테이블에서 위로 갈 때 그 테이블을 읽고 쓰는 **문장을 부르는** 클래스만, 클래스에서 아래로 갈 때 **부른 문장의** 테이블만(인터페이스 매핑은 전체) | 매퍼 하나에 테이블 10개가 섞여 있어 매퍼 단위면 과대평가 |
| 고아 | 호출하는 Java 가 없는 매퍼 네임스페이스, 부르는 곳 없는 문장, URL 없는 Controller, 카탈로그는 아는데 참조되지 않는 컴포넌트 테이블 | 인수인계 때 "쓰지 않는 코드" 질문 |
| 공통컴포넌트 | 파일을 그대로 파싱하고 카탈로그 경로 접두어로 `component` 를 붙인다. 카탈로그 테이블은 "참조 여부" 대조에만 | 기획은 "카탈로그로 미리 채운다"였지만 파싱이 0.7초라 미리 채울 이유가 없고, 파싱이 실제 코드를 반영한다 |
| 산출물 | Markdown(요약·영향·표 3종·고아), JSON(nodes·edges·statements·handover), Mermaid(components 또는 impact 로 좁힌 200 노드 이하). 납품 패키지 `map/`(md·json·CSV 3종), 진단 요약 한 줄 | Mermaid 전체는 수천 노드라 그릴 수 없다 |
| 읽기 전용 | `readOnlyHint`, 디스크 변경 없음 | — |

범위 밖(기획대로): 런타임 호출 추적, 동적 SQL(`${}` 테이블 이름)의 완전한 해석, 프런트(React) 라우팅, 리플렉션, 코드 수정.

## 3. 검증

- 게이트 `test:project-map`(48단언, 오프라인): SQL 테이블 추출 6종, 픽스처 프로젝트(표준프레임워크 규약 DAO + Boot `@Mapper` + 공통컴포넌트 경로)의 노드·간선 기대값(DB 사본 병합, reads/writes 문장 id, 빈 이름·생성자·인터페이스 주입, URL 메서드, forward·redirect, 뷰 접미 일치·미해석, 화면 링크·주석 제외, `src/test` 제외), impact 네 방향과 문장 단위 정밀도, 고아 3종·미참조 컴포넌트 테이블, 해석 실패율, 인수인계 표 3종, Markdown·Mermaid(범위·상한), components 범위, 멀티 모듈, CRUD 생성물(classic·boot)이 테이블 → URL(→ JSP)까지 끊김 없음, 납품 패키지 `map` 항목, 진단 요약, MCP 41종·CLI.
- CI 통합 `test:project-map-live`: 공식 공통컴포넌트 v5.0.7 전체 — 60초 이내(실측 0.7초), 해석 실패율 5% 이하(0.9%), 카탈로그 테이블 170 전부 참조, impact 세 방향이 끝까지 닿음, 인수인계 표 크기 = 그래프 수치; 코퍼스 v4.3.2 와 비교(URL +42 −36).

## 4. 기획과 달라진 점

- "공통컴포넌트는 카탈로그로 미리 채운다"를 하지 않았다 — 전체 파싱이 1초 미만이고, 카탈로그는 참조 대조(미참조 테이블)에 쓴다.
- 매퍼 간선을 문장 단위로 좁혔다 — 기획에는 없던 정밀도이지만, 공통컴포넌트의 매퍼 하나가 테이블 여럿을 섞어 쓰기 때문에 없으면 영향이 과대평가된다.
- Mermaid 는 범위를 좁힌 경우에만(200 노드 상한) — 기획대로.

## 5. 매퍼·DAO 정합성 (v1.19)

구조 지도가 읽던 매퍼 XML·DAO 문자열 호출을 **정합성**으로 본다(`src/mapper-check.ts`, `validate_egovframe_project` 의 `mapper` 검사). 지도는 "어디가 이어지나"를, 정합성은 "이어져야 하는데 끊긴 곳"을 답한다. 지도 해석과 따로 둔 이유는 줄 번호·동적 ID·DB 별 사본을 문장 단위로 봐야 해서다(지도는 namespace 단위로 합친다).

| 항목 | 결정 |
|---|---|
| 호출 | `selectList`·`selectOne`·`insert`·`update`·`delete`·`list`·`listWithPaging` 등의 첫 인자가 문자열 리터럴(`"NS.id"`)이면 문장 참조, `"NS.prefix" + x` 면 이어 만든 ID(접두가 맞는 문장이 있으면 통과). namespace 는 FQN 또는 단순명(유일할 때) |
| 인터페이스 | FQN 이 XML namespace 와 같은 인터페이스의 추상 메서드(애노테이션 SQL·default·static 제외) |
| id 정규화 | `id="ns.x"` → `x`(MyBatis `applyCurrentNamespace` 와 같음) — 공통컴포넌트의 DB 별 차이 15곳(선행 조사)은 전부 이것이었고 정규화 뒤 0 |
| DB 별 사본 | 파일명 `*_SQL_<db>.xml`·`_<db>.xml` 또는 경로의 DB 디렉터리. 같은 namespace 의 DB 사본 사이 id 집합 차이를 보고, `Globals.DbType` 의 DB 에서 빠지면 오류 |
| 중복 | 같은 파일 안, 그리고 같은 namespace·같은 DB(또는 DB 무관 파일)로 함께 올라가는 파일 사이 — MyBatis 는 같은 namespace 를 여러 파일이 나눠 쓰는 것은 허용한다 |
| 후보 | 같은 namespace 의 문장 중 편집 거리 ≤ max(3, 길이 40%) 또는 한쪽이 다른 쪽의 부분열 — 부분열(글자를 끼우거나 뺀 이름)을 먼저. upstream 10-26 수정의 정답(`selectAdministCodeList` → `selectAdministCodeRecptnList` 등) 5/5 가 1순위 |
| 범위 밖 | 자동 수정, SQL 문법·컬럼 존재(DB 필요 — v1.10), iBATIS `sqlMap`, 애노테이션 SQL 본문, 매퍼가 의존성 jar 안에 있는 경우(프로젝트에 매퍼 XML 이 하나도 없으면 문자열 호출을 보고하지 않음) |

검증: 게이트 `test:mapper-check`(19단언) — 종류별 양성·음성, 주석·CDATA·테스트 제외, 동적 ID, DbType, id 정규화, validate·CLI·평가서. CI 통합 `test:mapper-check-live`(11단언) — 공통컴포넌트 v5.0.7 = 10곳(수정 6 + 미수정 4), main = 4곳, 공식 템플릿 6종은 보고 항목마다 모든 매퍼 XML 을 다시 읽어 독립 확인(오탐 0), 공통컴포넌트 전체 3초 이내(실측 0.6초).

