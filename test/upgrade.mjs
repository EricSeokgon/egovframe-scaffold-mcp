// node test/upgrade.mjs — 오프라인: 판정 로직 + 매니페스트 없음 예외
import { classifyUpgrade, upgradeProject } from "../dist/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }
const H = "sha256:a", H2 = "sha256:b", H3 = "sha256:c";
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: H }) === "unchanged", "unchanged");
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: H2 }) === "update", "update");
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H2, upstreamHash: H }) === "user-modified", "user-modified");
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H2, upstreamHash: H3 }) === "conflict", "conflict(양쪽 변경)");
assert(classifyUpgrade({ currentHash: H, upstreamHash: H }) === "unchanged", "v1 동일 → unchanged");
assert(classifyUpgrade({ currentHash: H, upstreamHash: H2 }) === "conflict", "v1 상이 → conflict(보수)");
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: undefined, upstreamHash: H }) === "added", "added");
assert(classifyUpgrade({ baselineHash: H, baselineSrcHash: H, currentHash: H, upstreamHash: undefined }) === "removed", "removed");
let threw = false;
try { await upgradeProject({ projectDir: mkdtempSync(path.join(tmpdir(), "eu-")) }); } catch { threw = true; }
assert(threw, "매니페스트 없으면 예외(네트워크 전)");
if (process.exitCode) console.error("upgrade FAIL"); else console.log("upgrade OK");
