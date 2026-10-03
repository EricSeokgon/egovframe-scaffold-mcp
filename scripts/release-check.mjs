#!/usr/bin/env node
/**
 * 릴리스 자동화의 사전 검사 (v0.35, v0.37 재개 판정) — .github/workflows/release.yml 이 main 병합마다 호출한다.
 *
 *   package.json 버전을 읽어 전제 조건을 확인한 뒤
 *     (a) server.json 의 두 version 이 package.json 과 같다
 *     (b) README 변경 이력에 그 버전 항목(`- **X.Y.Z** — …`)이 있다
 *   원격 상태(태그 vX.Y.Z · npm 게시 여부와 게시 커밋 gitHead · GitHub Release)를 보고 **남은 단계만** 고른다:
 *     - 아무것도 없음            → full   : npm → 태그(현재 커밋) → Release → MCP Registry
 *     - npm 만 있음(태그 없음)   → resume : 태그를 npm 이 기록한 gitHead 커밋에(현재 main 의 조상이어야 함) → Release → Registry
 *     - npm·태그 있음, Release 없음 → resume : Release → Registry
 *     - npm·태그·Release 있음, Registry 없음 → resume : Registry
 *     - 전부 있음                → none   : 이미 릴리스됨
 *   v0.36.1 에서 npm 게시 뒤 확인 단계가 전파 지연으로 실패해 태그·Release·Registry 가 빠진 채 끝났고 재실행은 "npm 에 이미 있음"으로
 *   멈췄다 — 그 상태를 사람 손 없이 이어 가기 위한 판정이다. 태그 대상은 npm 이 기록한 커밋이므로 npm 패키지와 태그가 항상 같은 코드를 가리킨다.
 *
 * 사용법:
 *   node scripts/release-check.mjs            # 사람이 읽는 출력 + GITHUB_OUTPUT 이 있으면 version/publish/mode/npm/tag/release/registry/tag_target/reason 기록
 *   node scripts/release-check.mjs --json
 * 순수 판정 함수 decideRelease 는 test/release.mjs 가 단언한다.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRY_URL = "https://registry.modelcontextprotocol.io";

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

/**
 * 배포 여부와 남은 단계를 판정한다(순수 함수).
 *   tagExists · npmPublished · releaseExists(null=모름) · registryPublished(null=모름) · npmGitHead(npm 이 기록한 커밋, null=모름)
 *   headSha(현재 커밋) · gitHeadIsAncestor(npmGitHead 가 현재 커밋이거나 그 조상인지, null=모름)
 */
