// 네트워크 진단 (diagnose_egovframe_network, v0.31.0 — 읽기 전용).
// 도구가 내려받는 호스트들에 대해 DNS 조회와 HEAD 요청을 실제로 해 보고, 실패를 종류별(DNS·타임아웃·TLS·프록시 인증·거부·재설정)로
// 분류한 뒤 환경변수 처방을 안내한다. 폐쇄망·프록시·IPv6 문제로 다운로드가 실패했을 때 가장 먼저 돌리는 도구다.
import * as dns from "node:dns";
import * as os from "node:os";

export interface NetworkHost {
  host: string;
  /** 어떤 도구가 왜 쓰는지 */
  purpose: string;
  /** HEAD 로 두드릴 URL(존재하는 작은 자원) */
  probeUrl: string;
  tools: string[];
}

/** 도구가 접근하는 외부 호스트. 순서는 중요도(프로젝트 생성 → 컴포넌트 → 설정) */
export const NETWORK_HOSTS: NetworkHost[] = [
  { host: "codeload.github.com", purpose: "공식 템플릿·공통컴포넌트 저장소 zip 아카이브", probeUrl: "https://codeload.github.com/eGovFramework/egovframe-common-components/zip/refs/tags/v5.0.7", tools: ["create_egovframe_project", "add_egovframe_components", "add_ai_components", "apply_egovframe_recipe", "upgrade_egovframe_project", "sync_egovframe_catalog"] },
  { host: "raw.githubusercontent.com", purpose: "가이드 문서·카탈로그 원본 파일", probeUrl: "https://raw.githubusercontent.com/eGovFramework/egovframe-common-components/main/README.md", tools: ["get_egovframe_guide", "search_egovframe_docs(fetchTop>0)", "sync_egovframe_templates"] },
  { host: "media.githubusercontent.com", purpose: "Initializr zip 조달 템플릿(Git LFS)", probeUrl: "https://media.githubusercontent.com/media/eGovFramework/egovframe-vscode-initializr/main/templates/projects/examples/egovframe-web.zip", tools: ["create_egovframe_project(zip 조달 템플릿 12종)"] },
  { host: "maven.egovframe.go.kr", purpose: "표준프레임워크 Maven 저장소(빌드 시 RTE 의존성)", probeUrl: "https://maven.egovframe.go.kr/maven/org/egovframe/rte/egovframe-rte-fdl-cmmn/5.0.2/egovframe-rte-fdl-cmmn-5.0.2.pom", tools: ["build_egovframe_project", "test_egovframe_project"] },
  { host: "repo1.maven.org", purpose: "Maven Central(빌드 시 Spring·Jakarta 의존성)", probeUrl: "https://repo1.maven.org/maven2/org/springframework/spring-core/6.2.11/spring-core-6.2.11.pom", tools: ["build_egovframe_project", "test_egovframe_project"] },
  { host: "registry.npmjs.org", purpose: "npm(이 서버의 설치·갱신)", probeUrl: "https://registry.npmjs.org/egovframe-scaffold-mcp/latest", tools: ["npx egovframe-scaffold-mcp"] },
  { host: "api.osv.dev", purpose: "OSV 취약점 조회(선택)", probeUrl: "https://api.osv.dev/v1/vulns/GHSA-2qrg-x229-3v8q", tools: ["check_egovframe_dependencies(offline=false)"] },
];

export type NetworkErrorKind = "ok" | "dns" | "timeout" | "tls" | "proxy-auth" | "refused" | "reset" | "unreachable" | "http" | "other";

/** 예외를 종류로 분류한다(순수 함수, 테스트 대상). */
export function classifyNetworkError(error: unknown): { kind: NetworkErrorKind; code: string | null; message: string } {
  const err = error as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string; name?: string } } | undefined;
  const cause = err?.cause;
  const code = (cause?.code ?? err?.code ?? null) as string | null;
  const message = String(cause?.message ?? err?.message ?? error ?? "");
  const name = cause?.name ?? err?.name ?? "";
  const text = `${code ?? ""} ${message} ${name}`;
  if (name === "AbortError" || /시간 초과|timed? ?out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT/i.test(text)) return { kind: "timeout", code, message };
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo/i.test(text)) return { kind: "dns", code, message };
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|DEPTH_ZERO|ERR_TLS|certificate|handshake|EPROTO/i.test(text)) return { kind: "tls", code, message };
  if (/407|Proxy Authentication/i.test(text)) return { kind: "proxy-auth", code, message };
  if (/ECONNREFUSED/i.test(text)) return { kind: "refused", code, message };
  if (/ECONNRESET|EPIPE|socket hang up/i.test(text)) return { kind: "reset", code, message };
  if (/ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL/i.test(text)) return { kind: "unreachable", code, message };
  return { kind: "other", code, message };
}

