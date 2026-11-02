// 설치 컴포넌트 3-way 업그레이드 (upgrade_egovframe_project).
import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { withFileTransaction } from "./file-transaction.js";
import { sha256 } from "./shared.js";
import { COMPONENT_ASSET_FIELDS, loadCatalog } from "./catalog.js";
import { MANIFEST_FILE, readManifest } from "./manifest.js";
import { downloadComponentsZip, resolveTrackedFile } from "./components.js";
import { emptyReapply, mergeThreeWay, tallyReapply, type ReapplySummary } from "./reapply.js";
import { detectBuildToolAt, runBuild, type Runner } from "./build-runner.js";

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

export interface UpgradeItem { componentId: string; relPath: string; cls: UpgradeClass; /** v1.12: reapply 결과 */ reapply?: "clean" | "absorbed" | "conflict" | "binary" | "error"; }

export interface UpgradeResult {
  projectDir: string; dryRun: boolean; force: boolean;
  summary: Record<UpgradeClass, number>;
  items: UpgradeItem[];
  backupDir?: string;
  applied?: { updated: number; added: number; forced: number; /** v1.12: 3-way 로 합쳐 쓴 파일 */ reapplied?: number };
  /** v1.12: 목표(카탈로그 고정 태그)와 기준(매니페스트의 설치 태그) */
  target?: { tag: string | null; commit: string | null };
  base?: { tag: string | null; commit: string | null };
  reapply?: ReapplySummary;
  verify?: { ran: boolean; success: boolean | null; command?: string; durationMs?: number; errors: number; reason?: string };
  notes: string[];
}

