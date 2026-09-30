// node test/network-live.mjs — 실제 호스트 프로브 (네트워크, CI integration 전용)
import { diagnoseNetwork, renderNetworkMarkdown } from "../dist/index.js";
let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const r = await diagnoseNetwork({ timeoutMs: 20_000 });
console.log(renderNetworkMarkdown(r));
assert(r.hosts.length === 7, "호스트 7종 프로브");
for (const h of r.hosts) assert(h.ok, `${h.host} 도달 (${h.http.kind}${h.http.error ? `: ${h.http.error}` : ""}, ${h.http.ms}ms)`);
assert(r.hosts.every((h) => h.dns.ok && h.dns.addresses.length > 0), "DNS 조회 성공");
if (process.exitCode) console.error(`network-live FAIL (${n})`); else console.log(`network-live OK (${n})`);
