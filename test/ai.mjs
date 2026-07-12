// AI 컴포넌트 카탈로그·조립 계획(M1) 검증 — 네트워크 불필요
import { loadAiCatalog, planAiComponents, AI_STACKS } from "../dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const catalog = loadAiCatalog();
console.log("ai catalog loaded:", catalog.components.length === 2);
console.log("schema version:", catalog.schemaVersion === 1);
console.log("stacks unique:", new Set(catalog.components.map((c) => c.stack)).size === 2);
console.log(
  "mutual exclusion declared:",
  catalog.components.every((c) => c.conflictsWith.length === 1),
);
console.log(
  "deps extracted:",
  catalog.components.every((c) => c.mavenDependencies.length >= 10),
);
console.log(
  "exclusions preserved (log4j2):",
  catalog.components.every((c) =>
    c.mavenDependencies.some((d) => (d.exclusions ?? []).some((e) => e.artifactId === "spring-boot-starter-logging")),
  ),
);
console.log(
  "requires parent recorded:",
  catalog.components.every((c) => c.requires.parent.startsWith("egovframe-boot-starter-parent:")),
);

// ---- 픽스처: 호환 부모 POM + 일부 의존성이 이미 있는 프로젝트 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-plan-"));
const fixture = path.join(tmp, "proj");
fs.mkdirSync(fixture, { recursive: true });
fs.writeFileSync(
  path.join(fixture, "pom.xml"),
  `<?xml version="1.0"?>
<project>
  <parent>
    <groupId>org.egovframe.boot</groupId>
    <artifactId>egovframe-boot-starter-parent</artifactId>
    <version>5.0.0</version>
  </parent>
  <artifactId>fixture</artifactId>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId></dependency>
  </dependencies>
</project>
`,
);

const plan = await planAiComponents({ projectDir: fixture, stack: "spring-ai", dryRun: true });
console.log("plan dryRun:", plan.dryRun === true);
console.log("parent gate ok:", plan.compatibility.parentOk === true);
console.log(
  "dep diff (existing detected):",
  plan.dependencyChanges.alreadyPresent.length >= 2 && plan.dependencyChanges.toAdd.length >= 10,
);
console.log("copy plan has source+config:", ["source", "config"].every((g) => plan.copyPlan.some((p) => p.group === g)));
console.log("total files > 0:", plan.totalFiles > 0);

// 옵션: tests 기본 제외, includeTests로 포함
console.log("tests excluded by default:", !plan.copyPlan.some((p) => p.group === "tests"));
const plan2 = await planAiComponents({ projectDir: fixture, stack: "spring-ai", includeTests: true, includeUi: false, dryRun: true });
console.log("includeTests/-Ui respected:", plan2.copyPlan.some((p) => p.group === "tests") && !plan2.copyPlan.some((p) => p.group === "ui"));

// pom 없는 경로 → 경고
const noPom = path.join(tmp, "empty");
fs.mkdirSync(noPom);
const plan3 = await planAiComponents({ projectDir: noPom, stack: "langchain4j", dryRun: true });
console.log("no-pom warning:", plan3.compatibility.pomFound === false && plan3.compatibility.warnings.length > 0);

// 상호 배타: 매니페스트에 다른 스택이 있으면 거부
fs.writeFileSync(
  path.join(fixture, ".egovframe-components.json"),
  JSON.stringify({ schemaVersion: 1, components: { "ai-rag-langchain4j": { files: [], installedAt: "" } } }),
);
try {
  await planAiComponents({ projectDir: fixture, stack: "spring-ai", dryRun: true });
  console.log("conflict guard: FAIL");
} catch {
  console.log("conflict guard: OK");
}

// M2 오프라인: pom 마커 삽입 위치·원복 유틸
{
  const { findProjectDependenciesClose, stripAiPomAdditions } = await import("../dist/index.js");
  const pomWithDm = `<project><dependencyManagement><dependencies><dependency><groupId>a</groupId><artifactId>b</artifactId></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>c</groupId><artifactId>d</artifactId></dependency></dependencies></project>`;
  const close = findProjectDependenciesClose(pomWithDm);
  console.log("deps close skips dependencyManagement:", close > pomWithDm.indexOf("</dependencyManagement>"));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-strip-"));
  const marked = `<project>
    <dependencies>
        <!-- egovframe-scaffold-mcp:ai:x:deps:start -->
        <dependency><groupId>g</groupId><artifactId>a</artifactId></dependency>
        <!-- egovframe-scaffold-mcp:ai:x:deps:end -->
    </dependencies>
</project>
`;
  const clean = `<project>
    <dependencies>
    </dependencies>
</project>
`;
  fs.writeFileSync(path.join(dir, "pom.xml"), marked);
  const changed = stripAiPomAdditions(dir, "x");
  console.log("strip markers:", changed === true && fs.readFileSync(path.join(dir, "pom.xml"), "utf-8") === clean);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 알 수 없는 스택
try {
  await planAiComponents({ projectDir: fixture, stack: "nope", dryRun: true });
  console.log("unknown stack guard: FAIL");
} catch {
  console.log("unknown stack guard: OK");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("AI_STACKS exported:", JSON.stringify(AI_STACKS) === '["spring-ai","langchain4j"]');
