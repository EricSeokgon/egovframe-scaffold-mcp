// 공통컴포넌트 원본 태그 저장소 (v0.38) — 재조립의 3-way 기준선.
//   공식 egovframe-common-components 를 blob 없는 bare 저장소로 캐시하고, 필요한 태그만 depth 1 로 받는다(태그당 ≈1초·수백 KB).
//   경로별 git blob id 는 트리만으로 알 수 있으므로 "원본 태그 식별"과 "변경 여부 판정"은 파일 내용을 하나도 내려받지 않고 끝난다.
//   내용이 필요한 것은 사용자 수정 파일의 패치를 만들 때뿐이고, 그때도 그 blob 하나만 받는다(partial clone 의 지연 조회).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const COMPONENTS_REPOSITORY = "eGovFramework/egovframe-common-components";

/** 원본 저장소 추상화 — 테스트는 메모리 구현을 주입한다. */
export interface OriginSource {
  /** 저장소 태그 이름 목록 */
  listTags(): Promise<string[]>;
  /** tag 에서 paths(디렉터리 접두어 또는 파일 경로) 아래 파일의 git blob id */
  listBlobs(tag: string, paths: string[]): Promise<Map<string, string>>;
  /** tag 의 커밋 sha */
  resolveCommit(tag: string): Promise<string>;
  /** blob 내용 */
  readBlob(blobId: string): Promise<Buffer>;
}

/** git 이 쓰는 blob id(sha1("blob <len>\0" + 내용)). */
export function gitBlobId(data: Buffer): string {
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}
/** 체크아웃 줄바꿈(autocrlf)에 흔들리지 않도록 원문과 CRLF→LF 정규화본 두 id 를 돌려준다. */
export function blobIdsOf(data: Buffer): string[] {
  const raw = gitBlobId(data);
  if (!data.includes(13)) return [raw];
  const lf = Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  const norm = gitBlobId(lf);
  return norm === raw ? [raw] : [raw, norm];
}

/** 태그 이름의 버전 숫자 비교용 키(v3.10.0-FINAL → [3,10,0]). */
export function tagVersionKey(tag: string): number[] {
  return (tag.match(/\d+(?:\.\d+)*/)?.[0] ?? "0").split(".").map(Number);
}
export function compareTags(a: string, b: string): number {
  const x = tagVersionKey(a), y = tagVersionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

export function defaultCacheDir(): string {
  return path.resolve(process.env.EGOVFRAME_CACHE_DIR || path.join(os.homedir(), ".cache", "egovframe-scaffold-mcp"));
}

function git(args: string[], cwd?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const msg = (stderr?.toString("utf8") || error.message).trim().split("\n").slice(-3).join(" ");
        reject(new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "git 실행 파일을 찾지 못했습니다 — 재조립은 원본 태그 비교에 git 이 필요합니다(Git for Windows 등 설치)" : `git ${args[0]} 실패: ${msg}`));
      } else resolve(stdout);
    });
  });
}

