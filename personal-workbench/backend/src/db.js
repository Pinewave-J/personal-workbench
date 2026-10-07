// 数据库连接 + 建表 + 演示数据
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || resolve(DATA_DIR, "workbench.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bid_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tender_no TEXT,
  lot_no TEXT,
  category TEXT NOT NULL DEFAULT '工程',
  industry TEXT,
  region TEXT,
  tenderer TEXT,
  agency TEXT,
  budget DECIMAL(18,2),
  bond DECIMAL(18,2),
  bid_price DECIMAL(18,2),
  status TEXT NOT NULL DEFAULT '跟踪中',
  register_time TEXT,
  doc_purchase_time TEXT,
  deadline TEXT,
  open_time TEXT,
  validity_days INTEGER,
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  duration TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_status ON bid_project(status);
CREATE INDEX IF NOT EXISTS idx_project_deadline ON bid_project(deadline);
CREATE INDEX IF NOT EXISTS idx_project_open ON bid_project(open_time);
CREATE INDEX IF NOT EXISTS idx_project_deleted ON bid_project(deleted_at);

CREATE TABLE IF NOT EXISTS bid_status_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES bid_project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_status_log_project ON bid_status_log(project_id);

CREATE TABLE IF NOT EXISTS tender_notice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  title TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  region TEXT,
  category TEXT,
  publish_date TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT '未处理',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES bid_project(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notice_status ON tender_notice(status);

CREATE TABLE IF NOT EXISTS bid_document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES bid_project(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedule_reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  remind_type TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  advance_minutes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT '待提醒',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES bid_project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_project ON schedule_reminder(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_remind_at ON schedule_reminder(remind_at);

CREATE TABLE IF NOT EXISTS bid_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES bid_project(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- ================= 个人工作台：客户 =================
CREATE TABLE IF NOT EXISTS customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  industry TEXT,
  region TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT '跟进中',
  source TEXT,
  next_follow_date TEXT,
  last_follow_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_status ON customer(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customer_next_follow ON customer(next_follow_date);

CREATE TABLE IF NOT EXISTS customer_follow_up (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  follow_type TEXT NOT NULL DEFAULT '电话',
  content TEXT NOT NULL,
  follow_at TEXT NOT NULL,
  next_follow_date TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_follow_customer ON customer_follow_up(customer_id, follow_at);

-- ================= 个人工作台：任务 & 待办 =================
CREATE TABLE IF NOT EXISTS recurring_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT,
  quadrant TEXT NOT NULL DEFAULT '重要不紧急',
  day_of_month INTEGER NOT NULL DEFAULT 1,
  remind_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tpl_active ON recurring_template(active, deleted_at);

CREATE TABLE IF NOT EXISTS personal_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  quadrant TEXT NOT NULL DEFAULT '不重要不紧急',
  due_date TEXT,
  remind_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '待办',
  source TEXT NOT NULL DEFAULT 'manual',
  customer_id INTEGER,
  template_id INTEGER,
  month_tag TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE SET NULL,
  FOREIGN KEY (template_id) REFERENCES recurring_template(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status ON personal_task(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_task_due ON personal_task(due_date);
CREATE INDEX IF NOT EXISTS idx_task_customer ON personal_task(source, customer_id);
CREATE INDEX IF NOT EXISTS idx_task_tpl_month ON personal_task(template_id, month_tag);
`;

// ================= AI 助手：暂存队列（v5 增量，不参与业务查询） =================
// 设计依据：ai-assist-design.md §5。
// 铁律：AI 只写这两张表；业务表（bid_project 等）一律经人工确认后走既有接口落库。
const AI_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_job (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL DEFAULT 'notice_extract',
  input_text    TEXT NOT NULL,
  input_hash    TEXT NOT NULL,
  source_name   TEXT,
  entity_type   TEXT,
  entity_id     INTEGER,
  status        TEXT NOT NULL DEFAULT '待解析',
  engine        TEXT,
  error         TEXT,
  dropped_json  TEXT,
  text_purged   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  suggested_at  TEXT,
  adopted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_aijob_status ON ai_job(status, created_at);
CREATE INDEX IF NOT EXISTS idx_aijob_kind   ON ai_job(kind, status);
CREATE INDEX IF NOT EXISTS idx_aijob_hash   ON ai_job(input_hash);

CREATE TABLE IF NOT EXISTS ai_suggestion (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL,
  field       TEXT NOT NULL,
  value       TEXT,
  unit        TEXT,
  confidence  TEXT,
  evidence    TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES ai_job(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aisug_job ON ai_suggestion(job_id);
`;

// ---- 标书编制（投标文件生成全过程）----
// 设计原则：outline.json / 章节 .md 是唯一真相源；本模块只存阶段、闸口、版本与镜像，
// 避免与 bid-tool 项目目录里的文件状态分叉。
const MAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS bid_work_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES bid_project(id) ON DELETE CASCADE,
  tender_project_id INTEGER,
  project_name TEXT,
  work_dir TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'intake',
  page_limit INTEGER DEFAULT 0,
  pages_allocated INTEGER DEFAULT 0,
  pages_estimated INTEGER DEFAULT 0,
  pages_actual INTEGER,
  score_covered_json TEXT,
  score_total INTEGER DEFAULT 0,
  placeholders INTEGER DEFAULT 0,
  total_words INTEGER DEFAULT 0,
  outline_version INTEGER,
  stage_updated_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mainwork_project ON bid_work_project(project_id);
CREATE INDEX IF NOT EXISTS idx_mainwork_stage ON bid_work_project(stage);

CREATE TABLE IF NOT EXISTS bid_work_gate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
  gate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  evidence_json TEXT,
  remark TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maingate ON bid_work_gate(work_project_id, gate);

CREATE TABLE IF NOT EXISTS bid_work_chapter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
  no TEXT NOT NULL,
  title TEXT,
  level INTEGER,
  pages_planned REAL DEFAULT 0,
  wc INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  file TEXT,
  exists_flag INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mainchapter ON bid_work_chapter(work_project_id, no);

CREATE TABLE IF NOT EXISTS bid_work_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  rel_path TEXT,
  sha256 TEXT,
  size_bytes INTEGER DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mainver ON bid_work_version(work_project_id);

CREATE TABLE IF NOT EXISTS bid_work_stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mainlog ON bid_work_stage_log(work_project_id);

-- 待办任务队列：网页点「生成目录/生成章节」→ 写入这里 → 会话侧领任务执行
CREATE TABLE IF NOT EXISTS bid_work_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- outline_draft | chapter_batch | selfcheck | merge_build | charts | final_check
  payload_json TEXT,                  -- { batchNo, chapterNos[], note }
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | claimed | done | failed | canceled
  result_json TEXT,
  note TEXT,
  claimed_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bidtask_work ON bid_work_task(work_project_id);
CREATE INDEX IF NOT EXISTS idx_bidtask_status ON bid_work_task(status);
`;

// ---- 结构迁移（版本化：PRAGMA user_version + 有序迁移 + 迁移前自动快照） ----
export const SCHEMA_VERSION = 8;

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

// 迁移步骤按 to 升序执行；每个 up 必须幂等（可重复执行不破坏数据）。
// 基线 v1 建全量表；v2 精简 bid_document；v3 为旧库 bid_project 补列；
// v4 周期实例唯一索引（防重复生成；只约束"未删除"的行，历史软删重复行不受影响）。
const MIGRATIONS = [
  { to: 1, label: "基线建表（全部 CREATE TABLE IF NOT EXISTS）", up: () => { db.exec(SCHEMA); } },
  {
    to: 2,
    label: "bid_document 精简（旧版 name/doc_type → 项目+文件夹链接）",
    up: () => {
      if (hasColumn("bid_document", "name")) {
        db.exec("DROP TABLE bid_document;");
        db.exec(SCHEMA); // 重建 bid_document（其余表已存在，IF NOT EXISTS 幂等）
      }
    },
  },
  {
    to: 3,
    label: "bid_project 补 duration / industry 列",
    up: () => {
      if (!hasColumn("bid_project", "duration")) db.exec("ALTER TABLE bid_project ADD COLUMN duration TEXT;");
      if (!hasColumn("bid_project", "industry")) db.exec("ALTER TABLE bid_project ADD COLUMN industry TEXT;");
    },
  },
  {
    to: 4,
    label: "周期实例唯一索引（同一模板同一个月只允许一条未删除实例）",
    up: () => {
      // 只约束未删除行：历史遗留的"已软删重复行"不会阻塞迁移，
      // 而新写入无法再为同一 (template_id, month_tag) 造出第二条有效实例。
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_task_tpl_month
               ON personal_task(template_id, month_tag)
               WHERE template_id IS NOT NULL AND deleted_at IS NULL;`);
    },
  },
  {
    to: 5,
    label: "AI 助手暂存队列：ai_job / ai_suggestion（AI 不直写业务表）",
    up: () => { db.exec(AI_SCHEMA); },
  },
  {
    to: 6,
    label: "ai_job 记录被丢弃的建议（界面能解释「某字段为什么没有」）",
    up: () => {
      if (!hasColumn("ai_job", "dropped_json")) db.exec("ALTER TABLE ai_job ADD COLUMN dropped_json TEXT;");
    },
  },
  {
    to: 7,
    label: "标书编制模块：编项目/闸口/章节镜像/版本/阶段日志（8 阶段 4 闸口）",
    up: () => { db.exec(MAIN_SCHEMA); },
  },
  {
    to: 8,
    label: "标书编制待办任务队列：bid_work_task（网页派活 → 会话领活）",
    up: () => {
      db.exec(`CREATE TABLE IF NOT EXISTS bid_work_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_project_id INTEGER NOT NULL REFERENCES bid_work_project(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result_json TEXT,
        note TEXT,
        claimed_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_bidtask_work ON bid_work_task(work_project_id);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_bidtask_status ON bid_work_task(status);");
    },
  },
];

function userVersion() {
  const r = db.prepare("PRAGMA user_version").get();
  return Number(r?.user_version ?? 0);
}

// 迁移前一致性快照（VACUUM INTO），仅在库内已有业务数据时执行；失败不阻塞启动
function backupBeforeMigration() {
  try {
    const hasData = db.prepare("SELECT COUNT(*) AS c FROM bid_project").get().c > 0
      || db.prepare("SELECT COUNT(*) AS c FROM personal_task").get().c > 0
      || db.prepare("SELECT COUNT(*) AS c FROM customer").get().c > 0;
    if (!hasData) return null;
    const dir = resolve(DATA_DIR, "backups");
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const path = resolve(dir, `pre-migration-${ts}.db`).replace(/\\/g, "/");
    db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}';`);
    console.log(`[personal-workbench] migration backup → ${path}`);
    return path;
  } catch (e) {
    console.error("[personal-workbench] migration backup failed (non-blocking):", e?.message || e);
    return null;
  }
}

function migrate() {
  const current = userVersion();
  if (current >= SCHEMA_VERSION) return;
  const pending = MIGRATIONS.filter((m) => m.to > current);
  if (pending.length === 0) return;
  backupBeforeMigration();
  for (const m of pending) {
    db.exec("BEGIN");
    try {
      m.up();
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      console.error(`[personal-workbench] migration to v${m.to} failed:`, e?.message || e);
      throw e;
    }
    db.exec(`PRAGMA user_version = ${m.to};`);
    console.log(`[personal-workbench] migrated to v${m.to} — ${m.label}`);
  }
}

migrate();

// ---- 演示数据（金额单位：元） ----
function seed() {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM bid_project").get();
  if (c > 0) return;

  const day = 86400000;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const ts = () => new Date().toISOString();

  const rows = [
    {
      project_code: "PRJ-2026-001", name: "某市第一人民医院新院区建设项目施工总承包", tender_no: "GXZB2026-0117", lot_no: "标段一",
      category: "工程监理", region: "浙江省·杭州市", tenderer: "某市第一人民医院", agency: "国信招标集团",
      budget: 185000000, bond: 800000, bid_price: 178600000, status: "已投标",
      register_time: iso(now - 20 * day), doc_purchase_time: iso(now - 19 * day), deadline: iso(now - 2 * day),
      open_time: iso(now + 1 * day), validity_days: 90, contact_name: "张工", contact_phone: "13800002210",
      notes: "技术标已完成，等待开标。",
    },
    {
      project_code: "PRJ-2026-002", name: "智慧园区物联网平台建设与运维服务采购", tender_no: "ZFCG2026-0452", lot_no: "",
      category: "咨询", region: "广东省·深圳市", tenderer: "深圳市某科技园区管委会", agency: "深圳公共资源交易中心",
      budget: 32000000, bond: 300000, bid_price: null, status: "已购标书",
      register_time: iso(now - 9 * day), doc_purchase_time: iso(now - 8 * day), deadline: iso(now + 5 * day),
      open_time: iso(now + 6 * day), validity_days: 60, contact_name: "李经理", contact_phone: "13900007736",
      notes: "需准备实施方案与同类业绩证明。",
    },
    {
      project_code: "PRJ-2026-003", name: "城区道路照明节能改造工程（二期）设备采购", tender_no: "HCZC2026-1008", lot_no: "包2",
      category: "其他", region: "江苏省·南京市", tenderer: "南京市某区城管局", agency: "华诚招标有限公司",
      budget: 8600000, bond: 100000, bid_price: null, status: "已报名",
      register_time: iso(now - 4 * day), doc_purchase_time: null, deadline: iso(now + 11 * day),
      open_time: iso(now + 12 * day), validity_days: 60, contact_name: "王工", contact_phone: "13700005561",
      notes: "资格预审已通过，待购标书。",
    },
    {
      project_code: "PRJ-2026-004", name: "某市轨道交通5号线车辆段设备集成项目", tender_no: "SZGC2026-0309", lot_no: "",
      category: "全过程咨询", region: "四川省·成都市", tenderer: "某市轨道交通集团", agency: "四川招标代理",
      budget: 460000000, bond: 2000000, bid_price: null, status: "跟踪中",
      register_time: null, doc_purchase_time: null, deadline: iso(now + 18 * day),
      open_time: iso(now + 19 * day), validity_days: 90, contact_name: "陈总", contact_phone: "18600008802",
      notes: "项目体量大，正在评估资质与联合体方案。",
    },
  ];

  const insert = db.prepare(`
    INSERT INTO bid_project (project_code, name, tender_no, lot_no, category, industry, region, tenderer, agency, budget, bond, bid_price, status, register_time, doc_purchase_time, deadline, open_time, validity_days, contact_name, contact_phone, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const r of rows) {
    const t = ts();
    insert.run(
      r.project_code, r.name, r.tender_no, r.lot_no, r.category, r.industry ?? null, r.region, r.tenderer, r.agency,
      r.budget, r.bond, r.bid_price, r.status, r.register_time, r.doc_purchase_time, r.deadline,
      r.open_time, r.validity_days, r.contact_name, r.contact_phone, r.notes, t, t
    );
  }

  // 为 PRJ-2026-001 补一条状态流转历史（演示）
  const p1 = db.prepare("SELECT id FROM bid_project WHERE project_code = ?").get("PRJ-2026-001");
  if (p1) {
    const logInsert = db.prepare("INSERT INTO bid_status_log (project_id, from_status, to_status, remark, created_at) VALUES (?, ?, ?, ?, ?)");
    const base = now - 18 * day;
    const steps = [["跟踪中", "已报名"], ["已报名", "已购标书"], ["已购标书", "已投标"]];
    steps.forEach(([from, to], i) => {
      logInsert.run(p1.id, from, to, null, new Date(base + i * day).toISOString());
    });
  }
}

seed();

// ---- 个人工作台演示数据（仅在对应表为空时插入） ----
function seedPersonal() {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;

  // 1) 周期任务模板
  if (count("recurring_template") === 0) {
    const nowIso = new Date().toISOString();
    const ins = db.prepare(
      "INSERT INTO recurring_template (name, notes, quadrant, day_of_month, remind_days, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    );
    const tpls = [
      ["月度经营数据汇总", "整理本月投标/中标台账与经营数据", "重要不紧急", 28, 2],
      ["客户回访计划排期", "盘点客户跟进情况，规划下月回访", "重要不紧急", 1, 3],
      ["投标保证金台账核对", "核对已缴纳保证金与退还状态", "重要紧急", 5, 1],
    ];
    for (const [name, notes, quadrant, day, remind] of tpls) {
      ins.run(name, notes, quadrant, day, remind, nowIso, nowIso);
    }
  }

  // 2) 客户档案 + 跟进记录
  if (count("customer") === 0) {
    const now = new Date();
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const day = 86400000;
    const t = new Date().toISOString();
    const custIns = db.prepare(`
      INSERT INTO customer (name, short_name, industry, region, contact_name, contact_phone, email, status, source, next_follow_date, last_follow_at, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const custA = custIns.run(
      "华东市政工程咨询有限公司", "华东市政", "市政工程咨询", "浙江省·杭州市",
      "钱工", "13800001111", "qian@huadong.example", "跟进中", "投标接触",
      iso(now + 3 * day), iso(now - 2 * day), "关注智慧城市类招标，可合作投标。", t, t
    );
    const custB = custIns.run(
      "某某产业园区开发有限公司", "产业园开发", "产业园区开发", "江苏省·苏州市",
      "孙经理", "13900002222", "sun@park.example", "跟进中", "客户介绍",
      iso(now + 1 * day), iso(now - 5 * day), "园区二期工程计划年底启动，留意可研与造价需求。", t, t
    );
    const custC = custIns.run(
      "老客户科技有限公司", "老客户科技", "信息化服务", "上海市",
      "周总", "13700003333", "zhou@oldcust.example", "已成交", "客户介绍",
      null, iso(now - 30 * day), "长期信息化运维客户。", t, t
    );

    const fuIns = db.prepare(`
      INSERT INTO customer_follow_up (customer_id, follow_type, content, follow_at, next_follow_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    fuIns.run(Number(custA.lastInsertRowid), "拜访", "上门拜访，介绍公司造价咨询能力，对方反馈有意愿合作。", iso(now - 2 * day), iso(now + 3 * day), t);
    fuIns.run(Number(custB.lastInsertRowid), "电话", "电话了解园区二期前期进度，约定下月再联系。", iso(now - 5 * day), iso(now + 1 * day), t);
    fuIns.run(Number(custB.lastInsertRowid), "邮件", "发送公司资质与案例资料。", iso(now - 1 * day), iso(now + 10 * day), t);
  }

  // 3) 手动任务演示（含到期/逾期样例），并同步当前月周期实例
  const mk = (title, notes, quadrant, due, remind, status, src, customerId = null, templateId = null, monthTag = null) => {
    const t = new Date().toISOString();
    return db.prepare(`
      INSERT INTO personal_task (title, notes, quadrant, due_date, remind_days, status, source, customer_id, template_id, month_tag, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, notes, quadrant, due, remind, status, src, customerId, templateId, monthTag, status === "已完成" ? t : null, t, t);
  };

  if (count("personal_task") === 0) {
    const now = new Date();
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const day = 86400000;
    // 客户跟进生成的待办（双向联动演示，自动创建于客户跟进）
    const cA = db.prepare("SELECT id, name FROM customer WHERE name LIKE '华东%'").get();
    if (cA) mk(`跟进：${cA.name}`, "电话确认合作意向", "重要紧急", iso(now + 3 * day), 1, "待办", "customer", cA.id);
    // 手动任务
    mk("整理本周投标进度周报", "向负责人汇报本周投标情况", "重要不紧急", iso(now + 2 * day), 1, "待办", "manual", null);
    mk("更新行业竞争对手信息表", "收集近期开标信息", "不重要不紧急", iso(now + 14 * day), 0, "待办", "manual", null);
    mk("资质证书年检准备", "收集人员证书清单", "重要紧急", iso(now - 1 * day), 2, "待办", "manual", null);
  }

  // 周期实例：为所有 active 模板生成“当前月”实例（幂等）
  // 幂等判据 = 该 (模板, 月份) 是否"生成过"（含已被软删的实例），避免删除后被反复复活。
  const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const tpls = db.prepare("SELECT * FROM recurring_template WHERE deleted_at IS NULL AND active = 1").all();
  for (const tpl of tpls) {
    const dup = db.prepare("SELECT COUNT(*) AS c FROM personal_task WHERE template_id = ? AND month_tag = ?").get(tpl.id, ym).c;
    if (dup > 0) continue;
    const dueDay = Math.min(tpl.day_of_month, lastDay);
    const due = `${ym}-${String(dueDay).padStart(2, "0")}`;
    mk(tpl.name, tpl.notes, tpl.quadrant, due, tpl.remind_days, "待办", "recurring", null, tpl.id, ym);
  }
}

seedPersonal();

// 开标时间 = 投标截止时间（幂等，与创建/更新逻辑保持一致）
db.exec("UPDATE bid_project SET open_time = deadline WHERE deadline IS NOT NULL;");
