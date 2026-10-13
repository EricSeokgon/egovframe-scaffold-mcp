# SARIF 2.1.0 JSON 스키마 (테스트 전용)

`test/secure-coding.mjs`·`test/secure-live.mjs` 가 이 서버가 만든 SARIF 를 공식 스키마로 검증할 때 씁니다(패키지에는 포함되지 않음).

- 출처: OASIS SARIF TC, <https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json> (SARIF v2.1.0 Errata 01, OASIS Standard)
- `sarif-schema-2.1.0.json` 112,768 bytes, sha256 `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e`
- draft-04 스키마라 검증 도우미(`test/spec-schemas.mjs`)가 최상위 `id` 를 `$id` 로 옮기고 `$schema` 를 떼어 ajv(draft-07)로 컴파일합니다.
