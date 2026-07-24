// 1) 함수 레벨: 실제 템플릿으로 프로젝트 생성
import { createProject } from "../dist/index.js";
import assert from "node:assert/strict";
import * as fs from "node:fs";
const out = "/tmp/scaffold-out";
fs.rmSync(out, { recursive: true, force: true });
const r = await createProject({
  projectName: "my-egov-app", groupId: "egovframework.example",
  database: "mysql", template: "simple-backend", outputDir: out,
});
assert.ok(r.filesExtracted > 100, "공식 simple-backend 템플릿 파일을 추출해야 한다");
const pom = fs.readFileSync(r.projectPath + "/pom.xml", "utf-8");
const props = fs.readFileSync(r.projectPath + "/src/main/resources/application.properties", "utf-8");
assert.ok(pom.includes("<groupId>egovframework.example</groupId>"), "POM groupId를 적용해야 한다");
assert.ok(pom.includes("<artifactId>my-egov-app</artifactId>"), "POM artifactId를 적용해야 한다");
assert.ok(pom.includes("egovframe-boot-starter-parent"), "eGovFrame 부모 POM을 보존해야 한다");
assert.match(props, /^Globals\.DbType=mysql$/m, "MySQL DbType을 적용해야 한다");
// 중복 생성 방지 확인
await assert.rejects(
  () => createProject({projectName:"my-egov-app",groupId:"egovframework.example",database:"mysql",template:"simple-backend",outputDir:out}),
  "동일 프로젝트의 중복 생성을 거부해야 한다",
);

// 2) dryRun 미리보기: 디스크에 쓰지 않고 카운트만
const out2 = "/tmp/scaffold-dry";
fs.rmSync(out2, { recursive: true, force: true });
const dry = await createProject({
  projectName: "dry-app", groupId: "egovframework.example",
  database: "oracle", template: "simple-backend", outputDir: out2, dryRun: true,
});
assert.ok(!fs.existsSync(dry.projectPath), "dryRun은 디스크에 기록하면 안 된다");
assert.ok(dry.filesExtracted > 100, "dryRun도 추출 예정 파일을 계산해야 한다");
assert.equal(dry.dryRun, true, "dryRun 플래그를 반환해야 한다");
console.log("smoke OK");