export interface HostProbe {
  host: string;
  purpose: string;
  tools: string[];
  dns: { ok: boolean; ms: number; addresses: { address: string; family: number }[]; error: string | null };
  http: { kind: NetworkErrorKind; status: number | null; ms: number; error: string | null };
  ok: boolean;
}
export interface ProxyEnv { httpsProxy: string | null; httpProxy: string | null; noProxy: string | null; nodeUseEnvProxy: string | null; nodeOptions: string | null; nodeExtraCaCerts: string | null; nodeTlsRejectUnauthorized: string | null }
export interface NetworkDiagnosis {
  node: string;
  platform: string;
  /** Node 의 fetch 가 환경변수 프록시를 쓸 수 있는지(--use-env-proxy 지원) */
  envProxySupported: boolean;
  env: ProxyEnv;
  hosts: HostProbe[];
  summary: { ok: number; failed: number; byKind: Record<string, number> };
  /** 상황에 맞는 처방(환경변수·설정) — 그대로 실행할 수 있는 형태 */
  prescriptions: { id: string; title: string; commands: { shell: "bash" | "cmd" | "powershell"; command: string }[]; reason: string }[];
  notes: string[];
}
export interface NetworkOptions {
  hosts?: string[];
  timeoutMs?: number;
  /** 테스트용 주입: 실제 fetch 대신 */
  probe?: (url: string, timeoutMs: number) => Promise<{ status: number }>;
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  envProxySupported?: boolean;
}

const mask = (v: string | undefined | null): string | null => {
  if (!v) return null;
  return v.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
};

async function defaultProbe(url: string, timeoutMs: number): Promise<{ status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}
const defaultLookup = async (host: string) => (await dns.promises.lookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family }));

