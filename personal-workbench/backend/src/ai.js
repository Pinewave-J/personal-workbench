// AI 助手路由：暂存队列（AI → 建议 → 人工确认 → 既有接口落库）
// 设计依据：ai-assist-design.md §5 / §6
//
// 铁律：本模块【只读写 ai_job / ai_suggestion 两张暂存表】，绝不写 bid_project。
// 落库仍由前端点「保存」走既有 POST /projects，从而 project_code 生成、状态机校验、
// 金额归一、audit_log 全部照旧生效。
import { Router } from "express";
import { createHash } from "node:crypto";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { CATEGORY } from "./status.js";
import { record } from "./audit.js";

const router = Router();

export const JOB_STATUS = ["待解析", "已建议", "已采用", "已忽略", "失败"];
export const JOB_KIND = ["notice_extract"];               // 预留 weekly_report / result_extract
const CONFIDENCE_LEVELS = ["high", "medium", "low"];

const MAX_SUGGESTIONS = 30;        // 单次回写条数上限
const MAX_INPUT_CHARS = 100000;    // 单条原文上限（约 100k 字符，够放整份招标文件）
const MAX_TEXT_LEN = 200;

/* ============================================================
 * 可抽字段白名单
 * ============================================================
 * = projects.js 的 WRITABLE（18 个）减去 bidPrice → 17 个可抽字段。
 * 另有两个字段【故意排除】，不在此表中：
 *   - bidPrice   公告里不存在报价，只有投标人自己知道
 *   - openTime   本就不在 WRITABLE 内；且 db.js 启动时执行
 *                UPDATE bid_project SET open_time = deadline，AI 给了也会被覆盖
 *   - status / projectCode  服务端职责（编号需连续唯一、状态受状态机校验）
 */
const TEXT_FIELDS = {
  name: MAX_TEXT_LEN, tenderNo: MAX_TEXT_LEN, lotNo: MAX_TEXT_LEN,
  region: MAX_TEXT_LEN, tenderer: MAX_TEXT_LEN, agency: MAX_TEXT_LEN,
  contactName: MAX_TEXT_LEN, contactPhone: MAX_TEXT_LEN, duration: MAX_TEXT_LEN,
  industry: 100, notes: 2000,
};
const MONEY_FIELDS = ["budget", "bond"];
const DATE_FIELDS = ["deadline", "registerTime"];
const INT_FIELDS = { validityDays: [1, 3650] };
const ENUM_FIELDS = { category: CATEGORY };

const ALLOWED_FIELDS = new Set([
  ...Object.keys(TEXT_FIELDS),
  ...MONEY_FIELDS,
  ...DATE_FIELDS,
  ...Object.keys(INT_FIELDS),
  ...Object.keys(ENUM_FIELDS),
]);

/* ============================================================
 * 归一与校验（不信任模型输出）
 * ============================================================ */

// 金额单位 → 元 的乘数。返回：正数为乘数 / null 表示"没给单位" / NaN 表示"给了但认不出"
function moneyMultiplier(unit) {
  const u = String(unit ?? "").trim().replace(/\s/g, "");
  if (!u) return null;
  if (/^(元|圆|人民币元|元整|人民币)$/.test(u)) return 1;
  if (/^(万|万元|万圆|人民币万元|万元整)$/.test(u)) return 1e4;
  if (/^(亿|亿元|人民币亿元|亿元整)$/.test(u)) return 1e8;
  return NaN;
}

// unit 缺失时的兜底：从 evidence 原文里认单位。认不出返回 null（宁可不填，不可填错量级）
function unitFromEvidence(evidence) {
  const t = String(evidence ?? "");
  if (!t) return null;
  if (/[亿億]/.test(t)) return 1e8;
  if (/万/.test(t)) return 1e4;
  if (/元/.test(t)) return 1;
  return null;
}

// 金额一律归一为「元」。这是防 "100万元 → 100元" 事故的关键闸门。
function normMoney(rawValue, unit, evidence) {
  const num = Number(String(rawValue ?? "").replace(/[,，\s]/g, ""));
  if (!Number.isFinite(num) || num < 0) return { ok: false, reason: "value_not_number" };
  let mult = moneyMultiplier(unit);
  if (mult === null) mult = unitFromEvidence(evidence);
  if (mult === null) return { ok: false, reason: "unit_missing" };
  if (Number.isNaN(mult)) return { ok: false, reason: "unit_unrecognized" };
  return { ok: true, value: Math.round(num * mult * 100) / 100 };
}

