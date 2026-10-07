// 导入 / 导出（CSV + JSON 备份）
import { Router } from "express";
import { db, SCHEMA_VERSION, DATA_DIR } from "./db.js";
import { ok, fail, now } from "./util.js";
import { STATUS, CATEGORY } from "./status.js";
import { toApi } from "./mapper.js";
import { nextProjectCode } from "./projects.js";
import { record } from "./audit.js";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const router = Router();
const MAX_IMPORT_ROWS = 2000;

// ---- 项目 CSV 列定义（导出顺序 = 无表头时的默认导入顺序） ----
const PROJECT_CSV_COLS = [
  ["name", "项目名称"],
  ["tenderNo", "招标编号"],
  ["lotNo", "标段号"],
  ["category", "类别"],
  ["industry", "行业"],
  ["region", "地区"],
  ["tenderer", "招标人"],
  ["agency", "代理机构"],
  ["duration", "工期"],
  ["budget", "预算(万元)"],
  ["bond", "保证金(万元)"],
  ["bidPrice", "投标报价(万元)"],
  ["status", "状态"],
  ["registerTime", "报名时间"],
  ["deadline", "投标截止"],
  ["validityDays", "有效期(天)"],
  ["contactName", "联系人"],
  ["contactPhone", "联系电话"],
  ["notes", "备注"],
];
const MONEY_KEYS = new Set(["budget", "bond", "bidPrice"]);

