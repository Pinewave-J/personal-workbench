# AI 助手 · 公告字段抽取（第一期）

把招标/采购公告读懂，抽成「投标项目」的字段建议，你勾选确认后才落库。

**核心保证：AI 只写暂存队列，永远不直接写业务表。** 落库仍走既有的保存按钮，
所以 `project_code` 生成、状态机校验、金额归一、操作日志全部照旧生效。

---

## 一、目录里都有什么

| 文件 | 作用 |
|---|---|
| `workbench-notice-extract/SKILL.md` | **DSH 技能**：教 agent 怎么解析公告、回写建议（需手工安装，见 §二） |
| `wb.mjs` | 命令行助手：列队列、看详情、回写建议、清理（给 skill 用，也能自己用） |
| `ai-extract-test.mjs` | 后端断言测试（63 条）：白名单 / 金额归一 / 枚举 / 日期 / 幂等 / 审计 / 隐私清理 |
| `ai-ui-guard-test.mjs` | 前端接线契约守卫（90 条）：`App.*` 方法、DOM id、CSS 类、金额往返、**调用参数个数（arity lint）**、不直写业务表 |
| `ai-ui-behavior-test.mjs` | 前端行为测试（38 条）：用**真实函数 + 假 DOM** 跑「建议区渲染 / 默认勾选策略 / 填入表单 / 取消勾选 / 读文本文件判据 / 载入入口」 |
| `p4-dataset.json` | P4 对照实验用的 10 组公告样本 + 人工标准答案 |
| `p4-ai.json` | P4 的 AI 通道抽取产物 |
| `p4-compare.mjs` | 对照实验脚本（正则跑真实源码函数，AI 走真实接口） |
| `p4-report.md` | **对照实验报告**（自动生成，每次重跑覆盖） |
| `samples/` | 端到端联调用的样例公告与抽取结果 |

---

## 二、一次性安装技能（必须做，否则 DSH 不认识「处理待解析公告」）

DSH 只从 `~/.dsh/skills/` 读技能，该目录在工作区之外，需要你**手工拷一次**：

```powershell
# 在 PowerShell 里执行（把工作台根目录换成你的实际路径）
$root = "<工作台根目录>"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.dsh\skills" | Out-Null
Copy-Item -Recurse -Force "$root\ai\workbench-notice-extract" "$env:USERPROFILE\.dsh\skills\"
```

装好后**新开一个 DSH 会话**（技能在会话启动时加载）。验证：问 DSH「你有哪些技能」，
应能看到 `workbench-notice-extract`。

> 以后改 `SKILL.md` 后重新拷一次即可。

---

## 三、日常怎么用

### 在工作台界面里

1. 左侧「投标项目」→「新增投标登记」
2. 把公告原文**粘进**文本框，或点 **「读取文本文件」**选一个 `.txt / .md / .csv / .log / .json / .text`
   （PDF / Word 前端不解析——交给 DSH 抽文字层，见下）
3. 点 **「AI 解析」** → 提交进队列，并先用正则填一遍（不用干等）
4. 切到 DSH 对话，说一句：**「处理待解析公告」**（或直接把 PDF 路径给 DSH）
5. 回到弹窗点 **「刷新建议」** → 出现建议列表（字段 / 建议值 / 置信度 / **原文出处**）
   - `low` 置信度、或没有原文出处的建议**默认不勾选**
6. 勾选 → **「填入表单」** → 逐项核对（被 AI 填过的字段有「AI 建议·请核对」标记，你一改就消失）
7. 点保存 → 正常落库，该队列任务同时被标记「已采用」并清空原文