/** 호스트별 DNS·HEAD 프로브를 돌리고 처방을 만든다. 파일을 쓰지 않는다. */
export async function diagnoseNetwork(opts: NetworkOptions = {}): Promise<NetworkDiagnosis> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const env = opts.env ?? process.env;
  const probe = opts.probe ?? defaultProbe;
  const lookup = opts.lookup ?? defaultLookup;
  const targets = opts.hosts?.length ? NETWORK_HOSTS.filter((h) => opts.hosts!.includes(h.host)) : NETWORK_HOSTS;
  if (opts.hosts?.length && targets.length === 0) throw new Error(`알 수 없는 호스트: ${opts.hosts.join(", ")} (지원: ${NETWORK_HOSTS.map((h) => h.host).join(", ")})`);
  const envProxySupported = opts.envProxySupported ?? (typeof process.allowedNodeEnvironmentFlags?.has === "function" && process.allowedNodeEnvironmentFlags.has("--use-env-proxy"));
  const proxy: ProxyEnv = {
    httpsProxy: mask(env.HTTPS_PROXY ?? env.https_proxy),
    httpProxy: mask(env.HTTP_PROXY ?? env.http_proxy),
    noProxy: env.NO_PROXY ?? env.no_proxy ?? null,
    nodeUseEnvProxy: env.NODE_USE_ENV_PROXY ?? null,
    nodeOptions: env.NODE_OPTIONS ?? null,
    nodeExtraCaCerts: env.NODE_EXTRA_CA_CERTS ?? null,
    nodeTlsRejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED ?? null,
  };

  const hosts: HostProbe[] = await Promise.all(targets.map(async (t) => {
    const d0 = Date.now();
    let addresses: { address: string; family: number }[] = [];
    let dnsError: string | null = null;
    try { addresses = await lookup(t.host); } catch (e) { dnsError = classifyNetworkError(e).message; }
    const dnsMs = Date.now() - d0;
    const h0 = Date.now();
    let http: HostProbe["http"];
    try {
      const { status } = await probe(t.probeUrl, timeoutMs);
      // 어떤 응답이든 서버까지 닿았다는 뜻. 407 만 프록시 인증 실패로 본다
      http = status === 407
        ? { kind: "proxy-auth", status, ms: Date.now() - h0, error: "407 Proxy Authentication Required" }
        : { kind: status >= 500 ? "http" : "ok", status, ms: Date.now() - h0, error: status >= 500 ? `HTTP ${status}` : null };
    } catch (e) {
      const c = classifyNetworkError(e);
      http = { kind: c.kind === "other" && dnsError ? "dns" : c.kind, status: null, ms: Date.now() - h0, error: c.code ? `${c.code}: ${c.message}` : c.message };
    }
    return { host: t.host, purpose: t.purpose, tools: t.tools, dns: { ok: !dnsError, ms: dnsMs, addresses, error: dnsError }, http, ok: http.kind === "ok" };
  }));

  const byKind: Record<string, number> = {};
  for (const h of hosts) byKind[h.http.kind] = (byKind[h.http.kind] ?? 0) + 1;
  const failed = hosts.filter((h) => !h.ok);
  const kinds = new Set(failed.map((h) => h.http.kind));
  const prescriptions: NetworkDiagnosis["prescriptions"] = [];
  const notes: string[] = [];
  const nodeVersion = opts.nodeVersion ?? process.version;
  const hasProxy = !!(proxy.httpsProxy || proxy.httpProxy);
  const isWin = (opts.env ? false : os.platform() === "win32");
  const both = (bashCmd: string, cmdCmd: string, psCmd: string) => [{ shell: "bash" as const, command: bashCmd }, { shell: "cmd" as const, command: cmdCmd }, { shell: "powershell" as const, command: psCmd }];

  if (failed.length === 0) notes.push("모든 호스트에 도달했습니다. 다운로드 실패가 계속되면 방화벽의 내용 검사(zip 차단)나 프록시의 크기 제한을 확인하세요.");

  const connectFailed = kinds.has("timeout") || kinds.has("refused") || kinds.has("unreachable");
  if (hasProxy && proxy.nodeUseEnvProxy !== "1" && !connectFailed) notes.push("HTTPS_PROXY 가 설정돼 있지만 NODE_USE_ENV_PROXY 없이도 도달했습니다(직접 연결이 되거나 투명 프록시 환경). 다른 네트워크에서 타임아웃이 나면 NODE_USE_ENV_PROXY=1 을 설정하세요.");
  if (hasProxy && proxy.nodeUseEnvProxy !== "1" && connectFailed) {
    prescriptions.push({
      id: "node-env-proxy", title: "Node 의 fetch 가 HTTPS_PROXY 를 쓰도록 설정",
      commands: envProxySupported
        ? both("export NODE_USE_ENV_PROXY=1", "set NODE_USE_ENV_PROXY=1", "$env:NODE_USE_ENV_PROXY=\"1\"")
        : both("# Node 24 이상으로 올린 뒤: export NODE_USE_ENV_PROXY=1", "rem Node 24 이상으로 올린 뒤: set NODE_USE_ENV_PROXY=1", "# Node 24 이상으로 올린 뒤: $env:NODE_USE_ENV_PROXY=\"1\""),
      reason: `HTTPS_PROXY 가 설정돼 있지만 Node 내장 fetch 는 NODE_USE_ENV_PROXY=1 이 없으면 프록시를 무시합니다(git·npm 은 되는데 이 도구만 타임아웃이 나는 전형적 원인). 현재 Node ${nodeVersion}${envProxySupported ? " 는 지원" : " 은 --use-env-proxy 를 지원하지 않음 — Node 24 이상 필요"}.`,
    });
  }
  if (!hasProxy && connectFailed) {
    prescriptions.push({
      id: "set-proxy", title: "사내 프록시를 쓰는 환경이면 프록시 주소 지정",
      commands: both("export HTTPS_PROXY=http://proxy.example.com:8080 NODE_USE_ENV_PROXY=1", "set HTTPS_PROXY=http://proxy.example.com:8080 && set NODE_USE_ENV_PROXY=1", "$env:HTTPS_PROXY=\"http://proxy.example.com:8080\"; $env:NODE_USE_ENV_PROXY=\"1\""),
      reason: "프록시 없이 직접 연결이 막힌 것으로 보입니다. git 이 되는 환경이면 `git config --get http.proxy` 값을 그대로 쓰면 됩니다.",
    });
  }
  const ipv6Timeout = failed.some((h) => h.http.kind === "timeout" && h.dns.addresses.some((a) => a.family === 6) && h.dns.addresses.some((a) => a.family === 4));
  if (ipv6Timeout) {
    prescriptions.push({
      id: "ipv4first", title: "IPv6 주소를 먼저 시도하다 타임아웃 — IPv4 우선",
      commands: both("export NODE_OPTIONS=--dns-result-order=ipv4first", "set NODE_OPTIONS=--dns-result-order=ipv4first", "$env:NODE_OPTIONS=\"--dns-result-order=ipv4first\""),
      reason: "DNS 가 IPv6(AAAA)와 IPv4 를 함께 돌려주는데 IPv6 경로가 막힌 네트워크에서 Node 가 IPv6 를 먼저 시도해 타임아웃이 납니다.",
    });
  }
  if (kinds.has("tls")) {
    prescriptions.push({
      id: "extra-ca", title: "TLS 인증서 검증 실패 — 사내 CA 인증서 등록",
      commands: both("export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem", "set NODE_EXTRA_CA_CERTS=C:\\path\\to\\corp-ca.pem", "$env:NODE_EXTRA_CA_CERTS=\"C:\\path\\to\\corp-ca.pem\""),
      reason: "SSL 검사 프록시가 인증서를 바꿔치기하는 환경입니다. NODE_TLS_REJECT_UNAUTHORIZED=0 은 검증을 끄므로 쓰지 마세요.",
    });
  }
  if (proxy.nodeTlsRejectUnauthorized === "0") notes.push("⚠️ NODE_TLS_REJECT_UNAUTHORIZED=0 이 설정돼 있습니다. TLS 검증을 끄면 다운로드 위·변조를 막을 수 없으니 NODE_EXTRA_CA_CERTS 로 바꾸세요.");
  if (kinds.has("proxy-auth")) {
    prescriptions.push({
      id: "proxy-credentials", title: "프록시 인증(407) — 자격 증명을 프록시 URL 에 포함",
      commands: both("export HTTPS_PROXY=http://user:password@proxy.example.com:8080", "set HTTPS_PROXY=http://user:password@proxy.example.com:8080", "$env:HTTPS_PROXY=\"http://user:password@proxy.example.com:8080\""),
      reason: "프록시가 인증을 요구합니다. 비밀번호에 특수문자가 있으면 URL 인코딩(@ → %40)이 필요합니다.",
    });
  }
  if (kinds.has("dns")) {
    prescriptions.push({
      id: "dns-allowlist", title: "DNS 조회 실패 — 이름 해석·허용 목록 확인",
      commands: [{ shell: "bash", command: `nslookup ${failed.filter((h) => h.http.kind === "dns").map((h) => h.host).join(" ; nslookup ")}` }, { shell: "cmd", command: `nslookup ${failed.filter((h) => h.http.kind === "dns")[0]?.host ?? "codeload.github.com"}` }, { shell: "powershell", command: `Resolve-DnsName ${failed.filter((h) => h.http.kind === "dns")[0]?.host ?? "codeload.github.com"}` }],
      reason: `폐쇄망이면 네트워크 담당자에게 다음 호스트의 허용을 요청하세요: ${NETWORK_HOSTS.map((h) => h.host).join(", ")}. 프록시 환경에서는 DNS 실패가 아니라 프록시 미설정일 수도 있습니다(위 처방 참조).`,
    });
  }
  if (failed.length > 0 && failed.length === hosts.length && !hasProxy) notes.push("모든 호스트가 실패했습니다 — 개별 사이트 차단이 아니라 프록시·DNS 등 공통 원인일 가능성이 큽니다.");
  if (isWin && hasProxy) notes.push("Windows 에서 환경변수는 새 터미널·새 MCP 클라이언트 프로세스에만 적용됩니다. `setx` 로 영구 설정한 뒤 클라이언트를 재시작하세요.");
  notes.push("MCP 클라이언트(Claude Desktop·VS Code 등) 설정의 `env` 항목에 같은 변수를 넣어야 서버 프로세스에도 적용됩니다.");

  return {
    node: nodeVersion, platform: `${os.platform()} ${os.arch()}`, envProxySupported, env: proxy, hosts,
    summary: { ok: hosts.length - failed.length, failed: failed.length, byKind }, prescriptions, notes,
  };
}