function dateStamp() { return new Date().toISOString().slice(0, 10); }
function strOrNull(v) { const s = String(v ?? "").trim(); return s === "" ? null : s; }
function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function wan(v) { return (v == null || v === "" || !Number.isFinite(Number(v))) ? "" : String(Number(v) / 10000); }

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendFile(res, content, type, filename) {
  res.writeHead(200, {
    "content-type": type,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  res.end(content);
}

function projectsRows() {
  return db.prepare("SELECT * FROM bid_project WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC").all().map(toApi);
}

function projectCsv() {
  const rows = projectsRows();
  const head = PROJECT_CSV_COLS.map(([, label]) => label);
  const lines = [head, ...rows.map((r) => PROJECT_CSV_COLS.map(([key]) => {
    if (MONEY_KEYS.has(key)) return wan(r[key]);
    return r[key] ?? "";
  }))];
  return "\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// ---- 导出 ----
router.get("/export/projects", (req, res) => {
  const format = String(req.query.format || "csv").toLowerCase();
  const rows = projectsRows();
  record("export", "project", null, { count: rows.length, format });
  if (format === "json") {
    return sendFile(res, JSON.stringify({ version: 1, exportedAt: now(), projects: rows }, null, 2),
      "application/json; charset=utf-8", `projects-${dateStamp()}.json`);
  }
  sendFile(res, projectCsv(), "text/csv; charset=utf-8", `projects-${dateStamp()}.csv`);
});

router.get("/export/backup", (req, res) => {
  const pick = (sql) => db.prepare(sql).all();
  const projects = db.prepare("SELECT * FROM bid_project WHERE deleted_at IS NULL ORDER BY id ASC").all();
  const statusLogs = pick("SELECT * FROM bid_status_log ORDER BY id ASC");
  const documents = pick("SELECT * FROM bid_document ORDER BY id ASC");
  const schedules = pick("SELECT * FROM schedule_reminder ORDER BY id ASC");
  const notices = pick("SELECT * FROM tender_notice ORDER BY id ASC");
  const results = db.prepare("SELECT id, project_id, name, storage_path, mime, size_bytes, uploaded_at FROM bid_result ORDER BY id ASC").all();
  // 个人工作台新增
  const recurringTemplates = pick("SELECT * FROM recurring_template WHERE deleted_at IS NULL ORDER BY id ASC");
  const customers = pick("SELECT * FROM customer WHERE deleted_at IS NULL ORDER BY id ASC");
  const personalTasks = db.prepare("SELECT * FROM personal_task WHERE deleted_at IS NULL ORDER BY id ASC").all();
  const followUps = pick("SELECT * FROM customer_follow_up ORDER BY id ASC");
  const payload = {
    version: 2, schemaVersion: SCHEMA_VERSION, exportedAt: now(),
    note: "完整备份 v2：含投标项目/状态历史/文档链接/日程/公告/开标结果元数据 + 个人任务/周期模板/客户/跟进记录（不含文件二进制）",
    projects, statusLogs, documents, schedules, notices, results,
    recurringTemplates, customers, personalTasks, followUps,
  };
  record("export", "backup", null, { projects: projects.length, tasks: personalTasks.length, customers: customers.length });
  sendFile(res, JSON.stringify(payload, null, 2), "application/json; charset=utf-8", `backup-${dateStamp()}.json`);
});

// ================= 完整备份恢复 =================
// POST /import/backup  body: { data: '<JSON 字符串>', confirm: 'RESTORE' }
// version>=2 或含个人表键 → 全量恢复（清 9 张业务表后按原 id 插入）
// version=1（仅投标五表）→ 只恢复投标相关表，个人模块数据保留
function projectCamelToCol(row) {
  // 兼容旧备份（projects 存 camelCase 行）→ 转回 snake_case 列
  const MAP = {
    id: "id", projectCode: "project_code", name: "name", tenderNo: "tender_no", lotNo: "lot_no",
    category: "category", region: "region", tenderer: "tenderer", agency: "agency", duration: "duration",
    budget: "budget", bond: "bond", bidPrice: "bid_price", status: "status",
    registerTime: "register_time", deadline: "deadline", openTime: "open_time",
    validityDays: "validity_days", contactName: "contact_name", contactPhone: "contact_phone",
    notes: "notes", createdAt: "created_at", updatedAt: "updated_at", deletedAt: "deleted_at",
  };
  if (row.project_code !== undefined) return row; // 已是 snake_case
  const out = {};
  for (const [k, v] of Object.entries(row)) if (MAP[k]) out[MAP[k]] = v;
  return out;
}

// ================= 恢复用的表清单 / 列白名单 / 校验 =================
// 全量恢复（清这些表后按原 id 插回）；v1 只恢复投标相关表，个人模块数据保留
const TABLES_FULL = [
  "customer_follow_up", "personal_task", "customer", "recurring_template", "bid_result",
  "bid_document", "schedule_reminder", "tender_notice", "bid_status_log", "bid_project",
];
// v1 路径必须也清 tender_notice：bid_project 会按原 id 回填，残留的公告会挂到"另一个项目"上
const TABLES_V1 = [
  "tender_notice", "bid_result", "bid_document", "schedule_reminder", "bid_status_log", "bid_project",
];

const colCache = new Map();
function tableColumns(table) {
  if (!colCache.has(table)) colCache.set(table, db.prepare(`PRAGMA table_info(${table})`).all());
  return colCache.get(table);
}
function allowedColumns(table) { return new Set(tableColumns(table).map((c) => c.name)); }
// 无默认值的 NOT NULL 列（主键除外）：备份里必须真的带上
function requiredColumns(table) {
  return tableColumns(table).filter((c) => c.notnull === 1 && c.dflt_value === null && c.pk === 0).map((c) => c.name);
}

// 纯校验（不写库）：未知列 + 缺失必填列。用于"清库之前"发现坏备份。
function validateRows(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const allowed = allowedColumns(table);
  const required = requiredColumns(table);
  const problems = [];
  rows.forEach((r, i) => {
    const row = r || {};
    const unknown = Object.keys(row).filter((k) => !allowed.has(k));
    if (unknown.length) problems.push(`${table} 第 ${i + 1} 行含未知列：${unknown.slice(0, 5).join("、")}`);
    const missing = required.filter((k) => row[k] === undefined || row[k] === null);
    if (missing.length) problems.push(`${table} 第 ${i + 1} 行缺少必填列：${missing.join("、")}`);
  });
  return problems.slice(0, 10);
}

// 写入：默认任何一行写不进去就整体抛错，由外层 ROLLBACK 回滚（数据不会被清空后丢掉）。
// skipRefErrors=true 时只放过"外键引用不存在的父行"这一种错误，并把它统计进 skippedRefs，
// 由响应明确告知用户被跳过了多少行——用于恢复那种父行缺失的历史备份（否则该备份完全无法恢复）。
function insertRows(table, rows, opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return { table, inserted: 0, provided: 0, skippedRef: 0 };
  const allowed = allowedColumns(table);
  const cols = new Set(["id"]);
  for (const r of rows) for (const k of Object.keys(r || {})) if (allowed.has(k)) cols.add(k);
  const colList = [...cols];
  const stmt = db.prepare(`INSERT INTO ${table} (${colList.join(", ")}) VALUES (${colList.map(() => "?").join(", ")})`);
  const problems = [];
  let n = 0, skippedRef = 0;
  rows.forEach((r, i) => {
    if (problems.length >= 10) return;
    const vals = colList.map((k) => (r?.[k] === undefined ? null : r[k]));
    try { stmt.run(...vals); n++; }
    catch (e) {
      const msg = String(e?.message || e);
      if (opts.skipRefErrors && /FOREIGN KEY constraint failed/i.test(msg)) { skippedRef++; return; }
      problems.push(`${table} 第 ${i + 1} 行：${msg}`);
    }
  });
  if (problems.length) {
    const err = new Error(`恢复中断：${problems.length} 行数据无法写入（示例：${problems.slice(0, 3).join("；")}）`);
    err.restoreProblems = problems;
    throw err;
  }
  return { table, inserted: n, provided: rows.length, skippedRef };
}

// 恢复前一致性快照（VACUUM INTO 会包含 WAL 中尚未 checkpoint 的数据）
// 文件名带毫秒 + 冲突自增后缀：同一秒内连续两次恢复也不会因"文件已存在"而失败。
function snapshotBeforeRestore() {
  const dir = resolve(DATA_DIR, "backups");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, "-").replace("Z", "").replace(".", "-").slice(0, 23);
  for (let n = 0; n < 50; n++) {
    const file = resolve(dir, `pre-restore-${ts}${n === 0 ? "" : `-${n}`}.db`);
    if (existsSync(file)) continue;
    db.exec(`VACUUM INTO '${file.replace(/\\/g, "/").replace(/'/g, "''")}';`);
    return file;
  }
  throw new Error("无法生成恢复前快照（备份目录内文件名冲突）");
}

router.post("/import/backup", (req, res) => {
  const body = req.body || {};
  if (body.confirm !== "RESTORE") {
    return fail(res, 400, "VALIDATION_ERROR", "恢复为危险操作，必须传 confirm:'RESTORE'");
  }
  const data = body.data;
  if (!data || !String(data).trim()) return fail(res, 400, "VALIDATION_ERROR", "缺少备份内容");
  let payload;
  try { payload = JSON.parse(data); } catch { return fail(res, 400, "VALIDATION_ERROR", "JSON 解析失败"); }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.projects)) {
    return fail(res, 400, "VALIDATION_ERROR", "不是有效的备份文件（缺少 projects 数组）");
  }
  const version = Number(payload.version) || 1;
  if (version > SCHEMA_VERSION) {
    return fail(res, 409, "CONFLICT", `备份结构版本 v${version} 高于当前程序支持的 v${SCHEMA_VERSION}，请先升级程序再恢复`);
  }
  const hasPersonal = version >= 2 || Array.isArray(payload.personalTasks) || Array.isArray(payload.customers) || Array.isArray(payload.recurringTemplates) || Array.isArray(payload.followUps);
  const projects = (payload.projects || []).map(projectCamelToCol);
  const allowEmpty = body.allowEmpty === true;
  if (projects.length === 0 && !allowEmpty) {
    return fail(res, 400, "VALIDATION_ERROR",
      "备份里没有任何投标项目（projects 为空），疑似空文件或损坏文件；确认要清空请显式传 allowEmpty:true");
  }

  const plan = [
    ["bid_project", projects],
    ["bid_status_log", payload.statusLogs],
    ["bid_document", payload.documents],
    ["schedule_reminder", payload.schedules],
    ["tender_notice", payload.notices],
    ["bid_result", payload.results],
  ];
  if (hasPersonal) {
    plan.push(
      ["recurring_template", payload.recurringTemplates],
      ["customer", payload.customers],
      ["personal_task", payload.personalTasks],
      ["customer_follow_up", payload.followUps],
    );
  }

  // ---- 第 1 步：清库之前先校验结构，坏备份不会走到"清空"这一步 ----
  const problems = [];
  for (const [table, rows] of plan) {
    if (rows === undefined || rows === null) continue;
    if (!Array.isArray(rows)) { problems.push(`${table} 不是数组`); continue; }
    problems.push(...validateRows(table, rows));
    if (problems.length >= 10) break;
  }
  if (problems.length) {
    return fail(res, 400, "VALIDATION_ERROR", `备份校验未通过，未做任何改动（共 ${problems.length} 项）：${problems.slice(0, 3).join("；")}`);
  }

  // ---- 第 2 步：恢复前快照（失败就不恢复）----
  let snapshot = null;
  try { snapshot = snapshotBeforeRestore(); }
  catch (e) {
    return fail(res, 500, "INTERNAL", `恢复前快照生成失败，已取消恢复（原数据未改动）：${String(e?.message || e)}`);
  }

  // ---- 第 3 步：清表 + 按原 id 回填；任何失败整体回滚 ----
  const skipInvalidRefs = body.skipInvalidRefs === true;
  const stats = {};
  let skippedRefTotal = 0;
  db.exec("BEGIN");
  try {
    for (const tbl of (hasPersonal ? TABLES_FULL : TABLES_V1)) db.exec(`DELETE FROM ${tbl};`);
    for (const [table, rows] of plan) {
      const r = insertRows(table, rows, { skipRefErrors: skipInvalidRefs });
      skippedRefTotal += r.skippedRef;
      stats[r.table] = { provided: r.provided, inserted: r.inserted };
      if (r.skippedRef) stats[r.table].skippedRef = r.skippedRef;
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已在错误态 */ }
    console.error("[restore]", e);
    const detail = Array.isArray(e?.restoreProblems) ? `：${e.restoreProblems.slice(0, 3).join("；")}` : "";
    const hint = /FOREIGN KEY constraint failed/i.test(detail) && !skipInvalidRefs
      ? "（该备份里有子表行引用了不存在的项目/客户；如确认要恢复，可勾选“跳过无效关联行”重试）"
      : "";
    return fail(res, 400, "VALIDATION_ERROR",
      `恢复失败，已回滚（数据保持不变）${detail}${hint}。恢复前快照：${snapshot}`);
  }
  record("import", "backup", null, { ...stats, confirm: true, version, snapshot, skippedRefTotal });
  ok(res, {
    restored: true, version, full: hasPersonal, stats, snapshot,
    skippedInvalidRefs: skippedRefTotal,
    warning: skippedRefTotal > 0
      ? `有 ${skippedRefTotal} 行因引用的项目/客户不在该备份中而被跳过（其父级数据已不存在）`
      : null,
  });
});

