// node test/progress-mcp.mjs — MCP 경계의 진행 알림·취소 (v1.2, 오프라인)
//   (1) 클라이언트가 progressToken 을 주면 tools/call 중에 notifications/progress 가 단계 순서대로 온다(단조 증가, 마지막은 total)
//   (2) progressToken 이 없으면 알림이 없다
//   (3) notifications/cancelled 가 오면 자식 프로세스가 끝나고 호출은 응답 없이 멈춘다(클라이언트 쪽은 AbortError)
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { makeModern } from "./fixtures/i18n-fixture.mjs";

let n = 0;
function assert(cond, msg) { n++; if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); }
const m = await import("../dist/index.js");
const root = mkdtempSync(path.join(tmpdir(), "egovprog-"));
const modern = makeModern(path.join(root, "modern"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const server = m.buildServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await server.connect(st); await client.connect(ct);
  return { server, client, close: async () => { await client.close(); await server.close(); } };
}

try {
  // (1) 납품 패키지: 항목마다 한 단계 + write package. progressToken 은 onprogress 를 주면 SDK 가 붙인다
  {
    const { client, close } = await connect();
    const events = [];
    const res = await client.callTool({ name: "prepare_egovframe_delivery", arguments: { projectDir: modern, outputDir: path.join(root, "dl"), include: ["secure-coding", "dependencies", "deploy"], dryRun: false, format: "json" } }, undefined, { onprogress: (p) => events.push(p) });
    assert(!res.isError && JSON.parse(res.content[0].text).mode === "prepare", "prepare_egovframe_delivery 성공");
    assert(events.length >= 4 && events.every((e, i) => i === 0 || e.progress >= events[i - 1].progress), `진행 알림 ${events.length}건, 단조 증가`);
    assert(events.every((e) => e.total === 4) && events.at(-1).progress === 4, "total 4(항목 3 + write package), 마지막 = total");
    assert(/secure-coding|dependencies|deploy/.test(events[0].message ?? "") && /done|write package|ready/i.test(events.at(-1).message ?? ""), `메시지: "${events[0].message}" … "${events.at(-1).message}"`);
    assert(events.every((e) => !/[가-힣]/.test(e.message ?? "")), "진행 메시지는 영문");
    await close();
  }
  // (2) progressToken 없음 → 알림 없음
  {
    const { client, close } = await connect();
    let got = 0;
    client.setNotificationHandler(m.ProgressNotificationSchema ?? (await import("@modelcontextprotocol/sdk/types.js")).ProgressNotificationSchema, () => { got++; });
    const res = await client.callTool({ name: "prepare_egovframe_delivery", arguments: { projectDir: modern, outputDir: path.join(root, "dl2"), include: ["secure-coding"], dryRun: false, format: "json" } });
    assert(!res.isError && got === 0, "progressToken 없으면 notifications/progress 없음");
    await close();
  }
  // (3) 취소: build_egovframe_project 가 실제 자식 프로세스(mvnw 가장)를 띄운 뒤 cancelled → 프로세스 종료, 호출은 AbortError
  {
    const proj = path.join(root, "cancel");
    makeModern(proj);
    const pidFile = path.join(root, "child.pid");
    // 프로젝트의 mvnw 를 가짜로: pid 를 기록하고 60초 기다리는 node 스크립트
    const isWin = process.platform === "win32";
    const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);`;
    writeFileSync(path.join(proj, "fake.js"), script);
    if (isWin) writeFileSync(path.join(proj, "mvnw.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake.js"\r\n`);
    else { writeFileSync(path.join(proj, "mvnw"), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.js"\n`); const { chmodSync } = await import("node:fs"); chmodSync(path.join(proj, "mvnw"), 0o755); }
    const { client, close } = await connect();
    const ac = new AbortController();
    const events = [];
    const call = client.callTool({ name: "build_egovframe_project", arguments: { projectDir: proj, goal: "compile", timeoutMs: 50_000 } }, undefined, { signal: ac.signal, onprogress: (p) => events.push(p) });
    const t0 = Date.now();
    while (!existsSync(pidFile) && Date.now() - t0 < 10_000) await sleep(50);
    assert(existsSync(pidFile), "가짜 빌드 프로세스 시작(pid 기록)");
    const pid = Number(readFileSync(pidFile, "utf8"));
    ac.abort(new Error("user cancelled"));
    const err = await call.then(() => null, (e) => e);
    assert(err && /abort|cancel/i.test(String(err?.name ?? "") + String(err?.message ?? "")), `클라이언트 호출은 취소 오류로 끝남 (${err?.name}: ${String(err?.message).slice(0, 60)})`);
    let alive = true;
    for (let i = 0; i < 60 && alive; i++) { try { process.kill(pid, 0); await sleep(50); } catch { alive = false; } }
    assert(!alive, `자식 프로세스(pid ${pid})가 취소 뒤 3초 안에 종료됨`);
    assert(events.length >= 1 && /compile/.test(events[0].message ?? ""), "취소 전 시작 단계 알림은 도착");
    await close();
  }
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (process.exitCode) console.error(`progress-mcp FAIL (${n} assertions)`); else console.log(`progress-mcp OK (${n} assertions)`);
