# 个人工作台 · 后端（投标 / 任务 / 客户）

Node.js + Express + SQLite（Node 内置 `node:sqlite`，零原生依赖）。

## 运行

```bash
cd backend
npm install
npm start        # http://127.0.0.1:8787
```

开发模式（文件改动自动重启）：

```bash
npm run dev
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 8787 | 监听端口 |
| DB_PATH | data/workbench.db | SQLite 文件路径 |

首次启动自动建表；对应表为空时才写入演示数据（投标演示 + 周期任务模板/客户/跟进演示）。**投标演示数据仅在 bid_project 为空时插入，已有数据不会覆盖。**

### 数据版本迁移

结构变更采用 **`PRAGMA user_version` + 有序迁移列表**（见 `src/db.js` 的 `MIGRATIONS`）：

- 基线 `v1` 建全量表；`v2` 精简 `bid_document`；`v3` 为旧库 `bid_project` 补 `duration / industry` 列。当前 `SCHEMA_VERSION = 3`。
- 每次迁移在事务内执行、逐条 `up()` 幂等，成功后递增 `user_version`；失败回滚并抛出，服务不启动。
- 迁移前若库内已有业务数据，会先经 `VACUUM INTO` 生成一致性快照到 `backend/data/backups/pre-migration-*.db`（失败不阻塞启动）。
- 备份 JSON 的 `schemaVersion` 字段记录导出时的库结构版本。

## 已实现接口

统一响应 `{ success, data, error }`，Base URL `/api/v1`。

### 投标项目（原 P1–P4 全套保留）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /projects | 列表：`status/category/q/startDate/endDate` 过滤 + `page/pageSize/sort/order`（q 含行业） |
| POST | /projects | 新增（服务端生成 projectCode；含 industry 行业字段） |
| GET/PUT/PATCH/DELETE | /projects/:id | 详情 / 全量 / 局部 / 软删除 |
| POST | /projects/:id/status | 状态流转 `{ toStatus, remark }`（服务端校验状态机） |
| GET | /projects/:id/status-logs | 状态历史 |
| GET | /dashboard/summary | 投标概览 |
| GET | /stats/overview | 统计：总数/中标率 + 状态/类别分布 + 月度趋势 |
| GET/POST | /documents | 项目文件夹链接（一个项目一条 `{ projectId, url }`） |
| GET/POST | /schedules · PUT/DELETE/:id · /:id/ack | 日程提醒 |
| GET/POST | /results · GET/:id/content · /:id/download · DELETE/:id | 开标结果文件（base64 JSON 上传/预览/下载） |
| GET | /export/projects?format=csv\|json | 项目导出（CSV 含行业列，金额万元） |
| POST | /import/projects | 批量导入 `{ format: "csv"\|"json", data }` |

### 个人工作台模块（任务 / 客户 / 总览）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | /tasks | 任务列表（scope=open\|done\|all、month 触发周期生成）/ 新增 |
| GET/PUT/PATCH/DELETE | /tasks/:id | 任务详情/更新/软删除 |
| POST | /tasks/:id/complete | 完成 `{ nextFollowDate? }`（客户任务回写档案并生成下一条） |
| POST | /tasks/:id/reopen | 重开 |
| GET/POST | /recurring-templates · PUT/DELETE/:id | 周期任务模板（每月固定任务） |
| POST | /recurring-templates/:id/generate | 手动为某月生成实例 `{ month }`（幂等 409） |
| GET/POST | /customers | 客户档案列表（status/q/needFollow 过滤）/ 新增 |
| GET/PUT/DELETE | /customers/:id | 客户详情（含跟进+未完成待办）/ 更新 / 软删除（连带取消待办） |
| GET | /customers/:id/follow-ups | 某客户跟进记录 |
| GET/POST | /follow-ups · PUT/DELETE/:id | 跟进记录 CRUD（nextFollowDate 非空自动生成客户待办） |
| GET | /dashboard/personal | 个人总览（任务/周期/客户 + bidDist 状态分布 + industryDist 行业分布） |
| GET | /reminders/today | 今日提醒（逾期/今日/7天 + 客户跟进 + 开标） |
| GET | /search?q= | 全局搜索（投标项目/任务/客户） |

### 数据管理（备份 / 恢复 / 模块导出 / 操作日志）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /export/backup | 完整备份 v2 JSON（10 张业务表） |
| POST | /import/backup | 覆盖恢复 `{ data, confirm:"RESTORE" }`（先备份再操作；旧 v1 兼容仅恢复投标部分） |
| GET | /export/tasks /customers /follow-ups | 各模块 CSV（带 BOM，Excel 可直接打开） |
| GET | /audit-logs?limit=&action=&entityType= | 操作日志（增删改/状态流转/上传/导入导出/恢复） |

## 状态机（投标）

```
跟踪中 → 已报名 → 已购标书 → 已投标 → 已开标 → 中标 / 未中标 / 流标
跟踪中（及任何非终态）→ 流标
```

终态（中标/未中标/流标）不可再流转；非法跳转返回 `FORBIDDEN_STATUS`。

详见 `../backend-design.md` 与 `../personal-workbench-design.md`。
