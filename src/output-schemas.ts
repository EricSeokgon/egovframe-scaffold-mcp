// 구조화 출력 스키마 (v0.32.0): format=json 을 제공하던 도구 5종(v0.36 SBOM·v0.37 리포트 추가로 7종)의 결과를 MCP outputSchema 로 선언한다.
// 스키마는 src/*.ts 의 결과 인터페이스를 따르며, 테스트가 실제 결과를 이 스키마로 검증해 어긋남을 잡는다.
// 알 수 없는 키는 허용(passthrough)해 결과 인터페이스에 필드가 늘어도 깨지지 않게 하고, 핵심 필드만 엄격히 본다.
import { z } from "zod";

const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();

export const DiagnoseOutput = loose({
  projectDir: z.string(),
  isEgovProject: z.boolean(),
  buildSystem: z.enum(["maven", "gradle", "unknown"]),
  egovVersion: z.string().nullable(),
  database: z.string().nullable(),
  detectedComponents: z.array(loose({ id: z.string(), name: z.string(), matchedPrefix: z.string() })),
  aiLayer: z.boolean(),
  hasManifest: z.boolean(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
});

export const ValidateOutput = loose({
  projectDir: z.string(),
  ok: z.boolean(),
  manifestFound: z.boolean(),
  components: z.array(loose({ id: z.string(), files: z.number().int(), missing: z.number().int(), missingSamples: z.array(z.string()) })),
  dbType: z.string().nullable(),
  dbScriptDirs: z.array(z.string()),
  aiChecks: z.array(loose({ componentId: z.string(), file: z.string(), exists: z.boolean(), note: z.string() })),
  warnings: z.array(z.string()),
});

const MigrationItem = loose({
  file: z.string(),
  line: z.number().int(),
  kind: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  action: z.enum(["auto", "manual"]),
  reason: z.string(),
});
const MigrateSummary = loose({ auto: z.number().int(), manual: z.number().int(), files: z.number().int(), byKind: z.record(z.number().int()) });
export const MigrateOutput = loose({
  projectDir: z.string(),
  target: z.literal("5.x"),
  rules: loose({ toTag: z.string(), surveyedAt: z.string(), runtimeVersion: z.string() }),
  buildSystem: z.enum(["maven", "gradle", "unknown"]),
  rteVersion: z.string().nullable(),
  sourceEra: z.enum(["3.x", "4.x", "5.x", "unknown"]),
  filesScanned: z.number().int(),
  items: z.array(MigrationItem),
  summary: MigrateSummary,
  notes: z.array(z.string()),
  // 2단계(apply)·3단계(verify) 전용 — 진단만 할 때는 없음
  mode: z.enum(["apply", "verify"]).optional(),
  build: loose({ ran: z.boolean(), success: z.boolean().nullable(), errors: z.number().int() }).optional(),
  links: z.array(loose({ error: loose({ file: z.string(), line: z.number().int(), message: z.string() }), itemIndex: z.number().int().nullable(), how: z.enum(["same-file-symbol", "same-file-line", "rules-symbol", "unlinked"]) })).optional(),
  worklist: z.array(loose({ index: z.number().int(), item: MigrationItem, errors: z.number().int() })).optional(),
  unlinked: z.array(loose({ file: z.string(), line: z.number().int(), message: z.string() })).optional(),
  dryRun: z.boolean().optional(),
  applied: loose({ items: z.number().int(), edits: z.number().int(), files: z.number().int() }).optional(),
  skippedManual: z.number().int().optional(),
  files: z.array(loose({ file: z.string(), items: z.number().int(), edits: z.number().int() })).optional(),
  conflicts: z.array(z.string()).optional(),
  backupDir: z.string().optional(),
  planPath: z.string().optional(),
  remaining: MigrateSummary.optional(),
});

const DependencyStatus = z.enum(["ok", "outdated", "managed", "legacy", "replace", "vendor", "unknown", "unversioned"]);
const DependencyBasis = z.enum(["parent", "family", "boot-bom", "rte-transitive", "migration-rules"]);
export const DependenciesOutput = loose({
  projectDir: z.string(),
  buildSystem: z.enum(["maven", "gradle", "unknown"]),
  offline: z.boolean(),
  baseline: loose({ surveyedAt: z.string(), rte: z.string(), springFramework: z.string().nullable(), springBoot: z.string().nullable(), java: z.number().int(), bootBom: z.number().int().optional(), rteTransitive: z.number().int().optional() }),
  parent: loose({ groupId: z.string().nullable(), artifactId: z.string().nullable(), version: z.string().nullable(), kind: z.enum(["web", "boot", "other", "none"]), status: z.enum(["ok", "outdated", "n/a"]) }),
  java: loose({ value: z.string().nullable(), status: z.enum(["ok", "outdated", "unknown"]) }),
  findings: z.array(loose({ file: z.string(), line: z.number().int(), groupId: z.string(), artifactId: z.string(), version: z.string().nullable(), resolvedVersion: z.string().nullable(), scope: z.string().nullable(), status: DependencyStatus, baseline: z.string().nullable(), basis: DependencyBasis.nullable(), origin: z.enum(["declared", "transitive"]), via: z.array(z.string()).optional(), depth: z.number().int().optional(), treeVersion: z.string().optional() })),
  summary: z.record(z.number().int()),
  checks: z.array(loose({ id: z.string(), title: z.string(), status: z.enum(["ok", "missing", "n/a"]), evidence: z.array(loose({ file: z.string(), line: z.number().int(), text: z.string() })), hint: z.string() })),
  vulnerabilities: z.array(loose({ dependency: z.string(), version: z.string(), ids: z.array(z.string()) })).optional(),
  resolution: loose({ ran: z.boolean(), success: z.boolean(), scope: z.enum(["runtime", "all"]), command: z.string(), artifacts: z.number().int(), direct: z.number().int(), transitive: z.number().int(), differs: z.array(loose({ groupId: z.string(), artifactId: z.string(), declared: z.string(), resolved: z.string() })), summary: z.record(z.number().int()), error: z.string().optional() }).optional(),
  osvError: z.string().optional(),
  notes: z.array(z.string()),
});

const NetworkKind = z.enum(["ok", "dns", "timeout", "tls", "proxy-auth", "refused", "reset", "unreachable", "http", "other"]);
export const NetworkOutput = loose({
  node: z.string(),
  platform: z.string(),
  envProxySupported: z.boolean(),
  env: loose({ httpsProxy: z.string().nullable(), httpProxy: z.string().nullable(), noProxy: z.string().nullable(), nodeUseEnvProxy: z.string().nullable(), nodeOptions: z.string().nullable(), nodeExtraCaCerts: z.string().nullable(), nodeTlsRejectUnauthorized: z.string().nullable() }),
  hosts: z.array(loose({
    host: z.string(), purpose: z.string(), tools: z.array(z.string()),
    dns: loose({ ok: z.boolean(), ms: z.number(), addresses: z.array(loose({ address: z.string(), family: z.number().int() })), error: z.string().nullable() }),
    http: loose({ kind: NetworkKind, status: z.number().int().nullable(), ms: z.number(), error: z.string().nullable() }),
    ok: z.boolean(),
  })),
  summary: loose({ ok: z.number().int(), failed: z.number().int(), byKind: z.record(z.number().int()) }),
  prescriptions: z.array(loose({ id: z.string(), title: z.string(), commands: z.array(loose({ shell: z.enum(["bash", "cmd", "powershell"]), command: z.string() })), reason: z.string() })),
  notes: z.array(z.string()),
});

/** 도구 이름 → outputSchema (테스트·문서용 색인) */
export const SbomOutput = loose({
  projectDir: z.string(),
  buildTool: z.enum(["maven", "gradle"]),
  format: z.enum(["cyclonedx-json"]),
  specVersion: z.string(),
  outputPath: z.string(),
  absolutePath: z.string(),
  dryRun: z.boolean(),
  written: z.boolean(),
  overwritten: z.boolean(),
  command: z.string(),
  generator: z.enum(["cyclonedx-maven-plugin", "egovframe-scaffold-mcp"]),
  durationMs: z.number().optional(),
  components: z.number().int(),
  direct: z.number().int(),
  transitive: z.number().int(),
  statuses: z.record(z.number().int()),
  vulnerabilities: z.number().int(),
  osvError: z.string().optional(),
  bytes: z.number().int(),
  notes: z.array(z.string()),
  logTail: z.string().optional(),
});

// v0.37: generate_egovframe_report — markdown 은 text 로만 돌려주고 structuredContent 에서는 뺀다(스키마에 없음).
const GradeResult = loose({
  grade: z.enum(["A", "B", "C", "D"]),
  score: z.number().int(),
  max: z.number().int(),
  factors: z.array(loose({ id: z.string(), label: z.string(), value: z.number(), points: z.number().int(), band: z.string(), note: z.string().optional() })),
  scale: z.string(),
  caveats: z.array(z.string()),
});
export const AssessmentOutput = loose({
  projectDir: z.string(),
  generatedAt: z.string(),
  tool: loose({ name: z.string(), version: z.string(), rulesTag: z.string(), rulesSurveyedAt: z.string(), baselineSurveyedAt: z.string(), targetRuntime: z.string() }),
  overview: loose({
    buildSystem: z.enum(["maven", "gradle", "unknown"]), isEgovProject: z.boolean(), rteVersion: z.string().nullable(), sourceEra: z.enum(["3.x", "4.x", "5.x", "unknown"]),
    parent: loose({ groupId: z.string().nullable(), artifactId: z.string().nullable(), version: z.string().nullable(), kind: z.enum(["web", "boot", "other", "none"]), status: z.enum(["ok", "outdated", "n/a"]) }),
    java: loose({ value: z.string().nullable(), status: z.enum(["ok", "outdated", "unknown"]) }),
    database: z.string().nullable(), components: loose({ count: z.number().int(), ids: z.array(z.string()) }), aiLayer: z.boolean(), hasManifest: z.boolean(), filesScanned: z.number().int(),
  }),
  migration: loose({
    items: z.number().int(), auto: z.number().int(), manual: z.number().int(), files: z.number().int(), byKind: z.record(z.number().int()), manualByKind: z.record(z.number().int()),
    reassemble: z.array(z.string()), removedApiRefs: z.number().int(),
    manualTop: z.array(loose({ kind: z.string(), from: z.string(), to: z.string().nullable(), count: z.number().int(), files: z.number().int(), example: z.string(), reason: z.string() })),
    manualTotalGroups: z.number().int(), notes: z.array(z.string()),
  }),
  dependencies: loose({
    offline: z.boolean(), findings: z.number().int(), declared: z.number().int(), transitive: z.number().int(), summary: z.record(z.number().int()),
    actions: z.array(loose({ groupId: z.string(), artifactId: z.string(), version: z.string().nullable(), status: DependencyStatus, baseline: z.string().nullable(), basis: z.string().nullable(), origin: z.enum(["declared", "transitive"]), file: z.string(), line: z.number().int(), action: z.string() })),
    unknown: z.array(z.string()), vendor: z.array(z.string()),
    resolution: loose({ ran: z.boolean(), success: z.boolean(), scope: z.enum(["runtime", "all"]), artifacts: z.number().int(), direct: z.number().int(), transitive: z.number().int(), differs: z.number().int(), error: z.string().optional() }).optional(),
    vulnerabilities: loose({ queried: z.boolean(), dependencies: z.number().int(), ids: z.number().int(), items: z.array(loose({ dependency: z.string(), version: z.string(), ids: z.array(z.string()) })) }),
    osvError: z.string().optional(), notes: z.array(z.string()),
  }),
  security: loose({ ok: z.number().int(), missing: z.number().int(), na: z.number().int(), checks: z.array(loose({ id: z.string(), title: z.string(), status: z.enum(["ok", "missing", "n/a"]), evidence: z.array(loose({ file: z.string(), line: z.number().int(), text: z.string() })), hint: z.string() })) }),
  sbom: loose({ present: z.boolean(), path: z.string(), components: z.number().int().optional(), specVersion: z.string().optional(), timestamp: z.string().optional(), vulnerabilities: z.number().int().optional(), note: z.string() }),
  grades: loose({ migration: GradeResult, supplyChain: GradeResult }),
  notes: z.array(z.string()),
});
export const ReportOutput = loose({
  projectDir: z.string(),
  sections: z.array(z.enum(["components", "assessment"])),
  assessment: AssessmentOutput.optional(),
  outputPath: z.string().optional(),
  absolutePath: z.string().optional(),
  dryRun: z.boolean(),
  written: z.boolean(),
  bytes: z.number().int(),
  notes: z.array(z.string()),
});

// v0.38: reassemble_egovframe_components
const ReassembleStateEnum = z.enum(["identical", "unchanged", "user-modified", "unverified", "new", "removed-unchanged", "removed-modified", "user-added"]);
export const ReassembleOutput = loose({
  projectDir: z.string(),
  dryRun: z.boolean(),
  target: loose({ tag: z.string(), commit: z.string().nullable() }),
  sourceEra: z.enum(["3.x", "4.x", "5.x", "unknown"]),
  origin: loose({ tag: z.string().nullable(), mode: z.enum(["auto", "fixed"]), candidates: z.array(loose({ tag: z.string(), matched: z.number().int(), total: z.number().int(), ratio: z.number() })) }),
  components: z.array(loose({ id: z.string(), name: z.string(), files: z.number().int(), summary: z.record(z.number().int()) })),
  summary: z.record(z.number().int()),
  actions: z.record(z.number().int()),
  files: z.array(loose({ componentId: z.string(), path: z.string(), asset: z.string(), state: ReassembleStateEnum, action: z.enum(["keep", "replace", "add", "delete", "keep-reference"]), patch: z.string().optional() })),
  worklist: z.array(loose({ componentId: z.string(), path: z.string(), kind: z.enum(["reapply-patch", "removed-in-5x", "review-config", "unverified-replaced"]), detail: z.string(), patch: z.string().optional(), errors: z.number().int().optional() })),
  sql: z.array(z.string()),
  manifestUpdated: z.boolean(),
  backupDir: z.string().optional(),
  planPath: z.string().optional(),
  verify: loose({ ran: z.boolean(), success: z.boolean().nullable(), command: z.string().optional(), durationMs: z.number().optional(), errors: z.number().int(), inReassembled: z.number().int(), reason: z.string().optional() }).optional(),
  notes: z.array(z.string()),
});

export const OUTPUT_SCHEMAS = {
  diagnose_egovframe_project: DiagnoseOutput,
  validate_egovframe_project: ValidateOutput,
  migrate_egovframe_project: MigrateOutput,
  check_egovframe_dependencies: DependenciesOutput,
  diagnose_egovframe_network: NetworkOutput,
  generate_egovframe_sbom: SbomOutput,
  generate_egovframe_report: ReportOutput,
  reassemble_egovframe_components: ReassembleOutput,
} as const;
export type StructuredToolName = keyof typeof OUTPUT_SCHEMAS;
