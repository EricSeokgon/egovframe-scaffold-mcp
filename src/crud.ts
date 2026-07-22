import * as fs from "node:fs";
import * as path from "node:path";

export const CRUD_PROFILES = ["classic", "boot"] as const;
export const CRUD_JAVA_TYPES = [
  "String",
  "Integer",
  "Long",
  "Double",
  "BigDecimal",
  "Boolean",
  "LocalDate",
  "LocalDateTime",
  "Instant",
  "byte[]",
] as const;

export type CrudProfile = (typeof CRUD_PROFILES)[number];
export type CrudJavaType = (typeof CRUD_JAVA_TYPES)[number];

export interface CrudFieldInput {
  columnName: string;
  propertyName?: string;
  javaType?: CrudJavaType;
  jdbcType?: string;
  primaryKey?: boolean;
  generated?: boolean;
  nullable?: boolean;
  label?: string;
}

export interface GenerateCrudOptions {
  projectDir: string;
  tableName: string;
  entityName?: string;
  basePackage: string;
  fields: CrudFieldInput[];
  profile?: CrudProfile;
  author?: string;
  createDate?: string;
  mapperFolder?: string;
  mapperPackage?: string;
  voPackage?: string;
  servicePackage?: string;
  implPackage?: string;
  controllerPackage?: string;
  jspFolder?: string;
  checkDataAccess?: boolean;
  checkService?: boolean;
  checkWeb?: boolean;
  includeJsp?: boolean;
  withTest?: boolean;
  dryRun?: boolean;
}

export interface CrudGeneratedFile {
  path: string;
  component: "data-access" | "service" | "web" | "test";
  bytes: number;
}

export interface GenerateCrudResult {
  projectDir: string;
  tableName: string;
  entityName: string;
  profile: CrudProfile;
  files: CrudGeneratedFile[];
  dryRun: boolean;
  warnings: string[];
}

interface NormalizedField {
  columnName: string;
  propertyName: string;
  className: string;
  javaType: CrudJavaType;
  jdbcType: string;
  primaryKey: boolean;
  generated: boolean;
  nullable: boolean;
  label: string;
}

interface CrudModel {
  projectDir: string;
  tableName: string;
  entityName: string;
  entityVariable: string;
  profile: CrudProfile;
  author: string;
  createDate: string;
  mapperFolder: string;
  mapperPackage: string;
  voPackage: string;
  servicePackage: string;
  implPackage: string;
  controllerPackage: string;
  jspFolder: string;
  checkDataAccess: boolean;
  checkService: boolean;
  checkWeb: boolean;
  includeJsp: boolean;
  withTest: boolean;
  fields: NormalizedField[];
  primaryKeys: NormalizedField[];
}

interface PlannedFile {
  relativePath: string;
  component: CrudGeneratedFile["component"];
  content: string;
}

const JAVA_CLASS_RE = /^[A-Z][A-Za-z0-9]*$/;
const JAVA_PROPERTY_RE = /^[a-z][A-Za-z0-9]*$/;
const JAVA_PACKAGE_RE = /^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)+$/;
const SQL_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const JDBC_TYPE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

const DEFAULT_JDBC_TYPES: Record<CrudJavaType, string> = {
  String: "VARCHAR",
  Integer: "INTEGER",
  Long: "BIGINT",
  Double: "DOUBLE",
  BigDecimal: "DECIMAL",
  Boolean: "BOOLEAN",
  LocalDate: "DATE",
  LocalDateTime: "TIMESTAMP",
  Instant: "TIMESTAMP",
  "byte[]": "BLOB",
};

