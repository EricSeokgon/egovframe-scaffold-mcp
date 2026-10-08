// node test/handshake.mjs — MCP stdio 핸드셰이크 검증 (오프라인, 플랫폼 중립)
// 빌드된 서버를 실제 프로세스로 띄워 initialize / tools/list 응답을 확인한다.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
function assert(c, m) { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m); }

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const REQUIRED_TOOLS = [
  "create_egovframe_project",
  "add_egovframe_components",
  "sync_egovframe_catalog",
  "sync_egovframe_templates",
  "generate_egovframe_crud",
  "build_egovframe_project",
  "test_egovframe_project",
  "generate_egovframe_config",
  "migrate_egovframe_project",
  "check_egovframe_dependencies",
  "diagnose_egovframe_network",
  "generate_agents_md",
  "generate_egovframe_sbom",
  "reassemble_egovframe_components",
];

const child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "ignore"] });
const responses = new Map();
let buf = "";
const done = new Promise((resolve) => {
  const timer = setTimeout(resolve, 15000);
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { const msg = JSON.parse(line); if (msg.id !== undefined) responses.set(msg.id, msg); } catch { /* 로그 줄 무시 */ }
      if (responses.has(1) && responses.has(2)) { clearTimeout(timer); resolve(); }
    }
  });
  child.on("close", () => { clearTimeout(timer); resolve(); });
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "handshake-test", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await done;
child.kill();

const info = responses.get(1)?.result?.serverInfo;
assert(info?.name === "egovframe-scaffold-mcp", "serverInfo.name");
assert(info?.version === pkg.version, `serverInfo.version 이 package.json 과 일치 (${info?.version} / ${pkg.version})`);
const tools = responses.get(2)?.result?.tools ?? [];
const names = new Set(tools.map((t) => t.name));
assert(tools.length >= REQUIRED_TOOLS.length, `tools/list 응답 (${tools.length}종)`);
for (const name of REQUIRED_TOOLS) assert(names.has(name), `도구 노출: ${name}`);
assert(new Set(tools.map((t) => t.name)).size === tools.length, "도구 이름 중복 없음");
// v0.32: 프로토콜에 노출되는 메타데이터
assert(tools.every((t) => typeof t.title === "string" && t.title.length > 0), "tools/list 에 모든 도구 title 노출");
assert(tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === "boolean" && typeof t.annotations.destructiveHint === "boolean" && typeof t.annotations.openWorldHint === "boolean"), "tools/list 에 모든 도구 annotations 노출");
assert(tools.filter((t) => t.annotations.readOnlyHint).length === 13 && tools.find((t) => t.name === "diagnose_egovframe_project").annotations.readOnlyHint === true && tools.find((t) => t.name === "remove_egovframe_components").annotations.destructiveHint === true, "readOnly 13종(v0.37: 리포트는 outputPath 로 파일을 만들 수 있어 제외), 진단 readOnly·제거 destructive");
assert(tools.filter((t) => t.outputSchema).length === 10 && tools.some((t) => t.name === "rehearse_egovframe_migration" && t.outputSchema) && tools.some((t) => t.name === "check_egovframe_sbom" && t.outputSchema) && tools.find((t) => t.name === "migrate_egovframe_project").outputSchema.type === "object" && tools.find((t) => t.name === "generate_egovframe_report").outputSchema.type === "object", "outputSchema 10종(JSON Schema object, v0.40 SBOM 점검·v0.41 리허설 포함)");
const ci = tools.find((t) => t.name === "generate_egovframe_ci");
assert(typeof ci?.inputSchema?.properties?.jdk?.pattern === "string", "generate_egovframe_ci.jdk 에 패턴 제약 노출");

