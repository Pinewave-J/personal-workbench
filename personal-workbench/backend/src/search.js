// 全局搜索：投标项目 / 个人任务 / 客户（跨模块）
import { Router } from "express";
import { db } from "./db.js";
import { ok } from "./util.js";
import { toApi as projectApi } from "./mapper.js";

const router = Router();

// GET /search?q=关键词
router.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return ok(res, { projects: [], tasks: [], customers: [] });
  const like = `%${q}%`;
  const LIMIT = 10;

  const projects = db.prepare(`
    SELECT * FROM bid_project
    WHERE deleted_at IS NULL AND (name LIKE ? OR tender_no LIKE ? OR tenderer LIKE ? OR agency LIKE ? OR contact_name LIKE ? OR project_code LIKE ?)
    ORDER BY updated_at DESC LIMIT ?
  `).all(like, like, like, like, like, like, LIMIT).map(projectApi).map((p) => ({ kind: "project", ...p }));

  const tasks = db.prepare(`
    SELECT t.id, t.title, t.notes, t.due_date, t.status, t.quadrant, t.source, c.name AS customer_name
    FROM personal_task t LEFT JOIN customer c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL AND (t.title LIKE ? OR t.notes LIKE ?)
    ORDER BY t.updated_at DESC LIMIT ?
  `).all(like, like, LIMIT).map((t) => ({
    kind: "task", id: t.id, title: t.title, notes: t.notes, dueDate: t.due_date,
    status: t.status, quadrant: t.quadrant, source: t.source, customerName: t.customer_name,
  }));

  const customers = db.prepare(`
    SELECT * FROM customer
    WHERE deleted_at IS NULL AND (name LIKE ? OR short_name LIKE ? OR contact_name LIKE ? OR contact_phone LIKE ? OR industry LIKE ? OR notes LIKE ?)
    ORDER BY updated_at DESC LIMIT ?
  `).all(like, like, like, like, like, like, LIMIT).map((c) => ({
    kind: "customer", id: c.id, name: c.name, shortName: c.short_name,
    contactName: c.contact_name, status: c.status, nextFollowDate: c.next_follow_date,
  }));

  ok(res, { query: q, projects, tasks, customers });
});

export { router as searchRouter };
