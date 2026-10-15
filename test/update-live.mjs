// node test/update-live.mjs — 5.x 최신 유지(v0.46) 실자산 검증 (CI 통합: 네트워크·Maven·JDK 17 필요)
//   Initializr 고정 commit 의 공식 web·boot-web 템플릿(parent 5.0.0)으로
//   (1) 진단: parent 5.0.0 → 5.0.2 자동 1건, 템플릿이 참조하는 바뀐 RTE 동작(실측 고정)
//   (2) 의존성 점검(resolve=true) 기준 미만 수와 평가서 공급망 등급을 갱신 전후로 기록(실측 고정)
//   (3) dryRun 무기록 → fault-injection 롤백 → 적용 → JDK 17 mvn compile(verify) 통과
//   (4) create_egovframe_project(alignParent=true) 로 만든 프로젝트는 바로 최신이고 compile 통과
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egovupdate-live-"));

// 실측 고정값(2026-10-15, Initializr 고정 commit · 의존성 기준 동봉본) — 바뀌면 원인(템플릿·기준·parent)을 확인하고 갱신한다
const EXPECT = {
  web: { parent: "egovframe-web-config-parent", changes: ["html-tag-filter", "idgnr-table-lock"], outdated: [6, 4], grade: ["C", "B"] },
  "boot-web": { parent: "egovframe-boot-starter-parent", changes: ["idgnr-table-lock"], outdated: [3, 1], grade: ["C", "B"] },
};

try {
  for (const [template, exp] of Object.entries(EXPECT)) {
    const c = await m.createProject({ template, projectName: `upd-${template}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const dir = c.projectPath;
    const r = m.updateProject({ projectDir: dir });
    assert(r.update.parent?.artifactId === exp.parent && r.update.parent.version === "5.0.0" && r.update.from === "5.0.0", `${template}: 공식 템플릿 parent ${r.update.parent?.version} (최신 ${r.update.to} 미만)`);
    assert(r.summary.auto === 1 && r.items.find((i) => i.action === "auto")?.kind === "parent-version", `${template}: 자동 항목 = parent 버전 1건`);
    const ids = r.update.changes.map((x) => x.id).sort();
    assert(ids.join(",") === exp.changes.join(","), `${template}: 템플릿이 참조하는 바뀐 RTE 동작 ${ids.join(", ")}`);

    const dep0 = await m.checkDependencies({ projectDir: dir, resolve: true });
    const a0 = await m.assessProject({ projectDir: dir, resolve: true });
    assert(dep0.resolution?.success && dep0.summary.outdated === exp.outdated[0] && dep0.parent.status === "outdated", `${template}: 갱신 전 기준 미만 ${dep0.summary.outdated} · parent ${dep0.parent.status}`);
    assert(a0.grades.supplyChain.grade === exp.grade[0] && a0.migration.update?.auto === 1, `${template}: 갱신 전 공급망 ${a0.grades.supplyChain.grade}(${a0.grades.supplyChain.score}점) · 평가서 2절 최신 유지 자동 ${a0.migration.update?.auto}`);

    const pomBefore = readFileSync(path.join(dir, "pom.xml"), "utf8");
    const dry = await m.applyUpdate({ projectDir: dir });
    assert(dry.dryRun && dry.applied.items === 1 && readFileSync(path.join(dir, "pom.xml"), "utf8") === pomBefore && !existsSync(path.join(dir, "migration-backup")), `${template}: dryRun 무기록`);
    let fault = null;
    try { await m.applyUpdate({ projectDir: dir, dryRun: false, faultInjection: "after-files" }); } catch (e) { fault = e; }
    assert(fault && readFileSync(path.join(dir, "pom.xml"), "utf8") === pomBefore && (!existsSync(path.join(dir, "migration-backup")) || readdirSync(path.join(dir, "migration-backup")).length === 0), `${template}: fault-injection 롤백`);
    const ap = await m.applyUpdate({ projectDir: dir, dryRun: false });
    assert(ap.applied.edits === 1 && ap.remaining?.auto === 0 && /<version>5\.0\.2<\/version>/.test(readFileSync(path.join(dir, "pom.xml"), "utf8")), `${template}: 적용 → parent 5.0.2, 재진단 자동 0`);

    const v = await m.verifyUpdate({ projectDir: dir, timeoutMs: 600_000 });
    assert(v.build.ran && v.build.success === true, `${template}: JDK 17 mvn compile 통과(${Math.round((v.build.durationMs ?? 0) / 1000)}초)${v.build.success ? "" : ` 오류 ${v.build.errors}`}`);
    const dep1 = await m.checkDependencies({ projectDir: dir, resolve: true });
    const a1 = await m.assessProject({ projectDir: dir, resolve: true });
    assert(dep1.resolution?.success && dep1.summary.outdated === exp.outdated[1] && dep1.parent.status === "ok", `${template}: 갱신 후 기준 미만 ${dep0.summary.outdated} → ${dep1.summary.outdated} · parent ok`);
    assert(a1.grades.supplyChain.grade === exp.grade[1] && a1.grades.supplyChain.score < a0.grades.supplyChain.score, `${template}: 공급망 등급 ${a0.grades.supplyChain.grade}(${a0.grades.supplyChain.score}) → ${a1.grades.supplyChain.grade}(${a1.grades.supplyChain.score})`);
  }

  // create alignParent
  const al = await m.createProject({ template: "boot-web", projectName: "upd-align", groupId: "egovframework.example", outputDir: root, database: "hsql", alignParent: true });
  assert(al.aligned?.length === 1 && al.aligned[0].to.endsWith(":5.0.2") && m.updateProject({ projectDir: al.projectPath }).summary.auto === 0, "create alignParent=true: 생성 직후 parent 5.0.2, 갱신 항목 0");
  const b = await m.runBuild({ projectDir: al.projectPath, goal: "compile", timeoutMs: 600_000 });
  assert(b.success === true, `create alignParent=true: compile 통과`);
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`update-live FAIL (${n} assertions)`); else console.log(`update-live OK (${n} assertions)`);