// 日期必须是真实的 YYYY-MM-DD（拒绝 2026-02-30、2026/10/12 等）
function normDate(raw) {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 校验并归一单条建议。
 * @returns {{ok:true, field:string, value:string, unit:string|null, confidence:string, evidence:string|null}
 *          | {ok:false, reason:string}}
 */
function normalizeSuggestion(item) {
  if (!item || typeof item !== "object") return { ok: false, reason: "not_an_object" };
  const field = String(item.field ?? "").trim();
  if (!field) return { ok: false, reason: "field_missing" };
  if (!ALLOWED_FIELDS.has(field)) return { ok: false, reason: "field_not_allowed" };

  const evidenceRaw = item.evidence == null ? "" : String(item.evidence).trim();
  const evidence = evidenceRaw ? evidenceRaw.slice(0, 500) : null;
  const confidence = CONFIDENCE_LEVELS.includes(item.confidence) ? item.confidence : "medium";
  const unitRaw = item.unit == null ? null : String(item.unit).trim() || null;

  let value;

  if (MONEY_FIELDS.includes(field)) {
    const r = normMoney(item.value, unitRaw, evidence);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.value <= 0) return { ok: false, reason: "value_not_positive" };
    value = String(r.value);
  } else if (DATE_FIELDS.includes(field)) {
    const d = normDate(item.value);
    if (!d) return { ok: false, reason: "invalid_date_expected_YYYY-MM-DD" };
    value = d;
  } else if (Object.prototype.hasOwnProperty.call(INT_FIELDS, field)) {
    const [lo, hi] = INT_FIELDS[field];
    const n = Number(item.value);
    if (!Number.isInteger(n) || n < lo || n > hi) return { ok: false, reason: `invalid_integer_expected_${lo}_${hi}` };
    value = String(n);
  } else if (Object.prototype.hasOwnProperty.call(ENUM_FIELDS, field)) {
    const v = String(item.value ?? "").trim();
    // 注意：这里【故意不】沿用 projects.js 的"非法值静默回退其他"，否则用户会以为 AI 填对了
    if (!ENUM_FIELDS[field].includes(v)) return { ok: false, reason: "value_not_in_enum" };
    value = v;
  } else {
    const v = String(item.value ?? "").trim();
    if (!v) return { ok: false, reason: "value_empty" };
    if (v.length > TEXT_FIELDS[field]) return { ok: false, reason: "value_too_long" };
    value = v;
  }

  return { ok: true, field, value, unit: unitRaw, confidence, evidence };
}

/* ============================================================
 * 行映射
 * ============================================================ */
function safeParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function jobToApi(row, extra = {}) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    sourceName: row.source_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    engine: row.engine,
    error: row.error,
    dropped: safeParse(row.dropped_json) || [],
    textPurged: !!row.text_purged,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suggestedAt: row.suggested_at,
    adoptedAt: row.adopted_at,
    ...extra,
  };
}

function sugToApi(row) {
  return {
    id: row.id,
    field: row.field,
    value: row.value,
    unit: row.unit,
    confidence: row.confidence,
    evidence: row.evidence,
  };
}

function getJob(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM ai_job WHERE id = ?").get(n) ?? null;
}

function suggestionsOf(jobId) {
  return db.prepare("SELECT * FROM ai_suggestion WHERE job_id = ? ORDER BY id").all(jobId);
}

function hashText(t) {
  return createHash("sha256").update(t, "utf8").digest("hex");
}

/* ============================================================
 * 接口
 * ============================================================ */

// --- 轻量角标（必须注册在 /:id 之前，否则会被 :id 吃掉） ---
router.get("/pending-count", (req, res) => {
  const rows = db.prepare("SELECT status, COUNT(*) AS c FROM ai_job GROUP BY status").all();
  const by = {};
  for (const r of rows) by[r.status] = r.c;
  ok(res, { pending: by["待解析"] || 0, suggested: by["已建议"] || 0, adopted: by["已采用"] || 0, total: rows.reduce((s, r) => s + r.c, 0) });
});

