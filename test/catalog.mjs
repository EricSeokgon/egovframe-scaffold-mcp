// 카탈로그(M1) 검증 — 네트워크 불필요
import { loadCatalog, resolveComponents, addComponents, searchComponents } from "../dist/index.js";
import assert from "node:assert/strict";

const catalog = loadCatalog();
assert.ok(catalog.components.length >= 3, "카탈로그 컴포넌트를 읽어야 한다");
assert.equal(catalog.schemaVersion, 2, "카탈로그 schemaVersion");
assert.ok(
  catalog.source.tag === "v5.0.6" &&
    /^[0-9a-f]{40}$/.test(catalog.source.commit) &&
    catalog.source.archive.files > 6000,
  "공식 소스 태그·커밋·파일 수를 고정해야 한다",
);
assert.ok(catalog.components.length >= 150, "리프 확장 후 150개 이상이어야 한다");
const leaves = catalog.components.filter((c) => c.pathPrefixes.length > 0);
const groups = catalog.components.filter((c) => (c.children ?? []).length > 0 && c.pathPrefixes.length === 0);
assert.ok(leaves.length >= 150 && groups.length >= 10, "리프 150개·그룹 10개 이상이어야 한다");
assert.ok(
  leaves.every((c) =>
    ["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments", "mavenDependencies"]
      .every((key) => Array.isArray(c[key]))),
  "모든 리프가 실행 자산 메타데이터를 가져야 한다",
);
assert.ok(leaves.filter((c) => c.name !== c.id).length >= 80, "자동 추출 이름이 80개 이상이어야 한다");
// 그룹 확장: sym.mnu → cmm + 하위 리프 전체
const auto = resolveComponents(catalog, ["sym.mnu"]).map((c) => c.id);
assert.ok(
  auto[0] === "cmm" && auto.length >= 4 && auto.slice(1).every((x) => x.startsWith("sym.mnu.")),
  "그룹은 cmm 의존성과 하위 리프로 확장되어야 한다",
);
// 그룹+하위 동시 요청 시 중복 제거
const g2 = resolveComponents(catalog, ["cop.smt", "cop.smt.mrm"]).map((c) => c.id);
assert.equal(g2.filter((x) => x === "cop.smt.mrm").length, 1, "그룹·리프 중복 요청을 제거해야 한다");

// 의존성 해석: bbs 요청 → cmm이 먼저
const order = resolveComponents(catalog, ["bbs"]).map((c) => c.id);
assert.deepEqual(order, ["cmm", "bbs"], "bbs보다 cmm 의존성을 먼저 설치해야 한다");

// 중복 요청·다중 요청 시 중복 제거
const order2 = resolveComponents(catalog, ["bbs", "login", "cmm"]).map((c) => c.id);
assert.equal(order2.filter((x) => x === "cmm").length, 1, "다중 요청의 cmm 중복을 제거해야 한다");

// 의존성 미포함 옵션
const order3 = resolveComponents(catalog, ["bbs"], false).map((c) => c.id);
assert.deepEqual(order3, ["bbs"], "의존성 미포함 옵션을 반영해야 한다");

// 알 수 없는 id는 오류
assert.throws(() => resolveComponents(catalog, ["nope"]), "알 수 없는 컴포넌트 ID를 거부해야 한다");

// dryRun 미리보기
const p = await addComponents({ projectDir: "/tmp/x", components: ["bbs", "login"], dryRun: true });
assert.ok(p.totalFiles > 0, "dryRun 설치 계획에 파일이 있어야 한다");

// 실제 조립은 존재하는 프로젝트 디렉터리가 필요
await assert.rejects(
  () => addComponents({ projectDir: "/tmp/no-such-dir-abc", components: ["bbs"], dryRun: false }),
  "존재하지 않는 프로젝트 디렉터리를 거부해야 한다",
);

// 검색 (v0.5.0)
const s1 = searchComponents(catalog, "게시판");
assert.ok(s1.length > 0 && s1[0].id === "bbs", "한글 게시판 검색은 bbs를 먼저 반환해야 한다");
const s2 = searchComponents(catalog, "bbs");
assert.ok(s2[0].id === "bbs" && s2[0].score >= 100, "정확한 ID 검색은 높은 점수로 bbs를 반환해야 한다");
const s3 = searchComponents(catalog, "로그인");
assert.ok(s3.some((r) => r.id === "login"), "로그인 검색 결과에 login이 있어야 한다");
const s4 = searchComponents(catalog, "없는키워드xyz");
assert.equal(s4.length, 0, "없는 검색어는 빈 결과여야 한다");

// 가이드 문서 매핑 (v0.7.0)
const bbsComp = catalog.components.find((c) => c.id === "bbs");
assert.ok(
  Array.isArray(bbsComp.docs) && bbsComp.docs.length >= 3 && bbsComp.docs[0].path.startsWith("common-component/"),
  "bbs 가이드 문서를 매핑해야 한다",
);
assert.ok(
  bbsComp.messageBundles.length === 2 &&
    bbsComp.idgnContexts.some((p) => p.endsWith("context-idgn-bbs.xml")) &&
    bbsComp.webAssets.length > 10,
  "bbs 실행 자산을 완전하게 매핑해야 한다",
);
const security = catalog.components.find((c) => c.id === "sec.security");
assert.ok(
  security?.pathPrefixes.some((p) => p.includes("sec/security")) === true && security.approxFiles >= 3,
  "sec.security 패키지를 탐지해야 한다",
);
console.log("catalog OK");
