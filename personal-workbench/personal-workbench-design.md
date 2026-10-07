# 个人工作台 · 设计文档（在投标工作台基础上扩张）

> 版本：v1.0（2026-09 评审锁定）　状态：待实施
> 前置资产：`bid-workbench.html`（投标单文件前端）+ `backend/`（Express + node:sqlite）+ `backend/data/workbench.db`（沿用，**勿删**）
> 本设计只做"增量扩张"：投标模块全部保留（页面整体迁入新前端、后端接口不动），在其上新增任务/待办、客户档案/跟进、知识库占位与系统能力。

---

## 0. 已确认决策（2026-09，勿再问用户）

| # | 问题 | 结论 |
|---|------|------|
| 1 | 前端形态 | **新建单文件 `personal-workbench.html`**，导航含「投标工作台」整组原页面 + 新增页面；`widget-result.json` 改指新文件；旧 `bid-workbench.html` 保留不动 |
| 2 | 每月固定任务 | **周期任务模板**：定义一次（每月第 N 天执行），进入待办页时系统按当前月份自动生成当期待办实例，实例可独立完成，模板长期有效 |
| 3 | 客户跟进联动 | **双向闭环**：跟进记录填「下次跟进日期」→ 自动生成客户待办；该待办完成时可填新的下次跟进日期 → 回写客户档案并生成下一条待办 |
| 4 | 知识库 | **仅导航占位**：知识库页面 + 说明文字，不建后端接口，留待后续接入 |
| 5 | 导出 Excel | **沿用 CSV（带 BOM，Excel 可直接打开）**：每模块独立导出 CSV + 完整 JSON 备份恢复 |
| 6 | 存储 | 继续本地 SQLite 单文件（`backend/data/workbench.db`），本地单机无鉴权 |
| 7 | 提醒方式 | 应用内提醒（总览卡片/待办页按到期日聚合 + 提前 N 天标注），不推系统通知（后续可加） |

沿用既有约定：金额元入库 / 前端万元显示（仅投标）；软删除 `deleted_at`；统一响应 `{success,data,error}`；错误码同前；时间 ISO8601 TEXT；关联删除 CASCADE / SET NULL。

---

## 1. 新增数据表（DDL，全部为增量 CREATE TABLE IF NOT EXISTS）

### ① personal_task —— 任务 / 待办（个人核心新增）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| title | TEXT | NOT NULL | 任务标题 |
| notes | TEXT | — | 备注 |
| quadrant | TEXT | NOT NULL DEFAULT '不重要不紧急' | 四象限：重要紧急/重要不紧急/紧急不重要/不重要不紧急 |
| due_date | TEXT | — | 截止日 / 时间节点（YYYY-MM-DD） |
| remind_days | INTEGER | DEFAULT 0 | 提前提醒天数（0=当天提醒，>=1 提前 N 天） |
| status | TEXT | NOT NULL DEFAULT '待办' | 待办/进行中/已完成/已取消 |
| source | TEXT | NOT NULL DEFAULT 'manual' | manual 手动 / recurring 周期实例 / customer 客户跟进 |
| customer_id | INTEGER | 可空 FK→customer.id | source=customer 时指向客户 |
| template_id | INTEGER | 可空 FK→recurring_template.id | source=recurring 时指向模板 |
| month_tag | TEXT | — | 周期实例所属月份 YYYY-MM（幂等去重用） |
| completed_at | TEXT | — | 完成时间 |
| created_at / updated_at / deleted_at | TEXT | NOT NULL / NOT NULL / 可空 | 同前 |

索引：`(status, deleted_at)`、`(due_date)`、`(source, customer_id)`、`(template_id, month_tag)`。
校验：quadrant ∈ 四象限；status ∈ 枚举；due_date 格式 YYYY-MM-DD。

### ② recurring_template —— 周期任务模板（每月固定任务）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| name | TEXT | NOT NULL | 任务名（生成实例时作标题） |
| notes | TEXT | — | 说明 |
| quadrant | TEXT | NOT NULL DEFAULT '重要不紧急' | 默认生成实例的象限 |
| day_of_month | INTEGER | NOT NULL | 每月第几天执行（1–31；短月取 min(day, 当月天数)） |
| remind_days | INTEGER | DEFAULT 0 | 提前提醒天数，生成实例时写入 task |
| active | INTEGER | NOT NULL DEFAULT 1 | 停用后不再生成新实例，旧实例保留 |
| created_at / updated_at / deleted_at | TEXT | — | 同前 |

### ③ customer —— 客户档案

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| name | TEXT | NOT NULL | 客户/单位名称 |
| short_name | TEXT | — | 简称 |
| industry | TEXT | — | 行业 |
| region | TEXT | — | 地区 |
| contact_name | TEXT | — | 联系人 |
| contact_phone | TEXT | — | 电话 |
| email | TEXT | — | 邮箱 |
| status | TEXT | NOT NULL DEFAULT '跟进中' | 潜在/跟进中/已成交/暂停/流失 |
| source | TEXT | — | 客户来源（投标接触/客户介绍/展会/其他） |
| next_follow_date | TEXT | — | 下次跟进日期（档案级，与任务双向联动） |
| last_follow_at | TEXT | — | 最近一次跟进时间 |
| notes | TEXT | — | 备注 |
| created_at / updated_at / deleted_at | TEXT | — | 同前 |

