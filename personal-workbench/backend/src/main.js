// main.js — 「标书编制」路由：投标文件生成全过程的阶段、闸口、版本
// 设计：唯一真相源是 bid-tool 项目目录里的 outline.json / 章节 .md；
// 本模块只存阶段、闸口、章节镜像与版本哈希，写回统一由 bw.mjs（HTTP）完成。
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";
import { runBidCmd, PROJECTS_DIR, WORKSPACE, slugDirName } from "./bid-common.js";
// 编号生成统一复用 projects.js 的实现（按 project_code 降序取最大，而非按 id 降序）：
// 旧实现取"最后插入行编号 +1"，当编号顺序与插入顺序不一致（编号有空洞/人工改动）时会撞 UNIQUE 约束。
import { nextProjectCode } from "./projects.js";

const router = Router();

// ---- 流程定义（与 SOP-投标文件生成全过程.md 对齐）----
export const STAGES = ["intake", "outline", "draft", "selfcheck", "merge", "charts", "final", "delivered"];
export const STAGE_LABEL = {
  intake: "S1 立项与交底",
  outline: "S2 目录与页数",
  draft: "S3 章节生成",
  selfcheck: "S4 双重自检",
  merge: "S5 合稿转 Word",
  charts: "S6 图表增强",
  final: "S7 终校",
  delivered: "S8 交付归档",
};
export const GATES = ["G1", "G2", "G3", "G4"];
export const GATE_LABEL = {
  G1: "G1 目录规划确认",
  G2: "G2 草稿审阅",
  G3: "G3 整稿通读",
  G4: "G4 交付终校",
};
// 进入某阶段必须已批准的闸口
const GATE_REQUIRED = { draft: "G1", selfcheck: "G2", charts: "G3", final: "G3", delivered: "G4" };

function jsonOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    tenderProjectId: row.tender_project_id,
    projectName: row.project_name,
    workDir: row.work_dir,
    stage: row.stage,
    stageLabel: STAGE_LABEL[row.stage] || row.stage,
    pageLimit: row.page_limit ?? 0,
    pagesAllocated: row.pages_allocated ?? 0,
    pagesEstimated: row.pages_estimated ?? 0,
    pagesActual: row.pages_actual ?? null,
    scoreCovered: jsonOrNull(row.score_covered_json) || [],
    scoreTotal: row.score_total ?? 0,
    placeholders: row.placeholders ?? 0,
    totalWords: row.total_words ?? 0,
    outlineVersion: row.outline_version ?? null,
    stageUpdatedAt: row.stage_updated_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function gateToApi(row) {
  return {
    gate: row.gate,
    gateLabel: GATE_LABEL[row.gate] || row.gate,
    status: row.status,
    evidence: jsonOrNull(row.evidence_json),
    remark: row.remark,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
  };
}

function chapterToApi(row) {
  return {
    no: row.no,
    title: row.title,
    level: row.level,
    pagesPlanned: row.pages_planned ?? 0,
    wc: row.wc ?? 0,
    status: row.status || "pending",
    file: row.file,
    exists: !!row.exists_flag,
    updatedAt: row.updated_at,
  };
}

function logToApi(row) {
  return {
    id: row.id,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    action: row.action,
    detail: jsonOrNull(row.detail_json),
    createdAt: row.created_at,
  };
}

function getWork(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM bid_work_project WHERE id = ? AND deleted_at IS NULL").get(n);
}

function gatesOf(workId) {
  return db.prepare("SELECT * FROM bid_work_gate WHERE work_project_id = ? ORDER BY gate").all(workId);
}

function ensureGates(workId) {
  const t = now();
  const ins = db.prepare(`INSERT OR IGNORE INTO bid_work_gate (work_project_id, gate, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`);
  for (const g of GATES) ins.run(workId, g, t, t);
}