export function decideRelease({ version, serverVersions, changelogHasEntry, tagExists, npmPublished, mcpName, serverName, releaseExists = null, registryPublished = null, npmGitHead = null, headSha = null, gitHeadIsAncestor = null }) {
  const reasons = [];
  const none = (mode = "none") => ({ publish: false, mode, steps: { npm: false, tag: false, release: false, registry: false }, tagTarget: null, reasons });
  if (!/^\d+\.\d+\.\d+$/.test(version)) reasons.push(`package.json 버전 형식이 X.Y.Z 가 아닙니다: ${version}`);
  const badServer = serverVersions.filter((v) => v !== version);
  if (badServer.length) reasons.push(`server.json 의 version 이 package.json(${version})과 다릅니다: ${badServer.join(", ")}`);
  if (mcpName !== undefined && serverName !== undefined && mcpName !== serverName) reasons.push(`package.json mcpName(${mcpName})과 server.json name(${serverName})이 다릅니다`);
  if (!changelogHasEntry) reasons.push(`README 변경 이력에 ${version} 항목이 없습니다`);
  if (reasons.length) return none();

  // 아무것도 없음 → 전체 배포
  if (!npmPublished && !tagExists) return { publish: true, mode: "full", steps: { npm: true, tag: true, release: true, registry: true }, tagTarget: headSha, reasons: [] };
  if (!npmPublished && tagExists) { reasons.push(`태그 v${version} 은 있는데 npm 에 ${version} 이 없습니다 — 태그를 지우고 다시 병합하거나 수동으로 게시하세요`); return none(); }

  // npm 에 있음 → 남은 단계만
  if (!tagExists) {
    if (!npmGitHead) { reasons.push(`npm 에 ${version} 이 있지만 게시 커밋(gitHead)을 알 수 없어 태그를 자동으로 만들지 않습니다 — 게시한 커밋에 수동으로 태그하세요`); return none(); }
    if (gitHeadIsAncestor !== true) { reasons.push(`npm 의 ${version} 은 ${npmGitHead.slice(0, 7)} 에서 게시됐는데 현재 main(${(headSha ?? "?").slice(0, 7)})의 조상이 아닙니다 — 그 커밋에 수동으로 태그하세요`); return none(); }
    return { publish: true, mode: "resume", steps: { npm: false, tag: true, release: true, registry: true }, tagTarget: npmGitHead, reasons: [`npm 에 ${version} 이 이미 있음(${npmGitHead.slice(0, 7)}) — 태그·Release·Registry 를 이어서 수행`] };
  }
  if (releaseExists === false) return { publish: true, mode: "resume", steps: { npm: false, tag: false, release: true, registry: true }, tagTarget: null, reasons: [`npm·태그 v${version} 은 있고 GitHub Release 가 없음 — Release·Registry 를 이어서 수행`] };
  if (releaseExists === null) { reasons.push(`npm·태그 v${version} 은 있지만 GitHub Release 유무를 확인하지 못했습니다(토큰 없음)`); return none(); }
  if (registryPublished === false) return { publish: true, mode: "resume", steps: { npm: false, tag: false, release: false, registry: true }, tagTarget: null, reasons: [`npm·태그·Release 는 있고 MCP Registry 에 ${version} 이 없음 — Registry 게시만 수행`] };
  reasons.push(`v${version} 은 이미 릴리스됨(npm·태그·Release${registryPublished ? "·Registry" : ""})`);
  return none();
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
  return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/** 원격에 태그가 있는지 (git ls-remote). */
export function remoteTagExists(version) {
  const r = run("git", ["ls-remote", "--tags", "origin", `refs/tags/v${version}`]);
  if (r.status !== 0) throw new Error(`git ls-remote 실패: ${r.err}`);
  return r.out.length > 0;
}

/** npm 레지스트리에 그 버전이 있는지 (npm view; 404 는 없음). */
export function npmVersionExists(name, version) {
  const r = run(npmCmd, ["view", `${name}@${version}`, "version", "--json"]);
  if (r.status === 0) return r.out.replace(/"/g, "").trim() === version;
  if (/E404|404 Not Found|No match found/i.test(`${r.err}\n${r.out}`)) return false;
  throw new Error(`npm view 실패: ${r.err || r.out}`);
}

/** npm 이 게시 때 기록한 커밋(gitHead). 없으면 null. */
export function npmGitHead(name, version) {
  const r = run(npmCmd, ["view", `${name}@${version}`, "gitHead", "--json"]);
  if (r.status !== 0) return null;
  const sha = r.out.replace(/"/g, "").trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** sha 가 HEAD 이거나 그 조상인지 (fetch-depth: 0 체크아웃 전제). 판단 불가면 null. */
export function isAncestorOfHead(sha) {
  const r = run("git", ["merge-base", "--is-ancestor", sha, "HEAD"]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}
export function currentHead() {
  const r = run("git", ["rev-parse", "HEAD"]);
  return r.status === 0 ? r.out : null;
}

/** GitHub Release 가 있는지 (REST, 토큰 필요). 확인 불가면 null. */
export async function githubReleaseExists(version, { repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, fetchImpl = fetch } = {}) {
  if (!repo || !token) return null;
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "egovframe-scaffold-mcp-release" } });
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    return null;
  } catch { return null; }
}

/** MCP Registry 에 그 버전이 있는지. 확인 불가면 null. */
export async function registryVersionExists(serverName, version, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${REGISTRY_URL}/v0.1/servers/${encodeURIComponent(serverName)}/versions/${encodeURIComponent(version)}`, { headers: { "User-Agent": "egovframe-scaffold-mcp-release" } });
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    return null;
  } catch { return null; }
}

async function main() {
  const facts = readVersionFacts();
  const tagExists = remoteTagExists(facts.version);
  const npmPublished = npmVersionExists(facts.name, facts.version);
  const headSha = currentHead();
  const gitHead = npmPublished ? npmGitHead(facts.name, facts.version) : null;
  const gitHeadIsAncestor = gitHead ? isAncestorOfHead(gitHead) : null;
  const releaseExists = tagExists ? await githubReleaseExists(facts.version) : false;
  const registryPublished = npmPublished && tagExists && releaseExists ? await registryVersionExists(facts.serverName, facts.version) : null;
  const decision = decideRelease({ ...facts, tagExists, npmPublished, releaseExists, registryPublished, npmGitHead: gitHead, headSha, gitHeadIsAncestor });
  const result = { ...facts, tagExists, npmPublished, npmGitHead: gitHead, headSha, gitHeadIsAncestor, releaseExists, registryPublished, ...decision };
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`release-check: ${facts.name}@${facts.version} → ${decision.publish ? `배포 진행(${decision.mode}: ${Object.entries(decision.steps).filter(([, v]) => v).map(([k]) => k).join(" → ")})` : "배포 안 함"}`);
    for (const r of decision.reasons) console.log(`  - ${r}`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const s = decision.steps;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${facts.version}\npublish=${decision.publish}\nmode=${decision.mode}\nnpm=${s.npm}\ntag=${s.tag}\nrelease=${s.release}\nregistry=${s.registry}\ntag_target=${decision.tagTarget ?? ""}\nreason=${decision.reasons.join(" / ").replace(/\n/g, " ")}\n`);
  }
}

const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) await main();
