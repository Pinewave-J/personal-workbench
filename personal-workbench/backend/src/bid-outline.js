// bid-outline.js — 目录规划接口：草案生成 / 结构化读写 / 校验 / 闸口联动
// 设计：outline.json 是唯一真相源；本路由负责"生成草案 → 用户改 → 保存 → 重新确认"的闭环。
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { getWorkDir, readOutline, writeOutline, outlineStats, logStage } from "./bid-common.js";
import { buildOutlineDraft, buildChartsDraft } from "./outline-template.js";

const router = Router();

// 把目录同步成章节镜像（工作台章节表随目录变化）
function syncChapters(workId, sections, stats) {
  const t = now();
  db.exec("BEGIN");
  try {
    const up = db.prepare(`INSERT INTO bid_work_chapter (work_project_id, no, title, level, pages_planned, wc, status, file, exists_flag, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?)
      ON CONFLICT(work_project_id, no) DO UPDATE SET title = excluded.title, level = excluded.level,
        pages_planned = excluded.pages_planned, file = excluded.file, updated_at = excluded.updated_at`);
    const keep = new Set();
    for (const s of sections) {
      keep.add(s.no);
      up.run(workId, s.no, s.title, s.level, s.pages, s.status || "pending", s.file || null, t);
    }
    for (const old of db.prepare("SELECT no FROM bid_work_chapter WHERE work_project_id = ?").all(workId)) {
      if (!keep.has(old.no)) db.prepare("DELETE FROM bid_work_chapter WHERE work_project_id = ? AND no = ?").run(workId, old.no);
    }
    db.prepare(`UPDATE bid_work_project SET pages_allocated = ?, page_limit = ?, outline_version = ?, updated_at = ? WHERE id = ?`)
      .run(stats.totalAllocated, stats.pageLimit, stats.version, t, workId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function gateRow(workId, gate) {
  return db.prepare("SELECT * FROM bid_work_gate WHERE work_project_id = ? AND gate = ?").get(workId, gate)
    || { gate, status: "pending", remark: null, approved_at: null };
}

// ---- 目录结构校验（编号格式/唯一/层级/页数/父子/同级连续）----
export function validateSections(sections) {
  const errs = [];
  if (!Array.isArray(sections) || !sections.length) return ["章节列表不能为空"];
  const seen = new Set();
  for (const [i, s] of sections.entries()) {
    const tag = `第 ${i + 1} 行`;
    const no = String(s.no ?? "").trim();
    if (!/^\d+(\.\d+){0,2}$/.test(no)) { errs.push(`${tag}：编号格式非法（应为 1 / 1.1 / 1.1.1），当前「${no || "(空)"}」`); continue; }
    if (seen.has(no)) errs.push(`${tag}：编号重复「${no}」`);
    seen.add(no);
    const wantLevel = no.split(".").length;
    if (Number(s.level) !== wantLevel) errs.push(`${tag}：编号 ${no} 与层级 ${s.level} 不一致（应为 ${wantLevel}）`);
    if (!String(s.title ?? "").trim()) errs.push(`${tag}：标题不能为空`);
    const pages = Number(s.pages);
    if (!Number.isFinite(pages) || pages < 0) errs.push(`${tag}：页数非法「${s.pages}」`);
    if (wantLevel === 1 && !(pages > 0)) errs.push(`${tag}：一级章节页数必须大于 0`);
  }
  const byNo = new Map(sections.map((s) => [String(s.no ?? "").trim(), s]));
  for (const s of sections) {
    const parts = String(s.no ?? "").trim().split(".");
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join(".");
      if (!byNo.has(parent)) errs.push(`章节 ${s.no} 的上级「${parent}」不存在`);
    }
  }
  const groups = new Map();
  for (const s of sections) {
    const parts = String(s.no ?? "").trim().split(".");
    if (parts.length < 2) continue;
    const parent = parts.slice(0, -1).join(".");
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(Number(parts[parts.length - 1]));
  }
  for (const [parent, nums] of groups) {
    nums.sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) { errs.push(`${parent} 下子节编号不连续：期望 ${parent}.${i + 1}，实际 ${parent}.${nums[i]}`); break; }
    }
  }
  return errs.slice(0, 20);
}

