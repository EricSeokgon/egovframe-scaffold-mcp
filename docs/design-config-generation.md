# 설정 파일 생성 설계 (v0.28.0) — `generate_egovframe_config`

## 배경

공식 eGovFrame VSCode Initializr 는 프로젝트 생성 외에 **설정 파일 생성 마법사** 21종을 제공합니다(`templates/templates-context-xml.json`). datasource·transaction·cache·logging·scheduling·idGeneration·property 설정을 폼으로 입력받아 Handlebars 템플릿(`templates/config/<folder>/*.hbs`)으로 XML·JavaConfig·YAML·properties 를 만듭니다. v0.26.0 통합 카탈로그가 이 21종을 `configWizards` 로 이미 목록화했고, 이번에 실제 생성 도구로 연결합니다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 템플릿 조달 | **패키지에 동봉**(`catalog/config-templates/`, 49파일 약 256KB) | 설정 생성은 폐쇄망에서도 써야 한다. 파일이 작고 Apache-2.0 이라 동봉이 가능하며, `NOTICE.md` 로 출처를 밝힌다 |
| 고정 | Initializr commit + 파일별 sha256 (`catalog/config-templates.json`) | 렌더링 전에 동봉 파일의 지문을 대조해 패키지 변조·손상을 감지한다. `sync_egovframe_templates` 가 upstream 의 같은 경로 파일과 대조해 drift 를 보고한다 |
| 렌더러 | `handlebars` 런타임 의존성 추가, Initializr 와 같은 헬퍼(`eq`·`ne`·`capitalize`·`trim`·`or`) 등록 | 템플릿이 inline partial·`else if`·서브표현식을 쓰므로 자체 구현은 위험하다. `noEscape` 로 XML 특수문자를 그대로 둔다(Initializr 와 동일) |
| 입력 체계 | Initializr 폼의 필드명(`txtDatasourceName`, `rdoType` …)과 **기본값을 그대로** 사용 | IDE 와 대화형 도구의 경험을 맞추고, 필드를 생략해도 Initializr 와 같은 결과가 나온다 |
| 큐레이션 | `catalog/config-mapping.json` — MCP id, 기본값, 기본 파일명, 선택지, 제외 형식 | 생성기는 매핑에 없는 upstream 항목, 기본값 없는 템플릿 변수, upstream 에 없는 매핑을 만나면 실패한다 |
| 검증 | 템플릿에 없는 필드·선택지 밖 값 거부, 파일명·클래스명·패키지 형식 검사 | 잘못된 입력이 조용히 빈 값으로 렌더링되지 않게 한다 |
| 출력 위치 | xml → `src/main/resources/egovframework/spring`(logging 은 `src/main/resources`, cache 는 `egovProps`), yaml·properties → `src/main/resources`, javaConfig → `src/main/java/<패키지>` | 표준프레임워크 템플릿의 관례. `outputDir` 로 바꿀 수 있으나 프로젝트 안이어야 한다(`..`·절대경로·symlink 이탈 거부) |
| 충돌 | 기존 파일이 있으면 아무것도 쓰지 않고 거부 (`wx` 플래그) | 다른 도구와 같은 원칙 |
| 비밀 | 결과의 `context` 에서 `passw` 를 포함한 필드는 가린다 | 대화 로그에 비밀번호가 남지 않게 한다 |

## upstream 에서 발견한 문제와 대응

- `Logging > New Time-Based Rolling File Appender` 의 `javaConfigTemplate` 이 가리키는 `timeBasedRollingFile-java.hbs` 가 저장소에 없다(있는 것은 `dailyRollingFile-java.hbs`). 그 형식만 제외하고 `upstreamMissing` 에 사유를 기록한다.
- `Logging > New JDBC Appender` 의 `jdbc-properties.hbs` 는 이름과 달리 XML 내용이다. `excludeFormats` 큐레이션으로 제외하고 사유를 남긴다.
- 같은 템플릿의 웹뷰 폼은 비밀번호를 `txtPasswrd`(오타)로 보내지만 템플릿은 `txtPasswd` 를 참조한다(Initializr 에서는 빈 비밀번호가 나온다). MCP 는 템플릿이 참조하는 `txtPasswd` 를 쓴다.

## 도구 인터페이스

```text
generate_egovframe_config(
  projectDir, configId, format="xml", fields?, fileName?, outputDir?, dryRun=false
)
```

- `configId`: `cache-ehcache-default` `cache-spring` `datasource` `datasource-jndi` `idgen-sequence` `idgen-table` `idgen-uuid` `logging-console` `logging-file` `logging-rolling-file` `logging-time-rolling-file` `logging-jdbc` `property` `scheduling-bean-job` `scheduling-method-job` `scheduling-simple-trigger` `scheduling-cron-trigger` `scheduling-scheduler` `transaction-datasource` `transaction-jpa` `transaction-jta`
- 리소스 `egovframe://catalog/config-templates` 가 템플릿별 형식·필드·기본값·선택지를 돌려준다.

## 고정값 갱신 절차

1. `sync_egovframe_templates()` 의 `configTemplates.drift` 로 달라진 파일을 확인한다.
2. upstream 변경을 검토한다(새 변수가 생기면 `config-mapping.json` 에 기본값을 추가해야 생성기가 통과한다).
3. `npm run generate:config-catalog -- --commit <새 commit>` 을 실행한다. 동봉 파일과 `config-templates.json` 이 다시 만들어진다.
4. `npm run build && npm run test:config` 로 확인한다.

## 검증

- 오프라인(`npm run test:config`): 카탈로그·동봉 파일 지문, 49건 전 형식 기본값 렌더링(자리표시자 잔존 없음, xml/yaml/properties/java 형태), 분기(C3P0/DBCP/JDBC, ConnectionFactory, External File, Address, AOP 끔), 필드·선택지·파일명·패키지 거부, dryRun 무기록, 실제 생성, 충돌 거부와 기존 파일 불변, 비밀번호 가림, `..`·절대경로·symlink 이탈 거부
- 수동: 49건 출력의 XML·YAML 파싱, JavaConfig `datasource`·`datasource-jndi` 를 Spring 6.1 + DBCP2 + C3P0 로 `mvn compile` 통과
- `sync_egovframe_templates` 가 실제 upstream 과 49파일 대조해 차이 0건
