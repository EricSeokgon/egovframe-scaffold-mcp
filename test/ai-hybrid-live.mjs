// node test/ai-hybrid-live.mjs — AI 조립 보강(v1.22) 실자산 검증 (CI 통합: 네트워크·Docker·Maven·JDK 17)
//   공식 boot-web 5.1.0 에 add_ai_components(search="hybrid") 를 두 스택 각각 조립 → mvn package → PGVector(Docker) + OpenAI 호환 스텁으로 기동
//   (1) 하이브리드: 임베딩으로는 구별되지 않는 질의(문서 번호·조문 번호)의 문서가 어휘 채널(pg_trgm)로 결과에 들어옴 — 밀집 상위에는 없음을 SQL 로 독립 확인
//   (2) 문서 형식: 테스트가 hwplib·hwpxlib·PDFBox 로 만든 HWP·HWPX·PDF 표본(test/fixtures/EgovSampleDocs.java — 저장소에 이진 표본 없음)의 추출·색인
//   (3) 한도: 2,001쪽 PDF·압축 폭탄(엔트리 하나가 300MiB)은 400 으로 거부되고 색인되지 않음
//   (4) 접근 통제 조각(EGOV-AI.md)·pg_trgm 색인·remove 원복
//   (5) 배포 산출물: 조립물 감지 → compose 에 PGVector 서비스·EGOV_AI_*, 그 compose 로 앱 + 저장소 기동(AI_LIVE_BASE_REGISTRY 로 기반 이미지 레지스트리 변경)
//   AI_LIVE_PG_IMAGE 로 PGVector 이미지(기본 pgvector/pgvector:pg16)를 바꿀 수 있다.
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import AdmZip from "adm-zip";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900_000, cwd: opts.cwd }); return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (sh("docker", ["info"], { timeout: 30_000 }).code !== 0) { console.log("skip: Docker 데몬 없음"); process.exit(0); }
const mvn = process.platform === "win32" ? "mvn.cmd" : "mvn";
const root = mkdtempSync(path.join(tmpdir(), "egov-ai-hybrid-live-"));
const PG = "egov-ai-hybrid-live-pg", PG_PORT = 15448, DIM = 16;
const pgSecret = randomBytes(12).toString("hex"); // 실행마다 새로 만든다(저장소에 비밀값 리터럴을 두지 않음)
const RRN = ["900101", "1234568"].join("-");
const psql = (sql) => sh("docker", ["exec", PG, "psql", "-U", "egovai", "-d", "egovai", "-Atc", sql], { timeout: 60_000 });

// OpenAI 호환 스텁: 임베딩은 주제 낱말로만 정해지고(결정적), 대화는 시스템 프롬프트 끝부분을 되돌려 준다
const calls = { chat: 0, embeddings: 0 };
const TOPICS = ["예산", "휴직", "서약", "expense"]; // 이 낱말이 있는 글만 자기 축, 나머지는 모두 같은 축(0) — 문서 번호·조문 번호는 임베딩에 반영되지 않는다
const embed = (t) => { const v = new Array(DIM).fill(0); const i = TOPICS.findIndex((w) => String(t).includes(w)); v[i < 0 ? 0 : i + 1] = 1; return v; };
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
  let j = {}; try { j = JSON.parse(b || "{}"); } catch { /* 빈 본문 */ }
  res.setHeader("content-type", "application/json");
  if (req.url.endsWith("/embeddings")) { calls.embeddings++; const inputs = Array.isArray(j.input) ? j.input : [j.input]; return res.end(JSON.stringify({ object: "list", model: j.model, data: inputs.map((t, i) => ({ object: "embedding", index: i, embedding: embed(t) })), usage: { prompt_tokens: 1, total_tokens: 1 } })); }
  if (req.url.endsWith("/chat/completions")) { calls.chat++; const sys = (j.messages ?? []).filter((x) => x.role === "system").map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n"); return res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: j.model, choices: [{ index: 0, message: { role: "assistant", content: `STUB ${sys.slice(-600)}` }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }
  res.statusCode = 404; res.end("{}");
}); });
await new Promise((r) => stub.listen(0, "0.0.0.0", r)); // compose 의 앱 컨테이너가 host.docker.internal 로 닿는다
const stubUrl = `http://127.0.0.1:${stub.address().port}`;

