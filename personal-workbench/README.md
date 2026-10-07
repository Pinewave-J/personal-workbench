# 个人工作台（投标 · 待办 · 客户）

本地单机运行的**投标信息登记 + 个人事务管理**工作台。

单页前端（原生 HTML / CSS / JS，**无构建、无框架**）+ Node.js Express + SQLite（Node 内置 `node:sqlite`，**零原生依赖**）。数据全部落在本机一个 `.db` 文件里，不联网、不上云。

> 前端版本：`2026-09-20j`（见侧栏底部与「设置」页，用来判断浏览器是否还在用缓存里的旧文件）

---

## 功能一览

| 模块 | 能力 |
|---|---|
| 个人总览 | 磁贴导航 + 月历 + 项目状态分布环形图 + 行业分布环形图 + 今日提醒 + 投标动态 |
| 首页日历 | 月视图聚合四类事项：任务 / 投标截止与开标 / 日程提醒 / 客户跟进；可看当天明细、勾完成、就地新增待办 |
| 待办看板 | 重要紧急四象限、状态（待办 / 进行中 / 已完成 / 已取消）、截止日与提前提醒 |
| 周期任务 | 每月固定任务模板（每月第 N 天），进入待办页自动幂等生成本月实例 |
| 客户档案 | 客户 CRUD（潜在 / 跟进中 / 已成交 / 暂停 / 流失） |
| 跟进记录 | 记跟进 → 填下次跟进日期自动生成待办；完成待办回写客户，闭环联动 |
| 投标工作台 | 项目登记（类别 / 行业 / 预算 / 保证金 / 报价）、状态机流转、文件夹链接、日程提醒、开标结果上传预览、统计分析 |
| 公告解析 | 粘贴招标公告 → 正则即时填充；也可交 AI 抽取成字段建议，**人工勾选确认后**才落库 |
| 系统图谱 | 6 张 archify 交互式图谱（状态机 / 客户闭环 / 周期幂等 / 系统架构 / 备份恢复 / 结果链路） |
| 系统 | 操作日志、备份与覆盖恢复、模块 CSV 导出、全局搜索、浅色 / 暗色主题 |

### 两条设计红线

1. **AI 只写暂存队列**（`ai_job` / `ai_suggestion`），**永不直接写业务表**。落库仍走既有的保存按钮，因此编号生成、状态机校验、金额归一、操作日志全部照常生效。
2. **金额一律以「元」入库**，前端与 CSV 以「万元」呈现（JSON 备份为元原值），避免单位换算出错。

---

## 环境要求

- Windows / macOS / Linux 均可
- **Node.js v22.5 及以上**（需要内置 `node:sqlite`；建议 v25，本工程在 v25.2 验证）
- 无需联网，无需数据库服务

---

## 快速开始

```bash
cd backend
npm install        # 只需 express 一个依赖
npm start          # 监听 http://127.0.0.1:8787
```

看到 `[personal-workbench] backend ready` 即成功，**该窗口保持打开**。

然后任选一种方式打开前端：

- **浏览器**：访问 <http://127.0.0.1:8787/>（后端会直接托管前端文件），或直接双击 `personal-workbench.html`
- **Windows 一键**：双击 `启动个人工作台.bat`（自动起后端 + 打开浏览器）
- **DeepSeek Harness**：把 `widget-result.json` 放进 DSH 站点目录，或在窗口中选择该 HTML 挂载

> 换端口：`$env:PORT=9000` 后启动，并同步修改 `personal-workbench.config.js` 里的 `API_BASE`。
> 不用 npm 也可以：`node --disable-warning=ExperimentalWarning src/index.js`。

### 数据在哪

- 数据库：`backend/data/workbench.db`（SQLite 单文件）。**首次启动自动建表**；仅当对应表为空时插入演示数据，已有数据不会被覆盖。
- 上传的开标结果文件：`backend/uploads/`
- 想重置：停掉后端，删掉 `workbench.db`，重启即重建演示数据。

---

## 目录结构