// 清洗提交上来的章节（只保留白名单字段）
function normalizeSections(sections, docTitle) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const sanitize = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return sections.map((s) => {
    const no = String(s.no ?? "").trim();
    const level = Number(s.level) || no.split(".").length;
    const title = String(s.title ?? "").trim();
    const out = {
      no, title, level,
      pages: Math.max(0, Math.round(Number(s.pages) || 0)),
      score: Array.isArray(s.score) ? s.score.map((x) => String(x)).filter(Boolean) : (s.score ? [String(s.score)] : []),
      source: String(s.source ?? "").trim(),
      charts: Array.isArray(s.charts) ? s.charts.map((x) => String(x)).filter(Boolean) : (s.charts ? [String(s.charts)] : []),
      status: ["pending", "draft", "reviewed", "final"].includes(s.status) ? s.status : "pending",
    };
    if (level === 1) out.file = String(s.file ?? "").trim() || `03-章节草稿/${pad2(no)}-${sanitize(title)}.md`;
    else if (s.file) out.file = String(s.file).trim();
    return out;
  });
}

// ---- 读目录（含统计、G1 状态、下一步提示）----
router.get("/:id/outline", (req, res) => {
  const { dir, err } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const outline = readOutline(dir);
  const stats = outlineStats(outline);
  const g1 = gateRow(Number(req.params.id), "G1");
  const hasSections = (outline.sections || []).length > 0;
  const over = stats.pageLimit > 0 && stats.totalAllocated > stats.pageLimit;
  let nextAction = { type: "none", text: "" };
  if (!hasSections) nextAction = { type: "draft", text: "点「生成目录草案」出一份可编辑的三级目录" };
  else if (g1.status === "rejected") nextAction = { type: "resubmit", text: `目录已被驳回（${g1.remark || "无原因"}）：修改后点「保存并重新提交」` };
  else if (g1.status !== "approved") nextAction = { type: "confirm", text: "检查目录与页数分配，确认无误后点「提交确认」并批准 G1" };
  else nextAction = { type: "chapters", text: "目录已批准：到「待办任务」里派发章节生成（每批 2-3 章）" };
  ok(res, {
    outline: { meta: outline.meta || {}, sections: outline.sections || [] },
    stats,
    overLimit: over,
    gate: { gate: "G1", status: g1.status, remark: g1.remark || null, approvedAt: g1.approved_at || null },
    nextAction,
  });
});

// ---- 保存目录（用户编辑后提交）----
router.put("/:id/outline", (req, res) => {
  const { dir, err, row } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const b = req.body || {};
  const sections = Array.isArray(b.sections) ? b.sections : null;
  if (!sections) return fail(res, 400, "VALIDATION_ERROR", "缺少 sections");
  const errors = validateSections(sections);
  if (errors.length) return fail(res, 400, "VALIDATION_ERROR", "目录校验未通过", { errors });

  const prev = readOutline(dir);
  const meta = {
    pageLimit: Number(b.meta?.pageLimit ?? prev.meta?.pageLimit) || 0,
    docTitle: String(b.meta?.docTitle ?? prev.meta?.docTitle ?? "").trim(),
    version: (Number(prev.meta?.version) || 0) + 1,
    updatedAt: now(),
  };
  const normalized = normalizeSections(sections, meta.docTitle);
  const next = { meta, sections: normalized };
  const stats = outlineStats(next);
  meta.totalAllocated = stats.totalAllocated;
  writeOutline(dir, next);

  // 目录一变，原 G1 批准作废：重置为待确认（驳回状态也回到待确认，表示"已修改，请重新确认"）
  const g1 = gateRow(Number(req.params.id), "G1");
  let gateReset = false;
  if (g1.status !== "pending") {
    db.prepare(`UPDATE bid_work_gate SET status = 'pending', approved_at = NULL, updated_at = ? WHERE work_project_id = ? AND gate = 'G1'`)
      .run(now(), row.id);
    gateReset = true;
    logStage(row.id, row.stage, row.stage, "outline_update", { version: meta.version, gateResetFrom: g1.status });
  } else {
    logStage(row.id, row.stage, row.stage, "outline_update", { version: meta.version });
  }

  // 同步章节镜像到数据库（工作台章节表随即刷新）
  try {
    syncChapters(row.id, normalized, stats);
  } catch (e) {
    return fail(res, 500, "INTERNAL", "章节镜像同步失败：" + (e?.message || e));
  }

  ok(res, { meta, stats, gateReset, gate: gateRow(Number(req.params.id), "G1"), overLimit: stats.pageLimit > 0 && stats.totalAllocated > stats.pageLimit });
});

