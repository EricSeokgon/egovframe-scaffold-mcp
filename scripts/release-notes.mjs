#!/usr/bin/env node
/**
 * README 변경 이력에서 한 버전의 항목을 뽑아 GitHub Release 본문(Markdown)을 만든다 (v0.35).
 *
 *   변경 이력 항목은 `- **X.Y.Z** — 한 줄 요약. (1) … (2) …` 꼴의 한 줄(또는 들여쓴 후속 줄)이다.
 *   본문은 "## X.Y.Z" 제목 + 항목 텍스트("(1)"·"(2)" 번호 앞에서 줄을 나눠 읽기 쉽게) + 설치·검증 안내로 구성한다.
 *
 * 사용법: node scripts/release-notes.mjs [X.Y.Z] [--out notes.md]   (버전 생략 시 package.json)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 변경 이력에서 버전 항목의 원문(불릿 포함)을 돌려준다. 없으면 null. */
export function findChangelogEntry(readme, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^- \\*\\*${esc}\\*\\* — `).test(l));
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^- \*\*/.test(l) || /^#/.test(l) || l.trim() === "") break; // 다음 항목·절·빈 줄에서 끝
    out.push(l);
  }
  return out.join("\n");
}

/** Release 본문을 만든다. */
export function renderReleaseNotes(readme, version, { name = "egovframe-scaffold-mcp", mcpName = null } = {}) {
  const entry = findChangelogEntry(readme, version);
  if (!entry) throw new Error(`README 변경 이력에 ${version} 항목이 없습니다`);
  const body = entry.replace(/^- \*\*[^*]+\*\* — /, "").replace(/\s\((\d+)\)\s/g, "\n\n($1) ");
  const L = [`## ${version}`, ``, body, ``, `### 설치`, ``, "```json", JSON.stringify({ mcpServers: { "egovframe-scaffold": { command: "npx", args: ["-y", `${name}@${version}`] } } }, null, 2), "```", ``, `### 검증`, ``, `- npm: \`npm view ${name}@${version}\` — CI(GitHub Actions, OIDC trusted publishing)가 게시했으며 provenance 가 붙어 있습니다(\`npm audit signatures\`)`];
  if (mcpName) L.push(`- MCP Registry: \`${mcpName}\` (\`https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(mcpName)}\`)`);
  L.push(`- 전체 변경 이력: README 의 "변경 이력" 절`);
  return `${L.join("\n")}\n`;
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = positional[0] ?? pkg.version;
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const notes = renderReleaseNotes(readme, version, { name: pkg.name, mcpName: pkg.mcpName ?? null });
  if (outPath) fs.writeFileSync(outPath, notes, "utf8"); else process.stdout.write(notes);
}

const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) main();
