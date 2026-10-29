// node test/deps-fix.mjs — 취약 의존성 자동 조치(v1.9, 게이트, 오프라인)
//   수정 버전 선택(같은 major·모든 권고 회피·저장소에 없는 버전 건너뜀·꼬리 -jre·floor·재조회로 찾은 권고), parent 관리 버전,
//   고정 해제(<version>·dependencyManagement 항목)·버전 속성 상향(같은 계열만)·좌표 교체의 원문 보존(주석·들여쓰기·CRLF),
//   dryRun 무기록 · 적용·백업·계획 파일 · 멱등 · compile 실패/저장소 장애 롤백 · 실패 주입 · 멀티 모듈(루트 속성) · Gradle · offline · kinds
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-deps-fix-"));
const adv = (id, ...ranges) => ({ id, ranges });
const r = (intro, fixed) => [{ introduced: intro }, ...(fixed ? [{ fixed }] : [])];

// ── 수정 버전 선택 ───────────────────────────────────
{
  const p = m.pickFixVersion("10.1.52", [adv("A", r("10.1.0", "10.1.55")), adv("B", r("10.1.0", "10.1.54"))]);
  assert(p.status === "fix" && p.version === "10.1.55", `권고마다 필요한 버전의 최댓값 (${p.version})`);
  const q = m.pickFixVersion("10.1.52", [adv("A", r("10.1.0", "10.1.55")), adv("C", r("10.1.53", "10.1.59"))]);
  assert(q.version === "10.1.59", "현재 버전과 무관한 권고도 후보 버전에 걸리면 다음 fixed 로");
  const av = m.pickFixVersion("10.1.52", [adv("A", r("10.1.0", "10.1.58"))], null, ["10.1.52", "10.1.57", "10.1.59", "11.0.1", "10.1.60-M1"]);
  assert(av.status === "fix" && av.version === "10.1.59", "저장소에 없는 fixed(10.1.58)는 건너뛰고 있는 다음 릴리스");
  const g = m.pickFixVersion("33.0.0-jre", [adv("G", r("4.0", "33.7.2"))], null, ["33.7.2-android", "33.7.2-jre", "33.8.0-jre"]);
  assert(g.version === "33.7.2-jre" && m.versionFlavor("4.2.10.Final") === ".Final", "같은 꼬리(-jre)의 배포 버전으로 (33.7.2 → 33.7.2-jre)");
  assert(m.pickFixVersion("1.2.0", [adv("O", r("0", "2.0.0"))]).status === "major", "major 가 바뀌면 major");
  const nf = m.pickFixVersion("1.0.0", [adv("N", [{ introduced: "0" }, { last_affected: "1.0.0" }])]);
  assert(nf.status === "no-fix" && nf.unfixed[0] === "N", "fixed 없는 권고 → no-fix");
  assert(m.pickFixVersion("2.11.0", [adv("A", r("0", "2.14.0"))], "2.18.0").version === "2.18.0", "floor(parent 기준)가 같은 major 이고 높으면 floor");
  assert(m.pickFixVersion("2.11.0", [adv("A", r("0", "2.14.0"))], "3.0.0").version === "2.14.0", "floor 가 다른 major 면 무시");
  assert(m.pickFixVersion("1.0", [adv("A", r("0", "1.1"))], null, ["1.0", "2.0"]).status === "no-release", "같은 major 의 수정 릴리스가 저장소에 없으면 no-release(다음 major 로 가지 않음)");
  assert(m.pickFixVersion("1.0", [adv("A", r("0", "1.1"))], null, ["1.0", "1.1-M1"]).status === "no-release", "정식 릴리스가 없으면 no-release");
  assert(m.sameFamily(["org.apache.tomcat", "org.apache.tomcat.embed"]) && !m.sameFamily(["org.example", "com.other"]), "계열: 같은 groupId 또는 하위 groupId");
  const b = m.loadDependencyBaseline("5.0.2");
  assert(m.parentManagedVersion(b, "boot", "ch.qos.logback", "logback-classic") === b.boot.managed["ch.qos.logback:logback-classic"] && m.parentManagedVersion(b, "web", "ch.qos.logback", "logback-classic") === null, "parent 관리 버전: boot 는 Boot BOM, web 은 관리하지 않음");
}

