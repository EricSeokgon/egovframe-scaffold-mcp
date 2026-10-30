// node test/database-live.mjs — DB 준비·검증(v1.10) 실자산 검증 (CI 통합: 네트워크·Docker)
//   (1) 공식 공통컴포넌트 전체(카탈로그 고정 커밋)의 MySQL 8.4·PostgreSQL 16 적재 — 초기화 오류 0, 테이블 수 = 준비한 수, 필수 행, 한글 왕복
//   (2) upstream #1386 재현: 원본 스크립트를 그대로 MySQL Docker 초기화에 넣으면 한글이 이중 인코딩되고, 준비본은 같은 조건에서 그대로
//   (3) upstream #1387 조건(latin1 클라이언트): 원본은 깨지고 준비본은 같은 값·정렬 규칙 utf8mb4_unicode_ci
//   (4) 조립 선별본(bbs·uss.umt·sec.ram·sym.mnu.mpm) PostgreSQL: 선별본이 빠뜨린 공통코드 테이블을 보완해 적재 통과
//   (5) 생성한 docker-compose.db.yml 이 docker compose config 를 통과
//   DB_LIVE_REGISTRY 로 이미지 레지스트리를 바꿀 수 있다(Docker Hub 요청 한도 회피, 예: mirror.gcr.io/library).
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const { downloadComponentsZip } = await import("../dist/components.js");
const registry = process.env.DB_LIVE_REGISTRY || "docker.io/library";
const sh = (args, input) => { const r = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const root = mkdtempSync(path.join(tmpdir(), "egov-db-live-"));
const HEX = Buffer.from("상담답변관리", "utf8").toString("hex").toUpperCase();
const PROBE = "SELECT HEX(PROGRM_KOREAN_NM) FROM COMTNPROGRMLIST WHERE PROGRM_FILE_NM='CnsltAnswerListInqire'";

if (sh(["info"]).code !== 0) { info("Docker 데몬 없음 — 건너뜀"); process.exit(0); }
const containers = [];
try {
  // 공통컴포넌트 전체 스크립트
  const src = m.loadCatalog().source;
  const { zip } = await downloadComponentsZip(src);
  const full = path.join(root, "full");
  for (const e of zip.getEntries()) {
    const rel = e.entryName.replace(/^[^/]+\//, "");
    if (e.isDirectory || !/^script\/(ddl|dml)\/(mysql|postgres)\/[^/]+\.sql$/.test(rel)) continue;
    mkdirSync(path.dirname(path.join(full, rel)), { recursive: true });
    writeFileSync(path.join(full, rel), e.getData());
  }
  writeFileSync(path.join(full, "pom.xml"), "<project/>");

  // (1) 전체 적재
  for (const db of ["mysql", "postgres"]) {
    const r = await m.prepareDatabase({ projectDir: full, database: db, run: true, imageRegistry: registry });
    const x = r.run;
    info(`${src.tag} ${db}: 테이블 ${x.tables?.actual}/${r.tables} · 뷰 ${r.views} · 문장 ${r.statements.schema}+${r.statements.data} · ${Math.round((x.durationMs ?? 0) / 1000)}초${x.errors.length ? ` · 오류 ${x.errors.slice(0, 3).join(" | ")}` : ""}`);
    assert(x.ran && x.ok && x.errors.length === 0 && r.tables > 150 && x.tables.actual === r.tables, `${db}: 공통컴포넌트 ${src.tag} 전체 적재 — 오류 0 · 테이블 ${x.tables?.actual}${x.ok ? "" : `\n${x.reason ?? ""}\n${x.logTail ?? ""}`}`);
    assert(x.rows.length >= 4 && x.rows.every((rw) => rw.actual >= rw.expected) && x.hangul?.ok, `${db}: 필수 행(${x.rows.map((rw) => `${rw.table} ${rw.actual}`).join(", ")})·한글 왕복 '${x.hangul?.expected}'`);
  }

  // (2)(3) MySQL 원본 vs 준비본
  const prep = await m.prepareDatabase({ projectDir: full, database: "mysql", dryRun: false, imageRegistry: registry });
  const ours = ["01-schema.sql", "02-data.sql"].map((f) => readFileSync(path.join(full, "scripts/egovframe-db/mysql", f), "utf8"));
  const orig = ["ddl", "dml"].map((k) => readFileSync(path.join(full, `script/${k}/mysql/com_${k.toUpperCase()}_mysql.sql`), "utf8"));
  const initDir = path.join(root, "orig-init");
  mkdirSync(initDir); writeFileSync(path.join(initDir, "01.sql"), orig[0]); writeFileSync(path.join(initDir, "02.sql"), orig[1]);
  chmodSync(initDir, 0o755); for (const f of ["01.sql", "02.sql"]) chmodSync(path.join(initDir, f), 0o644);
  const name = `egov-db-live-${Date.now()}`;
  containers.push(name);
  const svc = m.loadDeployRules().databases.mysql;
  const run = sh(["run", "-d", "--name", name, "-e", "MYSQL_ROOT_PASSWORD=pw", "-e", "MYSQL_DATABASE=com", "-v", `${initDir}:/docker-entrypoint-initdb.d:ro`, `${registry}/${svc.image}`, ...svc.command]);
  assert(run.code === 0, `원본 스크립트 MySQL 컨테이너${run.code ? `: ${run.out}` : ""}`);
  for (let i = 0; i < 150 && !/MySQL init process done/.test(sh(["logs", name]).out); i++) await new Promise((r) => setTimeout(r, 2000));
  // 초기화가 끝나면 서버가 한 번 재시작한다 — 접속이 되기 전에 질의하면 ERROR 2002(소켓 없음)가 나므로 접속될 때까지 기다린다
  const q = (dbn, sql) => sh(["exec", "-e", "MYSQL_PWD=pw", name, "mysql", "-uroot", "--default-character-set=utf8mb4", "-N", "-B", dbn, "-e", sql]).out.replace(/^.*Warning.*\n/gm, "").trim();
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = q("com", "SELECT 1") === "1"; if (!ready) await new Promise((r) => setTimeout(r, 2000)); }
  assert(ready, "원본 스크립트 MySQL: 초기화 뒤 재시작해 접속 가능");
  const isHex = (v) => /^[0-9A-F]+$/.test(v);
  const origHex = q("com", PROBE);
  assert(isHex(origHex) && origHex !== HEX && origHex.length > HEX.length, `#1386 재현: 원본을 Docker 초기화로 넣으면 한글 이중 인코딩 (${origHex.slice(0, 24)}… ≠ ${HEX.slice(0, 24)}…)`);
  q("com", "CREATE DATABASE c_ours; CREATE DATABASE c_orig;");
  const loadOurs = sh(["exec", "-i", "-e", "MYSQL_PWD=pw", name, "mysql", "-uroot", "--default-character-set=latin1", "c_ours"], ours.join("\n"));
  const loadOrig = sh(["exec", "-i", "-e", "MYSQL_PWD=pw", name, "mysql", "-uroot", "--default-character-set=latin1", "c_orig"], orig.join("\n"));
  assert(loadOurs.code === 0 && loadOrig.code === 0, `latin1 클라이언트 적재(준비본·원본) 오류 없음${loadOurs.code || loadOrig.code ? `: ${(loadOurs.out + loadOrig.out).slice(-300)}` : ""}`);
  const collation = q("c_ours", "SELECT DISTINCT TABLE_COLLATION FROM information_schema.tables WHERE table_schema='c_ours' AND table_type='BASE TABLE'");
  assert(q("c_ours", PROBE) === HEX && collation === "utf8mb4_unicode_ci", `#1387 조건(latin1 클라이언트): 준비본은 한글 그대로·정렬 규칙 ${collation}`);
  const origLatin1 = q("c_orig", PROBE);
  assert(isHex(origLatin1) && origLatin1 !== HEX, `#1387 조건: 원본은 latin1 클라이언트에서 한글이 깨짐 (${origLatin1.slice(0, 24)}…)`);
  info(`준비본 MySQL: 문자셋 교정 ${prep.charsetFixed}개 테이블`);

  // (5) compose
  const cfg = spawnSync("docker", ["compose", "-f", path.join(full, "scripts/egovframe-db/docker-compose.db.yml"), "config", "-q"], { encoding: "utf8", env: { ...process.env, DB_PASSWORD: "x" } });
  if (cfg.error || /is not a docker command|unknown command/i.test(`${cfg.stderr}`)) info("docker compose 플러그인 없음 — compose 확인 건너뜀");
  else assert(cfg.status === 0, `docker compose config${cfg.status ? `: ${cfg.stderr}` : ""}`);

  // (4) 조립 선별본 PostgreSQL
  const c = await m.createProject({ template: "web", projectName: "dbl", groupId: "egovframework.example", outputDir: path.join(root, "asm"), database: "hsql" });
  await m.addComponents({ projectDir: c.projectPath, components: ["bbs", "uss.umt", "sec.ram", "sym.mnu.mpm"], database: "postgres", dryRun: false });
  const a = await m.prepareDatabase({ projectDir: c.projectPath, database: "postgres", run: true, imageRegistry: registry });
  info(`선별본 postgres: 원본 ${a.sources.length} · 보완 ${a.supplemented.join(", ")} · 테이블 ${a.run.tables?.actual}/${a.tables}`);
  assert(a.supplemented.includes("COMTCCMMNCODE") && a.run.ok && a.run.errors.length === 0, `조립 선별본 PostgreSQL: 빠진 참조 테이블 보완 후 적재 통과${a.run.ok ? "" : `\n${a.run.logTail ?? ""}`}`);
} finally {
  for (const c of containers) sh(["rm", "-f", "-v", c]);
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`database-live FAIL (${n} assertions)`); else console.log(`database-live OK (${n} assertions)`);
