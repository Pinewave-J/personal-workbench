# 系统图谱（archify 生成）

> 这里的三张图谱是**静态文档**：由同目录的规格 JSON 生成，不随数据实时变化。
> 改了后端逻辑后需要重新生成（见下方命令）。

## 一、产物

| 规格 | 产物 | 类型 | 说明 |
|---|---|---|---|
| `01-bid-lifecycle.json` | `01-bid-lifecycle.html` | `lifecycle` | 投标项目状态机：8 状态、合法流转、三个终态 |
| `02-customer-loop.json` | `02-customer-loop.html` | `workflow` | 客户跟进 ↔ 待办双向闭环 |
| `03-recurring-idempotent.json` | `03-recurring-idempotent.html` | `workflow` | 周期任务生成与幂等 |
| `04-architecture.json` | `04-architecture.html` | `architecture` | 系统架构：浏览器 → 前端 → Express → SQLite + 本机文件 + 外部依赖降级 |
| `05-backup-restore.json` | `05-backup-restore.html` | `dataflow` | 备份与恢复数据流：校验 → 快照 → 清表回填 → 文件补传 |
| `06-result-upload.json` | `06-result-upload.html` | `sequence` | 开标结果：上传 → 预览 → 缺失标记 → 原地补传 |
| `index.json` | — | — | 工作台「系统图谱」页读取的清单 |

每个 HTML 约 610–620KB，自带 viewer（深浅主题、缩放、搜索、聚焦、导出）与 3 张结论卡片。
`graphs/` 里 `.archify-delivery-*` 目录是 archify 的**冻结规格快照**，不要删（它是产物可追溯的依据）；
后端 `express.static` 默认忽略点开头目录，所以它们不会被对外暴露（已实测 404）。

## 二、每张图的代码依据（事实来源）

| 图 | 依据 |
|---|---|
| 投标状态机 | `backend/src/status.js:2-26`（8 个状态 + `TRANSITIONS` + 终态集合）；"任何非终态→流标"见同文件 `TRANSITIONS` 每一项都含 `流标` |
| 客户跟进闭环 | `backend/src/customers.js:47-61`（`ensureCustomerTask` 幂等去重）、`:160-177`、`:238-260`（记录跟进→生成待办）、`:283-285`（PUT 语义差异）；`backend/src/tasks.js:265-300`（完成→回写客户→生成下一条） |
| 周期任务幂等 | `backend/src/tasks.js:83-118`（`generateInstancesForMonth`，含 `skipped/restored`）、`:186-196`（`POST /tasks/ensure-month`）、`:382-412`（模板手动生成 + 409 / restore）；`backend/src/db.js` v4 迁移（`uq_task_tpl_month` 唯一索引） |
| 系统架构 | `backend/src/index.js`（13 组路由挂载 + 图谱静态路由）、`backend/src/*.js` 共 16 个模块、`backend/data/workbench.db`(WAL)、`backend/uploads/`、`backend/data/backups/`、前端 4 文件与 `widget-result.json`；外部依赖见 `personal-workbench.html`（jsdelivr SheetJS）与图谱 HTML（Google Fonts） |
| 备份与恢复 | `backend/src/io.js:81-102`（导出，只含元数据）、`:104-142`（恢复前 `VACUUM INTO` 快照与结构校验）、`:143-232`（清表/回填/整体回滚、`skipInvalidRefs`）；`backend/src/results.js`（`exists` 标记与补传） |
| 开标结果链路 | `backend/src/results.js:63-88`（POST 上传）、`:99-139`（PUT 补传）、`:141-157`（content 预览）、`:159-173`（download）；前端预览沙箱与路径校验 |

## 三、重新生成（一条命令）

```powershell
$s = "C:\Users\<用户名>\.dsh\profiles\web\node_modules\@tt-a1i\archify-dsh\skills\archify"
$g = "<工作台根目录>\graphs"
node "$s\bin\archify.mjs" deliver lifecycle "$g\01-bid-lifecycle.json" "$g\01-bid-lifecycle.html" --quality showcase --json
node "$s\bin\archify.mjs" deliver workflow  "$g\02-customer-loop.json"  "$g\02-customer-loop.html"  --quality showcase --json
node "$s\bin\archify.mjs" deliver workflow  "$s..\03-recurring-idempotent.json" "$g\03-recurring-idempotent.html" --quality showcase --json
```

> 注意：`deliver` 需要 spawn 子 node 进程，在本机 `workspace-write` 沙箱下会 `EPERM`；
> 需要在更宽权限（`danger-full-access`）下运行。一次授权可覆盖多张图。

## 四、已核对的渲染器约束（照这些写规格，避免反复试错）

**通用**
- `meta.quality_profile` 必须是 `showcase`，验收口径：**9/9 项 artifact 检查、0 error 0 warning**。
- 首屏容纳：viewer 只有在该 SVG **宽高比 ≥ 1.55** 时才启用"自适应阅读宽度"。
  比例低于 1.55 时 SVG 按容器全宽渲染 → 1440×900 下必然纵向溢出（实测过一次）。
  经验区间：**比例取 1.6–1.8**（比例过大时，在 2048×1320 会撞到 1920 阅读宽度上限）。
