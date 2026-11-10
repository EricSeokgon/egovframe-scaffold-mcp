// node test/rte51.mjs — 표준프레임워크 5.1.0 대응 2단계(v1.18) 게이트 (오프라인, 플랫폼 중립)
//   5.1.x 브랜치 근거 · Boot 스타터 자동구성 변경(의존성으로 탐지) · Spring Security 6.5 폐기 예정 RequestMatcher 전환(auto/manual·적용) ·
//   JUnit Jupiter 6(5.1.0 parent) MediaType 모호성 · create rteVersion(alignPom target)
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadUpdateRules, updateProject, applyUpdate, alignPom, planRequestMatcherItems, planJunit6Items, pathPatternCompatible, maskJavaComments, applyTextEdits } from "../dist/index.js";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const write = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text, "utf8"); };
const root = mkdtempSync(path.join(tmpdir(), "egov-rte51-"));
const BOOT_POM = (v, extra = "") => `<project>\n  <parent>\n    <groupId>org.egovframe.boot</groupId>\n    <artifactId>egovframe-boot-starter-parent</artifactId>\n    <version>${v}</version>\n  </parent>\n  <artifactId>a</artifactId>\n  <dependencies>\n    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>${extra}\n  </dependencies>\n</project>\n`;
const STARTER = (a) => `\n    <dependency>\n      <groupId>org.egovframe.boot</groupId>\n      <artifactId>${a}</artifactId>\n    </dependency>`;
const apply = (text, items) => applyTextEdits(text, items.flatMap((i) => i.edits ?? [])).text;

