// 个人工作台：任务/待办 + 周期任务模板
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";

const router = Router();
const tplRouter = Router();

export const QUADRANT = ["重要紧急", "重要不紧急", "紧急不重要", "不重要不紧急"];
export const TASK_STATUS = ["待办", "进行中", "已完成", "已取消"];
export const TASK_SOURCE = ["manual", "recurring", "customer"];
export const TASK_SOURCE_LABEL = { manual: "手动", recurring: "周期", customer: "客户跟进" };
const OPEN = ["待办", "进行中"];
const DONE = ["已完成", "已取消"];

const TASK_WRITABLE = {
  title: "title", notes: "notes", quadrant: "quadrant", dueDate: "due_date",
  remindDays: "remind_days", status: "status", source: "source",
  customerId: "customer_id", templateId: "template_id", monthTag: "month_tag",
};

function pick(obj, key) {
  const v = obj[key];
  return (v === undefined || v === null) ? null : v;
}

function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 本地日期（YYYY-MM-DD）。不能用 new Date().toISOString().slice(0,10)：
// 那是 UTC 日期，在东八区凌晨 0-8 点会算成前一天。
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    quadrant: row.quadrant,
    dueDate: row.due_date,
    remindDays: row.remind_days,
    status: row.status,
    source: row.source,
    customerId: row.customer_id,
    templateId: row.template_id,
    monthTag: row.month_tag,
    completedAt: row.completed_at,
    customerName: row.customer_name ?? null,
    templateName: row.template_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `
  SELECT t.*, c.name AS customer_name, rt.name AS template_name
  FROM personal_task t
  LEFT JOIN customer c ON c.id = t.customer_id
  LEFT JOIN recurring_template rt ON rt.id = t.template_id
`;

