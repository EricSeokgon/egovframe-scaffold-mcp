// node test/migration-rules-live.mjs — 전환 규칙의 목적지 좌표가 실제 저장소에 존재하는지 (네트워크, CI integration 전용)
//   - RTE 5.x 좌표·parent·신규 모듈: https://maven.egovframe.go.kr/maven/ 의 <artifact>-<version>.pom
//   - Jakarta 좌표: Maven Central 의 <artifact>-<version>.pom
//   - 3.x 원본 좌표도 표준프레임워크 저장소에 있어야 한다(대응표 from 쪽 검증)
import { loadMigrationRules } from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }

const rules = loadMigrationRules();
const EGOV = rules.target.repositoryUrl;
const CENTRAL = "https://repo1.maven.org/maven2/";
const pomUrl = (base, g, a, v) => `${base}${g.replace(/\./g, "/")}/${a}/${v}/${a}-${v}.pom`;

async function exists(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "egovframe-scaffold-mcp" }, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 200) return true;
      if (res.status === 404) return false;
    } catch { /* 재시도 */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`응답 없음: ${url}`);
}

const v = rules.target.runtimeVersion;
const checks = [];
for (const c of rules.coordinates) {
  checks.push([`RTE 5.x: ${c.to.groupId}:${c.to.artifactId}:${v}`, pomUrl(EGOV, c.to.groupId, c.to.artifactId, v)]);
  const from3 = c.from.find((f) => f.era === "3.x");
  checks.push([`RTE 3.x 원본: ${from3.groupId}:${from3.artifactId}:${rules.source.fromTag.slice(1)}`, pomUrl(EGOV, from3.groupId, from3.artifactId, rules.source.fromTag.slice(1))]);
}
for (const m of rules.newModules) checks.push([`RTE 5.x 신규: ${m.to.artifactId}:${v}`, pomUrl(EGOV, m.to.groupId, m.to.artifactId, v)]);
for (const p of rules.target.parents) checks.push([`parent: ${p.groupId}:${p.artifactId}:${p.version}`, pomUrl(EGOV, p.groupId, p.artifactId, p.version)]);
for (const a of rules.jakarta.artifacts) {
  checks.push([`Jakarta: ${a.to.groupId}:${a.to.artifactId}:${a.toVersion}`, pomUrl(CENTRAL, a.to.groupId, a.to.artifactId, a.toVersion)]);
  if (a.also) checks.push([`Jakarta 구현: ${a.also.groupId}:${a.also.artifactId}:${a.also.version}`, pomUrl(CENTRAL, a.also.groupId, a.also.artifactId, a.also.version)]);
}
const seen = new Set();
const unique = checks.filter(([, u]) => !seen.has(u) && seen.add(u));

const CONCURRENCY = 6;
let i = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < unique.length) {
    const [label, url] = unique[i++];
    try { assert(await exists(url), `${label} — ${url}`); } catch (e) { assert(false, `${label} — ${e.message}`); }
  }
}));
if (process.exitCode) console.error(`migration-rules-live FAIL (${n} checks)`); else console.log(`migration-rules-live OK (${n} checks)`);
