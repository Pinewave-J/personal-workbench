/* ============================================================
 * ai-ui-guard-test.mjs — 前端 AI 接线契约守卫（静态）
 * ============================================================
 * 为什么需要：这个会话没有浏览器可视复核条件，而「按钮点了没反应」「类没定义
 * 所以样式全丢」这类问题静态可查、且最容易漏。本脚本把这类契约钉死。
 *
 * 用法：node ai/ai-ui-guard-test.mjs
 * 退出码：0 全通过 / 1 有失败
 * ============================================================ */
import { readFileSync } from "node:fs";

const R = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const jsRaw = R("../personal-workbench.js");
const cfg = R("../personal-workbench.config.js");
const css = R("../personal-workbench.css");
const html = R("../personal-workbench.html");
const beIndex = R("../backend/src/index.js");
const beAiRaw = R("../backend/src/ai.js");
const beDb = R("../backend/src/db.js");

// 去注释后再做「含/不含」判断 —— 否则注释里提到 "UPDATE bid_project" 会造成假失败
// （本脚本第一版就踩了这个坑：把注释当代码判）。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");   // 避开 http:// 这类
}
const js = stripComments(jsRaw);
const beAi = stripComments(beAiRaw);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${extra ? "  → " + extra : ""}`); }
}

console.log("\n=== 前端 AI 接线契约守卫 ===\n");

/* ---------- 1. App.* 方法与 return 对象的一致性 ---------- */
console.log("[1] App.* 方法契约（防「按钮点了没反应」）");
// 从 window.App 往前找最后一个 return { —— 比正则配平可靠（注释里也有 return {）
const appIdx = js.indexOf("window.App = App;");
const retIdx = js.lastIndexOf("return {", appIdx);
check("能在 window.App 之前定位 return 块", appIdx > 0 && retIdx > 0);
const retBody = retIdx > 0 && appIdx > retIdx ? js.slice(retIdx, appIdx) : "";
let exposed = new Set();
for (const part of retBody.replace(/^\s*return\s*\{/, "").split(",")) {
  const p = part.trim();
  if (!p) continue;
  const key = p.includes(":") ? p.slice(0, p.indexOf(":")).trim() : p;
  if (/^[A-Za-z_$][\w$]*$/.test(key)) exposed.add(key);
}
check(`解析出至少 20 个已暴露方法（实际 ${exposed.size}）`, exposed.size >= 20);
const refs = new Set();
for (const m of (js + html).matchAll(/App\.([A-Za-z_$][\w$]*)\s*\(/g)) refs.add(m[1]);
const missing = [...refs].filter((r) => !exposed.has(r));
check(`代码/HTML 里引用的 ${refs.size} 个 App 方法都已暴露`, missing.length === 0, `缺失：${missing.join(", ")}`);

const AI_METHODS = ["aiParse", "aiCheck", "aiApply", "aiIgnore", "aiCopyHint", "aiPurge",
  "aiPickFile", "aiFileChosen", "aiLoadExisting"];
for (const m of AI_METHODS) {
  check(`App.${m} 已定义`, new RegExp(`function\\s+${m}\\s*\\(`).test(js));
  check(`App.${m} 已暴露给内联 onclick`, exposed.has(m));
}

/* ---------- 2. Store 的 AI 方法 ---------- */
console.log("\n[2] Store AI 方法");
for (const m of ["aiSubmit", "aiGet", "aiList", "aiPendingCount", "aiAdopt", "aiIgnore", "aiRemove", "aiPurge"]) {
  check(`Store.${m} 已定义`, new RegExp(`\\b${m}\\s*\\(`).test(js));
}
check("每个 Store.ai* 方法都打向 /ai-jobs（不会误写业务表）", (() => {
  const names = ["aiSubmit", "aiGet", "aiList", "aiPendingCount", "aiAdopt", "aiIgnore", "aiRemove", "aiPurge"];
  const bad = names.filter((m) => {
    const i = js.indexOf(`${m}(`);
    return i < 0 || !js.slice(i, i + 240).includes("/ai-jobs");
  });
  return bad.length === 0;
})(), "有方法未指向 /ai-jobs");

/* ---------- 3. DOM id 契约 ---------- */
console.log("\n[3] DOM id 契约");
const ids = ["aiStatus", "aiSugBox"];
for (const id of ids) {
  check(`id="${id}" 在 PASTE_PANEL 中渲染`, js.includes(`id="${id}"`));
  check(`getElementById("${id}") 有对应使用`, js.includes(`getElementById("${id}")`));
}
check("建议行用 data-ai-idx 索引（模板与读取两端一致）",
  js.includes('data-ai-idx="${i}"') && js.includes('input[type=checkbox][data-ai-idx]'));

/* ---------- 4. CSS 类契约（防样式全丢） ---------- */
console.log("\n[4] CSS 类契约");
const AI_CLASSES = ["ai-bar", "ai-note", "ai-actions", "ai-sug", "ai-sug-head", "ai-sug-list",
  "ai-row", "no-check", "ai-f", "ai-v", "ai-ev", "ai-conf", "ai-flag", "ai-dropped"];
for (const c of AI_CLASSES) {
  check(`.${c} 已在 CSS 定义`, new RegExp(`\\.${c}\\s*[,{:.]`).test(css));
}
check("AI 类有浅色主题覆盖", /html\[data-theme="light"\]\s+\.ai-row/.test(css));

/* ---------- 5. 三档降级：正则通道仍在 ---------- */
console.log("\n[5] 三档降级（AI 挂了不影响现有功能）");
check("parseTenderText 仍存在", /function\s+parseTenderText\s*\(/.test(js));
check("parseFill（纯正则按钮）仍存在且仍是同步函数", /function\s+parseFill\s*\(/.test(js));
check("「识别填写」按钮仍在", js.includes("App.parseFill()"));
check("「AI 解析」按钮已加入", js.includes("App.aiParse()"));
check("applyFieldValues 供两条通道复用", /function\s+applyFieldValues\s*\(/.test(js));
check("金额字段（budget/bond/bidPrice）按万元回填", /AI_MONEY_KEYS\s*=\s*\[\s*"budget"\s*,\s*"bond"\s*,\s*"bidPrice"\s*\]/.test(js));

/* ---------- 6. 表单字段一致性 ---------- */
console.log("\n[6] 字段契约（AI 建议字段必须能在表单里找到）");
const formKeys = new Set();
const baseFields = /const BASE_PROJECT_FIELDS\s*=\s*\[([\s\S]*?)\n\s*\];/.exec(js);
if (baseFields) for (const m of baseFields[1].matchAll(/\[\s*"(\w+)"/g)) formKeys.add(m[1]);
const AI_FIELDS = ["name", "tenderNo", "lotNo", "tenderer", "agency", "region", "duration", "industry",
  "category", "contactName", "contactPhone", "notes", "budget", "bond", "deadline", "registerTime", "validityDays"];
const noField = AI_FIELDS.filter((f) => !formKeys.has(f));
check(`后端允许的 ${AI_FIELDS.length} 个字段在表单里都有控件`, noField.length === 0, `缺失：${noField.join(", ")}`);
check("表单里存在 bidPrice（后端白名单故意排除，前端仍可手填）", formKeys.has("bidPrice"));

/* ---------- 7. 备注走「追加」而不是覆盖 ---------- */
console.log("\n[7] 备注语义");
check("notes 走追加分支", /if\s*\(s\.field\s*===\s*"notes"\)\s*\{\s*notesParts\.push/.test(js));
check("备注是拼接而非赋值覆盖", /el\.value\s*=\s*el\.value\.trim\(\)\s*\?\s*el\.value\.trim\(\)\s*\+\s*"\\n\\n"\s*\+\s*add\s*:\s*add/.test(js));

/* ---------- 8. 落库后标记已采用 ---------- */
console.log("\n[8] 采用链路");
check("新增成功后调用 aiAdopt", /Store\.aiAdopt\(aiJob\.id,\s*created\.id\)/.test(js));
check("仅在真的填入过建议时才标记", /aiJob\s*&&\s*aiJob\.applied\s*>\s*0/.test(js));
check("关弹窗时丢弃未采纳的 AI 会话", /function closeForm\(\)[\s\S]{0,200}aiJob\s*=\s*null/.test(js));
check("关闭弹窗会停止轮询", /stopAiPoll\(\)/.test(js));

/* ---------- 9. 后端契约 ---------- */
console.log("\n[9] 后端契约");
check("index.js 挂载 /api/v1/ai-jobs", beIndex.includes('"/api/v1/ai-jobs"'));
for (const r of ["pending-count", "purge"]) {
  check(`ai.js 有 /${r} 路由`, beAi.includes(`"/${r}"`));
}
check("pending-count 注册在 /:id 之前（否则会被吃掉）",
  beAi.indexOf('"/pending-count"') < beAi.indexOf('"/:id"'));
check("SCHEMA_VERSION 已到 6", /SCHEMA_VERSION\s*=\s*6/.test(beDb));
check("v6 迁移幂等（先 hasColumn 再 ALTER）",
  /to:\s*6[\s\S]{0,220}hasColumn\("ai_job",\s*"dropped_json"\)/.test(beDb));
check("金额归一为元的闸门存在（normMoney）", /function\s+normMoney\s*\(/.test(beAi));
check("category 非枚举不静默回退", /value_not_in_enum/.test(beAi) && !/out\.category\s*!==\s*null[\s\S]{0,80}其他/.test(beAi));

/* ---------- 10. 分享包安全 ---------- */
console.log("\n[10] 分享包安全");
const cfgLow = cfg.toLowerCase();
for (const bad of ["apikey", "api_key", "secret", "token", "sk-"]) {
  check(`config.js 不含 ${bad}`, !cfgLow.includes(bad));
}
check("前端不含 provider/baseURL 之类的密钥配置", !/OPENAI|DEEPSEEK_API|LLM_KEY/i.test(js));
check("版本号已 bump（不是引入 AI 之前的 2026-09-11i）", /VERSION:\s*"2026-\d\d-\d\d[a-z]"/.test(cfg) && !/VERSION:\s*"2026-09-11i"/.test(cfg));

/* ---------- 11. 只读检查：AI 不直写业务表 ---------- */
console.log("\n[11] 核心保证：AI 不直写业务表");
check("ai.js 不引用 bid_project 写入", !/INSERT INTO bid_project|UPDATE bid_project|DELETE FROM bid_project/.test(beAi));
check("ai.js 不导入 projects.js", !/from\s+"\.\/projects\.js"/.test(beAi));
check("ai.js 只写 ai_job / ai_suggestion", !/INSERT INTO (?!ai_)/.test(beAi));

/* ---------- 12. 金额往返（拿源码里的真函数求值，不靠推断） ---------- */
console.log("\n[12] 金额往返（AI 给的「元」→ 表单「万元」→ 保存回「元」）");
const wanToYuanExpr = /const wanToYuan = (\([\s\S]*?\) => [^;]+);/.exec(js);
const yuanToWanExpr = /const yuanToWan = (\([\s\S]*?\) => [^;]+);/.exec(js);
check("能从源码提取 wanToYuan / yuanToWan", !!wanToYuanExpr && !!yuanToWanExpr);
if (wanToYuanExpr && yuanToWanExpr) {
  const wanToYuan = new Function(`return (${wanToYuanExpr[1]})`)();
  const yuanToWanFn = new Function(`return (${yuanToWanExpr[1]})`)();
  const roundTrip = (yuan) => wanToYuan(yuanToWanFn(yuan));
  check("预算 32600000 元 往返不变", roundTrip(32600000) === 32600000, String(roundTrip(32600000)));
  check("保证金 300000 元 往返不变", roundTrip(300000) === 300000, String(roundTrip(300000)));
  check("1 元 往返不变（万元小数不被截断）", roundTrip(1) === 1, String(roundTrip(1)));
  check("表单显示万元：32600000 元 → 3260", yuanToWanFn(32600000) === 3260, String(yuanToWanFn(32600000)));
  check("空值不产生 NaN", yuanToWanFn(null) === "" && wanToYuan("") === null);
}

/* ---------- 13. 调用参数个数（曾因少传 1 个参数导致建议列表一行都不渲染） ---------- */
console.log("\n[13] 本地函数调用参数个数（arity lint）");
// 取 open 处 "(" 到配对 ")" 之间的实参文本（引号/括号感知）
function sliceArgs(src, open) {
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}
function countArgs(argStr) {
  if (argStr === null) return -1;                 // 没配平 → 放弃判断
  const s = argStr.trim();
  if (!s) return 0;
  let depth = 0, q = null, n = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (q) { if (c === q && p !== "\\") q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) n++;
  }
  return n;
}
// 收集 function 声明的「必需参数」个数（有默认值或 ...rest 的不算必需）
const required = new Map();
const declIdx = new Map();
for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
  const need = m[2].split(",").map((s) => s.trim()).filter(Boolean)
    .filter((p) => !p.includes("=") && !p.startsWith("...")).length;
  required.set(m[1], need);
  declIdx.set(m[1], m.index + m[0].indexOf("("));
}
const arityProblems = [];
// 同名局部函数会遮蔽外层 function（如 askCompleteTask 里的 `const notify = () => …`
// 遮蔽了通知用的 function notify(title, body)）。本 lint 不做作用域跟踪，
// 因此凡是被 const/let/var 重新声明过的名字一律跳过（并如实报出跳过了几个）。
const shadowed = new Set();
for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) shadowed.add(m[1]);
let skipShadowed = 0;
for (const [name, need] of required) {
  if (shadowed.has(name)) { skipShadowed++; continue; }
  const re = new RegExp(`(^|[^.\\w$])${name}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(js))) {
    const open = m.index + m[0].length - 1;
    if (open === declIdx.get(name)) continue;      // 跳过声明本身
    const got = countArgs(sliceArgs(js, open));
    if (got >= 0 && got < need) arityProblems.push(`${name}() 传 ${got} 个、需 ${need} 个`);
  }
}
check(`本地函数调用参数个数都够（检查 ${required.size - skipShadowed} 个声明，跳过 ${skipShadowed} 个被同名局部变量遮蔽的）`,
  arityProblems.length === 0, arityProblems.slice(0, 6).join("；"));
// 钉住这次的真实故障：renderAiSuggestions 必须在只传 job 时也能取到建议
check("renderAiSuggestions 兜底到 job.suggestions（不再依赖调用方传第二参）",
  /const items = list \|\| job\.suggestions \|\| \[\]/.test(js));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail) { console.log("失败项：\n  - " + failures.join("\n  - ")); process.exit(1); }
