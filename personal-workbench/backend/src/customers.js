// 个人工作台：客户档案 + 客户跟进记录（双向联动生成待办）
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";

const router = Router();
const fuRouter = Router();

export const CUSTOMER_STATUS = ["潜在", "跟进中", "已成交", "暂停", "流失"];
export const FOLLOW_TYPE = ["电话", "拜访", "邮件", "微信", "其他"];

function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function pick(obj, key) {
  const v = obj[key];
  return (v === undefined || v === null) ? null : v;
}

const CUST_WRITABLE = {
  name: "name", shortName: "short_name", industry: "industry", region: "region",
  contactName: "contact_name", contactPhone: "contact_phone", email: "email",
  status: "status", source: "source", nextFollowDate: "next_follow_date", notes: "notes",
};

function custApi(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, shortName: row.short_name, industry: row.industry,
    region: row.region, contactName: row.contact_name, contactPhone: row.contact_phone,
    email: row.email, status: row.status, source: row.source,
    nextFollowDate: row.next_follow_date, lastFollowAt: row.last_follow_at,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at, ...extra,
  };
}

function getCustomer(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM customer WHERE id = ? AND deleted_at IS NULL").get(n);
}

// 依据客户的 next_follow_date 补发待办（联动：幂等）
export function ensureCustomerTask(cust, nextDate, note) {
  if (!cust || !nextDate) return null;
  const dup = db.prepare(`
    SELECT COUNT(*) AS c FROM personal_task
    WHERE source = 'customer' AND customer_id = ? AND due_date = ? AND status IN ('待办','进行中') AND deleted_at IS NULL
  `).get(cust.id, nextDate).c;
  if (dup > 0) return null;
  const t = now();
  const info = db.prepare(`
    INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, customer_id, created_at, updated_at)
    VALUES (?, ?, '重要紧急', ?, 1, '待办', 'customer', ?, ?, ?)
  `).run(`跟进：${cust.name}`, note || null, nextDate, cust.id, t, t);
  record("create", "task", Number(info.lastInsertRowid), { name: `跟进：${cust.name}`, source: "customer", customerId: cust.id });
  return Number(info.lastInsertRowid);
}

/* ================= 客户档案 ================= */

router.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
  const where = ["deleted_at IS NULL"];
  const params = [];
  if (req.query.status) { where.push("status = ?"); params.push(req.query.status); }
  const q = String(req.query.q || "").trim();
  if (q) {
    where.push("(name LIKE ? OR short_name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ? OR industry LIKE ? OR region LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  // 需要跟进：next_follow_date <= today
  if (req.query.needFollow === "1") { where.push("next_follow_date IS NOT NULL AND next_follow_date <= ?"); params.push(todayStr()); }
  const whereSql = where.join(" AND ");
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM customer WHERE ${whereSql}`).get(...params);
  const rows = db.prepare(`SELECT * FROM customer WHERE ${whereSql} ORDER BY
    CASE WHEN next_follow_date IS NULL THEN 1 ELSE 0 END, next_follow_date ASC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  ok(res, { list: rows.map(custApi), total, page, pageSize });
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

router.get("/:id", (req, res) => {
  const row = getCustomer(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "客户不存在");
  const followUps = db.prepare("SELECT * FROM customer_follow_up WHERE customer_id = ? ORDER BY follow_at DESC, id DESC LIMIT 50").all(row.id);
  const openTasks = db.prepare(`
    SELECT id, title, due_date, status, source FROM personal_task
    WHERE customer_id = ? AND status IN ('待办','进行中') AND deleted_at IS NULL ORDER BY due_date ASC LIMIT 20
  `).all(row.id);
  ok(res, custApi(row, {
    followUps: followUps.map((f) => ({
      id: f.id, customerId: f.customer_id, followType: f.follow_type, content: f.content,
      followAt: f.follow_at, nextFollowDate: f.next_follow_date, createdAt: f.created_at,
    })),
    openTasks: openTasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, status: t.status, source: t.source })),
  }));
});

