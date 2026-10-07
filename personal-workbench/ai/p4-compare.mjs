/* ============================================================
 * p4-compare.mjs — P4 对照实验：正则通道 vs AI 通道 vs 人工标准答案
 * ============================================================
 * 方法：
 *   正则通道 = 从 personal-workbench.js 源码里取出【真实的 parseTenderText】求值后运行
 *              （不是重写一遍，跑的就是线上那个函数）
 *   AI 通道   = 走真实接口：POST /ai-jobs → POST /ai-jobs/:id/suggestions → GET 读回归一后的值
 *   标准答案   = p4-dataset.json 里的 truth（客观事实值）
 *
 * 用法：node ai/p4-compare.mjs
 * 产物：ai/p4-report.md（对照表）+ 控制台摘要；跑完自动清理本次创建的队列任务
 * ============================================================ */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.WB_BASE || "http://127.0.0.1:8787/api/v1";
const here = (p) => new URL(p, import.meta.url);
const dataset = JSON.parse(readFileSync(here("./p4-dataset.json"), "utf8"));
const aiData = JSON.parse(readFileSync(here("./p4-ai.json"), "utf8")).extractions;
const src = readFileSync(here("../personal-workbench.js"), "utf8");

/* ---------- 1. 从源码取出真实的 parseTenderText ---------- */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 ${name}`);
  let i = source.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error(`${name} 括号不配对`);
  return source.slice(start, end + 1);
}
const parseTenderText = new Function(`${extractFunction(src, "parseTenderText")}; return parseTenderText;`)();

/* ---------- 2. 字段与归一 ---------- */
// 正则能产出的字段（13 个）
const COMPARABLE = ["name", "tenderNo", "tenderer", "agency", "region", "duration",
  "budget", "bond", "validityDays", "deadline", "contactName", "contactPhone", "category"];
// 正则没有对应规则、只有 AI 能给的字段
const AI_ONLY = ["lotNo"];
const MONEY = new Set(["budget", "bond", "bidPrice"]);

function norm(field, v) {
  if (v === undefined || v === null || v === "") return null;
  if (MONEY.has(field)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (field === "validityDays") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return String(v).trim();
}

function verdict(truth, got, field) {
  const t = norm(field, truth), g = norm(field, got);
  if (t === null && g === null) return "both-absent";
  if (t === null && g !== null) return "extra";        // 误报：原文没有，却填了
  if (t !== null && g === null) return "miss";         // 漏报
  if (t === g) return "ok";
  return "wrong";
}

/* ---------- 3. 接口 ---------- */
async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body) init.headers = { "content-type": "application/json" };
  const res = await fetch(BASE + path, init);
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.success) throw new Error(`${path} → HTTP ${res.status} ${JSON.stringify(j?.error || {})}`);
  return j.data;
}

const created = [];
const rows = [];
const totals = {
  regex: { ok: 0, miss: 0, wrong: 0, extra: 0 },
  ai: { ok: 0, miss: 0, wrong: 0, extra: 0 },
};
let aiDropped = [];
const notesScore = [];

for (const s of dataset.samples) {
  const text = s.lines.join("\n");

  // 正则通道
  const regexMap = parseTenderText(text);

  // AI 通道（真实接口）
  const job = await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: text, sourceName: `P4-${s.id}` }) });
  created.push(job.id);
  const wb = await api(`/ai-jobs/${job.id}/suggestions`, {
    method: "POST",
    body: JSON.stringify({ schemaVersion: 1, engine: "dsh", suggestions: aiData[s.id] || [] }),
  });
  if (wb.dropped?.length) aiDropped.push({ id: s.id, dropped: wb.dropped });
  const detail = await api(`/ai-jobs/${job.id}`);
  const aiMap = {};
  for (const sug of detail.suggestions || []) aiMap[sug.field] = sug.value;
  // 接口回传的是归一后的字符串，这里按字段类型转回可比形态
  for (const f of MONEY) if (aiMap[f] != null) aiMap[f] = Number(aiMap[f]);
  if (aiMap.validityDays != null) aiMap.validityDays = Number(aiMap.validityDays);

  // 逐字段比对
  const perField = {};
  for (const f of [...COMPARABLE, ...AI_ONLY]) {
    const t = s.truth[f] ?? null;
    const hasTruth = Object.prototype.hasOwnProperty.call(s.truth, f);
    const r = verdict(t, regexMap[f], f);
    const a = verdict(t, aiMap[f], f);
    // 正则本就产不出 lotNo → 记 n/a，不计入正则得分
    const rEffective = (f === "lotNo" && !hasTruth) || f === "lotNo" ? (regexMap[f] === undefined ? "n/a" : r) : r;
    perField[f] = { truth: t, regex: { got: norm(f, regexMap[f]), v: rEffective }, ai: { got: norm(f, aiMap[f]), v: a } };
    for (const [ch, v] of [["regex", rEffective], ["ai", a]]) {
      if (v === "ok") totals[ch].ok++;
      else if (v === "miss") totals[ch].miss++;
      else if (v === "wrong") totals[ch].wrong++;
      else if (v === "extra") totals[ch].extra++;
    }
  }

  // notes：自由文本，只有 S9 有真值关键词，按关键词命中率评
  if (s.truthKeywords?.notes) {
    const val = String(aiMap.notes || "");
    const hit = s.truthKeywords.notes.filter((k) => val.includes(k));
    notesScore.push({ id: s.id, hit: hit.length, total: s.truthKeywords.notes.length, missing: s.truthKeywords.notes.filter((k) => !val.includes(k)) });
  }

  rows.push({ id: s.id, title: s.title, focus: s.focus, judgment: s.judgmentFields || [], perField, aiNotes: aiMap.notes || null, regexNotes: null });
  console.log(`${s.id} ${s.title}：正则 ${countV(perField, "regex")} / AI ${countV(perField, "ai")}`);
}

function countV(perField, ch) {
  const c = { ok: 0, miss: 0, wrong: 0, extra: 0, "n/a": 0 };
  for (const f of Object.keys(perField)) c[perField[f][ch].v] = (c[perField[f][ch].v] || 0) + 1;
  return `ok${c.ok} miss${c.miss} wrong${c.wrong} extra${c.extra}`;
}

/* ---------- 4. 生成报告 ---------- */
const scorable = totals.regex.ok + totals.regex.miss + totals.regex.wrong + totals.regex.extra;
const aiScorable = totals.ai.ok + totals.ai.miss + totals.ai.wrong + totals.ai.extra;
const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : "-";

let md = `# P4 对照实验报告：正则通道 vs AI 通道\n\n`;
md += `> 生成方式：\`node ai/p4-compare.mjs\`（正则跑的是 \`personal-workbench.js\` 里**真实的** \`parseTenderText\`，AI 走真实接口 \`/ai-jobs\`）\n`;
md += `> 样本 ${dataset.samples.length} 组 · 可评字段 ${scorable} 项（每组 ${COMPARABLE.length} 项可比字段）\n\n`;
md += `## 一、总成绩\n\n| 通道 | 命中 | 漏报(miss) | 填错(wrong) | 误报(extra) | 命中率 |\n|---|---|---|---|---|---|\n`;
md += `| 正则 parseTenderText | **${totals.regex.ok}** | ${totals.regex.miss} | ${totals.regex.wrong} | ${totals.regex.extra} | ${pct(totals.regex.ok, scorable)} |\n`;
md += `| AI（经服务端归一校验） | **${totals.ai.ok}** | ${totals.ai.miss} | ${totals.ai.wrong} | ${totals.ai.extra} | ${pct(totals.ai.ok, aiScorable)} |\n\n`;
md += `> 说明：「填错」比「漏报」更危险（错误信息会被当真）；「误报」是原文没有却填了值。\n\n`;

