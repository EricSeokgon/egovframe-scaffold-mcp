import { customizePomCoordinates } from "../dist/index.js";

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

if (process.exitCode) console.error("pom FAIL"); else console.log("pom OK");
