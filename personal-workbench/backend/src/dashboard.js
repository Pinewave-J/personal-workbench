// 聚合接口：工作台概览 + 统计分析 + 个人总览 + 今日提醒
import { Router } from "express";
import { db } from "./db.js";
import { STATUS, CATEGORY } from "./status.js";
import { QUADRANT } from "./tasks.js";
import { toApi } from "./mapper.js";
import { ok, fail } from "./util.js";

const router = Router();

const ACTIVE = ["跟踪中", "已报名", "已购标书", "已投标"];
const TERMINAL = ["中标", "未中标", "流标"];
// "待开标"统一口径：今天起未来 30 天内（首页磁贴与今日提醒共用同一窗口，
// 旧实现首页无上界、今日提醒只有 7 天窗，导致同一个"待开标"两处数字对不上）。
const UPCOMING_DAYS = 30;
const SOON_DAYS = 7;          // 无自定义提前天数时的默认提醒窗口

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(base, n) {
  const d = new Date(base + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countWhere(where, ...params) {
  return db.prepare(`SELECT COUNT(*) AS c FROM bid_project WHERE ${where}`).get(...params).c;
}

// ---- 工作台概览 ----
router.get("/dashboard/summary", (req, res) => {
  const total = countWhere("deleted_at IS NULL");
  const active = countWhere("deleted_at IS NULL AND status IN (?, ?, ?, ?)", ...ACTIVE);
  const won = countWhere("deleted_at IS NULL AND status = ?", "中标");
  const lost = countWhere("deleted_at IS NULL AND status IN (?, ?)", "未中标", "流标");
  const today = todayStr();
  const upcoming = countWhere(
    "deleted_at IS NULL AND open_time IS NOT NULL AND open_time >= ? AND status NOT IN (?, ?, ?)",
    today, ...TERMINAL
  );

  const recent = db.prepare("SELECT * FROM bid_project WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 6").all();
  const upcomingOpenings = db.prepare(
    "SELECT * FROM bid_project WHERE deleted_at IS NULL AND open_time IS NOT NULL AND open_time >= ? AND status NOT IN (?, ?, ?) ORDER BY open_time ASC LIMIT 6"
  ).all(today, ...TERMINAL);

  ok(res, {
    counts: { total, active, upcoming, won, lost },
    recent: recent.map(toApi),
    upcomingOpenings: upcomingOpenings.map(toApi),
  });
});

// ---- 统计分析 ----
router.get("/stats/overview", (req, res) => {
  const total = countWhere("deleted_at IS NULL");
  const won = countWhere("deleted_at IS NULL AND status = ?", "中标");
  const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

  const statusMap = {};
  for (const s of STATUS) statusMap[s] = 0;
  for (const r of db.prepare("SELECT status, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY status").all()) {
    statusMap[r.status] = r.c;
  }
  const byStatus = STATUS.map((s) => ({ status: s, count: statusMap[s] }));

  const catMap = {};
  for (const c of CATEGORY) catMap[c] = 0;
  for (const r of db.prepare("SELECT category, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY category").all()) {
    catMap[r.category] = r.c;
  }
  const byCategory = CATEGORY.map((c) => ({ category: c, count: catMap[c] }));

  // 行业分布：只列出"实际有项目"的行业（空行业归「未填写」），按数量降序。
  // 「类别」在真实数据里几乎是单一值（都是工程监理），行业才是有效维度，故统计页改用这一组。
  const indMap = {};
  for (const r of db.prepare("SELECT industry, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY industry").all()) {
    const k = (r.industry && String(r.industry).trim()) ? String(r.industry).trim() : "未填写";
    indMap[k] = (indMap[k] || 0) + r.c;
  }
  const byIndustry = Object.entries(indMap)
    .map(([industry, count]) => ({ industry, count }))
    .sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry, "zh-CN"));

  const monthlyTrend = db.prepare(
    "SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY substr(created_at, 1, 7) ORDER BY month ASC"
  ).all().map((r) => ({ month: r.month, count: r.c }));

  ok(res, { total, won, winRate, byStatus, byCategory, byIndustry, monthlyTrend });
});

