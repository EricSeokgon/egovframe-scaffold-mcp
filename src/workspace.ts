// 작업공간(멀티 모듈·다중 서비스) 탐지 (v0.47).
//   공식 MSA 템플릿처럼 한 저장소에 빌드 단위가 여럿인 구조를 모듈 목록으로 만든다 — 도구들이 모듈별로 같은 판정을 하게.
//   - maven-modules : 루트 pom 의 <modules>(재귀)
//   - gradle-include: settings.gradle(.kts) 의 include
//   - independent   : 루트에 빌드 파일이 없고 하위 디렉터리(깊이 2까지)에 독립 프로젝트가 여럿(msa-edu 의 backend/*)
//   - single        : 루트 빌드 파일 하나(모듈 없음)
import * as fs from "node:fs";
import * as path from "node:path";

export type WorkspaceKind = "single" | "maven-modules" | "gradle-include" | "independent" | "none";
export interface WorkspaceModule {
  /** 모듈 이름(디렉터리 이름 또는 artifactId) */
  name: string;
  /** 작업공간 루트 상대 경로(posix, 루트 자신은 "") */
  dir: string;
  buildTool: "maven" | "gradle";
  packaging: "jar" | "war" | "pom";
  boot: boolean;
  web: boolean;
  /** 실행 단위가 아닌 모듈(라이브러리 jar·집계 pom) */
  library: boolean;
  /** 모듈에 이미 있는 Dockerfile(모듈 상대) */
  dockerfile: string | null;
  /** Maven 모듈의 parent 가 작업공간 안의 pom(집계·공통 parent)이면 그 상대 경로 — 모듈 단독 빌드가 안 되므로 루트에서 -pl 로 빌드 */
  inheritsFrom: string | null;
}
export interface Workspace { root: string; kind: WorkspaceKind; modules: WorkspaceModule[]; notes: string[] }

const read = (p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const stripXml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");
const SKIP = new Set([".git", "node_modules", "target", "build", ".gradle", ".idea", "migration-backup", "upgrade-backup", "frontend", "dist", "out", "bin"]);

function pomInfo(abs: string): { artifactId: string; groupId: string | null; packaging: "jar" | "war" | "pom"; modules: string[]; parent: { groupId: string | null; artifactId: string | null; relativePath: string | null } | null; boot: boolean; web: boolean; repackage: boolean } {
  const pom = stripXml(read(abs));
  const parentBlock = pom.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? null;
  const self = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "").replace(/<dependencies>[\s\S]*?<\/dependencies>/g, "").replace(/<build>[\s\S]*?<\/build>/g, "").replace(/<profiles>[\s\S]*?<\/profiles>/g, "");
  const modules = [...(pom.match(/<modules>([\s\S]*?)<\/modules>/)?.[1] ?? "").matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((m) => m[1]);
  const pk = self.match(/<packaging>\s*(\w+)\s*<\/packaging>/)?.[1];
  const parentArt = parentBlock?.match(/<artifactId>\s*([^<\s]+)/)?.[1] ?? null;
  return {
    artifactId: self.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1] ?? path.basename(path.dirname(abs)),
    groupId: self.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1] ?? parentBlock?.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? null,
    packaging: pk === "war" ? "war" : pk === "pom" ? "pom" : "jar",
    modules,
    parent: parentBlock ? { groupId: parentBlock.match(/<groupId>\s*([^<\s]+)/)?.[1] ?? null, artifactId: parentArt, relativePath: parentBlock.match(/<relativePath>\s*([^<\s]*)\s*<\/relativePath>/)?.[1] ?? null } : null,
    boot: /spring-boot-starter-parent|egovframe-boot-starter-parent/.test(parentArt ?? "") || /spring-boot-maven-plugin/.test(pom),
    // 실행 jar 로 다시 묶는 플러그인이 빌드에 있는지(Boot parent 만 있고 플러그인이 없으면 라이브러리 jar)
    repackage: /<plugins>[\s\S]*<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>/.test(pom.replace(/<pluginManagement>[\s\S]*?<\/pluginManagement>/g, "")),
    web: pk === "war" || /<artifactId>\s*spring-boot-starter-(web|webflux|thymeleaf)\s*<\/artifactId>|<artifactId>\s*spring-cloud-starter-gateway[\w-]*\s*<\/artifactId>|<artifactId>\s*spring-cloud-(config-server|starter-netflix-eureka-server)\s*<\/artifactId>/.test(pom),
  };
}