function getTask(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`).get(n);
}

/* ---------------- 周期实例生成（幂等） ---------------- */
export function monthTagOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonth(ym) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(ym || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo, ym: `${y}-${String(mo).padStart(2, "0")}` };
}

// 为一个月份生成所有 active 模板的实例（幂等）；返回 { generated, restored, skipped }
//
// 幂等判据 = 该 (模板, 月份) 是否"生成过"，**包括已被软删除的实例**。
// 旧实现带 `deleted_at IS NULL`，导致"删掉 → 下次进看板/切月份又生成一条"的复活循环；
// 现在删除即视为"这一期的实例已经处理过"，只有显式传 restore:true 才会恢复被删的那条
// （恢复而不是新插入，因此不会产生重复行，也与 uq_task_tpl_month 唯一索引一致）。
export function generateInstancesForMonth(ym, opts = {}) {
  const p = parseMonth(ym);
  if (!p) return { generated: 0, invalid: true };
  const wantRestore = opts.restore === true;
  const lastDay = new Date(p.year, p.month, 0).getDate();
  const tpls = db.prepare("SELECT * FROM recurring_template WHERE deleted_at IS NULL AND active = 1").all();
  const ins = db.prepare(`
    INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, template_id, month_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '待办', 'recurring', ?, ?, ?, ?)
  `);
  const findPrev = db.prepare(`
    SELECT id, deleted_at FROM personal_task WHERE template_id = ? AND month_tag = ?
    ORDER BY (deleted_at IS NULL) DESC, id ASC LIMIT 1
  `);
  const revive = db.prepare("UPDATE personal_task SET deleted_at = NULL, status = '待办', completed_at = NULL, updated_at = ? WHERE id = ?");
  const t = now();
  let generated = 0, restored = 0, skipped = 0;
  for (const tpl of tpls) {
    const prev = findPrev.get(tpl.id, p.ym);
    if (prev) {
      if (prev.deleted_at && wantRestore) {
        revive.run(t, prev.id);
        record("update", "task", prev.id, { name: tpl.name, source: "recurring", month: p.ym, action: "restore" });
        restored++;
      } else {
        skipped++;
      }
      continue;
    }
    const day = Math.min(tpl.day_of_month, lastDay);
    const due = `${p.ym}-${String(day).padStart(2, "0")}`;
    const info = ins.run(tpl.name, tpl.notes, tpl.quadrant, due, tpl.remind_days, tpl.id, p.ym, t, t);
    record("create", "task", Number(info.lastInsertRowid), { name: tpl.name, source: "recurring", month: p.ym });
    generated++;
  }
  return { generated, restored, skipped, invalid: false, month: p.ym };
}

/* ================= 任务 ================= */

// 列表：GET /tasks?page=&pageSize=&scope=open|done|all&status=&quadrant=&source=&q=&month=YYYY-MM&customerId=
// 注意：GET 一律只读（旧实现在带 month 时会顺手生成实例，导致"浏览某个月就把该月任务建出来"）。
// 周期实例的生成改由 POST /tasks/ensure-month（进入待办看板时对"当前月"调用）与
// POST /recurring-templates/:id/generate（手动生成）承担。
router.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 100));

  let monthYm = null;
  if (req.query.month) {
    const p = parseMonth(req.query.month);
    if (p) monthYm = p.ym;
  }

  const where = ["t.deleted_at IS NULL"];
  const params = [];

  const scope = String(req.query.scope || "open");
  if (req.query.status) {
    if (TASK_STATUS.includes(req.query.status)) { where.push("t.status = ?"); params.push(req.query.status); }
  } else if (scope === "open") {
    where.push(`t.status IN (${OPEN.map(() => "?").join(",")})`); params.push(...OPEN);
  } else if (scope === "done") {
    where.push(`t.status IN (${DONE.map(() => "?").join(",")})`); params.push(...DONE);
  }
  if (req.query.quadrant && QUADRANT.includes(req.query.quadrant)) { where.push("t.quadrant = ?"); params.push(req.query.quadrant); }
  if (req.query.source && TASK_SOURCE.includes(req.query.source)) { where.push("t.source = ?"); params.push(req.query.source); }
  if (req.query.customerId) { where.push("t.customer_id = ?"); params.push(Number(req.query.customerId) || 0); }
  const q = String(req.query.q || "").trim();
  if (q) { where.push("(t.title LIKE ? OR t.notes LIKE ?)"); const like = `%${q}%`; params.push(like, like); }
  if (monthYm) { where.push("(t.month_tag = ? OR t.due_date LIKE ?)"); params.push(monthYm, monthYm + "-%"); }

  const whereSql = where.join(" AND ");
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM personal_task t WHERE ${whereSql}`).get(...params);
  const rows = db.prepare(`${TASK_SELECT} WHERE ${whereSql} ORDER BY
    CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
    t.due_date ASC, t.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  ok(res, { list: rows.map(toApi), total, page, pageSize });
});

// 显式生成周期实例：POST /tasks/ensure-month  body { month?: 'YYYY-MM', restore?: boolean }
// 前端进入待办看板时只对"当前月"调用；restore:true 会把该月被删除的实例恢复回来（可选）。
router.post("/ensure-month", (req, res) => {
  const body = req.body || {};
  const p = parseMonth(body.month || monthTagOf(new Date()));
  if (!p) return fail(res, 400, "VALIDATION_ERROR", "month 格式应为 YYYY-MM");
  let r;
  try { r = generateInstancesForMonth(p.ym, { restore: body.restore === true }); }
  catch (e) { return fail(res, 500, "INTERNAL", `周期实例生成失败：${String(e?.message || e)}`); }
  ok(res, r);
});

// 详情
router.get("/:id", (req, res) => {
  const row = getTask(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "任务不存在");
  ok(res, toApi(row));
});

// 新增
router.post("/", (req, res) => {
  const body = req.body || {};
  const title = cleanText(body.title);
  if (!title) return fail(res, 400, "VALIDATION_ERROR", "任务标题不能为空", { title: "必填" });

  let quadrant = body.quadrant ?? "不重要不紧急";
  if (!QUADRANT.includes(quadrant)) quadrant = "不重要不紧急";
  let status = body.status ?? "待办";
  if (!TASK_STATUS.includes(status)) status = "待办";
  let source = body.source ?? "manual";
  if (!TASK_SOURCE.includes(source)) source = "manual";
  const customerId = pick(body, "customerId");
  if (customerId !== null) {
    const c = db.prepare("SELECT id FROM customer WHERE id = ? AND deleted_at IS NULL").get(Number(customerId) || 0);
    if (!c) return fail(res, 400, "VALIDATION_ERROR", "关联的客户不存在");
    source = "customer";
  }
  const templateId = pick(body, "templateId");
  let dueDate = cleanText(body.dueDate);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail(res, 400, "VALIDATION_ERROR", "截止日期格式应为 YYYY-MM-DD");
  let remindDays = Number(body.remindDays);
  remindDays = Number.isFinite(remindDays) ? Math.max(0, Math.trunc(remindDays)) : 0;

  const t = now();
  const info = db.prepare(`
    INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, customer_id, template_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, cleanText(body.notes), quadrant, dueDate, remindDays, status, source, customerId, templateId, t, t);
  record("create", "task", Number(info.lastInsertRowid), { name: title, source });
  ok(res, toApi(getTask(Number(info.lastInsertRowid))), 201);
});

