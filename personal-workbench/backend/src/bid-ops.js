// bid-ops.js — 标书编制操作接口：bid 命令执行、项目文件读写、报告与交付物
// 设计：唯一真相源仍是 bid-tool 项目目录的文件；本路由只是"操作面板"的桥。
// 沙箱约束：子进程输出不 pipe，重定向到日志文件后回读。
import { Router } from "express";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { ok, fail } from "./util.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src → ../../.. = 个人工作台升级优化 → ../../.. = deepseek_harness
const WORKSPACE = path.resolve(__dirname, "..", "..", "..", "..");
const BID_CLI = path.join(WORKSPACE, "bid-tool", "bin", "bid.js");

// 允许执行的命令白名单：网页按钮 → bid CLI 命令/子命令/参数
const CMD_MAP = {
  check: { cmd: "check", flags: ["--materials", "--gate=final"], fixed: [] },
  merge: { cmd: "merge", flags: [], fixed: [] },
  build: { cmd: "build", flags: [], fixed: [] },
  pagecount: { cmd: "pagecount", flags: [], fixed: ["--estimate"] },   // 沙箱内 Word COM 挂起，固定估算
  "charts-cmd": { cmd: "charts", flags: [], sub: "cmd", fixed: [] },
  extract: { cmd: "extract", flags: [], fixed: [] },
};

// 可读文件白名单（相对 workDir 的路径模式；文件名含中文，用 [^\\/]+ 匹配）
const READABLE_PATTERNS = [
  /^project\.json$/,
  /^02-目录规划\/outline(-table)?\.json$|^02-目录规划\/outline-table\.md$/,
  /^05-图表\/charts\.json$/,
  /^03-章节草稿\/[^\\/]+\.md$/,
  /^04-自检报告\/[^\\/]+\.(md|json)$/,
  /^06-合成\/merged\.md$/,
  /^00-输入\/[^\\/]+\.(md|txt|pdf|doc|docx)$/,
  /^README[^\\/]*\.md$/,
];
// 可写文件白名单
const WRITABLE_PATTERNS = [
  /^project\.json$/,
  /^02-目录规划\/outline\.json$/,
  /^05-图表\/charts\.json$/,
  /^03-章节草稿\/[^\\/]+\.md$/,
];

function getWorkDir(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { err: "编制项目 id 非法" };
  const row = db.prepare("SELECT * FROM bid_work_project WHERE id = ? AND deleted_at IS NULL").get(n);
  if (!row) return { err: "编制项目不存在" };
  if (!row.work_dir) return { err: "编制项目未绑定工作目录" };
  const dir = path.resolve(String(row.work_dir));
  if (!dir.startsWith(WORKSPACE)) return { err: "工作目录不在工作区内" };
  if (!fs.existsSync(dir)) return { err: `工作目录不存在: ${dir}` };
  return { dir, row };
}

function safeRelPath(workDir, rel) {
  // 前端 encodeURIComponent 会把 "/" 编成 %2F，express 查询串解码不还原它，这里手动还原
  const raw = String(rel || "").replace(/%2F/gi, "/");
  const abs = path.resolve(workDir, raw);
  // Windows 下 path.relative 用反斜杠，统一为正斜杠再进白名单
  const relNorm = path.relative(workDir, abs).replace(/\\/g, "/");
  if (relNorm.startsWith("..") || path.isAbsolute(relNorm)) return null;
  return { abs, relNorm };
}

function isReadable(relNorm) {
  return READABLE_PATTERNS.some((re) => re.test(relNorm));
}
function isWritable(relNorm) {
  return WRITABLE_PATTERNS.some((re) => re.test(relNorm));
}

