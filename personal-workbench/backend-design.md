# 投标信息登记工作台 · 后台设计文档

> 版本：v0.4（投标文件改为文档链接）　状态：待实施
> 对应前端：`bid-workbench.html`（整体框架已就绪，数据层暂用 localStorage）
> 目标：为个人投标跟踪场景设计一套轻量、可扩展的后台（数据表 + 接口），替换前端 `Store` 中的 `[BACKEND]` 替换点。

---

## 0. 已确认决策（2026-08 评审）

| # | 问题 | 结论 |
|---|------|------|
| 1 | 多用户 | **个人单机**，表不加 `user_id`；以后多人再统一加字段 + 查询过滤 |
| 2 | 金额单位 | **元入库、前端显示万元**，DB 用 `DECIMAL(18,2)` 存元 |
| 3 | 资格预审 | **不做独立阶段**，特殊情况写入 `notes` 备注 |
| 4 | 投标文件 | **仅存文档地址链接**（不做本地上传），点击打开链接 |
| 5 | 公告来源 | **手动填写**，不做爬虫/订阅 |

---

## 1. 技术选型建议

| 项目 | 建议 | 说明 |
|------|------|------|
| 数据库 | **SQLite**（单文件） | 个人本地单机，零运维；后续需多人协作再迁 PostgreSQL |
| 后端运行时 | **Node.js**（Express/Fastify） | 与 DeepSeek Harness 同栈，便于与 dsh-worktable 插件集成 |
| 备选后端 | Python FastAPI | 若更熟悉 Python，接口设计不变，仅实现语言不同 |
| ORM | Drizzle / Prisma（Node） | 类型安全、迁移方便；也可裸写 SQL 保持零依赖 |
| 存储（附件） | 无本地文件存储 | 文档仅登记链接，点击跳转 |
| 认证 | v1 不启用（本地单用户） | 表不加 `user_id`；多人时统一加字段即可 |

---

## 2. 数据表结构

### 2.1 实体关系（文字版）

```
bid_project（投标项目，核心）
  │ 1
  ├────── N  bid_status_log   （状态流转历史）
  ├────── N  bid_document     （投标文件，仅登记文档链接）
  ├────── N  schedule_reminder（日程/提醒）
  │
  └──── 1:N（可空）tender_notice（招标公告，手动登记，可关联到项目）

audit_log（操作日志，跨实体）
```

### 2.2 表定义（DDL）

#### ① bid_project —— 投标项目（核心表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | 数据库主键 |
| project_code | TEXT | UNIQUE, NOT NULL | 业务编号（如 PRJ-2026-001），对应用户可见 ID |
| name | TEXT | NOT NULL | 项目名称 |
| tender_no | TEXT | — | 招标编号 / 项目编号 |
| lot_no | TEXT | — | 标段（包）号 |
| category | TEXT | NOT NULL DEFAULT '工程' | 类别：工程/货物/服务 |
| region | TEXT | — | 地区 |
| tenderer | TEXT | — | 招标人（业主） |
| agency | TEXT | — | 招标代理机构 |
| budget | DECIMAL(18,2) | — | 预算/控制价（单位：元） |
| bond | DECIMAL(18,2) | — | 投标保证金（元） |
| bid_price | DECIMAL(18,2) | — | 投标报价（元） |
| status | TEXT | NOT NULL DEFAULT '跟踪中' | 状态，见 §3 状态机 |
| register_time | TEXT | — | 报名时间（ISO8601） |
| doc_purchase_time | TEXT | — | 标书购买时间 |
| deadline | TEXT | — | 投标截止时间 |
| open_time | TEXT | — | 开标时间 |
| validity_days | INTEGER | — | 投标有效期（天） |
| contact_name | TEXT | — | 联系人 |
| contact_phone | TEXT | — | 联系电话 |
| notes | TEXT | — | 备注（特殊流程、资格预审等情况在此登记） |
| created_at | TEXT | NOT NULL | 创建时间 |
| updated_at | TEXT | NOT NULL | 更新时间 |
| deleted_at | TEXT | 可空 | 软删除标记 |