// ---- CSV 解析 ----
function parseCsv(text) {
  const s = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

const norm = (s) => String(s ?? "").trim().replace(/\s+/g, "");

function parseProjectCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const labelIndex = {};
  PROJECT_CSV_COLS.forEach(([key, label]) => { labelIndex[norm(label)] = key; });
  const first = rows[0].map(norm);
  const hasHeader = first.some((h) => h === "项目名称" || h === "名称" || h === "项目名");
  let dataRows = rows, colMap = null;
  if (hasHeader) {
    dataRows = rows.slice(1);
    colMap = first.map((h) => labelIndex[h] || null);
  }
  return dataRows.map((cells) => {
    const obj = {};
    if (colMap) colMap.forEach((key, i) => { if (key) obj[key] = String(cells[i] ?? "").trim(); });
    else PROJECT_CSV_COLS.forEach(([key], i) => { obj[key] = String(cells[i] ?? "").trim(); });
    // CSV 中金额为万元，入库前换算为元
    for (const k of MONEY_KEYS) {
      if (obj[k] != null && obj[k] !== "") obj[k] = Number(obj[k]) * 10000;
    }
    return obj;
  });
}

function parseProjectJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("JSON 解析失败"); }
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.projects) ? data.projects : null);
  if (!arr) throw new Error("JSON 内容格式不支持（应为项目数组或含 projects 数组的对象）");
  return arr;
}

