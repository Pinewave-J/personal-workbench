// 后端入口：Express 应用
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectsRouter } from "./projects.js";
import { dashboardRouter } from "./dashboard.js";
import { noticesRouter } from "./notices.js";
import { documentsRouter } from "./documents.js";
import { schedulesRouter } from "./schedules.js";
import { resultsRouter } from "./results.js";
import { auditRouter } from "./audit.js";
import { ioRouter } from "./io.js";
import { tasksRouter, recurringTemplatesRouter } from "./tasks.js";
import { customersRouter, followUpsRouter } from "./customers.js";
import { searchRouter } from "./search.js";
import { aiJobsRouter } from "./ai.js";
import { mainRouter } from "./main.js";
import { bidOpsRouter } from "./bid-ops.js";
import { bidOutlineRouter } from "./bid-outline.js";
import { bidTasksRouter } from "./bid-tasks.js";
import { bidMaterialsRouter } from "./bid-materials.js";
import { ok } from "./util.js";

const app = express();
app.use(express.json({ limit: "40mb" }));

// CORS：前端从工作台（:3080）跨域访问本服务
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/v1/health", (req, res) => ok(res, { ok: true }));

// ---- 系统图谱（archify 生成的独立 HTML，自带 viewer）：只读静态托管 ----
// 路径解析：backend/src → ../.. = 工作台根目录 → graphs/
// express.static 默认忽略点开头目录，所以 archify 的 .archify-delivery-* 快照不会被暴露
const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPHS_DIR = resolve(__dirname, "..", "..", "graphs");
app.use("/api/v1/graphs", express.static(GRAPHS_DIR));

app.use("/api/v1/projects", projectsRouter);
app.use("/api/v1", dashboardRouter);
app.use("/api/v1/notices", noticesRouter);
app.use("/api/v1/documents", documentsRouter);
app.use("/api/v1/schedules", schedulesRouter);
app.use("/api/v1/results", resultsRouter);
app.use("/api/v1/audit-logs", auditRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/recurring-templates", recurringTemplatesRouter);
app.use("/api/v1/customers", customersRouter);
app.use("/api/v1/follow-ups", followUpsRouter);
app.use("/api/v1", searchRouter);
// AI 助手暂存队列（AI 只写 ai_job/ai_suggestion，不直写业务表）
app.use("/api/v1/ai-jobs", aiJobsRouter);
// 标书编制（投标文件生成全过程：阶段/闸口/章节镜像/版本）
// 注意顺序：任务队列与目录路由先注册，避免 /tasks、/:id/outline 被 mainRouter 的 /:id 抢先匹配
app.use("/api/v1/main-projects", bidTasksRouter);
app.use("/api/v1/main-projects", bidOutlineRouter);
app.use("/api/v1/main-projects", mainRouter);
// 标书编制操作面板（bid 命令执行/文件读写/报告/下载）
app.use("/api/v1/main-projects", bidOpsRouter);
// 公司级素材库（旧标书复用：索引/检索/片段）——独立前缀，避免与 /:id 路由歧义
app.use("/api/v1/bid-materials", bidMaterialsRouter);
app.use("/api/v1", ioRouter);

// ---- 前端页面托管：http://127.0.0.1:8787/ 直接打开完整工作台 ----
// 只放行前端 4 个文件（避免把 backend/、data/workbench.db 等暴露到公网可达路径）
const WORKBENCH_DIR = resolve(__dirname, "..", "..");
const FRONT_FILES = new Set([
  "personal-workbench.html",
  "personal-workbench.css",
  "personal-workbench.js",
  "personal-workbench.config.js",
]);
function sendFront(res, file) {
  const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : "text/html";
  res.type(type);
  res.sendFile(resolve(WORKBENCH_DIR, file));
}
app.get("/", (req, res) => sendFront(res, "personal-workbench.html"));
app.get("/:file", (req, res, next) => {
  const f = req.params.file;
  if (!FRONT_FILES.has(f)) return next();
  sendFront(res, f);
});
app.get("/api/v1/", (req, res) => ok(res, { name: "personal-workbench-backend", version: "1.0.0" }));

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, data: null, error: { code: "NOT_FOUND", message: "接口不存在" } });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error("[personal-workbench]", err);
  res.status(500).json({ success: false, data: null, error: { code: "INTERNAL", message: String(err?.message || err) } });
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[personal-workbench] backend ready at http://127.0.0.1:${PORT}`);
});
