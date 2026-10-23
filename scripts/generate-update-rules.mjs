#!/usr/bin/env node
/**
 * 5.x 안의 갱신 규칙 생성 → catalog/update-rules.json (v0.46)
 *
 *   근거
 *   - eGovFramework/egovframe-runtime 의 v5.0.x-Final 태그: 버전 목록과 단계별(직전 태그 → 태그) 변경 클래스
 *   - 공식 parent(egovframe-web-config-parent·egovframe-boot-starter-parent) 각 버전의 pom: <properties> 와 Spring Boot parent 버전
 *   큐레이션(바뀐 API·동작의 요약과 사유)은 catalog/update-mapping.json 에서 읽는다.
 *   큐레이션 항목의 클래스가 latest 태그에 없거나 그 단계에서 바뀌지 않았으면 실패한다 — 근거 없는 "manual" 을 막기 위해서다.
 *
 *   v1.3: GitHub 태그가 아직 없는 버전(update-mapping.json 의 mavenSteps, 예: 5.1.0)은 표준프레임워크 Maven 저장소의
 *   sources jar 로 단계를 만든다 — 새 버전의 BOM(egovframe-rte-root)에 있는 RTE 모듈마다 직전 버전·새 버전 sources jar 를 받아
 *   공백만 다른 것을 빼고 내용이 바뀐 클래스와 새 클래스를 그 단계의 변경으로 본다(근거 evidence.kind = "maven-sources", jar 별 sha256 기록).
 *   태그가 생기면 mavenSteps 에서 그 버전을 빼고 다시 생성한다(git 태그 비교로 바뀜).
 *
 * 사용법:
 *   node scripts/generate-update-rules.mjs --runtime-dir <egovframe-runtime clone> [--m2 ~/.m2/repository]
 *   node scripts/generate-update-rules.mjs            # 임시 디렉터리에 부분 클론, parent pom 은 mvn dependency:get 으로 받음
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAPPING_PATH = path.join(ROOT, "catalog", "update-mapping.json");
const OUT_JSON = path.join(ROOT, "catalog", "update-rules.json");
const REPO = "eGovFramework/egovframe-runtime";
const MAVEN_REPO_URL = "https://maven.egovframe.go.kr/maven/";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const cmpVer = (a, b) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); return 0; };

let runtimeDir = arg("--runtime-dir");
let tmp = null;
if (!runtimeDir) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egov-update-rules-"));
  runtimeDir = path.join(tmp, "runtime");
  execFileSync("git", ["clone", "-q", "--filter=blob:none", `https://github.com/${REPO}.git`, runtimeDir], { stdio: "inherit" });
}
const m2 = arg("--m2") ?? path.join(os.homedir(), ".m2", "repository");
const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));

try {
  // 1) 태그 → 버전
  const tags = git(runtimeDir, ["tag", "-l", "v5.0.*-Final"]).split("\n").filter(Boolean)
    .map((tag) => ({ tag, version: tag.replace(/^v/, "").replace(/-Final$/, ""), commit: git(runtimeDir, ["rev-list", "-n", "1", tag]).trim() }))
    .filter((t) => /^5\.0\.\d+$/.test(t.version))
    .sort((a, b) => cmpVer(a.version, b.version));
  if (tags.length < 2) throw new Error(`v5.0.x-Final 태그가 2개 미만입니다: ${tags.map((t) => t.tag).join(", ")}`);
  const versions = tags.map((t) => t.version);
  const latest = versions[versions.length - 1];

  // 2) 단계별 변경 클래스(src/main/java)
  const steps = {};
  for (let i = 1; i < tags.length; i++) {
    const files = git(runtimeDir, ["diff", "--name-only", tags[i - 1].tag, tags[i].tag, "--", "*src/main/java/*"]).split("\n").filter(Boolean);
    steps[tags[i].version] = new Set(files.map((f) => f.replace(/^.*\/src\/main\/java\//, "").replace(/\.java$/, "").split("/").join(".")));
  }
  const latestClasses = new Set(git(runtimeDir, ["ls-tree", "-r", "--name-only", tags[tags.length - 1].tag]).split("\n")
    .filter((f) => f.includes("/src/main/java/") && f.endsWith(".java"))
    .map((f) => f.replace(/^.*\/src\/main\/java\//, "").replace(/\.java$/, "").split("/").join(".")));

  // 2-b) v1.3: 태그 없는 버전 — 저장소 sources jar 비교
  const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
  const fetchBuf = async (url) => { const r = await fetch(url, { headers: { "User-Agent": "egovframe-scaffold-mcp" } }); if (r.status === 404) return null; if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };
  const rteUrl = (a, v, cls = "") => `${MAVEN_REPO_URL}org/egovframe/rte/${a}/${v}/${a}-${v}${cls}`;
  const javaSources = (buf) => { const out = new Map(); for (const e of new AdmZip(buf).getEntries()) if (e.entryName.endsWith(".java") && !e.isDirectory) out.set(e.entryName.replace(/\.java$/, "").split("/").join("."), e.getData().toString("utf8").replace(/\s+/g, " ").trim()); return out; };
  const mavenSteps = [];
  let mavenLatestClasses = null;
  for (const ms of mapping.mavenSteps ?? []) {
    if (versions.includes(ms.version)) throw new Error(`mavenSteps ${ms.version} 는 이미 태그가 있습니다 — update-mapping.json 의 mavenSteps 에서 빼세요`);
    const prev = versions[versions.length - 1];
    const bom = await fetchBuf(rteUrl("egovframe-rte-root", ms.version, ".pom"));
    if (!bom) throw new Error(`egovframe-rte-root ${ms.version} 가 저장소에 없습니다`);
    const dm = bom.toString("utf8").match(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/)?.[0] ?? "";
    const modules = [...new Set([...dm.matchAll(/<groupId>org\.egovframe\.rte<\/groupId>\s*<artifactId>(egovframe-rte-[\w-]+)<\/artifactId>/g)].map((m) => m[1]).filter((a) => a !== "egovframe-rte-root"))].sort();
    const changed = new Set();
    const all = new Set();
    const evidence = [];
    for (const a of modules) {
      const next = await fetchBuf(rteUrl(a, ms.version, "-sources.jar"));
      if (!next) throw new Error(`${a}-${ms.version}-sources.jar 가 저장소에 없습니다`);
      const before = await fetchBuf(rteUrl(a, prev, "-sources.jar"));
      const nb = javaSources(next), ob = before ? javaSources(before) : new Map();
      let n = 0;
      for (const [cls, text] of nb) { all.add(cls); if (ob.get(cls) !== text) { changed.add(cls); n++; } }
      evidence.push({ artifactId: a, from: before ? { version: prev, sha256: sha256(before) } : null, to: { version: ms.version, sha256: sha256(next) }, changed: n });
    }
    steps[ms.version] = changed;
    mavenLatestClasses = all;
    mavenSteps.push({ version: ms.version, kind: "maven-sources", from: prev, reason: ms.reason, reason_en: ms.reason_en, bom: { url: rteUrl("egovframe-rte-root", ms.version, ".pom"), sha256: sha256(bom) }, modules: evidence });
    versions.push(ms.version);
    console.log(`mavenStep ${prev} → ${ms.version}: 모듈 ${modules.length}종, 변경·추가 클래스 ${changed.size}`);
  }
  const effectiveLatest = versions[versions.length - 1];
  const latestClassSet = mavenLatestClasses ?? latestClasses;

  // 3) parent pom
  const readPom = (g, a, v) => {
    const p = path.join(m2, ...g.split("."), a, v, `${a}-${v}.pom`);
    if (!fs.existsSync(p)) {
      execFileSync(process.platform === "win32" ? "mvn.cmd" : "mvn", ["-q", "dependency:get", `-Dartifact=${g}:${a}:${v}:pom`, `-DremoteRepositories=egov::default::${MAVEN_REPO_URL}`, "-Dtransitive=false"], { stdio: "inherit", shell: process.platform === "win32" });
    }
    return fs.readFileSync(p, "utf8");
  };
  const parents = mapping.parents.map((p) => {
    const byVersion = {};
    for (const v of versions) {
      const text = readPom(p.groupId, p.artifactId, v);
      const props = {};
      const block = text.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? "";
      for (const m of block.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props[m[1]] = m[2];
      const parent = text.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? "";
      const bootParent = /spring-boot-starter-parent/.test(parent) ? parent.match(/<version>\s*([^<\s]+)/)?.[1] ?? null : null;
      const rte = mapping.rteVersionProperties.map((k) => props[k]).find(Boolean) ?? null;
      if (rte !== v) throw new Error(`${p.artifactId}:${v} 의 RTE 버전 속성(${rte})이 parent 버전과 다릅니다`);
      byVersion[v] = { ...(bootParent ? { bootParent } : {}), properties: props };
    }
    return { kind: p.kind, groupId: p.groupId, artifactId: p.artifactId, versions: byVersion };
  });

  // 4) 큐레이션 검증
  const changes = mapping.changes.map((c) => {
    if (!versions.includes(c.since) || c.since === versions[0]) throw new Error(`${c.id}: since ${c.since} 는 ${versions.slice(1).join("·")} 중 하나여야 합니다`);
    const stepFrom = versions[versions.indexOf(c.since) - 1];
    for (const cls of c.classes) {
      if (!latestClassSet.has(cls)) throw new Error(`${c.id}: ${cls} 가 ${effectiveLatest} 에 없습니다`);
      if (!steps[c.since].has(cls)) throw new Error(`${c.id}: ${cls} 는 ${stepFrom} → ${c.since} 에서 바뀌지 않았습니다`);
    }
    const viaMaven = mavenSteps.some((m) => m.version === c.since);
    return { ...c, action: "manual", evidence: viaMaven ? { kind: "maven-sources", from: stepFrom, to: c.since } : { fromTag: `v${stepFrom}-Final`, toTag: `v${c.since}-Final` } };
  });

  const out = {
    schemaVersion: 1,
    surveyedAt: new Date().toISOString().slice(0, 10),
    generatedBy: "scripts/generate-update-rules.mjs",
    note: "5.x 안의 갱신(migrate_egovframe_project target=5.0.x) 규칙. parent·RTE 버전은 auto, 바뀐 API·동작은 프로젝트가 그 클래스를 참조할 때만 manual 로 보고한다.",
    source: { repository: REPO, mavenRepository: MAVEN_REPO_URL, tags: tags.map(({ tag, version, commit }) => ({ tag, version, commit })), ...(mavenSteps.length ? { mavenSteps } : {}) },
    versions, latest: effectiveLatest,
    // v1.3: 기본 목표(생성 alignParent·target 생략 시). 태그 없는 버전은 명시 target 으로만 쓴다
    recommended: mapping.recommended ?? latest,
    ...(mavenSteps.length ? { provisional: mavenSteps.map((m) => ({ version: m.version, kind: m.kind, reason: m.reason, reason_en: m.reason_en })) } : {}),
    rteVersionProperties: mapping.rteVersionProperties,
    parents,
    changes,
    stepClassCounts: Object.fromEntries(Object.entries(steps).map(([v, s]) => [v, s.size])),
    components: mapping.components,
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`update-rules: ${versions.join(" → ")} · parent ${parents.length}종 · 변경 ${changes.length}건 → ${path.relative(ROOT, OUT_JSON)}`);
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
