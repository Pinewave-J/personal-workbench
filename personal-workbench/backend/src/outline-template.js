// outline-template.js — 监理大纲标准目录模板与草案生成
// 用途：网页「生成目录草案」按钮 → 秒出一份三级目录（章节/页数/评分点/计划图表），
//      用户在工作台上直接增删改，再提交 G1 确认。
// 说明：模板是通用监理大纲骨架；页数按「页数上限 × 0.92」等比缩放（留装订/图表余量）。

// 关键词 → 章号：把招标文件的评分标准条目挂到对应章节上（每个评分点必须有章节响应）
const SCORE_KEYWORDS = [
  { no: "3", re: /质量|工艺|材料|试验|检测|验收|旁站|见证/ },
  { no: "4", re: /进度|工期|计划|横道|网络计划/ },
  { no: "5", re: /投资|造价|计量|支付|变更|索赔|结算|成本/ },
  { no: "6", re: /安全|危大|文明施工|应急|职业健康/ },
  { no: "2", re: /组织机构|机构|人员|配备|岗位|职责|总监/ },
  { no: "8", re: /重点|难点|对策|针对性|措施|特点/ },
  { no: "9", re: /制度|设备|设施|配置|检测设备/ },
  { no: "7", re: /合同|信息|资料|协调|沟通/ },
  { no: "1", re: /概况|范围|内容|依据|完整|规范|大纲/ },
];

// 标准章节骨架：章/节 + 基准页数 + 计划图表
const CHAPTER_TEMPLATE = [
  {
    no: "1", title: "工程概况及监理工作范围、内容、依据", pages: 5,
    charts: [],
    sections: [
      { no: "1.1", title: "工程概况", pages: 2 },
      { no: "1.2", title: "监理工作范围、内容", pages: 2, charts: ["图1-1 监理工作总流程"] },
      { no: "1.3", title: "监理工作依据", pages: 1 },
    ],
  },
  {
    no: "2", title: "监理组织机构、人员配备及岗位职责", pages: 8,
    charts: [],
    sections: [
      { no: "2.1", title: "监理组织机构设置", pages: 3, charts: ["图2-1 监理组织机构图"] },
      { no: "2.2", title: "监理人员配备计划", pages: 3, charts: ["图2-2 监理人员进场计划"] },
      { no: "2.3", title: "监理人员岗位职责", pages: 2 },
    ],
  },
  {
    no: "3", title: "质量控制监理措施", pages: 18,
    charts: [],
    sections: [
      { no: "3.1", title: "质量控制目标与保证体系", pages: 3 },
      { no: "3.2", title: "施工准备阶段质量控制", pages: 3 },
      { no: "3.3", title: "施工阶段质量控制程序", pages: 4, charts: ["图3-1 施工阶段质量控制程序"] },
      { no: "3.4", title: "关键部位、关键工序质量控制", pages: 5 },
      { no: "3.5", title: "见证取样与旁站监理", pages: 3, charts: ["图3-2 见证取样流程", "表3-1 旁站监理部位表"] },
    ],
  },
  {
    no: "4", title: "进度控制监理措施", pages: 8,
    charts: [],
    sections: [
      { no: "4.1", title: "进度控制目标与程序", pages: 3, charts: ["图4-1 进度控制流程"] },
      { no: "4.2", title: "进度计划审查与动态控制", pages: 3 },
      { no: "4.3", title: "工期延误分析与处理", pages: 2 },
    ],
  },
  {
    no: "5", title: "投资控制监理措施", pages: 7,
    charts: [],
    sections: [
      { no: "5.1", title: "投资控制目标与程序", pages: 2 },
      { no: "5.2", title: "工程计量与支付控制", pages: 3, charts: ["表5-1 计量支付控制要点表"] },
      { no: "5.3", title: "工程变更与索赔控制", pages: 2 },
    ],
  },
  {
    no: "6", title: "安全生产管理的监理措施", pages: 9,
    charts: [],
    sections: [
      { no: "6.1", title: "安全监理目标与工作程序", pages: 3, charts: ["图6-1 安全监理工作程序"] },
      { no: "6.2", title: "危大工程安全监理", pages: 3, charts: ["表6-1 危大工程监理控制要点表"] },
      { no: "6.3", title: "现场安全文明施工管理", pages: 3 },
    ],
  },
  {
    no: "7", title: "合同管理、信息管理与组织协调", pages: 7,
    charts: [],
    sections: [
      { no: "7.1", title: "合同管理", pages: 2 },
      { no: "7.2", title: "信息管理与监理资料", pages: 3, charts: ["表7-1 监理资料分类表"] },
      { no: "7.3", title: "组织协调", pages: 2 },
    ],
  },
  {
    no: "8", title: "重点、难点分析及监理对策", pages: 8,
    charts: [],
    sections: [
      { no: "8.1", title: "本工程重点、难点分析", pages: 3 },
      { no: "8.2", title: "针对性监理对策", pages: 5, charts: ["表8-1 重点难点与监理对策对应表"] },
    ],
  },
  {
    no: "9", title: "监理工作制度及监理设施设备配置", pages: 6,
    charts: [],
    sections: [
      { no: "9.1", title: "监理工作制度", pages: 3, charts: ["表9-1 监理工作制度一览表"] },
      { no: "9.2", title: "监理设施与检测设备配置", pages: 3, charts: ["表9-2 监理检测设备配置表"] },
    ],
  },
];

function sanitizeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
function pad2(n) {
  return String(n).padStart(2, "0");
}

// 把评分标准条目按关键词挂到章节上
function matchScores(scoreCriteria) {
  const byChapter = {};
  for (const item of scoreCriteria) {
    const text = String(item || "").trim();
    if (!text) continue;
    const hit = SCORE_KEYWORDS.find((k) => k.re.test(text));
    const no = hit ? hit.no : "1";
    (byChapter[no] = byChapter[no] || []).push(text);
  }
  return byChapter;
}

// 等比缩放一组页数，使合计等于 target（各值至少 min）
function scalePages(pages, ratio, min, target) {
  const out = pages.map((p) => Math.max(min, Math.round(p * ratio)));
  let diff = target - out.reduce((a, b) => a + b, 0);
  // 多退少补：优先动最大的那些，避免出现 0 页
  let guard = 0;
  while (diff !== 0 && guard++ < 200) {
    const idx = diff > 0
      ? out.indexOf(Math.max(...out))
      : out.indexOf(Math.max(...out.filter((v) => v > min)));
    if (idx < 0) break;
    out[idx] += diff > 0 ? 1 : -1;
    diff = target - out.reduce((a, b) => a + b, 0);
  }
  return out;
}

/**
 * 生成目录草案
 * @param {object} opts
 * @param {number} opts.pageLimit   技术标页数上限（0 = 不限，用模板基准值）
 * @param {string[]} opts.scoreCriteria 评分标准条目（每行一条）
 * @param {string} opts.docTitle    文档标题（默认「项目名 监理大纲（技术标）」）
 * @param {string} opts.projectName 项目名称
 */
export function buildOutlineDraft(opts = {}) {
  const pageLimit = Number(opts.pageLimit) || 0;
  const scoreCriteria = Array.isArray(opts.scoreCriteria) ? opts.scoreCriteria : [];
  const projectName = String(opts.projectName || "").trim();
  const baseTotal = CHAPTER_TEMPLATE.reduce((s, c) => s + c.pages, 0);

  // 目标页数：留 8% 余量（封面/目录/图表占位），且不低于模板的 60%
  const target = pageLimit > 0 ? Math.max(Math.round(baseTotal * 0.6), Math.round(pageLimit * 0.92)) : baseTotal;
  const ratio = target / baseTotal;

  const scoreMap = matchScores(scoreCriteria);
  const sections = [];

  for (const ch of CHAPTER_TEMPLATE) {
    const subTargets = scalePages(ch.sections.map((s) => s.pages), ratio, 1, Math.max(2, Math.round(ch.pages * ratio)));
    const chPages = subTargets.reduce((a, b) => a + b, 0);
    const chCharts = ch.sections.flatMap((s) => s.charts || []);
    sections.push({
      no: ch.no,
      title: ch.title,
      level: 1,
      pages: chPages,
      score: scoreMap[ch.no] || [],
      source: "",
      charts: chCharts,
      status: "pending",
      file: `03-章节草稿/${pad2(ch.no)}-${sanitizeFileName(ch.title)}.md`,
    });
    ch.sections.forEach((s, i) => {
      sections.push({
        no: s.no,
        title: s.title,
        level: 2,
        pages: subTargets[i],
        score: [],
        source: "",
        charts: s.charts || [],
        status: "pending",
      });
    });
  }

  const totalAllocated = sections.filter((s) => s.level === 1).reduce((a, b) => a + b.pages, 0);
  return {
    meta: {
      pageLimit,
      totalAllocated,
      docTitle: String(opts.docTitle || "").trim() || (projectName ? `${projectName} 监理大纲（技术标）` : ""),
    },
    sections,
  };
}

// 图表清单草案（与目录一起生成，编号 图X-Y / 表X-Y）
// 注意：目录里"章级"与"节级"都会带 charts 字段（章级是汇总），必须按编号去重，
// 否则同一张图会被登记两次、渲染两次、docx 里插入两遍。
export function buildChartsDraft(outline) {
  const charts = [];
  const seen = new Set();
  for (const s of (outline?.sections || [])) {
    for (const label of (s.charts || [])) {
      const m = String(label).match(/^(图|表)(\d+)-(\d+)\s+(.+)$/);
      if (!m) continue;
      const [, kind, chNo, seq, title] = m;
      const no = `${kind}${chNo}-${seq}`;
      if (seen.has(no)) continue;          // 同名图表只登记一次
      seen.add(no);
      const isImg = kind === "图";
      const base = `fig${chNo}-${seq}`;
      charts.push({
        no,
        title,
        chapterNo: `${chNo}`,
        type: isImg ? "mermaid" : "table",
        src: isImg ? `05-图表/src/${base}.mmd` : "",
        out: isImg ? `05-图表/out/${base}.png` : "",
        status: "todo",
      });
    }
  }
  return { charts };
}

export const OUTLINE_TEMPLATE_META = {
  baseTotalPages: CHAPTER_TEMPLATE.reduce((s, c) => s + c.pages, 0),
  chapters: CHAPTER_TEMPLATE.length,
  sections: CHAPTER_TEMPLATE.reduce((s, c) => s + c.sections.length, 0),
};
