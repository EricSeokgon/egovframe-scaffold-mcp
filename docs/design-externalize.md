# 설정·비밀값 외부화 설계 (`externalize_egovframe_config`, v1.13.0)

## 1. 문제

설정 파일의 DB 비밀번호 하드코딩은 모든 보안 점검의 단골 지적이고, 보안약점 점검(`hardcoded-config-password`)이 공식 공통컴포넌트 코퍼스에서 3.10.0 9건·4.3.2 8건(설정 파일 기준)을 찾습니다. 공식 템플릿도 그렇습니다 — portal-site·enterprise-business 는 `globals.properties` 에 `Globals.Password = pst01`·`ebt01` 평문, 공통컴포넌트는 표준프레임워크 암호화 값(`xz4fmrSdr1…`)을 쓰지만 복호화 키 `algorithmKey = egovframe` 와 그 해시가 같은 저장소의 `egov-crypto-config.properties`(5.x) 또는 `context-crypto.xml`(4.x)에 있어 암호화의 의미가 없습니다(runtime 5.x 는 기동 때 "default algorithm Key must be changed" 를 찍습니다). v1.7 에서 "배포 방식에 따라 답이 다름"으로 미뤘고, v0.45 배포 산출물·v1.11 기동 검증이 생겨 이제 옮긴 뒤 실제로 뜨는지까지 확인할 수 있습니다.

## 2. 선행 조사 (착수 때 확인한 것)

| 질문 | 확인 | 결과가 정한 것 |
|---|---|---|
| Classic 은 환경 변수를 읽을 수 있나 | `PropertyPlaceholderConfigurer` 는 `globals.properties` → JVM 시스템 속성 → 환경 변수(`searchSystemEnvironment`) 순으로 풀고, 값 안의 자리표시자도 재귀로 푼다. 공식 portal-site 는 같은 id `propertyConfigurer` 가 두 파일에 있어 뒤의 것(`ignoreUnresolvablePlaceholders=true`)이 이긴다 | `Globals.Password = ${EGOV_PASSWORD}` 로 바꾸면 XML 의 `${Globals.Password}` 가 환경 변수까지 풀린다. 변수가 없으면 템플릿에 따라 `Could not resolve placeholder`(config-missing) 또는 리터럴이 남아 DB 접속 실패 — 어느 쪽이든 비밀은 저장소에 없다 |
| `EgovProperties` 로 직접 읽는 키 | `FileInputStream` 으로 `globals.properties` 를 읽어 자리표시자를 풀지 않는다(`Globals.File.algorithmKey`, `Globals.fileStorePath` 등). 공통컴포넌트의 `EgovPasswordResolver.resolvePassword('Globals.mysql.Password')` 도 같은 길 | 직접 읽는 키는 자리표시자로 바꾸면 깨진다 → 수동 항목(읽는 Java 파일을 명시) |
| 5.x runtime 의 암호화 설정 | `egovframe-rte-fdl-crypto` 5.0.2 의 `EgovCryptoConfiguration` 이 `@Value("${Globals.CryptoConfigPath:}")` 로 경로를 받고, `EgovCryptoConfigReader` 가 `classpath:`·`file:`·절대 경로를 읽는다(없으면 classpath 기본 파일 → 기본값). `algorithmKeyHash` = base64(sha256(algorithmKey)) | 키 파일 자체를 저장소 밖으로: 저장소의 키 줄을 지우고 `Globals.CryptoConfigPath=${EGOV_CRYPTO_CONFIG:}` 로 외부 파일을 가리킨다. Jasypt 는 필요 없었다 |
| 4.x 의 암호화 설정 | `egov-crypto:config` 네임스페이스(`algorithmKey="…"` 속성)가 `globals.properties` 를 직접 읽어 복호화. 키를 외부 파일에서 읽는 설정이 없다 | 4.x 는 암호화 값을 그대로 두고 키를 수동 항목으로 — 5.x 전환(재조립·전환 적용) 뒤 다시 실행하면 키가 외부 파일로 간다 |
| Boot | `Environment` 가 값 안의 자리표시자를 푼다. 공식 simple-backend 의 `Globals.*.Password` 는 빈 값, boot-web 은 DB 비밀번호가 없다 | `spring.datasource.password=${SPRING_DATASOURCE_PASSWORD}` 형태 |

