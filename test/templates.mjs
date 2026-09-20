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

// v0.24.0 추가 템플릿 — 공식 저장소 경로와 멀티 프로젝트 표시를 강제한다
const ADDED = ["msa-common-components", "mobile-device-api", "ai-rag"];
assert.ok(
  ADDED.every((t) => t in TEMPLATES),
  "v0.24.0 신규 템플릿(msa-common-components·mobile-device-api·ai-rag)이 등록되어야 한다",
);
for (const t of ADDED) {
  assert.equal(TEMPLATES[t].multiProject, true, `${t}는 멀티 프로젝트로 표시해야 한다`);
  assert.match(TEMPLATES[t].repo, /^eGovFramework\//, `${t}는 공식 조직 저장소를 가리켜야 한다`);
  assert.ok(TEMPLATES[t].branch, `${t}는 기본 브랜치를 지정해야 한다`);
}

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

// v0.24.0 신규 멀티 프로젝트 템플릿도 실제 아카이브를 내려받아 계획을 세워야 한다
const d3 = await createProject({ ...base, projectName: "t-msa-cc", template: "msa-common-components", dryRun: true });
assert.ok(d3.filesExtracted > 100, "msa-common-components dryRun 파일 수를 계산해야 한다");
assert.ok(
  d3.customized.some((c) => c.includes("멀티 프로젝트")),
  "msa-common-components는 좌표/DB 자동 적용 없음을 안내해야 한다",
);

// ── v0.27.0: Initializr zip 조달 템플릿 (고정 commit + sha256 검증) ──
// 실생성: batch-file-commandline — 지문 검증·pom 자리표시자·batch 경로의 globals.properties
const z1 = await createProject({ ...base, projectName: "t-batch", template: "batch-file-commandline" });
assert.equal(z1.archiveVerified, true, "zip 지문을 검증해야 한다");
assert.match(z1.ref, /^[0-9a-f]{40}$/, "zip 템플릿은 고정 commit 으로 내려받아야 한다");
assert.ok(z1.filesExtracted >= 40, "batch 파일을 생성해야 한다");
const zPom = fs.readFileSync(path.join(z1.projectPath, "pom.xml"), "utf-8");
assert.ok(!/###[A-Z_]+###/.test(zPom), "pom 자리표시자가 남으면 안 된다");
assert.ok(zPom.includes("<groupId>egovframework.example</groupId>") && zPom.includes("<artifactId>t-batch</artifactId>"), "batch 프로젝트 좌표를 적용해야 한다");
assert.ok(fs.existsSync(path.join(z1.projectPath, "src")) && !fs.existsSync(path.join(z1.projectPath, "main")), "zip 루트를 최상위 폴더로 오인해 잘라내면 안 된다");
const zGlobals = fs.readFileSync(path.join(z1.projectPath, "src/main/resources/egovframework/batch/properties/globals.properties"), "utf-8");
assert.match(zGlobals, /^Globals\.DbType = mysql$/m, "batch globals.properties 에 DbType 을 적용해야 한다");

// 지문이 다르면 아무것도 만들지 않고 거부한다
const pinned = TEMPLATES["batch-file-commandline"].archive.sha256;
TEMPLATES["batch-file-commandline"].archive.sha256 = "0".repeat(64);
await assert.rejects(
  () => createProject({ ...base, projectName: "t-batch-bad", template: "batch-file-commandline" }),
  /지문이 고정값과 다릅니다/,
  "지문 불일치를 거부해야 한다",
);
TEMPLATES["batch-file-commandline"].archive.sha256 = pinned;
assert.ok(!fs.existsSync(path.join(tmp, "t-batch-bad")), "지문 불일치 시 디렉터리를 만들면 안 된다");

// ref 를 직접 주면 검증을 건너뛰고 그 사실을 알린다
const z2 = await createProject({ ...base, projectName: "t-batch-ref", template: "batch-file-commandline", ref: "main", dryRun: true });
assert.equal(z2.archiveVerified, false, "ref 지정 시 지문 검증을 생략해야 한다");
assert.ok(z2.customized.some((c) => c.includes("검증을 건너뜁니다")), "검증 생략을 안내해야 한다");

// dryRun: 멀티 프로젝트 zip
const z3 = await createProject({ ...base, projectName: "t-msa-portal", template: "msa-portal-backend", dryRun: true });
assert.ok(z3.filesExtracted > 100 && z3.archiveVerified === true, "msa-portal-backend dryRun 계획과 지문 검증");
assert.ok(z3.customized.some((c) => c.includes("멀티 프로젝트")), "msa-portal-backend 는 자동 적용 없음을 안내해야 한다");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("templates OK");