// --- 批量清理（设置页的隐私清理入口；默认只清已终结的任务，保留待处理队列） ---
router.post("/purge", (req, res) => {
  const raw = req.body?.statuses;
  const statuses = Array.isArray(raw) && raw.length ? raw.map(String) : ["已采用", "已忽略", "失败"];
  for (const s of statuses) {
    if (!JOB_STATUS.includes(s)) return fail(res, 400, "VALIDATION_ERROR", "不支持的 status", { status: `应为 ${JOB_STATUS.join(" / ")}` });
  }
  const ph = statuses.map(() => "?").join(",");
  const ids = db.prepare(`SELECT id FROM ai_job WHERE status IN (${ph})`).all(...statuses).map((r) => r.id);
  if (!ids.length) return ok(res, { deleted: 0, statuses });

  db.exec("BEGIN");
  try {
    const phId = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM ai_suggestion WHERE job_id IN (${phId})`).run(...ids);
    db.prepare(`DELETE FROM ai_job WHERE id IN (${phId})`).run(...ids);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return fail(res, 500, "INTERNAL", "清理失败：" + (e?.message || e));
  }
  record("ai_purge", "ai_job", null, { deleted: ids.length, statuses });
  ok(res, { deleted: ids.length, statuses });
});

// --- 1) 提交待解析文本（幂等去重） ---
router.post("/", (req, res) => {
  const body = req.body || {};
  const kind = body.kind == null ? "notice_extract" : String(body.kind);
  if (!JOB_KIND.includes(kind)) return fail(res, 400, "VALIDATION_ERROR", "不支持的 kind", { kind: `应为 ${JOB_KIND.join(" / ")}` });

  const inputText = String(body.inputText ?? "");
  if (!inputText.trim()) return fail(res, 400, "VALIDATION_ERROR", "公告原文不能为空", { inputText: "必填" });
  if (inputText.length > MAX_INPUT_CHARS) {
    return fail(res, 400, "VALIDATION_ERROR", `公告原文过长（上限 ${MAX_INPUT_CHARS} 字符）`, { inputText: `当前 ${inputText.length}` });
  }

  const inputHash = hashText(inputText);
  const dup = db.prepare(
    "SELECT * FROM ai_job WHERE input_hash = ? AND kind = ? AND status IN ('待解析','已建议') ORDER BY id DESC LIMIT 1"
  ).get(inputHash, kind);
  if (dup) {
    return ok(res, jobToApi(dup, { deduped: true, suggestionCount: suggestionsOf(dup.id).length }));
  }

  const t = now();
  const sourceName = body.sourceName == null ? null : String(body.sourceName).trim().slice(0, MAX_TEXT_LEN) || null;
  const info = db.prepare(`
    INSERT INTO ai_job (kind, input_text, input_hash, source_name, status, engine, created_at, updated_at)
    VALUES (?, ?, ?, ?, '待解析', 'dsh', ?, ?)
  `).run(kind, inputText, inputHash, sourceName, t, t);

  const id = Number(info.lastInsertRowid);
  record("ai_submit", "ai_job", id, { kind, chars: inputText.length, sourceName });
  ok(res, jobToApi(getJob(id), { deduped: false, suggestionCount: 0 }), 201);
});

// --- 2) 队列列表（不返回 input_text 全文，避免响应过大） ---
router.get("/", (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push("status = ?"); params.push(String(req.query.status)); }
  if (req.query.kind) { where.push("kind = ?"); params.push(String(req.query.kind)); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ai_job ${whereSql}`).get(...params);
  const rows = db.prepare(`SELECT * FROM ai_job ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);

  const cntStmt = db.prepare("SELECT COUNT(*) AS c FROM ai_suggestion WHERE job_id = ?");
  const list = rows.map((r) => jobToApi(r, {
    inputPreview: r.text_purged ? null : String(r.input_text || "").slice(0, 80),
    inputChars: r.text_purged ? 0 : String(r.input_text || "").length,
    suggestionCount: cntStmt.get(r.id).c,
  }));
  ok(res, { list, total, page, pageSize });
});

// --- 3) 详情（含原文与建议） ---
router.get("/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, "NOT_FOUND", "任务不存在");
  ok(res, jobToApi(job, {
    inputText: job.text_purged ? null : job.input_text,
    suggestions: suggestionsOf(job.id).map(sugToApi),
  }));
});

// --- 4) DSH 回写建议（本模块的核心入口） ---
router.post("/:id/suggestions", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, "NOT_FOUND", "任务不存在");

  const body = req.body || {};
  const items = body.suggestions;
  if (!Array.isArray(items)) return fail(res, 400, "VALIDATION_ERROR", "suggestions 必须是数组");
  if (items.length > MAX_SUGGESTIONS) {
    return fail(res, 400, "VALIDATION_ERROR", `单次回写不得超过 ${MAX_SUGGESTIONS} 条`, { suggestions: `当前 ${items.length}` });
  }

  const accepted = [];
  const dropped = [];
  for (const it of items) {
    const r = normalizeSuggestion(it);
    if (r.ok) accepted.push(r);
    else dropped.push({ field: it && it.field != null ? String(it.field) : null, value: it && it.value != null ? String(it.value).slice(0, 80) : null, reason: r.reason });
  }

  const t = now();
  // 整批替换：技能每次回写都提交该任务的完整字段集，替换语义可避免上一轮的陈旧建议残留。
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ai_suggestion WHERE job_id = ?").run(job.id);
    const ins = db.prepare(
      "INSERT INTO ai_suggestion (job_id, field, value, unit, confidence, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const s of accepted) ins.run(job.id, s.field, s.value, s.unit, s.confidence, s.evidence, t);
    db.prepare("UPDATE ai_job SET status = '已建议', engine = ?, error = NULL, dropped_json = ?, suggested_at = ?, updated_at = ? WHERE id = ?")
      .run(body.engine ? String(body.engine).slice(0, 40) : job.engine || "dsh", JSON.stringify(dropped), t, t, job.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    return fail(res, 500, "INTERNAL", "回写失败：" + (e?.message || e));
  }

  record("ai_suggest", "ai_job", job.id, { accepted: accepted.length, dropped: dropped.length, droppedReasons: dropped.map((d) => d.reason) });
  ok(res, {
    accepted: accepted.length,
    dropped,
    suggestions: suggestionsOf(job.id).map(sugToApi),
    job: jobToApi(getJob(job.id)),
  });
});

// --- 5) 标记已采用（落库由前端走既有 POST /projects 完成后调用） ---
router.post("/:id/adopt", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, "NOT_FOUND", "任务不存在");

  const projectId = req.body?.projectId == null ? null : Number(req.body.projectId);
  if (projectId !== null && (!Number.isInteger(projectId) || projectId <= 0)) {
    return fail(res, 400, "VALIDATION_ERROR", "projectId 必须是正整数", { projectId: "非法" });
  }

  const t = now();
  // 隐私：采用后清空原文（公告可能含联系人手机号），只留字段建议
  db.prepare(`UPDATE ai_job SET status = '已采用', entity_type = 'bid_project', entity_id = ?,
              adopted_at = ?, updated_at = ?, input_text = '', text_purged = 1 WHERE id = ?`)
    .run(projectId, t, t, job.id);

  record("ai_adopt", "ai_job", job.id, { projectId, suggestionCount: suggestionsOf(job.id).length });
  ok(res, jobToApi(getJob(job.id), { suggestions: suggestionsOf(job.id).map(sugToApi) }));
});

// --- 6) 忽略 ---
router.post("/:id/ignore", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, "NOT_FOUND", "任务不存在");
  const t = now();
  db.prepare("UPDATE ai_job SET status = '已忽略', updated_at = ?, input_text = '', text_purged = 1 WHERE id = ?").run(t, job.id);
  record("ai_ignore", "ai_job", job.id, null);
  ok(res, jobToApi(getJob(job.id)));
});

// --- 7) 硬删除（含建议级联；AI 原文属敏感文本，允许真删） ---
router.delete("/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, "NOT_FOUND", "任务不存在");
  db.prepare("DELETE FROM ai_suggestion WHERE job_id = ?").run(job.id);
  db.prepare("DELETE FROM ai_job WHERE id = ?").run(job.id);
  record("ai_delete", "ai_job", job.id, { kind: job.kind, status: job.status });
  ok(res, { id: job.id, deleted: true });
});

export { router as aiJobsRouter };