try {
  // ── 근거: sources jar + 5.1.x 브랜치 ─────────────────
  {
    const rules = loadUpdateRules();
    const ms = rules.source.mavenSteps.find((x) => x.version === "5.1.0");
    assert(ms?.branch?.name === "5.1.x" && /^[0-9a-f]{40}$/.test(ms.branch.commit) && /^\d{4}-\d{2}-\d{2}$/.test(ms.branch.committedAt) && ms.branch.changed > 100 && typeof ms.branch.compared === "boolean", `5.1.0 근거에 5.1.x 브랜치(커밋 고정 ${ms?.branch?.commit?.slice(0, 7)}, 변경 클래스 ${ms?.branch?.changed})`);
    assert(rules.provisional[0].branch === "5.1.x" && rules.provisional[0].commit === ms.branch.commit, "provisional 에 브랜치·커밋");
    const c = rules.changes.find((x) => x.id === "boot-starter-autoconfig");
    assert(c && c.since === "5.1.0" && c.artifacts.join(",") === "egovframe-boot-starter-security,egovframe-boot-starter-access,egovframe-boot-starter-crypto" && c.classes.every((x) => x.startsWith("org.egovframe.boot.")) && c.evidence.branch === "5.1.x" && c.evidence.commit === ms.branch.commit, "boot-starter-autoconfig: 5.1.0, 스타터 3종 artifact, 근거는 브랜치(Boot 스타터는 sources jar 밖)");
    assert(rules.changes.filter((x) => x.since === "5.1.0").every((x) => x.evidence.kind === "maven-sources" && x.evidence.branch === "5.1.x"), "5.1.0 변경 전부 브랜치 커밋을 근거에 함께 기록");
  }

  // ── Boot 스타터 자동구성: 의존성 선언으로 탐지 ────────
  {
    const d = path.join(root, "boot-starter");
    write(d, "pom.xml", BOOT_POM("5.0.2", STARTER("egovframe-boot-starter-security") + STARTER("egovframe-boot-starter-crypto")));
    write(d, "src/main/java/a/App.java", "package a;\nclass App {}\n");
    const r51 = updateProject({ projectDir: d, target: "5.1.0" });
    const items = r51.items.filter((i) => i.kind === "rte-change" && i.from.startsWith("egovframe-boot-starter"));
    assert(items.length === 2 && items.every((i) => i.file === "pom.xml" && i.action === "manual") && items.map((i) => i.line).join(",") === "12,16" && r51.update.changes.some((c) => c.id === "boot-starter-autoconfig" && c.files === 1), `스타터 2종 → pom.xml 12·16줄 manual, 변경 1건(파일 1) (${items.map((i) => `${i.from}:${i.line}`).join(", ")})`);
    assert(items[0].reason.includes("Globals.Auth") && items[0].reason.includes("egov-security"), "사유에 Globals.Auth·운영 점검 규칙 안내");
    const r502 = updateProject({ projectDir: d, target: "5.0.2" });
    assert(!r502.items.some((i) => i.from.startsWith("egovframe-boot-starter")), "target 5.0.2 면 구간 밖");
    write(d, "pom.xml", BOOT_POM("5.0.2", `\n    <!-- ${STARTER("egovframe-boot-starter-security")} -->`));
    assert(!updateProject({ projectDir: d, target: "5.1.0" }).items.some((i) => i.from.startsWith("egovframe-boot-starter")), "주석 안 선언은 제외");
    const g = path.join(root, "boot-gradle");
    write(g, "build.gradle", "plugins { id 'java' }\ndependencies {\n  implementation 'org.egovframe.boot:egovframe-boot-starter-security:5.0.2'\n  implementation 'org.egovframe.rte:egovframe-rte-fdl-cmmn:5.0.2'\n}\n");
    const rg = updateProject({ projectDir: g, target: "5.1.0" });
    assert(rg.items.some((i) => i.file === "build.gradle" && i.line === 3 && i.from === "egovframe-boot-starter-security"), "Gradle 선언도 탐지(3줄)");
  }

  // ── RequestMatcher: 판정 ───────────────────────────
  {
    assert(pathPatternCompatible("/admin/**").ok && pathPatternCompatible("/a/{id}").ok && !pathPatternCompatible("/a/**/b.do").ok && !pathPatternCompatible("a/b").ok, "PathPattern 호환: 끝 ** 만, / 시작");
    const masked = maskJavaComments('a /* AntPathRequestMatcher */ b // AntPathRequestMatcher\nString s = "// x";');
    assert(!masked.includes("AntPath") && masked.includes('"// x"') && masked.length === 'a /* AntPathRequestMatcher */ b // AntPathRequestMatcher\nString s = "// x";'.length, "주석만 가림(문자열 유지, 길이 보존)");
    const A = 'package x;\n\nimport org.springframework.security.web.util.matcher.AntPathRequestMatcher;\nimport org.springframework.security.web.util.matcher.RequestMatcher;\n\nclass A {\n  // AntPathRequestMatcher 주석\n  RequestMatcher a = new AntPathRequestMatcher("/admin/**");\n  AntPathRequestMatcher b = AntPathRequestMatcher.antMatcher(org.springframework.http.HttpMethod.POST, "/api/x");\n  RequestMatcher c = new AntPathRequestMatcher("/login.do", "post");\n  RequestMatcher d = AntPathRequestMatcher.antMatcher(HttpMethod.GET);\n}\n';
    const ia = planRequestMatcherItems("A.java", A);
    assert(ia.length === 5 && ia.every((i) => i.action === "auto" && i.kind === "deprecated-api") && ia.map((i) => i.line).join(",") === "8,9,9,10,11", `리터럴만 있는 파일 → auto 5(주석 제외) (${ia.map((i) => `${i.action}:${i.line}`).join(" ")})`);
    const out = apply(A, ia);
    assert(out.includes('import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;\nimport org.springframework.http.HttpMethod;\nimport org.springframework.security.web.util.matcher.RequestMatcher;') && out.includes('RequestMatcher a = PathPatternRequestMatcher.withDefaults().matcher("/admin/**");') && out.includes('PathPatternRequestMatcher b = PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/x");') && out.includes('matcher(HttpMethod.POST, "/login.do")') && out.includes('matcher(HttpMethod.GET, "/**")') && out.includes("// AntPathRequestMatcher 주석") && !/import org\.springframework\.security\.web\.util\.matcher\.AntPathRequestMatcher/.test(out), "적용: 생성·팩토리·타입·메서드(소문자 post)·메서드만 → PathPattern, import 교체 + HttpMethod 추가, 주석 유지");
    assert(planRequestMatcherItems("A.java", out).length === 0, "적용 뒤 다시 계획하면 0");
    // 하나라도 기계적으로 못 바꾸면 파일 전체 manual
    const B = 'import org.springframework.security.web.util.matcher.AntPathRequestMatcher;\nclass B {\n  Object a = new AntPathRequestMatcher("/ok/**");\n  Object b = new AntPathRequestMatcher(pattern);\n  Object c = new AntPathRequestMatcher("/a/**/b.do");\n  Object d = new AntPathRequestMatcher("/x", "GET", false);\n}\n';
    const ib = planRequestMatcherItems("B.java", B);
    assert(ib.length === 4 && ib.every((i) => i.action === "manual" && !i.edits) && /PathPattern 문법/.test(ib[1].reason) && /\*\* 를 패턴 끝에만/.test(ib[2].reason) && /대소문자/.test(ib[3].reason) && /파일 단위/.test(ib[0].reason), `변수 패턴·중간 **·대소문자 인자 → 파일 전체 manual 4(사유별) (${ib.map((i) => i.line).join(",")})`);
    const C = 'import static org.springframework.security.web.util.matcher.AntPathRequestMatcher.antMatcher;\nimport org.springframework.security.web.util.matcher.AntPathRequestMatcher;\nclass C { Object a = new AntPathRequestMatcher("/x"); }\n';
    assert(planRequestMatcherItems("C.java", C).every((i) => i.action === "manual" && /static import/.test(i.reason)), "static import → manual");
    const D = 'import org.springframework.security.web.servlet.util.matcher.MvcRequestMatcher;\nclass D { Object a = new MvcRequestMatcher(introspector, "/x"); }\n';
    assert(planRequestMatcherItems("D.java", D).length === 1 && planRequestMatcherItems("D.java", D)[0].action === "manual" && /서블릿 경로/.test(planRequestMatcherItems("D.java", D)[0].reason), "MvcRequestMatcher → manual(서블릿 경로)");
    const E = 'package e;\nimport org.springframework.security.web.util.matcher.*;\nclass E { RequestMatcher a = new AntPathRequestMatcher("/x"); }\n';
    const ie = planRequestMatcherItems("E.java", E);
    assert(ie.length === 1 && ie[0].action === "auto" && apply(E, ie).startsWith("package e;\nimport org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;\nimport org.springframework.security.web.util.matcher.*;"), "와일드카드 import 파일: 새 import 를 package 뒤에 추가");
    assert(planRequestMatcherItems("F.java", 'class F { String s = "AntPathRequestMatcher"; /* new AntPathRequestMatcher("/x") */ }').length === 0, "문자열·주석 안 이름은 사용이 아님");
  }

  // ── 갱신 모드: deprecated-api 는 목표와 무관, 테스트 소스 제외, 적용·재진단 ──
  {
    const d = path.join(root, "matcher");
    write(d, "pom.xml", BOOT_POM("5.0.2"));
    write(d, "src/main/java/a/Sec.java", 'package a;\n\nimport org.springframework.security.web.util.matcher.AntPathRequestMatcher;\n\nclass Sec { Object m = new AntPathRequestMatcher("/admin/**"); }\n');
    write(d, "src/test/java/a/SecTest.java", 'package a;\nimport org.springframework.security.web.util.matcher.AntPathRequestMatcher;\nclass SecTest { Object m = new AntPathRequestMatcher("/x"); }\n');
    const r = updateProject({ projectDir: d, target: "5.0.2" });
    const dep = r.items.filter((i) => i.kind === "deprecated-api");
    assert(dep.length === 1 && dep[0].file === "src/main/java/a/Sec.java" && dep[0].action === "auto" && r.summary.byKind["deprecated-api"] === 1, `target 5.0.2 에서도 보고(5.x parent 는 모두 Security 6.5), 테스트 소스 제외 (${dep.map((i) => i.file).join()})`);
    const a = await applyUpdate({ projectDir: d, target: "5.0.2", dryRun: false });
    const after = readFileSync(path.join(d, "src/main/java/a/Sec.java"), "utf8");
    assert(a.applied.files >= 1 && after.includes("PathPatternRequestMatcher.withDefaults().matcher(\"/admin/**\")") && a.remaining && !updateProject({ projectDir: d, target: "5.0.2" }).items.some((i) => i.kind === "deprecated-api"), "적용 → 원본 백업·치환, 재진단 0");
  }

  // ── JUnit 6 MediaType 모호성(5.1.0 parent) ─────────────
  {
    const T = "package t;\n\nimport org.junit.jupiter.api.*;\nimport org.springframework.http.*;\n\nclass T {\n  @Test void a() { HttpHeaders h = new HttpHeaders(); h.setContentType(MediaType.APPLICATION_JSON); }\n}\n";
    const it = planJunit6Items("T.java", T);
    assert(it.length === 1 && it[0].action === "auto" && it[0].kind === "library-change" && it[0].line === 7 && apply(T, it).includes("import org.springframework.http.*;\nimport org.springframework.http.MediaType;\n"), "와일드카드 2개 + MediaType 사용 → 단일 import 추가(auto)");
    assert(planJunit6Items("T.java", T.replace("import org.springframework.http.*;", "import org.springframework.http.*;\nimport org.springframework.http.MediaType;")).length === 0 && planJunit6Items("T.java", T.replace("import org.junit.jupiter.api.*;", "import org.junit.jupiter.api.Test;")).length === 0 && planJunit6Items("T.java", T.replace("MediaType.APPLICATION_JSON", "null")).length === 0, "이미 단일 import·jupiter 와일드카드 없음·MediaType 미사용 → 없음");
    const d = path.join(root, "junit6");
    write(d, "pom.xml", BOOT_POM("5.0.1"));
    write(d, "src/test/java/t/T.java", T);
    const r51 = updateProject({ projectDir: d, target: "5.1.0" }), r502 = updateProject({ projectDir: d, target: "5.0.2" });
    assert(r51.items.filter((i) => i.kind === "library-change").length === 1 && r51.notes.some((x) => x.includes("JUnit Jupiter 를 5.x → 6.x")) && !r502.items.some((i) => i.kind === "library-change"), `5.0.1 → 5.1.0 이면 보고·안내, 5.0.2 목표면 없음(parent 의 junit-jupiter.version 비교) (${JSON.stringify(r51.summary.byKind)})`);
  }

  // ── create rteVersion: alignPom(target) ───────────────
  {
    const pom = BOOT_POM("5.0.0");
    const to51 = alignPom(pom, "5.1.0");
    const def = alignPom(pom);
    assert(/<version>5\.1\.0<\/version>/.test(to51.text) && to51.aligned.some((x) => x.to.includes("5.1.0")) && /<version>5\.0\.2<\/version>/.test(def.text), `alignPom: target 5.1.0 / 기본 5.0.2 (${to51.aligned.map((x) => `${x.from}→${x.to}`).join(", ")})`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`rte51 FAIL (${n} assertions)`); else console.log(`rte51 OK (${n} assertions)`);
