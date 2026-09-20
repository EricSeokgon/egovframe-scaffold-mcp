// 설치 컴포넌트 3-way 업그레이드 (upgrade_egovframe_project).
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { withFileTransaction } from "./file-transaction.js";
import { sha256 } from "./shared.js";
import { loadCatalog } from "./catalog.js";
import { MANIFEST_FILE, readManifest } from "./manifest.js";
import { downloadComponentsZip, resolveTrackedFile } from "./components.js";

export type UpgradeClass = "unchanged" | "update" | "conflict" | "user-modified" | "added" | "removed";

/** 순수 판정: 기준선(설치시 hash/srcHash)·현재 디스크·upstream 신규 해시로 분류. (오프라인 테스트 대상) */
export function classifyUpgrade(x: {
  baselineHash?: string; baselineSrcHash?: string; currentHash?: string; upstreamHash?: string;
}): UpgradeClass {
  const { baselineHash, baselineSrcHash, currentHash, upstreamHash } = x;
  if (upstreamHash === undefined) return "removed";
  if (currentHash === undefined) return "added";
  if (baselineHash === undefined) return currentHash === upstreamHash ? "unchanged" : "conflict";
  const userModified = currentHash !== baselineHash;
  const upstreamChanged = upstreamHash !== baselineSrcHash;
  if (!userModified && !upstreamChanged) return "unchanged";
  if (!userModified && upstreamChanged) return "update";
  if (userModified && !upstreamChanged) return "user-modified";
  return "conflict";
}

export interface UpgradeItem { componentId: string; relPath: string; cls: UpgradeClass; }

export interface UpgradeResult {
  projectDir: string; dryRun: boolean; force: boolean;
  summary: Record<UpgradeClass, number>;
  items: UpgradeItem[];
  backupDir?: string;
  applied?: { updated: number; added: number; forced: number };
}

export interface UpgradeOptions {
  projectDir: string;
  components?: string[];
  dryRun?: boolean;
  force?: boolean;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-files" | "after-manifest";
  /** 검증된 upstream zip을 대체하는 오프라인 테스트 전용 입력. MCP 스키마에는 노출하지 않는다. */
  archiveData?: Buffer;
}

