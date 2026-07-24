// 카탈로그(M1) 검증 — 네트워크 불필요
import { loadCatalog, resolveComponents, addComponents, searchComponents } from "../dist/index.js";

const catalog = loadCatalog();
console.log("catalog loaded:", catalog.components.length >= 3);
console.log("schema version:", catalog.schemaVersion === 2);
console.log("source pinned:", catalog.source.tag === "v5.0.6" && /^[0-9a-f]{40}$/.test(catalog.source.commit) && catalog.source.archive.files > 6000);
console.log("coverage >= 150 (leaf expansion):", catalog.components.length >= 150);
const leaves = catalog.components.filter((c) => c.pathPrefixes.length > 0);
const groups = catalog.components.filter((c) => (c.children ?? []).length > 0 && c.pathPrefixes.length === 0);
console.log("leaves >= 150 / groups >= 10:", leaves.length >= 150 && groups.length >= 10);
console.log("complete asset metadata:", leaves.every((c) => ["messageBundles", "idgnContexts", "schedulingContexts", "webAssets", "webFragments", "mavenDependencies"].every((key) => Array.isArray(c[key]))));
console.log("auto names extracted:", leaves.filter((c) => c.name !== c.id).length >= 80);
// 그룹 확장: sym.mnu → cmm + 하위 리프 전체
const auto = resolveComponents(catalog, ["sym.mnu"]).map((c) => c.id);
console.log("group expansion ok:", auto[0] === "cmm" && auto.length >= 4 && auto.slice(1).every((x) => x.startsWith("sym.mnu.")));
// 그룹+하위 동시 요청 시 중복 제거
const g2 = resolveComponents(catalog, ["cop.smt", "cop.smt.mrm"]).map((c) => c.id);
console.log("group+leaf dedupe:", g2.filter((x) => x === "cop.smt.mrm").length === 1);

// 의존성 해석: bbs 요청 → cmm이 먼저
const order = resolveComponents(catalog, ["bbs"]).map((c) => c.id);
console.log("deps resolved (cmm before bbs):", JSON.stringify(order) === '["cmm","bbs"]');

// 중복 요청·다중 요청 시 중복 제거
const order2 = resolveComponents(catalog, ["bbs", "login", "cmm"]).map((c) => c.id);
console.log("dedupe ok:", order2.filter((x) => x === "cmm").length === 1);

// 의존성 미포함 옵션
const order3 = resolveComponents(catalog, ["bbs"], false).map((c) => c.id);
console.log("no-deps ok:", JSON.stringify(order3) === '["bbs"]');

// 알 수 없는 id는 오류
try { resolveComponents(catalog, ["nope"]); console.log("unknown-id guard: FAIL"); }
catch { console.log("unknown-id guard: OK"); }

// dryRun 미리보기
const p = await addComponents({ projectDir: "/tmp/x", components: ["bbs", "login"], dryRun: true });
console.log("preview total>0:", p.totalFiles > 0, "| order:", p.installOrder.map((c) => c.id).join(","));

// 실제 조립은 존재하는 프로젝트 디렉터리가 필요
try { await addComponents({ projectDir: "/tmp/no-such-dir-abc", components: ["bbs"], dryRun: false }); console.log("dir guard: FAIL"); }
catch { console.log("dir guard: OK"); }

// 검색 (v0.5.0)
const s1 = searchComponents(catalog, "게시판");
console.log("search korean:", s1.length > 0 && s1[0].id === "bbs");
const s2 = searchComponents(catalog, "bbs");
console.log("search id:", s2[0].id === "bbs" && s2[0].score >= 100);
const s3 = searchComponents(catalog, "로그인");
console.log("search login:", s3.some((r) => r.id === "login"));
const s4 = searchComponents(catalog, "없는키워드xyz");
console.log("search empty:", s4.length === 0);

// 가이드 문서 매핑 (v0.7.0)
const bbsComp = catalog.components.find((c) => c.id === "bbs");
console.log("bbs docs mapped:", Array.isArray(bbsComp.docs) && bbsComp.docs.length >= 3 && bbsComp.docs[0].path.startsWith("common-component/"));
console.log("bbs runtime assets:", bbsComp.messageBundles.length === 2 && bbsComp.idgnContexts.some((p) => p.endsWith("context-idgn-bbs.xml")) && bbsComp.webAssets.length > 10);
const security = catalog.components.find((c) => c.id === "sec.security");
console.log("security package detected:", security?.pathPrefixes.some((p) => p.includes("sec/security")) === true && security.approxFiles >= 3);
