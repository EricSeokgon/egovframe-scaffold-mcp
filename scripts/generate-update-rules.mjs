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
 * 사용법:
 *   node scripts/generate-update-rules.mjs --runtime-dir <egovframe-runtime clone> [--m2 ~/.m2/repository]
 *   node scripts/generate-update-rules.mjs            # 임시 디렉터리에 부분 클론, parent pom 은 mvn dependency:get 으로 받음
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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
      if (!latestClasses.has(cls)) throw new Error(`${c.id}: ${cls} 가 ${tags[tags.length - 1].tag} 에 없습니다`);
      if (!steps[c.since].has(cls)) throw new Error(`${c.id}: ${cls} 는 ${stepFrom} → ${c.since} 에서 바뀌지 않았습니다`);
    }
    return { ...c, action: "manual", evidence: { fromTag: `v${stepFrom}-Final`, toTag: `v${c.since}-Final` } };
  });

  const out = {
    schemaVersion: 1,
    surveyedAt: new Date().toISOString().slice(0, 10),
    generatedBy: "scripts/generate-update-rules.mjs",
    note: "5.x 안의 갱신(migrate_egovframe_project target=5.0.x) 규칙. parent·RTE 버전은 auto, 바뀐 API·동작은 프로젝트가 그 클래스를 참조할 때만 manual 로 보고한다.",
    source: { repository: REPO, mavenRepository: MAVEN_REPO_URL, tags: tags.map(({ tag, version, commit }) => ({ tag, version, commit })) },
    versions, latest,
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
