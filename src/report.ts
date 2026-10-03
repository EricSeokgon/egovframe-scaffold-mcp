// 프로젝트 리포트 조립 (generate_egovframe_report, v0.37 확장).
//   sections=["components"](v0.16 리포트: 설치 컴포넌트·테이블·가이드·이슈) 와 ["assessment"](v0.37 전환 준비도 평가서)를 골라 한 문서로 묶는다.
//   outputPath 를 주면 프로젝트 안 경로에 새 파일로만 저장한다(기존 파일 거부, transaction, dryRun 이면 내용만).
import * as fs from "node:fs";
import { generateReport } from "./diagnose.js";
import { assessProject, renderAssessmentMarkdown, type AssessmentOptions, type AssessmentResult } from "./assessment.js";
import { resolveOutputPath } from "./sbom.js";
import { withFileTransaction } from "./file-transaction.js";

export type ReportSection = "components" | "assessment";
export const REPORT_SECTIONS: ReportSection[] = ["components", "assessment"];

export interface ReportOptions extends Omit<AssessmentOptions, "projectDir"> {
  projectDir: string;
  /** 기본 ["components"] — 기존 동작 유지 */
  sections?: ReportSection[];
  /** 프로젝트 상대 경로. 주면 Markdown 을 새 파일로 저장(기존 파일은 거부) */
  outputPath?: string;
  /** true 면 outputPath 가 있어도 쓰지 않고 내용만 */
  dryRun?: boolean;
}

export interface ReportResult {
  projectDir: string;
  sections: ReportSection[];
  markdown: string;
  assessment?: AssessmentResult;
  outputPath?: string;
  absolutePath?: string;
  dryRun: boolean;
  written: boolean;
  bytes: number;
  notes: string[];
}

/** 리포트를 조립하고(선택) 저장한다. */
export async function generateProjectReport(opts: ReportOptions): Promise<ReportResult> {
  const sections = opts.sections && opts.sections.length ? [...new Set(opts.sections)] : (["components"] as ReportSection[]);
  for (const s of sections) if (!REPORT_SECTIONS.includes(s)) throw new Error(`알 수 없는 section: ${s} (components | assessment)`);
  const notes: string[] = [];
  const parts: string[] = [];
  let assessment: AssessmentResult | undefined;
  if (sections.includes("components")) parts.push(generateReport({ projectDir: opts.projectDir }));
  if (sections.includes("assessment")) {
    assessment = await assessProject(opts);
    parts.push(renderAssessmentMarkdown(assessment));
  }
  const markdown = `${parts.join("\n\n---\n\n")}\n`;
  const dryRun = opts.dryRun === true;
  const base: ReportResult = { projectDir: opts.projectDir, sections, markdown, ...(assessment ? { assessment } : {}), dryRun, written: false, bytes: Buffer.byteLength(markdown), notes };
  if (!opts.outputPath) return base;

  const { relPath, absolutePath } = resolveOutputPath(opts.projectDir, opts.outputPath);
  if (!/\.(md|markdown|txt)$/i.test(relPath)) throw new Error(`outputPath 는 .md 파일이어야 합니다: ${opts.outputPath}`);
  const exists = fs.existsSync(absolutePath);
  if (exists) throw new Error(`${relPath} 이 이미 있습니다 — 리포트는 새 파일로만 저장합니다(다른 이름을 쓰거나 기존 파일을 옮기세요).`);
  if (dryRun) { notes.push(`dryRun — ${relPath} 에 쓰지 않았습니다(${base.bytes} bytes).`); return { ...base, outputPath: relPath, absolutePath }; }
  await withFileTransaction(opts.projectDir, "리포트 저장", (tx) => { tx.writeFile(relPath, markdown, { mustNotExist: true }); });
  return { ...base, outputPath: relPath, absolutePath, written: true };
}