function logStage(workId, from, to, action, detail) {
  db.prepare(`INSERT INTO bid_work_stage_log (work_project_id, from_stage, to_stage, action, detail_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(workId, from ?? null, to ?? null, action, detail ? JSON.stringify(detail) : null, now());
}

// ---- 列表 ----
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM bid_work_project WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200").all();
  const list = rows.map((r) => {
    const gates = gatesOf(r.id);
    const chapterRows = db.prepare("SELECT status FROM bid_work_chapter WHERE work_project_id = ?").all(r.id);
    const pending = gates.filter((g) => g.status === "pending").map((g) => g.gate);
    const row = db.prepare("SELECT name, status AS bid_status, deadline FROM bid_project WHERE id = ?").get(r.project_id) || {};
    return {
      ...toApi(r),
      bidStatus: row.bid_status ?? null,
      deadline: row.deadline ?? null,
      gatesPending: pending,
      gatesApproved: gates.filter((g) => g.status === "approved").map((g) => g.gate),
      chapterTotal: chapterRows.length,
      chapterReviewed: chapterRows.filter((c) => c.status === "reviewed" || c.status === "final").length,
    };
  });
  ok(res, { list, total: list.length, stages: STAGES, stageLabel: STAGE_LABEL, gates: GATES, gateLabel: GATE_LABEL });
});

// ---- 详情 ----
router.get("/:id", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const bid = db.prepare("SELECT id, project_code, name, status, category, deadline, tenderer FROM bid_project WHERE id = ?").get(row.project_id) || null;
  ok(res, {
    ...toApi(row),
    bidProject: bid,
    gates: gatesOf(row.id).map(gateToApi),
    chapters: db.prepare("SELECT * FROM bid_work_chapter WHERE work_project_id = ? ORDER BY CAST(no AS TEXT)").all(row.id).map(chapterToApi),
    versions: db.prepare("SELECT * FROM bid_work_version WHERE work_project_id = ? ORDER BY id DESC LIMIT 100").all(row.id).map((v) => ({
      id: v.id, kind: v.kind, relPath: v.rel_path, sha256: v.sha256, sizeBytes: v.size_bytes, note: v.note, createdAt: v.created_at,
    })),
    logs: db.prepare("SELECT * FROM bid_work_stage_log WHERE work_project_id = ? ORDER BY id DESC LIMIT 100").all(row.id).map(logToApi),
    stageOrder: STAGES,
    gateRequired: GATE_REQUIRED,
  });
});

// ---- 新建编制项目（自动建目录 + 写参数卡）----
// 两种用法：
//  A. 只给 projectName + pageLimit：自动登记投标项目、自动建 bid 项目目录、自动写参数卡（推荐入口）
//  B. 给 projectId + workDir：绑定已有目录（兼容原流程）
router.post("/", (req, res) => {
  const b = req.body || {};
  const projectName = String(b.projectName ?? "").trim();
  let projectId = Number(b.projectId);
  const autoRegistered = { bid: false, dir: false };

  // 1) 投标项目：没有就自动登记一条（降低开工门槛）
  let proj = null;
  if (Number.isInteger(projectId) && projectId > 0) {
    proj = db.prepare("SELECT id, name, deadline FROM bid_project WHERE id = ? AND deleted_at IS NULL").get(projectId);
    if (!proj) return fail(res, 400, "VALIDATION_ERROR", "投标项目不存在");
  } else {
    if (!projectName) return fail(res, 400, "VALIDATION_ERROR", "请填写项目名称（或选择一个已有的投标项目）", { projectName: "必填" });
    const t = now();
    // 编号冲突兜底：即便编号生成与插入之间存在竞态/异常数据，也重试而不是直接 500
    let info = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        info = db.prepare(`INSERT INTO bid_project (project_code, name, category, status, notes, created_at, updated_at)
          VALUES (?, ?, '工程监理', '已购标书', ?, ?, ?)`)
          .run(nextProjectCode(), projectName, b.notes ? String(b.notes) : null, t, t);
        break;
      } catch (e) {
        lastErr = e;
        if (!/UNIQUE/i.test(String(e?.message || ""))) throw e;   // 非唯一冲突：直接抛出
        console.warn(`[main] project_code 冲突，重试第 ${attempt + 1} 次`);
      }
    }
    if (!info) throw lastErr;
    projectId = Number(info.lastInsertRowid);
    proj = { id: projectId, name: projectName, deadline: null };
    autoRegistered.bid = true;
  }

  const dup = db.prepare("SELECT id FROM bid_work_project WHERE project_id = ? AND deleted_at IS NULL").get(projectId);
  if (dup) return fail(res, 409, "CONFLICT", `该项目已绑定编制项目 #${dup.id}`);

  // 2) 工作目录：没给就按工作区 bid-workflow/projects/<名称> 自动生成并初始化
  let workDir = String(b.workDir ?? "").trim();
  if (!workDir) {
    workDir = path.join(PROJECTS_DIR, slugDirName(projectName || proj.name));
  } else {
    workDir = path.resolve(workDir);
  }
  if (!workDir.startsWith(WORKSPACE)) return fail(res, 400, "VALIDATION_ERROR", "工作目录必须位于工作区内");

  // 3) 目录不存在 → bid init 建骨架（含 project.json 模板）
  const pageLimit = Number(b.pageLimit) || 0;
  if (!fs.existsSync(path.join(workDir, "project.json"))) {
    const r = runBidCmd(WORKSPACE, ["init", workDir], { cwd: WORKSPACE });
    if (r.exitCode !== 0) {
      return fail(res, 500, "INTERNAL", "创建项目目录失败：\n" + (r.log || r.error || "未知错误"));
    }
    autoRegistered.dir = true;
  }

  // 4) 写参数卡（项目名/页数上限/评分标准/招标要求），保留 init 生成的其它字段
  try {
    const pjFile = path.join(workDir, "project.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.projectName = projectName || pj.projectName || proj.name || "";
    if (b.tenderNo) pj.tenderNo = String(b.tenderNo);
    if (b.bidder) pj.bidder = String(b.bidder);
    if (b.client) pj.client = String(b.client);
    if (b.investment) pj.investment = String(b.investment);
    if (b.durationDays) pj.durationDays = Number(b.durationDays) || 0;
    if (b.summary) pj.summary = String(b.summary);
    if (pageLimit) pj.techPageLimit = pageLimit;
    if (Array.isArray(b.scoreCriteria)) pj.scoreCriteria = b.scoreCriteria.map((x) => String(x)).filter(Boolean);
    if (Array.isArray(b.requirements)) pj.requirements = b.requirements.map((x) => String(x)).filter(Boolean);
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2) + "\n", "utf8");
  } catch (e) {
    console.error("[main] 参数卡写入失败:", e?.message || e);
  }

  // 5) 建编制记录 + 四个闸口
  const stage = STAGES.includes(b.stage) ? b.stage : "intake";
  const t = now();
  const info = db.prepare(`
    INSERT INTO bid_work_project (project_id, tender_project_id, project_name, work_dir, stage, page_limit, score_total, stage_updated_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    b.tenderProjectId != null ? Number(b.tenderProjectId) : null,
    String(b.projectName ?? proj.name ?? "").trim() || null,
    workDir,
    stage,
    pageLimit,
    Array.isArray(b.scoreCriteria) ? b.scoreCriteria.length : (Number(b.scoreTotal) || 0),
    t,
    b.notes ? String(b.notes) : null,
    t, t
  );
  const id = Number(info.lastInsertRowid);
  ensureGates(id);
  logStage(id, null, stage, "link", { workDir, projectId, autoRegistered });
  record("create", "main_project", id, { projectId, workDir, stage, autoRegistered });
  ok(res, { ...toApi(getWork(id)), autoRegistered }, 201);
});

// ---- 编辑（项目名/备注/页数上限） ----
router.patch("/:id", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.projectName !== undefined) { sets.push("project_name = ?"); vals.push(String(b.projectName).trim() || null); }
  if (b.notes !== undefined) { sets.push("notes = ?"); vals.push(b.notes === null ? null : String(b.notes)); }
  if (b.pageLimit !== undefined) { sets.push("page_limit = ?"); vals.push(Number(b.pageLimit) || 0); }
  if (b.pagesActual !== undefined) { sets.push("pages_actual = ?"); vals.push(b.pagesActual === null || b.pagesActual === "" ? null : Number(b.pagesActual)); }
  if (!sets.length) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  sets.push("updated_at = ?");
  vals.push(now(), row.id);
  db.prepare(`UPDATE bid_work_project SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  record("update", "main_project", row.id, { fields: Object.keys(b) });
  ok(res, toApi(getWork(row.id)));
});

