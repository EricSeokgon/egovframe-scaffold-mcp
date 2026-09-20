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
  "generate_egovframe_crud",
  "build_egovframe_project",
  "test_egovframe_project",
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

const { isMainModule } = await import("../dist/index.js");
assert(isMainModule(entry, new URL("../dist/index.js", import.meta.url).href) === true, "isMainModule: 진입점 일치");
assert(isMainModule(fileURLToPath(import.meta.url), new URL("../dist/index.js", import.meta.url).href) === false, "isMainModule: 다른 파일이면 false (라이브러리 import)");
assert(isMainModule(undefined) === false, "isMainModule: argv 없음");

if (process.exitCode) console.error("handshake FAIL"); else console.log("handshake OK");
