import { customizePomCoordinates, applyPomPlaceholders, isGlobalsPropertiesPath, archiveDownloadUrl, TEMPLATES, INITIALIZR_REPO, INITIALIZR_COMMIT } from "../dist/index.js";

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("ok:", message);
  }
}

const parentFirst = `<project>
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.egovframe.web</groupId>
    <artifactId>egovframe-web-sample-config-parent</artifactId>
    <version>5.0.0</version>
  </parent>
  <artifactId>egovframe-web-sample</artifactId>
  <name>egovframe-web-sample</name>
  <dependencies>
    <dependency>
      <groupId>org.egovframe</groupId>
      <artifactId>egovframe-web-sample-core</artifactId>
    </dependency>
  </dependencies>
</project>`;
const customizedParentFirst = customizePomCoordinates(parentFirst, "egovframework.example", "my-web");
assert(customizedParentFirst.includes("<groupId>egovframework.example</groupId>"), "상속 groupId 직접 좌표로 추가");
assert(customizedParentFirst.includes("<artifactId>my-web</artifactId>"), "프로젝트 artifactId 변경");
assert(customizedParentFirst.includes("<name>my-web</name>"), "프로젝트 name 변경");
assert(customizedParentFirst.includes("<artifactId>egovframe-web-sample-config-parent</artifactId>"), "parent artifactId 보존");
assert(customizedParentFirst.includes("<artifactId>egovframe-web-sample-core</artifactId>"), "dependency artifactId 보존");
assert(!customizedParentFirst.includes("my-web-config-parent"), "artifactId 전역 치환 방지");

const projectFirst = `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>sample-app</artifactId>
  <parent>
    <groupId>org.egovframe.boot</groupId>
    <artifactId>egovframe-boot-starter-parent</artifactId>
    <version>5.0.0</version>
  </parent>
</project>`;
const customizedProjectFirst = customizePomCoordinates(projectFirst, "egovframework.example", "my-boot");
assert(customizedProjectFirst.includes("<groupId>egovframework.example</groupId>"), "직접 groupId 변경");
assert(customizedProjectFirst.includes("<artifactId>my-boot</artifactId>"), "직접 artifactId 변경");
assert(customizedProjectFirst.includes("<name>my-boot</name>"), "name 부재 시 추가");
assert(customizedProjectFirst.includes("<artifactId>egovframe-boot-starter-parent</artifactId>"), "뒤쪽 parent 보존");

// ── Initializr zip 조달 템플릿 (v0.27) ─────────────────────
const placeholderPom = `<project>
	<modelVersion>4.0.0</modelVersion>
	<groupId>###GROUP_ID###</groupId>
	<artifactId>###ARTIFACT_ID###</artifactId>
	<packaging>war</packaging>
	<version>###VERSION###</version>
	<name>###NAME###</name>
	<url>###URL###</url>
	<parent>
		<groupId>org.egovframe.boot</groupId>
		<artifactId>egovframe-boot-starter-parent</artifactId>
	</parent>
	<!-- ###### 구분선은 자리표시자가 아니다 ###### -->
</project>`;
const filled = applyPomPlaceholders(placeholderPom, "kr.go.sample", "my-batch");
assert(filled.replaced === 5, `자리표시자 5개 치환 — 실제 ${filled.replaced}`);
assert(!/###[A-Z_]+###/.test(filled.pom), "자리표시자가 남지 않음");
assert(filled.pom.includes("<groupId>kr.go.sample</groupId>") && filled.pom.includes("<artifactId>my-batch</artifactId>"), "좌표 치환");
assert(filled.pom.includes("<version>1.0.0</version>") && filled.pom.includes("<name>my-batch</name>"), "version·name 치환");
assert(filled.pom.includes("###### 구분선"), "자리표시자가 아닌 ### 문자열은 보존");
assert(filled.pom.includes("<artifactId>egovframe-boot-starter-parent</artifactId>"), "parent 좌표 보존");
const twice = customizePomCoordinates(filled.pom, "kr.go.sample", "my-batch");
assert(twice.includes("<groupId>kr.go.sample</groupId>") && twice.includes("<groupId>org.egovframe.boot</groupId>"), "치환 후 공통 좌표 적용과 함께 써도 parent 보존");
const untouched = applyPomPlaceholders("<project><artifactId>x</artifactId></project>", "a.b", "c-d");
assert(untouched.replaced === 0 && untouched.pom === "<project><artifactId>x</artifactId></project>", "자리표시자 없으면 원문 그대로");

assert(isGlobalsPropertiesPath("src/main/resources/egovframework/batch/properties/globals.properties"), "batch globals 경로 인식");
assert(isGlobalsPropertiesPath("src/main/resources/egovframework/egovProps/globals.properties"), "egovProps globals 경로 인식");
assert(!isGlobalsPropertiesPath("src/test/resources/egovframework/egovProps/globals.properties"), "test 리소스는 제외");
assert(!isGlobalsPropertiesPath("../src/main/resources/x/globals.properties"), "상위 경로 이탈 형태는 제외");
assert(!isGlobalsPropertiesPath("src/main/resources/globals.properties.bak"), "다른 파일명은 제외");

assert(
  archiveDownloadUrl("o/r", "abc", "a/b.zip") === "https://media.githubusercontent.com/media/o/r/abc/a/b.zip",
  "LFS 다운로드 URL 구성",
);
const zipTemplates = Object.entries(TEMPLATES).filter(([, t]) => t.archive);
assert(zipTemplates.length === 12, `zip 조달 템플릿 12종 — 실제 ${zipTemplates.length}`);
assert(/^[0-9a-f]{40}$/.test(INITIALIZR_COMMIT), "Initializr commit 은 40자 hex 로 고정");
for (const [id, t] of zipTemplates) {
  const a = t.archive;
  const ok =
    t.repo === INITIALIZR_REPO && a.kind === "initializr-zip" && a.commit === INITIALIZR_COMMIT &&
    /^[0-9a-f]{64}$/.test(a.sha256) && Number.isInteger(a.bytes) && a.bytes > 0 &&
    /^templates\/projects\/examples\/[a-z0-9-]+\.zip$/.test(a.path);
  assert(ok, `zip 템플릿 정의 유효: ${id}`);
}
assert(new Set(zipTemplates.map(([, t]) => t.archive.sha256)).size === zipTemplates.length, "zip 지문 중복 없음");
assert(["msa-portal-backend", "msa-portal-frontend"].every((id) => TEMPLATES[id].multiProject === true), "MSA 포털은 멀티 프로젝트");
assert(Object.entries(TEMPLATES).filter(([, t]) => !t.archive).length === 10, "기존 저장소 조달 템플릿 10종 유지");

if (process.exitCode) console.error("pom FAIL"); else console.log("pom OK");