/** 다운로드 실패 오류에 붙일 한 줄 처방(shared.fetchWithTimeout 등에서 사용). */
export function networkHint(error: unknown, url: string): string {
  const c = classifyNetworkError(error);
  let host = url;
  try { host = new URL(url).host; } catch { /* 그대로 */ }
  const env = process.env;
  const hasProxy = !!(env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy);
  const tips: string[] = [];
  if (c.kind === "timeout" || c.kind === "refused" || c.kind === "unreachable") {
    if (hasProxy && env.NODE_USE_ENV_PROXY !== "1") tips.push("HTTPS_PROXY 가 있지만 NODE_USE_ENV_PROXY=1 이 없어 Node fetch 가 프록시를 무시합니다");
    else if (!hasProxy) tips.push("프록시 환경이면 HTTPS_PROXY 와 NODE_USE_ENV_PROXY=1 을 설정하세요");
    tips.push("IPv6 문제면 NODE_OPTIONS=--dns-result-order=ipv4first");
  } else if (c.kind === "dns") tips.push(`${host} 이름 해석 실패 — DNS·허용 목록 확인`);
  else if (c.kind === "tls") tips.push("사내 CA 면 NODE_EXTRA_CA_CERTS=<ca.pem>");
  else if (c.kind === "proxy-auth") tips.push("프록시 인증 필요 — HTTPS_PROXY=http://user:pass@proxy:port");
  return `[네트워크 ${c.kind}${c.code ? ` ${c.code}` : ""}] ${tips.join(" · ")}${tips.length ? " · " : ""}자세한 진단: diagnose_egovframe_network`;
}

