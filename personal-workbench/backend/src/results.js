// 开标结果（文件上传 + 在线预览）
import { Router } from "express";
import { db } from "./db.js";
import { ok, fail, now } from "./util.js";
import { record } from "./audit.js";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, resolve, extname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = resolve(__dirname, "..", "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

const MIME_MAP = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};

function mimeFor(name) {
  const ext = extname(String(name || "")).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function toApi(row) {
  if (!row) return null;
  const abs = row.storage_path ? fileAbs(row) : null;
  return {
    id: row.id, projectId: row.project_id ?? null, projectName: row.project_name ?? null,
    name: row.name, mime: row.mime, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at,
    // 文件是否真的还在磁盘上：备份/恢复只带元数据，会出现"有记录、没文件"的情况，
    // 前端据此显示「文件缺失」并允许原地重新上传，避免用户点开才发现是空的。
    exists: abs ? (insideUploadDir(abs) && existsSync(abs)) : false,
  };
}

function getById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare("SELECT r.*, p.name AS project_name FROM bid_result r LEFT JOIN bid_project p ON p.id = r.project_id WHERE r.id = ?").get(n);
}

function fileAbs(row) {
  return resolve(UPLOAD_DIR, row.storage_path);
}

// 严格判定"在上传目录内"：用 relative 而不是 startsWith，
// 否则 uploads-old/xxx 这类同前缀兄弟目录会被误判为合法。
function insideUploadDir(abs) {
  const rel = relative(UPLOAD_DIR, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// base64 → Buffer（含体积校验）
function decodeUpload(data) {
  let buf;
  try { buf = Buffer.from(String(data || ""), "base64"); }
  catch { return { error: "文件内容无效" }; }
  if (!buf || buf.length === 0) return { error: "文件内容为空" };
  if (buf.length > MAX_SIZE) return { error: "文件过大（≤20MB）", tooLarge: true };
  return { buf };
}

router.get("/", (req, res) => {
  const where = [];
  const params = [];
  if (req.query.projectId) { where.push("r.project_id = ?"); params.push(Number(req.query.projectId)); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const rows = db.prepare(`
    SELECT r.*, p.name AS project_name FROM bid_result r LEFT JOIN bid_project p ON p.id = r.project_id
    ${whereSql} ORDER BY r.uploaded_at DESC, r.id DESC LIMIT 200
  `).all(...params);
  ok(res, { list: rows.map(toApi), total: rows.length });
});

router.post("/", (req, res) => {
  const body = req.body || {};
  const projectId = (body.projectId === null || body.projectId === undefined || body.projectId === "") ? null : Number(body.projectId);
  const name = (body.name || "").trim();
  const data = body.data; // base64
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "缺少文件名");
  if (!data) return fail(res, 400, "VALIDATION_ERROR", "缺少文件内容");
  if (projectId != null && !db.prepare("SELECT id FROM bid_project WHERE id = ? AND deleted_at IS NULL").get(projectId)) {
    return fail(res, 400, "VALIDATION_ERROR", "项目不存在");
  }
  const decoded = decodeUpload(data);
  if (decoded.error) return fail(res, decoded.tooLarge ? 413 : 400, "VALIDATION_ERROR", decoded.error);
  const buf = decoded.buf;

  const storageName = `${Date.now()}-${randomUUID()}${extname(name)}`;
  try { writeFileSync(resolve(UPLOAD_DIR, storageName), buf); }
  catch (e) { return fail(res, 500, "INTERNAL", "文件保存失败"); }

  const mime = mimeFor(name);
  const t = now();
  const info = db.prepare("INSERT INTO bid_result (project_id, name, storage_path, mime, size_bytes, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, name, storageName, mime, buf.length, t);
  record("upload", "result", Number(info.lastInsertRowid), { name, projectId });
  ok(res, toApi(getById(Number(info.lastInsertRowid))), 201);
});

// 为"记录还在、文件已丢失"的历史记录原地补传文件：PUT /results/:id/content  body { name?, data }
// 用于备份恢复后（备份不含文件二进制）把原件重新挂回同一条记录，不产生新的重复记录。
router.put("/:id/content", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "记录不存在");
  const body = req.body || {};
  const data = body.data;
  if (!data) return fail(res, 400, "VALIDATION_ERROR", "缺少文件内容");
  const name = String(body.name || row.name || "").trim();
  if (!name) return fail(res, 400, "VALIDATION_ERROR", "缺少文件名");

  const decoded = decodeUpload(data);
  if (decoded.error) return fail(res, decoded.tooLarge ? 413 : 400, "VALIDATION_ERROR", decoded.error);
  const buf = decoded.buf;

  const storageName = `${Date.now()}-${randomUUID()}${extname(name)}`;
  try { writeFileSync(resolve(UPLOAD_DIR, storageName), buf); }
  catch { return fail(res, 500, "INTERNAL", "文件保存失败"); }

  const oldAbs = fileAbs(row);
  const oldWasInside = insideUploadDir(oldAbs) && existsSync(oldAbs);
  db.prepare("UPDATE bid_result SET name = ?, storage_path = ?, mime = ?, size_bytes = ?, uploaded_at = ? WHERE id = ?")
    .run(name, storageName, mimeFor(name), buf.length, now(), row.id);
  // 旧文件确实存在才删除（避免误删同前缀目录下的文件）
  if (oldWasInside && oldAbs !== resolve(UPLOAD_DIR, storageName)) {
    try { unlinkSync(oldAbs); } catch { /* 残留无害 */ }
  }
  record("upload", "result", row.id, { name, replaced: true });
  ok(res, toApi(getById(row.id)));
});

router.get("/:id/content", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "文件不存在");
  const abs = fileAbs(row);
  if (!insideUploadDir(abs)) return fail(res, 403, "FORBIDDEN", "非法路径");
  try {
    const data = readFileSync(abs);
    res.writeHead(200, {
      "content-type": row.mime || "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "content-length": data.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  } catch { fail(res, 404, "NOT_FOUND", "文件读取失败（该记录的文件可能已丢失，可用「重新上传」补回）"); }
});

router.get("/:id/download", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "文件不存在");
  const abs = fileAbs(row);
  if (!insideUploadDir(abs)) return fail(res, 403, "FORBIDDEN", "非法路径");
  try {
    const data = readFileSync(abs);
    res.writeHead(200, {
      "content-type": row.mime || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "content-length": data.length,
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  } catch { fail(res, 404, "NOT_FOUND", "文件读取失败（该记录的文件可能已丢失，可用「重新上传」补回）"); }
});

router.delete("/:id", (req, res) => {
  const row = getById(req.params.id);
  if (!row) return fail(res, 404, "NOT_FOUND", "文件不存在");
  db.prepare("DELETE FROM bid_result WHERE id = ?").run(row.id);
  const abs = fileAbs(row);
  if (insideUploadDir(abs)) { try { unlinkSync(abs); } catch { /* ignore */ } }
  record("delete", "result", row.id, { name: row.name });
  ok(res, { deleted: true, id: row.id });
});

export { router as resultsRouter };