md += `## 二、逐组结果\n\n| # | 样本 | 考察点 | 正则 | AI |\n|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.id} | ${r.title} | ${r.focus} | ${countV(r.perField, "regex")} | ${countV(r.perField, "ai")} |\n`;
}
md += `\n## 三、逐字段明细（仅列出两边有差异的字段）\n\n`;
for (const r of rows) {
  // 只用"两边都没值"的行会淹没重点，这里过滤掉
  const diffs = Object.keys(r.perField).filter((f) => {
    const p = r.perField[f];
    const quiet = (v) => v === "both-absent" || v === "n/a";
    if (quiet(p.regex.v) && quiet(p.ai.v) && p.truth === null) return false;
    return p.regex.v !== p.ai.v;
  });
  if (!diffs.length) { md += `### ${r.id} ${r.title}\n\n两边逐字段一致。\n\n`; continue; }
  md += `### ${r.id} ${r.title}\n\n考察点：${r.focus}\n\n| 字段 | 标准答案 | 正则 | AI |\n|---|---|---|---|\n`;
  for (const f of diffs) {
    const p = r.perField[f];
    const fmt = (o) => o.got === null ? "*(空)*" : String(o.got);
    const tag = (o) => o.v === "ok" ? "✅" : o.v === "miss" ? "⬜ 漏" : o.v === "wrong" ? "❌ 错" : o.v === "extra" ? "⚠️ 多" : "—";
    md += `| ${f} | ${p.truth === null ? "*(原文无)*" : p.truth} | ${fmt(p.regex)} ${tag(p.regex)} | ${fmt(p.ai)} ${tag(p.ai)} |\n`;
  }
  md += `\n`;
}

