# Compose Specification JSON 스키마 (테스트 전용)

`test/deploy.mjs` 가 생성한 `deploy/docker-compose.yml` 을 공식 Compose 스키마로 검증할 때 씁니다(패키지에는 포함되지 않음).

- 출처: <https://github.com/compose-spec/compose-spec> commit `914ec15d1fa498969c0df5c1d672306db3256089`, `schema/compose-spec.json` (Apache-2.0)
- `compose-spec.json` 89,808 bytes, sha256 `d61cc3df8c6e6a727043e84f3405c69ffd63d341f629db8480f1d2ee5405b10c`
- JSON Schema draft 2020-12 — 검증 도우미는 `ajv/dist/2020` 으로 컴파일합니다.