const docx = (text) => { const z = new AdmZip();
  z.addFile("[Content_Types].xml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  z.addFile("_rels/.rels", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'));
  z.addFile("word/document.xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split("\n").map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`));
  return z.toBuffer(); };
const upload = async (port, name, buf) => { const fd = new FormData(); fd.append("file", new Blob([buf]), name); const r = await fetch(`http://127.0.0.1:${port}/ai/documents`, { method: "POST", body: fd }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const ask = async (port, question) => { const r = await fetch(`http://127.0.0.1:${port}/ai/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

let app = null;
try {
  sh("docker", ["rm", "-f", PG]);
  const run = sh("docker", ["run", "-d", "--name", PG, "-e", "POSTGRES_USER=egovai", "-e", `POSTGRES_PASSWORD=${pgSecret}`, "-e", "POSTGRES_DB=egovai", "-p", `127.0.0.1:${PG_PORT}:5432`, process.env.AI_LIVE_PG_IMAGE || "pgvector/pgvector:pg16"]);
  assert(run.code === 0, `PGVector 컨테이너 기동${run.code ? `\n${run.out.slice(-800)}` : ""}`);
  for (let i = 0; i < 30 && psql("select 1").code !== 0; i++) await sleep(2000);
  info(`DB LC_CTYPE: ${psql("select datctype from pg_database where datname='egovai'").out.trim()}`);

  let port = 18591, samples = null;
  for (const [stack, table, textCol] of [["spring-ai", "egov_ai_vector", "content"], ["langchain4j", "egov_ai_segment", "text"]]) {
    const c = await m.createProject({ template: "boot-web", projectName: `hy-${stack}`, groupId: "egovframework.example", outputDir: root, database: "hsql", rteVersion: "5.1.0" });
    const dir = c.projectPath;
    const r = await m.addAiComponents({ projectDir: dir, stack, search: "hybrid" });
    const readme = readFileSync(path.join(dir, "EGOV-AI.md"), "utf8");
    const cfg = readFileSync(path.join(dir, "src/main/java/egovframework/example/ai/EgovAiConfig.java"), "utf8");
    assert(r.search === "hybrid" && r.copiedFiles === 4 && /EgovPgTrgmLexicalSearch/.test(cfg) && /EgovHybrid(Document|Content)Retriever/.test(cfg) && readme.includes("## 하이브리드 검색") && readme.includes(`${table}_trgm`) && r.prerequisites.some((p) => p.includes("pg_trgm")) && (stack === "spring-ai" || r.dependencyChanges.toAdd.some((d) => d.includes("spring-jdbc"))), `${stack}: search=hybrid 조립(어휘 검색·RRF 융합 검색기, README 에 DBA 용 SQL)`);
    assert(r.accessControl && readme.includes("## 접근 통제 연결") && readme.includes("/ai/**"), `${stack}: 접근 통제 조각 — 찾은 보안 방식 ${r.accessControl?.kind}${r.accessControl?.evidence ? ` (${r.accessControl.evidence})` : ""}`);
    const sc = await m.checkSecureCoding({ projectDir: dir });
    assert(!sc.findings.some((f) => f.rule.startsWith("ai-") || f.rule === "hardcoded-secret" || (f.rule === "sql-injection" && f.file.includes("/ai/"))), `${stack}: 생성물에 보안약점 AI 규칙·비밀값·SQL 삽입 0건 (${sc.findings.filter((f) => f.file.includes("/ai/")).map((f) => f.rule).join(",") || "없음"})`);
    const b = sh(mvn, ["-B", "-q", "-Dmaven.test.skip=true", "package"], { cwd: dir });
    assert(b.code === 0, `${stack}: mvn package${b.code ? `\n${b.out.slice(-2500)}` : ""}`);
    if (b.code !== 0) continue;
    if (!samples) {
      // 표본 문서를 프로젝트의 파서 라이브러리로 만든다(저장소에 이진 표본을 두지 않는다)
      const out = path.join(root, "samples"); mkdirSync(out);
      const cpFile = path.join(root, "cp.txt");
      const cp = sh(mvn, ["-B", "-q", "dependency:build-classpath", `-Dmdep.outputFile=${cpFile}`], { cwd: dir });
      const classpath = cp.code === 0 ? readFileSync(cpFile, "utf8").trim() : "";
      const jc = sh("javac", ["-encoding", "UTF-8", "-cp", classpath, "-d", out, path.join(here, "fixtures", "EgovSampleDocs.java")]);
      const textFile = path.join(root, "sample-text.txt");
      writeFileSync(textFile, ["휴직 규정 한글 문서. 육아휴직은 최대 1년이다.", "보안 서약 한글엑스 문서. 반출은 승인 뒤에 한다.", "Travel expense regulation PX-4410 settle within five days."].join("\n"));
      const gen = sh("java", ["-cp", `${out}${path.delimiter}${classpath}`, "EgovSampleDocs", out, textFile, "2001"]);
      const ok = cp.code === 0 && jc.code === 0 && gen.code === 0 && ["sample.hwp", "sample.hwpx", "sample.pdf", "too-many-pages.pdf"].every((f) => existsSync(path.join(out, f)));
      assert(ok, `표본 생성(hwplib·hwpxlib·PDFBox): HWP·HWPX·PDF·2,001쪽 PDF${ok ? "" : `\n${cp.out.slice(-600)}\n${jc.out.slice(-600)}\n${gen.out.slice(-600)}`}`);
      if (ok) samples = out;
    }
    const jar = readdirSync(path.join(dir, "target")).find((f) => f.endsWith(".jar") && !f.includes("original"));
    let log = "";
    app = spawn("java", ["-jar", path.join(dir, "target", jar), `--server.port=${port}`], { env: { ...process.env, EGOV_AI_BASE_URL: stubUrl, EGOV_AI_CHAT_MODEL: "stub-chat", EGOV_AI_EMBEDDING_MODEL: "stub-embed", EGOV_AI_EMBEDDING_DIMENSIONS: String(DIM), EGOV_AI_PGVECTOR_URL: `jdbc:postgresql://127.0.0.1:${PG_PORT}/egovai`, EGOV_AI_PGVECTOR_USERNAME: "egovai", EGOV_AI_PGVECTOR_PASSWORD: pgSecret }, stdio: ["ignore", "pipe", "pipe"] });
    app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
    for (let i = 0; i < 60 && !/Started \S+ in |APPLICATION FAILED|Application run failed/.test(log); i++) await sleep(2000);
    assert(/Started \S+ in /.test(log), `${stack}: 기동${/Started/.test(log) ? "" : `\n${log.slice(-2500)}`}`);

    // (1) 하이브리드 — 주제 낱말이 없는 문서 6건(임베딩이 질의와 같음)과 문서 번호·조문 번호가 든 문서 1건(임베딩은 다른 축)
    for (let i = 1; i <= 6; i++) await upload(port, `일반-${i}.md`, Buffer.from(`# 일반 안내 ${i}\n\n사무실 이용 안내 ${i}번이다. 회의실은 하루 전에 신청한다.\n`));
    const target = await upload(port, "예산지침.md", Buffer.from("# 예산 집행 지침\n\n문서번호 KX-7731 에 따라 예산은 분기마다 배정한다. 제27조의2 는 이월 한도를 정한다.\n"));
    assert(target.status === 200 && target.body.chunks >= 1, `${stack}: 색인 7건${target.status === 200 ? "" : `\n${JSON.stringify(target.body)}\n${log.slice(-2000)}`}`);
    const qCode = "KX-7731 문서를 찾아줘", qKo = "제27조의2 내용을 알려줘";
    const a1 = await ask(port, qCode);
    const idx = psql(`select indexname from pg_indexes where tablename='${table}' and indexdef ilike '%gin_trgm_ops%'`).out.trim();
    const denseTop = psql(`select string_agg(f, ',') from (select metadata::jsonb->>'file_name' f from ${table} order by embedding <=> (select embedding from ${table} where ${textCol} like '%사무실 이용%' limit 1) limit 4) x`).out.trim();
    assert(a1.status === 200 && a1.body.sources.includes("예산지침.md") && a1.body.answer.includes("KX-7731") && !denseTop.includes("예산지침"), `${stack}: 문서 번호 질의 — 밀집 상위 4(${denseTop})에는 없고 어휘 채널로 결과에 들어옴 ${JSON.stringify(a1.body.sources)}${a1.status === 200 ? "" : `\n${JSON.stringify(a1.body)}\n${log.slice(-2500)}`}`);
    const a2 = await ask(port, qKo);
    assert(a2.status === 200 && a2.body.sources.includes("예산지침.md"), `${stack}: 한글 조문 번호 질의도 어휘 채널로 ${JSON.stringify(a2.body.sources)}`);
    const a3 = await ask(port, "회의실 신청 방법은?");
    assert(a3.status === 200 && a3.body.sources.length >= 1 && a3.body.sources.every((s) => s.startsWith("일반-")) && idx === `${table}_trgm`, `${stack}: 일반 질의는 밀집 결과 그대로 ${JSON.stringify(a3.body.sources)}, pg_trgm 색인 ${idx}`);

    // (2) 문서 형식 실측
    if (samples) {
      const res = {};
      for (const [f, name, word] of [["sample.hwp", "휴직규정.hwp", "육아휴직"], ["sample.hwpx", "보안서약.hwpx", "반출은 승인"], ["sample.pdf", "travel.pdf", "PX-4410"]]) {
        const u = await upload(port, name, readFileSync(path.join(samples, f)));
        const stored = psql(`select count(*) from ${table} where ${textCol} like '%${word}%' and metadata::jsonb->>'file_name'='${name}'`).out.trim();
        res[name] = { status: u.status, chunks: u.body.chunks, stored, failures: u.body.failures };
      }
      assert(Object.values(res).every((x) => x.status === 200 && x.chunks >= 1 && Number(x.stored) >= 1), `${stack}: HWP·HWPX·PDF 표본 추출·색인 ${JSON.stringify(res)}`);
      const a4 = await ask(port, "PX-4410");
      assert(a4.status === 200 && a4.body.sources.includes("travel.pdf"), `${stack}: PDF 안의 문서 번호 질의 ${JSON.stringify(a4.body.sources)}`);
      // (3) 한도
      const before = psql(`select count(*) from ${table}`).out.trim();
      const big = await upload(port, "too-many-pages.pdf", readFileSync(path.join(samples, "too-many-pages.pdf")));
      // 압축 폭탄: 300MiB 가 수백 KB 로 줄어든 엔트리 하나(엔트리별 한도 256MiB)
      const z = new AdmZip(); z.addFile("word/document.xml", Buffer.alloc(300 * 1024 * 1024));
      const bombBuf = z.toBuffer();
      const bomb = await upload(port, "zip-bomb.docx", bombBuf);
      const after = psql(`select count(*) from ${table}`).out.trim();
      info(`${stack}: 한도 초과 응답 — pdf ${big.status} ${JSON.stringify(big.body).slice(0, 300)} / zip ${bomb.status} ${JSON.stringify(bomb.body).slice(0, 300)}`);
      assert(before === after && big.status === 400 && /한도/.test(big.body.error ?? "") && big.body.error.includes("too-many-pages.pdf") && !/\/tmp|Exception/.test(big.body.error) && bomb.status === 400 && bombBuf.length < 1024 * 1024, `${stack}: 2,001쪽 PDF·압축 폭탄(${Math.round(bombBuf.length / 1024)}KB → 300MiB)은 400 으로 거부, 색인 그대로(행 ${before} → ${after}), 응답에 임시 경로 없음`);
    }
    app.kill(); app = null; await sleep(1500);

    // (5) 배포 산출물 — 조립물을 감지해 compose 에 PGVector 서비스와 EGOV_AI_* 를 넣고, 그 compose 로 앱 + 저장소가 뜬다(한 스택만)
    const dp = await m.generateDeploy({ projectDir: dir, dryRun: stack !== "spring-ai", targets: ["compose", "k8s"], buildInImage: false });
    const composeText = stack === "spring-ai" ? readFileSync(path.join(dir, "deploy/docker-compose.yml"), "utf8") : dp.files.find((f) => f.path.endsWith("docker-compose.yml")).content;
    const k8sText = stack === "spring-ai" ? readFileSync(path.join(dir, `deploy/k8s/${dp.profile.appName}.yaml`), "utf8") : dp.files.find((f) => f.path.includes("/k8s/")).content;
    assert(dp.profile.ai?.stack === stack && dp.profile.ai.search === "hybrid" && /\n  ai-db:\n/.test(composeText) && composeText.includes("EGOV_AI_PGVECTOR_URL: \"jdbc:postgresql://ai-db:5432/egovai\"") && /kind: Secret[\s\S]*EGOV_AI_PGVECTOR_PASSWORD: 'CHANGE_ME'/.test(k8sText) && !/EGOV_AI_PGVECTOR_PASSWORD/.test(k8sText.split("kind: Secret")[0]), `${stack}: 배포 산출물이 조립물을 감지(${JSON.stringify(dp.profile.ai)}) — compose 에 ai-db, Kubernetes 는 비밀값을 Secret 에만`);
    if (stack === "spring-ai") {
      const deployDir = path.join(dir, "deploy"), appPort = 18599;
      writeFileSync(path.join(deployDir, ".env"), [`BASE_REGISTRY=${process.env.AI_LIVE_BASE_REGISTRY || "docker.io/library"}`, `APP_PORT=${appPort}`, `EGOV_AI_BASE_URL=http://host.docker.internal:${stub.address().port}`, "EGOV_AI_CHAT_MODEL=stub-chat", "EGOV_AI_EMBEDDING_MODEL=stub-embed", `EGOV_AI_EMBEDDING_DIMENSIONS=${DIM}`, `EGOV_AI_PGVECTOR_PASSWORD=${pgSecret}`, `AI_PGVECTOR_IMAGE=${process.env.AI_LIVE_PG_IMAGE || "pgvector/pgvector:pg16"}`, ""].join("\n"));
      const up = sh("docker", ["compose", "up", "-d", "--build"], { cwd: deployDir, timeout: 1_200_000 });
      assert(up.code === 0, `${stack}: docker compose up --build(앱 + ai-db)${up.code ? `\n${up.out.slice(-3000)}` : ""}`);
      if (up.code === 0) {
        let st = 0;
        for (let i = 0; i < 60 && st !== 200; i++) { st = await fetch(`http://127.0.0.1:${appPort}/`).then((x) => x.status, () => 0); if (st !== 200) await sleep(3000); }
        const cu = st === 200 ? await upload(appPort, "예산지침.md", Buffer.from("# 예산 집행 지침\n\n문서번호 KX-7731 에 따라 예산은 분기마다 배정한다.\n")) : { status: 0, body: {} };
        const ca = cu.status === 200 ? await ask(appPort, "KX-7731 문서를 찾아줘") : { status: 0, body: {} };
        assert(st === 200 && cu.status === 200 && ca.status === 200 && ca.body.sources?.includes("예산지침.md"), `${stack}: compose 로 띄운 앱이 ai-db 에 색인하고 하이브리드 질의에 응답 ${JSON.stringify(ca.body.sources ?? [])}${ca.status === 200 ? "" : `\n${JSON.stringify(cu.body)} ${JSON.stringify(ca.body)}\n${sh("docker", ["compose", "logs", "--tail", "60"], { cwd: deployDir }).out.slice(-3000)}`}`);
      }
      sh("docker", ["compose", "down", "-v", "--rmi", "local"], { cwd: deployDir, timeout: 300_000 });
    }
    const rm = await m.removeComponents({ projectDir: dir, components: [`ai-rte-${stack}`] });
    assert(!existsSync(path.join(dir, "src/main/java/egovframework/example/ai/EgovAiConfig.java")) && !/egovframe-rte-ai-|pgvector|spring-jdbc/.test(readFileSync(path.join(dir, "pom.xml"), "utf8")), `${stack}: remove 로 파일·pom 의존성 원복(${rm.removedFiles ?? rm.removed?.length ?? "?"})`);
    port++;
  }
} finally {
  if (app) app.kill();
  stub.close();
  sh("docker", ["rm", "-f", PG]);
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`ai-hybrid-live FAIL (${n} assertions)`); else console.log(`ai-hybrid-live OK (${n} assertions)`);
