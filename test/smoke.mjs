// 1) 함수 레벨: 실제 템플릿으로 프로젝트 생성
import { createProject } from "../dist/index.js";
import * as fs from "node:fs";
const out = "/tmp/scaffold-out";
fs.rmSync(out, { recursive: true, force: true });
const r = await createProject({
  projectName: "my-egov-app", groupId: "egovframework.example",
  database: "mysql", template: "simple-backend", outputDir: out,
});
console.log("files:", r.filesExtracted, "| customized:", r.customized.length);
const pom = fs.readFileSync(r.projectPath + "/pom.xml", "utf-8");
const props = fs.readFileSync(r.projectPath + "/src/main/resources/application.properties", "utf-8");
console.log("pom groupId ok:", pom.includes("<groupId>egovframework.example</groupId>"));
console.log("pom artifact ok:", pom.includes("<artifactId>my-egov-app</artifactId>"));
console.log("parent kept:", pom.includes("egovframe-boot-starter-parent"));
console.log("dbtype ok:", /^Globals\.DbType=mysql$/m.test(props));
// 중복 생성 방지 확인
try { await createProject({projectName:"my-egov-app",groupId:"egovframework.example",database:"mysql",template:"simple-backend",outputDir:out}); console.log("dup-guard: FAIL"); }
catch { console.log("dup-guard: OK"); }
