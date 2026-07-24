// 확장 템플릿(v0.11.0) 검증 — dryRun은 각 템플릿 zip을 실제로 내려받는다
import { TEMPLATES, createProject, GLOBALS_PROPS_REL } from "../dist/index.js";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

assert.ok(Object.keys(TEMPLATES).length >= 7, "지원 템플릿은 7개 이상이어야 한다");
assert.ok(
  ["simple-homepage", "portal-site", "enterprise-business", "web-sample", "msa-edu"].every((t) => t in TEMPLATES),
  "확장 템플릿 5종을 등록해야 한다",
);
assert.equal(TEMPLATES["msa-edu"].multiProject, true, "msa-edu는 멀티 프로젝트로 표시해야 한다");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
const base = { groupId: "egovframework.example", database: "mysql", outputDir: tmp };

// dryRun: 레거시 템플릿 — pom·globals.properties 적용 예정 표시
const d1 = await createProject({ ...base, projectName: "t-homepage", template: "simple-homepage", dryRun: true });
assert.ok(d1.filesExtracted > 100, "homepage dryRun 파일 수를 계산해야 한다");
assert.ok(d1.customized.some((c) => c.startsWith("pom.xml")), "homepage POM 변경을 계획해야 한다");
assert.ok(d1.customized.some((c) => c.includes("egovProps/globals.properties")), "homepage globals 변경을 계획해야 한다");

// dryRun: msa-edu — 자동 적용 없음 안내
const d2 = await createProject({ ...base, projectName: "t-msa", template: "msa-edu", dryRun: true });
assert.ok(d2.filesExtracted > 100, "msa-edu dryRun 파일 수를 계산해야 한다");
assert.ok(
  d2.customized.length === 1 && d2.customized[0].includes("멀티 프로젝트"),
  "msa-edu 자동 변경 제외 사유를 안내해야 한다",
);

// 실생성: web-sample — pom 좌표 재작성 확인
const r1 = await createProject({ ...base, projectName: "t-web", template: "web-sample" });
const pom = fs.readFileSync(path.join(r1.projectPath, "pom.xml"), "utf-8");
assert.ok(r1.filesExtracted > 50, "web-sample 파일을 생성해야 한다");
assert.ok(
  pom.includes("<groupId>egovframework.example</groupId>") && pom.includes("t-web"),
  "web-sample 프로젝트 좌표를 변경해야 한다",
);
assert.ok(
  pom.includes("egovframe-web-config-parent") && !pom.includes("t-web-config-parent"),
  "web-sample 부모 POM 좌표를 보존해야 한다",
);

// 실생성: simple-homepage — globals.properties DbType 적용 확인
const r2 = await createProject({ ...base, projectName: "t-home", template: "simple-homepage" });
const globals = fs.readFileSync(path.join(r2.projectPath, GLOBALS_PROPS_REL), "utf-8");
assert.ok(r2.filesExtracted > 100, "homepage 파일을 생성해야 한다");
assert.match(globals, /^Globals\.DbType = mysql$/m, "homepage MySQL DbType을 적용해야 한다");
assert.ok(r2.nextSteps.some((s) => s.includes("mvn -B package")), "homepage Maven 빌드 단계를 안내해야 한다");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("templates OK");
