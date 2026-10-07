// 投标文件（项目文件夹链接，一个项目一条）
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";

const router = Router();

function toApi(row) {
  if (!row) return null;
  return { id: row.id, projectId: row.project_id, projectName: row.project_name ?? null, url: row.url, createdAt: row.created_at };
}

function projectExists(id) {
  return !!db.prepare("SELECT id FROM bid_project WHERE id = ? AND deleted_at IS NULL").get(id);
}

function getById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT d.*, p.name AS project_name FROM bid_document d JOIN bid_project p ON p.id = d.project_id WHERE d.id = ?").get(n);
}

router.get("/", (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, p.name AS project_name FROM bid_document d JOIN bid_project p ON p.id = d.project_id
    ORDER BY p.name ASC, d.id ASC LIMIT 200
  `).all();
  ok(res, { list: rows.map(toApi), total: rows.length });
});

router.get("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "链接不存在");
  ok(res, toApi(row));
});

// 新增/更新（一个项目一条：已存在则更新链接）
router.post("/", (req, res) => {
  const body = req.body || {};
  const projectId = Number(body.projectId);
  const url = (body.url ?? "").trim();
  if (!Number.isInteger(projectId) || projectId <= 0) return fail(res, 400, "VALIDATION_ERROR", "请选择所属项目", { projectId: "必填" });
  if (!projectExists(projectId)) return fail(res, 400, "VALIDATION_ERROR", "项目不存在");
  if (!url) return fail(res, 400, "VALIDATION_ERROR", "请填写项目文件夹链接", { url: "必填" });

  const existing = db.prepare("SELECT id FROM bid_document WHERE project_id = ?").get(projectId);
  if (existing) {
    db.prepare("UPDATE bid_document SET url = ? WHERE id = ?").run(url, existing.id);
    record("update", "document", existing.id, { projectId });
    return ok(res, toApi(getById(existing.id)));
  }
  const t = now();
  const info = db.prepare("INSERT INTO bid_document (project_id, url, created_at) VALUES (?, ?, ?)").run(projectId, url, t);
  record("create", "document", Number(info.lastInsertRowid), { projectId });
  ok(res, toApi(getById(Number(info.lastInsertRowid))), 201);
});

router.delete("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "链接不存在");
  db.prepare("DELETE FROM bid_document WHERE id = ?").run(row.id);
  record("delete", "document", row.id, { projectId: row.project_id });
  ok(res, { deleted: true, id: row.id });
});

export { router as documentsRouter };