function updateTask(req, res, partial) {
  const row = getTask(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "任务不存在");
  const body = req.body || {};
  const fields = {};
  for (const [apiKey, dbKey] of Object.entries(TASK_WRITABLE)) {
    if (partial && body[apiKey] === undefined) continue;
    fields[dbKey] = pick(body, apiKey);
  }
  if (fields.title !== undefined && cleanText(body.title) === null) return fail(res, 400, "VALIDATION_ERROR", "任务标题不能为空");
  if (fields.title !== undefined) fields.title = String(body.title).trim();
  if (fields.notes !== undefined) fields.notes = cleanText(body.notes);
  if (fields.quadrant !== undefined && fields.quadrant !== null && !QUADRANT.includes(fields.quadrant)) {
    return fail(res, 400, "VALIDATION_ERROR", `quadrant 必须是：${QUADRANT.join(" / ")}`);
  }
  if (fields.status !== undefined && fields.status !== null && !TASK_STATUS.includes(fields.status)) {
    return fail(res, 400, "VALIDATION_ERROR", `status 必须是：${TASK_STATUS.join(" / ")}`);
  }
  if (fields.due_date !== undefined && fields.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.due_date))) {
    return fail(res, 400, "VALIDATION_ERROR", "截止日期格式应为 YYYY-MM-DD");
  }
  if (fields.remind_days !== undefined) {
    fields.remind_days = Math.max(0, Math.trunc(Number(fields.remind_days) || 0));
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k] ?? null);
  db.prepare(`UPDATE personal_task SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), row.id);
  record("update", "task", row.id, { name: fields.title ?? row.title });
  ok(res, toApi(getTask(row.id)));
}
router.put("/:id", (req, res) => updateTask(req, res, false));
router.patch("/:id", (req, res) => updateTask(req, res, true));

// 软删除
router.delete("/:id", (req, res) => {
  const row = getTask(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "任务不存在");
  db.prepare("UPDATE personal_task SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  record("delete", "task", row.id, { name: row.title });
  ok(res, { deleted: true, id: row.id });
});

// 完成：source=customer 时回写客户档案；body.nextFollowDate 触发下一条跟进待办
router.post("/:id/complete", (req, res) => {
  const row = getTask(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "任务不存在");
  if (row.status === "已完成") return fail(res, 400, "VALIDATION_ERROR", "任务已完成");
  const body = req.body || {};
  const nextFollowDate = cleanText(body.nextFollowDate);
  if (nextFollowDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowDate)) {
    return fail(res, 400, "VALIDATION_ERROR", "下次跟进日期格式应为 YYYY-MM-DD");
  }
  const t = now();

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE personal_task SET status = '已完成', completed_at = ?, updated_at = ? WHERE id = ?").run(t, t, row.id);
    let createdNext = null;
    if (row.source === "customer" && row.customer_id) {
      const cust = db.prepare("SELECT * FROM customer WHERE id = ? AND deleted_at IS NULL").get(row.customer_id);
      if (cust) {
        // 回写最近跟进时间：与 customers.js 的跟进记录保持同一格式（本地日期 YYYY-MM-DD），
        // 避免同一列出现"ISO 时间戳 / 纯日期"两种格式导致显示不一致。
        // 注意用本地日期而不是 ISO 的 slice(0,10)——后者在凌晨 0-8 点会差一天。
        db.prepare("UPDATE customer SET last_follow_at = ?, updated_at = ? WHERE id = ?").run(localDateStr(), t, cust.id);
        if (nextFollowDate) {
          // 更新客户下次跟进日期，并生成下一条跟进待办（避免重复）
          db.prepare("UPDATE customer SET next_follow_date = ?, updated_at = ? WHERE id = ?").run(nextFollowDate, t, cust.id);
          const dup = db.prepare(`
            SELECT COUNT(*) AS c FROM personal_task
            WHERE source = 'customer' AND customer_id = ? AND due_date = ? AND status IN ('待办','进行中') AND deleted_at IS NULL
          `).get(cust.id, nextFollowDate).c;
          if (dup === 0) {
            const info = db.prepare(`
              INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, customer_id, created_at, updated_at)
              VALUES (?, ?, '重要紧急', ?, 1, '待办', 'customer', ?, ?, ?)
            `).run(`跟进：${cust.name}`, nextFollowDate ? `上次跟进已完成，计划 ${nextFollowDate} 再次跟进。` : null, nextFollowDate, cust.id, t, t);
            createdNext = Number(info.lastInsertRowid);
            record("create", "task", createdNext, { name: `跟进：${cust.name}`, source: "customer" });
          }
        }
      }
    }
    db.exec("COMMIT");
    record("update", "task", row.id, { name: row.title, action: "complete" });
    ok(res, { ...toApi(getTask(row.id)), createdNext });
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

// 重开（已完成/已取消 → 待办）
router.post("/:id/reopen", (req, res) => {
  const row = getTask(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "任务不存在");
  const t = now();
  db.prepare("UPDATE personal_task SET status = '待办', completed_at = NULL, updated_at = ? WHERE id = ?").run(t, row.id);
  record("update", "task", row.id, { name: row.title, action: "reopen" });
  ok(res, toApi(getTask(row.id)));
});

/* ================= 周期任务模板 ================= */

const TPL_WRITABLE = {
  name: "name", notes: "notes", quadrant: "quadrant", dayOfMonth: "day_of_month",
  remindDays: "remind_days", active: "active",
};

function tplApi(row) {
  if (!row) return null;
  const done = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) AS done
    FROM personal_task WHERE template_id = ? AND deleted_at IS NULL
  `).get(row.id);
  return {
    id: row.id, name: row.name, notes: row.notes, quadrant: row.quadrant,
    dayOfMonth: row.day_of_month, remindDays: row.remind_days, active: row.active,
    instanceTotal: Number(done?.total || 0), instanceDone: Number(done?.done || 0),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

tplRouter.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM recurring_template WHERE deleted_at IS NULL ORDER BY day_of_month ASC, id ASC").all();
  ok(res, { list: rows.map(tplApi), total: rows.length });
});

