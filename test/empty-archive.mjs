// 빈 아카이브 방어 회귀 테스트 — 네트워크 불필요.
//
// createProject·addComponents·addAiComponents 는 다운로드한 zip 의 entries[0] 에
// 접근하는데, 아카이브가 비어 있으면(잘린 다운로드·잘못된 ref·빈 저장소 등) 예전엔
// "Cannot read properties of undefined (reading 'entryName')" 같은 TypeError 로 실패했다.
// archiveRootPrefix 가드가 명확한 Error 로 먼저 실패시키는지 검증한다.
import { archiveRootPrefix } from "../dist/index.js";
import assert from "node:assert/strict";

// 1) 빈 엔트리: TypeError 가 아니라 지정한 메시지의 Error 를 던져야 한다.
assert.throws(
  () => archiveRootPrefix([], "아카이브가 비어 있습니다"),
  (e) => e instanceof Error && !(e instanceof TypeError) && /비어 있습니다/.test(e.message),
  "빈 엔트리는 명확한 Error(비-TypeError)를 던져야 한다",
);

// 2) 정상 엔트리: 최상위 디렉터리 접두사를 반환한다.
assert.equal(
  archiveRootPrefix([{ entryName: "egovframe-boot-web-main/pom.xml" }], "unused"),
  "egovframe-boot-web-main/",
  "최상위 디렉터리 접두사를 반환해야 한다",
);

console.log("empty-archive guard: OK (2 assertions)");
