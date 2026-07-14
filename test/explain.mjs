// node test/explain.mjs — 오프라인 컴포넌트 설명 검증
import { explainComponent } from "../dist/index.js";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }
const e = explainComponent("bbs");
assert(e.id === "bbs", "bbs id");
assert(e.dependsOn.includes("cmm"), "직접 의존 cmm");
assert(e.transitiveDeps.includes("cmm"), "전이 의존 cmm");
assert(e.tables.length > 0, "참조 테이블 존재");
assert(e.docs.length > 0 && e.docs.every((d) => d.url.includes("egovframe-docs/blob/main/")), "가이드 URL 형식");
assert(Array.isArray(e.dependents), "dependents 배열");
assert(e.installHint.includes("add_egovframe_components"), "설치 힌트");
let threw = false; try { explainComponent("zzz-nonexistent"); } catch { threw = true; }
assert(threw, "미존재 id 예외");
if (process.exitCode) console.error("explain FAIL"); else console.log("explain OK");
