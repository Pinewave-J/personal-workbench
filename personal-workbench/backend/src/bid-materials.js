// bid-materials.js — 公司级素材库接口（旧标书复用：索引 / 检索 / 片段读取）
// 素材库位置：bid-workflow\materials（8 份真实标书，约 384 万字）；检索由 manage\lib-search.mjs 完成。
// 设计：不复制素材内容，只做"查表 → 定位行号 → 取片段"的桥；改写仍由 AI 在会话里完成。
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { ok, fail } from "./util.js";
import { runNodeCapture, MATERIALS_DIR, WORKFLOW_MANAGE_DIR } from "./bid-common.js";

const router = Router();
const LIB_SEARCH = path.join(WORKFLOW_MANAGE_DIR, "lib-search.mjs");

// ---- 素材清单（解析 _索引.md 的「按素材看」表）----
function listMaterials() {
  const idxFile = path.join(MATERIALS_DIR, "_索引.md");
  if (!fs.existsSync(idxFile)) return { scannedAt: null, materials: [] };
  const md = fs.readFileSync(idxFile, "utf8");
  const scannedAt = (/扫描时间：(.+)/.exec(md) || [])[1] || null;
  const materials = [];
  const re = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/gm;
  let m;
  while ((m = re.exec(md))) {
    const [, name, type, words, items, topics] = m;
    if (/^-+$/.test(name) || name.includes("素材")) continue;   // 跳过表头/分隔行
    materials.push({
      name: name.trim(),
      type: type.trim(),
      words: Number(words),
      items: Number(items),
      topics: topics.split("、").map((s) => s.trim()).filter(Boolean),
      hasIndex: fs.existsSync(path.join(MATERIALS_DIR, name.trim(), "小节索引.md")),
      hasFull: fs.existsSync(path.join(MATERIALS_DIR, name.trim(), "全文.md")),
    });
  }
  return { scannedAt, materials };
}

// ---- 概览与清单 ----
router.get("/", (req, res) => {
  const { scannedAt, materials } = listMaterials();
  const idxFile = path.join(MATERIALS_DIR, "_索引.md");
  ok(res, {
    dir: MATERIALS_DIR.replace(/\\/g, "/"),
    scannedAt,
    total: materials.length,
    totalWords: materials.reduce((a, b) => a + b.words, 0),
    materials,
    indexMarkdown: fs.existsSync(idxFile) ? fs.readFileSync(idxFile, "utf8") : "",
  });
});

// ---- 关键词检索（调 lib-search.mjs --q）----
router.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return fail(res, 400, "VALIDATION_ERROR", "请提供关键词 q");
  const top = Math.min(Math.max(Number(req.query.top) || 10, 1), 50);
  const name = String(req.query.name || "").trim();
  if (!fs.existsSync(LIB_SEARCH)) return fail(res, 500, "INTERNAL", "未找到 manage/lib-search.mjs");

  const args = ["--q", q, "--top", String(top)];
  if (name) args.push("--name", name);
  const r = runNodeCapture(LIB_SEARCH, args, { timeout: 90000 });
  if (r.exitCode !== 0 && !r.text) return fail(res, 500, "INTERNAL", "检索失败", { detail: r.error || r.text });

  const total = Number((/命中\s+(\d+)\s+条/.exec(r.text) || [])[1] || 0);
  const hits = [];
  const re = /^\[([^\]]+)\]\s+(.+?)\s+行\s+(\d+)\s*\n\s*→\s*(.+)$/gm;
  let m;
  while ((m = re.exec(r.text))) {
    hits.push({ kind: m[1].trim(), material: m[2].trim(), line: Number(m[3]), title: m[4].trim() });
  }
  ok(res, { query: q, top, material: name || null, total, hits, raw: hits.length ? null : r.text });
});

// ---- 读取片段（调 lib-search.mjs --read）----
router.get("/read", (req, res) => {
  const name = String(req.query.name || "").trim();
  const line = Number(req.query.line);
  const ctx = Math.min(Math.max(Number(req.query.ctx) || 40, 5), 200);
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "请提供素材名 name");
  if (!Number.isInteger(line) || line <= 0) return fail(res, 400, "VALIDATION_ERROR", "请提供行号 line");
  // 素材名白名单校验：必须真实存在于素材库目录（防越权读取）
  const dir = path.join(MATERIALS_DIR, name);
  if (!dir.startsWith(MATERIALS_DIR) || !fs.existsSync(path.join(dir, "全文.md"))) {
    return fail(res, 404, "NOT_FOUND", "素材不存在: " + name);
  }
  const r = runNodeCapture(LIB_SEARCH, ["--read", name, "--line", String(line), "--ctx", String(ctx)], { timeout: 60000 });
  if (r.exitCode !== 0 && !r.text) return fail(res, 500, "INTERNAL", "读取失败", { detail: r.error || r.text });
  ok(res, { material: name, line, ctx, text: r.text });
});

export { router as bidMaterialsRouter };
