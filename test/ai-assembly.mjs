// AI 컴포넌트 실조립(M2) 통합 테스트 — egovframe-ai-rag 저장소를 실제로 내려받는다
import { addAiComponents, removeComponents, validateProject, readManifest, AI_POM_BACKUP } from "../dist/index.js";
import assert from "node:assert/strict";
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
assert.ok(r.dryRun === false && r.copiedFiles > 40, "spring-ai 파일을 실제 조립해야 한다");
assert.ok(r.pomChanged === true && fs.existsSync(path.join(proj, AI_POM_BACKUP)), "POM 변경 전 백업해야 한다");

const pom = fs.readFileSync(path.join(proj, "pom.xml"), "utf-8");
assert.ok(pom.includes("egovframe-scaffold-mcp:ai:ai-rag-spring-ai:deps:start"), "spring-ai POM 마커를 기록해야 한다");
assert.ok(pom.includes("spring-ai-client-chat"), "spring-ai 의존성을 추가해야 한다");
assert.equal((pom.match(/spring-boot-starter-web/g) || []).length, 1, "기존 의존성을 중복시키면 안 된다");
assert.ok(pom.includes("spring-boot-starter-logging"), "POM exclusion을 보존해야 한다");

assert.ok(fs.existsSync(path.join(proj, "src/main/resources/application-ai.yml")), "AI 프로필 설정을 생성해야 한다");
assert.ok(!fs.existsSync(path.join(proj, "src/main/resources/application.yml")), "원본 application.yml 경로에 쓰면 안 된다");
assert.ok(fs.existsSync(path.join(proj, "src/main/java/com/example/chat/config/EgovRagConfig.java")), "spring-ai 소스를 복사해야 한다");
assert.ok(
  fs.existsSync(path.join(proj, "docker-compose.ai.yml")) && fs.existsSync(path.join(proj, "Dockerfile.ai")),
  "인프라 파일을 AI 전용 이름으로 복사해야 한다",
);
assert.ok(fs.existsSync(path.join(proj, "k8s/ai")), "Kubernetes 자산을 k8s/ai 아래에 복사해야 한다");
assert.ok(fs.existsSync(path.join(proj, "src/main/resources/templates/chat.html")), "채팅 UI를 복사해야 한다");
assert.ok(!fs.existsSync(path.join(proj, "src/test")), "테스트는 기본 제외되어야 한다");

const manifest = readManifest(proj);
const entry = manifest?.components["ai-rag-spring-ai"];
assert.ok(
  !!entry && entry.files.length === r.copiedFiles && entry.pom?.addedDeps.length > 10,
  "조립 파일과 POM 변경을 매니페스트에 기록해야 한다",
);

// ---- 중복/배타 거부 ----
await assert.rejects(() => addAiComponents({ projectDir: proj, stack: "spring-ai" }), "동일 AI 스택의 중복 설치를 거부해야 한다");
await assert.rejects(() => addAiComponents({ projectDir: proj, stack: "langchain4j" }), "서로 다른 AI 스택의 동시 설치를 거부해야 한다");

// ---- 검증 ----
const v = await validateProject({ projectDir: proj });
assert.ok(v.ok === true && v.components.some((c) => c.id === "ai-rag-spring-ai"), "spring-ai 설치 검증을 통과해야 한다");

// ---- 제거 → pom 원복 ----
const rm = await removeComponents({ projectDir: proj, components: ["ai-rag-spring-ai"] });
assert.equal(rm.totalFiles, r.copiedFiles, "설치한 spring-ai 파일을 모두 제거해야 한다");
const pomAfter = fs.readFileSync(path.join(proj, "pom.xml"), "utf-8");
assert.equal(pomAfter, ORIGINAL_POM, "spring-ai 제거 후 POM을 원복해야 한다");
assert.ok(!fs.existsSync(path.join(proj, AI_POM_BACKUP)), "POM 백업을 정리해야 한다");
assert.equal(readManifest(proj), null, "빈 매니페스트를 정리해야 한다");
assert.ok(!fs.existsSync(path.join(proj, "src/main/java/com")), "빈 spring-ai 소스 디렉터리를 정리해야 한다");

// ================= langchain4j 스택 사이클 =================
const proj2 = path.join(tmp, "proj2");
fs.mkdirSync(path.join(proj2, "src/main/resources"), { recursive: true });
fs.writeFileSync(path.join(proj2, "pom.xml"), ORIGINAL_POM.replace("ai-asm-fixture", "ai-asm-fixture-lc4j"));

const r2 = await addAiComponents({ projectDir: proj2, stack: "langchain4j" });
assert.ok(r2.dryRun === false && r2.copiedFiles > 40, "langchain4j 파일을 실제 조립해야 한다");
const pom2 = fs.readFileSync(path.join(proj2, "pom.xml"), "utf-8");
assert.ok(pom2.includes("egovframe-scaffold-mcp:ai:ai-rag-langchain4j:deps:start"), "langchain4j POM 마커를 기록해야 한다");
assert.ok(
  pom2.includes("langchain4j-pgvector") && pom2.includes("spring-boot-starter-data-jpa"),
  "langchain4j 의존성을 추가해야 한다",
);
assert.ok(fs.existsSync(path.join(proj2, "init-scripts/ai")), "langchain4j 초기화 스크립트를 ai 하위에 복사해야 한다");
assert.ok(
  fs.existsSync(path.join(proj2, "src/main/java/com/example/chat/entity/ChatMemoryEntity.java")),
  "langchain4j 엔티티를 복사해야 한다",
);
assert.ok(fs.existsSync(path.join(proj2, "src/main/resources/application-ai.yml")), "langchain4j 프로필 설정을 생성해야 한다");

// AI 실행 전제 진단 (aiChecks): 임베딩 설정 경로 검출 + compose 안내
const v2 = await validateProject({ projectDir: proj2 });
assert.equal(v2.ok, true, "langchain4j 설치 검증을 통과해야 한다");
assert.ok(v2.aiChecks.some((c) => c.note.includes("임베딩 설정")), "임베딩 설정을 진단해야 한다");
assert.ok(
  v2.aiChecks.some((c) => c.file.endsWith("docker-compose.ai.yml") && c.exists),
  "AI docker-compose 파일을 진단해야 한다",
);

const rm2 = await removeComponents({ projectDir: proj2, components: ["ai-rag-langchain4j"] });
assert.equal(rm2.totalFiles, r2.copiedFiles, "설치한 langchain4j 파일을 모두 제거해야 한다");
assert.equal(
  fs.readFileSync(path.join(proj2, "pom.xml"), "utf-8"),
  ORIGINAL_POM.replace("ai-asm-fixture", "ai-asm-fixture-lc4j"),
  "langchain4j 제거 후 POM을 원복해야 한다",
);
assert.ok(!fs.existsSync(path.join(proj2, "init-scripts")), "빈 langchain4j 초기화 디렉터리를 정리해야 한다");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("ai-assembly OK");