索引：`idx_project_status(status)`、`idx_project_deadline(deadline)`、`idx_project_open(open_time)`、`idx_project_deleted(deleted_at)`。

#### ② bid_status_log —— 状态流转历史

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| project_id | INTEGER | NOT NULL, FK→bid_project.id | |
| from_status | TEXT | NOT NULL | 原状态 |
| to_status | TEXT | NOT NULL | 新状态 |
| remark | TEXT | — | 备注 |
| created_at | TEXT | NOT NULL | 流转时间 |

#### ③ tender_notice —— 招标公告（手动登记）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| project_id | INTEGER | 可空, FK→bid_project.id | 关联项目（可空） |
| title | TEXT | NOT NULL | 公告标题 |
| source | TEXT | — | 来源（手动填写的平台/渠道名） |
| source_url | TEXT | — | 来源链接（手动粘贴） |
| region | TEXT | — | 地区 |
| category | TEXT | — | 类别 |
| publish_date | TEXT | — | 发布日期 |
| summary | TEXT | — | 摘要 / 关键信息 |
| status | TEXT | NOT NULL DEFAULT '未处理' | 未处理 / 已关联项目 / 已忽略 |
| created_at | TEXT | NOT NULL | |

#### ④ bid_document —— 投标文件（仅文档地址链接）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| project_id | INTEGER | NOT NULL, FK→bid_project.id | 所属项目 |
| name | TEXT | NOT NULL | 文档名称（如“招标文件”“中标通知书”） |
| url | TEXT | NOT NULL | 文档地址链接（云盘/共享文档/网页等） |
| doc_type | TEXT | NOT NULL DEFAULT '其他' | 招标文件/资格预审/投标文件/中标通知书/其他 |
| notes | TEXT | — | 备注 |
| created_at | TEXT | NOT NULL | 创建时间 |

> 不存储文件本体，仅登记链接；前端点击后在浏览器新标签页打开。

#### ⑤ schedule_reminder —— 日程 / 提醒

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| project_id | INTEGER | NOT NULL, FK→bid_project.id | |
| remind_type | TEXT | NOT NULL | 报名截止/购标截止/投标截止/开标/其他 |
| remind_at | TEXT | NOT NULL | 提醒时间 |
| advance_minutes | INTEGER | DEFAULT 0 | 提前量（分钟） |
| status | TEXT | NOT NULL DEFAULT '待提醒' | 待提醒/已提醒/已关闭 |
| created_at | TEXT | NOT NULL | |

#### ⑥ audit_log —— 操作日志（可选）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, AUTOINCREMENT | |
| action | TEXT | NOT NULL | create/update/delete/status_change |
| entity_type | TEXT | NOT NULL | project/notice/document/... |
| entity_id | INTEGER | — | 实体主键 |
| detail | TEXT | — | 变更明细（JSON） |
| created_at | TEXT | NOT NULL | |

### 2.3 字典（枚举）

| 类型 | 取值 |
|------|------|
| category | 工程 / 货物 / 服务 |
| project_status | 跟踪中 / 已报名 / 已购标书 / 已投标 / 已开标 / 中标 / 未中标 / 流标 |
| doc_type | 招标文件 / 资格预审 / 投标文件 / 中标通知书 / 其他 |
| notice_status | 未处理 / 已关联项目 / 已忽略 |

> v1 用后端常量 + 枚举校验；v2 再落 `dict` 表支持自定义。

### 2.4 关键约定