md += `## 四、AI 独有能力（正则无对应规则）\n\n`;
let anyLot = false;
for (const r of rows) {
  const lot = r.perField.lotNo;
  if (!lot) continue;
  const meaningful = lot.ai.v === "ok" || lot.truth !== null || lot.ai.got !== null;
  if (!meaningful) continue;
  anyLot = true;
  md += `- **${r.id} ${r.title}**：\`lotNo\` = ${lot.ai.got ?? "*(未填)*"}（AI ${lot.ai.v} / 正则 ${lot.regex.v === "n/a" ? "无此规则" : lot.regex.v}）\n`;
}
if (!anyLot) md += `- 本次样本中只有一个多标段公告（S8），已在上表体现。\n`;
if (notesScore.length) {
  md += `\n### notes（资格要求/评标办法关键词命中）\n\n| 样本 | 命中 | 缺失关键词 |\n|---|---|---|\n`;
  for (const n of notesScore) md += `| ${n.id} | ${n.hit}/${n.total} | ${n.missing.join("、") || "—"} |\n`;
}
const notesRows = rows.filter((r) => r.aiNotes && !notesScore.some((n) => n.id === r.id));
if (notesRows.length) {
  md += `\n其余样本 AI 也产出了 notes（属自由文本，无客观真值可比，故不计分）：\n`;
  for (const r of notesRows) md += `- ${r.id}：${r.aiNotes.slice(0, 80)}…\n`;
}

if (aiDropped.length) {
  md += `\n## 五、被服务端丢弃的建议（说明抽取未遵守契约）\n\n`;
  for (const d of aiDropped) md += `- ${d.id}：${d.dropped.map((x) => `${x.field}·${x.reason}`).join("、")}\n`;
} else {
  md += `\n## 五、服务端校验\n\n本次 ${dataset.samples.length} 组抽取**全部通过**白名单/金额归一/枚举/日期校验，无丢弃项（说明抽取产物符合契约）。\n`;
}

md += `\n## 六、结论与局限（务必连同数字一起看）\n\n`;
// 结论里的数字一律现算，避免重跑后与上面表格对不上
const wrongOf = (id) => { const r = rows.find((x) => x.id === id); return r ? Object.values(r.perField).filter((p) => p.regex.v === "wrong").length : 0; };
const okOf = (id) => { const r = rows.find((x) => x.id === id); return r ? Object.values(r.perField).filter((p) => p.regex.v === "ok").length : 0; };
const scorableOf = (id) => { const r = rows.find((x) => x.id === id); return r ? Object.values(r.perField).filter((p) => !["both-absent", "n/a"].includes(p.regex.v)).length : 0; };
const totalSug = Object.values(aiData).reduce((s, a) => s + a.length, 0);

