// AI 컴포넌트 실조립(M2) 통합 테스트 — egovframe-ai-rag 저장소를 실제로 내려받는다
import { addAiComponents, removeComponents, validateProject, readManifest, AI_POM_BACKUP } from "../dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-asm-"));
const proj = path.join(tmp, "proj");
fs.mkdirSync(path.join(proj, "src/main/resources"), { recursive: true });

const ORIGINAL_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.egovframe.boot</groupId>
        <artifactId>egovframe-boot-starter-parent</artifactId>
        <version>5.0.0</version>
    </parent>
    <artifactId>ai-asm-fixture</artifactId>
    <properties>
        <java.version>17</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
        </dependency>
    </dependencies>
</project>
`;
fs.writeFileSync(path.join(proj, "pom.xml"), ORIGINAL_POM);

// ---- 조립 ----
const r = await addAiComponents({ projectDir: proj, stack: "spring-ai" });
console.log("assembled:", r.dryRun === false && r.copiedFiles > 40);
console.log("pom changed with backup:", r.pomChanged === true && fs.existsSync(path.join(proj, AI_POM_BACKUP)));

const pom = fs.readFileSync(path.join(proj, "pom.xml"), "utf-8");
console.log("pom markers present:", pom.includes("egovframe-scaffold-mcp:ai:ai-rag-spring-ai:deps:start"));
console.log("dep inserted:", pom.includes("spring-ai-client-chat"));
console.log("existing deps untouched:", (pom.match(/spring-boot-starter-web/g) || []).length === 1);
console.log("exclusions preserved in pom:", pom.includes("spring-boot-starter-logging"));

console.log("config profiled:", fs.existsSync(path.join(proj, "src/main/resources/application-ai.yml")));
console.log("original yml NOT created:", !fs.existsSync(path.join(proj, "src/main/resources/application.yml")));
console.log("source copied:", fs.existsSync(path.join(proj, "src/main/java/com/example/chat/config/EgovRagConfig.java")));
console.log("infra renamed:", fs.existsSync(path.join(proj, "docker-compose.ai.yml")) && fs.existsSync(path.join(proj, "Dockerfile.ai")));
console.log("k8s under ai/:", fs.existsSync(path.join(proj, "k8s/ai")));
console.log("ui copied:", fs.existsSync(path.join(proj, "src/main/resources/templates/chat.html")));
console.log("tests excluded:", !fs.existsSync(path.join(proj, "src/test")));

const manifest = readManifest(proj);
const entry = manifest?.components["ai-rag-spring-ai"];
console.log("manifest recorded:", !!entry && entry.files.length === r.copiedFiles && entry.pom?.addedDeps.length > 10);

// ---- 중복/배타 거부 ----
try { await addAiComponents({ projectDir: proj, stack: "spring-ai" }); console.log("dup guard: FAIL"); }
catch { console.log("dup guard: OK"); }
try { await addAiComponents({ projectDir: proj, stack: "langchain4j" }); console.log("conflict guard: FAIL"); }
catch { console.log("conflict guard: OK"); }

// ---- 검증 ----
const v = await validateProject({ projectDir: proj });
console.log("validate ok:", v.ok === true && v.components.some((c) => c.id === "ai-rag-spring-ai"));

// ---- 제거 → pom 원복 ----
const rm = await removeComponents({ projectDir: proj, components: ["ai-rag-spring-ai"] });
console.log("removed files:", rm.totalFiles === r.copiedFiles);
const pomAfter = fs.readFileSync(path.join(proj, "pom.xml"), "utf-8");
console.log("pom restored:", pomAfter === ORIGINAL_POM);
console.log("backup cleaned:", !fs.existsSync(path.join(proj, AI_POM_BACKUP)));
console.log("manifest cleaned:", readManifest(proj) === null);
console.log("source dir pruned:", !fs.existsSync(path.join(proj, "src/main/java/com")));

fs.rmSync(tmp, { recursive: true, force: true });
