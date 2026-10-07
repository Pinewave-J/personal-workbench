/* ============================================================
 * ai-ui-behavior-test.mjs — AI 建议区的行为测试（跑真实函数，带假 DOM）
 * ============================================================
 * 为什么需要：`ai-ui-guard-test.mjs` 是静态检查，只验证「函数存在 / DOM id / CSS 类」，
 * 查不出「声明了 2 个参数却只用 1 个参数调用」这类错误。
 * 曾因此出现真实故障：renderAiSuggestions(job) 只传 1 参 → items 恒为空
 * → 建议列表一行都不渲染 → 用户看到「没有可用的字段建议」，项目名称自然填不上。
 *
 * 本测试从源码里抽出真实函数（renderAiSuggestions / aiApply / applyFieldValues），
 * 配一套最小假 DOM 运行，断言「渲染出行数」与「值真的落进了输入框」。
 *
 * 用法：node ai/ai-ui-behavior-test.mjs      退出码 0 通过 / 1 失败
 * ============================================================ */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../personal-workbench.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${extra ? "  → " + extra : ""}`); }
}

/* ---------- 从源码抽出真实函数（花括号配平；${} 与量词 {} 都是配对的） ---------- */
function extractFunction(source, name) {
  let start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`源码里找不到 ${name}`);
  // 必须连 async 一起截取，否则抽出来的 async 函数体里 await 会变成非法语法
  if (/async\s+$/.test(source.slice(0, start))) start = source.lastIndexOf("async", start);
  let i = source.indexOf("{", start), depth = 0, end = -1;
  for (let j = i; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error(`${name} 花括号不配平`);
  return source.slice(start, end + 1);
}

const renderSrc = extractFunction(src, "renderAiSuggestions");
const applySrc = extractFunction(src, "aiApply");
const fillSrc = extractFunction(src, "applyFieldValues");

/* ---------- 最小假 DOM ---------- */
function makeHarness() {
  const inputs = {};                       // f_<field> → { value }
  let cachedHtml = null, cachedBoxes = [];
  const box = {
    innerHTML: "",
    // 从渲染出的 innerHTML 反解出复选框。关键：innerHTML 不变时**返回同一批对象**，
    // 模拟真实 DOM 的元素同一性 —— 否则测试里改 checked 会在下次查询时丢失
    // （第一版就踩了这个：明明取消了勾选，aiApply 重新查询又拿到"勾着"的新对象）。
    querySelectorAll() {
      if (cachedHtml === box.innerHTML) return cachedBoxes;
      cachedHtml = box.innerHTML;
      cachedBoxes = [];
      const re = /<input type="checkbox" data-ai-idx="(\d+)"(\s+checked)?\s*\/>/g;
      let m;
      while ((m = re.exec(box.innerHTML))) cachedBoxes.push({ checked: !!m[2], dataset: { aiIdx: m[1] } });
      return cachedBoxes;
    },
  };
  const document = {
    getElementById(id) {
      if (id === "aiSugBox") return box;
      if (id === "aiStatus") return { textContent: "" };
      if (id.startsWith("f_")) {
        const k = id.slice(2);
        if (!inputs[k]) inputs[k] = { value: "", parentElement: null };
        return inputs[k];
      }
      return null;
    },
  };
  return { box, inputs, document };
}

/* ---------- 测试数据（14 条，覆盖金额 / 备注 / 低置信度） ---------- */
const SUGGESTIONS = [
  { field: "name", value: "某某新能源材料有限公司年产16万吨新能源材料项目及配套公辅项目委托监理服务", confidence: "high", evidence: "1 工程名称 某某新能源材料有限公司…" },
  { field: "tenderNo", value: "HZZB2026-0912", confidence: "high", evidence: "（项目编号：HZZB2026-0912）" },
  { field: "tenderer", value: "某某新能源材料有限公司", confidence: "high", evidence: "招标人：某某新能源材料有限公司" },
  { field: "agency", value: "某某项目管理有限公司", confidence: "high", evidence: "招标代理机构：某某项目管理有限公司" },
  { field: "region", value: "某某省·某某市", confidence: "medium", evidence: "3 建设地点 某某工业园区" },
  { field: "duration", value: "计划 2026年10月开工、2027年10月完工", confidence: "medium", evidence: "计划开工日期：2026 年 10 月；计划完工日期：2027 年 10 月" },
  { field: "industry", value: "新能源", confidence: "medium", evidence: "年产 16 万吨新能源材料项目…投资约 25 亿元" },
  { field: "category", value: "工程监理", confidence: "high", evidence: "…全过程的监理工作" },
  { field: "contactName", value: "王工", confidence: "medium", evidence: "联系人：王工" },
  { field: "contactPhone", value: "0571-0000000/13900000000", confidence: "medium", evidence: "联系电话：0571-0000000/13900000000" },
  { field: "bond", value: "70000", unit: "万元", confidence: "high", evidence: "人民币 7 万元" },
  { field: "validityDays", value: "90", confidence: "high", evidence: "投标有效期 90 日历天" },
  { field: "deadline", value: "2026-09-20", confidence: "medium", evidence: "开标时间：2026 年 9 月 20 日 09：00" },
  { field: "notes", value: "【资格要求】工程监理化工石油工程专业甲级资质…", confidence: "high", evidence: "*9 投标人资格要求" },
];
const LOW_ONE = { field: "lotNo", value: "标段二", confidence: "low", evidence: "本公告对应标段二" };

async function main() {
  console.log("\n=== AI 建议区行为测试（真实函数 + 假 DOM）===\n");

  /* ---------- 1. 只传 job（复现故障调用方式）必须渲染出全部建议 ---------- */
  console.log("[1] renderAiSuggestions 只传 1 个参数（故障复现点）");
  const h = makeHarness();
  const aiJob = { id: 38, suggestions: SUGGESTIONS, dropped: [], applied: 0 };
  const build = new Function(
    "document", "esc", "aiLabelOf", "yuanToWan", "AI_MONEY_KEYS", "aiSetStatus",
    `return { renderAiSuggestions: ${renderSrc}, aiApply: ${applySrc}, applyFieldValues: ${fillSrc} };`
  );
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const aiSetStatus = () => {};
  const aiLabelOf = (k) => ({ name: "项目名称", bond: "投标保证金（万元）", notes: "备注" }[k] || k);
  const yuanToWan = (v) => (v === null || v === undefined || v === "") ? "" : Number(v) / 10000;
  const AI_MONEY_KEYS = ["budget", "bond", "bidPrice"];
  const markAiField = () => {};
  const toast = () => {};

  const api1 = build(h.document, esc, aiLabelOf, yuanToWan, AI_MONEY_KEYS, aiSetStatus);
  api1.renderAiSuggestions({ id: 38, suggestions: SUGGESTIONS, dropped: [] });   // ← 故意只传 1 个参数

  const rows = (h.box.innerHTML.match(/data-ai-idx=/g) || []).length;
  check(`渲染出 ${SUGGESTIONS.length} 行建议`, rows === SUGGESTIONS.length, `实际 ${rows} 行`);
  check("没有误报「没有可用的字段建议」", !h.box.innerHTML.includes("没有可用的字段建议"));
  check("抬头显示建议条数 14", h.box.innerHTML.includes("建议 <b>14</b> 项"));
  check("项目名称的建议值出现在渲染结果里", h.box.innerHTML.includes("某某新能源材料有限公司"));
  check("带原文出处（evidence）", h.box.innerHTML.includes("原文："));
  check("「填入表单」按钮存在", h.box.innerHTML.includes("App.aiApply()"));

  /* ---------- 2. 无建议时必须走「无建议」分支（不能白屏） ---------- */
  console.log("\n[2] 空建议分支");
  const h2 = makeHarness();
  const api2 = build(h2.document, esc, aiLabelOf, yuanToWan, AI_MONEY_KEYS, aiSetStatus);
  api2.renderAiSuggestions({ id: 39, suggestions: [], dropped: [] });
  check("显示「没有可用的字段建议」", h2.box.innerHTML.includes("没有可用的字段建议"));
  check("空分支不留复选框", !h2.box.innerHTML.includes("data-ai-idx"));

  /* ---------- 3. low 置信度 / 无出处的默认不勾选 ---------- */
  console.log("\n[3] 默认勾选策略");
  const h3 = makeHarness();
  const api3 = build(h3.document, esc, aiLabelOf, yuanToWan, AI_MONEY_KEYS, aiSetStatus);
  const withLow = [...SUGGESTIONS, LOW_ONE, { field: "registerTime", value: "2026-09-01", confidence: "high" }];  // 后者无 evidence
  api3.renderAiSuggestions({ id: 40, suggestions: withLow, dropped: [] });
  const boxes = h3.box.querySelectorAll("");
  check(`渲染 ${withLow.length} 行`, boxes.length === withLow.length, `实际 ${boxes.length}`);
  check("high/medium 且有出处的默认勾选", boxes.filter((b) => b.checked).length === SUGGESTIONS.length, `勾选 ${boxes.filter((b) => b.checked).length}`);
  check("low 置信度默认不勾选（lotNo 是最后第 2 行）", boxes[SUGGESTIONS.length].checked === false);
  check("无 evidence 默认不勾选（registerTime 是最后一行）", boxes[withLow.length - 1].checked === false);
  check("未勾选行带 no-check 样式", (h3.box.innerHTML.match(/ai-row no-check/g) || []).length === 2);

  /* ---------- 4. aiApply：值必须真的落进输入框（用户问题的直接断言） ---------- */
  console.log("\n[4] aiApply 把值填进输入框（项目名称 / 金额换算 / 备注追加）");
  const h4 = makeHarness();
  const api4 = build(h4.document, esc, aiLabelOf, yuanToWan, AI_MONEY_KEYS, aiSetStatus);
  const job4 = { id: 38, suggestions: SUGGESTIONS, dropped: [], applied: 0 };
  api4.renderAiSuggestions(job4, job4.suggestions);
  // 预置：备注里已有用户自己的内容，验证是「追加」而不是覆盖
  h4.inputs["notes"] = { value: "我自己的备注", parentElement: null };
  // 用真实 applyFieldValues 让 aiApply 调用
  const applyFn = new Function(
    "document", "aiJob", "applyFieldValues", "markAiField", "toast",
    `return ${applySrc};`
  )(h4.document, job4, api4.applyFieldValues, markAiField, toast);
  applyFn();

  check("项目名称已填入 f_name", h4.inputs["name"]?.value === SUGGESTIONS[0].value, `实际 ${JSON.stringify(h4.inputs["name"]?.value)?.slice(0, 40)}`);
  check("招标编号已填入 f_tenderNo", h4.inputs["tenderNo"]?.value === "HZZB2026-0912");
  check("地区已填入 f_region", h4.inputs["region"]?.value === "某某省·某某市");
  check("截止日已填入 f_deadline", h4.inputs["deadline"]?.value === "2026-09-20");
  check("保证金 70000 元 → 表单显示 7（万元）", h4.inputs["bond"]?.value === 7, `实际 ${h4.inputs["bond"]?.value}`);
  check("有效性 90 已填入 f_validityDays", h4.inputs["validityDays"]?.value === "90");
  check("备注是追加而非覆盖", String(h4.inputs["notes"]?.value || "").startsWith("我自己的备注") && String(h4.inputs["notes"]?.value || "").includes("资格要求"), JSON.stringify(String(h4.inputs["notes"]?.value).slice(0, 30)));
  check("applied 计数 = 14（14 个字段全部勾选态）", job4.applied === 14, `实际 ${job4.applied}`);

  /* ---------- 5. aiApply 尊重取消勾选 ---------- */
  console.log("\n[5] 取消勾选后不应被填入");
  const h5 = makeHarness();
  const api5 = build(h5.document, esc, aiLabelOf, yuanToWan, AI_MONEY_KEYS, aiSetStatus);
  const job5 = { id: 41, suggestions: SUGGESTIONS, dropped: [], applied: 0 };
  api5.renderAiSuggestions(job5, job5.suggestions);
  const boxes5 = h5.box.querySelectorAll("");
  boxes5[0].checked = false;                       // 取消「项目名称」
  const applyFn5 = new Function("document", "aiJob", "applyFieldValues", "markAiField", "toast", `return ${applySrc};`)
    (h5.document, job5, api5.applyFieldValues, markAiField, toast);
  applyFn5();
  const nameGot = h5.inputs["name"]?.value;
  // 未勾选的字段应当「完全没被碰过」——通常是根本没被创建/赋值，而不是被填成空串
  check("取消勾选的项目名称未被填入", nameGot === undefined || nameGot === "", `实际 ${JSON.stringify(nameGot)}`);
  check("其余字段仍被填入", h5.inputs["tenderNo"]?.value === "HZZB2026-0912");
  check("applied 计数 = 13", job5.applied === 13, `实际 ${job5.applied}`);

  /* ---------- 6. B) 纯文本文件读入（readAiTextFile 是纯函数，直接测） ---------- */
  console.log("\n[6] 读取文本文件（B）");
  const readSrc = extractFunction(src, "readAiTextFile");
  // AI_TEXT_EXT 是模块级常量：从源码里取真值（而不是在测试里重写一份，避免两处漂移）
  const extSrc = /const AI_TEXT_EXT = (.+?);\s*\n/.exec(src);
  check("能从源码提取 AI_TEXT_EXT", !!extSrc);
  const AI_TEXT_EXT = new Function(`return ${extSrc[1]};`)();
  check("AI_TEXT_EXT 是正则且认得 .txt", AI_TEXT_EXT instanceof RegExp && AI_TEXT_EXT.test("a.txt"));
  const readAiTextFile = new Function("AI_TEXT_EXT", `return ${readSrc};`)(AI_TEXT_EXT);
  const fakeFile = (name, content) => ({ name, text: async () => content });

  const okTxt = await readAiTextFile(fakeFile("公告.txt", "项目名称：测试工程"));
  check("读 .txt 成功", okTxt.ok === true && okTxt.text === "项目名称：测试工程");
  const bom = await readAiTextFile(fakeFile("公告.txt", "\uFEFF项目名称：带BOM"));
  check("剥掉 UTF-8 BOM（PowerShell 写出的 txt 常见）", bom.ok === true && bom.text === "项目名称：带BOM", JSON.stringify(bom.text));
  const pdf = await readAiTextFile(fakeFile("招标文件.pdf", "%PDF-1.7 binary"));
  check("拒绝 .pdf 并给出明确原因", pdf.ok === false && pdf.reason === "not_text");
  const docx = await readAiTextFile(fakeFile("公告.docx", "PK"));
  check("拒绝 .docx", docx.ok === false && docx.reason === "not_text");
  const blank = await readAiTextFile(fakeFile("空.txt", "   \n  "));
  check("空文件被拒", blank.ok === false && blank.reason === "blank");
  const huge = await readAiTextFile(fakeFile("大.txt", "x".repeat(100001)));
  check("超长文件被拒并回报字数", huge.ok === false && huge.reason === "too_long" && huge.length === 100001);
  const md = await readAiTextFile(fakeFile("公告.md", "# 标题"));
  check(".md / .csv / .log / .json 也在允许列表", md.ok === true);
  const none = await readAiTextFile(null);
  check("未选文件被拒", none.ok === false && none.reason === "empty");

  /* ---------- 7. A) 载入已有建议的入口条 ---------- */
  console.log("\n[7] 载入队列里已有的建议（A）");
  const existSrc = extractFunction(src, "renderAiExisting");
  const h7 = makeHarness();
  const buildExist = new Function(
    "document", "esc", "aiExisting",
    `return { renderAiExisting: ${existSrc} };`
  );
  const jobs2 = [{ id: 38, suggestionCount: 14 }, { id: 41, suggestionCount: 3 }];
  buildExist(h7.document, esc, jobs2).renderAiExisting();
  check("列出 2 条可载入任务", (h7.box.innerHTML.match(/App\.aiLoadExisting\(/g) || []).length === 2, h7.box.innerHTML.slice(0, 80));
  check("带 job id 与建议条数", h7.box.innerHTML.includes("App.aiLoadExisting(38)") && h7.box.innerHTML.includes("14 条"));
  check("显示可载入条数提示", h7.box.innerHTML.includes("已有 <b>2</b> 条已解析的建议"));

  const h8 = makeHarness();
  buildExist(h8.document, esc, []).renderAiExisting();
  check("没有可载入任务时不渲染、不动容器", h8.box.innerHTML === "", JSON.stringify(h8.box.innerHTML));

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (fail) { console.log("失败项：\n  - " + failures.join("\n  - ")); process.exit(1); }
}

main().catch((e) => { console.error("\n测试异常：", e); process.exit(1); });