**弹窗关掉了 / 强刷了 / 任务是由 DSH 从 PDF 建的？** 不用重来：
打开「新增投标登记」时，如果队列里已有解析好的建议，面板顶部会列出
「队列里已有 N 条已解析的建议，可直接载入：[载入 #38（14 条）]」——点一下就载回表单。
（只列**已建议**且建议数 >0 的任务；已采用/已忽略的不再出现。）

**不想用 AI 时**：点「识别填写」（纯正则），完全离线、立刻见效 —— 功能不会因为 AI 不可用而减少。

> ⚠️ 但对**表格型公告**（前附表用空格/│ 分隔、标签后无冒号）正则几乎读不到，
> 还可能错填（实测把条款号 `13.1` 当成保证金）。这类文件务必走「AI 解析」。

### 只用命令行

```powershell
node ai/wb.mjs count                      # 队列角标
node ai/wb.mjs list                       # 列出待解析（含全文，供抽取）
node ai/wb.mjs submit notice.txt "来源"    # 直接把公告入队
node ai/wb.mjs suggest 12 sug.json        # 回写建议
node ai/wb.mjs adopt 12 [projectId]       # 标记已采用（清空原文）
node ai/wb.mjs ignore 12                  # 忽略
node ai/wb.mjs del 12                     # 删除
```

后端非默认端口时：`$env:WB_BASE="http://127.0.0.1:8791/api/v1"`。

---

## 四、跑测试

```powershell
# 后端断言（建议指向独立 DB 的测试实例，避免污染真实库）
$env:PORT=8791; $env:DB_PATH="$env:TEMP\_ai-test.db"
cmd /c "node --disable-warning=ExperimentalWarning src/index.js"   # 在 backend/ 下另开一个窗口
$env:AI_TEST_BASE="http://127.0.0.1:8791/api/v1"; node ai/ai-extract-test.mjs

# 直接打真实实例（脚本自带清理，会留少量 ai_* 操作日志）
node ai/ai-extract-test.mjs

# 前端契约守卫（纯静态，不需要后端）
node ai/ai-ui-guard-test.mjs

# 前端行为测试（真实函数 + 假 DOM，不需要后端）
node ai/ai-ui-behavior-test.mjs

# P4 对照实验（会重建报告，跑完自动清理队列）
node ai/p4-compare.mjs
```

---

## 五、几个必须知道的约定

- **建议 JSON 带 BOM 也能用**：Windows 下 `Set-Content -Encoding UTF8` 会写出 BOM（`\uFEFF`），
  裸 `JSON.parse` 会直接报 `Unexpected token`。`wb.mjs` 现在会**自动剥掉 BOM**，
  所以 `submit` / `suggest` 用 PowerShell 写出来的文件都能直接吃。（实测踩过这个坑）

- **金额一律「元」入库**。AI 回写时必须给 `unit`（元/万元/亿元），服务端按 unit 归一；
  缺失或认不出就**整条丢弃**（防「100万元 → 100元」）。所以 `suggest` 的 JSON 里金额要写
  `{"field":"budget","value":3260,"unit":"万元"}`，**不要自己换算成元**，也不要把中文大写当值传（会被拒）。
- **日期必须 `YYYY-MM-DD`**；原文里的时刻（如 9:30）只放进 `evidence`。
- **`category` 必须精确命中**：工程监理 / 造价 / 咨询 / 全过程咨询 / 工程管理 / 其他。
  不在枚举里会被丢弃（**故意不**沿用 `projects.js` 的"静默回退成其他"，否则你会以为 AI 填对了）。
- **不能抽 `openTime` / `bidPrice` / `status` / `projectCode`**：前两个是既定设计或公告里不存在，
  后两个是服务端职责。给了也会被白名单拒掉。
- **原文会被清理**：任务一旦「已采用」或「已忽略」，`input_text` 立即清空（`text_purged=1`），
  只保留字段建议。设置页另有「清空已终结的 AI 记录」做批量清理。
- **备份与分享包天然不含 AI 队列**（已核实）：`io.js` 的导出与恢复都是**显式表清单**
  （`TABLES_FULL` / payload 键），里面没有 `ai_job` / `ai_suggestion`。
  也就是说队列不会跟着备份跑，也没机会泄进分享包 —— 隐私上正好是我们想要的。
  代价是**换机后队列不迁移**（已落库的项目不受影响），以及恢复备份后旧任务的 `entity_id`
  可能指向已变更的项目 id（仅作审计参考，不影响任何功能）。

---

## 六、设计与验证文档

- `../ai-assist-design.md` — 模块设计（决策 / DDL / 接口 / 契约 / 阶段规划）
- `p4-report.md` — 对照实验结果与**局限说明**（务必连数字一起看）
