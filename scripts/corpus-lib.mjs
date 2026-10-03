// 회귀 코퍼스 공용 모듈 (v0.37) — catalog/migration-corpus.json 의 항목을 내려받고(sparse 부분 클론), 측정하고, 기대값과 비교한다.
//   generate-migration-corpus.mjs(기대값 기록)와 test/migrate-corpus.mjs(단언)가 같은 코드를 쓴다.
//   코퍼스 트리는 include 목록(pom.xml·src/main/java·src/main/resources·src/main/webapp/WEB-INF·src/test)만 체크아웃한다 —
//   전체 저장소(스크립트·폰트·이미지 ≈ 250MB)를 받지 않고도 스캔 대상 텍스트 파일은 전부 포함되며, 기대값은 이 부분 트리 기준이다.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS_PATH = path.join(ROOT, "catalog", "migration-corpus.json");
/** 트리 캐시: EGOV_CORPUS_CACHE > <repo>/.corpus-cache */
export const cacheDir = () => path.resolve(process.env.EGOV_CORPUS_CACHE || path.join(ROOT, ".corpus-cache"));

export function loadCorpus() {
  return JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
}

const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();

/** 항목의 트리를 캐시에 준비하고 디렉터리를 돌려준다. 커밋이 다르면(태그 이동) 실패한다. */
export function materializeEntry(corpus, entry, opts = {}) {
  const base = opts.dir ?? cacheDir();
  const dir = path.join(base, entry.id);
  const marker = path.join(dir, ".egov-corpus.json");
  if (fs.existsSync(marker)) {
    const m = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (m.commit === entry.commit && JSON.stringify(m.include) === JSON.stringify(corpus.include)) return { dir, cached: true };
    fs.rmSync(dir, { recursive: true, force: true });
  } else if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  const url = `https://github.com/${corpus.repository}.git`;
  execFileSync("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", entry.tag, url, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  git(dir, ["sparse-checkout", "set", "--no-cone", ...corpus.include.map((p) => (p.endsWith("/") || /\.[a-z0-9]+$/i.test(p) ? `/${p}` : `/${p}/`))]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  if (head !== entry.commit) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`${entry.id}: 태그 ${entry.tag} 의 커밋이 ${head.slice(0, 7)} — 코퍼스에 기록된 ${entry.commit.slice(0, 7)} 과 다릅니다(태그 이동). 기대값을 다시 만드세요.`); }
  fs.writeFileSync(marker, `${JSON.stringify({ id: entry.id, tag: entry.tag, commit: head, include: corpus.include, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
  return { dir, cached: false };
}

function countFiles(dir, ext) {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === ".git") continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && p.endsWith(ext)) n++; } };
  walk(dir);
  return n;
}

/** 진단·dryRun 적용·의존성 점검·평가서를 돌려 측정값을 만든다(네트워크 없음). */
export async function measureEntry(api, dir) {
  const m = api.migrateProject({ projectDir: dir });
  const a = await api.applyMigration({ projectDir: dir, dryRun: true });
  const d = await api.checkDependencies({ projectDir: dir });
  const s = await api.assessProject({ projectDir: dir });
  const kinds = (...ks) => m.items.filter((i) => ks.includes(i.kind)).length;
  const coord = (f) => `${f.groupId}:${f.artifactId}`;
  return {
    javaFiles: countFiles(dir, ".java"),
    filesScanned: m.filesScanned,
    migration: {
      sourceEra: m.sourceEra, rteVersion: m.rteVersion, items: m.items.length, auto: m.summary.auto, manual: m.summary.manual, files: m.summary.files,
      byKind: Object.fromEntries(Object.entries(m.summary.byKind).sort()),
      reassemble: kinds("component-reassemble"), removedApiRefs: m.items.filter((i) => api.REMOVED_API_KINDS.includes(i.kind)).length,
      unknownClasses: kinds("class-unknown", "coordinate-unknown"),
    },
    apply: { items: a.applied.items, edits: a.applied.edits, files: a.files.length, conflicts: a.conflicts.length, skippedManual: a.skippedManual },
    dependencies: {
      findings: d.findings.length, summary: d.summary, parentKind: d.parent.kind, java: d.java.value,
      unknown: d.findings.filter((f) => f.status === "unknown").map(coord).sort(), vendor: d.findings.filter((f) => f.status === "vendor").map(coord).sort(),
      checksMissing: d.checks.filter((c) => c.status === "missing").map((c) => c.id),
    },
    grades: { migration: s.grades.migration.grade, migrationScore: s.grades.migration.score, supplyChain: s.grades.supplyChain.grade, supplyChainScore: s.grades.supplyChain.score },
  };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** 기대값과 측정값을 비교한다. 숫자는 ±max(abs, round(expected·pct)) 안이면 통과, 그 외(문자열·배열·불리언)는 완전 일치. */
export function compareEntry(expected, actual, tolerance = { pct: 0, abs: 0 }, prefix = "") {
  const diffs = [];
  const keys = new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})]);
  for (const k of keys) {
    const e = expected?.[k];
    const v = actual?.[k];
    const name = prefix ? `${prefix}.${k}` : k;
    if (isNum(e) || isNum(v)) {
      if (!isNum(e) || !isNum(v)) { diffs.push(`${name}: 기대 ${JSON.stringify(e)} ≠ 측정 ${JSON.stringify(v)}`); continue; }
      const allow = Math.max(tolerance.abs ?? 0, Math.round(Math.abs(e) * (tolerance.pct ?? 0)));
      if (Math.abs(e - v) > allow) diffs.push(`${name}: 기대 ${e}±${allow} ≠ 측정 ${v}`);
    } else if (e && typeof e === "object" && !Array.isArray(e) && v && typeof v === "object" && !Array.isArray(v)) {
      diffs.push(...compareEntry(e, v, tolerance, name));
    } else if (JSON.stringify(e) !== JSON.stringify(v)) {
      diffs.push(`${name}: 기대 ${JSON.stringify(e)} ≠ 측정 ${JSON.stringify(v)}`);
    }
  }
  return diffs;
}
