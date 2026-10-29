// node test/deps-fix-live.mjs — 취약 의존성 자동 조치(v1.9) 실자산 검증 (CI 통합: 네트워크·OSV·Maven Central·JDK 17)
//   (1) 공식 web·boot-web 템플릿: parent 상향 말고는 조치 0건(고정 해제·좌표 교체·취약 버전 상향 없음 — 회귀)
//   (2) 공식 msa-common-components(Maven 11 모듈): dryRun 으로 전·후 권고 수가 절반 이하로 줄고, 적용(dryRun=false)하면
//       루트 mvn compile 이 통과해 유지되며, 다시 돌리면 고정 해제·상향이 0(멱등). 5.1.0 목표도 계획만 세워 수치를 남긴다.
//   템플릿·OSV 는 날마다 바뀌므로 건수는 로그로 남기고 방향(감소·절반 이하·compile 통과)만 단언한다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let n = 0;
function assert(c, msg) { n++; if (!c) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const info = (msg) => console.log("info:", msg);
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egov-deps-fix-live-"));

try {
  for (const template of ["web", "boot-web"]) {
    const c = await m.createProject({ template, projectName: `df-${template}`, groupId: "egovframework.example", outputDir: root, database: "hsql" });
    const r = await m.fixDependencies({ projectDir: c.projectPath });
    const k = r.summary.byKind;
    assert(!r.osvError && k.unpin === 0 && k.coordinate === 0 && k["cve-bump"] === 0 && k.parent <= 1, `${template}: parent 상향 ${k.parent} 말고 조치 0건 (수동 ${r.summary.manual}, 권고 ${r.vulnerabilities?.before.ids} → ${r.vulnerabilities?.after.ids})`);
  }

  const c = await m.createProject({ template: "msa-common-components", projectName: "df-msa", groupId: "egovframework.example", outputDir: root, database: "mysql" });
  const dir = c.projectPath;
  const plan = await m.fixDependencies({ projectDir: dir });
  const v = plan.vulnerabilities;
  info(`msa 계획: ${JSON.stringify(plan.summary.byKind)} · 수동 ${plan.summary.manual} · 권고 ${v?.before.ids} → ${v?.after.ids} · 좌표 ${v?.before.coordinates} → ${v?.after.coordinates}`);
  assert(!plan.osvError && v && v.before.ids > 0 && v.after.ids * 2 <= v.before.ids, `msa: 예측 권고 ${v?.before.ids} → ${v?.after.ids} (절반 이하)`);
  assert(plan.summary.byKind["cve-bump"] > 0 && plan.files.length > 1, `msa: 여러 모듈 pom 에 취약 버전 상향 ${plan.summary.byKind["cve-bump"]}건`);
  const p51 = await m.fixDependencies({ projectDir: dir, target: "5.1.0" });
  info(`msa 5.1.0 계획: ${JSON.stringify(p51.summary.byKind)} · 권고 ${p51.vulnerabilities?.before.ids} → ${p51.vulnerabilities?.after.ids}`);

  const done = await m.fixDependencies({ projectDir: dir, dryRun: false, timeoutMs: 1_200_000 });
  info(`msa 적용: compile ${done.build?.success} (${done.build?.durationMs}ms${done.build?.failureKind ? `, ${done.build.failureKind}` : ""}) · 권고 ${done.vulnerabilities?.before.ids} → ${done.vulnerabilities?.after.ids}`);
  if (done.build?.failureKind === "repository-unavailable") info("원격 저장소 장애 — compile 확인을 건너뜀(되돌림 확인만)");
  else assert(done.build?.ran && done.build.success && !done.rolledBack && done.backupDir, `msa: 적용 후 루트 mvn compile 통과${done.build?.firstErrors ? ` — ${done.build.firstErrors.join(" | ")}` : ""}${done.build?.success ? "" : `\n${done.build?.logTail ?? ""}`}`);
  if (done.rolledBack) assert(done.backupDir === undefined, "msa: 되돌렸으면 백업 폴더도 없음");
  else {
    const again = await m.fixDependencies({ projectDir: dir });
    assert(again.summary.byKind.unpin === 0 && again.summary.byKind["cve-bump"] === 0 && again.summary.byKind.parent === 0, `msa: 다시 돌리면 조치 0 (수동 ${again.summary.manual}, 남은 권고 ${again.vulnerabilities?.before.ids})`);
    const dep = await m.checkDependencies({ projectDir: dir, offline: false });
    info(`msa check_egovframe_dependencies 취약 선언 ${dep.vulnerabilities?.length}건`);
    assert(m.readFixHistory(dir).length === 1, "msa: 조치 내역 1건(평가서·납품 패키지용)");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`deps-fix-live FAIL (${n} assertions)`); else console.log(`deps-fix-live OK (${n} assertions)`);