// ── 가짜 OSV·저장소 ────────────────────────────────
const ADV = {
  "org.apache.tomcat.embed:tomcat-embed-core": [adv("T1", r("10.1.0", "10.1.55")), adv("T2", r("10.1.53", "10.1.59"))],
  "org.apache.tomcat.embed:tomcat-embed-el": [adv("T3", r("10.1.0", "10.1.54"))],
  "org.example:alpha": [adv("A1", r("0", "2.0.1"))],
  "org.jsoup:jsoup": [adv("J1", r("0", "1.15.4"))],
  "com.example:old": [adv("O1", r("0", "2.0.0"))],
  "com.example:nofix": [adv("N1", [{ introduced: "0" }])],
  "commons-io:commons-io": [adv("C1", r("0", "2.14.0")), adv("C2", r("2.15.0", "2.19.0"))],
};
let osvCalls = 0;
const osvDetails = async (qs) => { osvCalls++; return qs.map((q) => (ADV[q.name] ?? []).filter((a) => a.ranges.some((rg) => m.inOsvRange(q.version, rg)))); };
const VERS = {
  "org.apache.tomcat.embed:tomcat-embed-core": ["10.1.52", "10.1.55", "10.1.57", "10.1.59"],
  "org.apache.tomcat.embed:tomcat-embed-el": ["10.1.52", "10.1.55", "10.1.57", "10.1.59"],
  "org.jsoup:jsoup": ["1.15.3", "1.15.4", "1.16.1"],
  "commons-io:commons-io": ["2.11.0", "2.14.0", "2.18.0", "2.19.0"],
};
const mavenVersions = async (g, a) => VERS[`${g}:${a}`] ?? null;
const base = { osvDetails, mavenVersions };

const dep = (g, a, v, extra = "") => `    <dependency>\n      <groupId>${g}</groupId>\n      <artifactId>${a}</artifactId>\n${v ? `      <version>${v}</version>\n` : ""}${extra}    </dependency>\n`;
const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.egovframe.boot</groupId>
    <artifactId>egovframe-boot-starter-parent</artifactId>
    <version>5.0.1</version>
    <relativePath/>
  </parent>
  <groupId>x</groupId>
  <artifactId>app</artifactId>
  <version>1.0</version>
  <properties>
    <java.version>17</java.version>
    <tomcat-embed.version>10.1.52</tomcat-embed.version><!-- 보안 패치용 -->
    <shared.version>2.0.0</shared.version>
  </properties>
  <dependencyManagement>
    <dependencies>
${dep("org.apache.commons", "commons-lang3", "3.12.0").replace(/^ {4}/gm, "      ")}    </dependencies>
  </dependencyManagement>
  <dependencies>
    <!-- 로그: 일부러 낮게 고정 -->