router.post("/", (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name);
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "客户名称不能为空", { name: "必填" });
  let status = body.status ?? "跟进中";
  if (!CUSTOMER_STATUS.includes(status)) status = "跟进中";
  let nextFollowDate = cleanText(body.nextFollowDate);
  if (nextFollowDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowDate)) return fail(res, 400, "VALIDATION_ERROR", "下次跟进日期格式应为 YYYY-MM-DD");
  const t = now();
  const info = db.prepare(`
    INSERT INTO customer (name, short_name, industry, region, contact_name, contact_phone, email, status, source, next_follow_date, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, cleanText(body.shortName), cleanText(body.industry), cleanText(body.region),
    cleanText(body.contactName), cleanText(body.contactPhone), cleanText(body.email), status,
    cleanText(body.source), nextFollowDate, cleanText(body.notes), t, t);
  const id = Number(info.lastInsertRowid);
  // 新增客户时若填了下次跟进日期，自动生成跟进待办
  if (nextFollowDate) {
    const cust = getCustomer(id);
    ensureCustomerTask(cust, nextFollowDate, cleanText(body.notes));
  }
  record("create", "customer", id, { name });
  ok(res, custApi(getCustomer(id)), 201);
});

function updateCustomer(req, res, partial) {
  const row = getCustomer(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "客户不存在");
  const body = req.body || {};
  const fields = {};
  for (const [apiKey, dbKey] of Object.entries(CUST_WRITABLE)) {
    if (partial && body[apiKey] === undefined) continue;
    fields[dbKey] = pick(body, apiKey);
  }
  if (fields.name !== undefined) {
    const n = cleanText(fields.name);
    if (!n) return fail(res, 400, "VALIDATION_ERROR", "客户名称不能为空");
    fields.name = n;
  }
  if (fields.status !== undefined && fields.status !== null && !CUSTOMER_STATUS.includes(fields.status)) {
    return fail(res, 400, "VALIDATION_ERROR", `status 必须是：${CUSTOMER_STATUS.join(" / ")}`);
  }
  if (fields.next_follow_date !== undefined && fields.next_follow_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(fields.next_follow_date))) {
    return fail(res, 400, "VALIDATION_ERROR", "下次跟进日期格式应为 YYYY-MM-DD");
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k] ?? null);
  db.prepare(`UPDATE customer SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), row.id);

  // 更新客户把下次跟进日期改到更晚/新增时 → 确保有对应待办
  if (fields.next_follow_date && row.status !== "流失") {
    const cust = getCustomer(row.id);
    ensureCustomerTask(cust, fields.next_follow_date, null);
  }
  record("update", "customer", row.id, { name: fields.name ?? row.name });
  ok(res, custApi(getCustomer(row.id)));
}
router.put("/:id", (req, res) => updateCustomer(req, res, false));
router.patch("/:id", (req, res) => updateCustomer(req, res, true));

router.delete("/:id", (req, res) => {
  const row = getCustomer(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "客户不存在");
  db.prepare("UPDATE customer SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  // 关联未完成任务一并关闭，避免无效提醒
  db.prepare("UPDATE personal_task SET status = '已取消', updated_at = ? WHERE customer_id = ? AND status IN ('待办','进行中') AND deleted_at IS NULL")
    .run(now(), row.id);
  record("delete", "customer", row.id, { name: row.name });
  ok(res, { deleted: true, id: row.id });
});

// 某客户的跟进记录
router.get("/:id/follow-ups", (req, res) => {
  const row = getCustomer(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "客户不存在");
  const list = db.prepare("SELECT * FROM customer_follow_up WHERE customer_id = ? ORDER BY follow_at DESC, id DESC").all(row.id);
  ok(res, { list: list.map(fuApi), total: list.length });
});

/* ================= 客户跟进记录 ================= */

function fuApi(row) {
  if (!row) return null;
  return {
    id: row.id, customerId: row.customer_id, followType: row.follow_type, content: row.content,
    followAt: row.follow_at, nextFollowDate: row.next_follow_date, createdAt: row.created_at,
    customerName: row.customer_name ?? null,
  };
}

const FU_SELECT = `
  SELECT f.*, c.name AS customer_name
  FROM customer_follow_up f
  LEFT JOIN customer c ON c.id = f.customer_id
`;

fuRouter.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
  const where = [];
  const params = [];
  if (req.query.customerId) { where.push("f.customer_id = ?"); params.push(Number(req.query.customerId) || 0); }
  if (req.query.followType && FOLLOW_TYPE.includes(req.query.followType)) { where.push("f.follow_type = ?"); params.push(req.query.followType); }
  const q = String(req.query.q || "").trim();
  if (q) { where.push("(f.content LIKE ? OR c.name LIKE ?)"); const like = `%${q}%`; params.push(like, like); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM customer_follow_up f LEFT JOIN customer c ON c.id = f.customer_id ${whereSql}`).get(...params);
  const rows = db.prepare(`${FU_SELECT} ${whereSql} ORDER BY f.follow_at DESC, f.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  ok(res, { list: rows.map(fuApi), total, page, pageSize });
});

