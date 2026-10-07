/* ============================================================
 * ai-extract-test.mjs — AI 助手暂存队列断言测试
 * ============================================================
 * 设计依据：ai-assist-design.md §9.2（11 条断言）
 *
 * 用法（在 backend 同级或任意目录均可）：
 *   node ai/ai-extract-test.mjs
 *   $env:AI_TEST_BASE="http://127.0.0.1:8791/api/v1"; node ai/ai-extract-test.mjs
 *
 * 建议：指向一个用独立 DB_PATH 启动的测试实例，避免污染真实库：
 *   $env:PORT=8791; $env:DB_PATH="<...>\backend\data\_ai-test.db"; node src/index.js
 * ============================================================ */
const BASE = process.env.AI_TEST_BASE || "http://127.0.0.1:8787/api/v1";

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${extra ? "  → " + extra : ""}`); }
}

async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body) init.headers = { "content-type": "application/json", ...(init.headers || {}) };
  const res = await fetch(BASE + path, init);
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, json };
}

const created = [];   // 测试产生的 job id，跑完清理

async function main() {
  console.log(`\n=== AI 暂存队列断言测试 @ ${BASE} ===\n`);

  // ---------- 0. 连通性 ----------
  const health = await api("/health");
  if (health.status !== 200) {
    console.log(`后端不可达（${health.status}），无法继续。`);
    process.exit(1);
  }
  console.log("[0] 连通性");
  check("GET /health 返回 200", health.status === 200);

  // ---------- 1. 提交 ----------
  console.log("\n[1] 提交待解析文本");
  const noticeText = `某市第二人民医院门诊楼改造工程监理服务项目
