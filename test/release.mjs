// node test/release.mjs — 릴리스 자동화의 판정·릴리스 노트·패키지 내용 (오프라인; npm pack --dry-run 만 로컬 실행)
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { decideRelease, hasChangelogEntry, readVersionFacts } from "../scripts/release-check.mjs";
import { findChangelogEntry, renderReleaseNotes } from "../scripts/release-notes.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

// ── 현재 저장소 상태 ─────────────────────────────────
const facts = readVersionFacts();
assert(/^\d+\.\d+\.\d+$/.test(facts.version) && facts.serverVersions.every((v) => v === facts.version), `package.json·server.json 버전 일치 (${facts.version})`);
assert(facts.changelogHasEntry, `README 변경 이력에 현재 버전 ${facts.version} 항목 존재(릴리스 노트 재료)`);
assert(facts.mcpName === facts.serverName, "mcpName == server.json name");
const dry = decideRelease({ ...facts, tagExists: false, npmPublished: false });
assert(dry.publish === true && dry.reasons.length === 0, "현재 상태는 태그·npm 이 없다면 배포 가능");

// ── decideRelease (순수) ─────────────────────────────
const base = { version: "1.2.3", serverVersions: ["1.2.3", "1.2.3"], changelogHasEntry: true, tagExists: false, npmPublished: false, mcpName: "io.github.x/y", serverName: "io.github.x/y" };
assert(decideRelease(base).publish === true, "네 조건 충족 → publish");
assert(decideRelease({ ...base, serverVersions: ["1.2.3", "1.2.2"] }).reasons.some((r) => /server\.json/.test(r)), "server.json 버전 불일치 → 거부");
assert(decideRelease({ ...base, changelogHasEntry: false }).reasons.some((r) => /변경 이력/.test(r)), "변경 이력 없음 → 거부");
assert(decideRelease({ ...base, tagExists: true }).reasons.some((r) => /태그/.test(r)), "태그 이미 있음 → 거부(재배포 방지)");
assert(decideRelease({ ...base, npmPublished: true }).reasons.some((r) => /npm/.test(r)), "npm 에 이미 있음 → 거부");
assert(decideRelease({ ...base, version: "1.2" }).publish === false && decideRelease({ ...base, serverName: "io.github.x/z" }).publish === false, "버전 형식·mcpName 불일치 → 거부");
const multi = decideRelease({ ...base, changelogHasEntry: false, tagExists: true, npmPublished: true });
assert(multi.publish === false && multi.reasons.length === 3, "이유는 전부 모아 보고");

// ── 변경 이력 항목 추출·릴리스 노트 ─────────────────
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
assert(hasChangelogEntry(readme, facts.version) && !hasChangelogEntry(readme, "99.99.99"), "hasChangelogEntry");
const sample = `## 변경 이력\n\n- **9.9.9** — 요약 문장. (1) 첫째 변경 내용 (2) 둘째 변경 내용, \`코드\` 포함. \`server.json\` 9.9.9.\n  - 들여쓴 후속 줄\n- **9.9.8** — 이전 항목.\n\n## 라이선스\n`;
const entry = findChangelogEntry(sample, "9.9.9");
assert(entry && entry.startsWith("- **9.9.9** — ") && entry.includes("들여쓴 후속 줄") && !entry.includes("9.9.8"), "항목 원문: 후속 들여쓴 줄 포함, 다음 항목 제외");
assert(findChangelogEntry(sample, "9.9.7") === null, "없는 버전 → null");
const notes = renderReleaseNotes(sample, "9.9.9", { name: "pkg-x", mcpName: "io.github.x/pkg-x" });
assert(notes.startsWith("## 9.9.9\n") && notes.includes("\n\n(1) 첫째") && notes.includes("\n\n(2) 둘째") && notes.includes("\"pkg-x@9.9.9\"") && notes.includes("io.github.x/pkg-x") && !notes.includes("- **9.9.9**"), "릴리스 노트: 제목·번호 단락·설치 스니펫·레지스트리 링크");
let threw = false; try { renderReleaseNotes(sample, "1.0.0"); } catch { threw = true; }
assert(threw, "항목 없는 버전은 예외");
const real = renderReleaseNotes(readme, facts.version, { name: facts.name, mcpName: facts.mcpName });
assert(real.startsWith(`## ${facts.version}\n`) && real.length > 200, `현재 버전 릴리스 노트 생성(${real.length}자)`);

// ── 패키지 내용 (npm pack --dry-run) ─────────────────
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const pack = spawnSync(npmCmd, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: new URL("..", import.meta.url), encoding: "utf8", shell: process.platform === "win32" });
if (pack.status !== 0) { console.error(pack.stderr); }
const info = pack.status === 0 ? JSON.parse(pack.stdout)[0] : null;
assert(info && info.name === facts.name && info.version === facts.version, `npm pack --dry-run 실행 (${info?.filename ?? pack.stderr?.slice(0, 200)})`);
const files = new Set((info?.files ?? []).map((f) => f.path));
for (const must of ["package.json", "README.md", "README.en.md", "LICENSE", "dist/index.js", "dist/server.js", "catalog/components.json", "catalog/templates.json", "catalog/migration-rules.json", "catalog/dependency-baseline.json", "catalog/config-templates.json"])
  assert(files.has(must), `tarball 포함: ${must}`);
assert([...files].some((f) => f.startsWith("catalog/config-templates/") && f.endsWith(".hbs")), "tarball 포함: 동봉 설정 템플릿(.hbs)");
assert(![...files].some((f) => /^(test|scripts|src|\.github|node_modules)\//.test(f) || f.endsWith(".map") || f === "server.json" || f.startsWith(".")), "tarball 제외: test·scripts·src·.github·소스맵·숨김 파일");
assert(info && info.unpackedSize <= 2 * 1024 * 1024 && info.size <= 600 * 1024, `tarball 크기 상한 (압축 ${info?.size} ≤ 600KB, 풀면 ${info?.unpackedSize} ≤ 2MB)`);

if (process.exitCode) console.error(`release FAIL (${n} assertions)`); else console.log(`release OK (${n} assertions)`);
