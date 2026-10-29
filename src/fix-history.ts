// 자동 조치 내역 (v1.9) — fix_egovframe_dependencies·fix_egovframe_secure_coding 가 적용 때 남긴 계획 파일
//   (migration-backup/<시각>-deps-fix-…/deps-fix-plan.json · <시각>-secure-fix-…/secure-fix-plan.json)을 읽어
//   평가서 3절과 납품 패키지에 "조치 내역(전·후)"으로 싣는다. 파일이 없거나 깨졌으면 건너뛴다(읽기 전용).
import * as fs from "node:fs";
import * as path from "node:path";

export interface FixHistoryEntry {
  tool: "fix_egovframe_dependencies" | "fix_egovframe_secure_coding";
  createdAt: string;
  /** 프로젝트 상대 계획 파일 경로 */
  planPath: string;
  /** 의존성: 조치·수동 건수, parent 목표, 전·후 권고 수 */
  dependencies?: { actions: number; manual: number; target: string | null; before: number | null; after: number | null; byKind: Record<string, number> };
  /** 보안약점: 고친·수동 건수 */
  secureCoding?: { fixed: number; manual: number; files: number };
}

const PLAN_FILES: Record<string, FixHistoryEntry["tool"]> = { "deps-fix-plan.json": "fix_egovframe_dependencies", "secure-fix-plan.json": "fix_egovframe_secure_coding" };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? v as Record<string, unknown> : {});

/** 프로젝트의 조치 내역(오래된 것부터) */
export function readFixHistory(projectDir: string): FixHistoryEntry[] {
  const base = path.join(projectDir, "migration-backup");
  let dirs: string[];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && /-(deps|secure)-fix-/.test(d.name)).map((d) => d.name); } catch { return []; }
  const out: FixHistoryEntry[] = [];
  for (const d of dirs) {
    for (const [file, tool] of Object.entries(PLAN_FILES)) {
      const abs = path.join(base, d, file);
      let j: Record<string, unknown>;
      try { j = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>; } catch { continue; }
      if (j.tool !== tool) continue;
      const sm = rec(j.summary);
      const e: FixHistoryEntry = { tool, createdAt: typeof j.createdAt === "string" ? j.createdAt : "", planPath: path.posix.join("migration-backup", d, file) };
      if (tool === "fix_egovframe_dependencies") {
        const v = j.vulnerabilities ? rec(j.vulnerabilities) : null;
        e.dependencies = { actions: num(sm.actions), manual: num(sm.manual), target: typeof j.target === "string" ? j.target : null, before: v ? num(rec(v.before).ids) : null, after: v ? num(rec(v.after).ids) : null, byKind: Object.fromEntries(Object.entries(rec(sm.byKind)).map(([k, x]) => [k, num(x)])) };
      } else e.secureCoding = { fixed: num(sm.fixed), manual: num(sm.manual), files: num(sm.files) };
      out.push(e);
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.planPath.localeCompare(b.planPath));
}