// ---- 执行 bid 命令 ----
router.post("/:id/cmd", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const b = req.body || {};
  const cmd = String(b.cmd ?? "");
  const m = CMD_MAP[cmd];
  if (!m) return fail(res, 400, "VALIDATION_ERROR", "命令不在白名单: " + (cmd || "(空)"));
  let args = Array.isArray(b.args) ? b.args.map((x) => String(x)) : [];
  for (const a of args) {
    if (a.startsWith("-") && !m.flags.includes(a)) {
      return fail(res, 400, "VALIDATION_ERROR", `参数不允许: ${a}`);
    }
    // 非 flag 参数必须是项目内相对路径
    if (!a.startsWith("-")) {
      const p = safeRelPath(dir, a);
      if (!p) return fail(res, 400, "VALIDATION_ERROR", "参数必须是项目内相对路径: " + a);
    }
  }
  if (m.cmd === "extract" && !args.length) return fail(res, 400, "VALIDATION_ERROR", "extract 需要文件参数（如 00-输入/xxx.pdf）");

  const logFile = path.join(dir, "04-自检报告", `cmd-${cmd}-${Date.now()}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "w");
  const t0 = Date.now();
  const spawnArgs = [BID_CLI, m.cmd, dir];
  if (m.sub) spawnArgs.push(m.sub);
  spawnArgs.push(...m.fixed, ...args);
  let r;
  try {
    r = spawnSync(process.execPath, spawnArgs, {
      stdio: ["ignore", fd, fd],
      timeout: 180000,
      windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  const log = fs.readFileSync(logFile, "utf8");
  const exitCode = r && r.error ? -1 : (r ? (r.status ?? 0) : -1);
  const resp = {
    cmd, args, exitCode, durationMs: Date.now() - t0,
    log: log.slice(-4000),           // 尾部 4KB 足够看结论
    logFile: path.relative(dir, logFile),
    error: r && r.error ? String(r.error.message) : null,
  };
  if (exitCode === -1) return fail(res, 500, "INTERNAL", "命令执行被系统拒绝（沙箱限制）", resp);
  ok(res, resp);
});

// ---- 读项目文件 ----
router.get("/:id/file", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const p = safeRelPath(dir, req.query.rel);
  if (!p || !isReadable(p.relNorm)) return fail(res, 400, "VALIDATION_ERROR", "文件不在可读白名单");
  if (!fs.existsSync(p.abs)) return fail(res, 404, "NOT_FOUND", "文件不存在: " + p.relNorm);
  const text = fs.readFileSync(p.abs, "utf8");
  ok(res, { rel: p.relNorm, size: Buffer.byteLength(text, "utf8"), content: text });
});

// ---- 写项目文件 ----
router.put("/:id/file", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const b = req.body || {};
  const p = safeRelPath(dir, b.rel);
  if (!p || !isWritable(p.relNorm)) return fail(res, 400, "VALIDATION_ERROR", "文件不在可写白名单");
  if (typeof b.content !== "string") return fail(res, 400, "VALIDATION_ERROR", "content 必填");
  // JSON 文件写前校验
  if (p.relNorm.endsWith(".json")) {
    try { JSON.parse(b.content); } catch (e) { return fail(res, 400, "VALIDATION_ERROR", "JSON 解析失败: " + e.message); }
  }
  // 只增不删铁律：覆盖前备份
  const bak = p.abs + ".bak-" + Date.now();
  if (fs.existsSync(p.abs)) fs.copyFileSync(p.abs, bak);
  fs.mkdirSync(path.dirname(p.abs), { recursive: true });
  fs.writeFileSync(p.abs, b.content, "utf8");
  ok(res, { rel: p.relNorm, size: Buffer.byteLength(b.content, "utf8"), backup: path.relative(dir, bak) });
});

// ---- 自检报告列表 ----
router.get("/:id/reports", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const d = path.join(dir, "04-自检报告");
  if (!fs.existsSync(d)) return ok(res, { list: [] });
  const list = fs.readdirSync(d).filter((f) => f.endsWith(".md") || f.endsWith(".json")).map((f) => {
    const st = fs.statSync(path.join(d, f));
    return { name: f, size: st.size, mtime: st.mtime.toISOString() };
  }).sort((a, b) => b.mtime.localeCompare(a.mtime));
  ok(res, { list });
});

// ---- 交付物列表 ----
router.get("/:id/deliver", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const d = path.join(dir, "99-交付");
  if (!fs.existsSync(d)) return ok(res, { list: [] });
  const list = fs.readdirSync(d).map((f) => {
    const st = fs.statSync(path.join(d, f));
    return { name: f, size: st.size, mtime: st.mtime.toISOString() };
  }).sort((a, b) => b.mtime.localeCompare(a.mtime));
  ok(res, { list });
});

// ---- 下载交付物 ----
router.get("/:id/download", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const rel = String(req.query.rel || "");
  if (!/^99-交付\/[^\\/]+\.(docx|pdf|md)$/.test(rel)) return fail(res, 400, "VALIDATION_ERROR", "仅支持 99-交付/ 下的 docx/pdf/md");
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(path.resolve(dir, "99-交付"))) return fail(res, 400, "VALIDATION_ERROR", "路径越界");
  if (!fs.existsSync(abs)) return fail(res, 404, "NOT_FOUND", "文件不存在");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}`);
  res.setHeader("Content-Type", "application/octet-stream");
  fs.createReadStream(abs).pipe(res);
});

export { router as bidOpsRouter };
