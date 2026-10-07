#!/usr/bin/env node
/* ============================================================
 * wb.mjs — 工作台 AI 暂存队列 CLI（给 DSH skill 调用）
 * ============================================================
 * 为什么需要它：Windows 上用 curl / PowerShell 传中文 JSON 极易踩编码坑
 * （BOM、GBK、被 -d 吃掉换行）。用 node 收发 HTTP 天然 UTF-8，一条命令搞定。
 *
 * 用法（在工作台根目录执行）：
 *   node ai/wb.mjs count                    查看队列角标
 *   node ai/wb.mjs submit notice.txt [来源]  提交公告原文入队（从文件读，UTF-8）
 *   node ai/wb.mjs list                     列出「待解析」任务（含全文，供抽取）
 *   node ai/wb.mjs list 已建议               按状态列出
 *   node ai/wb.mjs show 12                  查看某任务详情
 *   node ai/wb.mjs suggest 12 sug.json      回写建议（sug.json 为建议数组）
 *   node ai/wb.mjs adopt 12 [projectId]     标记已采用（并清空原文）
 *   node ai/wb.mjs ignore 12                忽略
 *   node ai/wb.mjs del 12                   删除
 *
 * 后端地址：默认 http://127.0.0.1:8787/api/v1，可用 WB_BASE 覆盖。
 * ============================================================ */
import { readFileSync } from "node:fs";

const BASE = process.env.WB_BASE || "http://127.0.0.1:8787/api/v1";

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function die(msg, code = 1) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

// Windows 下用 PowerShell `Set-Content -Encoding UTF8` 写出的文件会带 BOM（\uFEFF），
// 裸 JSON.parse 会直接抛 "Unexpected token"。这里统一剥掉，避免踩这个坑。
function readText(file) {
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

async function call(path, opts = {}) {
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch (e) {
    die(`无法连接工作台后端（${BASE}）：${e.message}\n` +
        `请确认后端已启动：cd backend && npm start`);
  }
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || !json || json.success === false) {
    const err = json?.error;
    die(`接口失败 HTTP ${res.status}${err ? ` [${err.code}] ${err.message}` : ""}`);
  }
  return json.data;
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
  process.stdout.write(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 22).map((l) => l.replace(/^ \* ?/, "")).join("\n") + "\n");
  process.exit(0);
}

if (cmd === "count") {
  out(await call("/ai-jobs/pending-count"));
} else if (cmd === "submit") {
  const [file, sourceName] = rest;
  if (!file) die("用法：node ai/wb.mjs submit <公告文本文件> [来源名]");
  let text;
  try { text = readText(file); }
  catch (e) { die(`读取 ${file} 失败：${e.message}`); }
  out(await call("/ai-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputText: text, sourceName: sourceName || file }),
  }));
} else if (cmd === "list") {
  const status = rest[0] || "待解析";
  const data = await call(`/ai-jobs?status=${encodeURIComponent(status)}&pageSize=50`);
  // 列表接口只给预览，抽取需要全文 → 逐条取详情
  const full = [];
  for (const item of data.list) {
    const d = await call(`/ai-jobs/${item.id}`);
    full.push({ id: d.id, status: d.status, sourceName: d.sourceName, inputText: d.inputText, suggestions: d.suggestions });
  }
  out({ total: data.total, jobs: full });
} else if (cmd === "show") {
  if (!rest[0]) die("用法：node ai/wb.mjs show <id>");
  out(await call(`/ai-jobs/${rest[0]}`));
} else if (cmd === "suggest") {
  const [id, file] = rest;
  if (!id || !file) die("用法：node ai/wb.mjs suggest <id> <suggestions.json>");
  let parsed;
  try { parsed = JSON.parse(readText(file)); }
  catch (e) { die(`读取/解析 ${file} 失败：${e.message}`); }
  const suggestions = Array.isArray(parsed) ? parsed : parsed.suggestions;
  if (!Array.isArray(suggestions)) die("JSON 必须是建议数组，或含 suggestions 数组的对象");
  out(await call(`/ai-jobs/${id}/suggestions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, engine: "dsh", suggestions }),
  }));
} else if (cmd === "adopt") {
  if (!rest[0]) die("用法：node ai/wb.mjs adopt <id> [projectId]");
  out(await call(`/ai-jobs/${rest[0]}/adopt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: rest[1] ? Number(rest[1]) : null }),
  }));
} else if (cmd === "ignore") {
  if (!rest[0]) die("用法：node ai/wb.mjs ignore <id>");
  out(await call(`/ai-jobs/${rest[0]}/ignore`, { method: "POST" }));
} else if (cmd === "del") {
  if (!rest[0]) die("用法：node ai/wb.mjs del <id>");
  out(await call(`/ai-jobs/${rest[0]}`, { method: "DELETE" }));
} else {
  die(`未知命令：${cmd}（用 node ai/wb.mjs help 查看用法）`);
}