// 新增跟进记录 → 同步客户 next_follow_date + 生成跟进待办（联动规则 1）
fuRouter.post("/", (req, res) => {
  const body = req.body || {};
  const customerId = Number(body.customerId) || 0;
  const cust = getCustomer(customerId);
  if (!cust) return fail(res, 400, "VALIDATION_ERROR", "客户不存在", { customerId: "无效客户" });
  const content = cleanText(body.content);
  if (!content) return fail(res, 400, "VALIDATION_ERROR", "跟进内容不能为空", { content: "必填" });
  let followType = body.followType ?? "电话";
  if (!FOLLOW_TYPE.includes(followType)) followType = "其他";
  const followAt = cleanText(body.followAt) || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followAt)) return fail(res, 400, "VALIDATION_ERROR", "跟进日期格式应为 YYYY-MM-DD");
  let nextFollowDate = cleanText(body.nextFollowDate);
  if (nextFollowDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowDate)) return fail(res, 400, "VALIDATION_ERROR", "下次跟进日期格式应为 YYYY-MM-DD");
  const t = now();

  db.exec("BEGIN");
  try {
    const info = db.prepare(`
      INSERT INTO customer_follow_up (customer_id, follow_type, content, follow_at, next_follow_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(customerId, followType, content, followAt, nextFollowDate, t);
    const fuId = Number(info.lastInsertRowid);
    // 更新客户最近跟进 + 下次跟进日期
    db.prepare("UPDATE customer SET last_follow_at = ?, next_follow_date = ?, updated_at = ? WHERE id = ?")
      .run(followAt, nextFollowDate, t, customerId);
    // 联动：生成/复用跟进待办
    let taskId = null;
    if (nextFollowDate) {
      const fresh = getCustomer(customerId);
      taskId = ensureCustomerTask(fresh, nextFollowDate, content);
    }
    db.exec("COMMIT");
    record("create", "follow_up", fuId, { customer: cust.name, followType, nextFollowDate });
    ok(res, { ...fuApi(db.prepare(`${FU_SELECT} WHERE f.id = ?`).get(fuId)), taskId }, 201);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

// 更新跟进记录 → 重新同步 next_follow_date（若清空则不动客户字段，避免误删计划）
fuRouter.put("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM customer_follow_up WHERE id = ?").get(Number(req.params.id) || 0);
  if (!row) return fail(res, 404, "NOT_FOUND", "跟进记录不存在");
  const body = req.body || {};
  const cust = getCustomer(row.customer_id);
  const content = cleanText(body.content);
  if (body.content !== undefined && !content) return fail(res, 400, "VALIDATION_ERROR", "跟进内容不能为空");
  const followType = body.followType === undefined ? row.follow_type : (FOLLOW_TYPE.includes(body.followType) ? body.followType : "其他");
  const followAt = body.followAt === undefined ? row.follow_at : cleanText(body.followAt);
  if (followAt && !/^\d{4}-\d{2}-\d{2}$/.test(followAt)) return fail(res, 400, "VALIDATION_ERROR", "跟进日期格式应为 YYYY-MM-DD");
  const nextFollowDate = body.nextFollowDate === undefined ? row.next_follow_date : cleanText(body.nextFollowDate);
  if (nextFollowDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowDate)) return fail(res, 400, "VALIDATION_ERROR", "下次跟进日期格式应为 YYYY-MM-DD");
  const t = now();

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE customer_follow_up SET follow_type = ?, content = ?, follow_at = ?, next_follow_date = ? WHERE id = ?")
      .run(followType, content ?? row.content, followAt, nextFollowDate, row.id);
    // 客户下次跟进日期仅在有值时向前同步（保证闭环不空转）
    if (nextFollowDate && cust) {
      db.prepare("UPDATE customer SET next_follow_date = ?, updated_at = ? WHERE id = ?").run(nextFollowDate, t, cust.id);
      if (cust.status !== "流失") ensureCustomerTask(getCustomer(cust.id), nextFollowDate, content ?? row.content);
    }
    db.exec("COMMIT");
    record("update", "follow_up", row.id, { customer: cust?.name ?? row.customer_id, followType, nextFollowDate });
    ok(res, fuApi(db.prepare(`${FU_SELECT} WHERE f.id = ?`).get(row.id)));
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

fuRouter.delete("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM customer_follow_up WHERE id = ?").get(Number(req.params.id) || 0);
  if (!row) return fail(res, 404, "NOT_FOUND", "跟进记录不存在");
  db.prepare("DELETE FROM customer_follow_up WHERE id = ?").run(row.id);
  record("delete", "follow_up", row.id, { customerId: row.customer_id });
  ok(res, { deleted: true, id: row.id });
});

export { router as customersRouter, fuRouter as followUpsRouter };
