// 招标公告（手动登记）
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";

const router = Router();

const NOTICE_STATUS = ["未处理", "已关联项目", "已忽略"];

const FIELD_MAP = {
  projectId: "project_id", title: "title", source: "source", sourceUrl: "source_url",
  region: "region", category: "category", publishDate: "publish_date", summary: "summary", status: "status",
};

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id, projectId: row.project_id ?? null, projectName: row.project_name ?? null,
    title: row.title, source: row.source ?? null, sourceUrl: row.source_url ?? null,
    region: row.region ?? null, category: row.category ?? null, publishDate: row.publish_date ?? null,
    summary: row.summary ?? null, status: row.status, createdAt: row.created_at,
  };
}

function extract(body) {
  const out = {};
  for (const [apiKey, dbKey] of Object.entries(FIELD_MAP)) {
    if (body[apiKey] === undefined) continue;
    let v = body[apiKey];
    if (apiKey === "projectId") v = (v === null || v === undefined || v === "") ? null : Number(v);
    else { v = (v === null || v === undefined) ? null : String(v).trim(); if (v === "") v = null; }
    out[dbKey] = v;
  }
  return out;
}

function getById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT n.*, p.name AS project_name FROM tender_notice n LEFT JOIN bid_project p ON p.id = n.project_id WHERE n.id = ?").get(n);
}

router.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const where = [];
  const params = [];
  if (req.query.status) { where.push("n.status = ?"); params.push(req.query.status); }
  const q = (req.query.q || "").trim();
  if (q) { where.push("(n.title LIKE ? OR n.source LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM tender_notice n ${whereSql}`).get(...params);
  const rows = db.prepare(`
    SELECT n.*, p.name AS project_name FROM tender_notice n LEFT JOIN bid_project p ON p.id = n.project_id
    ${whereSql} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  ok(res, { list: rows.map(toApi), total, page, pageSize });
});

router.get("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "公告不存在");
  ok(res, toApi(row));
});

router.post("/", (req, res) => {
  const body = req.body || {};
  const title = (body.title ?? "").trim();
  if (!title) return fail(res, 400, "VALIDATION_ERROR", "公告标题不能为空", { title: "必填" });
  const f = extract(body);
  f.title = title;
  const status = NOTICE_STATUS.includes(body.status) ? body.status : "未处理";
  const t = now();
  const info = db.prepare(`
    INSERT INTO tender_notice (project_id, title, source, source_url, region, category, publish_date, summary, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(f.project_id ?? null, f.title, f.source ?? null, f.source_url ?? null, f.region ?? null, f.category ?? null, f.publish_date ?? null, f.summary ?? null, status, t);
  ok(res, toApi(getById(Number(info.lastInsertRowid))), 201);
});

router.put("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "公告不存在");
  const body = req.body || {};
  if (body.title !== undefined && !String(body.title).trim()) return fail(res, 400, "VALIDATION_ERROR", "公告标题不能为空");
  const f = extract(body);
  if (f.status != null && !NOTICE_STATUS.includes(f.status)) delete f.status;
  const keys = Object.keys(f);
  if (keys.length === 0) return fail(res, 400, "VALIDATION_ERROR", "没有可更新的字段");
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE tender_notice SET ${sets} WHERE id = ?`).run(...keys.map((k) => f[k]), row.id);
  ok(res, toApi(getById(row.id)));
});

router.delete("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "公告不存在");
  db.prepare("DELETE FROM tender_notice WHERE id = ?").run(row.id);
  ok(res, { deleted: true, id: row.id });
});

router.post("/:id/link-project", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "公告不存在");
  const projectId = (req.body || {}).projectId;
  const pid = (projectId === null || projectId === undefined || projectId === "") ? null : Number(projectId);
  db.prepare("UPDATE tender_notice SET project_id = ?, status = ? WHERE id = ?").run(pid, pid ? "已关联项目" : "未处理", row.id);
  ok(res, toApi(getById(row.id)));
});

export { router as noticesRouter };
