// node test/network-live.mjs — 실제 호스트 프로브 (네트워크, CI integration 전용)
//   이 테스트가 보는 것은 "진단 도구가 실제 호스트에서 올바르게 동작하는가"이지 외부 서버의 가용성이 아니다.
//   v1.0.2: maven.egovframe.go.kr 이 일시적으로 응답하지 않아(20초 timeout) CI 전체가 실패한 일이 반복돼,
//   실패한 호스트는 30초 뒤 한 번 더 확인하고, 그래도 서버 쪽 장애(timeout·5xx·reset)면 경고로만 남긴다.
//   진단 자체의 이상(분류 안 된 실패·DNS 실패·처방 없음)과 러너 네트워크 붕괴(과반 실패)는 그대로 실패다.
import { diagnoseNetwork, renderNetworkMarkdown } from "../dist/index.js";
let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const warn = (msg) => { console.log(process.env.GITHUB_ACTIONS ? `::warning title=network-live::${msg}` : `warn: ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER_SIDE = new Set(["timeout", "http", "reset"]); // 러너가 아니라 상대 서버 쪽으로 볼 수 있는 실패

const r = await diagnoseNetwork({ timeoutMs: 20_000 });
console.log(renderNetworkMarkdown(r));
assert(r.hosts.length === 7, "호스트 7종 프로브");
assert(r.hosts.every((h) => h.dns.ok && h.dns.addresses.length > 0), "DNS 조회 성공");

let failed = r.hosts.filter((h) => !h.ok);
assert(failed.every((h) => h.http.kind !== "ok" && h.http.kind !== "other" && h.http.error), `실패는 모두 분류됨${failed.length ? ` (${failed.map((h) => `${h.host}=${h.http.kind}`).join(", ")})` : ""}`);
if (failed.length) {
  assert(r.prescriptions.length > 0, `실패가 있으면 처방을 냄 (${r.prescriptions.map((p) => p.id).join(", ")})`);
  console.log(`info: ${failed.length}개 호스트 실패 — 30초 뒤 다시 확인`);
  await sleep(30_000);
  const again = await diagnoseNetwork({ timeoutMs: 20_000, hosts: failed.map((h) => h.host) });
  failed = again.hosts.filter((h) => !h.ok);
  for (const h of again.hosts.filter((x) => x.ok)) console.log(`ok: ${h.host} 재확인 도달 (${h.http.ms}ms)`);
}
const ok = r.hosts.length - failed.length;
assert(ok >= 5, `러너 네트워크 정상: 7개 중 ${ok}개 도달(5개 이상)`);
for (const h of failed) {
  const line = `${h.host} 재확인에도 도달 실패 (${h.http.kind}${h.http.error ? `: ${h.http.error}` : ""}, ${h.http.ms}ms)`;
  if (SERVER_SIDE.has(h.http.kind)) warn(`${line} — 상대 서버 쪽 장애로 보고 경고만 남김`);
  else assert(false, line);
}
if (process.exitCode) console.error(`network-live FAIL (${n})`); else console.log(`network-live OK (${n}${failed.length ? `, 경고 ${failed.length}` : ""})`);
