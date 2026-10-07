// bid-common.js — 标书编制相关路由的共享工具（工作目录校验 / 路径白名单 / 命令执行 / outline 读写）
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { now } from "./util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src → 上四级 = deepseek_harness（工作区根）
export const WORKSPACE = path.resolve(__dirname, "..", "..", "..", "..");
export const PROJECTS_DIR = path.join(WORKSPACE, "bid-workflow", "projects");
export const BID_CLI = path.join(WORKSPACE, "bid-tool", "bin", "bid.js");

// 可读文件白名单（相对 workDir 的路径模式；文件名含中文，用 [^\\/]+ 匹配）
export const READABLE_PATTERNS = [
  /^project\.json$/,
  /^02-目录规划\/outline(-table)?\.json$|^02-目录规划\/outline-table\.md$/,
  /^05-图表\/charts\.json$/,
  /^03-章节草稿\/[^\\/]+\.md$/,
  /^04-自检报告\/[^\\/]+\.(md|json|log)$/,
  /^06-合成\/merged\.md$/,
  /^00-输入\/[^\\/]+\.(md|txt|pdf|doc|docx)$/,
  /^README[^\\/]*\.md$/,
];
// 可写文件白名单
export const WRITABLE_PATTERNS = [
  /^project\.json$/,
  /^02-目录规划\/outline\.json$/,
  /^05-图表\/charts\.json$/,
  /^03-章节草稿\/[^\\/]+\.md$/,
];

export function workRow(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM bid_work_project WHERE id = ? AND deleted_at IS NULL").get(n);
}

// 取编制项目的工作目录（含工作区边界校验）
export function getWorkDir(id) {
  const row = workRow(id);
  if (!row) return { err: "编制项目不存在" };
  if (!row.work_dir) return { err: "编制项目未绑定工作目录" };
  const dir = path.resolve(String(row.work_dir));
  if (!dir.startsWith(WORKSPACE)) return { err: "工作目录不在工作区内" };
  if (!fs.existsSync(dir)) return { err: `工作目录不存在: ${dir}` };
  return { dir, row };
}

export function safeRelPath(workDir, rel) {
  // 前端 encodeURIComponent 会把 "/" 编成 %2F，express 查询串解码不还原它，这里手动还原
  const raw = String(rel || "").replace(/%2F/gi, "/");
  const abs = path.resolve(workDir, raw);
  // Windows 下 path.relative 用反斜杠，统一为正斜杠再进白名单
  const relNorm = path.relative(workDir, abs).replace(/\\/g, "/");
  if (relNorm.startsWith("..") || path.isAbsolute(relNorm)) return null;
  return { abs, relNorm };
}

export const isReadable = (relNorm) => READABLE_PATTERNS.some((re) => re.test(relNorm));
export const isWritable = (relNorm) => WRITABLE_PATTERNS.some((re) => re.test(relNorm));

// 执行 bid CLI：输出重定向到日志文件后回读（沙箱禁止管道子进程）
export function runBidCmd(dir, args, opts = {}) {
  const logDir = path.join(dir, "04-自检报告");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `cmd-${(args[0] || "cmd")}-${Date.now()}.log`);
  const fd = fs.openSync(logFile, "w");
  const t0 = Date.now();
  let r;
  try {
    r = spawnSync(process.execPath, [BID_CLI, ...args], {
      stdio: ["ignore", fd, fd],
      timeout: opts.timeout || 180000,
      windowsHide: true,
      cwd: opts.cwd || dir,
    });
  } finally {
    fs.closeSync(fd);
  }
  const log = fs.readFileSync(logFile, "utf8");
  return {
    exitCode: r && r.error ? -1 : (r ? (r.status ?? 0) : -1),
    durationMs: Date.now() - t0,
    log: log.slice(-4000),
    logFile: path.relative(dir, logFile).replace(/\\/g, "/"),
    error: r && r.error ? String(r.error.message) : null,
  };
}

// ---- outline.json 读写 ----
export function outlineFileOf(dir) {
  return path.join(dir, "02-目录规划", "outline.json");
}

export function readOutline(dir) {
  const f = outlineFileOf(dir);
  if (!fs.existsSync(f)) return { meta: { pageLimit: 0, totalAllocated: 0, version: 0 }, sections: [] };
  try {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!Array.isArray(data.sections)) data.sections = [];
    return data;
  } catch (e) {
    throw new Error("outline.json 解析失败: " + e.message);
  }
}

export function writeOutline(dir, data) {
  const f = outlineFileOf(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak-" + Date.now());
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// 目录统计（供接口与前端口径一致）
export function outlineStats(outline) {
  const sections = outline.sections || [];
  const lv1 = sections.filter((s) => s.level === 1);
  const totalAllocated = lv1.reduce((a, b) => a + (Number(b.pages) || 0), 0);
  const scoreItems = new Set();
  for (const s of sections) for (const x of (s.score || [])) scoreItems.add(String(x));
  return {
    chapterCount: lv1.length,
    sectionCount: sections.length,
    totalAllocated,
    pageLimit: Number(outline.meta?.pageLimit) || 0,
    scoreCovered: [...scoreItems],
    version: Number(outline.meta?.version) || 0,
    docTitle: outline.meta?.docTitle || "",
  };
}

// 记录阶段日志（与 main.js 的 logStage 同构；任务/闸口等动作都留痕）
export function logStage(workId, from, to, action, detail) {
  try {
    db.prepare(`INSERT INTO bid_work_stage_log (work_project_id, from_stage, to_stage, action, detail_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(workId, from ?? null, to ?? null, action, detail ? JSON.stringify(detail) : null, now());
  } catch (e) {
    console.error("[bid-common] logStage failed:", e?.message || e);
  }
}

export function slugDirName(name) {
  return String(name || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "").slice(0, 60) || `项目-${Date.now()}`;
}

// ---- 通用：运行 node 脚本并捕获输出 ----
// 沙箱禁止带管道的子进程，因此把 stdout/stderr 重定向到固定文件后读回（同一文件复用，不堆积）
export function runNodeCapture(scriptPath, args, opts = {}) {
  const outFile = path.join(WORKSPACE, "_test", "capture-last.txt");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const fd = fs.openSync(outFile, "w");
  let r;
  try {
    r = spawnSync(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", fd, fd],
      timeout: opts.timeout || 60000,
      cwd: opts.cwd || path.dirname(scriptPath),
      windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  let text = "";
  try { text = fs.readFileSync(outFile, "utf8"); } catch (e) { text = ""; }
  return {
    exitCode: r && r.error ? -1 : (r ? (r.status ?? 0) : -1),
    text,
    error: r && r.error ? String(r.error.message) : null,
  };
}

export const MATERIALS_DIR = path.join(WORKSPACE, "bid-workflow", "materials");
export const WORKFLOW_MANAGE_DIR = path.join(WORKSPACE, "bid-workflow", "manage");
