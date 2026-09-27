#!/usr/bin/env node
/**
 * 3.x/4.x → 5.x 전환 규칙 생성 → catalog/migration-rules.json (v0.29)
 *
 *   근거: eGovFramework/egovframe-runtime 의 태그 3개(fromTag 3.10.0 · midTag 4.3.0 · toTag 5.0.2)
 *         - 모듈 디렉터리·pom artifactId → Maven 좌표 대응표
 *         - src/main/java 트리 → 패키지 접두어 변경, 패키지 이름 변경, 클래스 이동, 제거 클래스
 *   큐레이션(제거 클래스의 대체·사유, Jakarta 목록, 라이브러리, XML 네임스페이스)은 catalog/migration-mapping.json 에서 읽는다.
 *   트리 비교로 나온 제거 클래스에 큐레이션 사유가 없으면 실패한다 — 근거 없는 "manual" 을 막기 위해서다.
 *
 * 사용법:
 *   node scripts/generate-migration-rules.mjs --runtime-dir <egovframe-runtime clone>   # 오프라인(권장). blob:none 부분 클론이면 충분
 *   node scripts/generate-migration-rules.mjs                                            # 임시 디렉터리에 부분 클론 후 생성
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAPPING_PATH = path.join(ROOT, "catalog", "migration-mapping.json");
const OUT_JSON = path.join(ROOT, "catalog", "migration-rules.json");

const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

/** 태그의 src/main/java 아래 클래스 FQN 집합과 모듈 디렉터리 목록 */
function readTree(dir, tag) {
  const lines = git(dir, ["ls-tree", "-r", "--name-only", tag]).split("\n").filter(Boolean);
  const classes = new Set();
  const modules = new Map(); // module dir name -> module path
  for (const rel of lines) {
    const seg = rel.split("/");
    if (seg.length >= 2 && seg[1] && /^(egovframework\.rte|org\.egovframe\.rte)\.|^spring-modules-validation$/.test(seg[1])) modules.set(seg[1], `${seg[0]}/${seg[1]}`);
    const i = rel.indexOf("/src/main/java/");
    if (i < 0 || !rel.endsWith(".java")) continue;
    const fq = rel.slice(i + "/src/main/java/".length, -".java".length).replace(/\//g, ".");
    if (fq.endsWith(".package-info")) continue;
    classes.add(fq);
  }
  return { classes, modules };
}

function pomArtifact(dir, tag, modulePath) {
  const xml = git(dir, ["show", `${tag}:${modulePath}/pom.xml`]);
  // <project> 직계 좌표만 본다: 의존성·속성·빌드 블록이 시작되기 전까지 잘라내고, parent 는 groupId 상속용으로만 쓴다
  const cut = xml.search(/<(dependencies|dependencyManagement|properties|build|profiles|repositories|modules|pluginRepositories)>/);
  const head = cut >= 0 ? xml.slice(0, cut) : xml;
  const parentG = head.match(/<parent>[\s\S]*?<groupId>\s*([^<\s]+)/)?.[1];
  const noParent = head.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const g = noParent.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1] ?? parentG;
  const a = noParent.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
  if (!g || !a) throw new Error(`pom 좌표를 읽지 못함: ${tag}:${modulePath}/pom.xml`);
  return { groupId: g, artifactId: a };
}

const pkgOf = (fq) => fq.slice(0, fq.lastIndexOf("."));
const simpleOf = (fq) => fq.slice(fq.lastIndexOf(".") + 1);
const commonPrefixLen = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };

