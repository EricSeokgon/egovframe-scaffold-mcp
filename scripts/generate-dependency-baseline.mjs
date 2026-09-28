#!/usr/bin/env node
/**
 * 공식 5.x parent pom 에서 의존성 기준 버전을 추출한다 → catalog/dependency-baseline.json (v0.30)
 *
 *   출처(표준프레임워크 Maven 저장소 https://maven.egovframe.go.kr/maven/):
 *     org.egovframe.web:egovframe-web-config-parent   — 웹(Classic) 프로젝트 parent: <properties> + <dependencyManagement>
 *     org.egovframe.boot:egovframe-boot-starter-parent — Boot 프로젝트 parent: 위와 같고, 상위 spring-boot-starter-parent 버전을 기록
 *
 *   기준 버전은 "공식 템플릿이 관리하는 버전" 이다. 프로젝트 의존성이 이보다 낮으면 outdated 로 본다.
 *   Boot parent 가 상속하는 spring-boot-dependencies BOM 의 전체 목록은 담지 않는다(수백 항목) — Boot parent 를 쓰는 프로젝트의
 *   버전 없는 의존성은 "parent 관리" 로 분류한다.
 *
 * 사용법:
 *   node scripts/generate-dependency-baseline.mjs                       # 고정 버전 내려받아 생성
 *   node scripts/generate-dependency-baseline.mjs --web 5.0.1 --boot 5.0.1
 *   node scripts/generate-dependency-baseline.mjs --offline <dir>      # <dir>/web-parent.pom, <dir>/boot-parent.pom 사용
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_JSON = path.join(ROOT, "catalog", "dependency-baseline.json");
const RULES_JSON = path.join(ROOT, "catalog", "migration-rules.json");

export const REPO = "https://maven.egovframe.go.kr/maven/";
export const PARENTS = {
  web: { groupId: "org.egovframe.web", artifactId: "egovframe-web-config-parent", version: "5.0.1" },
  boot: { groupId: "org.egovframe.boot", artifactId: "egovframe-boot-starter-parent", version: "5.0.1" },
};
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const pomUrl = (p) => `${REPO}${p.groupId.replace(/\./g, "/")}/${p.artifactId}/${p.version}/${p.artifactId}-${p.version}.pom`;

async function fetchText(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "egovframe-scaffold-mcp" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function parseParentPom(xml) {
  const props = new Map();
  const propsBlock = xml.match(/<properties>([\s\S]*?)<\/properties>/);
  if (propsBlock) for (const m of propsBlock[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  const resolve = (v) => { let out = v; for (let i = 0; i < 5 && /\$\{[\w.\-]+\}/.test(out); i++) out = out.replace(/\$\{([\w.\-]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`); return out; };
  const parent = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
  const parentCoord = parent
    ? { groupId: parent.match(/<groupId>\s*([^<\s]+)/)?.[1], artifactId: parent.match(/<artifactId>\s*([^<\s]+)/)?.[1], version: parent.match(/<version>\s*([^<\s]+)/)?.[1] }
    : null;
  const dm = xml.match(/<dependencyManagement>\s*<dependencies>([\s\S]*?)<\/dependencies>\s*<\/dependencyManagement>/)?.[1] ?? "";
  const managed = [];
  for (const m of dm.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const b = m[1];
    const g = b.match(/<groupId>\s*([^<\s]+)/)?.[1], a = b.match(/<artifactId>\s*([^<\s]+)/)?.[1], v = b.match(/<version>\s*([^<\s]+)/)?.[1];
    if (!g || !a || !v) continue;
    const entry = { groupId: g, artifactId: a, version: resolve(v) };
    const scope = b.match(/<scope>\s*([^<\s]+)/)?.[1];
    const type = b.match(/<type>\s*([^<\s]+)/)?.[1];
    if (scope) entry.scope = scope;
    if (type) entry.type = type;
    if (/\$\{/.test(entry.version)) throw new Error(`해결되지 않은 버전 속성: ${g}:${a} = ${v}`);
    managed.push(entry);
  }
  const versionProps = {};
  for (const [k, v] of props) if (/version/i.test(k)) versionProps[k] = resolve(v);
  return { parentCoord, java: props.get("java.version") ?? null, properties: versionProps, managed };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const offlineDir = arg("--offline");
  const web = { ...PARENTS.web, version: arg("--web") ?? PARENTS.web.version };
  const boot = { ...PARENTS.boot, version: arg("--boot") ?? PARENTS.boot.version };
  for (const p of [web, boot]) if (!/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error(`버전 형식: ${p.version}`);

  const read = async (p, file) => (offlineDir ? fs.readFileSync(path.join(offlineDir, file), "utf8") : fetchText(pomUrl(p)));
  const webXml = await read(web, "web-parent.pom");
  const bootXml = await read(boot, "boot-parent.pom");
  const w = parseParentPom(webXml);
  const b = parseParentPom(bootXml);
  if (w.parentCoord) throw new Error("web parent 에 상위 parent 가 생겼습니다 — 생성기가 상위 BOM 을 따라가도록 보강해야 합니다");
  if (!b.parentCoord || b.parentCoord.artifactId !== "spring-boot-starter-parent") throw new Error("boot parent 의 상위가 spring-boot-starter-parent 가 아닙니다");
  if (w.java !== "17" || b.java !== "17") throw new Error(`java.version 이 17 이 아닙니다: web ${w.java}, boot ${b.java}`);

  const rules = JSON.parse(fs.readFileSync(RULES_JSON, "utf8"));
  const rteVersion = rules.target.runtimeVersion;

  // 두 parent 의 관리 목록을 합친다. 같은 좌표가 양쪽에 있으면 높은 버전을 기준으로 삼고 출처를 모두 적는다.
  const byKey = new Map();
  const add = (list, source) => {
    for (const e of list) {
      const k = `${e.groupId}:${e.artifactId}`;
      const cur = byKey.get(k);
      if (!cur) { byKey.set(k, { ...e, sources: [source] }); continue; }
      if (!cur.sources.includes(source)) cur.sources.push(source);
      if (compareVersions(e.version, cur.version) > 0) { cur.version = e.version; cur.versionBySource = { ...(cur.versionBySource ?? {}), [source]: e.version }; }
      else if (e.version !== cur.version) cur.versionBySource = { ...(cur.versionBySource ?? {}), [source]: e.version };
    }
  };
  add(w.managed, "web");
  add(b.managed, "boot");
  // RTE 모듈은 실행환경 최신(규칙 카탈로그 목표) 기준으로 올린다 — parent 가 관리하는 버전보다 새 릴리스가 있을 수 있다
  for (const [k, e] of byKey) if (e.groupId === "org.egovframe.rte" && compareVersions(rteVersion, e.version) > 0) { e.parentVersion = e.version; e.version = rteVersion; }
  const managed = [...byKey.values()].sort((x, y) => `${x.groupId}:${x.artifactId}`.localeCompare(`${y.groupId}:${y.artifactId}`));

  // BOM import(type pom·scope import)는 그 groupId 계열 전체의 버전을 정한다 — 계열 규칙으로 기록해 개별 artifact 가 목록에 없어도 대조할 수 있게 한다.
  // 웹 parent 의 spring.framework.version 속성도 같은 뜻이다(직접 나열한 spring-* 항목과 함께).
  const families = new Map();
  const addFamily = (groupIdPrefix, version, via) => { const cur = families.get(groupIdPrefix); if (!cur || compareVersions(version, cur.version) > 0) families.set(groupIdPrefix, { groupIdPrefix, version, via }); };
  for (const e of managed) if (e.type === "pom" && e.scope === "import") {
    const prefix = e.artifactId === "jackson-bom" ? "com.fasterxml.jackson" : e.groupId;
    addFamily(prefix, e.version, `${e.groupId}:${e.artifactId}:${e.version} (BOM import, ${e.sources.join("/")})`);
  }
  if (w.properties["spring.framework.version"]) addFamily("org.springframework", w.properties["spring.framework.version"], `web parent spring.framework.version`);
  if (b.properties["spring.security.version"]) addFamily("org.springframework.security", b.properties["spring.security.version"], `boot parent spring.security.version`);
  if (b.properties["spring.batch.version"]) addFamily("org.springframework.batch", b.properties["spring.batch.version"], `boot parent spring.batch.version`);
  if (w.properties["jackson.version"]) addFamily("com.fasterxml.jackson", w.properties["jackson.version"], `web parent jackson.version`);
  addFamily("org.springframework.boot", b.parentCoord.version, `boot parent 의 상위 spring-boot-starter-parent`);

  const baseline = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-dependency-baseline.mjs",
    surveyedAt: new Date().toISOString().slice(0, 10),
    repository: REPO,
    sources: [
      { kind: "web", ...web, url: pomUrl(web), sha256: sha256(webXml), managed: w.managed.length },
      { kind: "boot", ...boot, url: pomUrl(boot), sha256: sha256(bootXml), managed: b.managed.length, parent: b.parentCoord },
    ],
    java: 17,
    rte: { version: rteVersion, parentManaged: { web: w.properties["egovframe.rte.version"] ?? null, boot: b.properties["egovframe.rte.version"] ?? null } },
    spring: { framework: w.properties["spring.framework.version"] ?? null, boot: b.parentCoord.version, security: b.properties["spring.security.version"] ?? null },
    properties: { web: w.properties, boot: b.properties },
    managed,
    families: [...families.values()].sort((x, y) => x.groupIdPrefix.localeCompare(y.groupIdPrefix)),
  };
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`dependency-baseline.json 생성: 관리 좌표 ${managed.length}종 (web ${w.managed.length}, boot ${b.managed.length}) + 계열 ${baseline.families.length}종, RTE ${rteVersion}, Spring ${baseline.spring.framework}, Boot ${baseline.spring.boot}`);
}

export function compareVersions(a, b) {
  const pa = String(a).match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  const pb = String(b).match(/^\d+(?:\.\d+)*/)?.[0].split(".").map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] ?? 0, y = pb[i] ?? 0; if (x !== y) return x < y ? -1 : 1; }
  return 0;
}

const isDirectRun = (() => {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) await main();
