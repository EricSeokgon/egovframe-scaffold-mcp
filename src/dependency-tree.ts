// 해석된 의존성 트리 (v0.36) — 빌드 도구로 전이 의존성까지 풀어 "실제로 실리는" artifact 목록을 만든다.
//   Maven : maven-dependency-plugin 3.8.1 의 tree 골(좌표를 완전히 적어 pom 변경 없이 호출) → -DoutputFile 텍스트
//   Gradle: `dependencies --configuration runtimeClasspath|testRuntimeClasspath -q --console=plain` → stdout
// 파서는 순수 함수이고 실행은 build-runner 의 Runner(타임아웃·프로세스 트리 종료·래퍼 감지)를 그대로 쓴다.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { capOutput, defaultRunner, detectBuildToolAt, resolveCommand, type BuildTool, type ResolvedCommand, type Runner } from "./build-runner.js";

export const MAVEN_DEPENDENCY_PLUGIN = "org.apache.maven.plugins:maven-dependency-plugin:3.8.1";
export type ResolveScope = "runtime" | "all";

export interface ResolvedArtifact {
  groupId: string;
  artifactId: string;
  version: string;
  /** Maven scope(compile·runtime·provided·test) — Gradle 은 configuration 이름 */
  scope: string | null;
  type?: string;
  classifier?: string;
  /** 트리 깊이(1 = 직접 의존성) */
  depth: number;
  /** 루트에서 이 artifact 까지의 경로(artifactId, 자신 제외) */
  via: string[];
  /** 요청 버전과 다른 버전으로 해석됐을 때 요청 버전(Gradle `a:b:1.0 -> 1.2`) */
  requestedVersion?: string;
}

export interface DependencyTreeResult {
  buildTool: BuildTool;
  scope: ResolveScope;
  ran: boolean;
  success: boolean;
  command: string;
  durationMs?: number;
  /** 루트(프로젝트·모듈) 좌표 */
  roots: { groupId: string; artifactId: string; version: string }[];
  /** 중복 제거된 artifact(같은 groupId:artifactId 는 가장 얕은 경로 하나) */
  artifacts: ResolvedArtifact[];
  /** 트리에 나타난 전체 노드 수(중복 포함) */
  nodes: number;
  error?: string;
  logTail?: string;
}

/** Maven 좌표 토큰: g:a:type:version[:scope] 또는 g:a:type:classifier:version:scope (후속 주석 "(…)" 은 버린다). */
export function parseMavenCoord(text: string): { groupId: string; artifactId: string; type: string; classifier?: string; version: string; scope: string | null } | null {
  const token = text.trim().split(/\s+/)[0] ?? "";
  const parts = token.split(":");
  if (parts.length < 4 || parts.length > 6 || parts.some((x) => !x)) return null;
  const [groupId, artifactId, type] = parts;
  if (parts.length === 4) return { groupId, artifactId, type, version: parts[3], scope: null };
  if (parts.length === 5) return { groupId, artifactId, type, version: parts[3], scope: parts[4] };
  return { groupId, artifactId, type, classifier: parts[3], version: parts[4], scope: parts[5] };
}

/**
 * maven-dependency-plugin tree(text) 출력을 파싱한다. 루트 줄은 접두 없이 시작하고 하위는 3글자 단위(`+- `·`|  `·`\- `·`   `)로 들여쓴다.
 * 좌표는 groupId:artifactId:type[:classifier]:version[:scope]. 여러 모듈이 appendOutput 으로 이어 붙으면 루트가 여러 개다.
 */
export function parseMavenTree(text: string): { roots: DependencyTreeResult["roots"]; nodes: ResolvedArtifact[] } {
  const roots: DependencyTreeResult["roots"] = [];
  const nodes: ResolvedArtifact[] = [];
  const stack: string[] = []; // depth 별 artifactId
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\[INFO\]\s?/, "").replace(/\s+$/, "");
    if (!line.trim()) continue;
    const m = line.match(/^((?:[|+\\ ]{2}\s|\|\s\s|\s{3})*)(?:[+\\]-\s)?(.+)$/);
    if (!m) continue;
    const prefix = line.slice(0, line.length - m[2].length);
    const depth = Math.round(prefix.length / 3);
    const coord = parseMavenCoord(m[2]);
    if (!coord) continue;
    const { groupId, artifactId, type, classifier, version, scope } = coord;
    if (depth === 0) { roots.push({ groupId, artifactId, version }); stack.length = 0; stack[0] = artifactId; continue; }
    stack.length = depth;
    const via = stack.slice(1, depth).filter(Boolean);
    stack[depth] = artifactId;
    nodes.push({ groupId, artifactId, version, scope, type, ...(classifier ? { classifier } : {}), depth, via });
  }
  return { roots, nodes };
}

const GRADLE_COORD_RE = /^([\w.\-]+):([\w.\-]+)(?::([\w.\-+]+))?(?:\s*->\s*([\w.\-+]+))?(?:\s*\((\*|c|n)\))?\s*$/;

/**
 * `gradle dependencies --configuration X` 출력을 파싱한다. 하위는 5글자 단위(`+--- `·`|    `·`\--- `·`     `).
 * `a:b:1.0 -> 1.2` 는 1.2 로 해석된 것, `(*)` 는 이미 나온 하위 트리 생략, `(c)` 제약, `(n)` 미해석(제외), `project :x` 는 제외.
 */
