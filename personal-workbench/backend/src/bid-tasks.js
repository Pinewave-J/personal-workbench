// bid-tasks.js — 标书编制待办任务队列
// 用途：网页上点「生成目录 / 派发章节 / 自检 / 成稿」→ 写入队列 → 会话侧 AI 领任务执行并回报。
// 流程校验：派发章节生成前必须已批准 G1（目录确认）——这是用户要求的硬门。
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { getWorkDir, workRow, readOutline, logStage } from "./bid-common.js";

const router = Router();

export const TASK_KINDS = {
  outline_draft: { label: "生成目录草案", hint: "按评分标准与页数上限生成三级目录（网页也可一键生成）" },
  chapter_batch: { label: "生成章节", hint: "按目录顺序写章节草稿（每批 2-3 章），写完在网页上审阅" },
  selfcheck: { label: "自检与修复", hint: "跑 bid check + AI 自检（连贯性/评分点覆盖），修复后回报" },
  merge_build: { label: "合并与成稿", hint: "bid merge → bid build → 报页数" },
  charts_cmd: { label: "生成图表渲染脚本", hint: "bid charts <项目> cmd，交用户本地终端执行" },
  final_check: { label: "终校清单", hint: "bid check --gate=final，产出 gate-final.md/json" },
};

const STATUSES = ["pending", "claimed", "done", "failed", "canceled"];