function insertProject(obj) {
  const name = String(obj.name ?? "").trim();
  if (!name) return { ok: false, error: "缺少项目名称" };
  let category = String(obj.category ?? "").trim();
  if (!CATEGORY.includes(category)) category = "其他";
  let status = String(obj.status ?? "").trim();
  if (!STATUS.includes(status)) status = "跟踪中";
  const code = nextProjectCode();
  const t = now();
  const f = {
    tenderNo: strOrNull(obj.tenderNo), lotNo: strOrNull(obj.lotNo), industry: strOrNull(obj.industry),
    region: strOrNull(obj.region), tenderer: strOrNull(obj.tenderer), agency: strOrNull(obj.agency), duration: strOrNull(obj.duration),
    budget: num(obj.budget), bond: num(obj.bond), bidPrice: num(obj.bidPrice),
    registerTime: strOrNull(obj.registerTime), deadline: strOrNull(obj.deadline),
    validityDays: num(obj.validityDays), contactName: strOrNull(obj.contactName),
    contactPhone: strOrNull(obj.contactPhone), notes: strOrNull(obj.notes),
  };
  try {
    const info = db.prepare(`
      INSERT INTO bid_project (project_code, name, tender_no, lot_no, category, industry, region, tenderer, agency, duration, budget, bond, bid_price, status, register_time, deadline, open_time, validity_days, contact_name, contact_phone, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, name, f.tenderNo, f.lotNo, category, f.industry, f.region, f.tenderer, f.agency, f.duration,
      f.budget, f.bond, f.bidPrice, status, f.registerTime, f.deadline, f.deadline,
      f.validityDays, f.contactName, f.contactPhone, f.notes, t, t
    );
    return { ok: true, id: Number(info.lastInsertRowid), name, code };
  } catch (e) {
    return { ok: false, error: String(e?.message || "插入失败") };
  }
}

// ---- 导入 ----
router.post("/import/projects", (req, res) => {
  const body = req.body || {};
  const format = String(body.format || "").toLowerCase() === "json" ? "json" : "csv";
  const data = body.data;
  if (!data || !String(data).trim()) return fail(res, 400, "VALIDATION_ERROR", "缺少导入内容");

  let arr;
  try { arr = format === "json" ? parseProjectJson(data) : parseProjectCsv(data); }
  catch (e) { return fail(res, 400, "VALIDATION_ERROR", String(e?.message || "解析失败")); }

  if (!Array.isArray(arr)) return fail(res, 400, "VALIDATION_ERROR", "数据格式无效");
  if (!arr.length) return fail(res, 400, "VALIDATION_ERROR", "未解析到任何数据行");
  if (arr.length > MAX_IMPORT_ROWS) arr = arr.slice(0, MAX_IMPORT_ROWS);

  const created = [], errors = [];
  for (const obj of arr) {
    const r = insertProject(obj);
    if (r.ok) created.push({ id: r.id, name: r.name, projectCode: r.code });
    else errors.push({ name: String(obj?.name ?? "").trim(), error: r.error });
  }
  record("import", "project", null, { created: created.length, skipped: errors.length, format });
  ok(res, {
    created: created.length, skipped: errors.length, format,
    createdList: created.slice(0, 50), errors: errors.slice(0, 50),
  });
});

// ================= 个人工作台：各模块 CSV 导出 =================
const TASK_SOURCE_ZH = { manual: "手动", recurring: "每月周期", customer: "客户跟进" };

function rowsCsv(headers, rows) {
  const lines = [headers, ...rows.map((row) => headers.map((h) => row[h[0]] ?? ""))];
  return "\uFEFF" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
}

router.get("/export/tasks", (req, res) => {
  const rows = db.prepare(`
    SELECT t.title, t.notes, t.quadrant, t.due_date, t.remind_days, t.status, t.source,
           c.name AS customer_name, rt.name AS template_name, t.month_tag, t.completed_at
    FROM personal_task t
    LEFT JOIN customer c ON c.id = t.customer_id
    LEFT JOIN recurring_template rt ON rt.id = t.template_id
    WHERE t.deleted_at IS NULL ORDER BY t.due_date IS NULL, t.due_date ASC, t.id ASC
  `).all().map((r) => ({
    title: r.title, notes: r.notes, quadrant: r.quadrant, dueDate: r.due_date,
    remindDays: r.remind_days, status: r.status,
    source: TASK_SOURCE_ZH[r.source] || r.source, customer: r.customer_name ?? "", template: r.template_name ?? "",
    month: r.month_tag ?? "", completedAt: r.completed_at,
  }));
  const headers = [
    ["title", "任务标题"], ["notes", "备注"], ["quadrant", "四象限"], ["dueDate", "截止日期"],
    ["remindDays", "提前提醒(天)"], ["status", "状态"], ["source", "来源"], ["customer", "关联客户"],
    ["template", "所属周期模板"], ["month", "所属月份"], ["completedAt", "完成时间"],
  ];
  record("export", "task", null, { count: rows.length, format: "csv" });
  sendFile(res, rowsCsv(headers, rows), "text/csv; charset=utf-8", `tasks-${dateStamp()}.csv`);
});

router.get("/export/customers", (req, res) => {
  const rows = db.prepare("SELECT * FROM customer WHERE deleted_at IS NULL ORDER BY id ASC").all().map((c) => ({
    name: c.name, shortName: c.short_name ?? "", industry: c.industry ?? "", region: c.region ?? "",
    contactName: c.contact_name ?? "", contactPhone: c.contact_phone ?? "", email: c.email ?? "",
    status: c.status, source: c.source ?? "", nextFollowDate: c.next_follow_date ?? "",
    lastFollowAt: c.last_follow_at ?? "", notes: c.notes ?? "",
  }));
  const headers = [
    ["name", "客户名称"], ["shortName", "简称"], ["industry", "行业"], ["region", "地区"],
    ["contactName", "联系人"], ["contactPhone", "电话"], ["email", "邮箱"], ["status", "状态"],
    ["source", "客户来源"], ["nextFollowDate", "下次跟进日期"], ["lastFollowAt", "最近跟进"], ["notes", "备注"],
  ];
  record("export", "customer", null, { count: rows.length, format: "csv" });
  sendFile(res, rowsCsv(headers, rows), "text/csv; charset=utf-8", `customers-${dateStamp()}.csv`);
});

router.get("/export/follow-ups", (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, c.name AS customer_name FROM customer_follow_up f
    LEFT JOIN customer c ON c.id = f.customer_id
    ORDER BY f.follow_at DESC, f.id DESC
  `).all().map((f) => ({
    customer: f.customer_name ?? `#${f.customer_id}`, followType: f.follow_type, content: f.content,
    followAt: f.follow_at, nextFollowDate: f.next_follow_date ?? "", createdAt: f.created_at,
  }));
  const headers = [
    ["customer", "客户名称"], ["followType", "跟进方式"], ["content", "跟进内容"],
    ["followAt", "跟进日期"], ["nextFollowDate", "下次跟进日期"], ["createdAt", "创建时间"],
  ];
  record("export", "follow_up", null, { count: rows.length, format: "csv" });
  sendFile(res, rowsCsv(headers, rows), "text/csv; charset=utf-8", `follow-ups-${dateStamp()}.csv`);
});

export { router as ioRouter };
