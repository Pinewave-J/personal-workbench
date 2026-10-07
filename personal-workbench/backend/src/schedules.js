// 日程 / 提醒
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";

const router = Router();

const REMIND_TYPE = ["报名截止", "购标截止", "投标截止", "开标", "其他"];
const SCHEDULE_STATUS = ["待提醒", "已提醒", "已关闭"];

const FIELD_MAP = { projectId: "project_id", remindType: "remind_type", remindAt: "remind_at", advanceMinutes: "advance_minutes", status: "status" };

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id, projectName: row.project_name ?? null,
    remindType: row.remind_type, remindAt: row.remind_at, advanceMinutes: row.advance_minutes ?? 0,
    status: row.status, createdAt: row.created_at,
  };
}

function extract(body) {
  const out = {};
  for (const [apiKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (body[apiKey] === undefined) continue;
    let v = body[apiKey];
    if (apiKey === "projectId" || apiKey === "advanceMinutes") {
      v = (v === null || v === undefined || v === "") ? (apiKey === "projectId" ? null : 0) : Number(v);
    } else {
      v = (v === null || v === undefined) ? null : String(v).trim();
      if (v === "") v = null;
    }
    out[dbKey] = v;
  }
  return out;
}

function getById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT s.*, p.name AS project_name FROM schedule_reminder s JOIN bid_project p ON p.id = s.project_id WHERE s.id = ?").get(n);
}

router.get("/", (req, res) => {
  const where = [];
  const params = [];
  if (req.query.from) { where.push("s.remind_at >= ?"); params.push(req.query.from); }
  if (req.query.to) { where.push("s.remind_at <= ?"); params.push(req.query.to); }
  if (req.query.status) { where.push("s.status = ?"); params.push(req.query.status); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const rows = db.prepare(`
    SELECT s.*, p.name AS project_name FROM schedule_reminder s JOIN bid_project p ON p.id = s.project_id
    ${whereSql} ORDER BY s.remind_at ASC, s.id ASC LIMIT 200
  `).all(...params);
  ok(res, { list: rows.map(toApi), total: rows.length });
});

router.get("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "提醒不存在");
  ok(res, toApi(row));
});

router.post("/", (req, res) => {
  const f = extract(req.body || {});
  if (!f.project_id) return fail(res, 400, "VALIDATION_ERROR", "请选择所属项目", { projectId: "必填" });
  if (!f.remind_type || !REMIND_TYPE.includes(f.remind_type)) return fail(res, 400, "VALIDATION_ERROR", "提醒类型无效", { remindType: "无效" });
  if (!f.remind_at) return fail(res, 400, "VALIDATION_ERROR", "提醒时间不能为空", { remindAt: "必填" });
  const t = now();
  const info = db.prepare("INSERT INTO schedule_reminder (project_id, remind_type, remind_at, advance_minutes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(f.project_id, f.remind_type, f.remind_at, f.advance_minutes ?? 0, "待提醒", t);
  record("create", "schedule", Number(info.lastInsertRowid), { remindType: f.remind_type, remindAt: f.remind_at });
  ok(res, toApi(getById(Number(info.lastInsertRowid))), 201);
});

router.put("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "提醒不存在");
  const f = extract(req.body || {});
  if (f.remind_type != null && !REMIND_TYPE.includes(f.remind_type)) return fail(res, 400, "VALIDATION_ERROR", "提醒类型无效");
  if (f.status != null && !SCHEDULE_STATUS.includes(f.status)) delete f.status;
  const keys = Object.keys(f);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE schedule_reminder SET ${sets} WHERE id = ?`).run(...keys.map((k) => f[k]), row.id);
  record("update", "schedule", row.id, { remindType: f.remind_type ?? row.remind_type });
  ok(res, toApi(getById(row.id)));
});

router.delete("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "提醒不存在");
  db.prepare("DELETE FROM schedule_reminder WHERE id = ?").run(row.id);
  record("delete", "schedule", row.id, { remindType: row.remind_type });
  ok(res, { deleted: true, id: row.id });
});

router.post("/:id/ack", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "提醒不存在");
  const status = (req.body || {}).status;
  const next = status || (row.status === "待提醒" ? "已提醒" : "待提醒");
  if (!SCHEDULE_STATUS.includes(next)) return fail(res, 400, "VALIDATION_ERROR", "状态无效");
  db.prepare("UPDATE schedule_reminder SET status = ? WHERE id = ?").run(next, row.id);
  record("status_change", "schedule", row.id, { fromStatus: row.status, toStatus: next });
  ok(res, toApi(getById(row.id)));
});

export { router as schedulesRouter };