tplRouter.post("/", (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name);
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "模板名称不能为空", { name: "必填" });
  let quadrant = body.quadrant ?? "重要不紧急";
  if (!QUADRANT.includes(quadrant)) quadrant = "重要不紧急";
  let day = Math.trunc(Number(body.dayOfMonth));
  if (!Number.isFinite(day) || day < 1 || day > 31) return fail(res, 400, "VALIDATION_ERROR", "dayOfMonth 须为 1–31");
  let remindDays = Number(body.remindDays);
  remindDays = Number.isFinite(remindDays) ? Math.max(0, Math.trunc(remindDays)) : 0;
  let active = body.active === undefined ? 1 : (body.active ? 1 : 0);
  const t = now();
  const info = db.prepare(`
    INSERT INTO recurring_template (name, notes, quadrant, day_of_month, remind_days, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, cleanText(body.notes), quadrant, day, remindDays, active, t, t);
  record("create", "recurring_template", Number(info.lastInsertRowid), { name });
  ok(res, tplApi(db.prepare("SELECT * FROM recurring_template WHERE id = ?").get(Number(info.lastInsertRowid))), 201);
});

tplRouter.put("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM recurring_template WHERE id = ? AND deleted_at IS NULL").get(Number(req.params.id) || 0);
  if (!row) return fail(res, 404, "NOT_FOUND", "模板不存在");
  const body = req.body || {};
  const fields = {};
  for (const [apiKey, dbKey] of Object.entries(TPL_WRITABLE)) {
    if (body[apiKey] === undefined) continue;
    fields[dbKey] = pick(body, apiKey);
  }
  if (fields.name !== undefined) {
    const n = cleanText(fields.name);
    if (!n) return fail(res, 400, "VALIDATION_ERROR", "模板名称不能为空");
    fields.name = n;
  }
  if (fields.quadrant !== undefined && fields.quadrant !== null && !QUADRANT.includes(fields.quadrant)) {
    return fail(res, 400, "VALIDATION_ERROR", `quadrant 必须是：${QUADRANT.join(" / ")}`);
  }
  if (fields.day_of_month !== undefined) {
    const d = Math.trunc(Number(fields.day_of_month));
    if (!Number.isFinite(d) || d < 1 || d > 31) return fail(res, 400, "VALIDATION_ERROR", "dayOfMonth 须为 1–31");
    fields.day_of_month = d;
  }
  if (fields.remind_days !== undefined) {
    fields.remind_days = Math.max(0, Math.trunc(Number(fields.remind_days) || 0));
  }
  if (fields.active !== undefined && fields.active !== null) fields.active = fields.active ? 1 : 0;
  const keys = Object.keys(fields);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k] ?? null);
  db.prepare(`UPDATE recurring_template SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), row.id);
  record("update", "recurring_template", row.id, { name: fields.name ?? row.name });
  ok(res, tplApi(db.prepare("SELECT * FROM recurring_template WHERE id = ?").get(row.id)));
});

tplRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM recurring_template WHERE id = ? AND deleted_at IS NULL").get(Number(req.params.id) || 0);
  if (!row) return fail(res, 404, "NOT_FOUND", "模板不存在");
  db.prepare("UPDATE recurring_template SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  record("delete", "recurring_template", row.id, { name: row.name });
  ok(res, { deleted: true, id: row.id });
});

// 手动为某月生成实例：POST /:id/generate  body { month: 'YYYY-MM', restore?: boolean }
// 幂等判据含已软删除实例：该月若已生成过（哪怕被删）返回 409；传 restore:true 则把被删的那条恢复。
tplRouter.post("/:id/generate", (req, res) => {
  const row = db.prepare("SELECT * FROM recurring_template WHERE id = ? AND deleted_at IS NULL").get(Number(req.params.id) || 0);
  if (!row) return fail(res, 404, "NOT_FOUND", "模板不存在");
  const body = req.body || {};
  const p = parseMonth(body.month || monthTagOf(new Date()));
  if (!p) return fail(res, 400, "VALIDATION_ERROR", "month 格式应为 YYYY-MM");

  const prev = db.prepare(
    "SELECT id, deleted_at FROM personal_task WHERE template_id = ? AND month_tag = ? ORDER BY (deleted_at IS NULL) DESC, id ASC LIMIT 1"
  ).get(row.id, p.ym);
  if (prev) {
    if (prev.deleted_at && body.restore === true) {
      const t = now();
      db.prepare("UPDATE personal_task SET deleted_at = NULL, status = '待办', completed_at = NULL, updated_at = ? WHERE id = ?").run(t, prev.id);
      record("update", "task", prev.id, { name: row.name, source: "recurring", month: p.ym, action: "restore" });
      return ok(res, { restored: 1, generated: 0, month: p.ym, taskId: Number(prev.id) });
    }
    return fail(res, 409, "CONFLICT",
      prev.deleted_at
        ? `${p.ym} 的实例已存在但已被删除；如需恢复请选择"恢复已删除实例"`
        : `${p.ym} 该模板实例已存在`);
  }

  const lastDay = new Date(p.year, p.month, 0).getDate();
  const day = Math.min(row.day_of_month, lastDay);
  const due = `${p.ym}-${String(day).padStart(2, "0")}`;
  const t = now();
  const info = db.prepare(`
    INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, template_id, month_tag, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '待办', 'recurring', ?, ?, ?, ?)
  `).run(row.name, row.notes, row.quadrant, due, row.remind_days, row.id, p.ym, t, t);
  record("create", "task", Number(info.lastInsertRowid), { name: row.name, source: "recurring", month: p.ym });
  ok(res, { generated: 1, restored: 0, month: p.ym, taskId: Number(info.lastInsertRowid), dueDate: due });
});

export { router as tasksRouter, tplRouter as recurringTemplatesRouter };