// ---- 同步（bw.mjs 回写阶段/章节/页数） ----
router.post("/:id/sync", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const b = req.body || {};
  const t = now();
  const stage = STAGES.includes(b.stage) ? b.stage : row.stage;

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE bid_work_project SET
        stage = ?, page_limit = ?, pages_allocated = ?, pages_estimated = ?, pages_actual = ?,
        score_covered_json = ?, score_total = ?, placeholders = ?, total_words = ?,
        outline_version = ?, project_name = COALESCE(?, project_name),
        work_dir = COALESCE(NULLIF(?, ''), work_dir), stage_updated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      stage,
      Number(b.pageLimit) || 0,
      Number(b.pagesAllocated) || 0,
      Number(b.pagesEstimated) || 0,
      b.pagesActual == null || b.pagesActual === "" ? null : Number(b.pagesActual),
      Array.isArray(b.scoreCovered) ? JSON.stringify(b.scoreCovered) : null,
      Number(b.scoreTotal) || 0,
      Number(b.placeholders) || 0,
      Number(b.totalWords) || 0,
      b.outlineVersion == null || b.outlineVersion === "" ? null : Number(b.outlineVersion),
      b.projectName ? String(b.projectName) : null,
      b.workDir ? String(b.workDir) : "",
      t, t, row.id
    );

    const chapters = Array.isArray(b.chapters) ? b.chapters : [];
    const up = db.prepare(`
      INSERT INTO bid_work_chapter (work_project_id, no, title, level, pages_planned, wc, status, file, exists_flag, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(work_project_id, no) DO UPDATE SET
        title = excluded.title, level = excluded.level, pages_planned = excluded.pages_planned,
        wc = excluded.wc, status = excluded.status, file = excluded.file,
        exists_flag = excluded.exists_flag, updated_at = excluded.updated_at
    `);
    for (const c of chapters) {
      if (!c || !c.no) continue;
      up.run(
        row.id, String(c.no), c.title != null ? String(c.title) : null,
        Number(c.level) || 1, Number(c.pagesPlanned) || 0, Number(c.wc) || 0,
        ["pending", "draft", "reviewed", "final"].includes(c.status) ? c.status : "pending",
        c.file ? String(c.file) : null, c.exists ? 1 : 0, t
      );
    }
    // 目录里已删除的章节：标记为不存在（不物理删除，便于追溯）
    if (chapters.length) {
      const nos = chapters.map((c) => String(c.no));
      const keep = new Set(nos);
      for (const old of db.prepare("SELECT no FROM bid_work_chapter WHERE work_project_id = ?").all(row.id)) {
        if (!keep.has(old.no)) db.prepare("DELETE FROM bid_work_chapter WHERE work_project_id = ? AND no = ?").run(row.id, old.no);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return fail(res, 500, "INTERNAL", "同步失败：" + (e?.message || e));
  }

  if (stage !== row.stage) logStage(row.id, row.stage, stage, "sync", { from: row.stage, to: stage });
  record("sync", "main_project", row.id, { stage, chapters: (b.chapters || []).length });
  ok(res, toApi(getWork(row.id)));
});

