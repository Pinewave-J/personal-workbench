/* ============================================================
 * 个人工作台 · 配置与文案（单一来源）
 * 加载顺序：本文件先于 personal-workbench.js（见 personal-workbench.html）
 * ============================================================ */
(function () {
  "use strict";

  const INDUSTRY = ["化工石油", "工业厂房", "市政公用工程", "新能源", "矿山", "其他"];
  const INDUSTRY_PALETTE = ["#5b8cff", "#22d3ee", "#a78bfa", "#f5b84c", "#f472b6", "#34d399", "#fb923c", "#60a5fa", "#c084fc", "#4ade80"];
  const IND_COLOR = {};
  INDUSTRY.forEach((ind, i) => { IND_COLOR[ind] = INDUSTRY_PALETTE[i % INDUSTRY_PALETTE.length]; });
  IND_COLOR["未填写"] = "#6b7280";

  window.PW_CONFIG = {
    // 运行环境
    API_BASE: "http://127.0.0.1:8787/api/v1",
    // 前端版本号：每次改前端就把这里 +1。侧栏底部与设置页会显示它，
    // 用来一眼判断"浏览器是不是还在用缓存里的旧文件"。
    VERSION: "2026-09-20j",
    // 主题：dark（默认，已定稿的暗色霓虹）/ light（办公·投屏·打印用的浅色）
    THEME_KEY: "pw-theme",

    // 列表分页
    PAGE_SIZE: 20,        // 列表每页条数
    KANBAN_CAP: 100,      // 看板最多展示的未完成任务数（超出提示用筛选）

    // 投标项目
    STATUS: ["跟踪中", "已报名", "已购标书", "已投标", "已开标", "中标", "未中标", "流标"],
    CATEGORY: ["工程监理", "造价", "咨询", "全过程咨询", "工程管理", "其他"],
    INDUSTRY,
    INDUSTRY_PALETTE,
    IND_COLOR,
    BID_DIST_COLOR: { "意向跟进": "#5b8cff", "已报名": "#22d3ee", "标书编制中": "#fb923c", "已开标": "#a78bfa", "中标": "#4dffb8", "流标废标": "#7a8398" },
    STATUS_STYLE: {
      "跟踪中": "info", "已报名": "info", "已购标书": "info", "已投标": "warn",
      "已开标": "warn", "中标": "done", "未中标": "danger", "流标": "danger",
    },
    TRANSITIONS: {
      "跟踪中": ["已报名", "流标"], "已报名": ["已购标书", "流标"], "已购标书": ["已投标", "流标"],
      "已投标": ["已开标", "流标"], "已开标": ["中标", "未中标", "流标"],
      "中标": [], "未中标": [], "流标": [],
    },
    REMIND_TYPE: ["报名截止", "购标截止", "投标截止", "开标", "其他"],

    /* ============================================================
     * 标书编制（投标文件生成全过程）
     * 与 bid-workflow\SOP-投标文件生成全过程.md 及后端 backend/src/main.js 三处必须一致：
     *   阶段顺序、闸口定义、进入某阶段所需闸口
     * ============================================================ */
    MAIN_STAGE: ["intake", "outline", "draft", "selfcheck", "merge", "charts", "final", "delivered"],
    MAIN_STAGE_LABEL: {
      intake: "S1 立项与交底", outline: "S2 目录与页数", draft: "S3 章节生成", selfcheck: "S4 双重自检",
      merge: "S5 合稿转 Word", charts: "S6 图表增强", final: "S7 终校", delivered: "S8 交付归档",
    },
    MAIN_STAGE_SUB: {
      intake: "读招标文件、填参数卡、建待补清单",
      outline: "依评分标准设计三级目录并分配页数",
      draft: "逐章撰写改写，每批交你审阅",
      selfcheck: "bid check 清零错误 + AI 语义自检",
      merge: "合并章节转 Word 并统计页数",
      charts: "mermaid 图表登记、渲染与引用",
      final: "交付终校：页数/占位符/编号/一致性",
      delivered: "版本快照、回沉素材库、交付归档",
    },
    MAIN_GATE: ["G1", "G2", "G3", "G4"],
    MAIN_GATE_LABEL: {
      G1: "G1 目录规划确认", G2: "G2 草稿审阅", G3: "G3 整稿通读", G4: "G4 交付终校",
    },
    // 进入某阶段必须先批准的闸口（与后端 GATE_REQUIRED 一致）
    MAIN_GATE_REQUIRED: { draft: "G1", selfcheck: "G2", charts: "G3", final: "G3", delivered: "G4" },

    // 任务 / 待办
    QUADRANT: ["重要紧急", "重要不紧急", "紧急不重要", "不重要不紧急"],
    QUADRANT_COLOR: { "重要紧急": "#dc2626", "重要不紧急": "#2f6fed", "紧急不重要": "#d97706", "不重要不紧急": "#9aa4b2" },
    QUADRANT_HINT: { "重要紧急": "立即去做", "重要不紧急": "列入计划", "紧急不重要": "委托 / 速办", "不重要不紧急": "删减 / 稍后" },
    TASK_STATUS: ["待办", "进行中", "已完成", "已取消"],
    TASK_STATUS_STYLE: { "待办": "warn", "进行中": "info", "已完成": "done", "已取消": "" },
    TASK_SOURCE_LABEL: { manual: "手动", recurring: "周期", customer: "客户" },

    // 客户
    CUSTOMER_STATUS: ["潜在", "跟进中", "已成交", "暂停", "流失"],
    CUSTOMER_STATUS_STYLE: { "潜在": "info", "跟进中": "warn", "已成交": "done", "暂停": "", "流失": "danger" },
    FOLLOW_TYPE: ["电话", "拜访", "邮件", "微信", "其他"],

    /* ============================================================
     * 浅色主题的图表配色（只在 data-theme="light" 时生效）
     * 暗色那一套是已定稿的成品，此处只做"浅底可用"的等价替换：
     * 荧光绿/浅灰在浅底上对比度不足，换成同语义的深一档颜色。
     * ============================================================ */
    LIGHT_CHART: {
      BID_DIST_COLOR: {
        "意向跟进": "#2f6fed", "已报名": "#0891b2", "标书编制中": "#ea7317",
        "已开标": "#7c5cf0", "中标": "#0b8a55", "流标废标": "#8a94a6",
      },
      INDUSTRY_PALETTE: ["#2f6fed", "#0891b2", "#7c5cf0", "#d97706", "#db2777", "#0b8a55", "#ea7317", "#2563eb", "#9333ea", "#15803d"],
      IND_COLOR_UNSET: "#98a2b3",
      QUADRANT_COLOR: { "重要紧急": "#d92d20", "重要不紧急": "#2f6fed", "紧急不重要": "#b45309", "不重要不紧急": "#8a94a6" },
      DONUT_CENTER: "#1b2432",
      DONUT_CENTER_SUB: "#6b7789",
    },
  };

  window.PW_TEXT = {
    requiredPrefix: "请填写",
    invalidDate: "日期格式应为 YYYY-MM-DD",
    invalidNumber: "请输入有效数字",
    invalidMoney: "请输入有效金额（数字）",
    invalidUrl: "请输入有效的链接地址",
  };
})();
