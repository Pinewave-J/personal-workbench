// 操作日志：记录 + 查询
import { Router } from "express";
import { db } from "./db.js";
import { ok, now } from "./util.js";

// 记录一条操作日志（同步、永不抛出，避免影响主流程）
export function record(action, entityType, entityId = null, detail = null) {
  try {
    db.prepare("INSERT INTO audit_log (action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(action, entityType, entityId, detail != null ? JSON.stringify(detail) : null, now());
  } catch (e) {
    console.error("[audit]", e);
  }
}

function toApi(row) {
  let detail = null;
  if (row.detail) { try { detail = JSON.parse(row.detail); } catch { detail = row.detail; } }
  return {
    id: row.id, action: row.action, entityType: row.entity_type,
    entityId: row.entity_id, detail, createdAt: row.created_at,
  };
}

const router = Router();

router.get("/", (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const where = [];
  const params = [];
  if (req.query.action) { where.push("action = ?"); params.push(req.query.action); }
  if (req.query.entityType) { where.push("entity_type = ?"); params.push(req.query.entityType); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit_log ${whereSql}`).get(...params);
  const rows = db.prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ?`).all(...params, limit);
  ok(res, { list: rows.map(toApi), total });
});

export { router as auditRouter };