// ---- 阶段推进 / 回退 ----
router.post("/:id/advance", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const i = STAGES.indexOf(row.stage);
  if (i < 0) return fail(res, 400, "VALIDATION_ERROR", `当前阶段非法: ${row.stage}`);
  if (i >= STAGES.length - 1) return fail(res, 409, "FORBIDDEN_STATUS", "已是最后阶段（delivered）");

  const to = STAGES[i + 1];
  const required = GATE_REQUIRED[to];
  if (required) {
    const g = db.prepare("SELECT * FROM bid_work_gate WHERE work_project_id = ? AND gate = ?").get(row.id, required) || { status: "pending" };
    if (g.status !== "approved") {
      return fail(res, 409, "FORBIDDEN_STATUS",
        `不能推进到 ${STAGE_LABEL[to]}：闸口 ${GATE_LABEL[required]} 尚未批准（当前 ${g.status}）`,
        { gate: required, gateStatus: g.status });
    }
  }
  const t = now();
  db.prepare("UPDATE bid_work_project SET stage = ?, stage_updated_at = ?, updated_at = ? WHERE id = ?").run(to, t, t, row.id);
  logStage(row.id, row.stage, to, "advance", { remark: req.body?.remark ?? null });
  record("status_change", "main_project", row.id, { from: row.stage, to });
  ok(res, { ...toApi(getWork(row.id)), fromStage: row.stage, toStage: to, stage: to });
});

router.post("/:id/rollback", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const i = STAGES.indexOf(row.stage);
  if (i <= 0) return fail(res, 409, "FORBIDDEN_STATUS", "已在首个阶段，无法回退");
  const to = STAGES[i - 1];
  const t = now();
  db.prepare("UPDATE bid_work_project SET stage = ?, stage_updated_at = ?, updated_at = ? WHERE id = ?").run(to, t, t, row.id);
  logStage(row.id, row.stage, to, "rollback", { remark: req.body?.remark ?? null });
  record("status_change", "main_project", row.id, { from: row.stage, to, rollback: true });
  ok(res, { ...toApi(getWork(row.id)), fromStage: row.stage, toStage: to, stage: to });
});

