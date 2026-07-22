import { generateCrud } from "../dist/index.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("ok:", message);
  }
}

function project(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(dir, "pom.xml"), "<project/>");
  return dir;
}

const fields = [
  { columnName: "BOARD_ID", javaType: "Long", jdbcType: "BIGINT", primaryKey: true, generated: true, nullable: false, label: "게시글 ID" },
  { columnName: "TITLE", javaType: "String", nullable: false, label: "제목" },
  { columnName: "CREATED_AT", javaType: "LocalDateTime", label: "등록일시" },
];

const roots = [];
try {
  const classic = project("egov-crud-classic-");
  roots.push(classic);
  const options = {
    projectDir: classic,
    tableName: "SAMPLE_BOARD",
    entityName: "Board",
    basePackage: "egovframework.example.board",
    fields,
    profile: "classic",
    author: "테스트",
    createDate: "2026-07-22",
    withTest: true,
  };

  const dry = generateCrud({ ...options, dryRun: true });
  assert(dry.dryRun === true && dry.files.length === 10, "classic dryRun 파일 계획 10개");
  assert(!existsSync(path.join(classic, dry.files[0].path)), "dryRun 디스크 미기록");

  const result = generateCrud(options);
  assert(result.dryRun === false && result.files.length === 10, "classic 실제 생성 10개");
  assert(result.files.filter((file) => file.component === "web").length === 3, "classic controller+JSP 2종");
  assert(result.files.some((file) => file.component === "test"), "withTest JUnit 5 골격");

  const mapperXmlPath = path.join(classic, "src/main/resources/egovframework/mapper/egovframework/example/board/board/board_mapper.xml");
  const mapperXml = readFileSync(mapperXmlPath, "utf-8");
  assert(mapperXml.includes("namespace=\"egovframework.example.board.service.impl.BoardMapper\""), "Mapper namespace");
  assert(mapperXml.includes("useGeneratedKeys=\"true\"") && mapperXml.includes("keyProperty=\"boardId\""), "DB 생성키 매핑");
  assert(mapperXml.includes("WHERE\n        BOARD_ID = #{boardId,jdbcType=BIGINT}"), "PK 기반 안전 조건");

  const vo = readFileSync(path.join(classic, "src/main/java/egovframework/example/board/service/BoardVO.java"), "utf-8");
  assert(vo.includes("import java.time.LocalDateTime;") && vo.includes("private Long boardId;"), "VO 타입·이름 변환");
  const controller = readFileSync(path.join(classic, "src/main/java/egovframework/example/board/web/BoardController.java"), "utf-8");
  assert(controller.includes("@Controller") && controller.includes("/board/boardList.do"), "classic MVC 경로");

  let collision = false;
  try { generateCrud(options); } catch (error) { collision = String(error.message).includes("아무것도 쓰지 않았습니다"); }
  assert(collision, "기존 파일 충돌 시 전체 거부");

  const boot = project("egov-crud-boot-");
  roots.push(boot);
  const bootResult = generateCrud({
    projectDir: boot,
    tableName: "SAMPLE_BOARD",
    entityName: "Board",
    basePackage: "egovframework.example.board",
    fields,
    profile: "boot",
  });
  assert(bootResult.files.length === 7, "boot 생성 7개(JSP 제외)");
  assert(!bootResult.files.some((file) => file.path.endsWith(".jsp")), "boot JSP 미생성");
  const bootController = readFileSync(path.join(boot, "src/main/java/egovframework/example/board/web/BoardController.java"), "utf-8");
  assert(bootController.includes("@RestController") && bootController.includes("@RequestMapping(\"/api/board\")"), "boot REST 컨트롤러");

  const dataOnly = project("egov-crud-data-");
  roots.push(dataOnly);
  const dataResult = generateCrud({
    projectDir: dataOnly,
    tableName: "SAMPLE_BOARD",
    entityName: "Board",
    basePackage: "egovframework.example.board",
    fields,
    checkService: false,
    checkWeb: false,
  });
  assert(dataResult.files.length === 4 && dataResult.files.every((file) => file.component === "data-access"), "wizard DataAccess 단독 그룹");

  const invalid = project("egov-crud-invalid-");
  roots.push(invalid);
  let noPk = false;
  try {
    generateCrud({
      projectDir: invalid,
      tableName: "SAMPLE_BOARD",
      basePackage: "egovframework.example.board",
      fields: [{ columnName: "TITLE" }, { columnName: "CONTENT" }],
      dryRun: true,
    });
  } catch (error) { noPk = String(error.message).includes("primaryKey=true"); }
  assert(noPk, "PK 없는 update/delete 거부");

  let traversal = false;
  try { generateCrud({ ...options, projectDir: invalid, mapperFolder: "../outside", dryRun: true }); }
  catch (error) { traversal = String(error.message).includes("허용되지 않는 경로"); }
  assert(traversal, "프로젝트 밖 경로 거부");

  const conflictProject = project("egov-crud-conflict-");
  roots.push(conflictProject);
  const existingVo = path.join(conflictProject, "src/main/java/egovframework/example/board/service/BoardVO.java");
  mkdirSync(path.dirname(existingVo), { recursive: true });
  writeFileSync(existingVo, "user-file");
  let atomicConflict = false;
  try { generateCrud({ ...options, projectDir: conflictProject }); }
  catch { atomicConflict = true; }
  assert(atomicConflict && readFileSync(existingVo, "utf-8") === "user-file", "사용자 파일 보존");
  assert(!existsSync(path.join(conflictProject, "src/main/java/egovframework/example/board/service/BoardDefaultVO.java")), "충돌 시 다른 파일도 미생성");
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

if (process.exitCode) console.error("crud FAIL"); else console.log("crud OK");