function globToRe(glob) {
  return new RegExp(`^${glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

async function main() {
  const argv = process.argv.slice(2);
  const rdIdx = argv.indexOf("--runtime-dir");
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  const rt = mapping.runtime;

  let dir = rdIdx >= 0 ? path.resolve(argv[rdIdx + 1]) : null;
  let tmp = null;
  if (!dir) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egov-rt-"));
    dir = path.join(tmp, "rt");
    console.error(`egovframe-runtime 부분 클론 중 → ${dir}`);
    execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", `https://github.com/${rt.repository}.git`, dir], { stdio: "inherit", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  }
  for (const t of [rt.fromTag, rt.midTag, rt.toTag]) git(dir, ["rev-parse", "--verify", `${t}^{commit}`]);
  const commit = (t) => git(dir, ["rev-parse", `${t}^{commit}`]).trim();

  const from = readTree(dir, rt.fromTag);
  const mid = readTree(dir, rt.midTag);
  const to = readTree(dir, rt.toTag);

  // ── 1) 모듈 좌표 대응표 ───────────────────────────────
  const removedModuleNames = new Set(mapping.modules.removedModules.map((m) => m.module));
  const coordinates = [];
  for (const [name, modulePath] of [...from.modules].sort()) {
    if (name === "spring-modules-validation") {
      if (!removedModuleNames.has(name)) throw new Error("spring-modules-validation 이 removedModules 에 없습니다");
      continue;
    }
    const module = name.slice(rt.fromPackagePrefix.length); // fdl.cmmn
    const toName = `${rt.toPackagePrefix}${module}`;
    const toPath = to.modules.get(toName);
    if (!toPath) {
      if (removedModuleNames.has(module)) continue;
      throw new Error(`${rt.toTag} 에 모듈 ${toName} 이 없습니다 — removedModules 에 사유를 추가하세요`);
    }
    const fromPom = pomArtifact(dir, rt.fromTag, modulePath);
    const toPom = pomArtifact(dir, rt.toTag, toPath);
    const expected = `egovframe-rte-${module.replace(/\./g, "-")}`;
    if (toPom.groupId !== rt.toGroupId || toPom.artifactId !== expected)
      throw new Error(`${rt.toTag} ${toPath} 좌표가 예상과 다릅니다: ${toPom.groupId}:${toPom.artifactId} (예상 ${rt.toGroupId}:${expected})`);
    if (fromPom.groupId !== rt.fromGroupId || fromPom.artifactId !== name)
      throw new Error(`${rt.fromTag} ${modulePath} 좌표가 예상과 다릅니다: ${fromPom.groupId}:${fromPom.artifactId}`);
    const fromList = [{ groupId: fromPom.groupId, artifactId: fromPom.artifactId, era: "3.x" }];
    const midPath = mid.modules.get(toName);
    if (midPath) {
      const midPom = pomArtifact(dir, rt.midTag, midPath);
      if (midPom.artifactId !== toPom.artifactId) fromList.push({ groupId: midPom.groupId, artifactId: midPom.artifactId, era: "4.x" });
    }
    coordinates.push({ module, layer: modulePath.split("/")[0], from: fromList, to: { groupId: toPom.groupId, artifactId: toPom.artifactId } });
  }
  for (const rm of mapping.modules.removedModules) {
    if (!from.modules.has(rm.module === "spring-modules-validation" ? rm.module : `${rt.fromPackagePrefix}${rm.module}`))
      throw new Error(`removedModules.${rm.module} 이 ${rt.fromTag} 트리에 없습니다`);
    if (to.modules.has(`${rt.toPackagePrefix}${rm.module}`) || to.modules.has(rm.module))
      throw new Error(`removedModules.${rm.module} 이 ${rt.toTag} 트리에 여전히 있습니다`);
  }
  const newModules = [...to.modules.keys()]
    .filter((n) => !from.modules.has(n.replace(rt.toPackagePrefix, rt.fromPackagePrefix)))
    .sort()
    .map((n) => {
      const pom = pomArtifact(dir, rt.toTag, to.modules.get(n));
      if (pom.groupId !== rt.toGroupId) throw new Error(`${rt.toTag} 신규 모듈 ${n} 의 groupId 가 다릅니다: ${pom.groupId}`);
      return { module: n.slice(rt.toPackagePrefix.length), layer: to.modules.get(n).split("/")[0], to: pom };
    });

  // ── 2) 클래스: 접두어 변경 후 존재 여부 → 이름 변경·이동·제거 ──
  const renamedFrom = new Map(); // 접두어 변경 후 FQN -> 원래 FQN
  for (const fq of from.classes) if (fq.startsWith(rt.fromPackagePrefix)) renamedFrom.set(rt.toPackagePrefix + fq.slice(rt.fromPackagePrefix.length), fq);
  const bySimple = new Map();
  for (const fq of to.classes) { const s = simpleOf(fq); if (!bySimple.has(s)) bySimple.set(s, []); bySimple.get(s).push(fq); }

  const direct = [];
  const relocated = new Map(); // fq(renamed) -> to fq
  const missing = [];
  for (const fq of [...renamedFrom.keys()].sort()) {
    if (to.classes.has(fq)) { direct.push(fq); continue; }
    const cands = bySimple.get(simpleOf(fq)) ?? [];
    if (cands.length === 0) { missing.push(fq); continue; }
    // 후보가 여럿이면 패키지 공통 접두어가 가장 긴 것
    const best = [...cands].sort((a, b) => commonPrefixLen(pkgOf(b), pkgOf(fq)) - commonPrefixLen(pkgOf(a), pkgOf(fq)))[0];
    relocated.set(fq, best);
  }

  // 제거 클래스 ← 큐레이션 사유 필수
  const removedRules = mapping.removedClasses.map((r) => ({ ...r, re: r.match.includes("*") ? globToRe(r.match) : null }));
  const matchRemoved = (fq) => removedRules.find((r) => (r.re ? r.re.test(fq) : r.match === fq));
  const removed = [];
  const unexplained = [];
  for (const fq of missing) {
    const rule = matchRemoved(fq);
    if (!rule) { unexplained.push(fq); continue; }
    if (rule.replacement && !to.classes.has(rule.replacement)) throw new Error(`removedClasses '${rule.match}' 의 replacement 가 ${rt.toTag} 에 없습니다: ${rule.replacement}`);
    removed.push({ class: fq, legacyClass: renamedFrom.get(fq), replacement: rule.replacement ?? null, reason: rule.reason, presentIn4x: mid.classes.has(fq) });
  }
  if (unexplained.length > 0)
    throw new Error(`${rt.toTag} 에 없는데 migration-mapping.json 에 사유가 없는 클래스 ${unexplained.length}개:\n  ${unexplained.join("\n  ")}`);
  for (const r of removedRules) {
    const used = removed.some((x) => (r.re ? r.re.test(x.class) : r.match === x.class));
    if (!used) throw new Error(`removedClasses '${r.match}' 에 해당하는 제거 클래스가 없습니다(규칙이 낡았거나 오타)`);
  }

  // 패키지 단위 이름 변경으로 묶을 수 있는 이동: fromRoot→toRoot 가 그 아래 모든 3.x 클래스를 설명하면 rename
  const renameCandidates = new Map();
  for (const [fq, dst] of relocated) {
    const a = pkgOf(fq).split("."), b = pkgOf(dst).split(".");
    while (a.length > 1 && b.length > 1 && a[a.length - 1] === b[b.length - 1]) { a.pop(); b.pop(); }
    const key = `${a.join(".")}→${b.join(".")}`;
    renameCandidates.set(key, { from: a.join("."), to: b.join(".") });
  }
  const packageRenames = [];
  const covered = new Set();
  for (const { from: fr, to: tp } of renameCandidates.values()) {
    if (fr === tp) continue;
    const under = [...renamedFrom.keys()].filter((fq) => fq.startsWith(`${fr}.`));
    const ok = under.every((fq) => {
      const dst = `${tp}.${fq.slice(fr.length + 1)}`;
      return to.classes.has(dst) || (matchRemoved(fq) && !to.classes.has(fq));
    });
    // to 쪽에 원래 패키지가 남아 있으면(부분 이동) rename 이 아니다
    const fromStillExists = [...to.classes].some((fq) => fq.startsWith(`${fr}.`));
    if (!ok || fromStillExists) continue;
    const moved = under.filter((fq) => relocated.has(fq));
    if (moved.length === 0) continue;
    packageRenames.push({ from: `${fr}.`, to: `${tp}.`, classes: moved.length });
    for (const fq of moved) covered.add(fq);
  }
  packageRenames.sort((x, y) => x.from.localeCompare(y.from));
  const classMoves = [...relocated].filter(([fq]) => !covered.has(fq)).map(([fq, dst]) => ({ from: fq, to: dst, legacyFrom: renamedFrom.get(fq) })).sort((x, y) => x.from.localeCompare(y.from));
  // 이동 결과가 5.x 에 실제로 있는지(당연하지만) 재확인
  for (const m of classMoves) if (!to.classes.has(m.to)) throw new Error(`classMoves 목적지가 없습니다: ${m.to}`);

  // ── 3) 5.x 클래스·패키지 목록(알 수 없는 참조 감지용) ──
  const packages5 = new Set();
  for (const fq of to.classes) { const parts = pkgOf(fq).split("."); for (let i = 3; i <= parts.length; i++) packages5.add(parts.slice(0, i).join(".")); }

  // ── 4) 큐레이션 검증 ──────────────────────────────────
  for (const ns of mapping.xmlNamespaces.removed) if (ns.replacement && ns.replacement.startsWith(rt.toPackagePrefix) && !to.classes.has(ns.replacement)) throw new Error(`xmlNamespaces replacement 가 ${rt.toTag} 에 없습니다: ${ns.replacement}`);
  const seenPkg = new Set();
  for (const p of mapping.jakarta.packages) {
    if (!p.from.startsWith("javax.") || !p.to.startsWith("jakarta.")) throw new Error(`jakarta.packages 항목이 이상합니다: ${p.from} → ${p.to}`);
    if (p.to !== `jakarta.${p.from.slice("javax.".length)}`) throw new Error(`jakarta.packages 대응이 규칙적이지 않습니다: ${p.from} → ${p.to}`);
    if (seenPkg.has(p.from)) throw new Error(`jakarta.packages 중복: ${p.from}`);
    seenPkg.add(p.from);
  }
  const seenArt = new Set();
  for (const a of mapping.jakarta.artifacts) {
    const k = `${a.from.groupId}:${a.from.artifactId}`;
    if (seenArt.has(k)) throw new Error(`jakarta.artifacts 중복: ${k}`);
    seenArt.add(k);
  }

  const rules = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-migration-rules.mjs",
    surveyedAt: new Date().toISOString().slice(0, 10),
    source: {
      repository: rt.repository,
      fromTag: rt.fromTag, fromCommit: commit(rt.fromTag),
      midTag: rt.midTag, midCommit: commit(rt.midTag),
      toTag: rt.toTag, toCommit: commit(rt.toTag),
      samples: {
        web: "eGovFramework/egovframe-vscode-initializr templates(egovframe-web)·egovframe-web-sample v5.0.x",
        boot: "eGovFramework/egovframe-vscode-initializr templates(egovframe-boot-web)",
        legacy: "eGovFramework/egovframe-common-components v3.10.0 pom.xml·web.xml, egovframe-web-sample v4.3.0 pom.xml",
      },
    },
    target: mapping.target,
    coordinates,
    removedModules: mapping.modules.removedModules.map(({ module, fromArtifactId, reason }) => ({ module, fromArtifactId, reason })),
    newModules,
    packages: {
      prefix: { from: rt.fromPackagePrefix, to: rt.toPackagePrefix },
      renames: packageRenames,
      moves: classMoves,
      removed: removed,
    },
    jakarta: { packages: mapping.jakarta.packages, artifacts: mapping.jakarta.artifacts, note: mapping.jakarta.comment },
    libraries: mapping.libraries.manual,
    xmlNamespaces: mapping.xmlNamespaces.removed,
    build: mapping.build,
    evidence: {
      classes: { from: from.classes.size, mid: mid.classes.size, to: to.classes.size, direct: direct.length, relocated: relocated.size, removed: removed.length },
      packages5: [...packages5].sort(),
      classes5: [...to.classes].sort(),
    },
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(rules, null, 2)}\n`, "utf8");
  console.log(
    `migration-rules.json 생성: 모듈 ${coordinates.length}종(제거 ${rules.removedModules.length}, 신규 ${newModules.length}), ` +
      `클래스 ${from.classes.size}→${to.classes.size} (그대로 ${direct.length}, 패키지 변경 ${packageRenames.length}건/${covered.size}클래스, 이동 ${classMoves.length}, 제거 ${removed.length})`,
  );
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}

const isDirectRun = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) await main();
