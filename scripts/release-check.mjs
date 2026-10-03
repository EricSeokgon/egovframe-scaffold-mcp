#!/usr/bin/env node
/**
 * 릴리스 자동화의 사전 검사 (v0.35) — .github/workflows/release.yml 이 main 병합마다 호출한다.
 *
 *   package.json 버전을 읽어 다음 네 조건을 모두 만족할 때만 "publish=true" 를 낸다:
 *     (a) server.json 의 두 version 이 package.json 과 같다
 *     (b) README 변경 이력에 그 버전 항목(`- **X.Y.Z** — …`)이 있다
 *     (c) 태그 vX.Y.Z 가 원격에 아직 없다
 *     (d) npm 에 그 버전이 아직 없다
 *   하나라도 어긋나면 publish=false 와 이유를 낸다(워크플로는 성공 종료 — 병합마다 도는 워크플로가 빨간불이 되지 않게).
 *
 * 사용법:
 *   node scripts/release-check.mjs            # 사람이 읽는 출력 + GITHUB_OUTPUT 이 있으면 version/publish/reason 기록
 *   node scripts/release-check.mjs --json
 * 순수 판정 함수 decideRelease 는 test/release.mjs 가 단언한다.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 저장소 파일에서 버전 관련 사실을 읽는다. */
export function readVersionFacts(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const server = JSON.parse(fs.readFileSync(path.join(root, "server.json"), "utf8"));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  return {
    name: pkg.name,
    mcpName: pkg.mcpName ?? null,
    version: pkg.version,
    serverVersions: [server.version, ...(server.packages ?? []).map((p) => p.version)],
    serverName: server.name,
    changelogHasEntry: hasChangelogEntry(readme, pkg.version),
  };
}

/** README 변경 이력에 `- **X.Y.Z** — …` 항목이 있는지. */
export function hasChangelogEntry(readme, version) {
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^- \\*\\*${esc}\\*\\* — `, "m").test(readme);
}

/** 네 조건으로 배포 여부를 판정한다(순수 함수). */
export function decideRelease({ version, serverVersions, changelogHasEntry, tagExists, npmPublished, mcpName, serverName }) {
  const reasons = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) reasons.push(`package.json 버전 형식이 X.Y.Z 가 아닙니다: ${version}`);
  const badServer = serverVersions.filter((v) => v !== version);
  if (badServer.length) reasons.push(`server.json 의 version 이 package.json(${version})과 다릅니다: ${badServer.join(", ")}`);
  if (mcpName !== undefined && serverName !== undefined && mcpName !== serverName) reasons.push(`package.json mcpName(${mcpName})과 server.json name(${serverName})이 다릅니다`);
  if (!changelogHasEntry) reasons.push(`README 변경 이력에 ${version} 항목이 없습니다`);
  if (tagExists) reasons.push(`태그 v${version} 이 이미 있습니다(이미 릴리스됨)`);
  if (npmPublished) reasons.push(`npm 에 ${version} 이 이미 있습니다`);
  return { publish: reasons.length === 0, reasons };
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** 원격에 태그가 있는지 (git ls-remote). */
export function remoteTagExists(version) {
  const r = run("git", ["ls-remote", "--tags", "origin", `refs/tags/v${version}`]);
  if (r.status !== 0) throw new Error(`git ls-remote 실패: ${r.err}`);
  return r.out.length > 0;
}

/** npm 레지스트리에 그 버전이 있는지 (npm view; 404 는 없음). */
export function npmVersionExists(name, version) {
  const r = run(process.platform === "win32" ? "npm.cmd" : "npm", ["view", `${name}@${version}`, "version", "--json"]);
  if (r.status === 0) return r.out.replace(/"/g, "").trim() === version;
  if (/E404|404 Not Found|No match found/i.test(`${r.err}\n${r.out}`)) return false;
  throw new Error(`npm view 실패: ${r.err || r.out}`);
}

async function main() {
  const facts = readVersionFacts();
  const tagExists = remoteTagExists(facts.version);
  const npmPublished = npmVersionExists(facts.name, facts.version);
  const decision = decideRelease({ ...facts, tagExists, npmPublished });
  const result = { ...facts, tagExists, npmPublished, ...decision };
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`release-check: ${facts.name}@${facts.version} → ${decision.publish ? "배포 진행" : "배포 안 함"}`);
    for (const r of decision.reasons) console.log(`  - ${r}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${facts.version}\npublish=${decision.publish}\nreason=${decision.reasons.join(" / ").replace(/\n/g, " ")}\n`);
  }
}

const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) await main();
