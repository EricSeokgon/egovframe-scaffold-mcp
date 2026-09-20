// 설치 매니페스트(.egovframe-components.json) 읽기·쓰기.
import * as fs from "node:fs";
import * as path from "node:path";
import type { CatalogSourceMetadata } from "./catalog-sync.js";

/* ------------------------------------------------------------------ */
/* 설치 매니페스트 (v0.5.0) — 조립 내역 기록으로 제거·검증을 가능하게 함   */
/* ------------------------------------------------------------------ */

export const MANIFEST_FILE = ".egovframe-components.json";

export interface ManifestEntry {
  installedAt: string;
  files: string[];
  /** 파일별 기준선 해시(설치·갱신 시점) — upgrade의 3-way 판정용 (스키마 v2) */
  hashes?: Record<string, { hash: string; srcHash: string }>;
  sqlScripts: string[];
  /** AI 컴포넌트가 pom에 삽입한 내역 (제거 시 마커 구간 정리용) */
  pom?: { backup: string; addedDeps: string[]; addedProps: string[] };
}

export interface Manifest {
  schemaVersion: number;
  source: CatalogSourceMetadata & { repo: string; branch: string };
  components: Record<string, ManifestEntry>;
}

export function readManifest(projectDir: string): Manifest | null {
  const p = path.join(projectDir, MANIFEST_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Manifest;
}

function writeManifest(projectDir: string, manifest: Manifest): void {
  fs.writeFileSync(path.join(projectDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
}