function gradleInfo(dir: string): { packaging: "jar" | "war"; boot: boolean; web: boolean; library: boolean } {
  const g = read(path.join(dir, "build.gradle")) + read(path.join(dir, "build.gradle.kts"));
  const boot = /id\s*\(?\s*['"]org\.springframework\.boot['"]|apply\s+plugin\s*:\s*['"]org\.springframework\.boot['"]/.test(g);
  const war = /id\s*\(?\s*['"]war['"]|apply\s+plugin\s*:\s*['"]war['"]/.test(g);
  // Boot 플러그인이 있어도 bootJar 를 끄면 라이브러리(msa-edu 의 egovframe-cloud-module-common)
  const bootJarOff = /bootJar\s*\{[^}]*enabled\s*=\s*false/.test(g) || /tasks\.named\(\s*['"]bootJar['"]\)\s*\{[^}]*enabled\s*=\s*false/.test(g);
  return { packaging: war ? "war" : "jar", boot: boot && !bootJarOff, web: war || /spring-boot-starter-(web|webflux|thymeleaf)|spring-cloud-starter-gateway|spring-cloud-config-server|spring-cloud-starter-netflix-eureka-server/.test(g), library: !war && (!boot || bootJarOff) };
}

const dockerfileIn = (abs: string) => (fs.existsSync(path.join(abs, "Dockerfile")) ? "Dockerfile" : null);
const rel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");

function mavenModules(root: string, pomDir: string, out: WorkspaceModule[], coords: Map<string, string>, depth: number): void {
  const info = pomInfo(path.join(pomDir, "pom.xml"));
  if (info.groupId) coords.set(`${info.groupId}:${info.artifactId}`, rel(root, pomDir));
  if (info.packaging === "pom" && info.modules.length && depth < 4) {
    for (const m of info.modules) {
      const abs = path.resolve(pomDir, m);
      if (!abs.startsWith(root) || !fs.existsSync(path.join(abs, "pom.xml"))) continue;
      mavenModules(root, abs, out, coords, depth + 1);
    }
    return;
  }
  const parentCoord = info.parent?.groupId && info.parent.artifactId ? `${info.parent.groupId}:${info.parent.artifactId}` : null;
  out.push({
    name: path.basename(pomDir), dir: rel(root, pomDir), buildTool: "maven", packaging: info.packaging, boot: info.boot, web: info.web,
    library: info.packaging === "jar" && !info.repackage, dockerfile: dockerfileIn(pomDir),
    inheritsFrom: parentCoord, // 아래에서 작업공간 안의 좌표로 바꾸거나 null
  });
}

/** 루트에서 작업공간 구조를 찾는다(읽기 전용). */
export function detectWorkspace(projectDir: string): Workspace {
  const root = path.resolve(projectDir);
  const notes: string[] = [];
  const hasPom = fs.existsSync(path.join(root, "pom.xml"));
  const gradleRoot = fs.existsSync(path.join(root, "build.gradle")) || fs.existsSync(path.join(root, "build.gradle.kts"));
  const settings = read(path.join(root, "settings.gradle")) + read(path.join(root, "settings.gradle.kts"));

  if (hasPom) {
    const info = pomInfo(path.join(root, "pom.xml"));
    if (info.packaging === "pom" && info.modules.length) {
      const modules: WorkspaceModule[] = [];
      const coords = new Map<string, string>();
      mavenModules(root, root, modules, coords, 0);
      for (const m of modules) m.inheritsFrom = m.inheritsFrom ? (coords.get(m.inheritsFrom) ?? null) : null;
      return { root, kind: "maven-modules", modules, notes };
    }
  }
  const includes = [...settings.matchAll(/^\s*include\s*\(?([^\n)]*)\)?/gm)].flatMap((m) => [...m[1].matchAll(/['"]:?([\w.\-:/]+)['"]/g)].map((x) => x[1].replace(/:/g, "/")));
  if (includes.length) {
    const modules = includes.filter((d) => fs.existsSync(path.join(root, d))).map((d): WorkspaceModule => {
      const gi = gradleInfo(path.join(root, d));
      return { name: path.basename(d), dir: d, buildTool: "gradle", packaging: gi.packaging, boot: gi.boot, web: gi.web, library: gi.library, dockerfile: dockerfileIn(path.join(root, d)), inheritsFrom: null };
    });
    return { root, kind: "gradle-include", modules, notes };
  }
  if (hasPom || gradleRoot) {
    const tool = hasPom ? "maven" : "gradle";
    const info = hasPom ? pomInfo(path.join(root, "pom.xml")) : null;
    const gi = hasPom ? null : gradleInfo(root);
    return { root, kind: "single", notes, modules: [{ name: path.basename(root), dir: "", buildTool: tool, packaging: info ? info.packaging : gi!.packaging, boot: info ? info.boot : gi!.boot, web: info ? info.web : gi!.web, library: info ? info.packaging === "jar" && !info.repackage : gi!.library, dockerfile: dockerfileIn(root), inheritsFrom: null }] };
  }
  // 루트 빌드 파일 없음 → 깊이 2까지 독립 프로젝트
  const modules: WorkspaceModule[] = [];
  const scan = (abs: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const d = path.join(abs, e.name);
      if (fs.existsSync(path.join(d, "pom.xml"))) {
        const info = pomInfo(path.join(d, "pom.xml"));
        modules.push({ name: e.name, dir: rel(root, d), buildTool: "maven", packaging: info.packaging, boot: info.boot, web: info.web, library: info.packaging !== "war" && !info.repackage, dockerfile: dockerfileIn(d), inheritsFrom: null });
      } else if (fs.existsSync(path.join(d, "build.gradle")) || fs.existsSync(path.join(d, "build.gradle.kts"))) {
        const gi = gradleInfo(d);
        modules.push({ name: e.name, dir: rel(root, d), buildTool: "gradle", packaging: gi.packaging, boot: gi.boot, web: gi.web, library: gi.library, dockerfile: dockerfileIn(d), inheritsFrom: null });
      } else if (depth < 1) scan(d, depth + 1);
    }
  };
  scan(root, 0);
  if (modules.length >= 2) {
    notes.push(`루트에 빌드 파일이 없고 하위에 독립 프로젝트 ${modules.length}개가 있습니다(${[...new Set(modules.map((m) => path.posix.dirname(m.dir)))].map((d) => (d === "." ? "루트" : d)).join(", ")}).`);
    return { root, kind: "independent", modules, notes };
  }
  if (modules.length === 1) return { root, kind: "independent", modules, notes };
  return { root, kind: "none", modules: [], notes };
}

/** 여러 모듈로 나뉜 작업공간인지(모듈별 판정이 필요한지) */
export const isMultiModule = (w: Workspace): boolean => w.kind === "maven-modules" || w.kind === "gradle-include" || (w.kind === "independent" && w.modules.length > 0);
/** 파일(작업공간 상대)이 속한 모듈 — 가장 긴 접두 경로 */
export function moduleOf(w: Workspace, file: string): WorkspaceModule | null {
  let best: WorkspaceModule | null = null;
  for (const m of w.modules) if (m.dir && (file === m.dir || file.startsWith(`${m.dir}/`)) && (!best || m.dir.length > best.dir.length)) best = m;
  return best;
}

// ── 간단한 YAML 평탄화(맵·스칼라만, 리스트 항목은 키[인덱스] 없이 건너뜀) ─────────────
/** application.yml 을 점 표기 키 → {값, 줄} 로. 여러 문서(---)는 이어 붙이되 같은 키는 뒤가 이긴다. 리스트는 건너뛴다. */
export function flattenYaml(text: string): Map<string, { value: string; line: number }> {
  const out = new Map<string, { value: string; line: number }>();
  const stack: { indent: number; key: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^---/.test(raw)) { stack.length = 0; continue; }
    const noComment = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (!noComment.trim()) continue;
    const m = noComment.match(/^(\s*)([^\s:#][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) continue; // 리스트 항목·여러 줄 스칼라
    if (m[2].startsWith("- ")) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const key = [...stack.map((s) => s.key), m[2].replace(/^["']|["']$/g, "")].join(".");
    const value = (m[3] ?? "").trim();
    if (value === "" || value === "|" || value === ">") { stack.push({ indent, key: m[2].replace(/^["']|["']$/g, "") }); continue; }
    out.set(key, { value: value.replace(/^["'](.*)["']$/, "$1"), line: i + 1 });
  }
  return out;
}