${dep("ch.qos.logback", "logback-classic", "1.5.6")}${dep("org.apache.commons", "commons-lang3", null)}${dep("org.apache.tomcat.embed", "tomcat-embed-core", "${tomcat-embed.version}")}${dep("org.apache.tomcat.embed", "tomcat-embed-el", "${tomcat-embed.version}")}${dep("org.example", "alpha", "${shared.version}")}${dep("com.other", "beta", "${shared.version}")}${dep("org.jsoup", "jsoup", "1.15.3")}${dep("com.example", "old", "1.2.0")}${dep("com.example", "nofix", "1.0.0")}${dep("commons-io", "commons-io", "2.11.0")}${dep("com.querydsl", "querydsl-jpa", "4.0.0", "      <classifier>jakarta</classifier>\n")}  </dependencies>
</project>
`;
const EXPECTED = POM
  .replace("<version>5.0.1</version>", "<version>5.0.2</version>")
  .replace("<tomcat-embed.version>10.1.52<", "<tomcat-embed.version>10.1.59<")
  .replace(dep("org.apache.commons", "commons-lang3", "3.12.0").replace(/^ {4}/gm, "      "), "")
  .replace(dep("ch.qos.logback", "logback-classic", "1.5.6"), dep("ch.qos.logback", "logback-classic", null))
  .replace("<version>1.15.3</version>", "<version>1.15.4</version>")
  .replace("<version>2.11.0</version>", "<version>2.19.0</version>");
let k = 0;
const project = (files) => { const d = path.join(root, `p${k++}`); for (const [rel, t] of Object.entries(files)) { mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); writeFileSync(path.join(d, rel), t); } return d; };

{
  const d = project({ "pom.xml": POM });
  const plan = await m.fixDependencies({ projectDir: d, ...base });
  assert(plan.dryRun && readFileSync(path.join(d, "pom.xml"), "utf8") === POM && !existsSync(path.join(d, "migration-backup")), "dryRun: 파일·백업을 쓰지 않음");
  const bk = plan.summary.byKind;
  assert(bk.parent >= 1 && bk.unpin === 2 && bk.coordinate === 0 && bk["cve-bump"] === 3 && plan.target === "5.0.2", `조치 종류별 ${JSON.stringify(bk)}`);
  const man = plan.manual.map((x) => `${x.kind}:${x.coordinate}`).sort();
  assert(JSON.stringify(man) === JSON.stringify(["cve-bump:com.example:nofix", "cve-bump:com.example:old", "cve-bump:org.example:alpha"]), `수동: 다른 계열 공유 속성·major·수정 버전 없음 (${man.join(", ")})`);
  assert(plan.manual.find((x) => x.coordinate === "org.example:alpha").reason.includes("${shared.version}"), "공유 속성 사유에 속성 이름");
  const tom = plan.actions.find((a) => a.coordinate === "${tomcat-embed.version}");
  assert(tom && tom.from === "10.1.52" && tom.to === "10.1.59" && tom.ids.join() === "T1,T3", "버전 속성 상향: 같은 계열 두 좌표의 권고를 모두 피하고, 재조회로 찾은 T2 와 없는 버전을 넘어 10.1.59");
  assert(plan.actions.find((a) => a.coordinate === "commons-io:commons-io")?.to === "2.19.0", "parent 관리 버전(2.18.0)이 취약하면 고정을 풀지 않고 그 위로 상향(2.19.0)");
  assert(!plan.actions.some((a) => a.coordinate.startsWith("com.querydsl")), "classifier 가 있는 좌표는 고정 해제하지 않음");
  const v = plan.vulnerabilities;
  assert(v && v.predicted && v.before.coordinates === 7 && v.after.coordinates === 3 && v.after.ids === 3, `전·후 취약 좌표 ${v?.before.coordinates} → ${v?.after.coordinates}(예측)`);
  assert(plan.files.length === 1 && plan.files[0].preview.some((p) => p.before.includes("5.0.1") && p.after.includes("5.0.2")) && plan.files[0].preview.some((p) => p.before.includes("<version>1.5.6</version>") && p.after === ""), "미리보기: 바뀐 줄·지운 줄");
  const md = m.renderDepsFixMarkdown(plan);
  assert(md.includes("취약 의존성 조치 계획") && md.includes("10.1.52 → 10.1.59") && md.includes("좌표 7 → 3"), "Markdown 요약");

  const done = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, verify: false });
  const after = readFileSync(path.join(d, "pom.xml"), "utf8");
  assert(after === EXPECTED, "적용: 기대한 줄만 바뀌고 주석·들여쓰기·나머지는 그대로");
  if (after !== EXPECTED) console.error(after);
  const bdir = done.backupDir;
  assert(bdir && readFileSync(path.join(bdir, "pom.xml"), "utf8") === POM && JSON.parse(readFileSync(done.planPath, "utf8")).tool === "fix_egovframe_dependencies", "백업 원본·deps-fix-plan.json");
  assert(done.build === undefined && !done.rolledBack, "verify=false 면 compile 없음");
  const again = await m.fixDependencies({ projectDir: d, ...base });
  assert(again.summary.actions === 0 && again.summary.manual === 3, "멱등: 다시 돌리면 조치 0(수동만 남음)");
  // 조치 내역: 평가서 3절·납품 패키지
  const hist = m.readFixHistory(d);
  assert(hist.length === 1 && hist[0].tool === "fix_egovframe_dependencies" && hist[0].dependencies.before === 7 && hist[0].dependencies.after === 3 && hist[0].dependencies.target === "5.0.2", `조치 내역 읽기 (${JSON.stringify(hist[0]?.dependencies)})`);
  const as = await m.assessProject({ projectDir: d });
  const amd = m.renderAssessmentMarkdown(as);
  assert(as.dependencies.fixHistory?.length === 1 && amd.includes("자동 조치 내역 (1)") && amd.includes("권고 7 → 3"), "평가서 3절에 자동 조치 내역(전·후)");
  const out = path.join(root, "deliver-out");
  const dl = await m.prepareDelivery({ projectDir: d, outputDir: out, include: ["dependencies"], dryRun: false });
  const item = dl.items.find((i) => i.id === "dependencies");
  assert(item.summary.fixHistory === 1 && item.files.some((f) => f.startsWith("dependencies/fix-history/") && f.endsWith("-deps-fix-" + path.basename(path.dirname(done.planPath)).split("-deps-fix-")[1] + ".json")) && existsSync(path.join(out, item.files.find((f) => f.includes("fix-history")))), "납품 패키지 dependencies/fix-history/ 에 계획 파일");
}

// CRLF
{
  const crlf = POM.replace(/\n/g, "\r\n");
  const d = project({ "pom.xml": crlf });
  await m.fixDependencies({ projectDir: d, ...base, dryRun: false, verify: false });
  assert(readFileSync(path.join(d, "pom.xml"), "utf8") === EXPECTED.replace(/\n/g, "\r\n"), "CRLF 파일도 줄 단위로 보존");
}

// compile 확인·롤백
{
  const runnerWith = (code, text) => async (_cmd, o) => { o.onData(text); return { exitCode: code, timedOut: false }; };
  const d = project({ "pom.xml": POM });
  const fail = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, runner: runnerWith(1, `[ERROR] ${path.join(d, "src/A.java")}:[3,1] cannot find symbol\n[ERROR] BUILD FAILURE\n`), platform: "linux" });
  assert(fail.rolledBack === true && fail.build?.success === false && readFileSync(path.join(d, "pom.xml"), "utf8") === POM && !existsSync(path.join(d, "migration-backup")) && !fail.backupDir, "compile 실패 → 전부 되돌림(백업 폴더도 남지 않음)");
  assert(fail.notes.some((x) => x.includes("되돌렸습니다")), "롤백 안내");
  const repo = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, runner: runnerWith(1, "[ERROR] Failed to execute goal on project app: Could not resolve dependencies: Could not transfer artifact x:y:pom:1 from/to egovframe (https://maven.egovframe.go.kr/maven/): status code: 503, reason phrase: Service Unavailable (503)\n"), platform: "linux" });
  assert(repo.rolledBack && repo.build.failureKind === "repository-unavailable" && repo.notes.some((x) => x.includes("원격 저장소")) && readFileSync(path.join(d, "pom.xml"), "utf8") === POM, "저장소 장애 → 되돌리고 코드 문제가 아님을 안내");
  const ok = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, runner: runnerWith(0, "[INFO] BUILD SUCCESS\n"), platform: "linux" });
  assert(ok.build?.success === true && !ok.rolledBack && readFileSync(path.join(d, "pom.xml"), "utf8") === EXPECTED && existsSync(ok.backupDir), "compile 통과 → 적용 유지");
  const d2 = project({ "pom.xml": POM });
  let msg = ""; try { await m.fixDependencies({ projectDir: d2, ...base, dryRun: false, verify: false, faultInjection: "after-files" }); } catch (e) { msg = e.message; }
  assert(/fault injection/.test(msg) && readFileSync(path.join(d2, "pom.xml"), "utf8") === POM && !existsSync(path.join(d2, "migration-backup")), "실패 주입 → 롤백");
}

// kinds·offline
{
  const d = project({ "pom.xml": POM });
  const only = await m.fixDependencies({ projectDir: d, ...base, kinds: ["unpin"] });
  assert(only.summary.actions === only.summary.byKind.unpin && only.target === null && only.kinds.join() === "unpin", `kinds=["unpin"] 만 (${only.summary.actions})`);
  const before = osvCalls;
  const off = await m.fixDependencies({ projectDir: d, ...base, offline: true });
  assert(osvCalls === before && off.summary.byKind["cve-bump"] === 0 && !off.vulnerabilities && off.notes.some((x) => x.includes("offline=true")), "offline: OSV 를 부르지 않고 상향·집계 생략");
  assert(off.summary.byKind.unpin === 3, "offline 고정 해제는 parent 관리 버전 취약 여부를 모르므로 commons-io 도 포함");
  let e1 = ""; try { await m.fixDependencies({ projectDir: d, kinds: ["nope"] }); } catch (e) { e1 = e.message; }
  let e2 = ""; try { await m.fixDependencies({ projectDir: d, target: "4.3.0" }); } catch (e) { e2 = e.message; }
  assert(/알 수 없는 조치 종류/.test(e1) && /지원하지 않는 target/.test(e2), "잘못된 kinds·target 거부");
}

// web parent: 좌표 교체
{
  const web = `<project>\n  <parent>\n    <groupId>org.egovframe.rte</groupId>\n    <artifactId>egovframe-web-config-parent</artifactId>\n    <version>5.0.2</version>\n  </parent>\n  <dependencies>\n${dep("mysql", "mysql-connector-java", "8.0.33")}${dep("ojdbc", "ojdbc", "14")}  </dependencies>\n</project>\n`;
  const src = m.loadDependencyBaseline("5.0.2").sources.find((s) => s.kind === "web");
  const d = project({ "pom.xml": web.replace("org.egovframe.rte</groupId>\n    <artifactId>egovframe-web-config-parent", `${src.groupId}</groupId>\n    <artifactId>${src.artifactId}`) });
  const c = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, verify: false });
  const t = readFileSync(path.join(d, "pom.xml"), "utf8");
  const ojdbc = m.loadDependencyBaseline("5.0.2").boot.managed["com.oracle.database.jdbc:ojdbc11"];
  assert(c.summary.byKind.coordinate === 2 && t.includes(dep("com.mysql", "mysql-connector-j", null)) && t.includes(dep("com.oracle.database.jdbc", "ojdbc11", ojdbc)), `좌표 교체: mysql-connector-j(parent 관리, 버전 지움)·ojdbc11:${ojdbc}`);
}

// 멀티 모듈: 루트 속성·모듈 고정 해제
{
  const rootPom = `<project>\n  <parent>\n    <groupId>org.egovframe.boot</groupId>\n    <artifactId>egovframe-boot-starter-parent</artifactId>\n    <version>5.0.2</version>\n  </parent>\n  <groupId>x</groupId>\n  <artifactId>root</artifactId>\n  <version>1</version>\n  <packaging>pom</packaging>\n  <modules>\n    <module>a</module>\n    <module>b</module>\n  </modules>\n  <properties>\n    <tomcat-embed.version>10.1.52</tomcat-embed.version>\n  </properties>\n</project>\n`;
  const mod = (name, body) => `<project>\n  <parent>\n    <groupId>x</groupId>\n    <artifactId>root</artifactId>\n    <version>1</version>\n  </parent>\n  <artifactId>${name}</artifactId>\n  <dependencies>\n${body}  </dependencies>\n</project>\n`;
  const d = project({ "pom.xml": rootPom, "a/pom.xml": mod("a", dep("ch.qos.logback", "logback-classic", "1.5.6")), "b/pom.xml": mod("b", dep("org.apache.tomcat.embed", "tomcat-embed-core", "${tomcat-embed.version}")) });
  const r2 = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, verify: false });
  assert(r2.summary.byKind.unpin === 1 && r2.actions.find((a) => a.kind === "unpin").file === "a/pom.xml" && !readFileSync(path.join(d, "a/pom.xml"), "utf8").includes("<version>1.5.6"), "모듈 pom: 루트의 공식 parent 기준으로 고정 해제");
  assert(r2.actions.find((a) => a.kind === "cve-bump")?.file === "pom.xml" && readFileSync(path.join(d, "pom.xml"), "utf8").includes("<tomcat-embed.version>10.1.59<") && readFileSync(path.join(d, "b/pom.xml"), "utf8").includes("${tomcat-embed.version}"), "모듈이 쓰는 루트 속성은 루트에서 상향");
}

// Gradle
{
  const gradle = `plugins {\n  id 'org.springframework.boot' version '3.5.6'\n  id 'io.spring.dependency-management' version '1.1.7'\n}\ndependencies {\n  implementation 'ch.qos.logback:logback-classic:1.5.6'\n  implementation "org.jsoup:jsoup:1.15.3"\n  implementation 'org.example:alpha:2.0.0'\n}\n`;
  const d = project({ "build.gradle": gradle });
  const gr = await m.fixDependencies({ projectDir: d, ...base, dryRun: false, verify: false });
  const t = readFileSync(path.join(d, "build.gradle"), "utf8");
  assert(gr.buildSystem === "gradle" && t.includes("implementation 'ch.qos.logback:logback-classic'\n") && t.includes(`implementation "org.jsoup:jsoup:1.15.4"`) && t.includes("org.example:alpha:2.0.1"), "Gradle: 리터럴 고정 해제·취약 버전 상향");
  assert(gr.notes.some((x) => x.includes("Gradle")), "Gradle 안내(parent·좌표 교체는 수동)");
}

// 빌드 파일 없음
{
  const d = project({ "README.md": "x" });
  const e = await m.fixDependencies({ projectDir: d, ...base });
  assert(e.buildSystem === "unknown" && e.summary.actions === 0, "빌드 파일 없음 → 조치 0");
}

// MCP 호출(outputSchema)·CLI fix-deps (offline — 가짜 OSV 를 넣을 수 없는 경로)
{
  const d = project({ "pom.xml": POM });
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  const call = await client.callTool({ name: "fix_egovframe_dependencies", arguments: { projectDir: d, offline: true, format: "json" } });
  assert(!call.isError && call.structuredContent?.dryRun === true && call.structuredContent.summary.byKind.unpin === 3, "MCP 호출: outputSchema 통과·기본 dryRun");
  const bad = await client.callTool({ name: "fix_egovframe_dependencies", arguments: { projectDir: d, kinds: ["upgrade-all"] } });
  assert(bad.isError, "모르는 kinds 는 입력 검증에서 거부");
  await client.close(); await server.close();
  const io = () => { const o = [], e = []; return { cwd: d, env: {}, stdout: (x) => o.push(x), stderr: (x) => e.push(x), o, e }; };
  const i1 = io();
  assert(await m.runCli(["fix-deps", "--project", d, "--offline"], i1) === 0 && i1.e.join("").includes("의존성 조치 계획") && readFileSync(path.join(d, "pom.xml"), "utf8") === POM, "CLI fix-deps: 기본은 계획만");
  const i2 = io();
  assert(await m.runCli(["fix-deps", "--project", d, "--offline", "--kinds", "unpin", "--verify", "false", "--write", "--fail-on", "actions>100"], i2) === 0 && !readFileSync(path.join(d, "pom.xml"), "utf8").includes("<version>1.5.6</version>"), "CLI fix-deps --write: 고정 해제 적용");
  const i3 = io();
  assert(await m.runCli(["fix-deps", "--project", d, "--dry-run", "false"], i3) === 64, "CLI 는 dryRun 직접 지정 거부(--write 로)");
}

rmSync(root, { recursive: true, force: true });
if (process.exitCode) console.error(`deps-fix FAIL (${n} assertions)`); else console.log(`deps-fix OK (${n} assertions)`);