- 节点/边标签不换行；宽度预算 ≈ `字数 × 6.8 × 2（中文按 2 字符宽）`，默认节点宽 92px → **中文标签不超过 7 字**。

**lifecycle**
- 主轨列 `0..4`；**`terminal` 等结果带的列只能是 `0..2`**，且结果列对齐在主轨**后段**正下方（col0≈主轨 col2、col1≈主轨 col3、col2≈主轨 col4）。
- 允许的纵向范围 = `meta.viewBox[1] − 122`（实测 H=590 → 上限 468，结果带 y≈432 会被卡住）；**H 建议 ≥ 600**。
- 同一带内两个状态间距 <10px 会报错 → 用不同 col 或 `yOffset` 分开。
- 边不得穿过无关状态；标签不得压住状态（可用 `labelDx/labelDy/labelAt` 挪，或干脆把语义写进 `sublabel`）。

**workflow**
- 列位 `x = [88, 220, 300, 430, 500, 625]`；**同泳道内 `c1+c2`、`c3+c4` 互斥**（间距只有 70–80px）。
- 每个节点的**每个方向最多挂一条自动边**，否则端口错位会产生 3–7px 的微小折段报错。
- 跨泳道用 `route: drop`（上/下皆可）；同泳道跨列优先让两点同 y 走直线，避免中点折返压到中间节点。
- 多条跨泳道边不要共用同一条水平走廊（共线重叠 >8px 会报 `ambiguous-corridor`）。

**architecture**
- 组件用 `pos`/`size` 绝对定位（示例就是这么写的）；**不设 `meta.viewBox` 时渲染器按内容自动算**——实测 6 组件 5 连线得到 `890×562`，宽高比只有 1.584，首屏会溢出。
  对策：**显式给 `viewBox`**，让比例落在 1.6–1.8（本图用 `[1060, 580]` → 1.83）。
- 连线标签会压到组件上：同一行内的水平连线用 `labelDy ≈ 64` 把标签压到下一空白带；竖直连线用 `labelDx` 移到线旁。
- 一条线上挂太多连接很容易触发穿节点/走廊重叠：**宁可合并下游节点**（本图把 uploads/backups/图谱合并成一个「本机文件」组件），也不要硬凑 6 条边。

**dataflow**
- 结构是「stage（2–5 个） × row」网格，**row 只能是 0..4**（row 5 会直接报错并算出 NaN）。
- 同一 stage 内的上下两个节点之间连线会走同一条 stage 中心线 → 默认自动路由产生 3.5px 微段报错。
  对策：显式 `route: "straight", fromSide: "bottom", toSide: "top"`，并用 `labelDx` + `labelDy` 把标签挪出节点带。
- 顺序步骤尽量放**相邻 stage**（左→右），把真正的并行/分支放成 row 差异。

**sequence**
- `messages[].y` 有可读区间：**必须落在 `160 .. viewBox[1] − 83`** 之内（本图 745 高 → 上限 662，最后一条放在 656）。
- 参与者多时用 `column_fit: "spread"` 让它们撑满画布（配合 ≥1.6 的宽高比）。
- `activations` 的 from/to 要包住该参与者参与的消息区间；同一参与者可以有多段激活。

**宽高比（所有类型通用，最容易踩）**
- viewer 只在 **SVG 宽高比 ≥ 1.55** 时启用「自适应阅读宽度」；低于阈值时按容器全宽渲染，1440×900 下必然纵向溢出。
- 实测：`1.584`（04 首版）仍会溢出，`1.636` 起稳定通过。**建议直接按 1.65–1.85 设 `viewBox`**。
- 另外注意：`visual-check` 的 containment 只测**浅色**主题，而 captures 会拍**深色**；深色下固定页高常多出几像素，**留 20–40px 余量**再交付（05 首版就是被深色下超 4px 判 fail 的）。

## 五、首屏实测（visual-check）

```powershell
# 非 ASCII 路径会让 visual-check 崩溃：先按字节复制到纯 ASCII 目录再校验
Copy-Item "<graphs>\01-bid-lifecycle.html" "C:\Temp\archify-check\01-bid-lifecycle.html"
node "$s\bin\archify.mjs" visual-check "C:\Temp\archify-check\01-bid-lifecycle.html" --json
```

实测结果（2026-09-11）：**六张图**都在 **1440×900 / 1600×1000 / 1920×1080 / 2048×1320** 四个尺寸 `ok`，且深色主题 1440×900 抓拍同样通过。
回执里 `visualReview` 永远先是 `pending`——那是**机器测得的包含性**，不代表人工看过截图。

## 六、变更记录

| 日期 | 内容 |
|---|---|
| 2026-09-11 | 首批 3 张（状态机 / 客户闭环 / 周期幂等）交付：均 9/9 检查、0 error 0 warning；四尺寸首屏包含性通过 |
| 2026-09-11 | 第二批 3 张（系统架构 / 备份恢复数据流 / 开标结果链路）交付：同样 9/9、0/0，六张四尺寸 + 深色抓拍全部通过。过程中依诊断修正：architecture 自动 viewBox 比例偏低（1.584）→ 显式设 1.83；dataflow row 上限 0..4 且同 stage 竖直连线需显式 straight；sequence 消息 y 上限 = viewBox[1]−83；深色主题需留余量 |
