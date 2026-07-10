// 카탈로그(M1) 검증 — 네트워크 불필요
import { loadCatalog, resolveComponents, addComponents } from "../dist/index.js";

const catalog = loadCatalog();
console.log("catalog loaded:", catalog.components.length >= 3);
console.log("schema version:", catalog.schemaVersion === 1);

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
console.log("preview total>0:", p.totalApproxFiles > 0, "| order:", p.installOrder.map((c) => c.id).join(","));

// M1: 실제 조립은 거부
try { await addComponents({ projectDir: "/tmp/x", components: ["bbs"], dryRun: false }); console.log("m1 guard: FAIL"); }
catch { console.log("m1 guard: OK"); }