const JAVA_IMPORTS: Partial<Record<CrudJavaType, string>> = {
  BigDecimal: "java.math.BigDecimal",
  LocalDate: "java.time.LocalDate",
  LocalDateTime: "java.time.LocalDateTime",
  Instant: "java.time.Instant",
};

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function toClassName(value: string): string {
  return words(value).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

function toPropertyName(value: string): string {
  const className = toClassName(value);
  return className.charAt(0).toLowerCase() + className.slice(1);
}

function packagePath(packageName: string): string {
  return packageName.replace(/\./g, "/");
}

function safeRelativePath(value: string, label: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
    throw new Error(`${label}는 프로젝트 기준 상대경로여야 합니다: ${value}`);
  if (normalized.split("/").some((part) => part === ".." || part === ""))
    throw new Error(`${label}에 허용되지 않는 경로 구간이 있습니다: ${value}`);
  return normalized;
}

function validatePackage(packageName: string, label: string): string {
  if (!JAVA_PACKAGE_RE.test(packageName))
    throw new Error(`${label}는 자바 패키지 형식이어야 합니다: ${packageName}`);
  return packageName;
}

function cleanMetadata(value: string, label: string, maxLength: number): string {
  const cleaned = value.trim().replace(/\*\//g, "* /");
  if (!cleaned || cleaned.length > maxLength || /[\r\n\0]/.test(cleaned))
    throw new Error(`${label} 값이 비어 있거나 허용 길이를 초과했습니다`);
  return cleaned;
}

function normalizeModel(opts: GenerateCrudOptions): CrudModel {
  const projectDir = path.resolve(opts.projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory())
    throw new Error(`프로젝트 디렉터리가 없습니다: ${projectDir}`);
  if (!["pom.xml", "build.gradle", "build.gradle.kts"].some((file) => fs.existsSync(path.join(projectDir, file))))
    throw new Error(`빌드 파일(pom.xml·build.gradle)을 찾지 못했습니다: ${projectDir}`);
  if (!SQL_IDENTIFIER_RE.test(opts.tableName))
    throw new Error(`tableName은 단일 SQL 식별자여야 합니다: ${opts.tableName}`);

  const entityName = opts.entityName?.trim() || toClassName(opts.tableName);
  if (!JAVA_CLASS_RE.test(entityName))
    throw new Error(`entityName은 대문자로 시작하는 자바 클래스명이어야 합니다: ${entityName}`);
  const entityVariable = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const basePackage = validatePackage(opts.basePackage.trim(), "basePackage");
  const profile = opts.profile ?? "classic";
  const checkDataAccess = opts.checkDataAccess !== false;
  const checkService = opts.checkService !== false;
  const checkWeb = opts.checkWeb !== false;
  const includeJsp = opts.includeJsp ?? (profile === "classic" && checkWeb);
  const withTest = opts.withTest === true;

  if (!checkDataAccess && checkService)
    throw new Error("checkService=true는 checkDataAccess=true가 필요합니다");
  if (!checkService && checkWeb)
    throw new Error("checkWeb=true는 checkService=true가 필요합니다");
  if (includeJsp && (!checkWeb || profile !== "classic"))
    throw new Error("includeJsp=true는 profile=classic 및 checkWeb=true에서만 지원합니다");
  if (withTest && !checkService)
    throw new Error("withTest=true는 checkService=true가 필요합니다");
  if (!checkDataAccess && !checkService && !checkWeb)
    throw new Error("DataAccess·Service·Web 중 하나 이상을 생성해야 합니다");
  if (!Array.isArray(opts.fields) || opts.fields.length === 0 || opts.fields.length > 100)
    throw new Error("fields는 1~100개여야 합니다");

  const columnNames = new Set<string>();
  const propertyNames = new Set<string>();
  const fields = opts.fields.map((field, index): NormalizedField => {
    if (!SQL_IDENTIFIER_RE.test(field.columnName))
      throw new Error(`fields[${index}].columnName은 단일 SQL 식별자여야 합니다: ${field.columnName}`);
    const columnKey = field.columnName.toLowerCase();
    if (columnNames.has(columnKey)) throw new Error(`중복 columnName: ${field.columnName}`);
    columnNames.add(columnKey);

    const propertyName = field.propertyName?.trim() || toPropertyName(field.columnName);
    if (!JAVA_PROPERTY_RE.test(propertyName))
      throw new Error(`fields[${index}].propertyName이 자바 프로퍼티 형식이 아닙니다: ${propertyName}`);
    if (propertyNames.has(propertyName)) throw new Error(`중복 propertyName: ${propertyName}`);
    propertyNames.add(propertyName);

    const javaType = field.javaType ?? "String";
    if (!(CRUD_JAVA_TYPES as readonly string[]).includes(javaType))
      throw new Error(`지원하지 않는 javaType: ${javaType}`);
    const jdbcType = (field.jdbcType ?? DEFAULT_JDBC_TYPES[javaType]).toUpperCase();
    if (!JDBC_TYPE_RE.test(jdbcType)) throw new Error(`허용되지 않는 jdbcType: ${jdbcType}`);
    return {
      columnName: field.columnName,
      propertyName,
      className: propertyName.charAt(0).toUpperCase() + propertyName.slice(1),
      javaType,
      jdbcType,
      primaryKey: field.primaryKey === true,
      generated: field.generated === true,
      nullable: field.nullable !== false,
      label: cleanMetadata(field.label ?? propertyName, `fields[${index}].label`, 100),
    };
  });
  const primaryKeys = fields.filter((field) => field.primaryKey);
  if (primaryKeys.length === 0)
    throw new Error("안전한 update/delete 생성을 위해 primaryKey=true인 필드가 하나 이상 필요합니다");
  if (primaryKeys.filter((field) => field.generated).length > 1)
    throw new Error("generated=true인 기본키는 하나만 지원합니다");
  if (fields.filter((field) => !field.primaryKey && !field.generated).length === 0)
    throw new Error("update 문을 생성할 일반 필드가 하나 이상 필요합니다");
  if (fields.filter((field) => !field.generated).length === 0)
    throw new Error("insert 문을 생성할 필드가 하나 이상 필요합니다");

  const mapperPackage = validatePackage(opts.mapperPackage?.trim() || `${basePackage}.service.impl`, "mapperPackage");
  const voPackage = validatePackage(opts.voPackage?.trim() || `${basePackage}.service`, "voPackage");
  const servicePackage = validatePackage(opts.servicePackage?.trim() || `${basePackage}.service`, "servicePackage");
  const implPackage = validatePackage(opts.implPackage?.trim() || `${basePackage}.service.impl`, "implPackage");
  const controllerPackage = validatePackage(opts.controllerPackage?.trim() || `${basePackage}.web`, "controllerPackage");
  const mapperFolder = safeRelativePath(
    opts.mapperFolder || `src/main/resources/egovframework/mapper/${packagePath(basePackage)}`,
    "mapperFolder",
  );
  const jspFolder = safeRelativePath(
    opts.jspFolder || `src/main/webapp/WEB-INF/jsp/${packagePath(basePackage)}`,
    "jspFolder",
  );

  return {
    projectDir,
    tableName: opts.tableName,
    entityName,
    entityVariable,
    profile,
    author: cleanMetadata(opts.author ?? "egovframe-scaffold-mcp", "author", 100),
    createDate: cleanMetadata(opts.createDate ?? new Date().toISOString().slice(0, 10), "createDate", 40),
    mapperFolder,
    mapperPackage,
    voPackage,
    servicePackage,
    implPackage,
    controllerPackage,
    jspFolder,
    checkDataAccess,
    checkService,
    checkWeb,
    includeJsp,
    withTest,
    fields,
    primaryKeys,
  };
}

function javaDoc(model: CrudModel, description: string): string {
  return [
    "/**",
    ` * ${description}`,
    " *",
    ` * @author ${model.author}`,
    ` * @since ${model.createDate}`,
    " * @version 1.0",
    " */",
  ].join("\n");
}

function renderDefaultVo(model: CrudModel): string {
  return `package ${model.voPackage};

import java.io.Serializable;

${javaDoc(model, `${model.entityName} 검색·페이징 기본 VO`)}
public class ${model.entityName}DefaultVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private String searchCondition = "";
    private String searchKeyword = "";
    private int pageIndex = 1;
    private int pageUnit = 10;
    private int pageSize = 10;
    private int firstIndex;
    private int lastIndex;
    private int recordCountPerPage = 10;

    public String getSearchCondition() { return searchCondition; }
    public void setSearchCondition(String searchCondition) { this.searchCondition = searchCondition; }
    public String getSearchKeyword() { return searchKeyword; }
    public void setSearchKeyword(String searchKeyword) { this.searchKeyword = searchKeyword; }
    public int getPageIndex() { return pageIndex; }
    public void setPageIndex(int pageIndex) { this.pageIndex = pageIndex; }
    public int getPageUnit() { return pageUnit; }
    public void setPageUnit(int pageUnit) { this.pageUnit = pageUnit; }
    public int getPageSize() { return pageSize; }
    public void setPageSize(int pageSize) { this.pageSize = pageSize; }
    public int getFirstIndex() { return firstIndex; }
    public void setFirstIndex(int firstIndex) { this.firstIndex = firstIndex; }
    public int getLastIndex() { return lastIndex; }
    public void setLastIndex(int lastIndex) { this.lastIndex = lastIndex; }
    public int getRecordCountPerPage() { return recordCountPerPage; }
    public void setRecordCountPerPage(int recordCountPerPage) { this.recordCountPerPage = recordCountPerPage; }
}
`;
}

function renderVo(model: CrudModel): string {
  const imports = [...new Set(model.fields.map((field) => JAVA_IMPORTS[field.javaType]).filter(Boolean))] as string[];
  const importBlock = imports.length ? `${imports.map((item) => `import ${item};`).join("\n")}\n\n` : "";
  const fields = model.fields.map((field) => `    /** ${field.label} */\n    private ${field.javaType} ${field.propertyName};`).join("\n\n");
  const accessors = model.fields.map((field) => [
    `    public ${field.javaType} get${field.className}() { return ${field.propertyName}; }`,
    `    public void set${field.className}(${field.javaType} ${field.propertyName}) { this.${field.propertyName} = ${field.propertyName}; }`,
  ].join("\n")).join("\n\n");
  return `package ${model.voPackage};

${importBlock}${javaDoc(model, `${model.entityName} VO`)}
public class ${model.entityName}VO extends ${model.entityName}DefaultVO {

    private static final long serialVersionUID = 1L;

${fields}

${accessors}
}
`;
}

function renderMapperInterface(model: CrudModel): string {
  return `package ${model.mapperPackage};

import java.util.List;

import org.egovframe.rte.psl.dataaccess.mapper.EgovMapper;

import ${model.voPackage}.${model.entityName}VO;

${javaDoc(model, `${model.entityName} 데이터 처리 매퍼`)}
@EgovMapper("${model.entityVariable}Mapper")
public interface ${model.entityName}Mapper {

    void insert${model.entityName}(${model.entityName}VO vo) throws Exception;
    void update${model.entityName}(${model.entityName}VO vo) throws Exception;
    void delete${model.entityName}(${model.entityName}VO vo) throws Exception;
    ${model.entityName}VO select${model.entityName}(${model.entityName}VO vo) throws Exception;
    List<${model.entityName}VO> select${model.entityName}List(${model.entityName}VO vo) throws Exception;
    int select${model.entityName}ListTotCnt(${model.entityName}VO vo);
}
`;
}

function xmlValue(field: NormalizedField): string {
  return `#{${field.propertyName},jdbcType=${field.jdbcType}}`;
}

function renderMapperXml(model: CrudModel): string {
  const namespace = `${model.mapperPackage}.${model.entityName}Mapper`;
  const voType = `${model.voPackage}.${model.entityName}VO`;
  const insertFields = model.fields.filter((field) => !field.generated);
  const updateFields = model.fields.filter((field) => !field.primaryKey && !field.generated);
  const generatedKey = model.primaryKeys.find((field) => field.generated);
  const keyWhere = model.primaryKeys.map((field, index) => `        ${index ? "AND " : ""}${field.columnName} = ${xmlValue(field)}`).join("\n");
  const resultMappings = model.fields.map((field) =>
    `        <${field.primaryKey ? "id" : "result"} property="${field.propertyName}" column="${field.columnName}" jdbcType="${field.jdbcType}" />`,
  ).join("\n");
  const generatedAttrs = generatedKey
    ? ` useGeneratedKeys="true" keyProperty="${generatedKey.propertyName}" keyColumn="${generatedKey.columnName}"`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "https://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="${namespace}">

    <resultMap id="${model.entityVariable}ResultMap" type="${voType}">
${resultMappings}
    </resultMap>

    <insert id="insert${model.entityName}" parameterType="${voType}"${generatedAttrs}>
        INSERT INTO ${model.tableName} (
            ${insertFields.map((field) => field.columnName).join(",\n            ")}
        ) VALUES (
            ${insertFields.map(xmlValue).join(",\n            ")}
        )
    </insert>

    <update id="update${model.entityName}" parameterType="${voType}">
        UPDATE ${model.tableName}
        SET ${updateFields.map((field) => `${field.columnName} = ${xmlValue(field)}`).join(",\n            ")}
        WHERE
${keyWhere}
    </update>

    <delete id="delete${model.entityName}" parameterType="${voType}">
        DELETE FROM ${model.tableName}
        WHERE
${keyWhere}
    </delete>

    <select id="select${model.entityName}" parameterType="${voType}" resultMap="${model.entityVariable}ResultMap">
        SELECT ${model.fields.map((field) => field.columnName).join(", ")}
        FROM ${model.tableName}
        WHERE
${keyWhere}
    </select>

    <select id="select${model.entityName}List" parameterType="${voType}" resultMap="${model.entityVariable}ResultMap">
        SELECT ${model.fields.map((field) => field.columnName).join(", ")}
        FROM ${model.tableName}
        ORDER BY ${model.primaryKeys.map((field) => field.columnName).join(", ")}
    </select>

    <select id="select${model.entityName}ListTotCnt" parameterType="${voType}" resultType="int">
        SELECT COUNT(*)
        FROM ${model.tableName}
    </select>

</mapper>
`;
}

function renderService(model: CrudModel): string {
  return `package ${model.servicePackage};

import java.util.List;

${model.servicePackage === model.voPackage ? "" : `import ${model.voPackage}.${model.entityName}VO;\n\n`}${javaDoc(model, `${model.entityName} 비즈니스 서비스`)}
public interface ${model.entityName}Service {

    void insert${model.entityName}(${model.entityName}VO vo) throws Exception;
    void update${model.entityName}(${model.entityName}VO vo) throws Exception;
    void delete${model.entityName}(${model.entityName}VO vo) throws Exception;
    ${model.entityName}VO select${model.entityName}(${model.entityName}VO vo) throws Exception;
    List<${model.entityName}VO> select${model.entityName}List(${model.entityName}VO vo) throws Exception;
    int select${model.entityName}ListTotCnt(${model.entityName}VO vo);
}
`;
}

function renderServiceImpl(model: CrudModel): string {
  return `package ${model.implPackage};

import java.util.List;

import org.egovframe.rte.fdl.cmmn.EgovAbstractServiceImpl;
import org.springframework.stereotype.Service;

import ${model.mapperPackage}.${model.entityName}Mapper;
import ${model.servicePackage}.${model.entityName}Service;
import ${model.voPackage}.${model.entityName}VO;

${javaDoc(model, `${model.entityName} 비즈니스 서비스 구현`)}
@Service("${model.entityVariable}Service")
public class ${model.entityName}ServiceImpl extends EgovAbstractServiceImpl implements ${model.entityName}Service {

    private final ${model.entityName}Mapper ${model.entityVariable}Mapper;

    public ${model.entityName}ServiceImpl(${model.entityName}Mapper ${model.entityVariable}Mapper) {
        this.${model.entityVariable}Mapper = ${model.entityVariable}Mapper;
    }

    @Override
    public void insert${model.entityName}(${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Mapper.insert${model.entityName}(vo);
    }

    @Override
    public void update${model.entityName}(${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Mapper.update${model.entityName}(vo);
    }

    @Override
    public void delete${model.entityName}(${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Mapper.delete${model.entityName}(vo);
    }

    @Override
    public ${model.entityName}VO select${model.entityName}(${model.entityName}VO vo) throws Exception {
        ${model.entityName}VO result = ${model.entityVariable}Mapper.select${model.entityName}(vo);
        if (result == null) {
            throw processException("info.nodata.msg");
        }
        return result;
    }

    @Override
    public List<${model.entityName}VO> select${model.entityName}List(${model.entityName}VO vo) throws Exception {
        return ${model.entityVariable}Mapper.select${model.entityName}List(vo);
    }

    @Override
    public int select${model.entityName}ListTotCnt(${model.entityName}VO vo) {
        return ${model.entityVariable}Mapper.select${model.entityName}ListTotCnt(vo);
    }
}
`;
}

function renderClassicController(model: CrudModel): string {
  const basePath = `/${model.entityVariable}`;
  return `package ${model.controllerPackage};

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;

import ${model.servicePackage}.${model.entityName}Service;
import ${model.voPackage}.${model.entityName}VO;

${javaDoc(model, `${model.entityName} Spring MVC 컨트롤러`)}
@Controller
public class ${model.entityName}Controller {

    private final ${model.entityName}Service ${model.entityVariable}Service;

    public ${model.entityName}Controller(${model.entityName}Service ${model.entityVariable}Service) {
        this.${model.entityVariable}Service = ${model.entityVariable}Service;
    }

    @GetMapping("${basePath}/${model.entityVariable}List.do")
    public String select${model.entityName}List(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo, Model model) throws Exception {
        model.addAttribute("resultList", ${model.entityVariable}Service.select${model.entityName}List(vo));
        model.addAttribute("resultCount", ${model.entityVariable}Service.select${model.entityName}ListTotCnt(vo));
        return "${model.entityVariable}/${model.entityVariable}List";
    }

    @PostMapping("${basePath}/add${model.entityName}View.do")
    public String add${model.entityName}View(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo) {
        return "${model.entityVariable}/${model.entityVariable}Register";
    }

    @PostMapping("${basePath}/add${model.entityName}.do")
    public String add${model.entityName}(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.insert${model.entityName}(vo);
        return "redirect:${basePath}/${model.entityVariable}List.do";
    }

    @PostMapping("${basePath}/update${model.entityName}View.do")
    public String update${model.entityName}View(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo, Model model) throws Exception {
        model.addAttribute("${model.entityVariable}VO", ${model.entityVariable}Service.select${model.entityName}(vo));
        return "${model.entityVariable}/${model.entityVariable}Register";
    }

    @PostMapping("${basePath}/update${model.entityName}.do")
    public String update${model.entityName}(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.update${model.entityName}(vo);
        return "redirect:${basePath}/${model.entityVariable}List.do";
    }

    @PostMapping("${basePath}/delete${model.entityName}.do")
    public String delete${model.entityName}(@ModelAttribute("${model.entityVariable}VO") ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.delete${model.entityName}(vo);
        return "redirect:${basePath}/${model.entityVariable}List.do";
    }
}
`;
}

function renderBootController(model: CrudModel): string {
  return `package ${model.controllerPackage};

import java.util.List;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import ${model.servicePackage}.${model.entityName}Service;
import ${model.voPackage}.${model.entityName}VO;

${javaDoc(model, `${model.entityName} REST 컨트롤러`)}
@RestController
@RequestMapping("/api/${model.entityVariable}")
public class ${model.entityName}Controller {

    private final ${model.entityName}Service ${model.entityVariable}Service;

    public ${model.entityName}Controller(${model.entityName}Service ${model.entityVariable}Service) {
        this.${model.entityVariable}Service = ${model.entityVariable}Service;
    }

    @GetMapping
    public List<${model.entityName}VO> list(${model.entityName}VO vo) throws Exception {
        return ${model.entityVariable}Service.select${model.entityName}List(vo);
    }

    @PostMapping("/detail")
    public ${model.entityName}VO detail(@RequestBody ${model.entityName}VO vo) throws Exception {
        return ${model.entityVariable}Service.select${model.entityName}(vo);
    }

    @PostMapping
    public void create(@RequestBody ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.insert${model.entityName}(vo);
    }

    @PutMapping
    public void update(@RequestBody ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.update${model.entityName}(vo);
    }

    @DeleteMapping
    public void delete(@RequestBody ${model.entityName}VO vo) throws Exception {
        ${model.entityVariable}Service.delete${model.entityName}(vo);
    }
}
`;
}

function jspExpression(value: string): string {
  return "${" + value + "}";
}

function renderListJsp(model: CrudModel): string {
  const headers = model.fields.map((field) => `                    <th scope="col">${field.label}</th>`).join("\n");
  const cells = model.fields.map((field) => `                    <td><c:out value="${jspExpression(`item.${field.propertyName}`)}" /></td>`).join("\n");
  return `<%@ page contentType="text/html; charset=utf-8" pageEncoding="utf-8" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="form" uri="http://www.springframework.org/tags/form" %>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <title>${model.entityName} 목록</title>
</head>
<body>
<main>
    <h1>${model.entityName} 목록</h1>
    <form:form modelAttribute="${model.entityVariable}VO" method="get" action="${model.entityVariable}List.do">
        <form:input path="searchKeyword" />
        <button type="submit">검색</button>
    </form:form>
    <table>
        <thead>
            <tr>
${headers}
            </tr>
        </thead>
        <tbody>
            <c:forEach var="item" items="${jspExpression("resultList")}">
                <tr>
${cells}
                </tr>
            </c:forEach>
        </tbody>
    </table>
    <form method="post" action="add${model.entityName}View.do">
        <button type="submit">등록</button>
    </form>
</main>
</body>
</html>
`;
}

function renderRegisterJsp(model: CrudModel): string {
  const controls = model.fields.map((field) => `        <div>
            <label for="${field.propertyName}">${field.label}</label>
            <form:input path="${field.propertyName}"${field.generated ? " readonly=\"true\"" : ""} />
            <form:errors path="${field.propertyName}" />
        </div>`).join("\n");
  return `<%@ page contentType="text/html; charset=utf-8" pageEncoding="utf-8" %>
<%@ taglib prefix="form" uri="http://www.springframework.org/tags/form" %>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <title>${model.entityName} 등록·수정</title>
</head>
<body>
<main>
    <h1>${model.entityName} 등록·수정</h1>
    <form:form id="detailForm" modelAttribute="${model.entityVariable}VO" method="post">
${controls}
        <button type="submit" formaction="add${model.entityName}.do">등록</button>
        <button type="submit" formaction="update${model.entityName}.do">수정</button>
        <button type="submit" formaction="delete${model.entityName}.do">삭제</button>
    </form:form>
</main>
</body>
</html>
`;
}

function renderServiceTest(model: CrudModel): string {
  return `package ${model.servicePackage};

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

class ${model.entityName}ServiceTest {

    @Test
    void generatedCrudContractContainsExpectedMethods() {
        Set<String> methods = Stream.of(${model.entityName}Service.class.getDeclaredMethods())
            .map(method -> method.getName())
            .collect(Collectors.toSet());

        assertEquals(Set.of(
            "insert${model.entityName}",
            "update${model.entityName}",
            "delete${model.entityName}",
            "select${model.entityName}",
            "select${model.entityName}List",
            "select${model.entityName}ListTotCnt"
        ), methods);
    }
}
`;
}

function planCrudFiles(model: CrudModel): PlannedFile[] {
  const planned: PlannedFile[] = [];
  const add = (relativePath: string, component: PlannedFile["component"], content: string) => {
    planned.push({ relativePath: relativePath.replace(/\\/g, "/"), component, content });
  };
  if (model.checkDataAccess) {
    const voRoot = `src/main/java/${packagePath(model.voPackage)}`;
    add(`${voRoot}/${model.entityName}DefaultVO.java`, "data-access", renderDefaultVo(model));
    add(`${voRoot}/${model.entityName}VO.java`, "data-access", renderVo(model));
    add(
      `src/main/java/${packagePath(model.mapperPackage)}/${model.entityName}Mapper.java`,
      "data-access",
      renderMapperInterface(model),
    );
    add(`${model.mapperFolder}/${model.entityVariable}/${model.entityVariable}_mapper.xml`, "data-access", renderMapperXml(model));
  }
  if (model.checkService) {
    add(
      `src/main/java/${packagePath(model.servicePackage)}/${model.entityName}Service.java`,
      "service",
      renderService(model),
    );
    add(
      `src/main/java/${packagePath(model.implPackage)}/${model.entityName}ServiceImpl.java`,
      "service",
      renderServiceImpl(model),
    );
  }
  if (model.checkWeb) {
    add(
      `src/main/java/${packagePath(model.controllerPackage)}/${model.entityName}Controller.java`,
      "web",
      model.profile === "classic" ? renderClassicController(model) : renderBootController(model),
    );
    if (model.includeJsp) {
      add(`${model.jspFolder}/${model.entityVariable}/${model.entityVariable}List.jsp`, "web", renderListJsp(model));
      add(`${model.jspFolder}/${model.entityVariable}/${model.entityVariable}Register.jsp`, "web", renderRegisterJsp(model));
    }
  }
  if (model.withTest) {
    add(
      `src/test/java/${packagePath(model.servicePackage)}/${model.entityName}ServiceTest.java`,
      "test",
      renderServiceTest(model),
    );
  }
  return planned;
}

export function generateCrud(opts: GenerateCrudOptions): GenerateCrudResult {
  const model = normalizeModel(opts);
  const planned = planCrudFiles(model);
  const files = planned.map((file) => ({
    path: file.relativePath,
    component: file.component,
    bytes: Buffer.byteLength(file.content, "utf-8"),
  }));
  const warnings: string[] = [];
  if (model.fields.some((field) => field.generated))
    warnings.push("generated=true 기본키는 MyBatis useGeneratedKeys를 사용합니다. 대상 DB·드라이버 지원을 확인하세요.");
  if (model.profile === "classic")
    warnings.push("생성 JSP는 최소 골격입니다. 프로젝트의 KRDS 레이아웃·메시지·검증 규칙에 맞게 조정하세요.");
  if (!model.withTest)
    warnings.push("withTest=false: 테스트 골격을 생성하지 않았습니다.");

  const destinations = planned.map((file) => ({ file, absolutePath: path.resolve(model.projectDir, file.relativePath) }));
  for (const destination of destinations) {
    const rel = path.relative(model.projectDir, destination.absolutePath);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw new Error(`생성 경로가 프로젝트 밖을 가리킵니다: ${destination.file.relativePath}`);
  }
  const conflicts = destinations.filter((destination) => fs.existsSync(destination.absolutePath));
  if (conflicts.length > 0)
    throw new Error(
      `기존 파일과 충돌하여 중단합니다(총 ${conflicts.length}건, 아무것도 쓰지 않았습니다):\n` +
      conflicts.slice(0, 10).map((item) => `  - ${item.file.relativePath}`).join("\n") +
      (conflicts.length > 10 ? `\n  … 외 ${conflicts.length - 10}건` : ""),
    );

  const dryRun = opts.dryRun === true;
  if (!dryRun) {
    const written: string[] = [];
    try {
      for (const destination of destinations) {
        fs.mkdirSync(path.dirname(destination.absolutePath), { recursive: true });
        fs.writeFileSync(destination.absolutePath, destination.file.content, { encoding: "utf-8", flag: "wx" });
        written.push(destination.absolutePath);
      }
    } catch (error) {
      for (const writtenPath of written.reverse()) fs.rmSync(writtenPath, { force: true });
      throw new Error(`CRUD 파일 생성 중 오류가 발생해 생성 파일을 롤백했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    projectDir: model.projectDir,
    tableName: model.tableName,
    entityName: model.entityName,
    profile: model.profile,
    files,
    dryRun,
    warnings,
  };
}