// ---- 个人总览（任务/客户/投标汇总） ----
router.get("/dashboard/personal", (req, res) => {
  const today = todayStr();
  const in7 = addDays(today, 7);
  const OPEN = ["待办", "进行中"];

  const countTask = (where, ...params) =>
    db.prepare(`SELECT COUNT(*) AS c FROM personal_task WHERE ${where}`).get(...params).c;

  const todayCount = countTask(`deleted_at IS NULL AND status IN (?,?) AND due_date = ?`, ...OPEN, today);
  const overdueCount = countTask(`deleted_at IS NULL AND status IN (?,?) AND due_date IS NOT NULL AND due_date < ?`, ...OPEN, today);
  // 7 天内 = 今天之后（不含今天，避免与"今日"重复计数）到第 7 天
  const in7Count = countTask(`deleted_at IS NULL AND status IN (?,?) AND due_date IS NOT NULL AND due_date > ? AND due_date <= ?`, ...OPEN, today, in7);
  const doingCount = countTask(`deleted_at IS NULL AND status = '进行中'`);
  const openCount = countTask(`deleted_at IS NULL AND status IN (?,?)`, ...OPEN);

  const qMap = {};
  for (const q of QUADRANT) qMap[q] = 0;
  for (const r of db.prepare(`SELECT quadrant, COUNT(*) AS c FROM personal_task WHERE deleted_at IS NULL AND status IN (?,?) GROUP BY quadrant`).all(...OPEN)) {
    if (qMap[r.quadrant] !== undefined) qMap[r.quadrant] = r.c;
  }
  const quadrantCounts = QUADRANT.map((q) => ({ quadrant: q, count: qMap[q] }));

  // 本月周期实例进度
  const ym = today.slice(0, 7);
  const recur = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) AS done
    FROM personal_task WHERE month_tag = ? AND deleted_at IS NULL
  `).get(ym);

  // 客户需跟进（到期/逾期未跟进）
  const customersNeedFollow = db.prepare(
    "SELECT COUNT(*) AS c FROM customer WHERE deleted_at IS NULL AND status != '流失' AND next_follow_date IS NOT NULL AND next_follow_date <= ?"
  ).get(today).c;

  const recentFollowUps = db.prepare(`
    SELECT f.*, c.name AS customer_name FROM customer_follow_up f
    LEFT JOIN customer c ON c.id = f.customer_id
    ORDER BY f.follow_at DESC, f.id DESC LIMIT 5
  `).all().map((f) => ({
    id: f.id, customerId: f.customer_id, customerName: f.customer_name, followType: f.follow_type,
    content: f.content, followAt: f.follow_at, nextFollowDate: f.next_follow_date,
  }));

  const bidActive = countWhere("deleted_at IS NULL AND status IN (?, ?, ?, ?)", ...ACTIVE);
  const bidUpcoming = countWhere(
    "deleted_at IS NULL AND open_time IS NOT NULL AND open_time >= ? AND open_time <= ? AND status NOT IN (?, ?, ?)",
    today, addDays(today, UPCOMING_DAYS), ...TERMINAL
  );
  const bidWon = countWhere("deleted_at IS NULL AND status = ?", "中标");
  const bidLost = countWhere("deleted_at IS NULL AND status IN (?, ?)", "未中标", "流标");

  // 项目状态分布（业务口径 6 类，含全部历史；废标/流标归为失败类）
  const statusCounts = {};
  for (const r of db.prepare("SELECT status, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY status").all()) {
    statusCounts[r.status] = r.c;
  }
  const countOf = (...ss) => ss.reduce((s, x) => s + (statusCounts[x] || 0), 0);
  const bidDist = [
    { name: "意向跟进", count: countOf("跟踪中") },
    { name: "已报名", count: countOf("已报名") },
    { name: "标书编制中", count: countOf("已购标书", "已投标") },
    { name: "已开标", count: countOf("已开标") },
    { name: "中标", count: countOf("中标") },
    { name: "流标废标", count: countOf("未中标", "流标") },
  ];
  const bidTotal = bidDist.reduce((s, x) => s + x.count, 0);

  // 行业分布（含全部历史；未填写归为"未填写"）
  const indMap = {};
  for (const r of db.prepare("SELECT industry, COUNT(*) AS c FROM bid_project WHERE deleted_at IS NULL GROUP BY industry").all()) {
    const k = (r.industry && String(r.industry).trim()) ? String(r.industry).trim() : "未填写";
    indMap[k] = (indMap[k] || 0) + r.c;
  }
  const industryDist = Object.entries(indMap).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const industryTotal = industryDist.reduce((s, x) => s + x.count, 0);

  ok(res, {
    today: todayCount, overdue: overdueCount, in7days: in7Count,
    doing: doingCount, open: openCount,
    quadrantCounts,
    recurringThisMonth: { total: Number(recur?.total || 0), done: Number(recur?.done || 0) },
    customersNeedFollow,
    recentFollowUps,
    bid: { active: bidActive, upcomingOpenings: bidUpcoming, won: bidWon, lost: bidLost },
    bidDist, bidTotal,
    industryDist, industryTotal,
    todayStr: today,
  });
});

// ---- 今日提醒（任务节点 + 客户跟进 + 日程提醒 + 投标开标合并） ----
router.get("/reminders/today", (req, res) => {
  const today = todayStr();
  const in7 = addDays(today, SOON_DAYS);
  const inUpcoming = addDays(today, UPCOMING_DAYS);
  const OPEN = ["待办", "进行中"];

  const TASK_BRIEF_SQL = `
    SELECT t.id, t.title, t.due_date, t.quadrant, t.status, t.source, t.remind_days, c.name AS customer_name
    FROM personal_task t LEFT JOIN customer c ON c.id = t.customer_id
  `;
  const overdueTasks = db.prepare(`
    ${TASK_BRIEF_SQL}
    WHERE t.deleted_at IS NULL AND t.status IN (?,?) AND t.due_date IS NOT NULL AND t.due_date < ?
    ORDER BY t.due_date ASC LIMIT 20
  `).all(...OPEN, today).map(taskBrief);
  const todayTasks = db.prepare(`
    ${TASK_BRIEF_SQL}
    WHERE t.deleted_at IS NULL AND t.status IN (?,?) AND t.due_date = ?
    ORDER BY t.id ASC LIMIT 20
  `).all(...OPEN, today).map(taskBrief);

  // 按每张任务自己设置的"提前提醒（天）"进入提醒（remind_days > 0 才生效）
  const remindSoonTasks = db.prepare(`
    ${TASK_BRIEF_SQL}
    WHERE t.deleted_at IS NULL AND t.status IN (?,?)
      AND t.due_date IS NOT NULL AND t.remind_days > 0
      AND t.due_date > ? AND t.due_date <= date(?, '+' || t.remind_days || ' days')
    ORDER BY t.due_date ASC LIMIT 20
  `).all(...OPEN, today, today).map(taskBrief);

  // 默认 7 天窗（排除已被自身提前天数覆盖的任务，避免同一任务在两处重复出现）
  const soonTasks = db.prepare(`
    ${TASK_BRIEF_SQL}
    WHERE t.deleted_at IS NULL AND t.status IN (?,?)
      AND t.due_date IS NOT NULL AND t.due_date > ? AND t.due_date <= ?
      AND NOT (t.remind_days > 0 AND t.due_date <= date(?, '+' || t.remind_days || ' days'))
    ORDER BY t.due_date ASC LIMIT 20
  `).all(...OPEN, today, in7, today).map(taskBrief);

  const dueCustomers = db.prepare(`
    SELECT id, name, short_name, next_follow_date FROM customer
    WHERE deleted_at IS NULL AND status != '流失' AND next_follow_date IS NOT NULL AND next_follow_date <= ?
    ORDER BY next_follow_date ASC LIMIT 20
  `).all(today).map((c) => ({ id: c.id, name: c.name, shortName: c.short_name, nextFollowDate: c.next_follow_date }));

  const upcomingOpenings = db.prepare(`
    SELECT id, name, open_time, status FROM bid_project
    WHERE deleted_at IS NULL AND open_time IS NOT NULL AND open_time >= ? AND open_time <= ? AND status NOT IN (?,?,?)
    ORDER BY open_time ASC LIMIT 20
  `).all(today, inUpcoming, ...TERMINAL).map((p) => ({ id: p.id, name: p.name, openTime: p.open_time, status: p.status }));

  // 日程提醒（schedule_reminder）：旧实现里这张表在任何提醒入口都不出现，
  // 现在把"待提醒且在未来 30 天内（含已过期未确认）"的条目纳入今日提醒。
  const dueSchedules = db.prepare(`
    SELECT s.id, s.project_id, s.remind_type, s.remind_at, s.advance_minutes, s.status, p.name AS project_name
    FROM schedule_reminder s LEFT JOIN bid_project p ON p.id = s.project_id
    WHERE s.status = '待提醒' AND s.remind_at IS NOT NULL AND s.remind_at <= ?
    ORDER BY s.remind_at ASC LIMIT 20
  `).all(inUpcoming).map((s) => ({
    id: s.id, projectId: s.project_id ?? null, projectName: s.project_name ?? null,
    remindType: s.remind_type, remindAt: s.remind_at, advanceMinutes: s.advance_minutes ?? 0,
    overdue: String(s.remind_at).slice(0, 10) < today,
  }));

  ok(res, {
    today, soonDays: SOON_DAYS, upcomingDays: UPCOMING_DAYS,
    overdueTasks, todayTasks, remindSoonTasks, soonTasks,
    dueCustomers, dueSchedules, upcomingOpenings,
  });
});

function taskBrief(t) {
  return {
    id: t.id, title: t.title, dueDate: t.due_date, quadrant: t.quadrant,
    status: t.status, source: t.source, remindDays: t.remind_days ?? 0,
    customerName: t.customer_name ?? null,
  };
}

// ---- 首页日历：按月聚合"每天要办的事" ----
// GET /calendar?month=YYYY-MM
// 四类来源全部按"发生/截止的那一天"分桶：任务 due_date、投标 deadline(与 open_time)、
// 日程 remind_at、客户 next_follow_date。
// 为什么不复用 /tasks?month=：那里的过滤是 (month_tag = ? OR due_date LIKE ?)，
// 会把"归属月是本月但截止日在下月"的周期任务算进来；日历必须严格按截止日。
function parseYm(ym) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(ym || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo, ym: `${y}-${String(mo).padStart(2, "0")}` };
}

router.get("/calendar", (req, res) => {
  const p = parseYm(req.query.month || todayStr().slice(0, 7));
  if (!p) return fail(res, 400, "VALIDATION_ERROR", "month 格式应为 YYYY-MM");
  const lastDay = new Date(p.year, p.month, 0).getDate();
  const start = `${p.ym}-01`;
  const end = `${p.ym}-${String(lastDay).padStart(2, "0")}`;
  const today = todayStr();

  const days = {};
  const put = (date, item) => {
    if (!date) return;
    const d = String(date).slice(0, 10);
    if (d < start || d > end) return;      // 双保险：只收本月
    (days[d] = days[d] || []).push(item);
  };

  // ① 任务/待办（含已完成与已取消：前端默认灰显，可隐藏）
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.quadrant, t.due_date, t.status, t.source, t.remind_days, t.customer_id,
           c.name AS customer_name
    FROM personal_task t LEFT JOIN customer c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?
    ORDER BY t.due_date ASC, t.id ASC
  `).all(start, end);
  for (const t of tasks) {
    put(t.due_date, {
      kind: "task", id: t.id, title: t.title, date: String(t.due_date).slice(0, 10),
      sub: t.quadrant, status: t.status,
      done: t.status === "已完成" || t.status === "已取消",
      source: t.source, customerId: t.customer_id ?? null, customerName: t.customer_name ?? null,
      remindDays: t.remind_days ?? 0,
    });
  }

  // ② 投标截止 / 开标
  const bids = db.prepare(`
    SELECT id, name, deadline, open_time, status, tenderer, region FROM bid_project
    WHERE deleted_at IS NULL AND (deadline BETWEEN ? AND ? OR open_time BETWEEN ? AND ?)
    ORDER BY deadline ASC, id ASC
  `).all(start, end, start, end);
  for (const b of bids) {
    const dl = b.deadline ? String(b.deadline).slice(0, 10) : null;
    const op = b.open_time ? String(b.open_time).slice(0, 10) : null;
    const base = {
      kind: "bid", id: b.id, title: b.name, status: b.status,
      done: TERMINAL.includes(b.status),
      tenderer: b.tenderer ?? null, region: b.region ?? null,
    };
    if (dl && (!op || op === dl)) {
      // 后端恒定让 open_time = deadline → 合并成一条，避免同一天出现两条重复
      put(dl, { ...base, date: dl, sub: "投标截止 / 开标" });
    } else {
      if (dl) put(dl, { ...base, date: dl, sub: "投标截止" });
      if (op) put(op, { ...base, date: op, sub: "开标" });
    }
  }

  // ③ 日程提醒
  const scheds = db.prepare(`
    SELECT s.id, s.remind_type, s.remind_at, s.advance_minutes, s.status, s.project_id, p.name AS project_name
    FROM schedule_reminder s LEFT JOIN bid_project p ON p.id = s.project_id
    WHERE s.remind_at BETWEEN ? AND ?
    ORDER BY s.remind_at ASC, s.id ASC
  `).all(start, end);
  for (const s of scheds) {
    put(s.remind_at, {
      kind: "schedule", id: s.id,
      title: s.project_name ? `${s.remind_type}：${s.project_name}` : s.remind_type,
      date: String(s.remind_at).slice(0, 10),
      sub: s.advance_minutes ? `提前 ${s.advance_minutes} 分钟` : "日程提醒",
      status: s.status, done: s.status !== "待提醒", projectId: s.project_id ?? null,
    });
  }

  // ④ 客户下次跟进（流失客户不提醒）
  const custs = db.prepare(`
    SELECT id, name, contact_name, contact_phone, status, next_follow_date FROM customer
    WHERE deleted_at IS NULL AND status != '流失'
      AND next_follow_date IS NOT NULL AND next_follow_date BETWEEN ? AND ?
    ORDER BY next_follow_date ASC, id ASC
  `).all(start, end);
  for (const c of custs) {
    put(c.next_follow_date, {
      kind: "customer", id: c.id, title: `跟进：${c.name}`,
      date: String(c.next_follow_date).slice(0, 10),
      sub: [c.contact_name, c.contact_phone].filter(Boolean).join(" ") || "客户跟进",
      status: c.status, done: false,
    });
  }

  // 每天内部排序：任务 → 投标 → 日程 → 客户，同类按 id
  const KIND_ORDER = { task: 0, bid: 1, schedule: 2, customer: 3 };
  for (const d of Object.keys(days)) {
    days[d].sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id - b.id));
  }

  // 逾期未完成（不在本月也要给出来，前端汇总到"今天"格）
  const overdue = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.quadrant, t.status, t.source, t.customer_id, c.name AS customer_name
    FROM personal_task t LEFT JOIN customer c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL AND t.status IN ('待办','进行中')
      AND t.due_date IS NOT NULL AND t.due_date < ?
    ORDER BY t.due_date ASC, t.id ASC LIMIT 50
  `).all(today).map((t) => ({
    kind: "task", id: t.id, title: t.title, date: String(t.due_date).slice(0, 10),
    sub: t.quadrant, status: t.status, done: false,
    source: t.source, customerId: t.customer_id ?? null, customerName: t.customer_name ?? null,
  }));

  // 未排期（无截止日）的未完成任务
  const undated = db.prepare(`
    SELECT t.id, t.title, t.quadrant, t.status, t.source, t.customer_id, c.name AS customer_name
    FROM personal_task t LEFT JOIN customer c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL AND t.status IN ('待办','进行中') AND t.due_date IS NULL
    ORDER BY t.id DESC LIMIT 50
  `).all().map((t) => ({
    kind: "task", id: t.id, title: t.title, date: null,
    sub: t.quadrant, status: t.status, done: false,
    source: t.source, customerId: t.customer_id ?? null, customerName: t.customer_name ?? null,
  }));

  const count = (kind) => Object.values(days).reduce((s, list) => s + list.filter((x) => x.kind === kind).length, 0);
  ok(res, {
    month: p.ym, start, end, days, overdue, undated, today,
    daysInMonth: lastDay,
    counts: { task: count("task"), bid: count("bid"), schedule: count("schedule"), customer: count("customer") },
  });
});

export { router as dashboardRouter };
