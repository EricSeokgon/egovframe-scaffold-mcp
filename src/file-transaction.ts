import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

interface FileSnapshot {
  relPath: string;
  target: string;
  existed: boolean;
  backup?: string;
}

export interface TransactionWriteOptions {
  /** true면 기존 파일이 있는 경우 쓰기 전에 거부한다. */
  mustNotExist?: boolean;
}

export interface RollbackFailure {
  path: string;
  error: string;
}

/** rollback 수행 결과의 구조화된 보고. */
export interface RollbackReport {
  /** 되돌리기를 시도한 파일 스냅샷 수 */
  filesAttempted: number;
  /** 백업에서 복원한 기존 파일 수 */
  restoredFiles: number;
  /** 제거한 신규 파일 수 */
  removedNewFiles: number;
  /** 정리한 빈 디렉터리 수 */
  cleanedDirs: number;
  failures: RollbackFailure[];
  /** failures가 없으면 true */
  ok: boolean;
}

/** transaction 실패를 rollback 보고와 함께 전달하는 오류. */
export class TransactionError extends Error {
  readonly label: string;
  readonly reason: string;
  readonly rollback: RollbackReport;

  constructor(kind: string, label: string, reason: string, rollback: RollbackReport) {
    const prose = rollback.ok
      ? "작업 전 상태로 롤백했습니다."
      : `롤백 실패 ${rollback.failures.length}건:\n${rollback.failures.map((f) => `  - ${f.path}: ${f.error}`).join("\n")}`;
    super(`${label} ${kind} 실패: ${reason}\n${prose}\nrollback-report: ${JSON.stringify(rollback)}`);
    this.name = "TransactionError";
    this.label = label;
    this.reason = reason;
    this.rollback = rollback;
  }
}

function isOutside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
}

