// 조립 프로젝트 무결성 진단 (validate_egovframe_project).
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MANIFEST_FILE, readManifest } from "./manifest.js";

/* ------------------------------------------------------------------ */
/* 프로젝트 검증 (v0.5.0)                                               */
/* ------------------------------------------------------------------ */

export interface ValidateResult {
  projectDir: string;
  ok: boolean;
  manifestFound: boolean;
  components: { id: string; files: number; missing: number; missingSamples: string[] }[];
  dbType: string | null;
  dbScriptDirs: string[];
  /** AI 컴포넌트 실행 전제 진단 (경고와 별도 — ok 판정에 영향 없음) */
  aiChecks: { componentId: string; file: string; exists: boolean; note: string }[];
  warnings: string[];
}

/** \${user.home}·\${ENV:default} 플레이스홀더를 해석한다 (AI 설정 진단용) */
export function resolveConfigPlaceholders(value: string): string {
  let v = value;
  for (let i = 0; i < 5 && v.includes("${"); i++) {
    v = v.replace(/\$\{([^:}]+)(?::([^}]*))?\}/g, (_, name: string, def?: string) => {
      if (name === "user.home") return os.homedir();
      return process.env[name] ?? def ?? "";
    });
  }
  return v;
}

/** application-ai.yml에서 외부 파일 경로(file: URI·embedding-config-path)를 추출해 존재를 진단한다 */
export function collectAiChecks(projectDir: string, componentId: string): ValidateResult["aiChecks"] {
  const checks: ValidateResult["aiChecks"] = [];
  const ymlPath = path.join(projectDir, "src/main/resources/application-ai.yml");
  if (!fs.existsSync(ymlPath)) return checks;
  const yml = fs.readFileSync(ymlPath, "utf-8");
  const candidates = new Map<string, string>(); // raw → note
  for (const m of yml.matchAll(/file:([^\s"']+)/g)) candidates.set(m[1], "ONNX 모델/토크나이저");
  const ec = yml.match(/embedding-config-path:\s*(\S+)/);
  if (ec) candidates.set(ec[1], "임베딩 설정(JSON)");
  for (const [raw, note] of candidates) {
    const resolved = resolveConfigPlaceholders(raw);
    if (!resolved || resolved.includes("${")) continue;
    const abs = path.isAbsolute(resolved) ? resolved : path.join(projectDir, resolved);
    checks.push({ componentId, file: abs, exists: fs.existsSync(abs), note });
  }
  const compose = path.join(projectDir, "docker-compose.ai.yml");
  if (fs.existsSync(compose))
    checks.push({ componentId, file: compose, exists: true, note: "벡터 저장소 docker compose (기동: docker compose -f docker-compose.ai.yml up -d)" });
  return checks;
}

/** 조립된 프로젝트의 무결성을 진단한다 (파일 존재·DbType↔DDL 일치). */
export async function validateProject(opts: { projectDir: string }): Promise<ValidateResult> {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  const warnings: string[] = [];
  const manifest = readManifest(projectDir);

  const aiChecks: ValidateResult["aiChecks"] = [];
  const components: ValidateResult["components"] = [];
  if (manifest) {
    for (const [id, entry] of Object.entries(manifest.components)) {
      const missing = entry.files.filter((rel) => !fs.existsSync(path.join(projectDir, rel)));
      if (missing.length > 0)
        warnings.push(`컴포넌트 '${id}'의 파일 ${missing.length}개가 없습니다 (수동 삭제 또는 이동 가능성)`);
      components.push({ id, files: entry.files.length, missing: missing.length, missingSamples: missing.slice(0, 5) });
      if (entry.pom) {
        const pomPath = path.join(projectDir, "pom.xml");
        const pomText = fs.existsSync(pomPath) ? fs.readFileSync(pomPath, "utf-8") : "";
        if (!pomText.includes(`egovframe-scaffold-mcp:ai:${id}:deps:start`) && entry.pom.addedDeps.length > 0)
          warnings.push(`컴포넌트 '${id}'의 pom 삽입 마커가 없습니다 (수동 편집 가능성) — 의존성 ${entry.pom.addedDeps.length}건 확인 필요`);
      }
      if (entry.pom) aiChecks.push(...collectAiChecks(projectDir, id));
    }
  } else {
    warnings.push(`설치 매니페스트(${MANIFEST_FILE})가 없습니다 — v0.5.0 이전 조립이거나 컴포넌트 미설치 프로젝트입니다`);
  }

  // Globals.DbType ↔ 복사된 DB 스크립트 일치 확인
  let dbType: string | null = null;
  const propsPath = path.join(projectDir, "src/main/resources/application.properties");
  if (fs.existsSync(propsPath)) {
    const m = fs.readFileSync(propsPath, "utf-8").match(/^Globals\.DbType=(.*)$/m);
    if (m) dbType = m[1].trim();
  }
  const scriptsRoot = path.join(projectDir, "scripts/egovframe-components");
  const dbScriptDirs = fs.existsSync(scriptsRoot) ? fs.readdirSync(scriptsRoot) : [];
  if (dbType && dbScriptDirs.length > 0) {
    // 템플릿 DbType(예: mysql)과 스크립트 DB(예: mysql|maria)가 다르면 경고
    const matched = dbScriptDirs.some((d) => d === dbType || (dbType === "mysql" && d === "maria"));
    if (!matched)
      warnings.push(`Globals.DbType='${dbType}'인데 복사된 DB 스크립트(${dbScriptDirs.join(", ")})와 일치하지 않습니다`);
  }

  return { projectDir, ok: warnings.length === 0, manifestFound: manifest !== null, components, dbType, dbScriptDirs, aiChecks, warnings };
}