## 3. 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 판정 | 보안약점 점검의 `hardcoded-config-password` 규칙과 화이트리스트(`.egovframe-secure-ignore.json`)를 그대로 호출한다(`checkSecureCoding(rules=[…])`). XML 리터럴(`<property name="password" value="…"/>`, 주석 제외)·암호화 키 줄은 규칙 밖이라 따로 찾는다 | 두 도구의 결과가 같아야 "조치 뒤 0" 을 말할 수 있다. 규칙에는 따옴표 값(YAML)을 더했다 |
| 행동 | `env`(자리표시자 교체) · `crypto-path`(키 파일 외부화) · `encrypted`(암호화 값은 그대로) · `manual`(직접 읽는 키·4.x 키·배포 정의 파일·형식 해석 실패) | 읽는 방식이 다르면 같은 조치가 한쪽에서는 깨진다. 깨질 것을 조용히 바꾸지 않는다 |
| 직접 읽기 탐지 | `src/main/java` 에서 `EgovProperties.getProperty/getPathProperty("키")`·`resolvePassword('키')` 를 찾고, `${키}` 참조(XML·`@Value`)가 하나도 없으면 수동 | 읽는 코드를 결과에 적어 사람이 바로 고칠 수 있게 |
| 환경 변수 이름 | `Globals.mysql.Password` → `EGOV_MYSQL_PASSWORD`, `Globals.Password` → `EGOV_PASSWORD`, Boot 키는 `SPRING_DATASOURCE_PASSWORD`, XML 은 `EGOV_<빈 id>_PASSWORD`. 같은 이름·다른 값이면 `_2` | 키에서 기계적으로 — 배포 산출물과 문서가 같은 이름을 쓴다 |
| 줄 교체 | 값 부분만 바꾼다(들여쓰기·구분자 `=`/` = `/`:`·CRLF 보존, YAML 은 따옴표 제거) | diff 가 한 줄이고 EUC-KR·CRLF 파일을 망치지 않는다 |
| 암호화 키 | `egov-crypto-config.properties` 의 `algorithmKey`·`algorithmKeyHash` 줄을 주석(`# algorithmKey = (외부 파일로 옮김…)`)으로, `globals.properties` 끝에 `Globals.CryptoConfigPath=${EGOV_CRYPTO_CONFIG:}`, `deploy/secrets/egov-crypto-config.properties.example`(키·해시 `CHANGE_ME`, 해시 계산법) | 외부 파일은 완전한 설정이어야 한다(reader 는 한 파일만 읽음). 기본값 `:` 덕에 변수가 없으면 종전처럼 classpath 파일로 떨어진다 |
| 재암호화 | 하지 않는다. 안내만(공통컴포넌트 `EgovCryptoInfo` 화면·`EgovEnvCryptoService.encrypt`) | ARIA 구현 또는 프로젝트 classpath 로 Java 를 띄워야 한다 — 값은 운영팀이 새 키로 한 번 만든다 |
| 배포 산출물 | 있으면 `deploy/.env.example`(변수 추가)·`docker-compose.yml`(app `environment`, 암호화 파일 볼륨 `./secrets/…:/run/egov/…:ro`)·k8s `Secret`(`stringData`)을 갱신. `generate_egovframe_deploy` 는 설정의 `${EGOV_…}` 자리표시자(`DeployProfile.secretEnv`)를 읽어 같은 자리를 만든다 | 어느 순서로 돌려도 결과가 같다 |
| 값 노출 | 결과·Markdown·`externalize-plan.json`·로그에는 가린 값(앞 2자 + `***`)만. 원본은 `migration-backup/<시각>-externalize-*/` 에만 | 도구 응답이 대화 기록·CI 로그에 남는다 |
| 확인 | 적용 뒤 규칙 전·후 수. `verify=true` 면 원래 값을 환경 변수(`EGOV_CRYPTO_CONFIG` 는 백업의 원본 파일 `file:` 경로)로 주고 `verify_egovframe_startup`. 설정 해석 단계 실패(`config-missing`, 자리표시자·crypto 관련 bean-creation)면 두 번째 transaction 으로 되돌리고(백업 유지), DB 접속 실패 등은 유지 | "옮겨도 전과 같이 뜬다"가 기준. 전에도 못 뜨던 이유(DB 없음)로 되돌리면 안 된다 |
| 기본값 | `dryRun=true`, `mode=auto`, `verify=false` | 파괴적 도구 |

범위 밖(기획대로): Vault·KMS, 소스 안의 하드코드 비밀(`hardcoded-secret` — 코드 수정은 사람이), 운영 서버의 환경 변수 설정, 암호화 값 재암호화.

## 4. 검증

- 게이트 `test:externalize`(49단언, 오프라인·가짜 runner): 찾기(규칙과 같은 집합 — 빈 값·`******`·메시지 번들 제외, 화이트리스트, XML 리터럴만·주석 제외, YAML 점 경로 키, 직접 읽는 키 수동, 배포 정의 파일 수동, 결과에 원래 값 없음), 적용(값만 교체·CRLF·구분자 보존, 키 줄 주석, CryptoConfigPath, 외부 본 예시, `.env.example`·compose·Secret 갱신, 백업·plan, 전·후 수, 멱등, fault-injection 원상 복구), mode 둘, 4.x, verify 세 갈래(성공 유지·config-missing 되돌림·DB 접속 실패 유지, 환경 변수에 원래 값), `generate_egovframe_deploy` 연계, 이름 규칙·암호화 값 모양·해시, MCP 40종·CLI.
- CI 통합 `test:externalize-live`: 공식 portal-site 에 적용 + `verify=true` — `EGOV_PASSWORD`·`EGOV_CRYPTO_CONFIG` 를 주고 내장 HSQL 로 실제 기동(26초), 규칙 수 감소, 멱등; 공식 web·boot-web 은 비밀 값 0(주석 안 리터럴 오탐 없음); 코퍼스 4.3.2(암호화 8 그대로·키 수동 1)·3.10.0(암호화 7·SNS 비밀 2 자리표시자·키 수동 1).

## 5. 기획과 달라진 점

- "세 확인(지문·충돌·기동) 통과해야 쓴다" 대신 **적용 → 기동 → 실패 종류로 되돌림**: 기동은 적용된 파일로만 할 수 있고(사본 기동은 DB 가 없어 의미가 적음), 설정 해석 실패만 외부화의 책임이기 때문.
- Jasypt 는 넣지 않았다: runtime 5.x 가 이미 외부 키 파일 경로(`Globals.CryptoConfigPath`)를 지원한다. 4.x 는 5.x 전환 뒤의 일로 미뤘다(값은 그대로 두므로 깨지지 않는다).
- 코퍼스 기대값은 "4.3.2 의 18건 중 자동 N" 이 아니라 **4.x 는 자동 0** 이다 — `egov-crypto` 가 파일을 직접 읽는다는 사실이 선행 조사에서 드러났다. 그 대신 공식 5.x 템플릿(portal-site)에서 자리표시자와 키 외부화 모두 실제 기동으로 확인했다.
