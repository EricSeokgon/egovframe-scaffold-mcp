// 확장 템플릿(v0.11.0) 검증 — dryRun은 각 템플릿 zip을 실제로 내려받는다
import { TEMPLATES, createProject, GLOBALS_PROPS_REL } from "../dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

console.log("templates >= 7:", Object.keys(TEMPLATES).length >= 7);
console.log(
  "new templates registered:",
  ["simple-homepage", "portal-site", "enterprise-business", "web-sample", "msa-edu"].every((t) => t in TEMPLATES),
);
console.log("msa-edu multiProject:", TEMPLATES["msa-edu"].multiProject === true);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
const base = { groupId: "egovframework.example", database: "mysql", outputDir: tmp };

// dryRun: 레거시 템플릿 — pom·globals.properties 적용 예정 표시
const d1 = await createProject({ ...base, projectName: "t-homepage", template: "simple-homepage", dryRun: true });
console.log("[homepage] dryRun files>100:", d1.filesExtracted > 100);
console.log("[homepage] pom planned:", d1.customized.some((c) => c.startsWith("pom.xml")));
console.log("[homepage] globals planned:", d1.customized.some((c) => c.includes("egovProps/globals.properties")));

// dryRun: msa-edu — 자동 적용 없음 안내
const d2 = await createProject({ ...base, projectName: "t-msa", template: "msa-edu", dryRun: true });
console.log("[msa-edu] dryRun files>100:", d2.filesExtracted > 100);
console.log("[msa-edu] no-customize note:", d2.customized.length === 1 && d2.customized[0].includes("멀티 프로젝트"));

// 실생성: web-sample — pom 좌표 재작성 확인
const r1 = await createProject({ ...base, projectName: "t-web", template: "web-sample" });
const pom = fs.readFileSync(path.join(r1.projectPath, "pom.xml"), "utf-8");
console.log("[web-sample] generated:", r1.filesExtracted > 50);
console.log("[web-sample] pom renamed:", pom.includes("<groupId>egovframework.example</groupId>") && pom.includes("t-web"));
console.log("[web-sample] parent preserved:", pom.includes("egovframe-web-config-parent") && !pom.includes("t-web-config-parent"));

// 실생성: simple-homepage — globals.properties DbType 적용 확인
const r2 = await createProject({ ...base, projectName: "t-home", template: "simple-homepage" });
const globals = fs.readFileSync(path.join(r2.projectPath, GLOBALS_PROPS_REL), "utf-8");
console.log("[homepage] generated:", r2.filesExtracted > 100);
console.log("[homepage] DbType applied:", /^Globals\.DbType = mysql$/m.test(globals));
console.log("[homepage] legacy build step:", r2.nextSteps.some((s) => s.includes("mvn -B package")));

fs.rmSync(tmp, { recursive: true, force: true });