/** blob 없는 bare 저장소 캐시를 쓰는 기본 구현. */
export class GitOriginSource implements OriginSource {
  readonly dir: string;
  private readonly url: string;
  private tagsCache: string[] | null = null;
  private readonly fetched = new Set<string>();
  constructor(opts: { cacheDir?: string; repository?: string } = {}) {
    const repository = opts.repository ?? COMPONENTS_REPOSITORY;
    this.url = `https://github.com/${repository}.git`;
    this.dir = path.join(opts.cacheDir ?? defaultCacheDir(), `${repository.replace(/[^A-Za-z0-9._-]/g, "_")}.git`);
  }
  async listTags(): Promise<string[]> {
    if (this.tagsCache) return this.tagsCache;
    const out = (await git(["ls-remote", "--tags", "--refs", this.url])).toString("utf8");
    this.tagsCache = out.split("\n").map((l) => l.split("\trefs/tags/")[1]).filter((t): t is string => !!t).sort(compareTags);
    return this.tagsCache;
  }
  private async ensureTag(tag: string): Promise<void> {
    if (this.fetched.has(tag)) return;
    if (!/^[A-Za-z0-9._-]+$/.test(tag)) throw new Error(`허용되지 않는 태그 이름: ${tag}`);
    if (!fs.existsSync(path.join(this.dir, "HEAD"))) {
      fs.mkdirSync(path.dirname(this.dir), { recursive: true });
      await git(["clone", "--quiet", "--bare", "--filter=blob:none", "--depth", "1", "--branch", tag, this.url, this.dir]);
    } else {
      // 프로세스마다 한 번은 원격 태그를 다시 받는다(+ 강제) — upstream 이 태그를 옮기면(v5.0.7, 2026-10-07) 캐시의 옛 커밋을 쓰지 않도록
      await git(["fetch", "--quiet", "--force", "--depth", "1", "--filter=blob:none", "origin", `+refs/tags/${tag}:refs/tags/${tag}`], this.dir);
    }
    this.fetched.add(tag);
  }
  async resolveCommit(tag: string): Promise<string> {
    await this.ensureTag(tag);
    return (await git(["rev-parse", `refs/tags/${tag}^{commit}`], this.dir)).toString("utf8").trim();
  }
  async listBlobs(tag: string, paths: string[]): Promise<Map<string, string>> {
    await this.ensureTag(tag);
    const out = new Map<string, string>();
    const unique = [...new Set(paths.map((p) => p.replace(/\/$/, "")))];
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200);
      const text = (await git(["ls-tree", "-r", "-z", `refs/tags/${tag}^{tree}`, "--", ...chunk], this.dir)).toString("utf8");
      for (const rec of text.split("\0")) {
        const m = rec.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
        if (m) out.set(m[2], m[1]);
      }
    }
    return out;
  }
  async readBlob(blobId: string): Promise<Buffer> {
    if (!/^[0-9a-f]{40}$/.test(blobId)) throw new Error(`blob id 형식 오류: ${blobId}`);
    return git(["cat-file", "blob", blobId], this.dir);
  }
}

/** 테스트·오프라인용 메모리 구현: tags = { tag: { path: 내용 } }. */
export class MemoryOriginSource implements OriginSource {
  private readonly blobs = new Map<string, Buffer>();
  private readonly trees = new Map<string, Map<string, string>>();
  private readonly commits: Record<string, string>;
  constructor(tags: Record<string, Record<string, string | Buffer>>, commits: Record<string, string> = {}) {
    this.commits = commits;
    for (const [tag, files] of Object.entries(tags)) {
      const tree = new Map<string, string>();
      for (const [p, content] of Object.entries(files)) {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
        const id = gitBlobId(buf);
        this.blobs.set(id, buf);
        tree.set(p, id);
      }
      this.trees.set(tag, tree);
    }
  }
  async listTags() { return [...this.trees.keys()].sort(compareTags); }
  async resolveCommit(tag: string) { if (!this.trees.has(tag)) throw new Error(`태그 없음: ${tag}`); return this.commits[tag] ?? createHash("sha1").update(tag).digest("hex"); }
  async listBlobs(tag: string, paths: string[]) {
    const tree = this.trees.get(tag);
    if (!tree) throw new Error(`태그 없음: ${tag}`);
    const out = new Map<string, string>();
    for (const [p, id] of tree) if (paths.some((x) => p === x.replace(/\/$/, "") || p.startsWith(x.endsWith("/") ? x : `${x}/`))) out.set(p, id);
    return out;
  }
  async readBlob(id: string) { const b = this.blobs.get(id); if (!b) throw new Error(`blob 없음: ${id}`); return b; }
  /** 테스트에서 목표 태그 내용을 그대로 쓰기 위한 접근자 */
  contentOf(tag: string, p: string): Buffer | null { const id = this.trees.get(tag)?.get(p); return id ? this.blobs.get(id) ?? null : null; }
}
