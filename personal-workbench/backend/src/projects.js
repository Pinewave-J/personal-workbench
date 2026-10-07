// 项目路由：CRUD + 状态流转 + 状态历史
import { Router } from "express";
import { db } from "./db.js";
import { STATUS, CATEGORY, canTransition } from "./status.js";
import { ok, fail, now } from "./util.js";
import { toApi } from "./mapper.js";
import { record } from "./audit.js";

const router = Router();

// ---- 可写字段映射（API camelCase -> DB snake_case） ----
const WRITABLE = {
  name: "name",
  tenderNo: "tender_no",
  lotNo: "lot_no",
  category: "category",
  industry: "industry",
  region: "region",
  tenderer: "tenderer",
  agency: "agency",
  duration: "duration",
  budget: "budget",
  bond: "bond",
  bidPrice: "bid_price",
  registerTime: "register_time",
  deadline: "deadline",
  validityDays: "validity_days",
  contactName: "contact_name",
  contactPhone: "contact_phone",
  notes: "notes",
};

const NUMERIC = new Set(["budget", "bond", "bidPrice", "validityDays"]);

function extractFields(body, partial) {
  const out = {};
  for (const [apiKey, dbKey] of Object.entries(WRITABLE)) {
    if (partial && body[apiKey] === undefined) continue;
    let v = body[apiKey];
    if (NUMERIC.has(apiKey)) {
      v = (v === null || v === undefined || v === "") ? null : Number(v);
      if (v !== null && !Number.isFinite(v)) v = null;
    } else {
      v = (v === null || v === undefined) ? null : String(v).trim();
      if (v === "") v = null;
    }
    out[dbKey] = v;
  }
  if (out.category != null && !CATEGORY.includes(out.category)) out.category = "其他";
  if (out.category == null && !partial) out.category = "其他";
  return out;
}

function extractStatus(body) {
  const s = body?.status ?? "跟踪中";
  return STATUS.includes(s) ? s : null;
}

function getById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT * FROM bid_project WHERE id = ? AND deleted_at IS NULL").get(n);
}

export function nextProjectCode() {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT project_code FROM bid_project WHERE project_code LIKE ? ORDER BY project_code DESC LIMIT 1").get(`PRJ-${year}-%`);
  let n = 1;
  if (row) {
    const m = /-(\d+)$/.exec(row.project_code);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `PRJ-${year}-${String(n).padStart(3, "0")}`;
}

// ---- 列表 ----
router.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const where = ["deleted_at IS NULL"];
  const params = [];

  if (req.query.status) { where.push("status = ?"); params.push(req.query.status); }
  if (req.query.category) { where.push("category = ?"); params.push(req.query.category); }
  const q = (req.query.q || "").trim();
  if (q) {
    where.push("(name LIKE ? OR tender_no LIKE ? OR tenderer LIKE ? OR agency LIKE ? OR contact_name LIKE ? OR industry LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (req.query.startDate) { where.push("deadline >= ?"); params.push(req.query.startDate); }
  if (req.query.endDate) { where.push("deadline <= ?"); params.push(req.query.endDate); }

  const whereSql = where.join(" AND ");
  const SORT = { createdAt: "created_at", updatedAt: "updated_at", deadline: "deadline", openTime: "open_time", name: "name", budget: "budget", status: "status" };
  const sortCol = SORT[req.query.sort] || "updated_at";
  const order = req.query.order === "asc" ? "ASC" : "DESC";

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM bid_project WHERE ${whereSql}`).get(...params);
  const rows = db.prepare(`SELECT * FROM bid_project WHERE ${whereSql} ORDER BY ${sortCol} ${order}, id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);

  ok(res, { list: rows.map(toApi), total, page, pageSize });
});

// ---- 详情 ----
router.get("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "项目不存在");
  ok(res, toApi(row));
});

// ---- 新增 ----
router.post("/", (req, res) => {
  const body = req.body || {};
  const name = (body.name ?? "").trim();
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "项目名称不能为空", { name: "必填" });

  const fields = extractFields(body, false);
  fields.name = name;
  const status = extractStatus(body);
  if (!status) return fail(res, 400, "VALIDATION_ERROR", `status 必须是：${STATUS.join(" / ")}`, { status: "非法状态" });

  const code = nextProjectCode();
  const t = now();
  let info;
  try {
    info = db.prepare(`
      INSERT INTO bid_project (project_code, name, tender_no, lot_no, category, industry, region, tenderer, agency, duration, budget, bond, bid_price, status, register_time, deadline, open_time, validity_days, contact_name, contact_phone, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, fields.name, fields.tender_no, fields.lot_no, fields.category, fields.industry, fields.region, fields.tenderer, fields.agency,
      fields.duration ?? null, fields.budget, fields.bond, fields.bid_price, status, fields.register_time, fields.deadline,
      fields.deadline ?? null, fields.validity_days, fields.contact_name, fields.contact_phone, fields.notes, t, t
    );
  } catch (e) {
    if (String(e?.message || "").includes("UNIQUE")) return fail(res, 409, "CONFLICT", "项目编号冲突，请重试");
    throw e;
  }
  record("create", "project", Number(info.lastInsertRowid), { name, status });
  ok(res, toApi(db.prepare("SELECT * FROM bid_project WHERE id = ?").get(Number(info.lastInsertRowid))), 201);
});

// ---- 更新（PUT 全量 / PATCH 局部） ----
function updateProject(req, res, partial) {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "项目不存在");

  const fields = extractFields(req.body || {}, partial);
  if (fields.name === null) return fail(res, 400, "VALIDATION_ERROR", "项目名称不能为空", { name: "必填" });
  if (fields.deadline !== undefined) fields.open_time = fields.deadline; // 开标时间 = 投标截止时间
  const keys = Object.keys(fields);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");

  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE bid_project SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, now(), row.id);

  record("update", "project", row.id, { name: fields.name ?? row.name });
  ok(res, toApi(getById(row.id)));
}
router.put("/:id", (req, res) => updateProject(req, res, false));
router.patch("/:id", (req, res) => updateProject(req, res, true));

// ---- 软删除 ----
router.delete("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "项目不存在");
  db.prepare("UPDATE bid_project SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), row.id);
  record("delete", "project", row.id, { name: row.name });
  ok(res, { deleted: true, id: row.id });
});

// ---- 状态流转 ----
router.post("/:id/status", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "项目不存在");

  const toStatus = (req.body || {}).toStatus;
  if (!toStatus) return fail(res, 400, "VALIDATION_ERROR", "缺少 toStatus");
  if (!canTransition(row.status, toStatus)) {
    return fail(res, 400, "FORBIDDEN_STATUS", `不允许从「${row.status}」流转到「${toStatus}」`);
  }
  const remark = ((req.body || {}).remark ?? "").trim() || null;
  const t = now();

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE bid_project SET status = ?, updated_at = ? WHERE id = ?").run(toStatus, t, row.id);
    db.prepare("INSERT INTO bid_status_log (project_id, from_status, to_status, remark, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.status, toStatus, remark, t);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  record("status_change", "project", row.id, { name: row.name, fromStatus: row.status, toStatus });
  ok(res, toApi(getById(row.id)));
});

// ---- 状态历史 ----
router.get("/:id/status-logs", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "项目不存在");
  const logs = db.prepare("SELECT * FROM bid_status_log WHERE project_id = ? ORDER BY created_at DESC, id DESC").all(row.id);
  ok(res, logs.map((l) => ({
    id: l.id, projectId: l.project_id, fromStatus: l.from_status, toStatus: l.to_status,
    remark: l.remark, createdAt: l.created_at,
  })));
});

export { router as projectsRouter };
