// AI 컴포넌트 카탈로그·조립 계획(M1) 검증 — 네트워크 불필요
import { loadAiCatalog, planAiComponents, AI_STACKS } from "../dist/index.js";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const catalog = loadAiCatalog();
assert.equal(catalog.components.length, 2, "AI 카탈로그는 두 스택을 포함해야 한다");
assert.equal(catalog.schemaVersion, 1, "AI 카탈로그 schemaVersion");
assert.equal(new Set(catalog.components.map((c) => c.stack)).size, 2, "AI 스택은 중복되면 안 된다");
assert.ok(catalog.components.every((c) => c.conflictsWith.length === 1), "각 AI 스택은 상호 배타 대상을 선언해야 한다");
assert.ok(catalog.components.every((c) => c.mavenDependencies.length >= 10), "각 AI 스택은 추출된 Maven 의존성을 포함해야 한다");
assert.ok(
  catalog.components.every((c) =>
    c.mavenDependencies.some((d) => (d.exclusions ?? []).some((e) => e.artifactId === "spring-boot-starter-logging"))),
  "Log4j2 exclusion 메타데이터를 보존해야 한다",
);
assert.ok(
  catalog.components.every((c) => c.requires.parent.startsWith("egovframe-boot-starter-parent:")),
  "필수 부모 POM 조건을 기록해야 한다",
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
assert.equal(plan.dryRun, true, "계획은 dryRun이어야 한다");
assert.equal(plan.compatibility.parentOk, true, "호환 부모 POM을 승인해야 한다");
assert.ok(
  plan.dependencyChanges.alreadyPresent.length >= 2 && plan.dependencyChanges.toAdd.length >= 10,
  "기존 의존성과 추가 의존성을 구분해야 한다",
);
assert.ok(
  ["source", "config"].every((g) => plan.copyPlan.some((p) => p.group === g)),
  "복사 계획은 source와 config 그룹을 포함해야 한다",
);
assert.ok(plan.totalFiles > 0, "복사 대상 파일이 있어야 한다");

// 옵션: tests 기본 제외, includeTests로 포함
assert.ok(!plan.copyPlan.some((p) => p.group === "tests"), "tests는 기본 제외되어야 한다");
const plan2 = await planAiComponents({ projectDir: fixture, stack: "spring-ai", includeTests: true, includeUi: false, dryRun: true });
assert.ok(
  plan2.copyPlan.some((p) => p.group === "tests") && !plan2.copyPlan.some((p) => p.group === "ui"),
  "includeTests와 includeUi 옵션을 반영해야 한다",
);

// pom 없는 경로 → 경고
const noPom = path.join(tmp, "empty");
fs.mkdirSync(noPom);
const plan3 = await planAiComponents({ projectDir: noPom, stack: "langchain4j", dryRun: true });
assert.ok(
  plan3.compatibility.pomFound === false && plan3.compatibility.warnings.length > 0,
  "POM이 없으면 호환성 경고를 반환해야 한다",
);

// 상호 배타: 매니페스트에 다른 스택이 있으면 거부
fs.writeFileSync(
  path.join(fixture, ".egovframe-components.json"),
  JSON.stringify({ schemaVersion: 1, components: { "ai-rag-langchain4j": { files: [], installedAt: "" } } }),
);
await assert.rejects(
  () => planAiComponents({ projectDir: fixture, stack: "spring-ai", dryRun: true }),
  "서로 다른 AI 스택의 동시 설치를 거부해야 한다",
);

// M2 오프라인: pom 마커 삽입 위치·원복 유틸
{
  const { findProjectDependenciesClose, stripAiPomAdditions } = await import("../dist/index.js");
  const pomWithDm = `<project><dependencyManagement><dependencies><dependency><groupId>a</groupId><artifactId>b</artifactId></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>c</groupId><artifactId>d</artifactId></dependency></dependencies></project>`;
  const close = findProjectDependenciesClose(pomWithDm);
  assert.ok(close > pomWithDm.indexOf("</dependencyManagement>"), "프로젝트 dependencies 닫힘 위치를 찾아야 한다");

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
  assert.ok(
    changed === true && fs.readFileSync(path.join(dir, "pom.xml"), "utf-8") === clean,
    "AI POM 마커 구간을 정확히 제거해야 한다",
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// 알 수 없는 스택
await assert.rejects(
  () => planAiComponents({ projectDir: fixture, stack: "nope", dryRun: true }),
  "알 수 없는 AI 스택을 거부해야 한다",
);

fs.rmSync(tmp, { recursive: true, force: true });
assert.deepEqual(AI_STACKS, ["spring-ai", "langchain4j"], "지원 AI 스택 공개 목록");
console.log("ai OK");