// ── bin symlink 경유 기동 (POSIX 의 npx / node_modules/.bin 경로) ──
// npm 은 POSIX 에서 bin 을 symlink 로 설치한다. symlink 로 실행해도 서버가 떠야 한다.
if (process.platform !== "win32") {
  const { mkdtempSync, symlinkSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const pathMod = await import("node:path");
  const binDir = mkdtempSync(pathMod.join(tmpdir(), "hs-bin-"));
  const link = pathMod.join(binDir, "egovframe-scaffold-mcp");
  symlinkSync(entry, link);
  const viaLink = spawn(process.execPath, [link], { stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  const got = new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000);
    viaLink.stdout.on("data", (d) => { out += d.toString(); if (out.includes("\n")) { clearTimeout(timer); resolve(); } });
    viaLink.on("close", () => { clearTimeout(timer); resolve(); });
  });
  viaLink.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "handshake-test", version: "0" } } }) + "\n");
  await got;
  viaLink.kill();
  let linkInfo; try { linkInfo = JSON.parse(out.split("\n")[0]).result?.serverInfo; } catch { /* 응답 없음 */ }
  assert(linkInfo?.version === pkg.version, "bin symlink 로 실행해도 서버가 기동됨 (npx 경로)");
  rmSync(binDir, { recursive: true, force: true });
}

// ── EGOVFRAME_LANG=en: 도구 설명 영문 (v0.31) ─────────────
{
  const en = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, EGOVFRAME_LANG: "en" } });
  const enResponses = new Map();
  let enBuf = "";
  const enDone = new Promise((resolve) => {
    const timer = setTimeout(resolve, 15000);
    en.stdout.on("data", (d) => {
      enBuf += d.toString();
      let nl;
      while ((nl = enBuf.indexOf("\n")) >= 0) {
        const line = enBuf.slice(0, nl).trim(); enBuf = enBuf.slice(nl + 1);
        if (!line) continue;
        try { const msg = JSON.parse(line); if (msg.id !== undefined) enResponses.set(msg.id, msg); } catch { /* 무시 */ }
        if (enResponses.has(2)) { clearTimeout(timer); resolve(); }
      }
    });
    en.on("close", () => { clearTimeout(timer); resolve(); });
  });
  const sendEn = (o) => en.stdin.write(JSON.stringify(o) + "\n");
  sendEn({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "handshake-test", version: "0" } } });
  sendEn({ jsonrpc: "2.0", method: "notifications/initialized" });
  sendEn({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  await enDone;
  en.kill();
  const enTools = enResponses.get(2)?.result?.tools ?? [];
  const nonAscii = enTools.filter((t) => /[\u3131-\uD79D]/.test(t.description ?? ""));
  assert(enTools.length === tools.length && nonAscii.length === 0, `EGOVFRAME_LANG=en → 도구 ${enTools.length}종 설명 전부 영문 (한글 포함 ${nonAscii.length})`);
  const koHasKorean = tools.every((t) => /[\u3131-\uD79D]/.test(t.description ?? ""));
  assert(koHasKorean, "기본(ko) 설명은 한국어");
  const { TOOL_DESCRIPTIONS_EN } = await import("../dist/index.js");
  assert(tools.every((t) => typeof TOOL_DESCRIPTIONS_EN[t.name] === "string" && TOOL_DESCRIPTIONS_EN[t.name].length > 40), "모든 도구에 영문 설명 존재");
  assert(Object.keys(TOOL_DESCRIPTIONS_EN).every((k) => names.has(k)), "영문 설명 표에 없는 도구 이름 없음");
}

const { isMainModule } = await import("../dist/index.js");
assert(isMainModule(entry, new URL("../dist/index.js", import.meta.url).href) === true, "isMainModule: 진입점 일치");
assert(isMainModule(fileURLToPath(import.meta.url), new URL("../dist/index.js", import.meta.url).href) === false, "isMainModule: 다른 파일이면 false (라이브러리 import)");
assert(isMainModule(undefined) === false, "isMainModule: argv 없음");

if (process.exitCode) console.error("handshake FAIL"); else console.log("handshake OK");
