// node test/network.mjs — 네트워크 진단 (오프라인: 프로브·DNS 주입)
import { NETWORK_HOSTS, classifyNetworkError, diagnoseNetwork, networkHint, renderNetworkMarkdown, fetchWithTimeout } from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const err = (code, message = code, name = "Error") => { const e = new Error(message); e.code = code; e.name = name; return e; };
const causeErr = (code) => { const e = new TypeError("fetch failed"); e.cause = err(code); return e; };

// ── 분류 ──────────────────────────────────────────────
assert(classifyNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" })).kind === "timeout", "AbortError → timeout");
assert(classifyNetworkError(causeErr("ETIMEDOUT")).kind === "timeout" && classifyNetworkError(causeErr("UND_ERR_CONNECT_TIMEOUT")).kind === "timeout", "ETIMEDOUT·UND_ERR_CONNECT_TIMEOUT → timeout");
assert(classifyNetworkError(causeErr("ENOTFOUND")).kind === "dns" && classifyNetworkError(causeErr("EAI_AGAIN")).kind === "dns", "ENOTFOUND·EAI_AGAIN → dns");
assert(classifyNetworkError(causeErr("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")).kind === "tls" && classifyNetworkError(causeErr("SELF_SIGNED_CERT_IN_CHAIN")).kind === "tls" && classifyNetworkError(causeErr("CERT_HAS_EXPIRED")).kind === "tls", "인증서 오류 → tls");
assert(classifyNetworkError(causeErr("ECONNREFUSED")).kind === "refused" && classifyNetworkError(causeErr("ECONNRESET")).kind === "reset" && classifyNetworkError(causeErr("ENETUNREACH")).kind === "unreachable", "refused·reset·unreachable");
assert(classifyNetworkError(new Error("407 Proxy Authentication Required")).kind === "proxy-auth", "407 → proxy-auth");
assert(classifyNetworkError(new Error("weird")).kind === "other" && classifyNetworkError(causeErr("ENOTFOUND")).code === "ENOTFOUND", "기타·cause 의 code 추출");
assert(NETWORK_HOSTS.length === 7 && NETWORK_HOSTS.every((h) => h.probeUrl.startsWith(`https://${h.host}/`) && h.tools.length > 0), "호스트 목록 7종, probeUrl 이 자기 호스트");

// ── 시나리오 ──────────────────────────────────────────
const addrs = { v4: [{ address: "1.2.3.4", family: 4 }], both: [{ address: "2606::1", family: 6 }, { address: "1.2.3.4", family: 4 }] };
const run = (opts) => diagnoseNetwork({ env: {}, nodeVersion: "v22.0.0", envProxySupported: true, timeoutMs: 1000, ...opts });

// 1) 전부 도달
const ok = await run({ probe: async () => ({ status: 200 }), lookup: async () => addrs.v4 });
assert(ok.summary.ok === 7 && ok.summary.failed === 0 && ok.prescriptions.length === 0 && ok.hosts.every((h) => h.ok && h.dns.ok), "전부 도달 → 처방 없음");
assert(ok.notes.some((x) => x.includes("모든 호스트에 도달")), "도달 안내");
const okMd = renderNetworkMarkdown(ok);
assert(okMd.startsWith("# 네트워크 진단") && okMd.includes("| codeload.github.com |") && okMd.includes("✅ 200") && !okMd.includes("## 처방"), "Markdown(도달)");

// 2) 405·404 도 도달로 본다, 407 은 프록시 인증, 5xx 는 http
const codes = await run({ probe: async (url) => ({ status: url.includes("osv") ? 405 : url.includes("npmjs") ? 404 : url.includes("maven.egov") ? 407 : url.includes("repo1") ? 503 : 200 }), lookup: async () => addrs.v4 });
const byHost = Object.fromEntries(codes.hosts.map((h) => [h.host, h]));
assert(byHost["api.osv.dev"].ok && byHost["registry.npmjs.org"].ok, "405·404 는 도달");
assert(byHost["maven.egovframe.go.kr"].http.kind === "proxy-auth" && byHost["repo1.maven.org"].http.kind === "http" && codes.summary.failed === 2, "407 → proxy-auth, 503 → http");
assert(codes.prescriptions.some((p) => p.id === "proxy-credentials") && codes.prescriptions.every((p) => p.commands.length === 3 && p.commands.map((c) => c.shell).join() === "bash,cmd,powershell"), "407 처방 + 3종 셸 명령");

// 3) 프록시 설정됨 + NODE_USE_ENV_PROXY 없음 + 타임아웃 → node-env-proxy 처방
const proxyTimeout = await run({ env: { HTTPS_PROXY: "http://user:secret@proxy.corp:8080" }, probe: async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, lookup: async () => addrs.v4 });
assert(proxyTimeout.summary.failed === 7 && proxyTimeout.summary.byKind.timeout === 7, "전부 타임아웃");
assert(proxyTimeout.env.httpsProxy === "http://user:***@proxy.corp:8080", "프록시 자격 증명 가림");
const pep = proxyTimeout.prescriptions.find((p) => p.id === "node-env-proxy");
assert(pep && pep.commands[0].command === "export NODE_USE_ENV_PROXY=1" && !proxyTimeout.prescriptions.some((p) => p.id === "set-proxy") && !proxyTimeout.prescriptions.some((p) => p.id === "ipv4first"), "NODE_USE_ENV_PROXY=1 처방(v4 만이라 ipv4first 없음)");
assert(proxyTimeout.notes.some((x) => x.includes("공통 원인")) === false, "프록시가 있으면 '공통 원인' 안내 대신 프록시 처방");
const proxyOk = await run({ env: { HTTPS_PROXY: "http://proxy.corp:8080" }, probe: async () => ({ status: 200 }), lookup: async () => addrs.v4 });
assert(proxyOk.prescriptions.length === 0 && proxyOk.notes.some((x) => x.includes("NODE_USE_ENV_PROXY 없이도 도달")), "프록시 있어도 도달하면 처방 대신 안내");
const unsupported = await run({ env: { HTTPS_PROXY: "http://proxy.corp:8080" }, envProxySupported: false, nodeVersion: "v18.20.0", probe: async () => { throw causeErr("ETIMEDOUT"); }, lookup: async () => addrs.v4 });
assert(unsupported.prescriptions.find((p) => p.id === "node-env-proxy")?.reason.includes("Node 24 이상 필요") && !unsupported.envProxySupported, "--use-env-proxy 미지원 Node → 업그레이드 안내");

// 4) 프록시 없음 + 타임아웃 + v4/v6 혼재 → set-proxy + ipv4first
const noProxy = await run({ probe: async () => { throw causeErr("ETIMEDOUT"); }, lookup: async () => addrs.both });
assert(noProxy.prescriptions.some((p) => p.id === "set-proxy") && noProxy.prescriptions.some((p) => p.id === "ipv4first") && noProxy.notes.some((x) => x.includes("공통 원인")), "프록시 지정 + IPv4 우선 처방 + 공통 원인 안내");
assert(noProxy.prescriptions.find((p) => p.id === "ipv4first").commands.find((c) => c.shell === "cmd").command === "set NODE_OPTIONS=--dns-result-order=ipv4first", "ipv4first cmd 명령");

// 5) TLS 실패 + NODE_TLS_REJECT_UNAUTHORIZED=0 경고
const tls = await run({ env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, probe: async () => { throw causeErr("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"); }, lookup: async () => addrs.v4 });
assert(tls.summary.byKind.tls === 7 && tls.prescriptions.some((p) => p.id === "extra-ca") && tls.notes.some((x) => x.includes("NODE_TLS_REJECT_UNAUTHORIZED=0")), "TLS 처방 + 검증 끔 경고");
assert(renderNetworkMarkdown(tls).includes("NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem"), "TLS Markdown 명령");

// 6) DNS 실패 → dns 처방, 허용 목록 호스트 나열
const dnsFail = await run({ probe: async () => { throw causeErr("ENOTFOUND"); }, lookup: async () => { throw causeErr("ENOTFOUND"); } });
assert(dnsFail.hosts.every((h) => !h.dns.ok && h.http.kind === "dns") && dnsFail.prescriptions.some((p) => p.id === "dns-allowlist" && p.reason.includes("maven.egovframe.go.kr")), "DNS 실패 → 허용 목록 처방");
// DNS 는 되는데 fetch 가 'other' 로 죽고 dns 오류가 있으면 dns 로 귀속
const partial = await run({ probe: async () => { throw new Error("weird"); }, lookup: async (h) => { if (h === "api.osv.dev") throw causeErr("ENOTFOUND"); return addrs.v4; } });
assert(partial.hosts.find((h) => h.host === "api.osv.dev").http.kind === "dns" && partial.hosts.find((h) => h.host === "codeload.github.com").http.kind === "other", "DNS 오류가 있으면 other 를 dns 로 귀속");

// 7) hosts 필터·오류
const subset = await run({ hosts: ["maven.egovframe.go.kr"], probe: async () => ({ status: 200 }), lookup: async () => addrs.v4 });
assert(subset.hosts.length === 1 && subset.hosts[0].host === "maven.egovframe.go.kr", "hosts 필터");
let threw = false;
try { await run({ hosts: ["example.com"], probe: async () => ({ status: 200 }), lookup: async () => addrs.v4 }); } catch { threw = true; }
assert(threw, "알 수 없는 호스트 → 예외");
// 프로브 타임아웃이 실제로 적용되는지(느린 프로브)
const slow = await run({ timeoutMs: 1000, probe: async (url, ms) => { if (ms !== 1000) throw new Error("timeout 전달 안 됨"); return { status: 200 }; }, lookup: async () => addrs.v4 });
assert(slow.summary.ok === 7, "timeoutMs 가 프로브에 전달");

// ── networkHint / fetchWithTimeout 처방 부착 ─────────────
const hintTimeout = networkHint(Object.assign(new Error("aborted"), { name: "AbortError" }), "https://codeload.github.com/x");
assert(hintTimeout.startsWith("[네트워크 timeout]") && hintTimeout.includes("diagnose_egovframe_network") && hintTimeout.includes("ipv4first"), "타임아웃 힌트");
assert(networkHint(causeErr("ENOTFOUND"), "https://raw.githubusercontent.com/x").includes("raw.githubusercontent.com 이름 해석 실패"), "DNS 힌트에 호스트");
assert(networkHint(causeErr("CERT_HAS_EXPIRED"), "nota-url").includes("NODE_EXTRA_CA_CERTS"), "TLS 힌트, URL 파싱 실패해도 동작");
let fetchErr = null;
try { await fetchWithTimeout("https://nonexistent-host.invalid/x", 5000); } catch (e) { fetchErr = e; }
assert(fetchErr && /\[네트워크 (dns|other|timeout)/.test(fetchErr.message) && fetchErr.message.includes("diagnose_egovframe_network"), `fetchWithTimeout 실패 메시지에 처방 부착 (${fetchErr?.message.split("\\n")[1]?.slice(0, 60)})`);

if (process.exitCode) console.error(`network FAIL (${n} assertions)`); else console.log(`network OK (${n} assertions)`);