- **金额**：**元入库**，`DECIMAL(18,2)` 存两位小数；**前端显示万元**（÷10000 换算，如 `185000000 元 → 18500 万`）。前端数据层与 API 统一存「元」，仅在展示层格式化为万元。（若后续出现大量金额运算，可改为整数「分」存储以保证精度，入库单位不变。）
- **时间**：统一存 **ISO8601 字符串（UTC）**，接口返回同格式；前端 `datetime-local` 负责本地时区换算。
- **软删除**：`deleted_at` 非空即视为已删，查询默认过滤。
- **主键与编号分离**：数据库自增 `id`，用户可见的 `project_code` 由服务端生成（PRJ-年份-序号）。
- **投标文件**：仅登记文档地址链接，不存储文件本体；见 §4.5。

---

## 3. 状态机设计

允许的流转（后端校验，拒绝非法跳转）：

```
跟踪中 ──▶ 已报名 ──▶ 已购标书 ──▶ 已投标 ──▶ 已开标 ──▶ 中标
   │                                           │        ├─▶ 未中标
   │                                           │        └─▶ 流标
   └───────────────────────────────────────────┴──▶ 流标（未投标直接流标）
```

- 终态：`中标 / 未中标 / 流标`（不可再流转）。
- 每次流转写一条 `bid_status_log`，并在 `audit_log` 记录。
- 流转接口统一 `POST /projects/{id}/status`，服务端校验 `from_status` 与当前一致、`to_status` 合法。
- **资格预审等特殊流程不设状态**，在项目 `notes` 中登记说明即可。

---

## 4. API 接口设计

### 4.1 通用约定

- Base URL：`/api/v1`
- 认证：v1 本地单用户，无鉴权头。
- 统一响应封装：

```json
// 成功
{ "success": true, "data": { }, "error": null }

// 失败
{ "success": false, "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "项目名称不能为空", "fields": { "name": "必填" } } }
```

- 分页：`?page=1&pageSize=20`，返回 `{ "list": [], "total": 0, "page": 1, "pageSize": 20 }`。
- 排序：`?sort=updatedAt&order=desc`。
- 错误码：`VALIDATION_ERROR` / `NOT_FOUND` / `CONFLICT`（编号重复）/ `FORBIDDEN_STATUS`（非法流转）/ `INTERNAL`。

### 4.2 投标项目（核心）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 列表：支持 `status/category/q/startDate/endDate` 过滤 + 分页排序 |
| POST | `/projects` | 新增（服务端生成 `project_code`） |
| GET | `/projects/{id}` | 详情 |
| PUT | `/projects/{id}` | 全量更新 |
| PATCH | `/projects/{id}` | 局部更新 |
| DELETE | `/projects/{id}` | 软删除 |
| POST | `/projects/{id}/status` | 状态流转，body `{ "toStatus": "已报名", "remark": "" }` |
| GET | `/projects/{id}/status-logs` | 状态历史 |

**请求体示例（POST /projects）**（字段与前端 Store 对齐，金额单位元）：

```json
{
  "name": "某市第一人民医院新院区建设项目施工总承包",
  "tenderNo": "GXZB2026-0117",
  "lotNo": "标段一",
  "category": "工程",
  "region": "浙江省·杭州市",
  "tenderer": "某市第一人民医院",
  "agency": "国信招标集团",
  "budget": 185000000,
  "bond": 800000,
  "bidPrice": 178600000,
  "status": "已投标",
  "registerTime": "2026-08-08T00:00:00Z",
  "deadline": "2026-08-26T09:30:00Z",
  "openTime": "2026-08-29T09:30:00Z",
  "validityDays": 90,
  "contactName": "张工",
  "contactPhone": "13800002210",
  "notes": "技术标已完成，等待开标。"
}
```

### 4.3 概览 / 统计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dashboard/summary` | 概览卡片：跟踪中数量、待开标数、中标数、未中标/流标数、最近项目、近期日程 |
| GET | `/stats/overview` | 统计：状态分布、类别分布、月度趋势、中标率 |

### 4.4 招标公告（手动登记）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/notices` | 列表（过滤 + 分页） |
| POST | `/notices` | 新增（手动填写标题/来源/链接/摘要） |
| GET | `/notices/{id}` | 详情 |
| PUT | `/notices/{id}` | 更新 |
| DELETE | `/notices/{id}` | 删除 |
| POST | `/notices/{id}/link-project` | 关联项目，body `{ "projectId": 1 }` |