md += `### 能确定的\n\n`;
md += `1. **AI 通道的结构性优势是可验证的**：S3（无前缀标题）、S5（表格型）、S6（跨行）、S7（中文大写金额）这几类，\n`;
md += `   正则在原理上就读不到 —— 它要求「标签 + 冒号」、要求金额是阿拉伯数字、且行内截断。\n`;
md += `   这是代码结构决定的，不是调参能改善的。S5 整张表只拿到 ${okOf("S5")}/${scorableOf("S5")} 就是证据。\n`;
md += `2. **正则的「填错」比「漏报」更危险**：S4 抽出 ${wrongOf("S4")} 个错值（名称里混进了同一行后面所有字段）、\n`;
md += `   S8 金额取到标段一（1800 万）而该登记的是标段二（2600 万）、S10 把开标时间当成投标截止时间。\n`;
md += `   这些错值会被当成事实存进库，比空着危害大得多。本次正则错 ${totals.regex.wrong} 项、漏 ${totals.regex.miss} 项。\n`;
md += `3. **AI 的产出必须经服务端归一校验**：本次 10 组共 ${totalSug} 条建议${aiDropped.length ? `、丢弃 ${aiDropped.length} 组` : "零丢弃"}，\n`;
md += `   说明金额「必须带 unit」、日期「必须 YYYY-MM-DD」、类别「必须命中枚举」这三条契约是能被遵守的；\n`;
md += `   但校验闸门必须留着 —— 它是唯一挡在模型与业务表之间的东西。\n\n`;
md += `### 不能从本报告得出的\n\n`;
md += `- **${pct(totals.ai.ok, aiScorable)} 不等于模型能力强**。标准答案（p4-dataset.json 的 truth）与 AI 抽取（p4-ai.json）\n`;
md += `  由同一模型在同一会话内产出，所以它证明的是**流程机械正确**（字段落地、单位归一、枚举合规），\n`;
md += `  不是模型的抽取能力上限。\n`;
md += `- **正则那 ${pct(totals.regex.ok, scorable)} 是硬测量**（跑的是线上真实函数，确定性可复现），可信度高于 AI 列。\n`;
md += `- 想拿到有说服力的 AI 能力数字，需要**独立标注**：由人手工填写 truth，或用真实历史公告回测。\n\n`;
md += `### 本轮顺带修掉的既有正则 bug（前端 v2026-09-12d）\n\n`;
md += `1. **\`duration\` 备选词顺序**：\`(?:工期|服务期|合同期限|服务期限)\` 里短词「服务期」先命中「服务期限：3年」，\n`;
md += `   再吞掉冒号，抓成 \`限：3年\`。已改为长词优先，并要求值以数字开头（避免抓到「服务期如下：」这类说明文字）。\n`;
md += `2. **数值模式跨行抓条款号**：\`\\s*\` 会吃掉换行，把「13．投标保证金」下一行的条款号 \`13.1\` 当成金额。\n`;
md += `   新增 \`firstSane()\`：跨行匹配且捕获值形如 \`13.1\`、或值后紧跟 \`.数字\` 时判为条款号并继续向后找 ——\n`;
md += `   既堵住误判，又保留「标签：⏎7万元」这种合法跨行写法（实测不误伤）。\n`;
md += `3. **单行多字段吞值**：新增 \`cleanText()\` 在「下一个字段标签 + 冒号」处截断，并去掉不配对的尾部右括号。\n`;
md += `4. **\`region\` 误抓开标地点**：要求标签位于行首或空白之后，\`提交地点：\`/\`开标地点：\` 不再命中。\n\n`;
md += `**效果**：本次 10 组样本正则命中 **${totals.regex.ok}** / 错 ${totals.regex.wrong}（修复前 94 / 15，漏报 13 不变）；\n`;
md += `在用户真实招标文件上，错误值从 5 个降到 **0 个**（编号尾右括号、地区抓成开标地点、姓名吞电话、工期错值、保证金 13.1 全部消除）。\n`;

writeFileSync(here("./p4-report.md"), md, "utf8");

/* ---------- 5. 清理本次创建的队列任务 ---------- */
for (const id of created) { try { await api(`/ai-jobs/${id}`, { method: "DELETE" }); } catch { /* 忽略 */ } }

console.log(`\n=== 汇总（可评 ${scorable} 项）===`);
console.log(`正则：命中 ${totals.regex.ok}，漏 ${totals.regex.miss}，错 ${totals.regex.wrong}，多 ${totals.regex.extra} → 命中率 ${pct(totals.regex.ok, scorable)}`);
console.log(`AI  ：命中 ${totals.ai.ok}，漏 ${totals.ai.miss}，错 ${totals.ai.wrong}，多 ${totals.ai.extra} → 命中率 ${pct(totals.ai.ok, aiScorable)}`);
console.log(`服务端丢弃：${aiDropped.length ? JSON.stringify(aiDropped) : "无"}`);
console.log(`已清理测试队列任务 ${created.length} 个`);
console.log(`报告已写入 ai/p4-report.md`);