function taskToApi(r) {
  const payload = r.payload_json ? safeJson(r.payload_json) : null;
  const result = r.result_json ? safeJson(r.result_json) : null;
  const meta = TASK_KINDS[r.kind] || { label: r.kind, hint: "" };
  return {
    id: r.id,
    workProjectId: r.work_project_id,
    kind: r.kind,
    kindLabel: meta.label,
    hint: meta.hint,
    status: r.status,
    payload,
    result,
    note: r.note,
    claimedAt: r.claimed_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function getTask(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM bid_work_task WHERE id = ?").get(n);
}

function gateStatus(workId, gate) {
  const r = db.prepare("SELECT status FROM bid_work_gate WHERE work_project_id = ? AND gate = ?").get(workId, gate);
  return r?.status || "pending";
}

// 推断"下一批章节"：目录里尚未生成（status=pending）的一级章节，取前 n 个
function nextChapterBatch(dir, n = 3) {
  const outline = readOutline(dir);
  const lv1 = (outline.sections || []).filter((s) => s.level === 1);
  const pending = lv1.filter((s) => (s.status || "pending") === "pending");
  const batch = pending.slice(0, n);
  return { chapterNos: batch.map((s) => s.no), titles: batch.map((s) => `${s.no} ${s.title}`), remaining: pending.length - batch.length };
}

// ---- 全局待办列表（会话侧领活用）----
router.get("/tasks", (req, res) => {
  const status = String(req.query.status || "pending");
  const projectId = req.query.projectId ? Number(req.query.projectId) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = [];
  const vals = [];
  if (status !== "all") { where.push("t.status = ?"); vals.push(status); }
  if (projectId) { where.push("t.work_project_id = ?"); vals.push(projectId); }
  const sql = `SELECT t.*, p.project_name, p.work_dir, p.stage
               FROM bid_work_task t JOIN bid_work_project p ON p.id = t.work_project_id
               ${where.length ? "WHERE " + where.join(" AND ") + " AND p.deleted_at IS NULL" : "WHERE p.deleted_at IS NULL"}
               ORDER BY t.id ASC LIMIT ${limit}`;
  const rows = db.prepare(sql).all(...vals);
  const list = rows.map((r) => ({ ...taskToApi(r), projectName: r.project_name, workDir: r.work_dir, stage: r.stage }));
  ok(res, { list, total: list.length, status });
});

// ---- 项目内任务列表 ----
router.get("/:id/tasks", (req, res) => {
  const row = workRow(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const rows = db.prepare("SELECT * FROM bid_work_task WHERE work_project_id = ? ORDER BY id DESC LIMIT 100").all(row.id);
  const list = rows.map(taskToApi);
  const pendingCount = list.filter((t) => t.status === "pending").length;
  ok(res, { list, total: list.length, pendingCount, kinds: TASK_KINDS });
});

// ---- 创建任务 ----
router.post("/:id/tasks", (req, res) => {
  const { dir, err, row } = getWorkDir(req.params.id);
  if (err) return fail(res, 400, "VALIDATION_ERROR", err);
  const b = req.body || {};
  const kind = String(b.kind || "");
  if (!TASK_KINDS[kind]) return fail(res, 400, "VALIDATION_ERROR", "任务类型非法: " + (kind || "(空)"));
  const payload = (b.payload && typeof b.payload === "object") ? { ...b.payload } : {};

  // 流程硬门：派发章节生成前必须先批准 G1（目录确认）
  if (kind === "chapter_batch") {
    if (gateStatus(row.id, "G1") !== "approved") {
      return fail(res, 409, "FORBIDDEN_STATUS", "请先确认目录（批准 G1）后再派发章节生成", { gate: "G1", gateStatus: gateStatus(row.id, "G1") });
    }
    if (!Array.isArray(payload.chapterNos) || !payload.chapterNos.length) {
      const batch = nextChapterBatch(dir, Number(payload.batchSize) || 3);
      if (!batch.chapterNos.length) return fail(res, 409, "FORBIDDEN_STATUS", "目录里已经没有待生成的章节了");
      payload.chapterNos = batch.chapterNos;
      payload.titles = batch.titles;
      payload.remaining = batch.remaining;
    }
  }

  const t = now();
  const info = db.prepare(`INSERT INTO bid_work_task (work_project_id, kind, payload_json, status, note, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)`)
    .run(row.id, kind, JSON.stringify(payload), b.note ? String(b.note) : null, t, t);
  const id = Number(info.lastInsertRowid);
  logStage(row.id, row.stage, row.stage, "task_create", { taskId: id, kind, payload });
  ok(res, taskToApi(getTask(id)), 201);
});

// ---- 领取任务（会话侧）----
router.post("/tasks/:tid/claim", (req, res) => {
  const r = getTask(req.params.tid);
  if (!r) return fail(res, 404, "NOT_FOUND", "任务不存在");
  if (r.status !== "pending") return fail(res, 409, "FORBIDDEN_STATUS", `任务当前状态为 ${r.status}，不能领取`);
  const t = now();
  db.prepare("UPDATE bid_work_task SET status = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?").run(t, t, r.id);
  const p = db.prepare("SELECT * FROM bid_work_project WHERE id = ?").get(r.work_project_id) || {};
  logStage(r.work_project_id, p.stage, p.stage, "task_claim", { taskId: r.id, kind: r.kind });
  ok(res, { ...taskToApi(getTask(r.id)), projectName: p.project_name, workDir: p.work_dir, stage: p.stage });
});

// ---- 回报任务结果（会话侧）----
router.post("/tasks/:tid/finish", (req, res) => {
  const r = getTask(req.params.tid);
  if (!r) return fail(res, 404, "NOT_FOUND", "任务不存在");
  if (!["claimed", "pending"].includes(r.status)) return fail(res, 409, "FORBIDDEN_STATUS", `任务已结束（${r.status}）`);
  const b = req.body || {};
  const status = b.status === "failed" ? "failed" : "done";
  const t = now();
  db.prepare("UPDATE bid_work_task SET status = ?, result_json = ?, note = COALESCE(?, note), finished_at = ?, updated_at = ? WHERE id = ?")
    .run(status, b.result ? JSON.stringify(b.result) : null, b.note != null ? String(b.note) : null, t, t, r.id);
  const p = db.prepare("SELECT * FROM bid_work_project WHERE id = ?").get(r.work_project_id) || {};
  logStage(r.work_project_id, p.stage, p.stage, status === "done" ? "task_done" : "task_failed", { taskId: r.id, kind: r.kind, result: b.result || null });
  ok(res, taskToApi(getTask(r.id)));
});

// ---- 取消任务（网页侧）----
router.post("/tasks/:tid/cancel", (req, res) => {
  const r = getTask(req.params.tid);
  if (!r) return fail(res, 404, "NOT_FOUND", "任务不存在");
  if (["done", "failed", "canceled"].includes(r.status)) return fail(res, 409, "FORBIDDEN_STATUS", `任务已结束（${r.status}）`);
  const t = now();
  db.prepare("UPDATE bid_work_task SET status = 'canceled', finished_at = ?, updated_at = ?, note = COALESCE(?, note) WHERE id = ?")
    .run(t, t, req.body?.note != null ? String(req.body.note) : null, r.id);
  const p = db.prepare("SELECT * FROM bid_work_project WHERE id = ?").get(r.work_project_id) || {};
  logStage(r.work_project_id, p.stage, p.stage, "task_cancel", { taskId: r.id });
  ok(res, taskToApi(getTask(r.id)));
});

export { router as bidTasksRouter };