/** 진단 결과를 Markdown 으로 렌더링한다. */
export function renderNetworkMarkdown(r: NetworkDiagnosis): string {
  const L: string[] = [];
  L.push(`# 네트워크 진단`, ``);
  L.push(`- Node ${r.node} · ${r.platform} · 환경변수 프록시(fetch) ${r.envProxySupported ? "지원" : "미지원"}`);
  L.push(`- HTTPS_PROXY: ${r.env.httpsProxy ?? "(없음)"} · NODE_USE_ENV_PROXY: ${r.env.nodeUseEnvProxy ?? "(없음)"} · NO_PROXY: ${r.env.noProxy ?? "(없음)"}`);
  L.push(`- NODE_OPTIONS: ${r.env.nodeOptions ?? "(없음)"} · NODE_EXTRA_CA_CERTS: ${r.env.nodeExtraCaCerts ?? "(없음)"}${r.env.nodeTlsRejectUnauthorized ? ` · NODE_TLS_REJECT_UNAUTHORIZED: ${r.env.nodeTlsRejectUnauthorized}` : ""}`);
  L.push(`- 결과: 도달 ${r.summary.ok} · 실패 ${r.summary.failed}`, ``);
  L.push(`| 호스트 | DNS | HTTP | 소요 | 용도 |`, `|---|---|---|---|---|`);
  for (const h of r.hosts) {
    const dnsCell = h.dns.ok ? `${h.dns.addresses.filter((a) => a.family === 4).length}×v4 ${h.dns.addresses.filter((a) => a.family === 6).length}×v6` : `❌ ${h.dns.error}`;
    const httpCell = h.ok ? `✅ ${h.http.status}` : `❌ ${h.http.kind}${h.http.error ? ` (${h.http.error.slice(0, 80)})` : ""}`;
    L.push(`| ${h.host} | ${dnsCell} | ${httpCell} | ${h.http.ms}ms | ${h.purpose} |`);
  }
  if (r.prescriptions.length) {
    L.push(``, `## 처방`);
    for (const p of r.prescriptions) {
      L.push(``, `### ${p.title}`, ``, p.reason, ``);
      for (const c of p.commands) L.push(`- ${c.shell}: \`${c.command}\``);
    }
  }
  if (r.notes.length) { L.push(``, `## 참고`, ``); for (const n of r.notes) L.push(`- ${n}`); }
  return L.join("\n");
}