### 4.5 投标文件（文档地址链接）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects/{id}/documents` | 文档链接列表 |
| POST | `/projects/{id}/documents` | 新增链接，body `{ "name": "招标文件", "url": "https://...", "docType": "招标文件" }` |
| PUT | `/documents/{id}` | 更新链接 |
| DELETE | `/documents/{id}` | 删除链接 |

> 仅登记文档地址链接，不提供上传/下载/预览接口；前端点击链接在新标签页打开。

### 4.6 日程 / 提醒

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/schedules` | 列表（`?from=&to=` 区间） |
| POST | `/schedules` | 新增 |
| PUT | `/schedules/{id}` | 更新 |
| DELETE | `/schedules/{id}` | 删除 |
| POST | `/schedules/{id}/ack` | 标记已提醒/关闭 |

### 4.7 设置 / 字典

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/settings` | 读取工作台偏好 |
| PUT | `/settings` | 更新偏好 |
| GET | `/dicts/{type}` | 获取枚举（status/category/docType） |

---

## 5. 索引与性能

- 数据量：个人使用，预计几百～几千条，SQLite 无压力；索引按 §2.2 列出即可。
- 关键查询路径已覆盖：按状态筛选、按截止/开标时间排序（概览与日程）、模糊搜索（`name/tender_no/tenderer`）。
- 搜索建议：v1 用 `LIKE '%kw%'`；数据量大后再启用 SQLite FTS5。

---

## 6. 与前端对接映射

| 前端字段（camelCase） | 后端字段（snake_case） | 备注 |
|------|------|------|
| id | id | 改为服务端主键；`project_code` 另存编号 |
| name / tenderNo / lotNo | name / tender_no / lot_no | 直接对应 |
| budget / bond / bidPrice | budget / bond / bid_price | 元入库；前端显示万元（÷10000） |
| status | status | 枚举校验 + 状态机 |
| registerTime / docTime / deadline / openTime | register_time / doc_purchase_time / deadline / open_time | ISO8601 |
| contact / phone | contact_name / contact_phone | 字段名细化 |
| files | 独立表 bid_document | 前端 `files` 由接口拉取（仅文档链接） |
| createdAt / updatedAt | created_at / updated_at | 服务端维护 |

前端改造点（仅数据层）：
1. `Store.load/save/add/update/remove/setStatus` 五个 `[BACKEND]` 函数改为 `fetch` 调用；
2. 金额数据层与 API 统一存「元」，仅在显示时格式化为「万元」（`seed` 演示数据与显示格式同步调整），视图与交互逻辑不变。

---

## 7. 实施阶段规划

| 阶段 | 内容 | 对应前端模块 |
|------|------|------|
| **P1（核心）** | SQLite 建表 + `projects` CRUD + 状态机 + 状态历史 | 投标项目 |
| **P2（概览）** | `/dashboard/summary`、`/stats/overview` 聚合接口 | 工作台概览、统计分析 |
| **P3（扩展）** | 公告（手动）、文档链接、日程提醒 | 招标公告、投标文件、开标日程 |
| **P4（增强）** | 字典、设置、导入导出、操作日志、软删除 | 设置 |
| **P5（切换）** | 前端 `Store` 替换为 API 调用，联调 | 全部 |

---

## 8. 变更记录

| 版本 | 日期 | 内容 |
|------|------|------|
| v0.1 | 2026-08 | 初稿：表结构 + 接口 + 待确认问题 |
| v0.2 | 2026-08 | 按评审决策修订：单用户（去 user_id）、金额改元、去资格预审阶段、附件加预览、公告改手动 |
| v0.3 | 2026-08 | 金额显示单位修订：元入库、前端显示万元 |
| v0.4 | 2026-08 | 投标文件改为仅登记文档地址链接，不做本地上传 |