// ---- 闸口批准 / 驳回 ----
router.post("/:id/gates/:gate", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const gate = String(req.params.gate || "").toUpperCase();
  if (!GATES.includes(gate)) return fail(res, 400, "VALIDATION_ERROR", `闸口非法: ${req.params.gate}（应为 G1–G4）`);
  const b = req.body || {};
  const action = b.action === "reject" ? "reject" : b.action === "approve" ? "approve" : null;
  if (!action) return fail(res, 400, "VALIDATION_ERROR", "action 必须是 approve 或 reject", { action: "必填" });

  ensureGates(row.id);
  const cur = db.prepare("SELECT * FROM bid_work_gate WHERE work_project_id = ? AND gate = ?").get(row.id, gate);
  if (action === "reject" && !(b.remark && String(b.remark).trim())) {
    return fail(res, 400, "VALIDATION_ERROR", "驳回必须填写原因", { remark: "必填" });
  }
  const status = action === "approve" ? "approved" : "rejected";
  const t = now();
  db.prepare(`
    UPDATE bid_work_gate SET status = ?, evidence_json = ?, remark = ?, approved_at = ?, updated_at = ?
    WHERE work_project_id = ? AND gate = ?
  `).run(
    status,
    b.evidence && typeof b.evidence === "object" ? JSON.stringify(b.evidence) : null,
    b.remark != null ? String(b.remark) : null,
    action === "approve" ? t : null,   // 驳回时清空批准时间
    t, row.id, gate
  );
  logStage(row.id, row.stage, row.stage, action === "approve" ? "gate_approve" : "gate_reject", { gate, remark: b.remark ?? null, evidence: b.evidence ?? null });
  record(action === "approve" ? "approve" : "reject", "main_gate", cur?.id ?? null, { workProjectId: row.id, gate, status });

  const next = STAGES[STAGES.indexOf(row.stage) + 1] || null;
  ok(res, {
    ...toApi(getWork(row.id)),
    gate: gateToApi(db.prepare("SELECT * FROM bid_work_gate WHERE work_project_id = ? AND gate = ?").get(row.id, gate)),
    nextStage: next,
    nextStageBlockedBy: next && GATE_REQUIRED[next] && GATE_REQUIRED[next] !== gate ? GATE_REQUIRED[next] : null,
  });
});

// ---- 归档（软删除：保留阶段、闸口与版本留痕，看板不再显示） ----
router.post("/:id/archive", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const t = now();
  db.prepare("UPDATE bid_work_project SET deleted_at = ?, updated_at = ? WHERE id = ?").run(t, t, row.id);
  logStage(row.id, row.stage, row.stage, "archive", { remark: req.body?.remark ?? null });
  record("delete", "main_project", row.id, { softDelete: true, stage: row.stage });
  ok(res, { id: row.id, archived: true, deletedAt: t });
});

// ---- 版本记录 ----
router.get("/:id/versions", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const list = db.prepare("SELECT * FROM bid_work_version WHERE work_project_id = ? ORDER BY id DESC LIMIT 200").all(row.id)
    .map((v) => ({ id: v.id, kind: v.kind, relPath: v.rel_path, sha256: v.sha256, sizeBytes: v.size_bytes, note: v.note, createdAt: v.created_at }));
  ok(res, { list, total: list.length });
});

router.post("/:id/versions", (req, res) => {
  const row = getWork(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "编制项目不存在");
  const b = req.body || {};
  const kind = String(b.kind ?? "").trim();
  if (!kind) return fail(res, 400, "VALIDATION_ERROR", "请提供 kind（docx/merged/charts/outline/snapshot…）", { kind: "必填" });
  const info = db.prepare(`
    INSERT INTO bid_work_version (work_project_id, kind, rel_path, sha256, size_bytes, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, kind,
    b.relPath != null ? String(b.relPath) : null,
    b.sha256 != null ? String(b.sha256) : null,
    Number(b.sizeBytes) || 0,
    b.note != null ? String(b.note) : null,
    now()
  );
  record("upload", "main_version", Number(info.lastInsertRowid), { workProjectId: row.id, kind });
  ok(res, { id: Number(info.lastInsertRowid), kind, relPath: b.relPath ?? null, sha256: b.sha256 ?? null, sizeBytes: Number(b.sizeBytes) || 0 }, 201);
});

export { router as mainRouter };
