// 사용자 수정 자동 재적용 (v1.12) — 재조립·업그레이드가 남기던 패치를 3-way 병합으로 다시 붙인다.
//   원본(설치 때 기준 태그의 파일) · 현재(사용자 수정본) · 목표(새 태그의 파일)를 git merge-file 로 합쳐
//   충돌이 없는 파일만 결과로 쓰고, 충돌은 파일에 표식(<<<<<<<)을 남기지 않고 작업 목록으로 돌린다.
//   바이트를 보존한다(EUC-KR 소스·CRLF 그대로) — 임시 파일로 git 을 부르고 결과를 Buffer 로 읽는다.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { L } from "./lang.js";

export type MergeStatus =
  | "clean"      // 충돌 없이 합쳐짐(사용자 변경 + upstream 변경)
  | "absorbed"   // 합친 결과가 목표와 같음 — upstream 이 사용자 변경을 이미 담고 있음
  | "conflict"   // 같은 곳을 양쪽이 고침 — 자동 적용 안 함
  | "binary"     // 이진 파일 — 병합하지 않음
  | "error";     // git 실행 실패
export interface MergeResult { status: MergeStatus; merged?: Buffer; conflicts: number; error?: string }

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

/** git merge-file: 종료 코드가 충돌 hunk 수(0 = 깨끗함, 음수 = 오류). -p 로 결과를 stdout 으로 받는다. */
export async function mergeThreeWay(base: Buffer, current: Buffer, target: Buffer): Promise<MergeResult> {
  if (current.equals(target)) return { status: "absorbed", merged: target, conflicts: 0 };
  if (current.equals(base)) return { status: "clean", merged: target, conflicts: 0 };
  if (base.equals(target)) return { status: "clean", merged: current, conflicts: 0 };
  if (isBinary(base) || isBinary(current) || isBinary(target)) return { status: "binary", conflicts: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egov-merge-"));
  try {
    const b = path.join(tmp, "base"), c = path.join(tmp, "current"), t = path.join(tmp, "target");
    fs.writeFileSync(b, base); fs.writeFileSync(c, current); fs.writeFileSync(t, target);
    const r = await new Promise<{ code: number; out: Buffer; err: string }>((resolve) => {
      execFile("git", ["-c", "core.autocrlf=false", "merge-file", "-p", "-L", "current", "-L", "base", "-L", "target", c, b, t], { cwd: tmp, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number | string }).code as number | undefined) ?? -1 : 0;
        resolve({ code: typeof code === "number" ? code : -1, out: stdout as Buffer, err: (stderr as Buffer).toString("utf8") });
      });
    });
    if (r.code < 0 || r.code > 127) return { status: "error", conflicts: 0, error: r.err.trim() || L("git merge-file 실행 실패", "git merge-file failed") };
    if (r.code > 0) return { status: "conflict", conflicts: r.code };
    return { status: r.out.equals(target) ? "absorbed" : "clean", merged: r.out, conflicts: 0 };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export interface ReapplyEntry {
  path: string;
  componentId: string;
  status: MergeStatus;
  /** 충돌 hunk 수(conflict 일 때) */
  conflicts: number;
  /** verify 뒤 컴파일 오류 때문에 목표본으로 되돌렸으면 true */
  reverted?: boolean;
  errors?: number;
}
export interface ReapplySummary {
  /** 자동으로 합쳐 쓴 파일(clean) */
  reapplied: number;
  /** upstream 이 이미 담고 있어 목표본 그대로 */
  absorbed: number;
  conflicts: number;
  binary: number;
  errors: number;
  /** verify 의 컴파일 오류로 목표본으로 되돌린 파일 */
  reverted: number;
  entries: ReapplyEntry[];
}
export const emptyReapply = (): ReapplySummary => ({ reapplied: 0, absorbed: 0, conflicts: 0, binary: 0, errors: 0, reverted: 0, entries: [] });
export function tallyReapply(s: ReapplySummary): void {
  s.reapplied = s.entries.filter((e) => e.status === "clean" && !e.reverted).length;
  s.absorbed = s.entries.filter((e) => e.status === "absorbed").length;
  s.conflicts = s.entries.filter((e) => e.status === "conflict").length;
  s.binary = s.entries.filter((e) => e.status === "binary").length;
  s.errors = s.entries.filter((e) => e.status === "error").length;
  s.reverted = s.entries.filter((e) => e.reverted).length;
}
export const reapplyLine = (s: ReapplySummary): string => L(
  `사용자 수정 재적용: 자동 ${s.reapplied} · upstream 에 이미 반영 ${s.absorbed} · 충돌 ${s.conflicts}${s.binary ? ` · 이진 ${s.binary}` : ""}${s.reverted ? ` · 컴파일 오류로 되돌림 ${s.reverted}` : ""}${s.errors ? ` · 오류 ${s.errors}` : ""}`,
  `Reapplied user changes: automatic ${s.reapplied} · already upstream ${s.absorbed} · conflicts ${s.conflicts}${s.binary ? ` · binary ${s.binary}` : ""}${s.reverted ? ` · reverted after compile errors ${s.reverted}` : ""}${s.errors ? ` · errors ${s.errors}` : ""}`);