招标编号：GXZB2026-0233
招标人：某市第二人民医院　　招标代理：国信招标集团
最高限价：人民币壹亿贰仟万元整（12000万元）
投标保证金：20万元
投标有效期：90天
投标文件递交截止时间：2026年10月12日9:30
二、投标人资格要求：工程监理综合资质甲级，近三年不少于2个同类业绩；不接受联合体。`;

  const submitA = await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: noticeText, sourceName: "测试公告A" }) });
  check("POST /ai-jobs 返回 201", submitA.status === 201, `实际 ${submitA.status}`);
  const jobA = submitA.json?.data;
  check("新任务 status = 待解析", jobA?.status === "待解析", `实际 ${jobA?.status}`);
  check("新任务 engine = dsh", jobA?.engine === "dsh", `实际 ${jobA?.engine}`);
  check("新任务 deduped = false", jobA?.deduped === false);
  if (jobA?.id) created.push(jobA.id);

  // ---------- 2. 幂等去重 ----------
  console.log("\n[2] 重复提交同一文本 → 幂等去重");
  const submitA2 = await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: noticeText, sourceName: "测试公告A" }) });
  check("重复提交返回 200（非新建）", submitA2.status === 200, `实际 ${submitA2.status}`);
  check("deduped = true", submitA2.json?.data?.deduped === true);
  check("返回同一个 id", submitA2.json?.data?.id === jobA?.id, `${submitA2.json?.data?.id} vs ${jobA?.id}`);

  // ---------- 3. 校验：空文本 / 非法 kind ----------
  console.log("\n[3] 入参校验");
  const empty = await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "   " }) });
  check("空文本被拒（400）", empty.status === 400, `实际 ${empty.status}`);
  const badKind = await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "x", kind: "不存在的类型" }) });
  check("非法 kind 被拒（400）", badKind.status === 400, `实际 ${badKind.status}`);

  // ---------- 4. 回写批量替换 + 逐条归一与校验 ----------
  console.log("\n[4] 回写建议（白名单 / 金额归一 / 枚举 / 日期）");
  const longText = "长".repeat(300);
  const wb1 = await api(`/ai-jobs/${jobA.id}/suggestions`, {
    method: "POST",
    body: JSON.stringify({
      schemaVersion: 1, engine: "dsh",
      suggestions: [
        { field: "name", value: "某市第二人民医院门诊楼改造工程监理服务", confidence: "high", evidence: "某市第二人民医院门诊楼改造工程监理服务项目" },
        { field: "tenderNo", value: "GXZB2026-0233", confidence: "high", evidence: "招标编号：GXZB2026-0233" },
        { field: "tenderer", value: "某市第二人民医院", confidence: "high", evidence: "招标人：某市第二人民医院" },
        { field: "budget", value: 12000, unit: "万元", confidence: "high", evidence: "最高限价：人民币壹亿贰仟万元整（12000万元）" },
        { field: "bond", value: 20, unit: "万元", confidence: "medium", evidence: "投标保证金：20万元" },
        { field: "validityDays", value: 90, confidence: "high", evidence: "投标有效期：90天" },
        { field: "category", value: "工程监理", confidence: "high", evidence: "工程监理综合资质甲级" },
        { field: "industry", value: "市政公用工程", confidence: "medium", evidence: "门诊楼改造" },
        { field: "notes", value: "资质要求：工程监理综合资质甲级，近三年≥2个同类业绩；不接受联合体。", confidence: "high", evidence: "二、投标人资格要求…" },
        // ---- 以下应被丢弃 ----
        { field: "deadline", value: "2026/10/12", confidence: "high", evidence: "2026年10月12日" },
        { field: "openTime", value: "2026-10-12", confidence: "high", evidence: "开标时间" },
        { field: "bidPrice", value: 123, confidence: "low", evidence: "报价" },
        { field: "status", value: "中标", confidence: "low", evidence: "中标" },
        { field: "projectCode", value: "PRJ-2026-999", confidence: "low", evidence: "编号" },
        { field: "category", value: "随便写的类别", confidence: "low", evidence: "类别" },
        { field: "lotNo", value: longText, confidence: "low", evidence: "标段" },
      ],
    }),
  });
  check("回写返回 200", wb1.status === 200, `实际 ${wb1.status}`);
  const d1 = wb1.json?.data;
  check("接受 9 条", d1?.accepted === 9, `实际 ${d1?.accepted}`);
  check("丢弃 7 条", d1?.dropped?.length === 7, `实际 ${d1?.dropped?.length}`);

  const reasonOf = (list, field) => (list || []).filter((x) => x.field === field).map((x) => x.reason);
  const sugMap = {};
  for (const s of d1?.suggestions || []) sugMap[s.field] = s;

  check("金额 12000 万元 → 120000000 元", sugMap.budget?.value === "120000000", `实际 ${sugMap.budget?.value}`);
  check("金额 20 万元 → 200000 元", sugMap.bond?.value === "200000", `实际 ${sugMap.bond?.value}`);
  check("金额保留原始单位留痕", sugMap.budget?.unit === "万元", `实际 ${sugMap.budget?.unit}`);
  check("validityDays 归一为 90", sugMap.validityDays?.value === "90", `实际 ${sugMap.validityDays?.value}`);
  check("category 命中枚举被接受", sugMap.category?.value === "工程监理", `实际 ${sugMap.category?.value}`);
  check("openTime 被白名单拒绝", reasonOf(d1?.dropped, "openTime").includes("field_not_allowed"), JSON.stringify(reasonOf(d1?.dropped, "openTime")));
  check("bidPrice 被白名单拒绝", reasonOf(d1?.dropped, "bidPrice").includes("field_not_allowed"));
  check("status 被白名单拒绝", reasonOf(d1?.dropped, "status").includes("field_not_allowed"));
  check("projectCode 被白名单拒绝", reasonOf(d1?.dropped, "projectCode").includes("field_not_allowed"));
  check("category 非枚举被丢弃（不得静默回退其他）", reasonOf(d1?.dropped, "category").includes("value_not_in_enum"), JSON.stringify(reasonOf(d1?.dropped, "category")));
  check("日期 2026/10/12 被拒（必须 YYYY-MM-DD）", reasonOf(d1?.dropped, "deadline").includes("invalid_date_expected_YYYY-MM-DD"));
  check("超长值被拒", reasonOf(d1?.dropped, "lotNo").includes("value_too_long"));
  check("evidence 原文片段被保留", !!sugMap.name?.evidence, `实际 ${sugMap.name?.evidence}`);
  check("回写后 status = 已建议", wb1.json?.data?.job?.status === "已建议", `实际 ${wb1.json?.data?.job?.status}`);

  // ---------- 5. 覆盖语义（同 job 再次回写） ----------
  console.log("\n[5] 重复回写 → 整批替换（无陈旧建议残留）");
  await api(`/ai-jobs/${jobA.id}/suggestions`, {
    method: "POST",
    body: JSON.stringify({ suggestions: [{ field: "name", value: "改后的名称", confidence: "high", evidence: "x" }, { field: "budget", value: 1, unit: "元", confidence: "high", evidence: "1元" }] }),
  });
  const detailA = await api(`/ai-jobs/${jobA.id}`);
  check("建议数变为 2（不是 9+2=11）", detailA.json?.data?.suggestions?.length === 2, `实际 ${detailA.json?.data?.suggestions?.length}`);
  check("同字段被覆盖为新值", detailA.json?.data?.suggestions?.find((s) => s.field === "name")?.value === "改后的名称");
  check("旧字段（tenderNo）已移除", !detailA.json?.data?.suggestions?.some((s) => s.field === "tenderNo"));

  // ---------- 6. 金额单位边界 ----------
  console.log("\n[6] 金额单位边界（防 100万→100元 事故）");
  const jobB = (await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "单位边界测试文本-预算 5000" }) })).json?.data;
  if (jobB?.id) created.push(jobB.id);

  const noUnit = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: 5000, confidence: "high", evidence: "预算金额：5000" }] }),
  });
  check("unit 缺失且出处无单位 → 丢弃 unit_missing", noUnit.json?.data?.dropped?.[0]?.reason === "unit_missing", JSON.stringify(noUnit.json?.data?.dropped));
  check("丢弃时不落库任何建议", noUnit.json?.data?.accepted === 0);

  const evUnit = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: 5000, unit: "元", confidence: "high", evidence: "预算金额：5000元" }] }),
  });
  check("unit=元 → 原值 5000", evUnit.json?.data?.suggestions?.[0]?.value === "5000", `实际 ${evUnit.json?.data?.suggestions?.[0]?.value}`);

  const badUnit = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: 5, unit: "百万", confidence: "high", evidence: "预算：5百万" }] }),
  });
  check("unit 认不出（百万）→ 丢弃 unit_unrecognized", badUnit.json?.data?.dropped?.[0]?.reason === "unit_unrecognized", JSON.stringify(badUnit.json?.data?.dropped));

  const yiUnit = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: 1.2, unit: "亿元", confidence: "high", evidence: "最高限价：1.2亿元" }] }),
  });
  check("unit=亿元 → 120000000", yiUnit.json?.data?.suggestions?.[0]?.value === "120000000", `实际 ${yiUnit.json?.data?.suggestions?.[0]?.value}`);

  const negative = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: -100, unit: "元", confidence: "high", evidence: "-100元" }] }),
  });
  check("负数金额被丢弃", negative.json?.data?.accepted === 0, JSON.stringify(negative.json?.data?.dropped));

  const cnNum = await api(`/ai-jobs/${jobB.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "budget", value: "壹亿贰仟万", unit: "元", confidence: "high", evidence: "壹亿贰仟万元" }] }),
  });
  check("中文大写金额不猜（要求阿拉伯数字）", cnNum.json?.data?.dropped?.[0]?.reason === "value_not_number", JSON.stringify(cnNum.json?.data?.dropped));

  // ---------- 7. 条数上限 ----------
  console.log("\n[7] 回写条数上限");
  const many = Array.from({ length: 31 }, (_, i) => ({ field: "name", value: `n${i}`, confidence: "low", evidence: "x" }));
  const over = await api(`/ai-jobs/${jobB.id}/suggestions`, { method: "POST", body: JSON.stringify({ suggestions: many }) });
  check("31 条被拒（400）", over.status === 400, `实际 ${over.status}`);
  const nonArray = await api(`/ai-jobs/${jobB.id}/suggestions`, { method: "POST", body: JSON.stringify({ suggestions: "not-an-array" }) });
  check("suggestions 非数组被拒（400）", nonArray.status === 400, `实际 ${nonArray.status}`);

  // ---------- 8. 业务表零影响（本设计的核心保证） ----------
  console.log("\n[8] AI 全程未写业务表");
  const projBefore = (await api("/projects?page=1&pageSize=1")).json?.data?.total;
  await api(`/ai-jobs/${jobA.id}/suggestions`, {
    method: "POST", body: JSON.stringify({ suggestions: [{ field: "name", value: "AI 不该直接建项目", confidence: "high", evidence: "x" }] }),
  });
  const projAfter = (await api("/projects?page=1&pageSize=1")).json?.data?.total;
  check("投标项目总数未变", projBefore === projAfter, `${projBefore} → ${projAfter}`);
  const stillAbsent = (await api("/projects?q=AI 不该直接建项目&pageSize=5")).json?.data?.total;
  check("回写的名称未被自动落库", stillAbsent === 0, `实际 ${stillAbsent}`);

  // ---------- 9. 队列查询 ----------
  console.log("\n[9] 队列查询（skill 消费入口）");
  const pending = await api("/ai-jobs?status=待解析");
  check("GET /ai-jobs?status=待解析 返回 200", pending.status === 200);
  check("列表项含 inputPreview 与 suggestionCount", pending.json?.data?.list?.every((x) => "inputPreview" in x && "suggestionCount" in x));
  const count = await api("/ai-jobs/pending-count");
  check("pending-count 返回数字", typeof count.json?.data?.pending === "number", JSON.stringify(count.json?.data));
  check("pending-count 未被 /:id 路由吃掉", count.status === 200, `实际 ${count.status}`);

  // ---------- 10. 采用：状态 + 隐私清理 + 审计 ----------
  console.log("\n[10] 采用 / 隐私清理 / 审计");
  const adopt = await api(`/ai-jobs/${jobA.id}/adopt`, { method: "POST", body: JSON.stringify({ projectId: null }) });
  check("adopt 返回 200", adopt.status === 200, `实际 ${adopt.status}`);
  check("status = 已采用", adopt.json?.data?.status === "已采用", `实际 ${adopt.json?.data?.status}`);
  check("textPurged = true", adopt.json?.data?.textPurged === true);
  const detailAfter = await api(`/ai-jobs/${jobA.id}`);
  check("原文已清空（inputText 为 null）", detailAfter.json?.data?.inputText === null, `实际 ${JSON.stringify(detailAfter.json?.data?.inputText)?.slice(0, 40)}`);
  check("建议仍保留（便于回看用了什么）", (detailAfter.json?.data?.suggestions?.length || 0) > 0);

  const logs = await api("/audit-logs?action=ai_adopt&limit=5");
  check("audit_log 记录 ai_adopt", (logs.json?.data?.total || 0) >= 1, `total=${logs.json?.data?.total}`);
  const logsSuggest = await api("/audit-logs?action=ai_suggest&limit=5");
  check("audit_log 记录 ai_suggest", (logsSuggest.json?.data?.total || 0) >= 1, `total=${logsSuggest.json?.data?.total}`);

  // ---------- 11. 忽略 / 删除 ----------
  console.log("\n[11] 忽略与删除");
  const jobC = (await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "忽略测试文本-zzz" }) })).json?.data;
  const ignore = await api(`/ai-jobs/${jobC.id}/ignore`, { method: "POST" });
  check("ignore 后 status = 已忽略", ignore.json?.data?.status === "已忽略", `实际 ${ignore.json?.data?.status}`);
  check("ignore 后原文也清空", ignore.json?.data?.textPurged === true);

  const del = await api(`/ai-jobs/${jobC.id}`, { method: "DELETE" });
  check("DELETE 返回 200", del.status === 200, `实际 ${del.status}`);
  const gone = await api(`/ai-jobs/${jobC.id}`);
  check("删除后详情 404", gone.status === 404, `实际 ${gone.status}`);

  // ---------- 12. 丢弃明细持久化（界面要能解释「某字段为什么没有」） ----------
  console.log("\n[12] 丢弃明细持久化");
  const jobD = (await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "丢弃明细测试-qqq" }) })).json?.data;
  if (jobD?.id) created.push(jobD.id);
  await api(`/ai-jobs/${jobD.id}/suggestions`, {
    method: "POST",
    body: JSON.stringify({ suggestions: [
      { field: "name", value: "正常字段", confidence: "high", evidence: "x" },
      { field: "budget", value: 100, confidence: "high", evidence: "100" },          // unit_missing
      { field: "category", value: "不存在", confidence: "low", evidence: "x" },       // value_not_in_enum
    ] }),
  });
  const detailD = await api(`/ai-jobs/${jobD.id}`);
  const droppedD = detailD.json?.data?.dropped || [];
  check("丢弃明细随详情返回（不只在回写响应里）", droppedD.length === 2, `实际 ${droppedD.length}`);
  check("丢弃原因被完整保存", droppedD.some((d) => d.reason === "unit_missing") && droppedD.some((d) => d.reason === "value_not_in_enum"), JSON.stringify(droppedD));

  // ---------- 13. 批量清理（隐私清理入口） ----------
  console.log("\n[13] 批量清理");
  const jobKeep = (await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "清理测试-待处理-keep" }) })).json?.data;
  if (jobKeep?.id) created.push(jobKeep.id);
  const jobDrop = (await api("/ai-jobs", { method: "POST", body: JSON.stringify({ inputText: "清理测试-已忽略-drop" }) })).json?.data;
  await api(`/ai-jobs/${jobDrop.id}/ignore`, { method: "POST" });

  const purge = await api("/ai-jobs/purge", { method: "POST", body: JSON.stringify({ statuses: ["已忽略"] }) });
  check("purge 返回 200", purge.status === 200, `实际 ${purge.status}`);
  check("purge 删除了已忽略任务", (purge.json?.data?.deleted || 0) >= 1, `实际 ${purge.json?.data?.deleted}`);
  const keepAlive = await api(`/ai-jobs/${jobKeep.id}`);
  check("待解析任务未被误删", keepAlive.status === 200, `实际 ${keepAlive.status}`);
  const badPurge = await api("/ai-jobs/purge", { method: "POST", body: JSON.stringify({ statuses: ["不存在的状态"] }) });
  check("purge 非法 status 被拒（400）", badPurge.status === 400, `实际 ${badPurge.status}`);
  const logsPurge = await api("/audit-logs?action=ai_purge&limit=5");
  check("audit_log 记录 ai_purge", (logsPurge.json?.data?.total || 0) >= 1, `total=${logsPurge.json?.data?.total}`);

  // ---------- 清理测试数据 ----------
  for (const id of created) await api(`/ai-jobs/${id}`, { method: "DELETE" });
  const leftOver = await api("/ai-jobs?status=待解析&pageSize=100");
  const residue = (leftOver.json?.data?.list || []).filter((x) => (x.inputPreview || "").includes("边界测试") || (x.inputPreview || "").includes("改后的名称"));
  for (const r of residue) await api(`/ai-jobs/${r.id}`, { method: "DELETE" });
  console.log(`\n[清理] 已删除测试任务 ${created.length} 个${residue.length ? " + 残留 " + residue.length + " 个" : ""}`);

  // ---------- 汇总 ----------
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (fail) { console.log("失败项：\n  - " + failures.join("\n  - ")); process.exit(1); }
}

main().catch((e) => { console.error("\n测试脚本异常：", e); process.exit(1); });