### ④ customer_follow_up —— 客户跟进记录

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PK AUTOINCREMENT | |
| customer_id | INTEGER | NOT NULL FK→customer.id ON DELETE CASCADE | 所属客户 |
| follow_type | TEXT | NOT NULL DEFAULT '电话' | 电话/拜访/邮件/微信/其他 |
| content | TEXT | NOT NULL | 跟进内容 |
| follow_at | TEXT | NOT NULL | 跟进日期 |
| next_follow_date | TEXT | — | 计划的下次跟进日期（非空→触发自动待办） |
| created_at | TEXT | NOT NULL | |

### ⑤ 既有表（不动结构，继续使用）
`bid_project / bid_status_log / tender_notice / bid_document / schedule_reminder / bid_result / audit_log`

---

## 2. 联动规则（后端强制）

1. **跟进 → 待办**：新增/更新跟进记录时，若 `next_follow_date` 非空，且不存在「同 customer + source=customer + status∈(待办,进行中) + due_date=同日期」的任务，则自动插入一条 task：`title=「跟进：{客户名}」+ notes=跟进内容摘要`、`quadrant=重要紧急`、`due_date=next_follow_date`、`remind_days=1`。同时把 `customer.next_follow_date = next_follow_date`。
2. **待办完成 → 回写**：`POST /tasks/{id}/complete`，body 可选 `nextFollowDate`。完成时置 `status=已完成, completed_at=now`；若 `source=customer`：把 `customer.last_follow_at=now`；若提供了 `nextFollowDate`：更新 `customer.next_follow_date`，并按下一条规则再生成下一条待办（闭环）。
3. **周期模板 → 当期待办**：`GET /tasks?month=YYYY-MM`（默认当前月）时，先执行幂等生成：对每个 active 模板，若该月无同 `template_id+month_tag` 的非软删任务，则创建实例（`due_date = min(day_of_month, 当月天数)` 当日）。`month_tag=YYYY-MM`、`source=recurring`、复制 quadrant/remind_days/notes。
4. 手动任务无联动。

---

## 3. API 清单（Base `/api/v1`；新增部分，投标接口原样保留）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tasks?month=&status=&quadrant=&source=&q=` | 任务列表（分页 page/pageSize；month 触发周期生成） |
| POST | `/tasks` | 新增任务 |
| GET | `/tasks/{id}` | 详情 |
| PUT | `/tasks/{id}` | 全量更新 |
| PATCH | `/tasks/{id}` | 局部更新 |
| DELETE | `/tasks/{id}` | 软删除 |
| POST | `/tasks/{id}/complete` | 完成；body `{nextFollowDate?}`（customer 来源回写） |
| POST | `/tasks/{id}/reopen` | 重开（已完成→待办） |
| GET | `/recurring-templates` | 周期模板列表（含每月各月生成计数） |
| POST | `/recurring-templates` | 新增模板 |
| PUT | `/recurring-templates/{id}` | 更新（含 active 切换） |
| DELETE | `/recurring-templates/{id}` | 软删除 |
| POST | `/recurring-templates/{id}/generate` | 手动为指定月份生成实例（body `{month}`，幂等） |
| GET | `/customers` | 客户列表（q/status/nextFollow 过滤 + 分页） |
| POST | `/customers` | 新增客户 |
| GET | `/customers/{id}` | 详情 |
| PUT | `/customers/{id}` | 更新（改名/改下次跟进日期等） |
| DELETE | `/customers/{id}` | 软删除 |
| GET | `/customers/{id}/follow-ups` | 某客户跟进记录（时间倒序） |
| GET | `/follow-ups` | 全部跟进记录（可按 customerId 过滤） |
| POST | `/follow-ups` | 新增跟进记录（触发联动规则 1） |
| PUT | `/follow-ups/{id}` | 更新（触发联动规则 1） |
| DELETE | `/follow-ups/{id}` | 删除 |
| GET | `/dashboard/personal` | 个人总览聚合（见 §4） |
| GET | `/search?q=` | 全局搜索（projects/tasks/customers 三类，各 ≤10） |
| GET | `/export/tasks` `/export/customers` `/export/follow-ups` | 各模块 CSV（带 BOM，追加参数 format=csv） |
| GET | `/export/backup` | 全量 JSON 备份（**含新增表**；version 升至 2；文件二进制仍仅元数据） |
| POST | `/import/backup` | 从备份 JSON 全量恢复（危险操作：先清业务表再按原 id 插入；保留审计日志；需二次确认参数 `{confirm:"RESTORE"}`） |
| GET | `/reminders/today` | 今日提醒聚合（逾期/今日到期任务 + 3 天内到期 + 客户今日需跟进） |