export async function upgradeProject(opts: UpgradeOptions): Promise<UpgradeResult> {
  const projectDir = path.resolve(opts.projectDir);
  const dryRun = opts.dryRun !== false;
  const force = opts.force === true;
  const manifest = readManifest(projectDir);
  if (!manifest)
    throw new Error(`매니페스트(.egovframe-components.json)가 없습니다: ${projectDir} — 이 도구로 설치된 프로젝트만 업그레이드할 수 있습니다.`);

  const targetIds = opts.components && opts.components.length ? opts.components : Object.keys(manifest.components);
  const unknown = targetIds.filter((id) => !manifest.components[id]);
  if (unknown.length)
    throw new Error(`매니페스트에 없는 컴포넌트: ${unknown.join(", ")} — 설치됨: ${Object.keys(manifest.components).join(", ") || "(없음)"}`);

  const catalog = loadCatalog();
  const byId = new Map(catalog.components.map((c) => [c.id, c]));
  const zip = opts.archiveData ? new AdmZip(opts.archiveData) : (await downloadComponentsZip(manifest.source)).zip;
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0)
    throw new Error("upstream 공통컴포넌트 archive에 파일이 없습니다");
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);

  const items: UpgradeItem[] = [];
  const dataFor = new Map<string, Buffer>();
  const currentHashFor = new Map<string, string | undefined>();
  const realProjectDir = fs.realpathSync(projectDir);
  for (const id of targetIds) {
    const c = byId.get(id);
    const entry = manifest.components[id];
    const upstream = new Map<string, Buffer>();
    if (c)
      for (const e of entries) {
        const r = rel(e.entryName);
        if (r && c.pathPrefixes.some((p) => r.startsWith(p))) upstream.set(r, e.getData());
      }
    const relPaths = new Set<string>([...upstream.keys(), ...entry.files]);
    for (const r of relPaths) {
      const upData = upstream.get(r);
      const upstreamHash = upData ? sha256(upData) : undefined;
      const abs = resolveTrackedFile(projectDir, realProjectDir, r);
      const currentHash = fs.existsSync(abs) ? sha256(fs.readFileSync(abs)) : undefined;
      currentHashFor.set(r, currentHash);
      const base = entry.hashes?.[r];
      const cls = classifyUpgrade({ baselineHash: base?.hash, baselineSrcHash: base?.srcHash, currentHash, upstreamHash });
      items.push({ componentId: id, relPath: r, cls });
      if (upData && (cls === "update" || cls === "added" || cls === "conflict")) dataFor.set(r, upData);
    }
  }

  const summary: Record<UpgradeClass, number> = { unchanged: 0, update: 0, conflict: 0, "user-modified": 0, added: 0, removed: 0 };
  for (const it of items) summary[it.cls]++;

  if (dryRun) return { projectDir, dryRun: true, force, summary, items };

  const hardConflicts = items.filter((i) => i.cls === "conflict");
  if (hardConflicts.length && !force)
    throw new Error(`충돌 ${hardConflicts.length}건(사용자 수정 + upstream 변경)으로 중단합니다. dryRun으로 확인 후 force=true로 강제하거나 해당 파일을 정리하세요. 아무것도 쓰지 않았습니다.`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRelDir = path.join("upgrade-backup", `${ts}-${randomUUID()}`);
  let updated = 0, added = 0, forced = 0;
  const applicable = items.filter((item) =>
    item.cls === "update" || item.cls === "added" || (item.cls === "conflict" && force));
  const needsBackup = applicable.some((item) => item.cls === "update" || item.cls === "conflict");

  await withFileTransaction(projectDir, "공통컴포넌트 업그레이드", (transaction) => {
    const currentDataFor = new Map<string, Buffer | null>();
    for (const item of applicable) {
      const current = transaction.readFile(item.relPath);
      const actualHash = current !== null ? sha256(current) : undefined;
      if (actualHash !== currentHashFor.get(item.relPath))
        throw new Error(`검증 이후 대상 파일이 변경되어 업그레이드를 중단합니다: ${item.relPath}`);
      currentDataFor.set(item.relPath, current);
      if (needsBackup && (item.cls === "update" || item.cls === "conflict")) {
        const backupRelPath = path.join(backupRelDir, item.relPath);
        if (transaction.readFile(backupRelPath) !== null)
          throw new Error(`업그레이드 백업 대상이 이미 존재합니다: ${backupRelPath}`);
      }
    }

    for (const item of applicable) {
      const upData = dataFor.get(item.relPath);
      if (!upData) throw new Error(`upstream 파일 데이터가 없습니다: ${item.relPath}`);
      const current = currentDataFor.get(item.relPath) ?? null;
      if ((item.cls === "update" || item.cls === "conflict") && current)
        transaction.writeFile(path.join(backupRelDir, item.relPath), current, { mustNotExist: true });
      transaction.writeFile(item.relPath, upData, { mustNotExist: item.cls === "added" });
      if (item.cls === "update") updated++;
      else if (item.cls === "added") added++;
      else forced++;
    }

    if (needsBackup) {
      const plan = {
        createdAt: new Date().toISOString(),
        components: targetIds,
        summary,
        files: applicable.map((item) => ({
          componentId: item.componentId,
          relPath: item.relPath,
          classification: item.cls,
          previousHash: currentHashFor.get(item.relPath),
          upstreamHash: sha256(dataFor.get(item.relPath)!),
        })),
      };
      transaction.writeFile(
        path.join(backupRelDir, "upgrade-plan.json"),
        JSON.stringify(plan, null, 2) + "\n",
        { mustNotExist: true },
      );
    }

    if (opts.faultInjection === "after-files")
      throw new Error("upgrade fault injection: after-files");

    for (const id of targetIds) {
      const entry = manifest.components[id];
      entry.hashes = entry.hashes ?? {};
      for (const item of items) {
        if (item.componentId !== id) continue;
        const upData = dataFor.get(item.relPath);
        if (upData && (item.cls === "update" || item.cls === "added" || (item.cls === "conflict" && force))) {
          const hash = sha256(upData);
          entry.hashes[item.relPath] = { hash, srcHash: hash };
          if (!entry.files.includes(item.relPath)) entry.files.push(item.relPath);
        }
      }
    }
    manifest.schemaVersion = 3;
    transaction.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

    if (opts.faultInjection === "after-manifest")
      throw new Error("upgrade fault injection: after-manifest");
  });

  return {
    projectDir,
    dryRun: false,
    force,
    summary,
    items,
    backupDir: needsBackup ? path.join(projectDir, backupRelDir) : undefined,
    applied: { updated, added, forced },
  };
}