export interface UpgradeOptions {
  projectDir: string;
  components?: string[];
  dryRun?: boolean;
  force?: boolean;
  /** v1.12: 충돌(사용자 수정 + upstream 변경) 파일을 원본·현재·목표 3-way 로 합쳐 충돌 없는 것만 적용(기본 false). force 와 함께 쓰면 병합 충돌 파일만 덮어쓴다 */
  reapply?: boolean;
  /** v1.12: 적용 뒤 compile — 합쳐 쓴 파일에서 오류가 나면 그 파일을 upstream 본으로 되돌린다 */
  verify?: boolean;
  timeoutMs?: number;
  runner?: Runner;
  platform?: NodeJS.Platform | string;
  /** fault-injection 회귀 테스트 전용. MCP 스키마에는 노출하지 않는다. */
  faultInjection?: "after-files" | "after-manifest";
  /** 검증된 upstream zip을 대체하는 오프라인 테스트 전용 입력. MCP 스키마에는 노출하지 않는다. */
  archiveData?: Buffer;
  /** v1.12: 기준(설치 때 태그) zip 을 대체하는 테스트 전용 입력 — reapply 의 원본 */
  baseArchiveData?: Buffer;
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
  const notes: string[] = [];
  // v1.12: 목표는 카탈로그 고정 태그(이 도구 버전이 아는 최신), 기준은 매니페스트에 기록된 설치 태그.
  //        예전에는 매니페스트 태그 아카이브와 비교해 사실상 "다시 맞추기"만 됐다 — 이제 태그가 올라가면 실제로 갱신한다.
  const sameSource = !!manifest.source.commit && manifest.source.commit === catalog.source.commit;
  const zip = opts.archiveData ? new AdmZip(opts.archiveData) : (await downloadComponentsZip(catalog.source)).zip;
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0)
    throw new Error("upstream 공통컴포넌트 archive에 파일이 없습니다");
  const rootPrefix = entries[0].entryName.split("/")[0] + "/";
  const rel = (name: string) => (name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name);
  const target = { tag: catalog.source.tag ?? null, commit: catalog.source.commit ?? null };
  const base = { tag: manifest.source.tag ?? null, commit: manifest.source.commit ?? null };
  if (!sameSource && !opts.archiveData) notes.push(`기준 ${base.tag ?? base.commit?.slice(0, 7) ?? "?"} → 목표 ${target.tag ?? target.commit?.slice(0, 7) ?? "?"} 로 갱신합니다.`);

  const items: UpgradeItem[] = [];
  const dataFor = new Map<string, Buffer>();
  const currentHashFor = new Map<string, string | undefined>();
  const realProjectDir = fs.realpathSync(projectDir);
  for (const id of targetIds) {
    const c = byId.get(id);
    const entry = manifest.components[id];
    const upstream = new Map<string, Buffer>();
    // v0.38: 소스 접두어뿐 아니라 조립 때 함께 설치한 자산(메시지·설정 조각·웹 자산 등)도 upstream 으로 본다 — 빠지면 자산 파일이 전부 "removed" 로 보고됐다
    const assetPaths = new Set<string>(c ? COMPONENT_ASSET_FIELDS.flatMap((f) => c[f] ?? []) : []);
    if (c)
      for (const e of entries) {
        const r = rel(e.entryName);
        if (r && (c.pathPrefixes.some((p) => r.startsWith(p)) || assetPaths.has(r))) upstream.set(r, e.getData());
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

  if (dryRun) {
    if (opts.reapply && summary.conflict) notes.push(`reapply=true — 적용 때 충돌 ${summary.conflict}개 파일을 기준·현재·목표 3-way 로 합쳐 충돌 없는 것만 자동 반영합니다.`);
    return { projectDir, dryRun: true, force, summary, items, target, base, notes };
  }

  // v1.12: 충돌 파일의 3-way 병합 — 기준(설치 태그) 아카이브에서 원본을 읽는다
  const mergedFor = new Map<string, Buffer>();
  let reapply: ReapplySummary | undefined;
  const conflictItems = items.filter((i) => i.cls === "conflict");
  if (opts.reapply && conflictItems.length) {
    reapply = emptyReapply();
    let baseZip: AdmZip | null = null;
    if (opts.baseArchiveData) baseZip = new AdmZip(opts.baseArchiveData);
    else if (sameSource) baseZip = zip;
    else { try { baseZip = (await downloadComponentsZip(manifest.source)).zip; } catch (e) { notes.push(`기준 아카이브를 받지 못해 병합하지 않습니다: ${e instanceof Error ? e.message : String(e)}`); } }
    const baseEntries = baseZip ? baseZip.getEntries().filter((e) => !e.isDirectory) : [];
    const basePrefix = baseEntries[0] ? baseEntries[0].entryName.split("/")[0] + "/" : "";
    const baseData = new Map<string, Buffer>();
    const want = new Set(conflictItems.map((i) => i.relPath));
    for (const e of baseEntries) { const r = e.entryName.startsWith(basePrefix) ? e.entryName.slice(basePrefix.length) : e.entryName; if (want.has(r)) baseData.set(r, e.getData()); }
    for (const it of conflictItems) {
      const b = baseData.get(it.relPath), t = dataFor.get(it.relPath);
      const abs = resolveTrackedFile(projectDir, realProjectDir, it.relPath);
      const cur = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
      // 기준 해시가 기준 아카이브의 파일과 맞아야 원본이다(매니페스트 srcHash 와 대조)
      const srcHash = manifest.components[it.componentId]?.hashes?.[it.relPath]?.srcHash;
      if (!b || !t || !cur || (srcHash && sha256(b) !== srcHash)) { it.reapply = "error"; reapply.entries.push({ path: it.relPath, componentId: it.componentId, status: "error", conflicts: 0 }); continue; }
      const m = await mergeThreeWay(b, cur, t);
      it.reapply = m.status;
      reapply.entries.push({ path: it.relPath, componentId: it.componentId, status: m.status, conflicts: m.conflicts });
      if ((m.status === "clean" || m.status === "absorbed") && m.merged) mergedFor.set(it.relPath, m.merged);
    }
    tallyReapply(reapply);
    notes.push(`사용자 수정 재적용: 자동 ${reapply.reapplied} · upstream 에 이미 반영 ${reapply.absorbed} · 충돌 ${reapply.conflicts}${reapply.binary ? ` · 이진 ${reapply.binary}` : ""}${reapply.errors ? ` · 기준 불일치 ${reapply.errors}` : ""}`);
  }
  const hardConflicts = conflictItems.filter((i) => !mergedFor.has(i.relPath));
  if (hardConflicts.length && !force)
    throw new Error(`충돌 ${hardConflicts.length}건(사용자 수정 + upstream 변경${opts.reapply ? ", 3-way 병합으로도 합치지 못함" : ""})으로 중단합니다. dryRun으로 확인 후 ${opts.reapply ? "" : "reapply=true 로 합쳐 보거나 "}force=true로 강제하거나 해당 파일을 정리하세요. 아무것도 쓰지 않았습니다.`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRelDir = path.join("upgrade-backup", `${ts}-${randomUUID()}`);
  let updated = 0, added = 0, forced = 0, reapplied = 0;
  const applicable = items.filter((item) =>
    item.cls === "update" || item.cls === "added" || (item.cls === "conflict" && (force || mergedFor.has(item.relPath))));
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
      const merged = mergedFor.get(item.relPath);
      transaction.writeFile(item.relPath, merged ?? upData, { mustNotExist: item.cls === "added" });
      if (item.cls === "update") updated++;
      else if (item.cls === "added") added++;
      else if (merged) reapplied++;
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
          ...(item.reapply ? { reapply: item.reapply } : {}),
        })),
        ...(reapply ? { reapply } : {}),
        target, base,
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
        const merged = mergedFor.get(item.relPath);
        if (upData && (item.cls === "update" || item.cls === "added" || (item.cls === "conflict" && (force || merged)))) {
          const hash = sha256(upData);
          entry.hashes[item.relPath] = { hash: merged ? sha256(merged) : hash, srcHash: hash };
          if (!entry.files.includes(item.relPath)) entry.files.push(item.relPath);
        }
      }
    }
    manifest.schemaVersion = 3;
    manifest.source = { ...manifest.source, ...catalog.source };
    transaction.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");

    if (opts.faultInjection === "after-manifest")
      throw new Error("upgrade fault injection: after-manifest");
  });

  // v1.12: verify — 합쳐 쓴 파일에서 컴파일 오류가 나면 그 파일만 upstream 본으로 되돌린다
  let verify: UpgradeResult["verify"];
  if (opts.verify) {
    if (!detectBuildToolAt(projectDir)) verify = { ran: false, success: null, errors: 0, reason: "빌드 파일(pom.xml·build.gradle)이 없어 컴파일을 건너뜀" };
    else {
      const b = await runBuild({ projectDir, goal: "compile", timeoutMs: opts.timeoutMs ?? 300_000, runner: opts.runner, platform: opts.platform });
      const errs = b.errors ?? [];
      verify = { ran: true, success: b.success ?? null, command: b.command, durationMs: b.durationMs, errors: errs.length };
      if (reapply && mergedFor.size && errs.length) {
        const relOf = (f: string) => (path.isAbsolute(f) ? path.relative(projectDir, f) : f).split(path.sep).join("/").replace(/^\.\//, "");
        const byFile = new Map<string, number>();
        for (const e of errs) byFile.set(relOf(e.file), (byFile.get(relOf(e.file)) ?? 0) + 1);
        const bad = reapply.entries.filter((e) => e.status === "clean" && byFile.has(e.path));
        if (bad.length) {
          await withFileTransaction(projectDir, "재적용 파일 되돌리기", (tx) => {
            const m2 = readManifest(projectDir)!;
            for (const e of bad) {
              const cur = tx.readFile(e.path);
              if (!cur || !cur.equals(mergedFor.get(e.path)!)) throw new Error(`검증 이후 파일이 바뀌어 되돌리지 않습니다: ${e.path}`);
              const up = dataFor.get(e.path)!;
              tx.writeFile(e.path, up);
              e.reverted = true; e.errors = byFile.get(e.path);
              const entry = m2.components[e.componentId];
              if (entry?.hashes) entry.hashes[e.path] = { hash: sha256(up), srcHash: sha256(up) };
            }
            tx.writeFile(MANIFEST_FILE, JSON.stringify(m2, null, 2) + "\n");
          });
          tallyReapply(reapply);
          reapplied -= bad.length; forced += bad.length;
          notes.push(`합친 파일 ${bad.length}개에서 컴파일 오류가 나 upstream 본으로 되돌렸습니다 — 사용자 변경은 upgrade-backup/ 의 이전 파일에 있습니다.`);
        }
      }
    }
  }

  return {
    projectDir,
    dryRun: false,
    force,
    summary,
    items,
    backupDir: needsBackup ? path.join(projectDir, backupRelDir) : undefined,
    applied: { updated, added, forced, ...(reapply ? { reapplied } : {}) },
    target, base, ...(reapply ? { reapply } : {}), ...(verify ? { verify } : {}), notes,
  };
}