export function parseGradleTree(text: string): { roots: DependencyTreeResult["roots"]; nodes: ResolvedArtifact[]; configuration: string | null } {
  const nodes: ResolvedArtifact[] = [];
  const roots: DependencyTreeResult["roots"] = [];
  let configuration: string | null = null;
  const stack: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const rootM = line.match(/^(?:Root project|Project) '([^']+)'/);
    if (rootM) { roots.push({ groupId: "", artifactId: rootM[1], version: "" }); continue; }
    const cfg = line.match(/^(\w+) - /);
    if (cfg && !/^[|+\\ ]/.test(line)) { configuration = cfg[1]; continue; }
    const m = line.match(/^((?:[|+\\]\s{4}|\s{5})*)[+\\]---\s(.+)$/);
    if (!m) continue;
    const depth = m[1].length / 5 + 1;
    const body = m[2];
    if (/^project\s/.test(body)) { stack.length = depth; stack[depth] = body; continue; }
    const coord = body.match(GRADLE_COORD_RE);
    if (!coord) continue;
    const [, groupId, artifactId, declared, resolved, marker] = coord;
    if (marker === "n" || marker === "c") continue;
    const version = resolved ?? declared;
    if (!version) continue;
    stack.length = depth;
    const via = stack.slice(1, depth).filter((s) => s && !/^project\s/.test(s));
    stack[depth] = artifactId;
    nodes.push({ groupId, artifactId, version, scope: configuration, depth, via, ...(resolved && declared && resolved !== declared ? { requestedVersion: declared } : {}) });
  }
  return { roots, nodes, configuration };
}

/** 같은 groupId:artifactId 는 가장 얕은(없으면 먼저 나온) 노드 하나만 남긴다. */
export function dedupeArtifacts(nodes: ResolvedArtifact[]): ResolvedArtifact[] {
  const best = new Map<string, ResolvedArtifact>();
  for (const n of nodes) {
    const k = `${n.groupId}:${n.artifactId}`;
    const cur = best.get(k);
    if (!cur || n.depth < cur.depth) best.set(k, n);
  }
  return [...best.values()].sort((a, b) => a.depth - b.depth || `${a.groupId}:${a.artifactId}`.localeCompare(`${b.groupId}:${b.artifactId}`));
}

/** 트리 해석 명령을 만든다(래퍼 감지는 build-runner 와 동일). Maven 은 outputFile 로 텍스트를 쓰고 Gradle 은 stdout 을 쓴다. */
export function treeCommand(projectDir: string, buildTool: BuildTool, scope: ResolveScope, outputFile: string, platform?: NodeJS.Platform | string): ResolvedCommand {
  const base = resolveCommand(projectDir, buildTool, "compile", { platform });
  if (buildTool === "maven") {
    const args = ["-B", `${MAVEN_DEPENDENCY_PLUGIN}:tree`, "-DoutputType=text", `-DoutputFile=${outputFile}`, "-DappendOutput=true"];
    if (scope === "runtime") args.push("-Dscope=runtime");
    return { ...base, args };
  }
  return { ...base, args: ["dependencies", "--configuration", scope === "runtime" ? "runtimeClasspath" : "testRuntimeClasspath", "-q", "--console=plain"] };
}

export interface ResolveTreeOptions {
  projectDir: string;
  scope?: ResolveScope;
  timeoutMs?: number;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  now?: () => number;
}

/** 빌드 도구로 의존성 트리를 해석한다. 빌드 파일이 없거나 실행이 실패하면 예외 대신 ran/success·error 로 알린다. */
export async function resolveDependencyTree(opts: ResolveTreeOptions): Promise<DependencyTreeResult> {
  const projectDir = path.resolve(opts.projectDir);
  const scope = opts.scope ?? "runtime";
  const buildTool = detectBuildToolAt(projectDir);
  if (!buildTool) return { buildTool: "maven", scope, ran: false, success: false, command: "", roots: [], artifacts: [], nodes: 0, error: "빌드 파일(pom.xml·build.gradle)이 없어 의존성 트리를 해석할 수 없습니다" };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "egov-deptree-"));
  const outputFile = path.join(tmpDir, "tree.txt");
  const cmd = treeCommand(projectDir, buildTool, scope, outputFile, opts.platform);
  const command = [cmd.command, ...cmd.args].join(" ");
  const runner = opts.runner ?? defaultRunner;
  const now = opts.now ?? Date.now;
  let buffer = "";
  const started = now();
  try {
    const r = await runner(cmd, { timeoutMs: opts.timeoutMs ?? 300_000, onData: (c) => (buffer += c) });
    const durationMs = now() - started;
    const text = buildTool === "maven" ? (fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "") : buffer;
    const parsed = buildTool === "maven" ? parseMavenTree(text) : parseGradleTree(text);
    const ok = r.exitCode === 0 && !r.timedOut && parsed.nodes.length > 0;
    const rootKeys = new Set(parsed.roots.map((x) => `${x.groupId}:${x.artifactId}`));
    const artifacts = dedupeArtifacts(parsed.nodes.filter((n) => !rootKeys.has(`${n.groupId}:${n.artifactId}`)));
    const tail = capOutput(buffer, 60);
    return {
      buildTool, scope, ran: true, success: ok, command, durationMs, roots: parsed.roots, artifacts, nodes: parsed.nodes.length,
      ...(ok ? {} : { error: r.timedOut ? `시간 초과(${opts.timeoutMs ?? 300_000}ms)` : r.exitCode !== 0 ? `종료 코드 ${r.exitCode}` : "트리 출력을 해석하지 못했습니다(노드 0)" }),
      logTail: tail.text,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