// ---- 生成目录草案（可保存）----
router.post("/:id/outline/draft", (req, res) => {
  const { dir, err, row } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const b = req.body || {};
  const outline = readOutline(dir);
  // 页数上限优先级：请求体 > 编制项目记录 > 参数卡 project.json > 目录 meta（0 视为未设置，继续往下取）
  let cardLimit = 0;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    cardLimit = Number(pj.techPageLimit) || 0;
  } catch (e) { cardLimit = 0; }
  const pageLimit = Number(b.pageLimit) || Number(row.page_limit) || cardLimit || Number(outline.meta?.pageLimit) || 0;
  // 上限一旦确定，回写编制项目记录与参数卡，保证后续口径一致
  if (pageLimit > 0 && Number(row.page_limit) !== pageLimit) {
    db.prepare("UPDATE bid_work_project SET page_limit = ?, updated_at = ? WHERE id = ?").run(pageLimit, now(), row.id);
  }

  // 评分标准优先取请求体，其次读项目参数卡 project.json（唯一真相源）
  let scoreCriteria = Array.isArray(b.scoreCriteria) ? b.scoreCriteria.filter(Boolean) : [];
  if (!scoreCriteria.length) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
      scoreCriteria = Array.isArray(pj.scoreCriteria) ? pj.scoreCriteria.filter(Boolean) : [];
    } catch (e) { scoreCriteria = []; }
  }

  const draft = buildOutlineDraft({
    pageLimit,
    scoreCriteria,
    docTitle: b.docTitle || outline.meta?.docTitle,
    projectName: row.project_name,
  });
  const stats = outlineStats(draft);

  if (b.save === true) {
    const prev = readOutline(dir);
    draft.meta.version = (Number(prev.meta?.version) || 0) + 1;
    draft.meta.updatedAt = now();
    draft.meta.totalAllocated = stats.totalAllocated;
    writeOutline(dir, draft);
    // 图表清单草案（编号 图X-Y / 表X-Y）
    try {
      fs.mkdirSync(path.join(dir, "05-图表"), { recursive: true });
      fs.writeFileSync(path.join(dir, "05-图表", "charts.json"), JSON.stringify(buildChartsDraft(draft), null, 2) + "\n", "utf8");
    } catch (e) { console.error("[bid-outline] charts draft failed:", e?.message || e); }
    // 目录重建 → G1 批准作废，回到待确认
    const g1 = gateRow(row.id, "G1");
    if (g1.status !== "pending") {
      db.prepare(`UPDATE bid_work_gate SET status = 'pending', approved_at = NULL, updated_at = ? WHERE work_project_id = ? AND gate = 'G1'`).run(now(), row.id);
    }
    // 章节镜像同步
    syncChapters(row.id, draft.sections, stats);
    // 生成目录 → 阶段自动从 intake 推进到 outline（看板随即正确显示）
    if (row.stage === "intake") {
      const t = now();
      db.prepare("UPDATE bid_work_project SET stage = 'outline', stage_updated_at = ?, updated_at = ? WHERE id = ?").run(t, t, row.id);
      logStage(row.id, "intake", "outline", "advance_auto", { reason: "生成目录草案" });
    }
    logStage(row.id, row.stage, row.stage, "outline_draft", { version: draft.meta.version, chapters: stats.chapterCount });
  }

  ok(res, { outline: draft, stats, saved: b.save === true, overLimit: stats.pageLimit > 0 && stats.totalAllocated > stats.pageLimit });
});

export { router as bidOutlineRouter };