function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function missingDirectories(directory: string): string[] {
  const missing: string[] = [];
  let current = directory;
  while (!pathEntryExists(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

/**
 * 프로젝트 내부 파일 쓰기를 하나의 롤백 가능한 transaction으로 묶는다.
 *
 * 기존 파일은 같은 파일시스템의 숨김 staging 디렉터리로 먼저 이동하고,
 * 신규 내용은 대상 디렉터리의 임시 파일을 거쳐 rename한다. commit 전 오류가
 * 발생하면 새 파일을 제거하고 기존 파일을 역순으로 복원한다.
 */
export class ProjectFileTransaction {
  readonly rootDir: string;
  readonly stagingDir: string;
  private readonly realRootDir: string;
  private readonly snapshots = new Map<string, FileSnapshot>();
  private readonly createdDirs = new Set<string>();
  private active = true;

  constructor(rootDir: string, label: string) {
    this.rootDir = path.resolve(rootDir);
    if (!fs.existsSync(this.rootDir) || !fs.statSync(this.rootDir).isDirectory())
      throw new Error(`transaction root가 디렉터리가 아닙니다: ${this.rootDir}`);
    this.realRootDir = fs.realpathSync(this.rootDir);
    const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "write";
    this.stagingDir = fs.mkdtempSync(path.join(this.rootDir, `.egovframe-write-txn-${safeLabel}-`));
  }

  private assertActive(): void {
    if (!this.active) throw new Error("이미 종료된 file transaction입니다");
  }

  private resolveTarget(relPath: string): string {
    if (!relPath || path.isAbsolute(relPath))
      throw new Error(`transaction 절대·빈 경로를 거부합니다: ${relPath}`);
    const target = path.resolve(this.rootDir, relPath);
    if (isOutside(this.rootDir, target) || target === this.rootDir)
      throw new Error(`transaction 프로젝트 밖 경로를 거부합니다: ${relPath}`);
    if (target === this.stagingDir || !isOutside(this.stagingDir, target))
      throw new Error(`transaction staging 내부 경로를 거부합니다: ${relPath}`);

    let existingParent = path.dirname(target);
    while (!fs.existsSync(existingParent)) {
      const parent = path.dirname(existingParent);
      if (parent === existingParent) break;
      existingParent = parent;
    }
    const realParent = fs.realpathSync(existingParent);
    const realCandidate = path.resolve(realParent, path.relative(existingParent, target));
    if (isOutside(this.realRootDir, realCandidate))
      throw new Error(`transaction 경로가 symlink를 통해 프로젝트 밖을 가리킵니다: ${relPath}`);

    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile())
        throw new Error(`transaction 대상이 일반 파일이 아닙니다: ${relPath}`);
      if (isOutside(this.realRootDir, fs.realpathSync(target)))
        throw new Error(`transaction 파일이 프로젝트 밖을 가리킵니다: ${relPath}`);
    }
    return target;
  }

  private ensureParentDirectory(directory: string): void {
    const missing: string[] = [];
    let current = directory;
    while (current !== this.rootDir && !fs.existsSync(current)) {
      missing.push(current);
      current = path.dirname(current);
    }
    fs.mkdirSync(directory, { recursive: true });
    for (const created of missing) this.createdDirs.add(created);
  }

  /** 프로젝트 경계를 검증한 뒤 현재 파일 내용을 읽는다. 없으면 null을 반환한다. */
  readFile(relPath: string): Buffer | null {
    this.assertActive();
    const target = this.resolveTarget(relPath);
    return fs.existsSync(target) ? fs.readFileSync(target) : null;
  }

  writeFile(relPath: string, data: string | Buffer, options: TransactionWriteOptions = {}): void {
    this.assertActive();
    const target = this.resolveTarget(relPath);
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    let snapshot = this.snapshots.get(key);

    if (!snapshot) {
      const existed = fs.existsSync(target);
      if (existed && options.mustNotExist)
        throw new Error(`transaction 대상 파일이 이미 존재합니다: ${relPath}`);
      snapshot = { relPath, target, existed };
      if (existed) {
        const backup = path.join(this.stagingDir, "originals", relPath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        snapshot.backup = backup;
      }
      this.snapshots.set(key, snapshot);
    } else if (options.mustNotExist) {
      throw new Error(`transaction 대상 파일을 이미 기록했습니다: ${relPath}`);
    }

    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    this.ensureParentDirectory(path.dirname(target));
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.egovframe-txn-${randomUUID()}`);
    try {
      fs.writeFileSync(temporary, data, { flag: "wx" });
      fs.renameSync(temporary, target);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* 원래 오류 보존 */ }
      throw error;
    }
  }

  commit(): void {
    this.assertActive();
    fs.rmSync(this.stagingDir, { recursive: true, force: true });
    this.active = false;
  }

  rollback(): RollbackReport {
    if (!this.active)
      return { filesAttempted: 0, restoredFiles: 0, removedNewFiles: 0, cleanedDirs: 0, failures: [], ok: true };
    const failures: RollbackFailure[] = [];
    let restoredFiles = 0;
    let removedNewFiles = 0;
    let cleanedDirs = 0;
    const snapshots = [...this.snapshots.values()].reverse();
    for (const snapshot of snapshots) {
      try {
        fs.rmSync(snapshot.target, { force: true });
        if (snapshot.existed && snapshot.backup && fs.existsSync(snapshot.backup)) {
          this.ensureParentDirectory(path.dirname(snapshot.target));
          fs.renameSync(snapshot.backup, snapshot.target);
          restoredFiles += 1;
        } else if (!snapshot.existed) {
          removedNewFiles += 1;
        }
      } catch (error) {
        failures.push({ path: snapshot.relPath, error: String(error) });
      }
    }
    for (const directory of [...this.createdDirs].sort((left, right) => right.length - left.length)) {
      try {
        if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
          fs.rmdirSync(directory);
          cleanedDirs += 1;
        }
      } catch (error) {
        failures.push({ path: path.relative(this.rootDir, directory), error: String(error) });
      }
    }
    try { fs.rmSync(this.stagingDir, { recursive: true, force: true }); }
    catch (error) { failures.push({ path: "staging", error: String(error) }); }
    this.active = false;
    return {
      filesAttempted: snapshots.length,
      restoredFiles,
      removedNewFiles,
      cleanedDirs,
      failures,
      ok: failures.length === 0,
    };
  }
}

export async function withFileTransaction<T>(
  rootDir: string,
  label: string,
  action: (transaction: ProjectFileTransaction) => T | Promise<T>,
): Promise<T> {
  const transaction = new ProjectFileTransaction(rootDir, label);
  try {
    const result = await action(transaction);
    transaction.commit();
    return result;
  } catch (error) {
    const report = transaction.rollback();
    const reason = error instanceof Error ? error.message : String(error);
    throw new TransactionError("transaction", label, reason, report);
  }
}

/**
 * 존재하지 않는 최종 디렉터리를 sibling staging에서 완성한 뒤 atomic rename한다.
 * 실패하면 staging과 transaction이 만든 빈 상위 디렉터리만 제거한다.
 */
export async function withDirectoryTransaction<T>(
  parentDir: string,
  finalName: string,
  label: string,
  action: (stagingDir: string) => T | Promise<T>,
): Promise<T> {
  if (!finalName || path.isAbsolute(finalName) || path.basename(finalName) !== finalName || finalName === "." || finalName === "..")
    throw new Error(`directory transaction의 최종 이름이 안전하지 않습니다: ${finalName}`);

  const parent = path.resolve(parentDir);
  const finalPath = path.join(parent, finalName);
  if (pathEntryExists(parent) && !fs.statSync(parent).isDirectory())
    throw new Error(`directory transaction 상위 경로가 디렉터리가 아닙니다: ${parent}`);
  if (pathEntryExists(finalPath))
    throw new Error(`directory transaction 대상이 이미 존재합니다: ${finalPath}`);

  const createdParents = missingDirectories(parent);
  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "create";
  let stagingDir: string | undefined;
  try {
    fs.mkdirSync(parent, { recursive: true });
    stagingDir = fs.mkdtempSync(path.join(parent, `.egovframe-dir-txn-${safeLabel}-`));
    const result = await action(stagingDir);
    if (pathEntryExists(finalPath))
      throw new Error(`commit 직전 대상 디렉터리가 생성되어 덮어쓰기를 거부합니다: ${finalPath}`);
    fs.renameSync(stagingDir, finalPath);
    stagingDir = undefined;
    return result;
  } catch (error) {
    const failures: RollbackFailure[] = [];
    let cleanedDirs = 0;
    if (stagingDir) {
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); }
      catch (rollbackError) { failures.push({ path: "staging", error: String(rollbackError) }); }
    }
    for (const directory of createdParents) {
      try {
        if (pathEntryExists(directory) && fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length === 0) {
          fs.rmdirSync(directory);
          cleanedDirs += 1;
        }
      } catch (rollbackError) {
        failures.push({ path: directory, error: String(rollbackError) });
      }
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new TransactionError("directory transaction", label, reason, {
      filesAttempted: 0,
      restoredFiles: 0,
      removedNewFiles: 0,
      cleanedDirs,
      failures,
      ok: failures.length === 0,
    });
  }
}