错误码沿用：`VALIDATION_ERROR / NOT_FOUND / CONFLICT / INTERNAL`（无新状态机，不引入 FORBIDDEN_STATUS 到任务）。

---

## 4. 个人总览聚合（GET /dashboard/personal）

```
{
  today: 今日到期任务数, overdue: 逾期任务数, in7days: 7天内到期任务数, doing: 进行中任务数,
  quadrantCounts: {重要紧急:N, 重要不紧急:N, 紧急不重要:N, 不重要不紧急:N},
  customersNeedFollow: 今日前/今日需跟进客户数, recentFollowUps: [...最近5条跟进],
  dueRecurringThisMonth: 本月周期实例已完成/总数,
  bid: {active, upcomingOpenings, won, lost}   // 复用 dashboard/summary 的 counts
}
```

---

## 5. 前端结构（personal-workbench.html 单文件）

- 沿用原版 CSS 主题/组件（grid/topbar/sidebar/main、modal、toast、badge、表格、stat-grid、chip 等），在原文件基础上复制改造，避免破坏已有功能。
- 顶部品牌改「个人工作台」，副标「投标 · 任务 · 客户」；**全局搜索改造为跨模块搜索下拉**（输入防抖调 `/search`，分组展示：投标项目/任务/客户，点击跳转到对应视图并打开）。
- 侧栏按分组渲染（新增 GROUP 定义，兼容原 NAV 单层结构改为带 section 的分组数组）：
  - **工作台**：个人总览 / 投标工作台总览（原 overview 更名保留）
  - **任务 & 待办**：待办看板（四象限 + 今日到期/逾期高亮 + 月度视图）/ 周期任务模板
  - **客户管理**：客户档案 / 客户跟进记录
  - **投标工作台**（整组原页面）：投标项目 / 投标文件 / 日程提醒 / 开标结果 / 统计分析
  - **系统**：操作日志 / 设置 / 知识库（占位页）
- 待办看板：筛选 chips（四象限/状态/月份）；卡片展示 标题/截止/来源标签/提前提醒；支持快捷完成（点对勾）；列表视图默认按 due_date 升序，逾期红色、今日黄色、7天内橙色。
- 客户档案：卡片或表格 + 新增/编辑弹窗 + 删除；详情抽屉（或弹窗）内嵌该客户跟进记录列表 + 「记录跟进」按钮。
- 客户跟进页：跟进记录列表（客户名/类型/内容/日期/下次跟进），「新增跟进」弹窗含 next_follow_date（触发自动待办提示）。
- 周期任务模板页：模板表格 + 新增/编辑弹窗（name/quadrant/day_of_month/remind_days/active/notes），支持「为本月生成实例」按钮。
- 设置页（数据管理区扩展）：
  - 导出：投标项目 CSV / 任务 CSV / 客户 CSV / 跟进记录 CSV / 完整备份 JSON
  - 恢复：选 .json 备份 → 二次确认 → POST /import/backup
  - 原投标 CSV/JSON 导入保留；操作日志入口保留
- 知识库页：卡片式占位说明（"规划中：将支持本地文档（PDF/Office）登记、解析与检索"），不建接口。
- Store 增加 tasks/templates/customers/followups/personal/search/backup 方法；App 增加对应视图与事件；`data-*` 绑定模式不变。

---

## 6. 与投标模块的数据关系

- 新增表之间：follow_up→customer CASCADE；task.customer_id / task.template_id 可空关联（SET NULL 语义，仅软删不级联删任务）。
- 投标任务与个人任务**分表但同视图**：任务看板仅 personal_task；投标日程提醒仍在原 schedule_reminder（投标工作台日程页）+ 总览卡片合并提示（reminders/today 同时聚合二者 due 列表，用于首页"今日节点"）。

---

## 7. 实施阶段规划（每阶段验证后进入下阶段）

| 阶段 | 内容 | 验证 |
|---|---|---|
| P1 | db.js 增量建表 + 迁移 + seed（模板/客户/跟进/任务演示）；tasks + recurring-templates router | node --check、重启、接口实测 |
| P2 | customers + follow-ups router（联动规则 1/2）+ dashboard/personal + search + reminders/today | 接口实测（中文/联动/幂等） |
| P3 | io.js：备份升级 version2 + /import/backup 恢复 + 各模块 CSV | 备份→恢复往返实测 |
| P4 | 前端复制改造：品牌/分组导航/全局搜索下拉/投标整组迁移 | 语法校验 + 刷新 |
| P5 | 前端新视图：个人总览/待办看板/周期模板/客户/跟进/知识库/设置扩展 | 语法校验 + 全链路手工 |
| P6 | widget-result.json 改指、端到端联调、更新 HANDOFF | 刷新窗口确认 |

---

## 8. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-09 | 初稿：5 项决策锁定 + 4 张新表 DDL + 联动规则 + API + 阶段规划 |