```
personal-workbench/
├─ personal-workbench.html        前端结构（薄壳，入口）
├─ personal-workbench.css         样式（含浅色主题覆盖）
├─ personal-workbench.config.js   配置与文案（API_BASE / 枚举 / 配色 / 校验提示）
├─ personal-workbench.js          前端逻辑（api 封装 + Store + 各视图 + App）
├─ widget-result.json             DSH 工作台挂载清单（窗口1 → 本页）
├─ 启动个人工作台.bat               Windows 一键启动
├─ 使用说明.md                     完整使用手册（功能细节看这份）
├─ personal-workbench-design.md   设计文档：决策 / DDL / 联动规则 / API
├─ calendar-module-design.md      首页日历设计文档
├─ ai-assist-design.md            AI 公告抽取模块设计
├─ archify-graphs-plan.md         系统图谱计划
├─ kb-agent-integration-plan.md   与外部知识问答 Agent 的集成方案
├─ backend-design.md              投标登记模块的历史设计文档
├─ backend/
│  ├─ package.json / package-lock.json / README.md / .gitignore
│  └─ src/                        24 个模块：Express 入口 + 每实体一个 router +
│                                 db.js（建表 / 版本化迁移 / 演示数据）+ util / audit / io
├─ ai/                            公告字段抽取：命令行助手 + 契约守卫 + 行为测试 +
│                                 P4 对照实验数据集与报告 + 样例公告
└─ graphs/                        6 张 archify 交互式系统图谱（规格 JSON + 自包含 HTML）
```

---

## 技术要点

- **统一响应**：`{ success, data, error: { code, message, fields? } }`；错误码 `VALIDATION_ERROR / NOT_FOUND / CONFLICT / FORBIDDEN_STATUS / INTERNAL`。
- **软删除**：`deleted_at` 非空即视为删除，所有查询默认过滤。
- **结构迁移**：`PRAGMA user_version` + 有序迁移数组，每步幂等；迁移前自动 `VACUUM INTO` 快照。
- **编号生成**：`project_code` 由服务端生成（`PRJ-2026-001`），与自增 id 分离。
- **文件上传**：不用 multer，走 base64 JSON，`randomUUID` 命名，落盘前校验路径防穿越。
- **前端**：`api()` fetch 封装 → `Store`（每实体一组方法）→ `App` IIFE（视图映射 + 通用弹窗字段系统 + `data-*` 事件绑定），`bindViewEvents()` 每次渲染后重绑。

---

## 隐私与数据

本仓库**不含任何个人业务数据**，`.gitignore` 已显式排除：

| 排除项 | 原因 |
|---|---|
| `backend/data/`、`*.db` | 真实项目 / 客户 / 待办数据库 |
| `backend/uploads/` | 上传的开标结果等附件 |
| `backup-*.json`、`*.zip` | 含真实客户与联系人信息的备份 / 分享包 |
| `node_modules/` | 可由 `npm install` 重建 |
| `.archify-delivery-*/` | 图谱生成过程的中间快照 |

另外，文档与测试样例中的**公司名、联系人、联系电话均已替换为占位值**（如「某某新能源材料有限公司」）。`backend/src/db.js` 里的演示数据本来就是虚构的（`某市…` + `138xxxx` 号段 + `@*.example` 邮箱）。

---

## 已知问题

- `ai/ai-ui-guard-test.mjs` 有 **1 条断言过期**：它断言 `SCHEMA_VERSION = 6`，而当前库结构已到 **8**（标书编制模块引入的 v7 / v8 迁移）。这是历史遗留断言，不影响任何功能，运行结果稳定为 **89 通过 / 1 失败**。
- **「标书编制」模块已停用（实验性）**。前端入口「标书编制」只显示「功能升级中，请期待」占位；但后端 `bid-*.js`、`outline-template.js`、`main.js` 与相关表结构仍在仓库中，属于待清理的历史代码，**不要在正式流程中使用**。
- 首页日历在窗口宽度 < 760px 时会自动切换为按日期分组的清单。

---

## 相关文档

- [使用说明.md](使用说明.md) — 完整使用手册（功能细节、常见问题）
- [personal-workbench-design.md](personal-workbench-design.md) — 设计文档
- [backend/README.md](backend/README.md) — 后端接口说明
- [ai/README.md](ai/README.md) — 公告抽取模块与测试怎么跑
- [graphs/README.md](graphs/README.md) — 系统图谱怎么重新生成

## 许可

本仓库未附开源许可协议。如需公开发布，请先自行添加（例如 MIT / Apache-2.0），并确认是否愿意公开其中的设计文档。
