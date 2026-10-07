  "use strict";

  // 配置与文案统一从 personal-workbench.config.js 读取（单一来源）
  const {
    API_BASE, PAGE_SIZE, KANBAN_CAP,
    STATUS, CATEGORY, INDUSTRY, INDUSTRY_PALETTE, IND_COLOR, BID_DIST_COLOR,
    STATUS_STYLE, TRANSITIONS, REMIND_TYPE,
    QUADRANT, QUADRANT_COLOR, QUADRANT_HINT, TASK_STATUS, TASK_STATUS_STYLE,
    CUSTOMER_STATUS, CUSTOMER_STATUS_STYLE, FOLLOW_TYPE, TASK_SOURCE_LABEL,
    THEME_KEY, LIGHT_CHART, VERSION,
    MAIN_STAGE, MAIN_STAGE_LABEL, MAIN_STAGE_SUB, MAIN_GATE, MAIN_GATE_LABEL, MAIN_GATE_REQUIRED,
  } = window.PW_CONFIG;
  const TEXT = window.PW_TEXT;

  /* ---------- 主题（暗色为默认，浅色 opt-in） ----------
   * 暗色配色是已定稿的，这里只做"读/写 data-theme"；
   * 图表颜色按当前主题取对应色板，切主题后重渲染即可。 */
  const themeNow = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const isLight = () => themeNow() === "light";
  // 当前主题下的状态分布色板
  function bidDistColor(name) {
    const src = isLight() ? LIGHT_CHART.BID_DIST_COLOR : BID_DIST_COLOR;
    return src[name] || (isLight() ? "#8a94a6" : "#5b8cff");
  }
  // 当前主题下的行业色板（自定义行业从调色板取色）
  function industryPalette() { return isLight() ? LIGHT_CHART.INDUSTRY_PALETTE : INDUSTRY_PALETTE; }
  function industryColor(name) {
    const light = isLight();
    const map = light ? {} : IND_COLOR;
    const palette = industryPalette();
    if (!light && map[name]) return map[name];
    const idx = INDUSTRY.indexOf(name);
    if (idx >= 0) return palette[idx % palette.length];
    if (name === "未填写") return light ? LIGHT_CHART.IND_COLOR_UNSET : IND_COLOR["未填写"];
    return null; // 交给调用方按"未使用过的颜色"分配
  }
  function quadrantColor(q) {
    const src = isLight() ? LIGHT_CHART.QUADRANT_COLOR : QUADRANT_COLOR;
    return src[q] || (isLight() ? "#8a94a6" : "#9aa4b2");
  }
  // 图表中心文字色（SVG 里不能用 CSS 变量以外的继承，显式取值）
  const chartCenter = () => (isLight() ? LIGHT_CHART.DONUT_CENTER : "#ffffff");
  const chartCenterSub = () => (isLight() ? LIGHT_CHART.DONUT_CENTER_SUB : "#8b96ad");

  // 给颜色加透明度：只处理 #rgb/#rrggbb，其它形式（rgba/var()）原样返回，
  // 避免拼出非法颜色值把整条背景弄失效。
  function withAlpha(color, a) {
    const s = String(color || "").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(s) || /^#([0-9a-f]{3})$/i.exec(s);
    if (!m) return s;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
  }
  // 稳定的字符串取色下标：同一个行业名永远得到同一种颜色，与行序无关
  function hashIndex(str, len) {
    if (!len) return 0;
    let h = 0;
    for (const ch of String(str || "")) h = (h * 31 + ch.codePointAt(0)) % 100000;
    return h % len;
  }

  // 8 个投标状态 → 首页环形图的 6 类语义色（保证同一口径到处同色；统计页与日历共用）
  const STATUS_DIST_GROUP = {
    "跟踪中": "意向跟进", "已报名": "已报名", "已购标书": "标书编制中", "已投标": "标书编制中",
    "已开标": "已开标", "中标": "中标", "未中标": "流标废标", "流标": "流标废标",
  };

  /* ---------- 个人工作台新增工具 ---------- */
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const thisMonthStr = () => todayStr().slice(0, 7);
  // 任务截止状态：逾期红 / 今日黄 / 7天内橙 / 其他默认
  function dueClass(dateStr) {
    if (!dateStr) return "";
    const today = todayStr();
    if (dateStr < today) return "due-ovd";
    if (dateStr === today) return "due-today";
    const t = new Date(today + "T00:00:00"); t.setDate(t.getDate() + 7);
    const limit = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return dateStr <= limit ? "due-soon" : "";
  }
  const fmtYMD = (s) => (s ? String(s).slice(0, 10) : "");
  // 距今天数（纯日期字段，按本地日期算；负数=已过期）
  function daysLeft(dateStr) {
    const t = fmtYMD(dateStr);
    if (!t) return "—";
    const a = new Date(todayStr() + "T00:00:00");
    const b = new Date(t + "T00:00:00");
    if (isNaN(b.getTime())) return "—";
    return Math.round((b - a) / 86400000);
  }
  const sourceTag = (src) => `<span class="src-tag ${esc(src)}">${esc(TASK_SOURCE_LABEL[src] || src)}</span>`;

  /* ---------- SVG 线性图标（Feather 风格，stroke 继承 currentColor） ---------- */
  const ICON = {
    // 主题切换用
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7.1" y2="7.1"/><line x1="16.9" y1="16.9" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7.1" y2="16.9"/><line x1="16.9" y1="7.1" x2="19.1" y2="4.9"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    "check-square": '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "message-circle": '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><polyline points="9 13 11 15 15 10"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  };
  function svgIcon(name, size = 16) {
    const body = ICON[name] || ICON.info;
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }
  const I = svgIcon; // 别名

  /* ---------- 工具 ---------- */
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  // 相对路径 URL 编码：只编每个路径段（保留 "/"），后端会还原 %2F
  const encodeRel = (rel) => String(rel ?? "").split("/").map((seg) => encodeURIComponent(seg)).join("/");
  // ---- 时间显示 ----
  // 库里 created_at / updated_at / uploaded_at 等是 ISO(UTC) 时间戳，日期字段是纯 YYYY-MM-DD。
  // 旧实现一律 String(s).slice(0,10) 当本地时间用：操作日志时间整体差 8 小时，
  // 北京时间 00:00-08:00 的记录还会差一天。这里按"字符串是纯日期还是时间戳"分别处理。
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  function localDateParts(s) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mi: d.getMinutes(), ss: d.getSeconds() };
  }
  const fmtDate = (s) => {
    if (!s) return "—";
    const t = String(s).trim();
    if (DATE_ONLY.test(t)) return t.replace(/-/g, "/");
    const p = localDateParts(t);
    if (!p) return t.slice(0, 10).replace(/-/g, "/");
    return `${p.y}/${String(p.m).padStart(2, "0")}/${String(p.d).padStart(2, "0")}`;
  };
  const fmtTime = (s) => {
    const t = String(s ?? "").trim();
    if (!t || DATE_ONLY.test(t)) return "";
    const p = localDateParts(t);
    if (!p) return t.slice(11, 19);
    return `${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}:${String(p.ss).padStart(2, "0")}`;
  };
  const fmtTs = (s) => {
    const t = String(s ?? "").trim();
    if (!t) return "—";
    if (DATE_ONLY.test(t)) return t.replace(/-/g, "/");
    const time = fmtTime(t);
    return time ? `${fmtDate(t)} ${time}` : fmtDate(t);
  };

  const badge = (text, cls) => `<span class="badge ${cls}">${esc(text)}</span>`;
  const statusBadge = (s) => badge(s, STATUS_STYLE[s] || "");
  const money = (v) => (v === null || v === undefined || v === "") ? "—" : (Number(v) / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " 万";
  const wanToYuan = (v) => (v === null || v === undefined || v === "") ? null : Math.round(Number(v) * 10000 * 100) / 100;
  const yuanToWan = (v) => (v === null || v === undefined || v === "") ? "" : Number(v) / 10000;
  function debounce(fn, ms) {
    let t = null;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function friendlyError(e) {
    const msg = String(e?.message || e || "未知错误");
    if (/Failed to fetch|NetworkError|fetch/i.test(msg)) {
      return "无法连接后端服务（http://127.0.0.1:8787），请确认后端已启动：cd backend && npm start";
    }
    return msg;
  }

  const qs = (params) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, v);
    return s.toString();
  };

  /* ---------- 粘贴文本识别 ---------- */
  function parseTenderText(text) {
    const t = String(text || "");
    const out = {};

    // 取第一个"像字段值"的匹配：跳过跨行抓到的**条款号**。
    // 背景：标签与值之间允许跨行（\s*），但招标文件里「13．投标保证金」这种章节标题
    // 后面紧跟的是下一行的条款号「13.1」，会被当成金额 —— 实测把投标保证金抓成了 13.1 元。
    // 判据：① 匹配跨越了换行；② 捕获值本身是「数字.数字」，或值后面紧跟「.数字」→ 判为条款号，继续往后找。
    function firstSane(re) {
      re.lastIndex = 0;
      let m, guard = 0;
      while ((m = re.exec(t)) !== null && guard++ < 200) {
        if (m[0].includes("\n")) {
          const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 2);
          const v = String(m[1] ?? "").trim();
          if (/^\.\d/.test(rest)) continue;                       // 值后面还有 ".数字" → 条款号
          if (/^\d+\.\d+$/.test(v)) continue;                     // 捕获值整个就是 "13.1"
        }
        return m;
      }
      return null;
    }

    // 值清洗：截断掉"后面那个字段"。单行多字段的公告（如用全角空格分隔）里，
    // [^\n，,;；]+ 会把同行的后续字段全部吞进当前值：
    //   name 抓成「湖州市南浔区人民医院二期工程全过程工程咨询　招标编号：HZZB2026-0912　招标人：…」
    // 这里在「下一个字段标签 + 冒号」处截断。要求带冒号，避免误伤值里出现的同名字样。
    const NEXT_LABEL = /[\s\u3000]*(?:招标编号|项目编号|标段编号|招标人名称|招标人|招标单位|招标代理机构|招标代理|代理机构|采购代理|采购人|业主单位|建设单位|建设地点|项目地点|服务地点|地区|合同期限|服务期限|服务期|工期|预算金额|最高限价|控制价|采购预算|投资额|投标保证金|保证金|投标有效期|有效期|投标截止时间|投标截止|开标时间|开标|项目名称|工程名称|标的名称|联系人|联系电话|联系方式|电话|手机|邮箱|E-?mail|行业|类别)[\s\u3000]*[:：]/i;

    function cleanText(s) {
      let v = String(s ?? "");
      const cut = NEXT_LABEL.exec(v);
      if (cut && cut.index > 0) v = v.slice(0, cut.index);   // cut.index===0 表示值本身就以标签开头，保留
      return v.replace(/[\s\u3000，,;；、]+$/, "").trim();
    }

    const grab = (re) => { const m = firstSane(re); return m ? cleanText(m[1]) : null; };

    function amount(re) {
      const m = firstSane(re);
      if (!m) return null;
      const num = parseFloat(String(m[1]).replace(/,/g, ""));
      if (!Number.isFinite(num)) return null;
      const unit = (m[2] || "").trim();
      if (/亿/.test(unit)) return Math.round(num * 1e8);
      if (/万元|万/.test(unit)) return Math.round(num * 1e4 * 100) / 100;
      return Math.round(num * 100) / 100;
    }
    function date(re) {
      const m = firstSane(re);
      if (!m) return null;
      return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    }

    const name = grab(/(?:项目名称|工程名称|项目名|标的名称)\s*[:：]\s*([^\n，,;；]+)/);
    if (name) out.name = name;
    const tenderNo = grab(/(?:招标编号|项目编号|招标项目编号|标段编号|编号)\s*[:：]\s*([^\n，,;；]+)/);
    // 「（项目编号：HZZB2026-0912）」会把右括号吃进值里；仅当括号不配对时才去掉
    if (tenderNo) out.tenderNo = /）$/.test(tenderNo) && !/（/.test(tenderNo) ? tenderNo.replace(/）$/, "").trim() : tenderNo;
    const tenderer = grab(/(?:招标人|招标单位|招标人名称|建设单位|业主单位|采购人)\s*[:：]\s*([^\n，,;；]+)/);
    if (tenderer) out.tenderer = tenderer;
    const agency = grab(/(?:招标代理|代理机构|招标代理机构|采购代理)\s*[:：]\s*([^\n，,;；]+)/);
    if (agency) out.agency = agency;
    // 地区：要求标签位于行首或空白之后，否则「提交地点：」「开标地点：」会被当成项目地区
    // （实测把开标地点抓成了 region）。不带 lookbehind，避免旧 Safari 解析整份文件时报错。
    const region = grab(/(?:^|[\s\u3000])(?:地区|项目地点|建设地点|服务地点|地点)\s*[:：]\s*([^\n，,;；]+)/);
    if (region) out.region = region;
    // 工期：备选词必须"长的在前" —— 原顺序 工期|服务期|合同期限|服务期限 里，
    // 短的「服务期」会先命中「服务期限：3年」并把冒号吞掉，抓成「限：3年」。
    // 同时要求值以数字开头：否则会把「服务期如下：」这类说明文字当成工期。
    const duration = grab(/(?:合同期限|服务期限|服务期|工期)\s*[:：]?\s*(\d[^\n，,;；]*)/);
    if (duration) out.duration = duration;
    const contact = grab(/(?:联系人|项目联系人)\s*[:：]\s*([^\n，,;；]+)/);
    if (contact) out.contactName = contact;
    const phone = grab(/(?:联系电话|联系方式|电话|手机)\s*[:：]\s*([0-9\-+（）() ]{5,})/);
    if (phone) out.contactPhone = phone.trim();
    // 有效期 / 金额：标签与数字之间保留跨行能力（\s*），条款号的误判由 firstSane 统一挡掉。
    const validity = grab(/(?:投标有效期|有效期)\s*[:：]?\s*(\d+)\s*(?:天|日)?/);
    if (validity) out.validityDays = Number(validity);

    const budget = amount(/(?:预算金额|最高限价|控制价|采购预算|投资额|预算)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(亿|万元|万|元)?/);
    if (budget != null) out.budget = budget;
    const bond = amount(/(?:投标保证金|保证金)\s*[:：]?\s*([\d,]+(?:\.\d+)?)\s*(亿|万元|万|元)?/);
    if (bond != null) out.bond = bond;

    const deadline = date(/(?:投标截止|递交投标文件截止|递交截止|开标)\s*(?:时间|日期)?\s*[:：]?\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (deadline) out.deadline = deadline;

    const catKw = [["全过程咨询", "全过程咨询"], ["工程监理", "工程监理"], ["工程管理", "工程管理"], ["造价", "造价"], ["咨询", "咨询"]];
    for (const [kw, cat] of catKw) { if (t.includes(kw)) { out.category = cat; break; } }

    return out;
  }

  /* ---------- API 客户端 ---------- */
  async function api(path, opts = {}) {
    const init = { ...opts };
    if (init.body) init.headers = { "content-type": "application/json", ...(init.headers || {}) };
    const res = await fetch(API_BASE + path, init);
    let j;
    try { j = await res.json(); }
    catch { throw new Error("服务响应异常"); }
    if (!j.success) {
      const err = new Error(j.error?.message || "请求失败");
      err.code = j.error?.code;
      throw err;
    }
    return j.data;
  }

  /* ---------- Store ---------- */
  const Store = {
    list(params = {}) { return api("/projects?" + qs(params)); },
    get(id) { return api("/projects/" + id); },
    add(rec) { return api("/projects", { method: "POST", body: JSON.stringify(rec) }); },
    update(id, patch) { return api("/projects/" + id, { method: "PATCH", body: JSON.stringify(patch) }); },
    remove(id) { return api("/projects/" + id, { method: "DELETE" }); },
    setStatus(id, status) { return api(`/projects/${id}/status`, { method: "POST", body: JSON.stringify({ toStatus: status }) }); },
    dashboardSummary() { return api("/dashboard/summary"); },
    statsOverview() { return api("/stats/overview"); },
    listDocuments() { return api("/documents"); },
    getDocument(id) { return api("/documents/" + id); },
    saveDocument(rec) { return api("/documents", { method: "POST", body: JSON.stringify(rec) }); },
    removeDocument(id) { return api("/documents/" + id, { method: "DELETE" }); },
    listSchedules(params = {}) { return api("/schedules?" + qs(params)); },
    getSchedule(id) { return api("/schedules/" + id); },
    addSchedule(rec) { return api("/schedules", { method: "POST", body: JSON.stringify(rec) }); },
    updateSchedule(id, patch) { return api("/schedules/" + id, { method: "PUT", body: JSON.stringify(patch) }); },
    removeSchedule(id) { return api("/schedules/" + id, { method: "DELETE" }); },
    ackSchedule(id, status) { return api(`/schedules/${id}/ack`, { method: "POST", body: JSON.stringify({ status }) }); },
    listResults(params = {}) { return api("/results?" + qs(params)); },
    addResult(rec) { return api("/results", { method: "POST", body: JSON.stringify(rec) }); },
    replaceResult(id, rec) { return api(`/results/${id}/content`, { method: "PUT", body: JSON.stringify(rec) }); },
    removeResult(id) { return api("/results/" + id, { method: "DELETE" }); },
    listAuditLogs(params = {}) { return api("/audit-logs?" + qs(params)); },
    importProjects(rec) { return api("/import/projects", { method: "POST", body: JSON.stringify(rec) }); },

    /* ---- 任务 & 周期模板 ---- */
    listTasks(params = {}) { return api("/tasks?" + qs(params)); },
    getTask(id) { return api("/tasks/" + id); },
    addTask(rec) { return api("/tasks", { method: "POST", body: JSON.stringify(rec) }); },
    updateTask(id, patch) { return api("/tasks/" + id, { method: "PATCH", body: JSON.stringify(patch) }); },
    removeTask(id) { return api("/tasks/" + id, { method: "DELETE" }); },
    completeTask(id, nextFollowDate) { return api(`/tasks/${id}/complete`, { method: "POST", body: JSON.stringify({ nextFollowDate: nextFollowDate || null }) }); },
    reopenTask(id) { return api(`/tasks/${id}/reopen`, { method: "POST" }); },
    ensureMonth(month, restore) { return api("/tasks/ensure-month", { method: "POST", body: JSON.stringify({ month, restore: restore === true }) }); },
    listTemplates() { return api("/recurring-templates"); },
    addTemplate(rec) { return api("/recurring-templates", { method: "POST", body: JSON.stringify(rec) }); },
    updateTemplate(id, patch) { return api("/recurring-templates/" + id, { method: "PUT", body: JSON.stringify(patch) }); },
    removeTemplate(id) { return api("/recurring-templates/" + id, { method: "DELETE" }); },
    generateTemplateMonth(id, month, restore) { return api(`/recurring-templates/${id}/generate`, { method: "POST", body: JSON.stringify({ month, restore: restore === true }) }); },

    /* ---- 客户 ---- */
    listCustomers(params = {}) { return api("/customers?" + qs(params)); },
    getCustomer(id) { return api("/customers/" + id); },
    addCustomer(rec) { return api("/customers", { method: "POST", body: JSON.stringify(rec) }); },
    updateCustomer(id, patch) { return api("/customers/" + id, { method: "PATCH", body: JSON.stringify(patch) }); },
    removeCustomer(id) { return api("/customers/" + id, { method: "DELETE" }); },
    listFollowUps(params = {}) { return api("/follow-ups?" + qs(params)); },
    addFollowUp(rec) { return api("/follow-ups", { method: "POST", body: JSON.stringify(rec) }); },
    updateFollowUp(id, patch) { return api("/follow-ups/" + id, { method: "PUT", body: JSON.stringify(patch) }); },
    removeFollowUp(id) { return api("/follow-ups/" + id, { method: "DELETE" }); },

    /* ---- 个人总览 / 搜索 / 备份恢复 ---- */
    personalDashboard() { return api("/dashboard/personal"); },
    remindersToday() { return api("/reminders/today"); },
    calendar(month) { return api("/calendar?month=" + encodeURIComponent(month)); },
    globalSearch(q) { return api("/search?q=" + encodeURIComponent(q)); },
    importBackup(data, opts = {}) {
      return api("/import/backup", { method: "POST", body: JSON.stringify({ data, confirm: "RESTORE", skipInvalidRefs: opts.skipInvalidRefs === true }) });
    },

    /* ---- 标书编制（投标文件生成全过程：阶段/闸口/版本；写回由 bw.mjs 完成） ---- */
    listMainProjects() { return api("/main-projects"); },
    getMainProject(id) { return api("/main-projects/" + id); },
    addMainProject(rec) { return api("/main-projects", { method: "POST", body: JSON.stringify(rec) }); },
    updateMainProject(id, patch) { return api("/main-projects/" + id, { method: "PATCH", body: JSON.stringify(patch) }); },
    archiveMainProject(id, remark) { return api(`/main-projects/${id}/archive`, { method: "POST", body: JSON.stringify({ remark: remark || null }) }); },
    syncMainProject(id, payload) { return api(`/main-projects/${id}/sync`, { method: "POST", body: JSON.stringify(payload) }); },
    advanceMainProject(id, remark) { return api(`/main-projects/${id}/advance`, { method: "POST", body: JSON.stringify({ remark: remark || null }) }); },
    rollbackMainProject(id, remark) { return api(`/main-projects/${id}/rollback`, { method: "POST", body: JSON.stringify({ remark: remark || null }) }); },
    setMainGate(id, gate, action, remark, evidence) {
      return api(`/main-projects/${id}/gates/${gate}`, { method: "POST", body: JSON.stringify({ action, remark: remark || null, evidence: evidence || null }) });
    },
    listMainVersions(id) { return api(`/main-projects/${id}/versions`); },
    addMainVersion(id, rec) { return api(`/main-projects/${id}/versions`, { method: "POST", body: JSON.stringify(rec) }); },
    // 操作面板：bid 命令执行 / 项目文件读写 / 报告 / 交付物
    runMainCmd(id, cmd, args) { return api(`/main-projects/${id}/cmd`, { method: "POST", body: JSON.stringify({ cmd, args: args || [] }) }); },
    getMainFile(id, rel) { return api(`/main-projects/${id}/file?rel=${encodeRel(rel)}`); },
    putMainFile(id, rel, content) { return api(`/main-projects/${id}/file?rel=${encodeRel(rel)}`, { method: "PUT", body: JSON.stringify({ rel, content }) }); },
    listMainReports(id) { return api(`/main-projects/${id}/reports`); },
    listMainDeliver(id) { return api(`/main-projects/${id}/deliver`); },
    mainDownloadUrl(id, rel) { return `${API_BASE}/main-projects/${id}/download?rel=${encodeRel(rel)}`; },
    // 目录规划（草案/读取/保存）与待办任务（派活/取消）
    createMainProject(rec) { return api("/main-projects", { method: "POST", body: JSON.stringify(rec) }); },
    getMainOutline(id) { return api(`/main-projects/${id}/outline`); },
    saveMainOutline(id, payload) { return api(`/main-projects/${id}/outline`, { method: "PUT", body: JSON.stringify(payload) }); },
    genMainOutlineDraft(id, payload) { return api(`/main-projects/${id}/outline/draft`, { method: "POST", body: JSON.stringify(payload || {}) }); },
    listMainTasks(id) { return api(`/main-projects/${id}/tasks`); },
    createMainTask(id, rec) { return api(`/main-projects/${id}/tasks`, { method: "POST", body: JSON.stringify(rec) }); },
    cancelMainTask(id, tid, note) { return api(`/main-projects/${id}/tasks/${tid}/cancel`, { method: "POST", body: JSON.stringify({ note: note || null }) }); },
    // 公司级素材库（旧标书复用：索引 / 检索 / 片段读取）
    listMaterials() { return api("/bid-materials/"); },
    searchMaterials(q, top, name) {
      return api(`/bid-materials/search?q=${encodeURIComponent(q)}&top=${top || 10}${name ? `&name=${encodeURIComponent(name)}` : ""}`);
    },
    readMaterial(name, line, ctx) {
      return api(`/bid-materials/read?name=${encodeURIComponent(name)}&line=${line}&ctx=${ctx || 60}`);
    },

    /* ---- AI 助手：暂存队列（AI 只写这里，落库仍走上面的 projects 接口） ---- */
    aiSubmit(inputText, sourceName) { return api("/ai-jobs", { method: "POST", body: JSON.stringify({ kind: "notice_extract", inputText, sourceName: sourceName || null }) }); },
    aiGet(id) { return api("/ai-jobs/" + id); },
    aiList(params = {}) { return api("/ai-jobs?" + qs(params)); },
    aiPendingCount() { return api("/ai-jobs/pending-count"); },
    aiAdopt(id, projectId) { return api(`/ai-jobs/${id}/adopt`, { method: "POST", body: JSON.stringify({ projectId: projectId ?? null }) }); },
    aiIgnore(id) { return api(`/ai-jobs/${id}/ignore`, { method: "POST" }); },
    aiRemove(id) { return api("/ai-jobs/" + id, { method: "DELETE" }); },
    aiPurge(statuses) { return api("/ai-jobs/purge", { method: "POST", body: JSON.stringify({ statuses: statuses || null }) }); },
  };

  /* ---------- App ---------- */
  const App = (() => {
    // 分组导航：投标模块整组迁入 + 个人新模块
    const GROUPS = [
      {
        title: "工作台",
        items: [
          { id: "home", ico: "home", label: "个人总览" },
          { id: "overview", ico: "layout", label: "投标概览" },
        ],
      },
      {
        title: "任务 & 待办",
        items: [
          { id: "tasks", ico: "check-square", label: "待办看板" },
          { id: "templates", ico: "repeat", label: "周期任务" },
        ],
      },
      {
        title: "客户管理",
        items: [
          { id: "customers", ico: "users", label: "客户档案" },
          { id: "followups", ico: "message-circle", label: "跟进记录" },
        ],
      },
      {
        title: "投标工作台",
        items: [
          { id: "projects", ico: "briefcase", label: "投标项目" },
          { id: "main", ico: "clipboard", label: "标书编制" },
          { id: "files", ico: "folder", label: "投标文件" },
          { id: "schedule", ico: "calendar", label: "日程提醒" },
          { id: "results", ico: "file-text", label: "开标结果" },
          { id: "stats", ico: "chart", label: "统计分析" },
        ],
      },
      {
        title: "系统",
        items: [
          { id: "kb", ico: "book", label: "系统图谱" },
          { id: "logs", ico: "list", label: "操作日志" },
          { id: "settings", ico: "settings", label: "设置" },
        ],
      },
    ];
    const FLAT_NAV = GROUPS.flatMap((g) => g.items);
    const navOf = (id) => FLAT_NAV.find((n) => n.id === id) || FLAT_NAV[0];

    let current = "home";
    let statusFilter = "全部";       // 投标状态过滤
    let searchQuery = "";            // 投标项目 q（原逻辑保留）
    let toastTimer = null;
    // 任务视图状态
    let taskScope = "open";          // open | done | all
    let taskQuadrant = "全部";
    let taskMonth = thisMonthStr();
    let taskQ = "";
    // 客户视图状态
    let custStatus = "全部";
    let custQ = "";
    // 跟进视图状态
    let followCustId = "";
    let followQ = "";
    // 分页状态（列表视图；切换筛选/搜索时重置为 1）
    let projectPage = 1;
    let taskPage = 1;
    let custPage = 1;
    let followPage = 1;
    let notifiedToday = false;   // 每次会话仅主动弹一次桌面通知，避免打扰

    function toast(msg) {
      const el = $("#toast");
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
    }

    // 分页条：total 总数 / page 当前页 / pageSize 每页条数 / key 视图标识（用于事件分发）
    function pagerHtml(total, page, pageSize, key) {
      const pages = Math.max(1, Math.ceil(total / pageSize));
      if (pages <= 1) return "";
      const pg = (p, label) =>
        `<button class="pg-btn${p === page ? " on" : ""}" data-page-nav="${key}" data-page="${p}" ${p === page ? "disabled" : ""}>${label}</button>`;
      const win = [];
      for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 2) win.push(p);
      let nums = "", prev = 0;
      for (const p of win) {
        if (prev && p - prev > 1) nums += `<span class="pg-gap">…</span>`;
        nums += pg(p, p);
        prev = p;
      }
      return `<div class="pager">
        <button class="pg-btn" data-page-nav="${key}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
        ${nums}
        <button class="pg-btn" data-page-nav="${key}" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>
        <span class="muted">第 ${page} / ${pages} 页 · 共 ${total} 条</span>
      </div>`;
    }

    // ---- 桌面通知（浏览器不支持 / 沙箱受限时自动降级为应用内提示）----
    function notifySupported() { return typeof window !== "undefined" && "Notification" in window; }
    function notifyPermission() { return notifySupported() ? Notification.permission : "unsupported"; }
    function notify(title, body) {
      try {
        if (notifySupported() && Notification.permission === "granted") {
          const n = new Notification(title, { body: body || "", tag: "pw-reminder" });
          n.onclick = () => { window.focus(); go("tasks"); };
          return true;
        }
      } catch (e) { /* 沙箱 iframe 内可能抛错，忽略并降级 */ }
      return false;
    }
    async function requestNotifyPermission() {
      if (!notifySupported()) return "unsupported";
      if (Notification.permission === "granted") return "granted";
      try { return await Notification.requestPermission(); }
      catch (e) { return "denied"; }
    }
    function notifyReminders(rem) {
      if (!rem || notifiedToday) return;
      const lines = [];
      if (rem.overdueTasks && rem.overdueTasks.length) lines.push(`${rem.overdueTasks.length} 条任务已逾期`);
      if (rem.todayTasks && rem.todayTasks.length) lines.push(`${rem.todayTasks.length} 条任务今日到期`);
      if (rem.dueCustomers && rem.dueCustomers.length) lines.push(`${rem.dueCustomers.length} 家客户需跟进`);
      if (rem.dueSchedules && rem.dueSchedules.length) lines.push(`${rem.dueSchedules.length} 条日程提醒待处理`);
      if (rem.upcomingOpenings && rem.upcomingOpenings.length) {
        const next = rem.upcomingOpenings[0];
        lines.push(`${rem.upcomingOpenings.length} 个项目待开标（最近：${fmtYMD(next.openTime)} ${String(next.name).slice(0, 16)}…）`);
      }
      if (!lines.length) return;
      notifiedToday = true;
      if (!notify("个人工作台 · 今日提醒", lines.join("；") + "。")) {
        toast(`今日提醒：${lines.join("；")}`);
      }
    }
    async function requestNotify() {
      const p = await requestNotifyPermission();
      if (p === "granted") { toast("桌面通知已开启"); notify("个人工作台", "桌面通知已开启"); }
      else if (p === "denied") toast("通知权限被拒绝，可在浏览器站点设置中调整");
      else if (p === "unsupported") toast("当前环境不支持桌面通知，将使用应用内提示");
      else toast("未授权桌面通知");
      renderMain(); // 刷新设置页状态显示
    }

    // ---- 统计卡片筛选跳转 ----
    function jumpProjects(status) {
      statusFilter = status || "全部";
      projectPage = 1;
      go("projects");
    }
    function jumpTasks(quadrant) {
      taskQuadrant = quadrant || "全部";
      taskScope = "open";
      taskPage = 1;
      go("tasks");
    }

    // 自定义确认框（沙箱 iframe 中 window.confirm 会被拦截，改用应用内弹窗）
    let confirmHandler = null;
    let confirmBusy = false;
    function askConfirm(title, messageHtml, onOk, okLabel = "确定", danger = false) {
      confirmHandler = onOk || null;
      confirmBusy = false;
      $("#confirmTitle").textContent = title || "确认操作";
      $("#confirmBody").innerHTML = `<div style="font-size:13px;line-height:1.9;color:var(--text-secondary)">${messageHtml}</div>`;
      const btn = $("#confirmOkBtn");
      btn.textContent = okLabel || "确定";
      btn.disabled = false;
      btn.className = danger ? "btn btn-danger" : "btn btn-primary";
      btn.onclick = confirmOk; // 内联触发，避免依赖 init 绑定
      $("#confirmMask").classList.add("show");
    }
    function closeConfirm() {
      $("#confirmMask").classList.remove("show");
      confirmHandler = null;
      confirmBusy = false;
    }
    async function confirmOk() {
      if (confirmBusy) return;
      const h = confirmHandler;
      closeConfirm();
      if (h) {
        confirmBusy = true;
        try { await h(); }
        catch (e) { toast("操作失败：" + friendlyError(e)); }
        finally { confirmBusy = false; }
      }
    }

    function hideSearchPanel() { const p = $("#searchPanel"); if (p) p.classList.remove("show"); }

    async function renderSidebar() {
      let total = "";
      try { total = (await Store.list({ page: 1, pageSize: 1 })).total; } catch (e) { /* 静默 */ }
      let openBadge = "";
      try { const r = await Store.listTasks({ scope: "open", pageSize: 1 }); if (r.total > 0) openBadge = r.total; } catch (e) { /* 静默 */ }
      $("#sidebar").innerHTML =
        GROUPS.map(g =>
          `<div class="nav-section">${esc(g.title)}</div>` +
          g.items.map(n => {
            let b = "";
            if (n.id === "projects" && total) b = `<span class="badge">${total}</span>`;
            if (n.id === "tasks" && openBadge) b = `<span class="badge warn">${openBadge}</span>`;
            return `<div class="nav-item ${n.id === current ? "active" : ""}" data-nav="${n.id}" role="button" tabindex="0" title="${esc(n.label)}">
                      <span class="ico">${svgIcon(n.ico, 17)}</span><span class="nav-label">${n.label}</span>${b}
                    </div>`;
          }).join("")
        ).join("") +
        `<div class="sidebar-foot">本地 SQLite · 已连接后端<br/>${esc(API_BASE)}<br/><span title="前端版本：用来判断浏览器是否还在用缓存里的旧文件">前端 v${esc(VERSION)}</span></div>`;
      document.querySelectorAll(".nav-item").forEach(el => el.addEventListener("click", () => go(el.dataset.nav)));
    }

    // 从 URL hash 解析路由 id（如 #/tasks → tasks；空 → home）
    function routeFromHash() {
      const m = /^#\/?([\w-]*)/.exec(location.hash || "");
      const id = m && m[1] ? m[1] : "home";
      return navOf(id)?.id || "home";
    }

    async function renderRoute() {
      current = routeFromHash();
      hideSearchPanel();
      if ($("#globalSearch")) $("#globalSearch").blur();
      await renderSidebar();
      await renderMain();
    }

    function go(id) {
      const target = navOf(id)?.id || "home";
      if (routeFromHash() === target) {
        renderRoute();                 // 同一路由（如搜索跳转）强制刷新
      } else {
        location.hash = "#/" + target; // 触发 hashchange → renderRoute
      }
    }

    async function renderMain() {
      const el = $("#main");
      // 记住当前焦点位置：整页 innerHTML 重建会丢掉焦点，
      // 导致"搜索框里打字 → 停顿 300ms 触发重渲染 → 光标消失、后续输入进不去"。
      const active = document.activeElement;
      const focusId = active && el.contains(active) && active.id ? active.id : null;
      const selStart = focusId && typeof active.selectionStart === "number" ? active.selectionStart : null;
      el.innerHTML = `<div class="loading">加载中…</div>`;
      try {
        const views = {
          home: viewHome, overview: viewOverview, tasks: viewTasks, templates: viewTemplates,
          customers: viewCustomers, followups: viewFollowups, kb: viewGraphs,
          projects: viewProjects, main: mainDetailId ? viewMainDetail : viewMain,
          files: viewFiles, schedule: viewSchedule,
          results: viewResults, stats: viewStats, logs: viewLogs, settings: viewSettings,
        };
        el.innerHTML = await (views[current] || viewHome)();
        bindViewEvents();
        if (focusId) {
          const next = document.getElementById(focusId);
          if (next && el.contains(next) && typeof next.focus === "function") {
            next.focus();
            if (selStart !== null && typeof next.setSelectionRange === "function") {
              const pos = Math.min(selStart, String(next.value ?? "").length);
              try { next.setSelectionRange(pos, pos); } catch { /* 某些 input 类型不支持 */ }
            }
          }
        }
      } catch (e) {
        el.innerHTML = `<div class="error-banner"> ${esc(friendlyError(e))}</div>
          <div class="empty"><button class="btn btn-ghost" onclick="App.refresh()">重新加载</button></div>`;
      }
    }

    /* ---------------- 个人总览 ---------------- */
    // 环形图（纯手写 SVG，无依赖）：
    //  · 段间留 2px 视觉呼吸（不改变占比，只缩短描边长度）
    //  · 悬停某段/图例项：其余变淡，中心数字与标题切换为该段数值（联动在 bindDonutInteraction）
    //  · 每段有 <title>，无鼠标时也能用原生提示
    function donutHtml(items, total, size = 200, thickness = 26, centerLabel = "投标项目") {
      if (!total || total <= 0) {
        return `<div class="dist-empty">暂无投标项目数据</div>`;
      }
      const C = Math.PI * 2;
      const r = (size - thickness - 8) / 2;
      const cx = size / 2, cy = size / 2;
      const circ = C * r;
      const GAP = 2; // 段间留白（px，沿弧长）
      const visible = items.filter(i => i.count > 0);
      const multi = visible.length > 1;
      let acc = 0;
      const segs = [];
      for (const it of visible) {
        const frac = it.count / total;
        const full = frac * circ;
        const len = Math.max(1, multi ? full - GAP : full);
        segs.push(`<circle class="donut-seg" data-name="${esc(it.name)}" cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="${it.color}" stroke-width="${thickness}"
          stroke-dasharray="${len} ${Math.max(0, circ - len)}" stroke-dashoffset="${-acc}"
          transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt">
          <title>${esc(it.name)}：${it.count}（${(frac * 100).toFixed(1)}%）</title></circle>`);
        acc += full;
      }
      return `
        <div class="dist-wrap" data-donut>
          <svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle class="donut-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${thickness}"/>
            ${segs.join("")}
            <text class="dist-center-num" data-total="${total}" data-label="${esc(centerLabel)}" x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${chartCenter()}">${total}</text>
            <text class="dist-center-sub" x="${cx}" y="${cy + 18}" text-anchor="middle" fill="${chartCenterSub()}">${esc(centerLabel)}</text>
          </svg>
          <div class="dist-legend">
            ${visible.map(i => `
              <div class="dist-item" data-name="${esc(i.name)}">
                <span class="d-dot" style="background:${i.color}"></span>
                <span class="d-name">${esc(i.name)}</span>
                <span class="d-bar"><i style="width:${total ? Math.max(3, Math.round(i.count / total * 100)) : 0}%;background:${i.color}"></i></span>
                <span class="d-num">${i.count}</span>
                <span class="d-pct">${(i.count / total * 100).toFixed(1)}%</span>
              </div>`).join("")
            }
            ${visible.length ? "" : `<div class="dist-empty">暂无投标项目</div>`}
          </div>
        </div>`;
    }

    // 环形图交互：段 ↔ 图例项双向悬停，中心数字联动（只改 DOM，不重渲染，避免闪烁）
    function bindDonutInteraction() {
      document.querySelectorAll("[data-donut]").forEach(wrap => {
        const numEl = wrap.querySelector(".dist-center-num");
        const subEl = wrap.querySelector(".dist-center-sub");
        if (!numEl) return;
        const baseNum = numEl.dataset.total || numEl.textContent;
        const baseLabel = numEl.dataset.label || (subEl ? subEl.textContent : "");
        const segs = [...wrap.querySelectorAll(".donut-seg")];
        const items = [...wrap.querySelectorAll(".dist-item")];
        const reset = () => {
          wrap.classList.remove("seg-hover");
          segs.forEach(s => s.classList.remove("on"));
          items.forEach(i => i.classList.remove("on"));
          numEl.textContent = baseNum;
          if (subEl) subEl.textContent = baseLabel;
        };
        const activate = (name) => {
          wrap.classList.add("seg-hover");
          segs.forEach(s => s.classList.toggle("on", s.dataset.name === name));
          items.forEach(i => i.classList.toggle("on", i.dataset.name === name));
          const hit = items.find(i => i.dataset.name === name);
          if (hit) {
            numEl.textContent = (hit.querySelector(".d-num") || {}).textContent || baseNum;
            if (subEl) subEl.textContent = name;
          }
        };
        const bind = (el) => {
          el.addEventListener("mouseenter", () => activate(el.dataset.name));
          el.addEventListener("mouseleave", reset);
          el.addEventListener("focus", () => activate(el.dataset.name));
          el.addEventListener("blur", reset);
        };
        segs.forEach(bind);
        items.forEach(bind);
      });
    }

    // 四象限矩阵：位置即语义（左上 重要紧急 / 右上 重要不紧急 / 左下 紧急不重要 / 右下 不重要不紧急）
    function quadMatrixHtml(counts, max) {
      const map = {};
      (counts || []).forEach(q => { map[q.quadrant] = q.count; });
      const cell = (q) => {
        const n = map[q] || 0;
        const color = quadrantColor(q);
        const hint = QUADRANT_HINT[q] || "";
        return `
          <div class="qm-cell" style="--qm-c:${color}" onclick="App.jumpTasks('${esc(q)}')"
               title="点击查看「${esc(q)}」任务（${hint}）" role="button" tabindex="0">
            <div class="qm-top"><span class="qm-dot" style="background:${color}"></span>${esc(q)}</div>
            <div class="qm-count">${n}</div>
            <div class="qm-hint">${esc(hint)}</div>
            <div class="qm-bar"><i style="width:${max ? Math.round(n / max * 100) : 0}%"></i></div>
          </div>`;
      };
      return `
        <div class="quad-matrix">${QUADRANT.map(cell).join("")}</div>
        <div class="qm-axes"><span>← 紧急</span><span>不紧急 →</span></div>`;
    }
    function remindList(list, dateKey, label) {
      if (!list || !list.length) return `<div class="empty">无</div>`;
      return `<div class="list">${list.map(x => `
        <div class="list-item">
          <div class="grow">
            <div class="t">${esc(x.title || x.name || "")}</div>
            <div class="m">${esc(label)}：${esc(fmtYMD(x[dateKey]) || "—")}</div>
          </div>
          ${x.source ? sourceTag(x.source) : (x.openTime ? badge("待开标", "warn") : "")}
        </div>`).join("")}</div>`;
    }

    /* ============================================================
       首页日历：按月聚合"每天要办的事"
       四类来源：任务(任务四象限色) / 投标截止开标(状态色) / 日程提醒 / 客户跟进
       取数双通道：优先 /calendar（后端一次聚合），缺失时用 4 个现有接口自行拼装
       —— 这样后端没升级也能用，升级后自动切到更准的单请求通道。
       ============================================================ */
    const CAL_KEY = "pw-cal";
    let calYM = thisMonthStr();                    // 当前显示月份
    let calSelDate = todayStr();                   // 选中日期
    let calData = null;                            // 当前月数据
    let calSource = "";                            // api | fallback
    let calShow = { task: true, bid: true, schedule: true, customer: true };
    let calHideDone = false;
    let calCollapsed = false;

    const CAL_KIND_LABEL = { task: "任务", bid: "投标", schedule: "日程", customer: "客户" };
    const CAL_KIND_ORDER = { task: 0, bid: 1, schedule: 2, customer: 3 };

    function calLoadPrefs() {
      try {
        const raw = localStorage.getItem(CAL_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (p.show && typeof p.show === "object") calShow = { ...calShow, ...p.show };
        if (typeof p.hideDone === "boolean") calHideDone = p.hideDone;
        if (typeof p.collapsed === "boolean") calCollapsed = p.collapsed;
      } catch (e) { /* 忽略：localStorage 可能不可用 */ }
    }
    function calSavePrefs() {
      try { localStorage.setItem(CAL_KEY, JSON.stringify({ show: calShow, hideDone: calHideDone, collapsed: calCollapsed })); }
      catch (e) { /* 忽略 */ }
    }

    // 月份工具（纯字符串运算，绝不用 new Date("YYYY-MM-DD")）
    function calMonthEnd(ym) {
      const [y, m] = ym.split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      return `${ym}-${String(last).padStart(2, "0")}`;
    }
    function calShiftMonth(ym, delta) {
      const [y, m] = ym.split("-").map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    function calMonthLabel(ym) {
      const [y, m] = ym.split("-");
      return `${y}年${Number(m)}月`;
    }
    function calDayLabel(date) {
      const [, m, d] = date.split("-");
      const week = ["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00`).getDay()];
      return `${Number(m)}月${Number(d)}日 · 周${week}`;
    }
    // 网格单元：周一起始，按需 5 或 6 行
    function calGridCells(ym) {
      const [y, m] = ym.split("-").map(Number);
      const first = new Date(y, m - 1, 1);
      const offset = (first.getDay() + 6) % 7;          // 周一 = 0
      const daysInMonth = new Date(y, m, 0).getDate();
      const rows = Math.ceil((offset + daysInMonth) / 7);
      const cells = [];
      const today = todayStr();
      for (let i = 0; i < rows * 7; i++) {
        const dayNo = i - offset + 1;
        const d = new Date(y, m - 1, dayNo);            // 会自动跨到前后月
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        cells.push({ date, inMonth: dayNo >= 1 && dayNo <= daysInMonth, isToday: date === today, dayNo: d.getDate() });
      }
      return cells;
    }

    // 单条目的配色：任务=四象限色，投标=状态色，日程=主题紫，客户=青色
    function calItemColor(it) {
      if (it.kind === "bid") return bidDistColor(STATUS_DIST_GROUP[it.status] || it.status);
      if (it.kind === "schedule") return isLight() ? "#6d4fd6" : "#a78bfa";
      if (it.kind === "customer") return isLight() ? "#0891b2" : "#22d3ee";
      return quadrantColor(it.sub);
    }
    function calItemVisible(it) {
      if (!calShow[it.kind]) return false;
      if (calHideDone && it.done) return false;
      return true;
    }
    function calItemsOn(date) {
      const list = (calData && calData.days && calData.days[date]) || [];
      return list.filter(calItemVisible);
    }

    /* ---------- 取数：通道 A（后端聚合）---------- */
    async function calFetchFromApi(month) {
      const d = await Store.calendar(month);
      if (!d || !d.days) throw new Error("calendar 响应异常");
      return d;
    }

    /* ---------- 取数：通道 B（用现有接口拼装，语义与后端保持一致）---------- */
    async function calBuildFromApis(month) {
      const end = calMonthEnd(month);
      const [t, p, s, c] = await Promise.all([
        Store.listTasks({ scope: "all", pageSize: 500 }),
        Store.list({ pageSize: 200 }),
        Store.listSchedules({}),
        Store.listCustomers({ pageSize: 500 }),
      ]);
      const today = todayStr();
      const days = {};
      const put = (date, item) => {
        if (!date) return;
        const d = String(date).slice(0, 10);
        if (d < `${month}-01` || d > end) return;
        (days[d] = days[d] || []).push(item);
      };

      const tasks = t.list || [];
      for (const x of tasks) {
        const due = String(x.dueDate || "").slice(0, 10);
        if (!due) continue;
        put(due, {
          kind: "task", id: x.id, title: x.title, date: due, sub: x.quadrant, status: x.status,
          done: x.status === "已完成" || x.status === "已取消",
          source: x.source, customerId: x.customerId ?? null, customerName: x.customerName ?? null,
        });
      }
      // 投标：deadline 与 openTime 相同则合并为一条（与后端一致，避免重复）
      for (const x of (p.list || [])) {
        const dl = x.deadline ? String(x.deadline).slice(0, 10) : null;
        const op = x.openTime ? String(x.openTime).slice(0, 10) : null;
        if (!dl && !op) continue;
        const base = {
          kind: "bid", id: x.id, title: x.name, status: x.status,
          done: ["中标", "未中标", "流标"].includes(x.status),
          tenderer: x.tenderer ?? null, region: x.region ?? null,
        };
        if (dl && (!op || op === dl)) put(dl, { ...base, date: dl, sub: "投标截止 / 开标" });
        else {
          if (dl) put(dl, { ...base, date: dl, sub: "投标截止" });
          if (op) put(op, { ...base, date: op, sub: "开标" });
        }
      }
      for (const x of (s.list || [])) {
        put(x.remindAt, {
          kind: "schedule", id: x.id,
          title: x.projectName ? `${x.remindType}：${x.projectName}` : x.remindType,
          date: String(x.remindAt || "").slice(0, 10),
          sub: x.advanceMinutes ? `提前 ${x.advanceMinutes} 分钟` : "日程提醒",
          status: x.status, done: x.status !== "待提醒", projectId: x.projectId ?? null,
        });
      }
      for (const x of (c.list || [])) {
        if (x.status === "流失") continue;
        put(x.nextFollowDate, {
          kind: "customer", id: x.id, title: `跟进：${x.name}`,
          date: String(x.nextFollowDate || "").slice(0, 10),
          sub: [x.contactName, x.contactPhone].filter(Boolean).join(" ") || "客户跟进",
          status: x.status, done: false,
        });
      }
      const OPEN = ["待办", "进行中"];
      const overdue = tasks
        .filter(x => OPEN.includes(x.status) && x.dueDate && String(x.dueDate).slice(0, 10) < today)
        .map(x => ({
          kind: "task", id: x.id, title: x.title, date: String(x.dueDate).slice(0, 10),
          sub: x.quadrant, status: x.status, done: false, source: x.source,
          customerId: x.customerId ?? null, customerName: x.customerName ?? null,
        }));
      const undated = tasks
        .filter(x => OPEN.includes(x.status) && !x.dueDate)
        .map(x => ({
          kind: "task", id: x.id, title: x.title, date: null, sub: x.quadrant,
          status: x.status, done: false, source: x.source,
          customerId: x.customerId ?? null, customerName: x.customerName ?? null,
        }));
      const count = (kind) => Object.values(days).reduce((n, l) => n + l.filter(x => x.kind === kind).length, 0);
      return {
        month, start: `${month}-01`, end, days, overdue, undated, today,
        daysInMonth: Number(end.slice(8)), source: "fallback",
        counts: { task: count("task"), bid: count("bid"), schedule: count("schedule"), customer: count("customer") },
      };
    }

    async function calLoad(month) {
      try {
        const d = await calFetchFromApi(month);
        calData = { ...d, days: calSortDays(d.days) };
        calSource = "api";
      } catch (e) {
        // 接口不存在（后端未升级）或异常 → 回退拼装；两者都失败则抛给调用方
        const d = await calBuildFromApis(month);
        calData = { ...d, days: calSortDays(d.days) };
        calSource = "fallback";
      }
      return calData;
    }
    function calSortDays(days) {
      const out = {};
      for (const [d, list] of Object.entries(days || {})) {
        out[d] = [...list].sort((a, b) => (CAL_KIND_ORDER[a.kind] - CAL_KIND_ORDER[b.kind]) || (a.id - b.id));
      }
      return out;
    }

    /* ---------- 日历渲染 ---------- */
    // 格子里的一条彩色小标签
    function calChip(it) {
      const c = calItemColor(it);
      const full = String(it.title || "");
      const short = full.length > 10 ? full.slice(0, 10) + "…" : full;
      return `<span class="cal-chip${it.done ? " done" : ""}" style="--c:${c}" title="${esc(full)}（${esc(it.sub || CAL_KIND_LABEL[it.kind])}）">${esc(short)}</span>`;
    }
    function calCellHtml(cell) {
      const items = cell.inMonth ? calItemsOn(cell.date) : [];
      const shown = items.slice(0, 3);
      const more = items.length - shown.length;
      const hasOverdue = cell.isToday && calShow.task && (calData.overdue || []).length > 0;
      return `<div class="cal-cell${cell.inMonth ? "" : " out"}${cell.isToday ? " today" : ""}${calSelDate === cell.date ? " sel" : ""}"
        data-cal-day="${cell.date}" role="button" tabindex="0"
        title="${esc(cell.date)}${items.length ? " · " + items.length + " 件事" : ""}">
        <div class="cal-dnum">${cell.dayNo}${hasOverdue ? `<i class="cal-od" title="有逾期未办"></i>` : ""}</div>
        <div class="cal-chips">${shown.map(calChip).join("")}${more > 0 ? `<span class="cal-more">+${more}</span>` : ""}</div>
      </div>`;
    }
    // 明细区里的一行
    function calRowHtml(it, curDate, hideDate = false) {
      const c = calItemColor(it);
      const canDone = it.kind === "task" && !it.done;
      const meta = [
        it.sub,
        (!hideDate && it.date && it.date !== curDate) ? fmtYMD(it.date) : "",
        it.status && it.kind !== "task" ? it.status : "",
      ].filter(Boolean).join(" · ");
      return `<div class="list-item cal-row${it.done ? " done" : ""}">
        <span class="cal-kind" style="--c:${c}">${esc(CAL_KIND_LABEL[it.kind])}</span>
        <div class="grow">
          <div class="t">${esc(it.title)}</div>
          <div class="m">${esc(meta)}</div>
        </div>
        ${canDone ? `<button class="btn btn-primary btn-sm" data-cal-done="${it.id}" data-cal-source="${esc(it.source || "manual")}" data-cal-cust="${it.customerId || ""}">完成</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-cal-open="${esc(it.kind)}:${it.id}">打开</button>
      </div>`;
    }
    function calPanelHtml() {
      if (calSelDate === "__undated__") {
        const list = (calData.undated || []).filter(calItemVisible);
        return `<div class="cal-panel-title">未排期的待办 <span class="muted">${list.length} 件</span></div>` +
          (list.length ? `<div class="list">${list.map(it => calRowHtml(it, null)).join("")}</div>`
            : `<div class="empty">没有未排期的待办</div>`);
      }
      const date = calSelDate;
      const isToday = date === todayStr();
      const items = calItemsOn(date);
      const overdue = isToday ? (calData.overdue || []).filter(calItemVisible) : [];
      const parts = [];
      parts.push(`<div class="cal-panel-title">${esc(calDayLabel(date))}${isToday ? "（今天）" : ""} <span class="muted">${items.length} 件事</span></div>`);
      if (overdue.length) {
        parts.push(`<div class="cal-od-block">
          <div class="cal-od-title">逾期未办 ${overdue.length} 件（仍显示在原定日期里）</div>
          <div class="list">${overdue.map(it => calRowHtml(it, null, true)).join("")}</div>
        </div>`);
      }
      parts.push(items.length ? `<div class="list">${items.map(it => calRowHtml(it, date)).join("")}</div>`
        : `<div class="empty">这天没有安排</div>`);
      parts.push(`<div class="cal-panel-foot"><button class="btn btn-green btn-sm" data-cal-add="${esc(date)}">＋ 在这天新增待办</button></div>`);
      return parts.join("");
    }
    // 窄窗口用的"按日期分组清单"
    function calAgendaHtml() {
      const dates = Object.keys(calData.days || {}).filter(d => calItemsOn(d).length).sort();
      if (!dates.length) return `<div class="empty">本月暂无安排</div>`;
      const today = todayStr();
      let total = 0;
      const blocks = dates.map(d => {
        const list = calItemsOn(d);
        total += list.length;
        return `<div class="cal-ag-group">
          <div class="cal-ag-date${d === today ? " today" : ""}">${esc(calDayLabel(d))}${d === today ? "（今天）" : ""}<span class="muted">${list.length} 件</span>
            <button class="cal-add-mini" data-cal-add="${esc(d)}" title="在这天新增待办">＋</button>
          </div>
          ${list.map(it => calRowHtml(it, d, true)).join("")}
        </div>`;
      }).join("");
      return blocks + `<div class="muted" style="margin-top:8px">本月共 ${total} 件</div>`;
    }
    function calCardInner() {
      const kinds = ["task", "bid", "schedule", "customer"];
      const counts = calData.counts || {};
      const undated = (calData.undated || []).filter(calItemVisible).length;
      const head = `
        <div class="cal-head">
          <div class="cal-head-left">
            <h3 class="card-title">日历</h3>
            ${calSource === "fallback" ? `<span class="cal-src" title="后端 /calendar 接口尚未生效，已改用现有接口在本机拼装；重启后端后会自动切换到更准的聚合接口">本地拼装</span>` : ""}
          </div>
          <div class="cal-controls">
            <button class="cal-nav-btn" data-cal-nav="-1" aria-label="上个月" title="上个月">‹</button>
            <span class="cal-ym">${esc(calMonthLabel(calYM))}</span>
            <button class="cal-nav-btn" data-cal-nav="1" aria-label="下个月" title="下个月">›</button>
            <button class="btn btn-ghost btn-sm" data-cal-today>今天</button>
            <span class="cal-sep"></span>
            ${kinds.map(k => `<span class="chip ${calShow[k] ? "on" : ""}" data-cal-toggle="${k}" title="显示 / 隐藏${CAL_KIND_LABEL[k]}">${CAL_KIND_LABEL[k]} ${counts[k] ?? 0}</span>`).join("")}
            <span class="chip ${calHideDone ? "on" : ""}" data-cal-hidedone title="隐藏已完成/已取消">只看未完成</span>
            ${undated ? `<span class="chip${calSelDate === "__undated__" ? " on" : ""}" data-cal-undated title="查看没有截止日的待办">待安排 ${undated}</span>` : ""}
            <button class="btn btn-ghost btn-sm" data-cal-collapse title="${calCollapsed ? "展开日历" : "收起日历"}">${calCollapsed ? "展开" : "折叠"}</button>
          </div>
        </div>`;
      if (calCollapsed) return head + `<div class="cal-collapsed muted">已收起 · ${esc(calMonthLabel(calYM))} 共 ${Object.values(calData.days || {}).flat().filter(calItemVisible).length} 件安排</div>`;
      return head + `
        <div class="cal-body">
          <div class="cal-grid-wrap">
            <div class="cal-week">${["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map(w => `<span>${w}</span>`).join("")}</div>
            <div class="cal-grid">${calGridCells(calYM).map(calCellHtml).join("")}</div>
          </div>
          <div class="cal-panel">${calPanelHtml()}</div>
        </div>
        <div class="cal-agenda">${calAgendaHtml()}</div>`;
    }
    function renderCalendarCard() {
      const body = calData ? calCardInner()
        : `<h3 class="card-title">日历</h3><div class="empty">日历数据加载失败，请点击下方「重新加载」</div>`;
      return `<div class="card card-pad cal-card" id="calCard">${body}</div>`;
    }
    // 只重绘日历卡片本身（不整页重渲染，保留滚动位置、不重复请求其它接口）
    function refreshCalendarCard() {
      const el = document.getElementById("calCard");
      if (!el) return;
      el.innerHTML = calData ? calCardInner() : `<h3 class="card-title">日历</h3><div class="empty">日历数据加载失败</div>`;
      bindCalendarEvents();
    }
    async function calReload() {
      try { await calLoad(calYM); } catch (e) { calData = null; toast("日历加载失败：" + friendlyError(e)); }
      refreshCalendarCard();
    }

    function bindCalendarEvents() {
      document.querySelectorAll("[data-cal-nav]").forEach(el => el.addEventListener("click", async () => {
        const delta = Number(el.dataset.calNav);
        calYM = calShiftMonth(calYM, delta);
        calSelDate = calYM === thisMonthStr() ? todayStr() : `${calYM}-01`;
        await calReload();
      }));
      document.querySelectorAll("[data-cal-today]").forEach(el => el.addEventListener("click", async () => {
        calYM = thisMonthStr();
        calSelDate = todayStr();
        await calReload();
      }));
      document.querySelectorAll("[data-cal-toggle]").forEach(el => el.addEventListener("click", () => {
        const k = el.dataset.calToggle;
        calShow[k] = !calShow[k];
        calSavePrefs();
        refreshCalendarCard();
      }));
      document.querySelectorAll("[data-cal-hidedone]").forEach(el => el.addEventListener("click", () => {
        calHideDone = !calHideDone;
        calSavePrefs();
        refreshCalendarCard();
      }));
      document.querySelectorAll("[data-cal-collapse]").forEach(el => el.addEventListener("click", () => {
        calCollapsed = !calCollapsed;
        calSavePrefs();
        refreshCalendarCard();
      }));
      document.querySelectorAll("[data-cal-undated]").forEach(el => el.addEventListener("click", () => {
        calSelDate = "__undated__";
        refreshCalendarCard();
      }));
      document.querySelectorAll("[data-cal-day]").forEach(el => el.addEventListener("click", () => {
        const d = el.dataset.calDay;
        if (calSelDate === d && d !== todayStr()) { calSelDate = todayStr(); }  // 再点已选中的那天 → 回到今天
        else { calSelDate = d; }
        refreshCalendarCard();
      }));
      document.querySelectorAll("[data-cal-done]").forEach(el => el.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const id = el.dataset.calDone;
        if (el.dataset.calSource === "customer") {
          // 客户跟进任务：完成后要问下次跟进日期 → 走统一弹窗，并在完成后刷新日历
          askCompleteTask({ id, source: "customer", customer: el.dataset.calCust || "customer" },
            async () => { renderSidebar(); await calReload(); });
        } else {
          try { await Store.completeTask(id, null); toast("任务已完成 ✓"); }
          catch (e) { toast("操作失败：" + friendlyError(e)); }
          renderSidebar();
          await calReload();
        }
      }));
      document.querySelectorAll("[data-cal-open]").forEach(el => el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const [kind, id] = String(el.dataset.calOpen).split(":");
        if (kind === "task") openTaskForm(id);
        else if (kind === "bid") openProjectForm(id);
        else if (kind === "schedule") openScheduleForm(id);
        else if (kind === "customer") openCustomerDetail(id);
      }));
      document.querySelectorAll("[data-cal-add]").forEach(el => el.addEventListener("click", () => {
        openTaskForm(null, { dueDate: el.dataset.calAdd });   // 截止日预填这一天
      }));
      // 系统图谱：切换 / 重载 / 新窗口打开
      document.querySelectorAll("[data-graph]").forEach(el => el.addEventListener("click", () => {
        graphSel = el.dataset.graph;
        renderMain();
      }));
      document.querySelectorAll("[data-graph-reload]").forEach(el => el.addEventListener("click", () => {
        const f = document.getElementById("graphFrame");
        if (f) f.src = f.src;      // 重新拉取当前图谱
        toast("已重新加载图谱");
      }));
      document.querySelectorAll("[data-graph-open]").forEach(el => el.addEventListener("click", () => {
        window.open(graphUrl(el.dataset.graphOpen), "_blank", "noopener");
      }));
    }

    async function viewHome() {
      let d = null, rem = null;
      try { d = await Store.personalDashboard(); } catch (e) { /* 由下方错误提示 */ }
      try { rem = await Store.remindersToday(); } catch (e) { /* 可选 */ }
      // 日历：加载当前显示月份的数据（失败也不影响首页其它部分）
      try { await calLoad(calYM); } catch (e) { calData = null; }
      notifyReminders(rem);
      if (!d) throw new Error("无法加载个人总览，请确认后端已启动");
      const qMax = Math.max(1, ...d.quadrantCounts.map(x => x.count));
      const recurPct = d.recurringThisMonth.total > 0 ? Math.round(d.recurringThisMonth.done / d.recurringThisMonth.total * 100) : 0;

      // ---- Homarr 风格磁贴 ----
      const tile = (icon, c1, c2, name, desc, badgeHtml, target) => `
        <div class="tile" style="--tile-c1:${c1};--tile-c2:${c2}" onclick="App.go('${target}')" title="${esc(desc)}">
          <span class="t-icon">${svgIcon(icon, 21)}</span>
          <div class="t-name">${esc(name)}${badgeHtml}</div>
          <div class="t-desc">${esc(desc)}</div>
        </div>`;
      const openBadge = d.overdue > 0 ? `<span class="t-badge danger">${d.overdue} 逾期</span>`
        : d.today > 0 ? `<span class="t-badge warn">${d.today} 今日</span>`
        : `<span class="t-badge ok">${d.open} 待办</span>`;
      const tiles = [
        tile("check-square", "#5b8cff", "#7d5bff", "待办看板", "四象限 · 今日截止 · 周期实例", openBadge, "tasks"),
        tile("repeat", "#10b981", "#0ea5e9", "周期任务", "每月固定任务模板与本月进度", d.recurringThisMonth.total ? `<span class="t-badge ok">${d.recurringThisMonth.done}/${d.recurringThisMonth.total}</span>` : "", "templates"),
        tile("users", "#f59e0b", "#f97316", "客户档案", "客户资料与跟进状态", d.customersNeedFollow ? `<span class="t-badge danger">${d.customersNeedFollow} 需跟进</span>` : `<span class="t-badge ok">0</span>`, "customers"),
        tile("message-circle", "#ec4899", "#a855f7", "跟进记录", "客户沟通流水 · 自动待办", d.recentFollowUps.length ? `<span class="t-badge">${d.recentFollowUps.length}</span>` : "", "followups"),
        tile("briefcase", "#3b82f6", "#06b6d4", "投标项目", "项目登记 · 状态流转 · 报价", `<span class="t-badge">${d.bid.active}</span>`, "projects"),
        tile("clipboard", "#0ea5e9", "#6366f1", "标书编制", "技术标全过程 · 8 阶段 4 闸口", "", "main"),
        tile("layout", "#8b5cf6", "#6366f1", "投标概览", "跟踪进度 · 近期开标", d.bid.upcomingOpenings ? `<span class="t-badge warn">${d.bid.upcomingOpenings} 待开标</span>` : "", "overview"),
        tile("chart", "#14b8a6", "#22c55e", "统计分析", "状态分布 · 类别 · 中标率", "", "stats"),
        tile("book", "#64748b", "#94a3b8", "系统图谱", "状态机 · 客户闭环 · 幂等规则", "", "kb"),
      ].join("");

      // 今日提醒分组（逾期 / 今日 / 按提前天数 / 7天内 / 日程提醒 / 近期开标）
      const remOverdue = (rem && rem.overdueTasks) || [];
      const remToday = (rem && rem.todayTasks) || [];
      const remRemind = (rem && rem.remindSoonTasks) || [];   // 由每张任务自己的"提前提醒（天）"触发
      const remSoon = (rem && rem.soonTasks) || [];
      const remSched = (rem && rem.dueSchedules) || [];
      const remOpen = (rem && rem.upcomingOpenings) || [];
      const head = (txt, color, icon) =>
        `<div style="font-size:12px;color:${color};font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:5px">${svgIcon(icon, 13)} ${txt}</div>`;
      // 每组最多显示 3 条（原来 5 条）：既让卡片不至于过高，也避免首页被单组塞满
      const CAP = 3;
      const moreHint = (n) => n > 0 ? `<div class="muted rem-more">还有 ${n} 条，见待办看板</div>` : "";
      const remindBlocks = [];
      if (remOverdue.length) remindBlocks.push(`<div class="rem-group">${head(`逾期任务（${remOverdue.length}）`, "var(--red)", "alert")}${remindList(remOverdue.slice(0, CAP), "dueDate", "截止")}${moreHint(remOverdue.length - CAP)}</div>`);
      if (remToday.length) remindBlocks.push(`<div class="rem-group">${head(`今日到期（${remToday.length}）`, "var(--yellow)", "clock")}${remindList(remToday.slice(0, CAP), "dueDate", "截止")}${moreHint(remToday.length - CAP)}</div>`);
      if (remRemind.length) remindBlocks.push(`<div class="rem-group">${head(`提前提醒（${remRemind.length}）`, "var(--accent)", "bell")}${remindList(remRemind.slice(0, CAP), "dueDate", "截止")}${moreHint(remRemind.length - CAP)}</div>`);
      if (remSoon.length) remindBlocks.push(`<div class="rem-group">${head(`${rem.soonDays || 7} 天内到期（${remSoon.length}）`, "var(--text-secondary)", "clock")}${remindList(remSoon.slice(0, CAP), "dueDate", "截止")}${moreHint(remSoon.length - CAP)}</div>`);
      if (remSched.length) {
        remindBlocks.push(`<div class="rem-group">${head(`日程提醒（${remSched.length}）`, "var(--accent-2)", "calendar")}
          <div class="list">${remSched.slice(0, CAP).map(s => `
            <div class="list-item">
              <div class="grow">
                <div class="t">${esc(s.projectName || "未关联项目")} · ${esc(s.remindType)}</div>
                <div class="m">${esc(fmtYMD(s.remindAt))}${s.advanceMinutes ? `（提前 ${s.advanceMinutes} 分钟）` : ""}${s.overdue ? " · 已过期未确认" : ""}</div>
              </div>
              ${s.overdue ? badge("已过期", "danger") : badge("待提醒", "warn")}
            </div>`).join("")}</div>${moreHint(remSched.length - CAP)}
        </div>`);
      }
      if (remOpen.length) {
        remindBlocks.push(`<div class="rem-group">${head(`近期开标（${rem.upcomingDays || 30} 天内 ${remOpen.length} 个）`, "var(--green)", "target")}
          <div class="list">${remOpen.slice(0, CAP).map(p => `
            <div class="list-item">
              <div class="grow">
                <div class="t">${esc(p.name)}</div>
                <div class="m">开标/投标截止：${esc(fmtYMD(p.openTime))} · 剩余 ${daysLeft(p.openTime)} 天</div>
              </div>
              ${badge(p.status, STATUS_STYLE[p.status] || "")}
            </div>`).join("")}</div>${moreHint(remOpen.length - CAP)}
        </div>`);
      }
      if (!remOverdue.length && !remToday.length && !remRemind.length && !remSoon.length && !remSched.length && !remOpen.length) {
        remindBlocks.push(`<div class="empty" style="padding:22px 0">${svgIcon('check', 16)} 今天暂无到期提醒</div>`);
      }

      const dueCustHtml = (rem && rem.dueCustomers.length)
        ? `<div class="list">${rem.dueCustomers.slice(0, 6).map(c => `
            <div class="list-item">
              <div class="grow"><div class="t">${esc(c.name)}</div><div class="m">下次跟进：${esc(fmtYMD(c.nextFollowDate))}</div></div>
              <button class="btn btn-ghost btn-sm" data-navto="customers">处理</button>
            </div>`).join("")}</div>`
        : `<div class="empty" style="padding:20px 0">暂无到期跟进客户</div>`;

      const recentFollowHtml = (d.recentFollowUps && d.recentFollowUps.length)
        ? `<div class="list">${d.recentFollowUps.slice(0, 6).map(f => `
            <div class="list-item">
              <div class="grow">
                <div class="t">${esc(f.customerName || "#" + f.customerId)} · ${esc(f.followType)}</div>
                <div class="m">${esc(String(f.content || "").slice(0, 56))}${f.nextFollowDate ? " · 下次 " + esc(fmtYMD(f.nextFollowDate)) : ""}</div>
              </div>
              <span class="muted">${esc(fmtYMD(f.followAt))}</span>
            </div>`).join("")}</div>`
        : `<div class="empty" style="padding:20px 0">暂无跟进记录</div>`;

      // 状态分布（6 类口径）+ 行业分布（按当前主题取色板）
      const statusDistItems = d.bidDist.map(x => ({ name: x.name, count: x.count, color: bidDistColor(x.name) }));
      const indUsed = new Set(industryPalette());
      const indItems = (d.industryDist || []).map(x => {
        let c = industryColor(x.name);
        if (!c) {
          const palette = industryPalette();
          c = palette.find(p => !indUsed.has(p)) || (isLight() ? "#98a2b3" : "#94a3b8");
          indUsed.add(c);
        }
        return { name: x.name, count: x.count, color: c };
      });

      const nowH = new Date().getHours();
      const greet = nowH < 6 ? "夜深了" : nowH < 12 ? "早上好" : nowH < 14 ? "中午好" : nowH < 18 ? "下午好" : "晚上好";
      const week = ["日", "一", "二", "三", "四", "五", "六"][new Date().getDay()];

      return `
        <div class="hero">
          <div>
            <h1>${greet}，这是你的工作台</h1>
            <div class="sub">逾期 ${d.overdue} · 今日 ${d.today} · 7 天内 ${d.in7days} · 进行中 ${d.doing} · 需跟进客户 ${d.customersNeedFollow}</div>
          </div>
          <div class="date-chip">${svgIcon("calendar", 14)} ${esc(fmtYMD(d.todayStr))} · 周${week}</div>
        </div>
        <div class="tile-grid">${tiles}</div>
        ${renderCalendarCard()}
        <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr));gap:14px;margin-top:14px">
          <div class="card card-pad">
            <h3 class="card-title">项目状态分布（共 ${d.bidTotal} 个 · 含历史）</h3>
            ${donutHtml(statusDistItems, d.bidTotal, 200, 26, "投标项目")}
            <div style="margin-top:8px" class="muted">点击磁贴「投标概览」查看全部项目</div>
          </div>
          <div class="card card-pad">
            <h3 class="card-title">行业分布（共 ${d.industryTotal || 0} 个）</h3>
            ${donutHtml(indItems, d.industryTotal || 0, 200, 26, "含历史项目")}
            <div style="margin-top:8px" class="muted">行业字段在新增/编辑项目时填写</div>
          </div>
        </div>
        <!-- 两列各自独立堆叠（.home-col）：同一排不再被"最高卡片"撑出空档。
             原来这里是一个个 .cols 行，今日提醒变高后，隔壁四象限下方就空出约 270px。 -->
        <div class="home-split">
          <div class="home-col">
            <div class="card card-pad">
              <h3 class="card-title">今日提醒</h3>
              ${remindBlocks.join("")}
              <div style="display:flex;gap:8px;margin-top:4px">
                <button class="btn btn-ghost btn-sm" onclick="App.go('tasks')">${svgIcon('check-square', 13)} 打开待办看板</button>
                <button class="btn btn-ghost btn-sm" onclick="App.go('followups')">${svgIcon('message-circle', 13)} 记录跟进</button>
              </div>
            </div>
            <div class="card card-pad">
              <h3 class="card-title">投标动态</h3>
              <div class="bid-dynamic-grid">
                <div class="stat stat-click" title="查看全部投标项目" onclick="App.jumpProjects('全部')"><div class="stat-label">进行中项目</div><div class="stat-value">${d.bid.active}</div><div class="stat-hint">跟踪/报名/购标/已投标</div></div>
                <div class="stat stat-click" title="查看全部投标项目" onclick="App.jumpProjects('全部')"><div class="stat-label">待开标</div><div class="stat-value">${d.bid.upcomingOpenings}</div><div class="stat-hint">未出结果</div></div>
                <div class="stat stat-click" title="查看已中标项目" onclick="App.jumpProjects('中标')"><div class="stat-label">已中标</div><div class="stat-value" style="color:var(--green)">${d.bid.won}</div><div class="stat-hint">累计</div></div>
                <div class="stat stat-click" title="查看未中标项目" onclick="App.jumpProjects('未中标')"><div class="stat-label">未中标 / 流标</div><div class="stat-value" style="color:var(--red)">${d.bid.lost}</div><div class="stat-hint">累计失败</div></div>
              </div>
            </div>
          </div>
          <div class="home-col">
            <div class="card card-pad">
              <h3 class="card-title">重要紧急四象限 <span class="muted" style="font-weight:400">（点击进入看板）</span></h3>
              ${quadMatrixHtml(d.quadrantCounts, qMax)}
              <div style="margin-top:12px;border-top:1px solid var(--border-l1);padding-top:10px" class="mini-progress">
                <span>本月周期任务</span><div class="mini-bar"><div style="width:${recurPct}%"></div></div>
                <span class="mini-pct">${recurPct}%</span>
                <span>${d.recurringThisMonth.done}/${d.recurringThisMonth.total}</span>
              </div>
            </div>
            <div class="card card-pad">
              <h3 class="card-title">客户需跟进（${d.customersNeedFollow} 家）</h3>
              ${dueCustHtml}
            </div>
            <div class="card card-pad">
              <h3 class="card-title">最近跟进</h3>
              ${recentFollowHtml}
            </div>
          </div>
        </div>`;
    }

    /* ---------------- 待办看板（任务 & 待办） ---------------- */
    function taskCardHtml(t) {
      const done = t.status === "已完成" || t.status === "已取消";
      const dueCls = done ? "" : dueClass(t.dueDate);
      return `
        <div class="task-chip" data-task-open="${t.id}" data-task-title="${esc(t.title)}" data-task-status="${esc(t.status)}" data-task-source="${esc(t.source)}" data-task-customer="${t.customerId || ""}">
          <div class="tc-title ${done ? "done-title" : ""}">${esc(t.title)}</div>
          ${t.notes ? `<div class="muted" style="margin-top:2px;line-height:1.5">${esc(String(t.notes).slice(0, 80))}${t.notes.length > 80 ? "…" : ""}</div>` : ""}
          <div class="tc-meta">
            ${sourceTag(t.source)}
            <span class="tc-due ${dueCls}">${t.dueDate ? "截止 " + fmtYMD(t.dueDate) : "无截止"}</span>
            ${t.remindDays > 0 ? `<span class="muted">提前${t.remindDays}天提醒</span>` : ""}
            ${t.status === "进行中" ? badge("进行中", "info") : ""}
          </div>
          <div class="tc-actions">
            ${!done ? `<button class="btn btn-primary btn-sm" data-task-done="${t.id}" data-task-title="${esc(t.title)}" data-task-source="${esc(t.source)}" data-task-customer="${t.customerId || ""}">完成</button>
            ${t.status !== "进行中" ? `<button class="btn btn-ghost btn-sm" data-task-progress="${t.id}">进行中</button>` : ""}` : `<button class="btn btn-ghost btn-sm" data-task-reopen="${t.id}">重开</button>`}
            <button class="btn btn-ghost btn-sm" data-task-edit="${t.id}">编辑</button>
            <button class="btn btn-danger btn-sm" data-task-del="${t.id}" data-task-title="${esc(t.title)}">删除</button>
          </div>
        </div>`;
    }

    function quadrantColHtml(quadrant, tasks) {
      const color = QUADRANT_COLOR[quadrant];
      const html = tasks.length
        ? tasks.map(taskCardHtml).join("")
        : `<div class="empty" style="padding:16px 0">空</div>`;
      return `
        <div class="quad-col">
          <div class="quad-col-head">
            <span class="dot" style="background:${color}"></span>
            <span>${esc(quadrant)}</span>
            <span class="cnt">${tasks.length}</span>
          </div>
          <div class="quad-col-body">${html}</div>
        </div>`;
    }

    async function viewTasks() {
      // 进入待办看板时，只为「当前月」幂等补齐周期实例（后端不再因 GET 请求写库，
      // 所以浏览历史/未来月份不会再凭空生成那一期的任务）。
      if (taskScope === "open" && !taskQ.trim()) {
        try {
          const r = await Store.ensureMonth(thisMonthStr());
          if (r && r.generated > 0) toast(`已生成本月周期任务 ${r.generated} 条`);
        } catch (e) { /* 静默：不影响看板展示 */ }
      }
      const isKanban = taskScope === "open" && taskQuadrant === "全部";
      const params = { scope: taskScope, pageSize: isKanban ? KANBAN_CAP : PAGE_SIZE };
      if (!isKanban) params.page = taskPage;
      // open 视图显示全部未完成（跨月）；done/all 按月份过滤
      if (taskScope !== "open" && taskMonth) params.month = taskMonth;
      if (taskQuadrant !== "全部") params.quadrant = taskQuadrant;
      if (taskQ.trim()) params.q = taskQ.trim();
      const { list, total } = await Store.listTasks(params);
      const taskPager = isKanban ? "" : pagerHtml(total, taskPage, PAGE_SIZE, "task");
      const kanbanHint = (isKanban && total > KANBAN_CAP)
        ? `<div class="muted" style="margin:10px 0 0">未完成任务共 ${total} 条，看板仅展示最近 ${KANBAN_CAP} 条；可用筛选 / 搜索缩小范围。</div>` : "";
      const scopeChips = [["open", "未完成"], ["done", "已完成"], ["all", "全部"]].map(([v, l]) =>
        `<span class="chip ${taskScope === v ? "on" : ""}" data-task-scope="${v}">${esc(l)}</span>`).join("");
      const quadChips = ["全部", ...QUADRANT].map(q =>
        `<span class="chip ${taskQuadrant === q ? "on" : ""}" data-task-quad="${esc(q)}">${esc(q)}</span>`).join("");

      let tableHtml = "";
      if (isKanban) {
        const byQ = {};
        QUADRANT.forEach(q => byQ[q] = []);
        list.forEach(t => { if (byQ[t.quadrant] !== undefined) byQ[t.quadrant].push(t); });
        tableHtml = `<div class="kanban">${QUADRANT.map(q => quadrantColHtml(q, byQ[q])).join("")}</div>`;
      } else {
        // 列表视图
        const statusBadgeLocal = (s) => badge(s, TASK_STATUS_STYLE[s] || "");
        tableHtml = `<div class="card"><div class="table-wrap"><table class="grid">
          <thead><tr><th>任务</th><th>象限</th><th>来源</th><th>状态</th><th>截止</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${list.length ? list.map(t => `<tr>
            <td class="ellipsis" style="max-width:340px"><div style="font-weight:600">${esc(t.title)}</div>${t.customerName ? `<div class="muted">客户：${esc(t.customerName)}</div>` : ""}${t.notes ? `<div class="muted">${esc(String(t.notes).slice(0,60))}</div>` : ""}</td>
            <td>${esc(t.quadrant)}</td>
            <td>${sourceTag(t.source)}</td>
            <td>${statusBadgeLocal(t.status)}</td>
            <td class="${dueClass(t.dueDate)}">${fmtYMD(t.dueDate) || "—"}</td>
            <td style="text-align:right; white-space:nowrap">
              ${t.status !== "已完成" && t.status !== "已取消"
                ? `<button class="btn btn-primary btn-sm" data-task-done="${t.id}" data-task-title="${esc(t.title)}" data-task-source="${esc(t.source)}" data-task-customer="${t.customerId || ""}">完成</button>`
                : `<button class="btn btn-ghost btn-sm" data-task-reopen="${t.id}">重开</button>`}
              <button class="btn btn-ghost btn-sm" data-task-edit="${t.id}">编辑</button>
              <button class="btn btn-danger btn-sm" data-task-del="${t.id}" data-task-title="${esc(t.title)}">删除</button>
            </td>
          </tr>`).join("") : `<tr><td colspan="6"><div class="empty">暂无任务</div></td></tr>`}</tbody>
        </table></div></div>`;
      }
      return `
        <div class="page-head">
          <div><h1 class="page-title">待办看板</h1><p class="page-sub">按重要紧急四象限组织；每月固定任务已按周期模板自动生成本月实例。点击任务卡片可编辑。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openTaskForm()"> 新增任务</button></div>
        </div>
        <div class="filter-bar">
          <div class="month-pick">
            <input type="month" id="taskMonth" value="${esc(taskMonth)}" data-task-month />
          </div>
          ${scopeChips}
          ${quadChips}
          <span class="spacer"></span>
          ${taskQ ? `<span class="chip on" data-task-clear-q>搜索：${esc(taskQ)} ✕</span>` : ""}
          <span class="muted">共 ${total} 条</span>
        </div>
        ${tableHtml}${kanbanHint}${taskPager}`;
    }

    /* ---------------- 周期任务模板 ---------------- */
    async function viewTemplates() {
      const { list } = await Store.listTemplates();
      const quadDot = (q) => `<span class="dot" style="width:8px;height:8px;border-radius:2px;display:inline-block;background:${quadrantColor(q)};margin-right:4px"></span>`;
      return `
        <div class="page-head">
          <div><h1 class="page-title">周期任务模板</h1><p class="page-sub">定义每月固定任务（如每月 28 日汇总经营数据）；进入「待办看板」时系统会自动为当前月份生成实例，历史实例独立可完成。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openTemplateForm()"> 新增模板</button></div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>任务名</th><th>每月执行日</th><th>象限</th><th>提前提醒</th><th>状态</th><th>已完成/总数</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(t => `<tr>
              <td class="ellipsis" style="max-width:280px"><div style="font-weight:600">${esc(t.name)}</div>${t.notes ? `<div class="muted">${esc(t.notes)}</div>` : ""}</td>
              <td>每月 ${t.dayOfMonth} 日</td>
              <td>${quadDot(t.quadrant)}${esc(t.quadrant)}</td>
              <td>${t.remindDays > 0 ? `提前 ${t.remindDays} 天` : "当天"}</td>
              <td>${t.active ? badge("启用", "done") : badge("停用", "")}</td>
              <td><span class="mini-progress" style="min-width:110px"><span>${t.instanceDone}/${t.instanceTotal}</span></span></td>
              <td style="text-align:right; white-space:nowrap">
                <button class="btn btn-ghost btn-sm" data-tpl-gen="${t.id}" data-name="${esc(t.name)}">生成本月</button>
                <button class="btn btn-ghost btn-sm" data-tpl-edit="${t.id}">编辑</button>
                <button class="btn btn-danger btn-sm" data-tpl-del="${t.id}" data-name="${esc(t.name)}">删除</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="7"><div class="empty">暂无周期任务模板，点击「新增模板」创建每月固定任务。</div></td></tr>`}</tbody>
          </table></div>
        </div>`;
    }

    /* ---------------- 客户档案 ---------------- */
    async function viewCustomers() {
      const params = { page: custPage, pageSize: PAGE_SIZE };
      if (custStatus !== "全部") params.status = custStatus;
      if (custQ.trim()) params.q = custQ.trim();
      const { list, total } = await Store.listCustomers(params);
      const custPager = pagerHtml(total, custPage, PAGE_SIZE, "cust");
      const chips = ["全部", ...CUSTOMER_STATUS].map(s =>
        `<span class="chip ${s === custStatus ? "on" : ""}" data-cust-status="${esc(s)}">${esc(s)}</span>`).join("");
      return `
        <div class="page-head">
          <div><h1 class="page-title">客户档案</h1><p class="page-sub">记录客户信息与跟进状态；「记录跟进」时填写的下次跟进日期会自动生成待办。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openCustomerForm()"> 新增客户</button></div>
        </div>
        <div class="filter-bar">
          ${chips}
          <span class="spacer"></span>
          <input type="text" id="custSearch" placeholder="搜索客户 / 联系人 / 电话…" value="${esc(custQ)}" style="max-width:220px" />
          ${custQ ? `<span class="chip on" data-cust-clear-q>搜索：${esc(custQ)} ✕</span>` : ""}
          <span class="muted">共 ${total} 家</span>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>客户</th><th>联系人</th><th>行业 / 地区</th><th>状态</th><th>下次跟进</th><th>最近跟进</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(c => `<tr>
              <td class="ellipsis" style="max-width:260px"><div style="font-weight:600">${esc(c.name)}</div>${c.shortName ? `<div class="muted">${esc(c.shortName)}</div>` : ""}</td>
              <td>${esc(c.contactName || "—")}<div class="muted">${esc(c.contactPhone || "")}</div></td>
              <td class="ellipsis" style="max-width:150px">${esc(c.industry || "")}${c.region ? `<div class="muted">${esc(c.region)}</div>` : ""}</td>
              <td>${badge(c.status, CUSTOMER_STATUS_STYLE[c.status] || "")}</td>
              <td class="${dueClass(c.nextFollowDate)}">${fmtYMD(c.nextFollowDate) || "—"}</td>
              <td>${fmtYMD(c.lastFollowAt) || "—"}</td>
              <td style="text-align:right; white-space:nowrap">
                <button class="btn btn-green btn-sm" data-cust-follow="${c.id}" data-name="${esc(c.name)}">记录跟进</button>
                <button class="btn btn-ghost btn-sm" data-cust-detail="${c.id}">详情</button>
                <button class="btn btn-ghost btn-sm" data-cust-edit="${c.id}">编辑</button>
                <button class="btn btn-danger btn-sm" data-cust-del="${c.id}" data-name="${esc(c.name)}">删除</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="7"><div class="empty">暂无客户，点击「新增客户」开始建立档案。</div></td></tr>`}</tbody>
          </table></div>
        </div>
        ${custPager}`;
    }

    /* ---------------- 客户跟进记录 ---------------- */
    async function viewFollowups() {
      const params = { page: followPage, pageSize: PAGE_SIZE };
      if (followCustId) params.customerId = followCustId;
      if (followQ.trim()) params.q = followQ.trim();
      const { list, total } = await Store.listFollowUps(params);
      const followPager = pagerHtml(total, followPage, PAGE_SIZE, "follow");
      let customers = [];
      try { customers = (await Store.listCustomers({ pageSize: 500 })).list; } catch (e) { customers = []; }
      return `
        <div class="page-head">
          <div><h1 class="page-title">客户跟进记录</h1><p class="page-sub">所有客户的跟进流水；含「下次跟进日期」的记录会自动生成跟进待办（见待办看板）。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openFollowUpForm()"> 记录跟进</button></div>
        </div>
        <div class="filter-bar">
          <select id="followCustSel" data-follow-cust style="max-width:220px">
            <option value="">全部客户</option>
            ${customers.map(c => `<option value="${c.id}" ${String(c.id) === String(followCustId) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          <span class="spacer"></span>
          <span class="muted">共 ${total} 条</span>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>客户</th><th>方式</th><th>跟进内容</th><th>跟进日期</th><th>下次跟进</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(f => `<tr>
              <td class="ellipsis" style="max-width:200px">${esc(f.customerName || "#" + f.customerId)}</td>
              <td>${badge(f.followType, "info")}</td>
              <td class="ellipsis" style="max-width:360px">${esc(f.content)}</td>
              <td>${fmtYMD(f.followAt)}</td>
              <td class="${dueClass(f.nextFollowDate)}">${fmtYMD(f.nextFollowDate) || "—"}</td>
              <td style="text-align:right; white-space:nowrap">
                <button class="btn btn-ghost btn-sm" data-fu-edit="${f.id}" data-cust-id="${f.customerId}">编辑</button>
                <button class="btn btn-danger btn-sm" data-fu-del="${f.id}">删除</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="6"><div class="empty">暂无跟进记录</div></td></tr>`}</tbody>
          </table></div>
        </div>
        ${followPager}`;
    }

    /* ---------------- 系统图谱（archify 生成，iframe 内嵌） ---------------- */
    let graphList = null;      // 清单缓存
    let graphSel = "";         // 当前选中的图谱文件
    let graphErr = "";         // 清单加载失败原因

    async function loadGraphsIndex(force = false) {
      if (graphList && !force) return graphList;
      try {
        // index.json 是后端静态托管的原始 JSON（不是统一响应包装），所以直接 fetch
        const res = await fetch(`${API_BASE}/graphs/index.json`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        graphList = Array.isArray(j.graphs) ? j.graphs : [];
        graphErr = graphList.length ? "" : "清单里没有任何图谱";
      } catch (e) {
        graphList = [];
        graphErr = friendlyError(e);
      }
      if (graphList.length && !graphList.some(g => g.file === graphSel)) graphSel = graphList[0].file;
      return graphList;
    }
    const graphUrl = (file) => `${API_BASE}/graphs/${encodeURIComponent(file)}`;

    async function viewGraphs() {
      const list = await loadGraphsIndex();
      if (!graphList.length) {
        return `
          <div class="page-head">
            <div><h1 class="page-title">系统图谱</h1><p class="page-sub">由 archify 生成的交互式图谱。</p></div>
            <div class="actions"><button class="btn btn-ghost" onclick="App.refresh()">重新加载</button></div>
          </div>
          <div class="card card-pad">
            <div class="empty" style="padding:26px 0;line-height:2">
              暂时读不到图谱清单（<span class="muted">${esc(graphErr || "未知原因")}</span>）。<br/>
              两个常见原因：<br/>
              ① <b>后端还没重启</b> —— 图谱静态路由是新增的，重启后端后 <span class="muted">/api/v1/graphs/index.json</span> 才可用；<br/>
              ② graphs 目录里没有 <span class="muted">index.json</span> 或图谱 HTML。
            </div>
          </div>`;
      }
      const cur = list.find(g => g.file === graphSel) || list[0];
      return `
        <div class="page-head">
          <div><h1 class="page-title">系统图谱</h1><p class="page-sub">由 archify 生成：自带深浅主题、缩放、搜索与导出，可按需在新窗口打开。</p></div>
          <div class="actions">
            <button class="btn btn-ghost" data-graph-open="${esc(cur.file)}">在新窗口打开 ↗</button>
            <button class="btn btn-ghost" data-graph-reload>重新加载</button>
          </div>
        </div>
        <div class="graph-split">
          <div class="graph-list">
            ${list.map(g => `
              <div class="graph-item${g.file === cur.file ? " on" : ""}" data-graph="${esc(g.file)}" role="button" tabindex="0">
                <div class="gi-top"><span class="gi-title">${esc(g.title)}</span><span class="gi-type">${esc(g.type || "")}</span></div>
                <div class="gi-desc">${esc(g.desc || "")}</div>
                <div class="gi-meta">${g.nodes ? esc(String(g.nodes)) + " 个节点 · " : ""}${g.edges ? esc(String(g.edges)) + " 条关系 · " : ""}${esc(g.file)}</div>
              </div>`).join("")}
            <div class="muted" style="margin-top:6px;line-height:1.7">
              图谱是<b>独立文档</b>（约 610KB/张，iframe 按需加载）。<br/>
              改过后端逻辑需要重新生成，命令见 <span class="muted">graphs/README.md</span>。
            </div>
          </div>
          <div class="card graph-frame">
            <iframe id="graphFrame" src="${esc(graphUrl(cur.file))}" title="${esc(cur.title)}" loading="lazy"></iframe>
          </div>
        </div>`;
    }

    /* ---------------- 投标工作台概览 ---------------- */
    async function viewOverview() {
      const { counts, recent, upcomingOpenings } = await Store.dashboardSummary();
      return `
        <div class="page-head">
          <div><h1 class="page-title">投标工作台概览</h1><p class="page-sub">汇总你的投标跟踪进度与近期开标安排（原「工作台概览」）。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openProjectForm()"> 新增登记</button></div>
        </div>
        <div class="stat-grid">
          <div class="stat stat-click" title="查看全部投标项目" onclick="App.jumpProjects('全部')"><div class="stat-label">跟踪中项目</div><div class="stat-value">${counts.active}</div><div class="stat-hint">含报名/购标/已投标</div></div>
          <div class="stat stat-click" title="查看全部投标项目" onclick="App.jumpProjects('全部')"><div class="stat-label">待开标</div><div class="stat-value">${counts.upcoming}</div><div class="stat-hint">近期开标安排</div></div>
          <div class="stat stat-click" title="查看已中标项目" onclick="App.jumpProjects('中标')"><div class="stat-label">已中标</div><div class="stat-value">${counts.won}</div><div class="stat-hint">累计</div></div>
          <div class="stat stat-click" title="查看未中标项目" onclick="App.jumpProjects('未中标')"><div class="stat-label">未中标 / 流标</div><div class="stat-value">${counts.lost}</div><div class="stat-hint">累计</div></div>
        </div>
        <div class="stack">
          <div class="card card-pad">
            <h3 class="card-title">近期开标日程</h3>
            ${upcomingOpenings.length ? `<div class="list">${upcomingOpenings.slice(0, 6).map(d => {
              const left = daysLeft(d.openTime);
              const leftTxt = typeof left === "number" ? (left === 0 ? "今天开标" : left > 0 ? `还有 ${left} 天` : `已过 ${-left} 天`) : "";
              const urgent = typeof left === "number" && left <= 3;
              return `
              <div class="list-item ov-row" data-overview-open="${d.id}" title="点击查看该项目">
                <div class="grow">
                  <div class="t">${esc(d.name)}</div>
                  <div class="m">${d.tenderer ? esc(d.tenderer) + " · " : ""}开标 ${esc(fmtYMD(d.openTime))}${d.region ? " · " + esc(d.region) : ""}</div>
                </div>
                ${leftTxt ? `<span class="ov-left${urgent ? " urgent" : ""}">${esc(leftTxt)}</span>` : ""}
                ${statusBadge(d.status)}
              </div>`;
            }).join("")}</div>
            <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="App.go('schedule')">${svgIcon('calendar', 13)} 打开日程提醒</button></div>
            ` : `<div class="empty">暂无近期开标安排</div>`}
          </div>
          <div class="card card-pad">
            <h3 class="card-title">最近登记的项目</h3>
            ${recentTable(recent)}
          </div>
        </div>`;
    }

    function recentTable(list) {
      if (!list.length) return `<div class="empty">暂无数据，点击「新增登记」开始。</div>`;
      // 列宽用类名而非内联样式：窄窗口时才能收窄/隐藏次要列（内联样式无法被媒体查询覆盖）
      return `<div class="table-wrap"><table class="grid">
        <thead><tr><th>项目名称</th><th>状态</th><th>投标截止</th><th class="col-hide-sm">预算</th><th>投标报价</th></tr></thead>
        <tbody>${list.map(d => `<tr>
          <td class="ellipsis col-name">${esc(d.name)}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${fmtDate(d.deadline)}</td>
          <td class="col-hide-sm">${money(d.budget)}</td>
          <td>${money(d.bidPrice)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
    }

    /* ---------------- 投标项目 ---------------- */
    function statusCell(d) {
      const nexts = TRANSITIONS[d.status] || [];
      if (nexts.length === 0) return statusBadge(d.status);
      return `<select class="status-select" data-status-for="${d.id}" data-current="${esc(d.status)}">` +
        `<option value="${esc(d.status)}" selected>${esc(d.status)}</option>` +
        nexts.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("") +
        `</select>`;
    }

    /* ============================================================
     * 标书编制（投标文件生成全过程）
     * 阶段与闸口定义来自 config（MAIN_STAGE / MAIN_GATE），与后端 main.js、
     * bid-workflow\SOP 三处保持一致。写回责任在会话侧 bw.mjs，这里只做展示与闸口确认。
     * ============================================================ */
    let mainDetailId = null;
    let outlineEdit = null;      // 编辑中的 sections（唯一真相源仍是 outline.json，保存后落盘）
    let outlineRemote = null;    // 后端返回的目录信息（stats/gate/nextAction）
    let outlineError = null;     // 目录加载失败的具体原因（供卡片显示与重试）
    let taskData = null;         // 待办任务列表
    let matInfo = null;          // 素材库概览（份数/字数/索引原文）
    let matHits = null;          // 当前检索命中
    let matPicked = [];          // 已选参考片段（派发章节时带进任务 payload）

    /* ---- 目录规划编辑器（网页上增删改章节/页数，保存即写回 outline.json）---- */
    function outlineTotals() {
      const all = outlineEdit || [];
      const lv1 = all.filter(s => Number(s.level) === 1);
      return {
        chapters: lv1.length,
        sections: all.length,
        pages: lv1.reduce((a, b) => a + (Number(b.pages) || 0), 0),
      };
    }
    function outlineRowHtml(s, i) {
      const isCh = Number(s.level) === 1;
      return `<tr>
        <td><input class="ol-in" data-i="${i}" data-f="no" value="${esc(s.no || "")}" style="width:64px;${isCh ? "font-weight:600" : ""}"></td>
        <td><input class="ol-in" data-i="${i}" data-f="title" value="${esc(s.title || "")}" style="width:100%;${isCh ? "font-weight:600" : "padding-left:18px"}"></td>
        <td><input class="ol-in" data-i="${i}" data-f="pages" type="number" min="0" value="${Number(s.pages) || 0}" style="width:62px"></td>
        <td class="muted" style="font-size:11px;max-width:180px" title="${esc((s.score || []).join("；"))}">${esc((s.score || []).join("；") || "—")}</td>
        <td class="muted" style="font-size:11px;max-width:150px" title="${esc((s.charts || []).join("；"))}">${esc((s.charts || []).join("；") || "—")}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm btn-danger" data-ol-del="${i}">删</button></td>
      </tr>`;
    }
    function outlineCardHtml() {
      if (!outlineRemote) {
        return `<div class="card" style="padding:14px">
          <b>目录规划</b>
          <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.10);font-size:12.5px">
            <b style="color:var(--red)">目录数据加载失败</b>：${esc(outlineError || "未知原因")}
            <div class="muted" style="font-size:11.5px;margin-top:4px">常见原因：后端刚重启/未启动、请求落在重启空档、网络瞬时失败。点下面「重试」即可就地重发请求（无需刷新整页）。</div>
          </div>
          <div class="actions" style="margin-top:8px"><button class="btn btn-sm btn-green" data-ol-retry>重试加载</button></div>
        </div>`;
      }
      const t = outlineTotals();
      const od = outlineRemote;
      const over = od.stats.pageLimit > 0 && t.pages > od.stats.pageLimit;
      const g = od.gate || {};
      const rows = (outlineEdit || []).map((s, i) => outlineRowHtml(s, i)).join("");
      const hint = g.status === "rejected"
        ? `<span style="color:var(--red)">G1 已被驳回：${esc(g.remark || "（未填原因）")} —— 修改目录后点「保存目录」，G1 会自动回到「待确认」重新走审批。</span>`
        : esc(od.nextAction?.text || "");
      return `<div class="card" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><b>目录规划</b><span class="muted">（唯一真相源 02-目录规划/outline.json；改完必须点「保存目录」）</span></div>
          <div class="actions" style="flex:0 0 auto;gap:6px">
            <button class="btn btn-sm btn-ghost" data-ol-limit>页数上限</button>
            <button class="btn btn-sm btn-ghost" data-ol-draft>${(outlineEdit || []).length ? "重新生成草案" : "生成目录草案"}</button>
            <button class="btn btn-sm btn-green" data-ol-save>保存目录</button>
            <button class="btn btn-sm btn-ghost" data-ol-add-ch>+ 章</button>
            <button class="btn btn-sm btn-ghost" data-ol-add-sec>+ 节</button>
          </div>
        </div>
        <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(47,111,237,.10);font-size:12.5px">
          <b>下一步：</b>${hint}
        </div>
        <div class="muted" style="margin-top:8px;font-size:12px">
          章 <b id="olChCount">${t.chapters}</b> · 节 <b id="olSecCount">${t.sections}</b> · 分配 <b id="olPages" style="color:${over ? "var(--red)" : "inherit"}">${t.pages}</b> 页
          / 上限 <span id="olLimit">${od.stats.pageLimit || "不限"}</span><span id="olOver">${over ? `（<span style="color:var(--red)">超 ${t.pages - od.stats.pageLimit} 页</span>）` : ""}</span>
          · 版本 v${od.stats.version} · G1 ${g.status === "approved" ? "已批准 ✓" : g.status === "rejected" ? "已驳回" : "待确认"}
        </div>
        <div class="table-wrap" style="margin-top:8px"><table class="grid">
          <thead><tr><th>编号</th><th>标题</th><th>页数</th><th>评分点</th><th>计划图表</th><th></th></tr></thead>
          <tbody id="olBody">${rows || `<tr><td colspan="6"><div class="empty">还没有目录：点右上「生成目录草案」，秒出一份可编辑的三级目录</div></td></tr>`}</tbody>
        </table></div>
      </div>`;
    }

    /* ---- 待办任务（网页派活 → 会话领活）---- */
    // 注意：函数名必须是 bidTaskCardHtml，不能叫 taskCardHtml——
    // 那是「待办看板」(viewTasks) 的任务卡片渲染函数。两者同处一个 IIFE 作用域，
    // 同名函数声明后者覆盖前者，会导致待办看板的看板视图（未完成 + 全部）
    // 渲染成标书模块的「派发章节」任务表。
    function bidTaskCardHtml() {
      const list = taskData?.list || [];
      const rows = list.map(t => {
        const st = t.status;
        const stText = st === "pending" ? "待执行" : st === "claimed" ? "执行中" : st === "done" ? "已完成" : st === "failed" ? "失败" : "已取消";
        const stCls = st === "done" ? "done" : st === "failed" ? "danger" : st === "pending" ? "warn" : "info";
        return `<tr>
          <td>#${t.id}</td>
          <td>${esc(t.kindLabel || t.kind)}${t.payload?.chapterNos?.length ? `<div class="muted" style="font-size:11px">第 ${esc(t.payload.chapterNos.join("、"))} 章</div>` : ""}${t.payload?.materials?.length ? `<div class="muted" style="font-size:11px">素材参考 ${t.payload.materials.length} 条</div>` : ""}</td>
          <td>${badge(stText, stCls)}</td>
          <td class="muted" style="font-size:11px">${esc(fmtTs(t.createdAt))}</td>
          <td class="muted" style="font-size:11px">${t.result ? esc(JSON.stringify(t.result).slice(0, 90)) : (t.note ? esc(t.note) : "—")}</td>
          <td>${["pending", "claimed"].includes(st) ? `<button class="btn btn-sm btn-ghost" data-task-cancel="${t.id}">取消</button>` : ""}</td>
        </tr>`;
      }).join("");
      const pendingCount = list.filter(t => t.status === "pending").length;
      return `<div class="card" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><b>待办任务</b><span class="muted">（网页派活 → 会话里说「执行标书待办」，我领活执行后回报）</span></div>
          <div class="actions" style="flex:0 0 auto;gap:6px">
            <button class="btn btn-sm btn-primary" data-task-new="chapter_batch">派发章节生成</button>
            <button class="btn btn-sm btn-ghost" data-task-new="selfcheck">自检</button>
            <button class="btn btn-sm btn-ghost" data-task-new="merge_build">合并成稿</button>
            <button class="btn btn-sm btn-ghost" data-task-new="charts_cmd">图表脚本</button>
          </div>
        </div>
        <div class="muted" style="margin-top:6px;font-size:12px">
          ${pendingCount ? `有 <b style="color:var(--yellow)">${pendingCount}</b> 条待执行。` : "暂无待执行任务。"}
          派发章节生成需要先批准 G1（目录确认）。
        </div>
        <div class="table-wrap" style="margin-top:8px"><table class="grid">
          <thead><tr><th>#</th><th>任务</th><th>状态</th><th>派发时间</th><th>结果 / 备注</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6"><div class="empty">还没有任务</div></td></tr>`}</tbody>
        </table></div>
      </div>`;
    }

    /* ---- 素材检索（公司级素材库：旧标书复用）---- */
    function matCardHtml() {
      const head = matInfo
        ? `（公司级素材库 ${matInfo.total} 份旧标书 / ${(matInfo.totalWords / 10000).toFixed(0)} 万字，用于改写参考）`
        : "（正在加载素材库…）";
      const hits = (matHits && matHits.length)
        ? matHits.map((h, i) => `
          <div style="padding:6px 8px;border-radius:6px;background:rgba(47,111,237,.06);margin-top:6px">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:600">${esc(h.title)}</div>
                <div class="muted" style="font-size:11.5px">[${esc(h.kind)}] ${esc(h.material)} · 行 ${h.line}</div>
              </div>
              <div class="actions" style="flex:0 0 auto;gap:4px">
                <button class="btn btn-sm btn-ghost" data-mat-read="${i}">看片段</button>
                <button class="btn btn-sm btn-green" data-mat-pick="${i}">加入参考</button>
              </div>
            </div>
            <div id="matExcerpt-${i}"></div>
          </div>`).join("")
        : (matHits ? `<div class="muted" style="font-size:12px">没有命中，换个关键词试试（如：质量控制 / 旁站 / 危大工程 / 组织机构）</div>` : "");
      const pickedHtml = matPicked.length
        ? `<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(6,122,73,.12)">
             <b style="font-size:12.5px">已选参考 ${matPicked.length} 条</b><span class="muted" style="font-size:11.5px">（派发章节生成时随任务带给 AI）</span>
             ${matPicked.map((p, i) => `<div style="font-size:12px;margin-top:4px">• ${esc(p.title)} <span class="muted">· ${esc(p.material)} 行 ${p.line}</span> <span data-mat-unpick="${i}" style="cursor:pointer;color:var(--red);margin-left:4px">×</span></div>`).join("")}
           </div>`
        : `<div class="muted" style="font-size:11.5px;margin-top:8px">还没有选参考片段：检索后点「加入参考」，派发章节时会把它带给 AI（AI 改写时优先读这些片段）。</div>`;
      return `<div class="card" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div><b>素材检索</b><span class="muted">${head}</span></div>
          <div class="actions" style="flex:0 0 auto;gap:6px">
            <input id="matQ" placeholder="关键词，空格分隔，如：旁站 见证取样" style="width:250px;padding:5px 8px;border-radius:6px;border:1px solid rgba(17,24,39,.14);background:rgba(17,24,39,.04);color:inherit;font-size:12.5px">
            <button class="btn btn-sm btn-green" data-mat-search>检索</button>
            <button class="btn btn-sm btn-ghost" data-mat-index>看素材索引</button>
          </div>
        </div>
        <div id="matResult">${hits}</div>
        <div id="matIndexBox"></div>
        ${pickedHtml}
      </div>`;
    }
    function renderMatHost() {
      const qEl = document.getElementById("matQ");
      const keepQ = qEl ? qEl.value : "";
      const host = document.getElementById("matCardHost");
      if (host) host.innerHTML = matCardHtml();
      const q2 = document.getElementById("matQ");
      if (q2 && keepQ) q2.value = keepQ;
      bindMatEvents();
    }

    function bindMatEvents() {
      const doSearch = async () => {
        const q = (document.getElementById("matQ")?.value || "").trim();
        if (!q) { toast("请输入关键词"); return; }
        const box = document.getElementById("matResult");
        if (box) box.innerHTML = `<div class="muted" style="font-size:12px">检索中…</div>`;
        try {
          const r = await Store.searchMaterials(q, 10);
          matHits = r.hits || [];
          renderMatHost();
          toast(`命中 ${r.total} 条${matHits.length ? `，显示前 ${matHits.length}` : ""}`);
        } catch (e) { if (box) box.textContent = "检索失败：" + friendlyError(e); }
      };
      document.querySelectorAll("[data-mat-search]").forEach(el => el.addEventListener("click", doSearch));
      const q = document.getElementById("matQ");
      if (q) q.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
      document.querySelectorAll("[data-mat-read]").forEach(el => {
        el.addEventListener("click", async () => {
          const i = Number(el.dataset.matRead);
          const h = matHits?.[i];
          const box = document.getElementById(`matExcerpt-${i}`);
          if (!h || !box) return;
          if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = "0"; return; }
          box.innerHTML = `<div class="muted" style="font-size:11.5px;margin-top:6px">读取中…</div>`;
          try {
            const r = await Store.readMaterial(h.material, h.line, 40);
            const pre = document.createElement("pre");
            pre.className = "cmd-log";
            pre.style.maxHeight = "220px";
            pre.textContent = r.text;
            box.innerHTML = "";
            box.appendChild(pre);
            box.dataset.open = "1";
          } catch (e) { box.textContent = "读取失败：" + friendlyError(e); }
        });
      });
      document.querySelectorAll("[data-mat-pick]").forEach(el => {
        el.addEventListener("click", () => {
          const h = matHits?.[Number(el.dataset.matPick)];
          if (!h) return;
          if (matPicked.some(p => p.material === h.material && p.line === h.line)) { toast("已在参考列表中"); return; }
          matPicked.push({ material: h.material, line: h.line, title: h.title, kind: h.kind });
          renderMatHost();
          toast(`已加入参考（${matPicked.length} 条）`);
        });
      });
      document.querySelectorAll("[data-mat-unpick]").forEach(el => {
        el.addEventListener("click", () => { matPicked.splice(Number(el.dataset.matUnpick), 1); renderMatHost(); });
      });
      document.querySelectorAll("[data-mat-index]").forEach(el => {
        el.addEventListener("click", async () => {
          const box = document.getElementById("matIndexBox");
          if (!box) return;
          if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = "0"; return; }
          try {
            if (!matInfo) matInfo = await Store.listMaterials();
            const pre = document.createElement("pre");
            pre.className = "cmd-log";
            pre.style.maxHeight = "300px";
            pre.textContent = matInfo.indexMarkdown || "(索引为空)";
            box.innerHTML = "";
            box.appendChild(pre);
            box.dataset.open = "1";
          } catch (e) { box.textContent = "加载失败：" + friendlyError(e); }
        });
      });
    }

    function stageBadge(stage) {
      const label = MAIN_STAGE_LABEL[stage] || stage || "—";
      return badge(label, stage === "delivered" ? "done" : "info");
    }
    function gateBadge(g) {
      const st = g?.status || "pending";
      const cls = st === "approved" ? "done" : st === "rejected" ? "danger" : "warn";
      const txt = st === "approved" ? "已批准" : st === "rejected" ? "已驳回" : "待确认";
      return badge(`${g?.gateLabel || g?.gate || ""} · ${txt}`, cls);
    }
    function mainProgressBar(m) {
      const i = Math.max(0, MAIN_STAGE.indexOf(m.stage));
      const pct = Math.round(((i + 1) / MAIN_STAGE.length) * 100);
      return `<div class="mini-progress">
        <span class="muted">阶段 ${i + 1}/${MAIN_STAGE.length}</span>
        <span class="mini-bar"><div style="width:${pct}%"></div></span>
        <span class="mini-pct">${pct}%</span>
      </div>
      <div class="muted" style="font-size:11px">${esc(MAIN_STAGE_LABEL[m.stage] || m.stage)}</div>`;
    }

    async function viewMain() {
      // 【已停用】标书编制模块整体重构为独立系统（bid-system-v2/docs/重构建议与实施计划.md）。
      // 这里只保留入口占位：不再提供生成/编辑/自检/派发等任何操作入口。
      mainDetailId = null;
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">标书编制</h1>
            <p class="page-sub">本模块正在升级为独立的标书撰写系统</p>
          </div>
        </div>
        <div class="card" style="padding:48px 24px;text-align:center">
          <div style="font-size:22px;font-weight:600;margin-bottom:12px">功能升级中，请期待</div>
          <div class="muted" style="line-height:1.9;font-size:13px">
            标书编制模块正在重构为独立的「标书撰写系统」，原模块已停用，不再提供目录生成、章节生成、自检、派发等入口。<br/>
            升级期间：已有项目数据、素材库与历史交付物均原样保留，不受影响。
          </div>
        </div>`;
    }

    async function viewMainLegacy() {
      const data = await Store.listMainProjects();
      const list = data.list || [];
      const stages = data.stages || MAIN_STAGE;

      // 待办闸口汇总
      const pendingGates = list.filter(m => (m.gatesPending || []).length);
      const byStage = {};
      for (const s of stages) byStage[s] = [];
      for (const m of list) (byStage[m.stage] || (byStage[m.stage] = [])).push(m);
      // 有项目的阶段排在前面（否则"已完成"的项目会被挤到最后一列，第一屏全是空列），
      // 同组内仍按阶段顺序；这样一眼就能看到"活在哪一阶段"。
      const orderedStages = [
        ...stages.filter(s => (byStage[s] || []).length),
        ...stages.filter(s => !(byStage[s] || []).length),
      ];

      const card = (m) => `
        <div class="main-card" data-main-open="${m.id}">
          <div class="mc-title">${esc(m.projectName || "(未命名)")}</div>
          <div class="mc-sub muted">投标状态 ${esc(m.bidStatus || "—")}${m.deadline ? ` · 截止 ${esc(fmtDate(m.deadline))}` : ""}</div>
          <div class="mc-gates">
            ${(m.gatesApproved || []).map(g => badge(g + " 已批准", "done")).join("")}
            ${(m.gatesPending || []).map(g => badge(g + " 待确认", "warn")).join("")}
          </div>
          <div class="mc-meta muted">
            章节 ${m.chapterReviewed || 0}/${m.chapterTotal || 0} 已确认 · 页数 分配 ${m.pagesAllocated ?? "—"}${m.pageLimit ? `/${m.pageLimit}` : ""}${m.pagesActual ? ` · 实测 ${m.pagesActual}` : ""}
            · 占位符 ${m.placeholders || 0}
          </div>
          ${mainProgressBar(m)}
        </div>`;

      // 只有一个编制项目时直接看详情（省掉"先点卡片"这一步）；多项目才显示看板
      if (list.length === 1 && !mainDetailId) {
        mainDetailId = list[0].id;
        return await viewMainDetail();
      }

      const columns = orderedStages.map(s => {
        const items = byStage[s] || [];
        const empty = items.length === 0;
        return `
        <div class="main-col${empty ? " is-empty" : ""}">
          <div class="main-col-head">
            <b>${esc(MAIN_STAGE_LABEL[s] || s)}</b>
            <span class="muted">${items.length}</span>
          </div>
          <div class="muted main-col-sub">${esc(MAIN_STAGE_SUB[s] || "")}</div>
          ${items.map(card).join("")}${empty ? `<div class="main-col-empty">暂无</div>` : ""}
        </div>`;
      }).join("");

      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">标书编制</h1>
            <p class="page-sub">投标文件（技术标 / 监理大纲）生成全过程：8 个阶段、4 个硬闸口。进度与留痕在这里，具体执行由 DSH 会话按 SOP 推进（<span class="muted">bid-workflow\\SOP-投标文件生成全过程.md</span>）。</p>
          </div>
          <div class="actions">
            <button class="btn btn-ghost" onclick="App.refresh()">刷新</button>
            <button class="btn btn-primary" onclick="App.openMainNewForm()">+ 新建编制项目</button>
            <button class="btn btn-green" onclick="App.openMainForm()"> 绑定已有目录</button>
          </div>
        </div>

        ${list.length ? "" : `
        <div class="card" style="padding:14px">
          <div class="empty" style="text-align:left">
            还没有编制项目。流程是：<br/>
            ① 在「投标项目」里登记并推进到 <b>已购标书</b>（或任意你决定投标的状态）；<br/>
            ② 会话里执行 <span class="muted">bid init</span> 建项目目录，再 <span class="muted">bw.mjs link --project &lt;id&gt; --dir "&lt;项目目录&gt;"</span> 绑定；<br/>
            ③ 回到本页刷新，就能看到阶段、闸口与产物记录。
          </div>
        </div>`}

        ${pendingGates.length ? `
        <div class="card" style="padding:12px;border-left:3px solid var(--yellow)">
          <b style="color:var(--yellow)">待你确认的闸口（${pendingGates.length} 个编制项目）</b>
          <div class="muted" style="margin-top:4px">不确认就无法推进到下一阶段。点卡片进入详情页批准。</div>
        </div>` : ""}

        <div class="main-board">${columns}</div>

        <div class="card" style="padding:12px">
          <b>四个硬闸口</b>
          <div class="muted" style="margin-top:6px;line-height:1.9">
            <b>G1 目录规划确认</b>（S2→S3）：评分点全部有响应章节、编号连续、页数不超上限、每节 ≥2 页<br/>
            <b>G2 草稿审阅</b>（S3 内，可逐批/逐章）：首行标题与目录一致、无未登记【待补】、无其他项目名残留<br/>
            <b>G3 整稿通读</b>（S5→S6/S7）：交叉引用成立、术语统一、编号连续、图表编号齐<br/>
            <b>G4 交付终校</b>（S7→S8）：<span class="muted">bid check</span> 0 错误、【待补】清零、页数合格、docx 存在
          </div>
        </div>`;
    }

    async function viewMainDetail() {
      const d = await Store.getMainProject(mainDetailId);
      // 目录规划（唯一真相源是 outline.json，这里读结构化数据供编辑器使用）
      let outlineData = null;
      try { outlineData = await Store.getMainOutline(mainDetailId); outlineError = null; }
      catch (e) { outlineData = null; outlineError = friendlyError(e); }
      if (outlineData) outlineEdit = (outlineData.outline?.sections || []).map(s => ({ ...s }));
      else outlineEdit = null;
      // 待办任务
      let taskData = null;
      try { taskData = await Store.listMainTasks(mainDetailId); } catch (e) { taskData = null; }
      // 素材库概览（公司级，首次进详情时加载一次）
      if (!matInfo) { try { matInfo = await Store.listMaterials(); } catch (e) { matInfo = null; } }
      const stageIdx = MAIN_STAGE.indexOf(d.stage);
      const gates = d.gates || [];
      const chapters = d.chapters || [];
      const stageOrder = d.stageOrder || MAIN_STAGE;
      const gateRequired = d.gateRequired || MAIN_GATE_REQUIRED;
      const nextStage = stageOrder[stageIdx + 1] || null;
      const needGate = nextStage ? gateRequired[nextStage] : null;
      const needGateRec = needGate ? gates.find(g => g.gate === needGate) : null;
      const canAdvance = !needGate || needGateRec?.status === "approved";

      const reviewed = chapters.filter(c => c.status === "reviewed" || c.status === "final").length;
      const scoreCovered = d.scoreCovered || [];

      const gateCard = (g) => {
        const rec = gates.find(x => x.gate === g) || { gate: g, status: "pending" };
        const ev = rec.evidence || {};
        const evLine = Object.keys(ev).length
          ? Object.entries(ev).slice(0, 8).map(([k, v]) => `${esc(k)}=${esc(typeof v === "object" ? JSON.stringify(v).slice(0, 60) : v)}`).join(" · ")
          : "（无证据记录）";
        return `
        <div class="gate-row">
          <div class="grow">
            <div style="font-weight:600">${esc(MAIN_GATE_LABEL[g] || g)} ${gateBadge(rec)}</div>
            <div class="muted" style="font-size:11px;margin-top:2px">${evLine}</div>
            ${rec.remark ? `<div class="muted" style="font-size:11px">备注：${esc(rec.remark)}</div>` : ""}
            ${rec.approvedAt ? `<div class="muted" style="font-size:11px">批准于 ${esc(fmtTs(rec.approvedAt))}</div>` : ""}
          </div>
          <div class="actions" style="flex:0 0 auto">
            <button class="btn btn-sm ${rec.status === "approved" ? "btn-ghost" : "btn-green"}" data-main-gate="${g}" data-main-action="approve">批准</button>
            <button class="btn btn-sm btn-ghost" data-main-gate="${g}" data-main-action="reject">驳回</button>
          </div>
        </div>`;
      };

      const chapterRows = chapters.map(c => `
        <tr>
          <td>${esc(c.no)}</td>
          <td class="ellipsis" style="max-width:320px">${esc(c.title || "")}</td>
          <td>${c.level}</td>
          <td>${c.pagesPlanned ?? 0}</td>
          <td>${c.wc || 0}</td>
          <td>${badge(c.status === "reviewed" || c.status === "final" ? "已确认" : c.status === "draft" ? "已写待审" : "待写",
            c.status === "reviewed" || c.status === "final" ? "done" : c.status === "draft" ? "warn" : "")}</td>
          <td>${c.exists ? "✓" : "—"}</td>
        </tr>`).join("");

      const versionRows = (d.versions || []).map(v => `
        <tr>
          <td>${esc(v.kind)}</td>
          <td class="ellipsis" style="max-width:380px" title="${esc(v.relPath || "")}">${esc(v.relPath || "—")}</td>
          <td>${v.sizeBytes ? (v.sizeBytes / 1024).toFixed(1) + " KB" : "—"}</td>
          <td class="muted" style="font-size:11px">${esc((v.sha256 || "").slice(0, 12))}${v.sha256 ? "…" : ""}</td>
          <td class="muted" style="font-size:11px">${esc(fmtTs(v.createdAt))}</td>
        </tr>`).join("");

      const logRows = (d.logs || []).slice(0, 30).map(l => `
        <tr>
          <td>${esc(fmtTs(l.createdAt))}</td>
          <td>${esc(l.action)}</td>
          <td>${esc(l.fromStage || "—")} → ${esc(l.toStage || "—")}</td>
          <td class="muted" style="font-size:11px">${esc(l.detail ? JSON.stringify(l.detail).slice(0, 120) : "")}</td>
        </tr>`).join("");

      return `
        <div class="page-head">
          <div>
            <div class="muted" style="font-size:12px;margin-bottom:4px">
              <span data-main-back style="cursor:pointer;color:var(--accent)">‹ 返回标书编制</span>
            </div>
            <h1 class="page-title">${esc(d.projectName || "(未命名)")}</h1>
            <p class="page-sub">
              ${stageBadge(d.stage)} ・ 投标状态 ${esc(d.bidProject?.status || "—")}
              ${d.bidProject?.deadline ? `・ 投标截止 ${esc(fmtDate(d.bidProject.deadline))}` : ""}
              ${d.bidProject?.projectCode ? `・ ${esc(d.bidProject.projectCode)}` : ""}
            </p>
          </div>
          <div class="actions">
            <button class="btn btn-ghost" onclick="App.refresh()">刷新</button>
            <button class="btn ${canAdvance ? "btn-primary" : "btn-ghost"}" data-main-advance ${canAdvance ? "" : "disabled title=\"下一阶段需要先批准 " + (needGate || "") + "\""}>推进阶段 →</button>
            <button class="btn btn-ghost" data-main-rollback>← 回退一阶段</button>
          </div>
        </div>

        <div class="card" style="padding:14px">
          <div class="stat-grid">
            <div class="stat"><div class="stat-label">工作目录</div><div style="font-size:12px;word-break:break-all" title="${esc(d.workDir || "")}">${esc(d.workDir || "—")}</div></div>
            <div class="stat"><div class="stat-label">页数（分配 / 上限）</div><div class="stat-value">${d.pagesAllocated ?? 0}<span style="font-size:14px;color:var(--text-tertiary)"> / ${d.pageLimit || 0}</span></div><div class="stat-hint">${d.pagesActual ? `Word 实测 ${d.pagesActual} 页` : `字数估算 ${d.pagesEstimated ?? 0} 页`}</div></div>
            <div class="stat"><div class="stat-label">评分点覆盖</div><div class="stat-value">${scoreCovered.length}<span style="font-size:14px;color:var(--text-tertiary)"> / ${d.scoreTotal || "?"}</span></div><div class="stat-hint">目录里已响应评分标准的条目数</div></div>
            <div class="stat"><div class="stat-label">章节已确认</div><div class="stat-value">${reviewed}<span style="font-size:14px;color:var(--text-tertiary)"> / ${chapters.length}</span></div><div class="stat-hint">字数 ${d.totalWords || 0}</div></div>
            <div class="stat"><div class="stat-label">占位符【待补】</div><div class="stat-value" style="color:${d.placeholders ? "var(--yellow)" : "inherit"}">${d.placeholders || 0}</div><div class="stat-hint">${d.placeholders ? "G4 终校要求清零" : "已清零"}</div></div>
            <div class="stat"><div class="stat-label">目录版本 / 阶段更新</div><div class="stat-value" style="font-size:18px">${d.outlineVersion ?? "—"}</div><div class="stat-hint">${esc(fmtTs(d.stageUpdatedAt))}</div></div>
          </div>
          ${mainProgressBar(d)}
        </div>

        <div id="olCardHost">${outlineCardHtml()}</div>

        <div class="card" style="padding:14px">
          <b>闸口（硬门：不批准不推进）</b>
          ${gates.length ? gates.map(g => gateCard(g.gate)).join("") : `<div class="muted">闸口记录缺失（试试刷新；若持续缺失请检查后端是否为最新版本）</div>`}
          ${nextStage ? `<div class="muted" style="margin-top:8px;font-size:12px">
            下一阶段：<b>${esc(MAIN_STAGE_LABEL[nextStage] || nextStage)}</b>${needGate ? ` 需要 <b>${esc(needGate)}</b> ${needGateRec?.status === "approved" ? "（已批准 ✓）" : "（尚未批准，无法推进）"}` : "（无闸口要求）"}
          </div>` : `<div class="muted" style="margin-top:8px">已是最后阶段。</div>`}
        </div>

        <div id="matCardHost">${matCardHtml()}</div>

        <div id="taskCardHost">${bidTaskCardHtml()}</div>

        <div class="card" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><b>操作面板</b><span class="muted">（网页上直接执行 bid 命令，对应会话里的 bid 命令）</span></div>
            <div class="actions" style="flex:0 0 auto;gap:6px">
              <button class="btn btn-sm btn-green" data-main-cmd="check">▶ 自检 check</button>
              <button class="btn btn-sm btn-primary" data-main-cmd="merge">合并 merge</button>
              <button class="btn btn-sm btn-primary" data-main-cmd="build">成稿 build</button>
              <button class="btn btn-sm btn-ghost" data-main-cmd="pagecount">页数估算</button>
              <button class="btn btn-sm btn-ghost" data-main-cmd="charts-cmd">生成渲染脚本</button>
            </div>
          </div>
          <pre id="main-cmd-log" class="cmd-log">点击上方按钮执行 bid 命令，日志输出在这里。
说明：check=确定性自检；merge=合并章节；build=生成 Word（pandoc，自动套中文标书样式）；页数估算=650字/页口径；生成渲染脚本=生成 05-图表/render-all.ps1，在本地终端双击执行后可渲染全部流程图。</pre>
        </div>

        <div class="card" style="padding:14px">
          <div><b>项目文件</b><span class="muted">（在网页上直接编辑，保存前自动备份 .bak-时间戳）</span></div>
          <details style="margin-top:10px"><summary>参数卡 project.json <span class="muted">（项目名/工期/投资/页数上限/评分标准）</span></summary>
            <textarea id="main-file-project" class="code-ta" rows="12" spellcheck="false" placeholder="加载中…"></textarea>
            <div style="margin-top:6px"><button class="btn btn-sm btn-green" data-main-file-save="project.json">保存参数卡</button></div>
          </details>
          <details style="margin-top:8px"><summary>目录规划 outline.json <span class="muted">（章节/页数/评分点/状态；改完建议跑一次自检）</span></summary>
            <textarea id="main-file-outline" class="code-ta" rows="16" spellcheck="false" placeholder="加载中…"></textarea>
            <div style="margin-top:6px"><button class="btn btn-sm btn-green" data-main-file-save="02-目录规划/outline.json">保存目录规划</button></div>
          </details>
          <details style="margin-top:8px"><summary>图表清单 charts.json <span class="muted">（图X-Y/表X-Y 编号与渲染状态）</span></summary>
            <textarea id="main-file-charts" class="code-ta" rows="12" spellcheck="false" placeholder="加载中…"></textarea>
            <div style="margin-top:6px"><button class="btn btn-sm btn-green" data-main-file-save="05-图表/charts.json">保存图表清单</button></div>
          </details>
        </div>

        <div class="card" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><b>自检报告</b><span class="muted">（04-自检报告/：确定性检查 + AI 自检 + 终校清单）</span></div>
            <button class="btn btn-sm btn-ghost" data-main-reports-load>加载列表</button>
          </div>
          <div id="main-reports" class="muted" style="margin-top:8px;font-size:12px">点击「加载列表」查看自检报告，点击文件名查看内容。</div>
        </div>

        <div class="card" style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><b>交付物</b><span class="muted">（99-交付/：最终 Word 等，点击下载）</span></div>
            <button class="btn btn-sm btn-ghost" data-main-deliver-load>加载列表</button>
          </div>
          <div id="main-deliver" class="muted" style="margin-top:8px;font-size:12px">点击「加载列表」查看交付物，docx 可直接下载。</div>
        </div>

        <div class="card">
          <div style="padding:12px 14px 4px"><b>章节状态</b><span class="muted">（镜像自 02-目录规划/outline.json，由 bw.mjs sync 刷新）</span></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>编号</th><th>标题</th><th>层级</th><th>计划页</th><th>字数</th><th>状态</th><th>文件</th></tr></thead>
            <tbody>${chapterRows || `<tr><td colspan="7"><div class="empty">还没有章节镜像：目录规划确定后执行 bw.mjs sync --dir "&lt;项目目录&gt;"</div></td></tr>`}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div style="padding:12px 14px 4px"><b>产物与版本</b><span class="muted">（交付快照，含 sha256 可核对）</span></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>类型</th><th>路径</th><th>大小</th><th>sha256</th><th>记录时间</th></tr></thead>
            <tbody>${versionRows || `<tr><td colspan="5"><div class="empty">还没有交付版本记录（S8 用 bw.mjs deliver 生成快照）</div></td></tr>`}</tbody>
          </table></div>
        </div>

        <div class="card">
          <div style="padding:12px 14px 4px"><b>阶段日志</b><span class="muted">（最近 30 条）</span></div>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>时间</th><th>动作</th><th>阶段变化</th><th>详情</th></tr></thead>
            <tbody>${logRows || `<tr><td colspan="4"><div class="empty">暂无日志</div></td></tr>`}</tbody>
          </table></div>
        </div>`;
    }

    async function viewProjects() {
      const params = { page: projectPage, pageSize: PAGE_SIZE };
      if (statusFilter !== "全部") params.status = statusFilter;
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const { list, total } = await Store.list(params);
      const projectPager = pagerHtml(total, projectPage, PAGE_SIZE, "project");
      const chips = ["全部", ...STATUS].map(s =>
        `<span class="chip ${s === statusFilter ? "on" : ""}" data-status="${esc(s)}">${esc(s)}</span>`).join("");
      const bidVals = list.filter(d => d.bidPrice != null);
      const totalBid = bidVals.reduce((s, d) => s + Number(d.bidPrice), 0);
      const totalBidText = bidVals.length ? money(totalBid) : "—";
      return `
        <div class="page-head">
          <div><h1 class="page-title">投标项目</h1><p class="page-sub">登记并跟踪你的全部投标项目；状态可在列表中直接流转。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openProjectForm()"> 新增登记</button></div>
        </div>
        <div class="filter-bar">${chips}<span class="spacer"></span><span class="muted">共 ${total} 条</span></div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr>
              <th>项目名称 / 编号</th><th>类别 / 行业</th><th>招标人</th><th>预算</th><th>投标报价</th><th>状态</th>
              <th>投标截止</th><th style="text-align:right">操作</th>
            </tr></thead>
            <tbody>${list.length ? list.map(d => `
              <tr>
                <td class="ellipsis" style="max-width:300px">
                  <div style="font-weight:600">${esc(d.name)}</div>
                  <div class="muted">${esc(d.projectCode || "")}${d.tenderNo ? " · " + esc(d.tenderNo) : ""}${d.lotNo ? " · " + esc(d.lotNo) : ""}</div>
                  ${d.duration ? `<div class="muted">工期：${esc(d.duration)}</div>` : ""}
                  ${d.notes ? `<div class="muted" style="color:var(--yellow)">${esc(d.notes)}</div>` : ""}
                </td>
                <td>
                  <div>${esc(d.category)}</div>
                  ${d.industry ? `<div class="muted" style="color:#7ea2ff">${esc(d.industry)}</div>` : ""}
                </td>
                <td class="ellipsis" style="max-width:180px">${esc(d.tenderer)}</td>
                <td>${money(d.budget)}</td>
                <td>${money(d.bidPrice)}</td>
                <td>${statusCell(d)}</td>
                <td>${fmtDate(d.deadline)}</td>
                <td style="text-align:right; white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-edit="${esc(d.id)}">编辑</button>
                  <button class="btn btn-danger btn-sm" data-del="${esc(d.id)}" data-name="${esc(d.name)}">删除</button>
                </td>
              </tr>`).join("") : `<tr><td colspan="8"><div class="empty">暂无符合条件的项目</div></td></tr>`}
            </tbody>
          </table></div>
          <div class="summary-bar"><span class="muted">本页投标报价合计</span><b>${totalBidText}</b></div>
        </div>
        ${projectPager}`;
    }

    /* ---------------- 投标文件（项目 + 文件夹链接） ---------------- */
    async function viewFiles() {
      const { list } = await Store.listDocuments();
      return `
        <div class="page-head">
          <div><h1 class="page-title">投标文件</h1><p class="page-sub">记录每个项目的文件夹链接，点击在新标签页打开。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openDocumentForm()"> 新增链接</button></div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>项目名称</th><th>项目文件夹链接</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(d => `
              <tr>
                <td class="ellipsis" style="max-width:300px">${esc(d.projectName || "")}</td>
                <td class="ellipsis" style="max-width:340px"><a href="${esc(d.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(d.url)} ↗</a></td>
                <td style="text-align:right; white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-doc-edit="${d.id}">编辑</button>
                  <button class="btn btn-danger btn-sm" data-doc-del="${d.id}" data-name="${esc(d.projectName || '')}">删除</button>
                </td>
              </tr>`).join("") : `<tr><td colspan="3"><div class="empty">暂无链接，点击「新增链接」开始登记。</div></td></tr>`}
            </tbody>
          </table></div>
        </div>`;
    }

    /* ---------------- 日程提醒 ---------------- */
    async function viewSchedule() {
      const { list } = await Store.listSchedules();
      const schedBadge = (s) => badge(s, s === "已提醒" ? "done" : s === "已关闭" ? "" : "warn");
      return `
        <div class="page-head">
          <div><h1 class="page-title">日程提醒</h1><p class="page-sub">登记关键时间节点（报名/购标/投标/开标），按时提醒。</p></div>
          <div class="actions"><button class="btn btn-green" onclick="App.openScheduleForm()"> 新增提醒</button></div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>提醒类型</th><th>提醒时间</th><th>所属项目</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(s => `
              <tr>
                <td>${esc(s.remindType)}</td>
                <td>${fmtDate(s.remindAt)}</td>
                <td class="ellipsis" style="max-width:220px">${esc(s.projectName || "")}</td>
                <td>${schedBadge(s.status)}</td>
                <td style="text-align:right; white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-sched-ack="${s.id}" data-status="${esc(s.status)}">${s.status === "待提醒" ? "标记已提醒" : "标回待提醒"}</button>
                  <button class="btn btn-ghost btn-sm" data-sched-edit="${s.id}">编辑</button>
                  <button class="btn btn-danger btn-sm" data-sched-del="${s.id}">删除</button>
                </td>
              </tr>`).join("") : `<tr><td colspan="5"><div class="empty">暂无提醒，点击「新增提醒」开始登记。</div></td></tr>`}
            </tbody>
          </table></div>
        </div>`;
    }

    /* ---------------- 开标结果 ---------------- */
    async function viewResults() {
      const { list } = await Store.listResults();
      let projects = [];
      try { projects = (await Store.list({ page: 1, pageSize: 200 })).list; } catch (e) { projects = []; }
      const sizeText = (n) => (n == null ? "" : (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.round(n / 1024) + " KB"));
      const missingCount = list.filter(r => r.exists === false).length;
      const missingBanner = missingCount ? `
        <div class="card card-pad" style="margin-bottom:16px;border-color:rgba(255,100,124,.45)">
          <div style="font-size:12.5px;line-height:1.8;color:var(--text-secondary)">
            <b style="color:var(--red)">有 ${missingCount} 条记录的文件已不在磁盘上</b>（备份/恢复只带元数据、不含文件二进制，或文件被移动过）。<br/>
            处理方式：点该行的「重新上传」把原件挂回原记录（不会产生重复记录）；不打算再要的文件可直接删除记录。
          </div>
        </div>` : "";
      return `
        <div class="page-head">
          <div><h1 class="page-title">开标结果</h1><p class="page-sub">上传开标记录、结果公示等文件（html / excel / pdf / 图片），在线预览。</p></div>
        </div>
        ${missingBanner}
        <div class="card card-pad" style="margin-bottom:16px">
          <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap">
            <div style="min-width:240px">
              <label style="font-size:12px;color:var(--text-secondary)">所属项目（可选）</label>
              <select id="resultProject"><option value="">— 不关联项目 —</option>${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
            </div>
            <div style="flex:1; min-width:240px">
              <label style="font-size:12px;color:var(--text-secondary)">选择文件（html / excel / pdf / 图片）</label>
              <input type="file" id="resultFile" accept=".html,.htm,.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md" />
            </div>
            <button class="btn btn-green" onclick="App.uploadResult()">上传</button>
          </div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>项目名称</th><th>文件</th><th>大小</th><th>上传时间</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>${list.length ? list.map(r => {
              const missing = r.exists === false;
              return `
              <tr${missing ? ' style="background:rgba(255,100,124,.06)"' : ""}>
                <td class="ellipsis" style="max-width:220px">${esc(r.projectName || "—")}</td>
                <td class="ellipsis" style="max-width:320px">${esc(r.name)}${missing ? ' <span class="badge danger">文件缺失</span>' : ""}</td>
                <td>${sizeText(r.sizeBytes)}</td>
                <td>${fmtDate(r.uploadedAt)}</td>
                <td style="text-align:right; white-space:nowrap">
                  ${missing
                    ? `<button class="btn btn-green btn-sm" data-result-reupload="${r.id}" data-name="${esc(r.name)}">重新上传</button>`
                    : `<button class="btn btn-ghost btn-sm" data-result-preview="${r.id}" data-name="${esc(r.name)}" data-mime="${esc(r.mime || "")}">预览</button>`}
                  <button class="btn btn-danger btn-sm" data-result-del="${r.id}" data-name="${esc(r.name)}">删除</button>
                </td>
              </tr>`;
            }).join("") : `<tr><td colspan="5"><div class="empty">暂无文件，选择文件上传。</div></td></tr>`}
            </tbody>
          </table></div>
        </div>`;
    }

    // 把本地文件读成 base64（上传/补传统一入口）
    function readFileBase64(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] || "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }

    // 为"文件缺失"的记录原地补传：PUT /results/:id/content
    function reuploadResult(id, keepName) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".html,.htm,.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md";
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast("文件过大（≤20MB）"); return; }
        toast("补传中…");
        try {
          const base64 = await readFileBase64(file);
          await Store.replaceResult(id, { name: file.name || keepName, data: base64 });
          toast("已补传，文件已挂回原记录");
          await renderMain();
        } catch (e) { toast("补传失败：" + friendlyError(e)); }
      };
      input.click();
    }

    async function uploadResult() {
      const projSel = document.getElementById("resultProject");
      const fileInput = document.getElementById("resultFile");
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      if (!file) { toast("请先选择文件"); return; }
      if (file.size > 20 * 1024 * 1024) { toast("文件过大（≤20MB）"); return; }
      toast("上传中…");
      try {
        const base64 = await readFileBase64(file);
        const projectId = projSel && projSel.value ? Number(projSel.value) : null;
        await Store.addResult({ projectId, name: file.name, data: base64 });
        toast("已上传");
        await renderMain();
      } catch (e) { toast("上传失败：" + friendlyError(e)); }
    }

    function showPreview(title, html) {
      document.getElementById("previewTitle").textContent = title;
      document.getElementById("previewBody").innerHTML = html;
      document.getElementById("previewMask").classList.add("show");
    }
    function closePreview() { document.getElementById("previewMask").classList.remove("show"); }

    async function previewResult(rec) {
      const url = `${API_BASE}/results/${rec.id}/content`;
      const mime = rec.mime || "";
      const isExcel = /spreadsheet|excel|xlsx|xls|csv/.test(mime) || /\.(xlsx|xls|csv)$/i.test(rec.name);
      if (/html/.test(mime)) {
        // sandbox：预览外部下载来的结果 HTML 时禁止其脚本执行（避免该文件在
        // 后端源下调用 API 读写本机数据）。同源样式/表格仍可正常显示。
        showPreview(rec.name, `<iframe src="${url}" sandbox="allow-same-origin" style="width:100%;height:70vh;border:0;background:#fff"></iframe>`);
      } else if (/pdf/.test(mime)) {
        showPreview(rec.name, `<iframe src="${url}" style="width:100%;height:70vh;border:0"></iframe>`);
      } else if (/image/.test(mime)) {
        showPreview(rec.name, `<div style="text-align:center"><img src="${url}" style="max-width:100%;max-height:70vh" /></div>`);
      } else if (isExcel) {
        showPreview(rec.name, `<div class="loading">正在解析 Excel…</div>`);
        await previewExcel(url, rec.name);
      } else {
        showPreview(rec.name, `<div class="empty">该类型暂不支持在线预览<br/><br/><a href="${url}" target="_blank" style="color:var(--accent)">下载 / 打开 ↗</a></div>`);
      }
    }

    async function previewExcel(url, name) {
      if (!window.XLSX) {
        showPreview(name, `<div class="empty">未加载 Excel 解析库（可能处于离线状态）<br/><br/><a href="${url}" target="_blank" style="color:var(--accent)">下载后本地打开 ↗</a></div>`);
        return;
      }
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const html = XLSX.utils.sheet_to_html(sheet);
        showPreview(name, `<style>table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}</style><div style="overflow:auto;max-height:70vh;background:#fff;color:#111;padding:12px;border-radius:6px">${html}</div>`);
      } catch (e) {
        showPreview(name, `<div class="empty">解析失败<br/><br/><a href="${url}" target="_blank" style="color:var(--accent)">下载 ↗</a></div>`);
      }
    }

    /* ---------------- 统计分析 ---------------- */
    async function viewStats() {
      const stats = await Store.statsOverview();
      const { total, winRate, byStatus, byCategory } = stats;

      // 行业分布取数（双通道，避免"要等行业重启后端才生效"）：
      //   ① /stats/overview 的 byIndustry（新版后端）
      //   ② 退回 /dashboard/personal 的 industryDist（这个字段一直都有）
      // 两个都没有时才退回「按类别分布」。
      let industryRows = Array.isArray(stats.byIndustry) ? stats.byIndustry : null;
      if (!industryRows) {
        try {
          const d = await Store.personalDashboard();
          if (Array.isArray(d?.industryDist)) {
            industryRows = d.industryDist.map(x => ({ industry: x.name, count: x.count }));
          }
        } catch (e) { /* 保留按类别回退 */ }
      }
      const industrySupported = !!industryRows;
      const rows2 = industryRows || byCategory;
      const key2 = industrySupported ? "industry" : "category";
      const title2 = industrySupported ? "按行业分布" : "按类别分布";

      // 横向条形图：值域刻度 + 数值/占比 + 悬停高亮
      // 注意：colorOf 必须同时收到下标——只传 x 时"按下标取色"的写法会取到 undefined，
      // 生成非法的 background 值 → 条形整条不可见（这正是之前"只有数字没有条"的原因）。
      const barChart = (rows, keyName, colorOf, axisMax) => {
        const sum = rows.reduce((s, x) => s + (x.count || 0), 0);
        const max = Math.max(1, axisMax || Math.max(...rows.map(x => x.count || 0)));
        const list = rows.map((x, i) => {
          const n = x.count || 0;
          const pct = sum ? (n / sum * 100) : 0;
          const c = colorOf(x, i) || "var(--accent)";
          // 非法颜色不让它毁掉整条：CSS 类上有兜底背景，这里是渐变覆盖
          return `
            <div class="bar-row" title="${esc(x[keyName])}：${n} 个（占 ${pct.toFixed(1)}%）">
              <span class="bar-label">${esc(x[keyName])}</span>
              <span class="bar-track"><i class="bar-fill" style="width:${Math.round(n / max * 100)}%;background:linear-gradient(90deg, ${c}, ${withAlpha(c, .72)})"></i></span>
              <span class="bar-meta">${n}<span class="pct">${pct.toFixed(1)}%</span></span>
            </div>`;
        }).join("");
        return `<div class="bar-list">${list}</div>
          <div class="bar-axis"><span>0</span><span>${Math.round(max / 2)}</span><span>${max}</span></div>`;
      };
      // 8 个状态映射到首页环形图的 6 类语义色，保证同一业务口径到处同色
      const statusColor = (x) => bidDistColor(STATUS_DIST_GROUP[x.status] || x.status);
      // 行业取色：与首页行业环形图同一套色（已登记行业按固定顺序取色，自定义行业按名字哈希取色，保证稳定）
      const palette = industryPalette();
      const industryBarColor = (x, i) => industryColor(x.industry) || palette[hashIndex(x.industry, palette.length)] || palette[i % palette.length];
      const catBarColor = (x, i) => palette[i % palette.length];
      const max = Math.max(1, ...byStatus.map(x => x.count), ...rows2.map(x => x.count));
      const winRateHint = total
        ? `已中标 ${byStatus.find(x => x.status === "中标")?.count || 0} / 全部 ${total} 个（含在途，故偏低）`
        : "暂无项目";
      const fallbackHint = industrySupported ? "" :
        `<div class="muted" style="margin-top:8px">暂时拿不到行业数据（已尝试 /stats/overview 的 byIndustry 与 /dashboard/personal 的 industryDist），先按「类别」显示。</div>`;
      return `
        <div class="page-head">
          <div><h1 class="page-title">统计分析</h1><p class="page-sub">基于后端数据的实时统计。</p></div>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-label">项目总数</div><div class="stat-value">${total}</div><div class="stat-hint">含历史与已结束</div></div>
          <div class="stat"><div class="stat-label">中标率</div><div class="stat-value">${winRate}%</div><div class="stat-hint">${esc(winRateHint)}</div></div>
        </div>
        <div class="cols">
          <div class="card card-pad"><h3 class="card-title">按状态分布</h3>${barChart(byStatus, "status", statusColor, max)}</div>
          <div class="card card-pad">
            <h3 class="card-title">${title2}</h3>
            ${barChart(rows2, key2, industrySupported ? industryBarColor : catBarColor, max)}
            ${fallbackHint}
          </div>
        </div>`;
    }

    /* ---------------- 操作日志 ---------------- */
    const ACTION_LABEL = { create: "新增", update: "更新", delete: "删除", status_change: "状态流转", upload: "上传", import: "导入", export: "导出" };
    const ENTITY_LABEL = {
      project: "项目", document: "投标文件链接", schedule: "提醒", result: "开标结果", backup: "备份",
      task: "任务", recurring_template: "周期模板", customer: "客户", follow_up: "跟进记录",
    };
    const ACTION_STYLE = { create: "done", update: "info", delete: "danger", status_change: "warn", upload: "info", import: "done", export: "" };

    async function viewLogs() {
      const { list, total } = await Store.listAuditLogs({ limit: 300 });
      const detailText = (d) => {
        const x = d.detail;
        if (x == null) return "";
        if (typeof x !== "object") return esc(String(x));
        const parts = [];
        if (x.fromStatus && x.toStatus) parts.push(`${x.fromStatus} → ${x.toStatus}`);
        if (x.action === "complete") parts.push("完成");
        if (x.action === "reopen") parts.push("重开");
        if (x.action === "restore") parts.push("恢复已删除实例");
        if (x.name) parts.push(`${x.name}`);
        if (x.title) parts.push(`${x.title}`);
        if (x.source && TASK_SOURCE_LABEL[x.source]) parts.push(`来源 ${TASK_SOURCE_LABEL[x.source]}`);
        if (x.customer && !x.customerId) parts.push(`客户 ${x.customer}`);
        if (x.customerId && !x.customer) parts.push(`客户 #${x.customerId}`);
        if (x.followType) parts.push(`${x.followType}`);
        if (x.nextFollowDate) parts.push(`下次 ${fmtDate(x.nextFollowDate)}`);
        if (x.month) parts.push(`${x.month}`);
        if (x.remindType) parts.push(`${x.remindType}`);
        if (x.remindAt) parts.push(`${fmtDate(x.remindAt)}`);
        if (x.count != null) parts.push(`数量 ${x.count}`);
        if (x.created != null) parts.push(`新增 ${x.created}`);
        if (x.skipped != null) parts.push(`跳过 ${x.skipped}`);
        if (x.format) parts.push(x.format.toUpperCase());
        return esc(parts.join(" · ") || JSON.stringify(x));
      };
      return `
        <div class="page-head">
          <div><h1 class="page-title">操作日志</h1><p class="page-sub">记录新增、编辑、删除、状态流转、上传与导入导出等操作（最近 ${list.length} 条，共 ${total} 条）。</p></div>
        </div>
        <div class="card">
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>时间</th><th>操作</th><th>对象</th><th>明细</th></tr></thead>
            <tbody>${list.length ? list.map(l => `
              <tr>
                <td style="white-space:nowrap">${fmtDate(l.createdAt)}<div class="muted">${esc(fmtTime(l.createdAt))}</div></td>
                <td>${badge(ACTION_LABEL[l.action] || l.action, ACTION_STYLE[l.action] || "")}</td>
                <td>${esc(ENTITY_LABEL[l.entityType] || l.entityType)}${l.entityId ? " #" + l.entityId : ""}</td>
                <td class="ellipsis" style="max-width:460px">${detailText(l)}</td>
              </tr>`).join("") : `<tr><td colspan="4"><div class="empty">暂无操作记录</div></td></tr>`}
            </tbody>
          </table></div>
        </div>`;
    }

    /* ---------------- 设置 ---------------- */
    async function viewSettings() {
      const np = notifyPermission();
      const npText = np === "granted" ? "已授权 ✓"
        : np === "denied" ? "已拒绝（请在浏览器站点设置中开启）"
        : np === "unsupported" ? "当前环境不支持，将使用应用内提示"
        : "未授权（点击左侧按钮开启）";
      // AI 队列状态：拿不到就降级显示，不影响设置页其它内容
      let aiStat = null;
      try { aiStat = await Store.aiPendingCount(); } catch (e) { aiStat = null; }
      const aiStatText = aiStat
        ? `待解析 <b>${aiStat.pending}</b> 条 · 已建议 <b>${aiStat.suggested}</b> 条 · 已采用 ${aiStat.adopted} 条 · 合计 ${aiStat.total} 条`
        : `<span style="color:var(--yellow)">读取失败（后端未启动，或后端版本过旧）</span>`;
      return `
        <div class="page-head">
          <div><h1 class="page-title">设置</h1><p class="page-sub">本地存储、备份恢复、模块导出与偏好。</p></div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">外观主题</h3>
          <p class="muted" style="margin-top:0">
            默认「暗色霓虹」；「浅色」适合办公 / 投屏 / 打印场景。选择会记在本机浏览器里，下次打开保持。<br/>
            图表颜色会随主题切换（浅底上自动换成对比度更高的同语义色）。
          </p>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="App.toggleTheme()">${svgIcon(isLight() ? "moon" : "sun", 14)} 当前：${isLight() ? "浅色" : "暗色"} · 点击切换</button>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">桌面通知</h3>
          <p class="muted" style="margin-top:0">开启后，进入首页时若有逾期 / 今日到期任务或需跟进客户，会发送桌面通知；点击通知可跳转到待办看板。浏览器不支持或沙箱受限时自动降级为应用内提示。</p>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="App.requestNotify()">开启 / 检查通知</button>
            <span class="muted">状态：${npText}</span>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">AI 助手（公告字段抽取）</h3>
          <p class="muted" style="margin-top:0">
            AI 只把建议写进<b>暂存队列</b>；落库一律要你在「投标项目 → 新增投标登记 → AI 解析」里逐条勾选确认，
            之后才走正常保存流程（编号生成、状态校验、操作日志照旧生效）。
          </p>
          <p class="muted" style="margin-top:0">
            用法：粘贴公告 → 点「AI 解析」入队 → 到 DSH 对话里说一句「<b>处理待解析公告</b>」→ 回到弹窗点「刷新建议」→ 勾选填表。
            没有 DSH 时「识别填写」（纯正则）照旧可用。
          </p>
          <div class="muted" style="margin-bottom:10px">队列状态：${aiStatText}</div>
          <div class="ai-actions">
            <button class="btn btn-ghost btn-sm" onclick="App.refresh()">刷新状态</button>
            <button class="btn btn-ghost btn-sm" onclick="App.aiPurge()">清空已解析的 AI 记录</button>
          </div>
          <p class="muted" style="margin-bottom:0;margin-top:8px;font-size:11.5px">
            清理会删掉「已建议 / 已采用 / 已忽略 / 失败」的任务及其建议（<b>含公告原文</b>），
            但保留<b>尚未解析</b>的待处理队列；已落库的投标项目不受影响。
            注意：解析过的建议一旦离开弹窗就无法再被采用，所以会一起清掉。
          </p>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">本地存储</h3>
          <div class="muted">后端地址：${esc(API_BASE)}<br/>数据库：backend/data/workbench.db（SQLite，本地保存，无需联网）<br/>前端版本：<b>v${esc(VERSION)}</b>（若刷新后功能没变，先看这里是不是旧版本号，是就 Ctrl+F5 强刷）</div>
          <p class="muted" style="margin-bottom:0">
            <b style="color:var(--yellow)">备份请用上面「导出完整备份 JSON」，不要手工复制 workbench.db 单个文件。</b><br/>
            数据库处于 WAL 模式，最新写入可能还在 workbench.db-wal 里：只拷 .db 文件会得到一个空库。<br/>
            另外，备份 JSON 只含文件的元数据、不含开标结果等文件的二进制，换机后需在「开标结果」里用「重新上传」补回。
          </p>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">导出（CSV / Excel 可直接打开）</h3>
          <p class="muted" style="margin-top:0">金额字段（投标模块）导出为万元，其余模块为文本/日期；文件名带当天日期。</p>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="App.exportModule('projects')">导出投标项目 CSV</button>
            <button class="btn btn-ghost" onclick="App.exportModule('tasks')">导出任务 CSV</button>
            <button class="btn btn-ghost" onclick="App.exportModule('customers')">导出客户 CSV</button>
            <button class="btn btn-ghost" onclick="App.exportModule('follow-ups')">导出跟进记录 CSV</button>
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <h3 class="card-title">完整备份 / 恢复</h3>
          <p class="muted" style="margin-top:0">
            完整备份：导出全部业务数据（投标项目/任务/周期模板/客户/跟进等）为 JSON，可用于迁移或灾备；<br/>
            恢复：从备份 JSON 覆盖恢复（<b style="color:var(--red)">会清空当前业务数据后按备份重建，操作前建议先导出一份备份</b>）。
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-primary" onclick="App.exportBackup()">导出完整备份 JSON</button>
            <button class="btn btn-danger" onclick="App.restoreBackup()">从备份恢复…</button>
          </div>
        </div>
        <div class="card card-pad">
          <h3 class="card-title">投标项目导入（批量新增）</h3>
          <p class="muted" style="margin-top:0">导入 CSV / JSON 可批量新增投标项目（CSV 金额按万元、JSON 按元）。项目编号由系统自动生成。</p>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="App.importData()">导入投标数据</button>
            <button class="btn btn-ghost" onclick="App.go('logs')">查看操作日志</button>
          </div>
        </div>`;
    }

    /* ---------------- 导入 / 导出 ---------------- */
    function downloadText(filename, content, mime) {
      const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    }

    async function downloadFromApi(path, filename, mime) {
      const res = await fetch(API_BASE + path);
      if (!res.ok) {
        let msg = "导出失败（HTTP " + res.status + "）";
        try { const j = await res.json(); msg = j?.error?.message || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      downloadText(filename, await res.text(), mime);
    }

    const MODULE_CSV_NAME = { projects: "投标项目", tasks: "任务", customers: "客户", "follow-ups": "跟进记录" };
    async function exportModule(name) {
      try {
        const stamp = todayStr(); // 本地日期（原先用 toISOString 会在凌晨导出成前一天的文件名）
        await downloadFromApi(`/export/${name}`, `${name}-${stamp}.csv`, "text/csv;charset=utf-8");
        toast(`已导出${MODULE_CSV_NAME[name] || name} CSV`);
      } catch (e) { toast("导出失败：" + friendlyError(e)); }
    }

    async function exportBackup() {
      try {
        const stamp = todayStr();
        await downloadFromApi("/export/backup", `backup-${stamp}.json`, "application/json;charset=utf-8");
        toast("已导出完整备份 JSON");
      } catch (e) { toast("导出失败：" + friendlyError(e)); }
    }

    function importData() {
      const input = document.getElementById("importFile");
      if (!input) return;
      input.value = "";
      input.click();
    }

    // 从备份恢复：两步确认后调用后端（先备份当前数据）
    function restoreBackup() {
      askConfirm("恢复备份", "恢复操作将<span style='color:var(--red);font-weight:600'>覆盖当前全部业务数据</span>，不可撤销。<br/>是否继续？（建议先在上方导出完整备份 JSON）", () => {
        const input = document.getElementById("restoreFile");
        if (!input) return;
        input.value = "";
        input.click();
      }, "继续选择文件", true);
    }
    async function handleRestoreFile(file) {
      if (!file) return;
      if (!/\.json$/i.test(file.name)) { toast("仅支持 .json 备份文件"); return; }
      askConfirm("恢复备份", `确认从「<b>${esc(file.name)}</b>」恢复？当前业务数据将被备份内容覆盖，此操作不可撤销。<br/><span class="muted">恢复前会自动生成一份数据库快照存到 backend/data/backups/。</span>`, async () => {
        toast("正在恢复…");
        let text;
        try { text = await file.text(); }
        catch (e) { toast("读取文件失败：" + friendlyError(e)); return; }

        const doRestore = async (skipInvalidRefs) => {
          const r = await Store.importBackup(text, { skipInvalidRefs });
          let msg = `恢复完成（v${r.version}${r.full ? " 全量" : " 投标部分"}）`;
          const s = r.stats || {};
          const part = ["bid_project", "personal_task", "customer"].filter(k => s[k]).map(k => `${k}: ${s[k].inserted}`).join("，");
          if (part) msg += ` · ${part}`;
          if (r.skippedInvalidRefs) msg += ` · 跳过 ${r.skippedInvalidRefs} 行无效关联`;
          toast(msg);
          if (r.warning) {
            askConfirm("恢复完成（有数据被跳过）", `${esc(r.warning)}<br/><br/>如需核对，恢复前快照在：<br/><span class="muted" style="word-break:break-all">${esc(r.snapshot || "")}</span>`, () => {}, "知道了");
          }
          renderSidebar(); await renderMain();
        };

        try {
          await doRestore(false);
        } catch (e) {
          const msg = String(e?.message || e);
          if (/FOREIGN KEY|无效关联行|子表行引用/.test(msg)) {
            askConfirm("该备份存在无效关联数据",
              `${esc(msg)}<br/><br/>这通常表示备份里的<b>状态历史/文档/日程等子表</b>引用了备份中不存在的项目或客户（旧备份常见）。<br/>可以改为<b>跳过这些无效行</b>继续恢复，其余数据正常导入。`,
              async () => {
                toast("正在恢复（跳过无效关联行）…");
                try { await doRestore(true); }
                catch (e2) { toast("恢复失败：" + friendlyError(e2)); }
              }, "跳过并恢复", true);
          } else {
            toast("恢复失败：" + friendlyError(e));
          }
        }
      }, "确认恢复", true);
    }

    async function handleImportFile(file) {
      if (!file) return;
      if (!/\.(csv|json)$/i.test(file.name)) { toast("仅支持 .csv 或 .json 文件"); return; }
      const format = /\.json$/i.test(file.name) ? "json" : "csv";
      toast("导入中…");
      try {
        const text = await file.text();
        const r = await Store.importProjects({ format, data: text });
        let msg = `导入完成：新增 ${r.created} 条，跳过 ${r.skipped} 条`;
        if (r.errors && r.errors.length) msg += `（${r.errors.length} 条失败，详见操作日志）`;
        toast(msg);
        renderSidebar(); await renderMain();
      } catch (e) { toast("导入失败：" + friendlyError(e)); }
    }

    /* ---------------- 通用弹窗 ---------------- */
    let modalState = { title: "", fields: [], values: {}, onSave: null, projects: [], customers: [] };

    function renderFields(fields, values, projects, customers) {
      return fields.map(([key, label, type, opt, req, full]) => {
        let raw = values[key] ?? "";
        let input;
        if (type === "money") {
          raw = yuanToWan(raw);
          input = `<input id="f_${key}" type="number" step="0.0001" value="${esc(raw)}" />`;
        } else if (type === "project") {
          input = `<select id="f_${key}"><option value="">— 选择项目 —</option>${projects.map(p => `<option value="${p.id}" ${String(p.id) === String(raw) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
        } else if (type === "customer") {
          input = `<select id="f_${key}"><option value="">— 选择客户 —</option>${customers.map(p => `<option value="${p.id}" ${String(p.id) === String(raw) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
        } else if (type === "select") {
          input = `<select id="f_${key}">${opt.map(o => `<option value="${esc(o)}" ${String(o) === String(raw) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        } else if (type === "datalist") {
          // 下拉建议 + 自由输入（含"其他"手填）
          input = `<input id="f_${key}" type="text" list="dl_${key}" value="${esc(raw)}" placeholder="选择或手动输入" autocomplete="off" />
            <datalist id="dl_${key}">${opt.map(o => `<option value="${esc(o)}"></option>`).join("")}</datalist>`;
        } else if (type === "checkbox") {
          input = `<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-primary);padding-top:6px">
                    <input id="f_${key}" type="checkbox" style="width:auto" ${raw ? "checked" : ""} /> ${esc(label)}</label>`;
          return `<div class="field ${full ? "full" : ""}"><label></label>${input}</div>`;
        } else if (type === "textarea") {
          input = `<textarea id="f_${key}" rows="3">${esc(raw)}</textarea>`;
        } else {
          input = `<input id="f_${key}" type="${type}" value="${esc(raw)}" />`;
        }
        return `<div class="field ${full ? "full" : ""}"><label>${label} ${req ? '<span class="req">*</span>' : ""}</label>${input}</div>`;
      }).join("");
    }

    function collectFields(fields) {
      const out = {};
      for (const [key, , type] of fields) {
        const el = document.getElementById("f_" + key);
        let v = el ? el.value.trim() : "";
        if (type === "money") v = wanToYuan(v);
        else if (type === "project" || type === "customer") v = (v === "") ? null : Number(v);
        else if (type === "number") v = (v === "") ? null : Number(v);
        else if (type === "checkbox") v = el ? el.checked : false;
        else v = (v === "") ? null : v;
        out[key] = v;
      }
      return out;
    }

    async function showModal(title, fields, values, onSave, extra = "") {
      closePreview();
      let projects = [], customers = [];
      if (fields.some((f) => f[2] === "project")) {
        try { projects = (await Store.list({ page: 1, pageSize: 200 })).list; }
        catch (e) { projects = []; }
      }
      if (fields.some((f) => f[2] === "customer")) {
        try { customers = (await Store.listCustomers({ pageSize: 300 })).list; }
        catch (e) { customers = []; }
      }
      modalState = { title, fields, values: values || {}, onSave, projects, customers };
      $("#modalTitle").textContent = title;
      $("#formBody").innerHTML = extra + renderFields(fields, values || {}, projects, customers);
      $("#modalMask").classList.add("show");
    }

    function closeForm() {
      $("#modalMask").classList.remove("show");
      stopAiPoll(); aiJob = null;                     // 弹窗关了就丢弃未采纳的 AI 会话
      modalState = { title: "", fields: [], values: {}, onSave: null, projects: [] };
    }

    // 单字段校验：返回错误文案（null 表示通过）
    function validateField(key, label, type, value, req) {
      const empty = value === null || value === undefined || value === "";
      if (req && empty) return `${TEXT.requiredPrefix}${label}`;
      if (empty) return null;
      if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return TEXT.invalidDate;
      if (type === "money" && !Number.isFinite(Number(value))) return TEXT.invalidMoney;
      if (type === "number" && !Number.isFinite(Number(value))) return TEXT.invalidNumber;
      if (key === "url" && !/^(https?:\/\/|\/|[A-Za-z]:[\\/]|\\\\)/.test(String(value))) return TEXT.invalidUrl;
      return null;
    }
    function clearFieldErrors() {
      document.querySelectorAll("#formBody .field.invalid").forEach((f) => f.classList.remove("invalid"));
      document.querySelectorAll("#formBody .field-error").forEach((e) => e.remove());
      document.querySelectorAll("#formBody .input-error").forEach((e) => e.classList.remove("input-error"));
    }
    function markFieldError(key, msg) {
      const el = document.getElementById("f_" + key);
      const field = el ? el.closest(".field") : null;
      if (field) {
        field.classList.add("invalid");
        let err = field.querySelector(".field-error");
        if (!err) { err = document.createElement("div"); err.className = "field-error"; field.appendChild(err); }
        err.textContent = msg;
      }
      if (el) el.classList.add("input-error");
    }

    async function saveForm() {
      if (!modalState.onSave) return;
      const out = collectFields(modalState.fields);
      // 前端校验：必填 / 日期 / 数字，逐字段内联提示
      const errors = [];
      for (const [key, label, type, , req] of modalState.fields) {
        const msg = validateField(key, label, type, out[key], req);
        if (msg) errors.push({ key, msg });
      }
      clearFieldErrors();
      if (errors.length) {
        errors.forEach(({ key, msg }) => markFieldError(key, msg));
        toast(errors[0].msg);
        const first = document.getElementById("f_" + errors[0].key);
        if (first) first.focus();
        return;
      }
      try {
        await modalState.onSave(out);
        closeForm();
        renderSidebar();
        await renderMain();
      } catch (e) { toast("保存失败：" + friendlyError(e)); }
    }

    /* ---------------- 实体表单 ---------------- */
    const BASE_PROJECT_FIELDS = [
      ["name", "项目名称", "text", "", true],
      ["tenderNo", "招标编号 / 项目编号", "text", ""],
      ["lotNo", "标段（包）号", "text", ""],
      ["category", "类别", "select", CATEGORY],
      ["industry", "行业（可选，支持手填）", "datalist", INDUSTRY],
      ["region", "地区", "text", ""],
      ["tenderer", "招标人（业主）", "text", ""],
      ["agency", "招标代理机构", "text", ""],
      ["duration", "工期", "text", ""],
      ["budget", "预算 / 控制价（万元）", "money", ""],
      ["bond", "投标保证金（万元）", "money", ""],
      ["bidPrice", "投标报价（万元）", "money", ""],
      ["status", "状态", "select", STATUS],
      ["registerTime", "报名时间", "date", ""],
      ["deadline", "投标截止时间（同开标）", "date", "", true],
      ["validityDays", "投标有效期（天）", "number", ""],
      ["contactName", "联系人", "text", ""],
      ["contactPhone", "联系电话", "text", ""],
      ["notes", "备注", "textarea", "", false, true],
    ];

    function projectFieldsFor(values) {
      const status = values?.status || "";
      const notesLabel = status === "未中标" ? "备注（未中标原因）" : status === "流标" ? "备注（流标原因）" : "备注";
      return BASE_PROJECT_FIELDS.map(f => (f[0] === "notes" ? ["notes", notesLabel, "textarea", "", false, true] : f));
    }

    const DOCUMENT_FIELDS = [
      ["projectId", "所属项目", "project", "", true],
      ["url", "项目文件夹链接", "text", "", true],
    ];

    const SCHEDULE_FIELDS = [
      ["projectId", "所属项目", "project", "", true],
      ["remindType", "提醒类型", "select", REMIND_TYPE, true],
      ["remindAt", "提醒时间", "date", "", true],
      ["advanceMinutes", "提前量（分钟）", "number", ""],
    ];

    const PASTE_PANEL = `
      <div class="paste-panel">
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">粘贴识别（可选）：把招标/采购公告原文粘贴进来，自动识别项目信息，未识别的再手动填写</div>
        <textarea id="pasteText" rows="4" placeholder="例如：项目名称：XX工程　招标人：XX公司　招标编号：XX　预算金额：100万元　投标截止：2026-09-01 …"></textarea>
        <div class="ai-bar">
          <button type="button" class="btn btn-primary btn-sm" onclick="App.parseFill()">识别填写</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiParse()">AI 解析</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiPickFile()">读取文本文件</button>
          <input type="file" id="aiFile" accept=".txt,.text,.md,.markdown,.csv,.log,.json,text/plain" style="display:none"
                 onchange="App.aiFileChosen(this)" />
          <span id="aiStatus" class="ai-note"></span>
        </div>
        <div id="aiSugBox"></div>
      </div>`;

    /* ---------------- 标书编制：绑定表单与详情交互 ---------------- */
    // 新建编制项目：只填名称+页数上限+评分标准 → 后端自动登记投标项目、自动建 bid 项目目录、写参数卡
    async function openMainNewForm() {
      const fields = [
        ["projectName", "项目名称（必填，会作为目录名）", "text", "", true, true],
        ["pageLimit", "技术标页数上限（0 = 不限）", "number", "", false],
        ["scoreCriteria", "评分标准（每行一条，用于匹配章节与分配页数）", "textarea", "如：\n监理大纲完整性、规范性 10 分\n质量控制监理措施 8 分\n进度控制监理措施 5 分\n投资控制监理措施 4 分\n安全生产管理监理措施 5 分\n监理组织机构与人员配备 4 分\n重点难点分析及对策 4 分", false, true],
        ["notes", "备注", "textarea", "", false, true],
      ];
      await showModal("新建编制项目", fields, { pageLimit: 80 }, async (out) => {
        const r = await Store.createMainProject({
          projectName: String(out.projectName || "").trim(),
          pageLimit: Number(out.pageLimit) || 0,
          scoreCriteria: String(out.scoreCriteria || "").split("\n").map(s => s.trim()).filter(Boolean),
          notes: out.notes || null,
        });
        toast(`已创建编制项目 #${r.id}（项目目录已自动建好）`);
        mainDetailId = r.id;
        renderMain();
      });
    }

    // 绑定表单：把工作台里的投标项目与 bid-tool 项目目录关联起来（兼容已有目录的老流程）
    async function openMainForm() {
      const fields = [
        ["projectId", "投标项目", "project", "", true],
        ["workDir", "项目工作目录（bid-tool 项目根，含 project.json）", "text", "如 C:\\Users\\...\\bid-workflow\\projects\\XX项目", true, true],
        ["projectName", "编制项目名称（留空取投标项目名）", "text", "", false, true],
        ["pageLimit", "技术标页数上限（0 = 不限）", "number", "", false],
        ["notes", "备注", "textarea", "", false, true],
      ];
      await showModal("绑定编制项目", fields, { pageLimit: 0 }, async (out) => {
        await Store.addMainProject({
          projectId: Number(out.projectId),
          workDir: out.workDir,
          projectName: out.projectName || null,
          pageLimit: Number(out.pageLimit) || 0,
          notes: out.notes || null,
        });
        toast("已绑定；接着在会话里执行 bw.mjs sync 回写阶段");
      });
    }

    function bindMainEvents() {
      document.querySelectorAll("[data-main-open]").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => { mainDetailId = Number(el.dataset.mainOpen); renderMain(); });
      });
      document.querySelectorAll("[data-main-back]").forEach(el => {
        el.addEventListener("click", () => { mainDetailId = null; renderMain(); });
      });
      document.querySelectorAll("[data-main-advance]").forEach(el => {
        el.addEventListener("click", async () => {
          try {
            const r = await Store.advanceMainProject(mainDetailId, "工作台手动推进");
            toast(`阶段已推进：${r.fromStage} → ${r.toStage}`);
            renderMain();
          } catch (e) { toast("推进失败：" + friendlyError(e)); }
        });
      });
      document.querySelectorAll("[data-main-rollback]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("回退阶段", "确定回退到上一阶段吗？阶段日志会记录这次回退。", async () => {
            try {
              const r = await Store.rollbackMainProject(mainDetailId, "工作台手动回退");
              toast(`已回退：${r.fromStage} → ${r.toStage}`);
              renderMain();
            } catch (e) { toast("回退失败：" + friendlyError(e)); }
          }, "回退");
        });
      });
      document.querySelectorAll("[data-main-gate]").forEach(el => {
        el.addEventListener("click", () => {
          const gate = el.dataset.mainGate;
          const action = el.dataset.mainAction;
          if (action === "approve") {
            askConfirm(`批准 ${gate}`,
              `确认批准 <b>${esc(MAIN_GATE_LABEL[gate] || gate)}</b>？<br/>批准后即可推进到下一阶段；若内容还有问题，请先「驳回」并写明原因。`,
              async () => {
                try {
                  const r = await Store.setMainGate(mainDetailId, gate, "approve", "工作台确认");
                  toast(`${gate} 已批准${r.nextStage ? `，可推进到 ${r.nextStage}` : ""}`);
                  renderMain();
                } catch (e) { toast("批准失败：" + friendlyError(e)); }
              }, "批准");
          } else {
            openGateRejectForm(gate);
          }
        });
      });

      /* ---- 操作面板：bid 命令执行 / 文件读写 / 报告 / 交付物 ---- */
      document.querySelectorAll("[data-main-cmd]").forEach(el => {
        el.addEventListener("click", async () => {
          const cmd = el.dataset.mainCmd;
          const logEl = document.getElementById("main-cmd-log");
          if (!logEl) return;
          logEl.textContent = "⏳ 执行中: bid " + cmd + "（首次运行可能需数秒到数十秒）...";
          try {
            const r = await Store.runMainCmd(mainDetailId, cmd, []);
            const head = (r.exitCode === 0 ? "✓ 完成" : "✗ 退出码 " + r.exitCode) + "（耗时 " + r.durationMs + "ms）";
            logEl.textContent = head + "\n" + "─".repeat(60) + "\n" + r.log + (r.error ? "\n[系统错误] " + r.error : "");
            toast(cmd + " 执行完成");
            renderMain();   // 刷新统计（字数/页数等镜像可能变化）
          } catch (e) { logEl.textContent = "执行失败: " + friendlyError(e); toast("执行失败：" + friendlyError(e)); }
        });
      });

      document.querySelectorAll("[data-main-file-save]").forEach(el => {
        el.addEventListener("click", async () => {
          const rel = el.dataset.mainFileSave;
          const id = rel === "project.json" ? "main-file-project" : rel === "02-目录规划/outline.json" ? "main-file-outline" : "main-file-charts";
          const ta = document.getElementById(id);
          if (!ta) return;
          try {
            const r = await Store.putMainFile(mainDetailId, rel, ta.value);
            toast("已保存 " + rel + "（自动备份 " + r.backup + "）");
            renderMain();
          } catch (e) { toast("保存失败：" + friendlyError(e)); }
        });
      });

      // 项目文件加载到编辑区
      (async () => {
        const defs = [["main-file-project", "project.json"], ["main-file-outline", "02-目录规划/outline.json"], ["main-file-charts", "05-图表/charts.json"]];
        for (const [taId, rel] of defs) {
          const ta = document.getElementById(taId);
          if (!ta) continue;
          try {
            const r = await Store.getMainFile(mainDetailId, rel);
            ta.value = r.content;
          } catch (e) { ta.value = "加载失败：" + friendlyError(e); }
        }
      })();

      document.querySelectorAll("[data-main-reports-load]").forEach(el => {
        el.addEventListener("click", async () => {
          const box = document.getElementById("main-reports");
          if (!box) return;
          box.textContent = "加载中…";
          try {
            const r = await Store.listMainReports(mainDetailId);
            if (!r.list.length) { box.innerHTML = "暂无自检报告"; return; }
            box.innerHTML = r.list.map(f => `<div class="row-link" data-main-report="${esc(f.name)}">📄 ${esc(f.name)} <span class="muted">(${(f.size / 1024).toFixed(1)} KB · ${esc(fmtTs(f.mtime))})</span></div>`).join("");
            box.querySelectorAll("[data-main-report]").forEach(li => {
              li.addEventListener("click", async () => {
                try {
                  const fr = await Store.getMainFile(mainDetailId, "04-自检报告/" + li.dataset.mainReport);
                  const pre = document.createElement("pre");
                  pre.className = "cmd-log";
                  pre.textContent = fr.content;
                  const div = document.createElement("div");
                  div.style.marginTop = "6px";
                  div.innerHTML = `<div class="muted" style="font-size:11px">${esc(li.dataset.mainReport)}</div>`;
                  li.insertAdjacentElement("afterend", div);
                  div.insertAdjacentElement("afterend", pre);
                } catch (e) { toast("读取失败：" + friendlyError(e)); }
              });
            });
          } catch (e) { box.textContent = "加载失败：" + friendlyError(e); }
        });
      });

      document.querySelectorAll("[data-main-deliver-load]").forEach(el => {
        el.addEventListener("click", async () => {
          const box = document.getElementById("main-deliver");
          if (!box) return;
          box.textContent = "加载中…";
          try {
            const r = await Store.listMainDeliver(mainDetailId);
            if (!r.list.length) { box.innerHTML = "暂无交付物（先执行 build 生成 docx）"; return; }
            box.innerHTML = r.list.map(f => {
              const isDoc = /\.(docx|pdf|md)$/.test(f.name);
              return `<div class="row-link">${isDoc ? "📦" : "📄"} ${esc(f.name)} <span class="muted">(${(f.size / 1024).toFixed(1)} KB · ${esc(fmtTs(f.mtime))})</span>${isDoc ? ` · <a href="${Store.mainDownloadUrl(mainDetailId, "99-交付/" + f.name)}" target="_blank" style="color:var(--accent)">下载</a>` : ""}</div>`;
            }).join("");
          } catch (e) { box.textContent = "加载失败：" + friendlyError(e); }
        });
      });

      // 目录规划编辑器 + 待办任务 + 素材检索（详情页新增卡片）
      bindOutlineEvents();
      bindTaskEvents();
      bindMatEvents();
    }

    /* ---- 目录编辑器的局部重渲染与事件 ---- */
    async function reloadOutline() {
      try {
        outlineRemote = await Store.getMainOutline(mainDetailId);
        outlineEdit = (outlineRemote.outline?.sections || []).map(s => ({ ...s }));
        outlineError = null;
      } catch (e) {
        outlineRemote = null;
        outlineEdit = null;
        outlineError = friendlyError(e);
        toast("目录加载失败：" + outlineError);
      }
    }
    async function reloadTasks() {
      try { taskData = await Store.listMainTasks(mainDetailId); } catch (e) { taskData = null; }
    }
    function updateOutlineTotals() {
      const t = outlineTotals();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set("olPages", t.pages);
      set("olChCount", t.chapters);
      set("olSecCount", t.sections);
      // 页数上限校验实时生效：数字颜色与「（超 N 页）」随输入立即更新
      const limit = Number(outlineRemote?.stats?.pageLimit) || 0;
      const over = limit > 0 && t.pages > limit;
      const pagesEl = document.getElementById("olPages");
      if (pagesEl) pagesEl.style.color = over ? "var(--red)" : "inherit";
      const overEl = document.getElementById("olOver");
      if (overEl) overEl.innerHTML = over ? `（<span style="color:var(--red)">超 ${t.pages - limit} 页</span>）` : "";
    }
    function renderOutlineHost() {
      const host = document.getElementById("olCardHost");
      if (host) host.innerHTML = outlineCardHtml();
      bindOutlineEvents();
    }
    function renderTaskHost() {
      const host = document.getElementById("taskCardHost");
      if (host) host.innerHTML = bidTaskCardHtml();
      bindTaskEvents();
    }

    function bindOutlineEvents() {
      // 加载失败时的就地重试（不必刷新整页）
      document.querySelectorAll("[data-ol-retry]").forEach(el => {
        el.addEventListener("click", async () => {
          toast("重新加载目录…");
          await reloadOutline();
          renderOutlineHost();
        });
      });
      // 输入即改内存（不重渲染，避免丢焦点），同步刷新页数合计
      document.querySelectorAll(".ol-in").forEach(el => {
        el.addEventListener("input", () => {
          const i = Number(el.dataset.i);
          const f = el.dataset.f;
          if (!outlineEdit || !outlineEdit[i]) return;
          if (f === "pages") outlineEdit[i].pages = Math.max(0, Number(el.value) || 0);
          else outlineEdit[i][f] = el.value;
          if (f === "no") outlineEdit[i].level = String(el.value).split(".").length;
          updateOutlineTotals();
        });
      });
      document.querySelectorAll("[data-ol-del]").forEach(el => {
        el.addEventListener("click", () => {
          const i = Number(el.dataset.olDel);
          const cur = outlineEdit[i];
          if (!cur) return;
          if (Number(cur.level) === 1) {
            const no = String(cur.no);
            outlineEdit = outlineEdit.filter((s, idx) => idx === i || !String(s.no).startsWith(no + "."));
          } else {
            outlineEdit.splice(i, 1);
          }
          renderOutlineHost();
        });
      });
      document.querySelectorAll("[data-ol-add-ch]").forEach(el => {
        el.addEventListener("click", () => {
          const nums = (outlineEdit || []).filter(s => Number(s.level) === 1).map(s => Number(s.no) || 0);
          const next = Math.max(0, ...nums) + 1;
          outlineEdit = outlineEdit || [];
          outlineEdit.push({ no: String(next), title: "新章节（请填写标题）", level: 1, pages: 3, score: [], charts: [], status: "pending" });
          renderOutlineHost();
        });
      });
      document.querySelectorAll("[data-ol-add-sec]").forEach(el => {
        el.addEventListener("click", () => {
          const chs = (outlineEdit || []).filter(s => Number(s.level) === 1);
          if (!chs.length) { toast("请先添加一个章"); return; }
          const chNo = String(chs[chs.length - 1].no);
          const subs = (outlineEdit || []).filter(s => String(s.no).startsWith(chNo + "."));
          const maxSeq = subs.reduce((m, s) => Math.max(m, Number(String(s.no).split(".").pop()) || 0), 0);
          const idx = outlineEdit.indexOf(chs[chs.length - 1]);
          outlineEdit.splice(idx + 1, 0, { no: `${chNo}.${maxSeq + 1}`, title: "新小节（请填写标题）", level: 2, pages: 2, score: [], charts: [], status: "pending" });
          renderOutlineHost();
        });
      });
      document.querySelectorAll("[data-ol-draft]").forEach(el => {
        el.addEventListener("click", () => {
          const has = (outlineEdit || []).length > 0;
          const go = async () => {
            try {
              const r = await Store.genMainOutlineDraft(mainDetailId, { save: true });
              await reloadOutline();
              renderOutlineHost();
              toast(`已生成目录草案：${r.stats.chapterCount} 章 / ${r.stats.sectionCount} 节 / 分配 ${r.stats.totalAllocated} 页`);
              renderMainHasOutlineRefresh();
            } catch (e) { toast("生成失败：" + friendlyError(e)); }
          };
          if (has) askConfirm("重新生成目录草案", "会用标准模板覆盖当前目录（现有编辑会丢失，outline.json 有 .bak 备份）。确定继续吗？", go, "重新生成");
          else go();
        });
      });
      document.querySelectorAll("[data-ol-save]").forEach(el => {
        el.addEventListener("click", async () => {
          if (!outlineEdit || !outlineEdit.length) { toast("目录为空，先生成草案"); return; }
          try {
            const r = await Store.saveMainOutline(mainDetailId, {
              sections: outlineEdit,
              meta: { pageLimit: outlineRemote?.stats?.pageLimit || 0, docTitle: outlineRemote?.stats?.docTitle || "" },
            });
            toast(r.gateReset ? "已保存：目录已变更，G1 批准作废，请重新确认" : "目录已保存");
            await reloadOutline();
            renderOutlineHost();
            renderMainHasOutlineRefresh();
          } catch (e) {
            const errs = e?.data?.fields?.errors || e?.fields?.errors;
            if (Array.isArray(errs) && errs.length) {
              toast("保存失败：" + errs.slice(0, 2).join("；"));
            } else toast("保存失败：" + friendlyError(e));
          }
        });
      });
      // 页数上限：可只改上限，也可按新上限等比重分配各章页数
      document.querySelectorAll("[data-ol-limit]").forEach(el => {
        el.addEventListener("click", () => openOutlineLimitForm());
      });
    }

    // 按新上限等比重分配（保留目录结构与标题，只重算页数）
    // 规则：合计对齐 round(上限×0.92)；一级章页数 = 其子节之和；每个子节至少 1 页（受此下限约束时以最小可行合计为准）
    function rescaleSections(sections, newLimit) {
      const target = Math.max(1, Math.round(newLimit * 0.92));   // 与草案口径一致：留 8% 余量
      // 1) 拆成「章 + 其子节」分组，保持原顺序
      const groups = [];
      const passthrough = [];
      let i = 0;
      while (i < sections.length) {
        const seg = sections[i];
        if (Number(seg.level) !== 1) { passthrough.push({ index: i, node: seg }); i++; continue; }
        const subs = [];
        let j = i + 1;
        while (j < sections.length && Number(sections[j].level) === 2 && String(sections[j].no).startsWith(String(seg.no) + ".")) {
          subs.push(sections[j]); j++;
        }
        groups.push({ ch: seg, subs });
        i = j;
      }
      if (!groups.length) return sections.map(s => ({ ...s }));

      const sumOf = (g) => g.subs.length
        ? g.subs.reduce((a, b) => a + (Number(b.pages) || 0), 0)
        : (Number(g.ch.pages) || 0);
      const floorOf = (g) => Math.max(1, g.subs.length);   // 每节至少 1 页 → 该章最小页数
      const curTotal = groups.reduce((a, g) => a + sumOf(g), 0) || 1;
      const ratio = target / curTotal;

      // 2) 各章按比例取整
      const plan = groups.map(g => ({
        g,
        pages: Math.max(floorOf(g), Math.round(sumOf(g) * ratio)),
      }));
      // 3) 全局对齐到 target（不突破各章下限）
      let diff = target - plan.reduce((a, p) => a + p.pages, 0);
      let guard = 0;
      while (diff !== 0 && guard++ < 2000) {
        if (diff > 0) {
          const p = plan.reduce((m, x) => (x.pages > m.pages ? x : m), plan[0]);
          p.pages += 1; diff -= 1;
        } else {
          const cand = plan.filter(x => x.pages > floorOf(x.g));
          if (!cand.length) break;          // 已到下限：合计只能大于目标
          const p = cand.reduce((m, x) => (x.pages > m.pages ? x : m), cand[0]);
          p.pages -= 1; diff += 1;
        }
      }
      // 4) 章内子节按比例分配，并严格对齐到该章页数
      const out = [];
      for (const p of plan) {
        const g = p.g;
        if (!g.subs.length) { out.push({ ...g.ch, pages: p.pages }); continue; }
        const subNow = g.subs.reduce((a, b) => a + (Number(b.pages) || 0), 0) || 1;
        const subPages = g.subs.map(s => Math.max(1, Math.round((Number(s.pages) || 0) * (p.pages / subNow))));
        let d = p.pages - subPages.reduce((a, b) => a + b, 0);
        let gg = 0;
        while (d !== 0 && gg++ < 300) {
          const pool = d > 0 ? subPages : subPages.filter(v => v > 1);
          if (!pool.length) break;
          const idx = subPages.indexOf(Math.max(...pool));
          subPages[idx] += d > 0 ? 1 : -1;
          d = p.pages - subPages.reduce((a, b) => a + b, 0);
        }
        out.push({ ...g.ch, pages: subPages.reduce((a, b) => a + b, 0) });
        g.subs.forEach((s, k) => out.push({ ...s, pages: subPages[k] }));
      }
      return out;
    }

    async function openOutlineLimitForm() {
      const cur = Number(outlineRemote?.stats?.pageLimit) || 0;
      const t = outlineTotals();
      const KEEP = "只改上限，保持现有分配";
      const SCALE = "按新上限等比重分配各章页数（覆盖手改）";
      const fields = [
        ["pageLimit", `技术标页数上限（当前 ${cur || "不限"}；0 = 不限）`, "number", "", false],
        ["mode", `各章页数如何处理（当前分配合计 ${t.pages} 页）`, "select", [KEEP, SCALE], false],
      ];
      await showModal("修改页数上限", fields, { pageLimit: cur, mode: KEEP }, async (out) => {
        const newLimit = Number(out.pageLimit) || 0;
        const doScale = String(out.mode) === SCALE;
        let sections = (outlineEdit || []).map(s => ({ ...s }));
        if (doScale && newLimit > 0 && t.pages > 0) sections = rescaleSections(sections, newLimit);
        const r = await Store.saveMainOutline(mainDetailId, {
          sections,
          meta: { pageLimit: newLimit, docTitle: outlineRemote?.stats?.docTitle || "" },
        });
        const total = sections.filter(s => Number(s.level) === 1).reduce((a, b) => a + (Number(b.pages) || 0), 0);
        toast(`页数上限已改为 ${newLimit || "不限"}${doScale ? `，并按新上限重分配为 ${total} 页` : ""}${r.gateReset ? "；G1 批准已作废，请重新确认" : ""}`);
        await reloadOutline();
        renderOutlineHost();
        renderMainHasOutlineRefresh();
      });
    }

    // 保存后刷新详情页其余部分（统计/章节表/闸口状态）
    function renderMainHasOutlineRefresh() {
      setTimeout(() => { try { renderMain(); } catch (e) { /* 忽略 */ } }, 400);
    }

    /* ---- 待办任务事件 ---- */
    function bindTaskEvents() {
      document.querySelectorAll("[data-task-new]").forEach(el => {
        el.addEventListener("click", async () => {
          const kind = el.dataset.taskNew;
          try {
            // 派发章节生成时，把「素材检索」里已选的参考片段一并带给 AI（AI 领活后优先读这些片段改写）
            const payload = kind === "chapter_batch"
              ? { batchSize: 3, ...(matPicked.length ? { materials: matPicked.map(p => ({ material: p.material, line: p.line, title: p.title })) } : {}) }
              : {};
            const r = await Store.createMainTask(mainDetailId, { kind, payload });
            const matNote = r.payload?.materials?.length ? `（含 ${r.payload.materials.length} 条素材参考）` : "";
            toast(`已派发：${r.kindLabel}${r.payload?.chapterNos?.length ? "（第 " + r.payload.chapterNos.join("、") + " 章）" : ""}${matNote}。到会话里说「执行标书待办」即开始`);
            await reloadTasks();
            renderTaskHost();
          } catch (e) { toast("派发失败：" + friendlyError(e)); }
        });
      });
      document.querySelectorAll("[data-task-cancel]").forEach(el => {
        el.addEventListener("click", () => {
          const tid = el.dataset.taskCancel;
          askConfirm("取消任务", "确定取消这条待办任务吗？", async () => {
            try {
              await Store.cancelMainTask(mainDetailId, tid);
              toast("已取消");
              await reloadTasks();
              renderTaskHost();
            } catch (e) { toast("取消失败：" + friendlyError(e)); }
          }, "取消任务");
        });
      });
    }

    async function openGateRejectForm(gate) {
      const fields = [["remark", "驳回原因（必填，会记入闸口与阶段日志）", "textarea", "", true, true]];
      await showModal(`驳回 ${MAIN_GATE_LABEL[gate] || gate}`, fields, {}, async (out) => {
        await Store.setMainGate(mainDetailId, gate, "reject", out.remark);
        toast(`${gate} 已驳回`);
      });
    }

    async function openProjectForm(id) {
      let values = {};
      if (id) {
        try { values = await Store.get(id); if (!values) { toast("项目不存在"); return; } }
        catch (e) { toast("加载失败：" + friendlyError(e)); return; }
      }
      const fields = projectFieldsFor(values).filter(([k]) => !(id && k === "status"));
      const extra = id ? "" : PASTE_PANEL;
      showModal(id ? "编辑投标登记" : "新增投标登记", fields, values, async (out) => {
        if (id) { await Store.update(id, out); toast("已更新登记"); }
        else {
          const created = await Store.add(out);
          // AI 建议被采纳并成功落库 → 标记该队列任务「已采用」（同时清空原文，保护隐私）
          if (aiJob && aiJob.applied > 0 && created && created.id) {
            try { await Store.aiAdopt(aiJob.id, created.id); } catch (e) { /* 审计失败不影响登记结果 */ }
          }
          toast("已新增登记");
        }
      }, extra);
      if (!id) initAiExisting();       // 仅新增：查队列里可一键载入的已解析建议
    }

    function parseFill() {
      const el = document.getElementById("pasteText");
      if (!el || !el.value.trim()) { toast("请先粘贴文本"); return; }
      const parsed = parseTenderText(el.value);
      let n = 0;
      for (const [key, val] of Object.entries(parsed)) {
        if (val == null || val === "") continue;
        const input = document.getElementById("f_" + key);
        if (!input) continue;
        input.value = (key === "budget" || key === "bond" || key === "bidPrice") ? yuanToWan(val) : val;
        n++;
      }
      toast(n ? `已识别并填写 ${n} 项，请核对后保存` : "未识别到可填写的内容，请手动填写");
    }

    /* ============================================================
     * AI 助手：公告抽取（暂存队列 → 人工勾选 → 填表）
     * ============================================================
     * 设计依据 ai-assist-design.md：
     *   AI 只写暂存表 ai_job / ai_suggestion；本文件只做「建议 → 人工确认 → 填表」，
     *   落库仍走保存按钮（服务端生成 project_code、状态机校验、审计照旧生效）。
     *   没有 AI 时「识别填写」（纯正则）照旧可用 —— 这是三档降级里的第 1 档。
     * ============================================================ */
    const AI_MONEY_KEYS = ["budget", "bond", "bidPrice"];
    const AI_POLL_MS = 2000, AI_POLL_MAX = 30;        // 2s × 30 ≈ 最多自动等 60 秒
    let aiPollTimer = null;
    let aiJob = null;                                 // { id, suggestions: [], applied: 0 }

    // 把 {字段: 值} 写进表单（金额按万元回填）；返回实际填入的字段数
    function applyFieldValues(map) {
      let n = 0;
      for (const [key, val] of Object.entries(map)) {
        if (val == null || val === "") continue;
        const input = document.getElementById("f_" + key);
        if (!input) continue;
        input.value = AI_MONEY_KEYS.includes(key) ? yuanToWan(val) : val;
        n++;
      }
      return n;
    }

    // AI 填过的字段挂个「请核对」小标记；用户一改就消失（不做静默填充）
    function markAiField(key, evidence = "") {
      const input = document.getElementById("f_" + key);
      if (!input || !input.parentElement) return;
      const holder = input.parentElement;
      if (holder.querySelector(".ai-flag")) return;
      const tag = document.createElement("span");
      tag.className = "ai-flag";
      tag.textContent = "AI 建议 · 请核对";
      if (evidence) tag.title = "原文：" + evidence;
      holder.appendChild(tag);
      const clear = () => { tag.remove(); input.removeEventListener("input", clear); };
      input.addEventListener("input", clear);
    }

    function aiSetStatus(text) {
      const el = document.getElementById("aiStatus");
      if (el) el.textContent = text || "";
    }

    /* ---- B) 读取纯文本文件（PDF 不在前端解析：交给 DSH 抽文字层） ---- */
    const AI_TEXT_EXT = /\.(txt|text|md|markdown|csv|log|json)$/i;

    // 纯函数，便于测试：把选中的文件转成文本 → {ok:true, text} 或 {ok:false, reason}
    async function readAiTextFile(file) {
      if (!file) return { ok: false, reason: "empty" };
      if (!AI_TEXT_EXT.test(String(file.name || ""))) return { ok: false, reason: "not_text" };
      let text;
      try { text = await file.text(); }
      catch (e) { return { ok: false, reason: "read_error" }; }
      text = String(text ?? "").replace(/^\uFEFF/, "");   // 剥 BOM（PowerShell 写出的 txt 常见）
      if (!text.trim()) return { ok: false, reason: "blank" };
      if (text.length > 100000) return { ok: false, reason: "too_long", length: text.length };
      return { ok: true, text };
    }

    function aiPickFile() {
      const el = document.getElementById("aiFile");
      if (el) el.click();
    }

    async function aiFileChosen(input) {
      const file = input && input.files && input.files[0];
      if (input) input.value = "";                        // 清空后才能重复选同一个文件
      if (!file) return;
      const r = await readAiTextFile(file);
      if (!r.ok) {
        const msg = {
          empty: "没有选中文件",
          not_text: "只能读纯文本文件（.txt / .md / .csv / .log / .json）。PDF 请交给 DSH 抽文字层，或先另存为 .txt。",
          blank: "文件里没有文字内容",
          too_long: `文件过长（${r.length} 字，上限 100000），请分段处理`,
          read_error: "文件读取失败",
        }[r.reason] || "读取失败";
        toast(msg);
        return;
      }
      const ta = document.getElementById("pasteText");
      if (ta) ta.value = r.text;
      aiSetStatus(`已读入 ${r.text.length} 字`);
      toast(`已读入 ${file.name}（${r.text.length} 字）`);
    }

    /* ---- A) 载入队列里已有的「已建议」任务 ----
     * 解决两个场景：① DSH 用 PDF 直接建的任务，工作台弹窗原本载不回来；
     *               ② 弹窗关掉 / 强刷之后，已解析的建议原本无处可取。 */
    let aiExisting = [];

    async function initAiExisting() {
      if (!document.getElementById("aiSugBox")) return;    // 弹窗已关，不做无谓请求
      let data;
      try { data = await Store.aiList({ status: "已建议", pageSize: 10 }); }
      catch (e) { return; }                                // 后端不可用时不打扰用户
      if (!document.getElementById("aiSugBox")) return;    // 请求期间弹窗可能已关
      aiExisting = (data.list || []).filter((j) => (j.suggestionCount || 0) > 0);
      if (aiExisting.length) renderAiExisting();
    }

    function renderAiExisting() {
      const box = document.getElementById("aiSugBox");
      if (!box || !aiExisting.length) return;
      const buttons = aiExisting.map((j) =>
        `<button type="button" class="btn btn-ghost btn-sm" onclick="App.aiLoadExisting(${Number(j.id)})">载入 #${esc(String(j.id))}（${Number(j.suggestionCount)} 条）</button>`
      ).join("");
      box.innerHTML = `
        <div class="ai-sug">
          <div class="ai-sug-head">
            <span>队列里已有 <b>${aiExisting.length}</b> 条已解析的建议，可直接载入：</span>
            <span class="ai-actions">${buttons}</span>
          </div>
        </div>`;
    }

    async function aiLoadExisting(id) {
      aiSetStatus("载入中…");
      try {
        const job = await Store.aiGet(id);
        aiJob = { id: job.id, suggestions: job.suggestions || [], applied: 0 };
        renderAiSuggestions(job, aiJob.suggestions);
      } catch (e) { aiSetStatus(""); toast("载入失败：" + friendlyError(e)); }
    }

    function stopAiPoll() { if (aiPollTimer) { clearTimeout(aiPollTimer); aiPollTimer = null; } }

    function aiLabelOf(key) {
      const f = (modalState.fields || []).find((x) => x[0] === key);
      return f ? f[1] : key;
    }

    async function aiParse() {
      const el = document.getElementById("pasteText");
      const text = el ? el.value.trim() : "";
      if (!text) { toast("请先粘贴公告原文"); return; }
      if (text.length > 100000) { toast("公告原文过长（上限 10 万字符），请分段处理"); return; }

      // 先用正则填一遍，用户不必干等 AI
      const nReg = applyFieldValues(parseTenderText(text));
      aiSetStatus(nReg ? `正则已填 ${nReg} 项；提交中…` : "提交中…");

      let job;
      try { job = await Store.aiSubmit(text, ""); }
      catch (e) { aiSetStatus(""); toast("提交失败：" + friendlyError(e)); return; }

      aiJob = { id: job.id, suggestions: [], applied: 0 };
      aiSetStatus(job.deduped ? `已在队列 #${job.id}（内容重复）` : `已入队 #${job.id}`);
      renderAiWaiting(job.id, job.deduped ? "重复提交，复用已有任务" : "");
      pollAi(job.id);
    }

    function renderAiWaiting(id, note) {
      const box = document.getElementById("aiSugBox");
      if (!box) return;
      box.innerHTML = `
        <div class="ai-sug">
          <div class="ai-sug-head">
            <span>队列 <b>#${esc(String(id))}</b> 待处理${note ? ` · ${esc(note)}` : ""}</span>
            <span class="ai-actions">
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiCopyHint()">复制提示语</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiCheck()">刷新建议</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiIgnore()">忽略</button>
            </span>
          </div>
          <div class="ai-note">到 DSH 对话里说一句「<b>处理待解析公告</b>」，建议会出现在这里（自动等 60 秒，也可随时点「刷新建议」）。</div>
        </div>`;
    }

    function pollAi(id, attempt = 0) {
      stopAiPoll();
      aiPollTimer = setTimeout(async () => {
        let job;
        try { job = await Store.aiGet(id); }
        catch (e) { aiSetStatus("读取失败：" + friendlyError(e)); return; }
        if (job.status === "已建议") { aiJob.suggestions = job.suggestions || []; renderAiSuggestions(job, aiJob.suggestions); return; }
        if (job.status === "已采用" || job.status === "已忽略") { aiSetStatus(`队列 #${job.id} 已是「${job.status}」`); return; }
        if (attempt + 1 >= AI_POLL_MAX) {
          aiSetStatus(`队列 #${id} 仍在等待处理`);
          renderAiWaiting(id, "尚未处理，可稍后点「刷新建议」");
          return;
        }
        pollAi(id, attempt + 1);
      }, AI_POLL_MS);
    }

    async function aiCheck() {
      if (!aiJob) { toast("当前没有待收取的 AI 任务"); return; }
      aiSetStatus("读取中…");
      try {
        const job = await Store.aiGet(aiJob.id);
        if (job.status === "已建议") { aiJob.suggestions = job.suggestions || []; renderAiSuggestions(job, aiJob.suggestions); }
        else { aiSetStatus(`队列 #${job.id} 状态：${job.status}`); renderAiWaiting(job.id, job.status); }
      } catch (e) { aiSetStatus(""); toast("读取失败：" + friendlyError(e)); }
    }

    async function aiCopyHint() {
      const text = "处理待解析公告";
      try { await navigator.clipboard.writeText(text); toast("已复制，粘到 DSH 对话里即可"); }
      catch (e) { toast("请在 DSH 里输入：" + text); }
    }

    async function aiIgnore() {
      if (!aiJob) return;
      try { await Store.aiIgnore(aiJob.id); } catch (e) { /* 忽略失败不影响界面 */ }
      stopAiPoll();
      aiSetStatus(`队列 #${aiJob.id} 已忽略`);
      const box = document.getElementById("aiSugBox");
      if (box) box.innerHTML = "";
      aiJob = null;
    }

    // 设置页的隐私清理：清「已建议 / 已采用 / 已忽略 / 失败」，保留「待解析」队列。
    // 为什么要含「已建议」：任务一旦离开弹窗就没法再被采用（界面没有重开入口），
    // 只能靠这里清掉，否则会永久残留。
    function aiPurge() {
      askConfirm("清空 AI 记录",
        "将删除「已建议 / 已采用 / 已忽略 / 失败」的任务及其建议（<b>含公告原文</b>）。<br/>" +
        "只解析过、还没确认采用的建议也会一起清掉；<b>尚未解析</b>的待处理队列保留。<br/>已落库的投标项目不受影响。",
        async () => {
          const r = await Store.aiPurge(["已建议", "已采用", "已忽略", "失败"]);
          toast(`已清理 ${r.deleted} 条 AI 记录`);
          await renderMain();
        }, "清空", true);
    }

    function renderAiSuggestions(job, list) {
      const box = document.getElementById("aiSugBox");
      if (!box) return;
      // 注意：必须兜到 job.suggestions。调用方只传 job 时若这里取 list||[]，
      // 会恒为空数组 → 建议一行都渲染不出来（曾因此导致「项目名称填不上」）。
      const items = list || job.suggestions || [];
      if (!items.length) {
        box.innerHTML = `<div class="ai-sug"><div class="ai-note">队列 #${esc(String(job.id))} 已处理，但没有可用的字段建议（可能公告内容过少）。</div></div>`;
        return;
      }
      const rows = items.map((s, i) => {
        // low 置信度、或没有原文出处的，默认不勾选（避免误填）
        const weak = s.confidence === "low" || !s.evidence;
        const val = AI_MONEY_KEYS.includes(s.field) ? `${yuanToWan(s.value)} 万元` : s.value;
        return `
          <label class="ai-row${weak ? " no-check" : ""}">
            <input type="checkbox" data-ai-idx="${i}" ${weak ? "" : "checked"} />
            <span class="ai-f">${esc(aiLabelOf(s.field))}<span class="ai-conf ${esc(s.confidence || "medium")}">${esc(s.confidence || "-")}</span></span>
            <span class="ai-v">${esc(String(val))}${s.evidence ? `<span class="ai-ev">原文：${esc(s.evidence)}</span>` : `<span class="ai-ev">（无原文出处，默认不勾选）</span>`}</span>
          </label>`;
      }).join("");
      const dropped = job.dropped || [];
      const droppedHtml = dropped.length
        ? `<div class="ai-dropped">被丢弃 ${dropped.length} 条（格式不合规，未进入建议）：${dropped.map((d) => `${esc(d.field || "?")}·${esc(d.reason || "")}`).join("、")}</div>`
        : "";
      box.innerHTML = `
        <div class="ai-sug">
          <div class="ai-sug-head">
            <span>队列 <b>#${esc(String(job.id))}</b> 建议 <b>${items.length}</b> 项 · 勾选后点「填入表单」，再核对保存</span>
            <span class="ai-actions">
              <button type="button" class="btn btn-primary btn-sm" onclick="App.aiApply()">填入表单</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="App.aiIgnore()">忽略</button>
            </span>
          </div>
          <div class="ai-sug-list">${rows}</div>
          ${droppedHtml}
        </div>`;
      aiSetStatus("");
    }

    function aiApply() {
      const box = document.getElementById("aiSugBox");
      if (!box || !aiJob) { toast("没有可填入的建议"); return; }
      const checks = box.querySelectorAll("input[type=checkbox][data-ai-idx]");
      const map = {};
      const notesParts = [];
      for (const cb of checks) {
        if (!cb.checked) continue;
        const s = aiJob.suggestions[Number(cb.dataset.aiIdx)];
        if (!s) continue;
        if (s.field === "notes") { notesParts.push(s.value); continue; }   // 备注走追加，不覆盖
        map[s.field] = s.value;
      }
      let n = applyFieldValues(map);
      for (const key of Object.keys(map)) markAiField(key, (aiJob.suggestions.find((s) => s.field === key) || {}).evidence);

      if (notesParts.length) {
        const el = document.getElementById("f_notes");
        if (el) {
          const add = notesParts.join("\n\n");
          el.value = el.value.trim() ? el.value.trim() + "\n\n" + add : add;
          markAiField("notes");
          n++;
        }
      }
      aiJob.applied = n;
      toast(n ? `已填入 ${n} 项，请逐项核对后保存` : "没有勾选任何字段");
    }

    async function openDocumentForm(id) {
      let values = {};
      if (id) { try { values = await Store.getDocument(id); } catch (e) { toast("加载失败：" + friendlyError(e)); return; } }
      showModal(id ? "编辑项目文件夹链接" : "新增项目文件夹链接", DOCUMENT_FIELDS, values, async (out) => {
        await Store.saveDocument(out); toast("已保存链接");
      });
    }

    async function openScheduleForm(id) {
      let values = {};
      if (id) { try { values = await Store.getSchedule(id); } catch (e) { toast("加载失败：" + friendlyError(e)); return; } }
      showModal(id ? "编辑提醒" : "新增提醒", SCHEDULE_FIELDS, values, async (out) => {
        if (id) { await Store.updateSchedule(id, out); toast("已更新提醒"); }
        else { await Store.addSchedule(out); toast("已新增提醒"); }
      });
    }

    /* ---------------- 个人模块表单 ---------------- */
    const TASK_FIELDS = [
      ["title", "任务标题", "text", "", true],
      ["quadrant", "重要紧急分类", "select", QUADRANT, true],
      ["dueDate", "截止日期（时间节点）", "date", ""],
      ["remindDays", "提前提醒（天，0=当天）", "number", ""],
      ["status", "状态", "select", TASK_STATUS],
      ["notes", "备注", "textarea", "", false, true],
    ];

    async function openTaskForm(id, preset = null) {
      let values = preset ? { ...preset } : {};
      if (id) {
        try { values = await Store.getTask(id); if (!values) { toast("任务不存在"); return; } }
        catch (e) { toast("加载失败：" + friendlyError(e)); return; }
      } else if (preset) {
        values = { status: "待办", quadrant: "重要不紧急", ...preset };   // 日历"在这天新增待办"用
      }
      const fields = id ? TASK_FIELDS.filter(([k]) => k !== "status") : TASK_FIELDS;
      showModal(id ? "编辑任务" : "新增任务", fields, values, async (out) => {
        if (id) { await Store.updateTask(id, out); toast("已更新任务"); }
        else { await Store.addTask({ ...out, source: "manual" }); toast("已新增任务"); }
      });
    }

    // 完成任务：客户跟进任务询问新的下次跟进日期（双向联动闭环）
    // afterDone：可选回调（日历用它刷新自身；普通列表不传）
    function askCompleteTask(t, afterDone = null) {
      const notify = () => { if (typeof afterDone === "function") afterDone(); };
      if (t.source === "customer" && t.customer) {
        showModal("完成跟进任务 · 安排下次跟进", [
          ["nextFollowDate", "下次跟进日期（可留空，留空则不安排）", "date", ""],
        ], {}, async (out) => {
          await Store.completeTask(t.id, out.nextFollowDate);
          toast(out.nextFollowDate ? "已完成，并已生成下次跟进待办" : "已完成");
          notify();
        });
      } else {
        completeDirect(t);
        notify();
      }
    }
    async function completeDirect(t) {
      try {
        await Store.completeTask(t.id, null);
        toast("任务已完成 ✓");
        renderSidebar();
        renderMain();
      } catch (e) { toast("操作失败：" + friendlyError(e)); }
    }

    const TEMPLATE_FIELDS = [
      ["name", "任务名（每月固定）", "text", "", true],
      ["quadrant", "重要紧急分类", "select", QUADRANT, true],
      ["dayOfMonth", "每月执行日（1–31，短月自动取月末）", "number", "", true],
      ["remindDays", "提前提醒（天）", "number", ""],
      ["active", "启用（停用后不再生成新实例）", "checkbox", "", false, true],
      ["notes", "说明", "textarea", "", false, true],
    ];

    async function openTemplateForm(id) {
      let values = {};
      if (id) { try { values = await Store.listTemplates(); const t = values.list.find(x => x.id === Number(id)); if (t) values = t; else { toast("模板不存在"); return; } } catch (e) { toast("加载失败：" + friendlyError(e)); return; } }
      showModal(id ? "编辑周期任务模板" : "新增周期任务模板", TEMPLATE_FIELDS, values, async (out) => {
        out.active = out.active ? 1 : 0;
        if (id) { await Store.updateTemplate(id, out); toast("已更新模板"); }
        else { await Store.addTemplate(out); toast("已新增模板（进入待办看板将自动生成本月实例）"); }
      });
    }

    const CUSTOMER_FIELDS = [
      ["name", "客户名称", "text", "", true],
      ["shortName", "简称", "text", ""],
      ["industry", "行业", "text", ""],
      ["region", "地区", "text", ""],
      ["contactName", "联系人", "text", ""],
      ["contactPhone", "联系电话", "text", ""],
      ["email", "邮箱", "text", ""],
      ["status", "客户状态", "select", CUSTOMER_STATUS],
      ["source", "客户来源", "select", ["投标接触", "客户介绍", "展会", "网络渠道", "其他"]],
      ["nextFollowDate", "下次跟进日期（将自动生成待办）", "date", ""],
      ["notes", "备注", "textarea", "", false, true],
    ];

    async function openCustomerForm(id) {
      let values = {};
      if (id) { try { values = await Store.getCustomer(id); if (!values) { toast("客户不存在"); return; } } catch (e) { toast("加载失败：" + friendlyError(e)); return; } }
      showModal(id ? "编辑客户档案" : "新增客户", CUSTOMER_FIELDS, values, async (out) => {
        if (id) { await Store.updateCustomer(id, out); toast("已更新客户档案"); }
        else { await Store.addCustomer(out); toast("已新增客户"); }
      });
    }

    const FOLLOWUP_FIELDS = [
      ["customerId", "客户", "customer", "", true],
      ["followType", "跟进方式", "select", FOLLOW_TYPE, true],
      ["followAt", "跟进日期", "date", "", true],
      ["nextFollowDate", "下次跟进日期（自动生成待办）", "date", ""],
      ["content", "跟进内容", "textarea", "", true, true],
    ];

    async function openFollowUpForm(id, customerId) {
      let values = {};
      const today = todayStr();
      if (id) {
        try {
          let list = await Store.listFollowUps({ pageSize: 500 });
          const f = list.list.find(x => x.id === Number(id));
          if (!f) { toast("跟进记录不存在"); return; }
          values = { customerId: f.customerId, followType: f.followType, followAt: f.followAt, nextFollowDate: f.nextFollowDate, content: f.content };
        } catch (e) { toast("加载失败：" + friendlyError(e)); return; }
      } else {
        values = { followAt: today, followType: "电话" };
        if (customerId) values.customerId = customerId;
      }
      showModal(id ? "编辑跟进记录" : "记录客户跟进", FOLLOWUP_FIELDS, values, async (out) => {
        if (id) { await Store.updateFollowUp(id, out); toast("已更新跟进记录"); }
        else {
          const r = await Store.addFollowUp(out);
          toast(r.taskId ? "已记录，并自动生成跟进待办" : "已记录跟进");
        }
      });
    }

    // 客户详情（弹窗内嵌跟进记录 + 关联待办）
    async function openCustomerDetail(id) {
      let c;
      try { c = await Store.getCustomer(id); } catch (e) { toast("加载失败：" + friendlyError(e)); return; }
      if (!c) { toast("客户不存在"); return; }
      const followRows = (c.followUps || []).map(f => `
        <div style="border:1px solid var(--border-l1);border-radius:8px;padding:8px 12px;margin-bottom:8px">
          <div style="display:flex;gap:8px;align-items:center">
            ${badge(f.followType, "info")}
            <span class="muted">${esc(fmtYMD(f.followAt))}</span>
            <span class="muted" style="margin-left:auto">下次：${esc(fmtYMD(f.nextFollowDate) || "—")}</span>
          </div>
          <div style="margin-top:5px;font-size:12.5px">${esc(f.content)}</div>
        </div>`).join("");
      const openTaskRows = (c.openTasks || []).map(t => `
        <div class="list-item" style="margin-bottom:6px">
          <div class="grow"><div class="t">${esc(t.title)}</div><div class="m">${t.source === "customer" ? "跟进待办" : "手动"} · 截止 ${esc(fmtYMD(t.dueDate) || "—")}</div></div>
          ${badge(t.status, TASK_STATUS_STYLE[t.status] || "")}
        </div>`).join("");
      showPreview(`${c.name} · 客户详情`, `
        <div class="card card-pad" style="margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h3 style="margin:0;font-size:15px">${esc(c.name)}</h3>${badge(c.status, CUSTOMER_STATUS_STYLE[c.status] || "")}
            <span style="margin-left:auto;display:flex;gap:8px">
              <button class="btn btn-green btn-sm" onclick="App.openFollowUpForm(null, ${c.id})">记录跟进</button>
              <button class="btn btn-ghost btn-sm" onclick="App.closePreview(); App.openCustomerForm(${c.id})">编辑档案</button>
            </span>
          </div>
          <div class="muted" style="margin-top:6px;line-height:1.9">
            ${c.shortName ? "简称 " + esc(c.shortName) + " · " : ""}${c.industry ? esc(c.industry) + " · " : ""}${c.region ? esc(c.region) : ""}<br/>
            ${c.contactName ? "联系人 " + esc(c.contactName) + " " + esc(c.contactPhone || "") + " " + esc(c.email || "") : "无联系人信息"}
          </div>
          <div style="margin-top:8px;display:flex;gap:20px;flex-wrap:wrap;font-size:12.5px">
            <span>下次跟进：<b class="${dueClass(c.nextFollowDate)}">${esc(fmtYMD(c.nextFollowDate) || "—")}</b></span>
            <span>最近跟进：${esc(fmtYMD(c.lastFollowAt) || "—")}</span>
            ${c.notes ? `<span class="muted">备注：${esc(c.notes)}</span>` : ""}
          </div>
        </div>
        <div class="cols">
          <div class="card card-pad">
            <h3 class="card-title">跟进记录（${(c.followUps || []).length}）</h3>
            ${followRows || `<div class="empty">暂无跟进记录</div>`}
          </div>
          <div class="card card-pad">
            <h3 class="card-title">关联待办（${(c.openTasks || []).length} 未完成）</h3>
            ${openTaskRows || `<div class="empty">无未完成待办</div>`}
            <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="App.closePreview(); App.go('tasks')">去待办看板</button></div>
          </div>
        </div>`);
    }

    /* ---------------- 事件绑定 ---------------- */
    function bindViewEvents() {
      bindDonutInteraction();   // 环形图：段 ↔ 图例悬停联动（纯 DOM 更新，不重渲染）
      bindCalendarEvents();     // 首页日历：切月 / 选日 / 筛选 / 快捷完成 / 新增待办
      bindMainEvents();         // 标书编制：卡片进入 / 推进 / 回退 / 闸口批准驳回
      // 投标概览：点近期开标条目直接打开该项目
      document.querySelectorAll("[data-overview-open]").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => openProjectForm(el.dataset.overviewOpen));
      });
      document.querySelectorAll(".chip[data-status]").forEach(el => {
        el.addEventListener("click", () => { statusFilter = el.dataset.status; projectPage = 1; renderMain(); });
      });
      document.querySelectorAll("[data-edit]").forEach(el => {
        el.addEventListener("click", () => openProjectForm(el.dataset.edit));
      });
      document.querySelectorAll("[data-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", `确定删除项目「<b>${esc(el.dataset.name || "")}</b>」吗？此操作不可撤销。`, async () => {
            try { await Store.remove(el.dataset.del); toast("已删除"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderSidebar();
            renderMain();
          }, "删除", true);
        });
      });
      document.querySelectorAll("[data-status-for]").forEach(el => {
        el.addEventListener("change", async () => {
          const id = el.dataset.statusFor;
          const current = el.dataset.current;
          const to = el.value;
          if (to === current) return;
          try { await Store.setStatus(id, to); toast(`状态已流转：${current} → ${to}`); }
          catch (e) { toast("流转失败：" + friendlyError(e)); }
          renderMain();
        });
      });
      document.querySelectorAll("[data-doc-edit]").forEach(el => {
        el.addEventListener("click", () => openDocumentForm(el.dataset.docEdit));
      });
      document.querySelectorAll("[data-doc-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", `确定删除「<b>${esc(el.dataset.name || "")}</b>」的文件夹链接吗？`, async () => {
            try { await Store.removeDocument(el.dataset.docDel); toast("已删除链接"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });
      document.querySelectorAll("[data-sched-edit]").forEach(el => {
        el.addEventListener("click", () => openScheduleForm(el.dataset.schedEdit));
      });
      document.querySelectorAll("[data-sched-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", "确定删除该提醒吗？", async () => {
            try { await Store.removeSchedule(el.dataset.schedDel); toast("已删除提醒"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });
      document.querySelectorAll("[data-sched-ack]").forEach(el => {
        el.addEventListener("click", async () => {
          const next = el.dataset.status === "待提醒" ? "已提醒" : "待提醒";
          try { await Store.ackSchedule(el.dataset.schedAck, next); toast("已更新提醒状态"); }
          catch (e) { toast("操作失败：" + friendlyError(e)); }
          renderMain();
        });
      });
      document.querySelectorAll("[data-result-preview]").forEach(el => {
        el.addEventListener("click", () => {
          previewResult({ id: el.dataset.resultPreview, name: el.dataset.name, mime: el.dataset.mime });
        });
      });
      document.querySelectorAll("[data-result-reupload]").forEach(el => {
        el.addEventListener("click", () => reuploadResult(el.dataset.resultReupload, el.dataset.name));
      });
      document.querySelectorAll("[data-result-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", `确定删除文件「<b>${esc(el.dataset.name || "")}</b>」吗？`, async () => {
            try { await Store.removeResult(el.dataset.resultDel); toast("已删除"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });

      /* ---------- 个人工作台：任务/模板/客户/跟进事件 ---------- */
      // 任务看板状态筛选
      document.querySelectorAll(".chip[data-task-scope]").forEach(el => {
        el.addEventListener("click", () => { taskScope = el.dataset.taskScope; taskPage = 1; renderMain(); });
      });
      document.querySelectorAll(".chip[data-task-quad]").forEach(el => {
        el.addEventListener("click", () => { taskQuadrant = el.dataset.taskQuad; taskPage = 1; renderMain(); });
      });
      const taskMonthEl = document.querySelector("[data-task-month]");
      if (taskMonthEl) taskMonthEl.addEventListener("change", () => { taskMonth = taskMonthEl.value || thisMonthStr(); taskPage = 1; renderMain(); });
      document.querySelectorAll("[data-task-clear-q]").forEach(el => {
        el.addEventListener("click", () => { taskQ = ""; taskPage = 1; renderMain(); });
      });
      // 任务操作
      document.querySelectorAll("[data-task-done]").forEach(el => {
        el.addEventListener("click", async () => {
          const t = { id: el.dataset.taskDone, source: el.dataset.taskSource, customer: el.dataset.taskCustomer };
          if (t.source === "customer" && t.customer) {
            askCompleteTask({ id: t.id, source: t.source, customer: t.customer });
          } else {
            try { await Store.completeTask(t.id, null); toast("任务已完成 ✓"); }
            catch (e) { toast("操作失败：" + friendlyError(e)); }
            renderMain();
          }
        });
      });
      document.querySelectorAll("[data-task-reopen]").forEach(el => {
        el.addEventListener("click", async () => {
          try { await Store.reopenTask(el.dataset.taskReopen); toast("已重开任务"); }
          catch (e) { toast("操作失败：" + friendlyError(e)); }
          renderMain();
        });
      });
      document.querySelectorAll("[data-task-progress]").forEach(el => {
        el.addEventListener("click", async () => {
          try { await Store.updateTask(el.dataset.taskProgress, { status: "进行中" }); toast("已标记进行中"); }
          catch (e) { toast("操作失败：" + friendlyError(e)); }
          renderMain();
        });
      });
      document.querySelectorAll("[data-task-edit]").forEach(el => {
        el.addEventListener("click", () => openTaskForm(el.dataset.taskEdit));
      });
      document.querySelectorAll("[data-task-del]").forEach(el => {
        el.addEventListener("click", (e) => {
          e.stopPropagation(); // 防止冒泡触发卡片 data-task-open 编辑
          askConfirm("删除确认", `确定删除任务「<b>${esc(el.dataset.taskTitle || "")}</b>」吗？此操作不可撤销。`, async () => {
            try { await Store.removeTask(el.dataset.taskDel); toast("已删除任务"); }
            catch (err) { toast("删除失败：" + friendlyError(err)); }
            renderSidebar();
            renderMain();
          }, "删除", true);
        });
      });
      document.querySelectorAll("[data-task-open]").forEach(el => {
        el.addEventListener("click", (e) => { if (!e.target.closest("button")) openTaskForm(el.dataset.taskOpen); });
      });
      // 周期模板
      document.querySelectorAll("[data-tpl-gen]").forEach(el => {
        el.addEventListener("click", () => {
          const month = thisMonthStr();
          askConfirm("生成本月实例", `为「<b>${esc(el.dataset.name || "")}</b>」生成 ${esc(month)} 实例？`, async () => {
            try {
              const r = await Store.generateTemplateMonth(el.dataset.tplGen, month);
              toast(`已生成：${r.dueDate}`);
            } catch (e) {
              const msg = friendlyError(e);
              // 该月实例此前生成过但被删除 → 提供"恢复已删除实例"而不是再造一条新的
              if (/已被删除/.test(msg)) {
                askConfirm("该月实例已被删除", `${esc(msg)}<br/><br/>要把它<b>恢复</b>为「待办」吗？（不会新增重复记录）`, async () => {
                  try {
                    await Store.generateTemplateMonth(el.dataset.tplGen, month, true);
                    toast("已恢复该月实例");
                  } catch (e2) { toast("恢复失败：" + friendlyError(e2)); }
                  renderMain();
                }, "恢复");
                return;
              }
              toast("生成失败：" + msg);
            }
            renderMain();
          }, "生成");
        });
      });
      document.querySelectorAll("[data-tpl-edit]").forEach(el => {
        el.addEventListener("click", () => openTemplateForm(el.dataset.tplEdit));
      });
      document.querySelectorAll("[data-tpl-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", `确定删除周期任务模板「<b>${esc(el.dataset.name || "")}</b>」吗？（已有实例不受影响）`, async () => {
            try { await Store.removeTemplate(el.dataset.tplDel); toast("已删除模板"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });
      // 客户档案
      document.querySelectorAll(".chip[data-cust-status]").forEach(el => {
        el.addEventListener("click", () => { custStatus = el.dataset.custStatus; custPage = 1; renderMain(); });
      });
      const custSearchEl = document.getElementById("custSearch");
      if (custSearchEl) custSearchEl.addEventListener("input", debounce(() => { custQ = custSearchEl.value.trim(); custPage = 1; renderMain(); }, 300));
      document.querySelectorAll("[data-cust-clear-q]").forEach(el => {
        el.addEventListener("click", () => { custQ = ""; custPage = 1; renderMain(); });
      });
      document.querySelectorAll("[data-cust-edit]").forEach(el => {
        el.addEventListener("click", () => openCustomerForm(el.dataset.custEdit));
      });
      document.querySelectorAll("[data-cust-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", `确定删除客户「<b>${esc(el.dataset.name || "")}</b>」吗？其未完成的跟进待办将一并取消。`, async () => {
            try { await Store.removeCustomer(el.dataset.custDel); toast("已删除客户"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });
      document.querySelectorAll("[data-cust-detail]").forEach(el => {
        el.addEventListener("click", () => openCustomerDetail(el.dataset.custDetail));
      });
      document.querySelectorAll("[data-cust-follow]").forEach(el => {
        el.addEventListener("click", () => openFollowUpForm(null, el.dataset.custFollow));
      });
      // 跟进记录
      const followCustSel = document.querySelector("[data-follow-cust]");
      if (followCustSel) followCustSel.addEventListener("change", () => { followCustId = followCustSel.value; followPage = 1; renderMain(); });
      document.querySelectorAll("[data-fu-edit]").forEach(el => {
        el.addEventListener("click", () => openFollowUpForm(el.dataset.fuEdit, el.dataset.custId));
      });
      document.querySelectorAll("[data-fu-del]").forEach(el => {
        el.addEventListener("click", () => {
          askConfirm("删除确认", "确定删除该跟进记录吗？", async () => {
            try { await Store.removeFollowUp(el.dataset.fuDel); toast("已删除跟进记录"); }
            catch (e) { toast("删除失败：" + friendlyError(e)); }
            renderMain();
          }, "删除", true);
        });
      });
      // 跳转到指定视图（客户列表内）
      document.querySelectorAll("[data-navto]").forEach(el => {
        el.addEventListener("click", () => { closePreview(); go(el.dataset.navto); });
      });
      // 分页跳转
      document.querySelectorAll("[data-page-nav]").forEach(el => {
        el.addEventListener("click", () => {
          const key = el.dataset.pageNav;
          const p = Math.max(1, parseInt(el.dataset.page, 10) || 1);
          if (key === "project") projectPage = p;
          else if (key === "task") taskPage = p;
          else if (key === "cust") custPage = p;
          else if (key === "follow") followPage = p;
          renderMain();
        });
      });
    }

    /* ---------------- 全局搜索下拉 ---------------- */
    async function runGlobalSearch(q) {
      const panel = $("#searchPanel");
      if (!panel) return;
      const query = String(q || "").trim();
      if (!query) { panel.classList.remove("show"); panel.innerHTML = ""; return; }
      let data = null;
      try { data = await Store.globalSearch(query); } catch (e) { panel.innerHTML = `<div class="sp-empty">搜索失败：${esc(friendlyError(e))}</div>`; panel.classList.add("show"); return; }
      const rows = [];
      const hasAny = (data.projects.length || data.tasks.length || data.customers.length);
      if (!hasAny) { panel.innerHTML = `<div class="sp-empty">未找到与「${esc(query)}」相关的内容</div>`; panel.classList.add("show"); return; }
      if (data.projects.length) {
        rows.push(`<div class="sp-group">投标项目（${data.projects.length}）</div>`);
        data.projects.forEach(p => rows.push(`<div class="sp-item" data-search-go="project" data-id="${p.id}">
          <span class="sp-tag">项目</span><span class="sp-main">${esc(p.name)}</span>
          <span class="sp-sub">${esc(p.status || "")}${p.deadline ? " · " + esc(fmtYMD(p.deadline)) : ""}</span></div>`));
      }
      if (data.tasks.length) {
        rows.push(`<div class="sp-group">任务 / 待办（${data.tasks.length}）</div>`);
        data.tasks.forEach(t => rows.push(`<div class="sp-item" data-search-go="task" data-id="${t.id}">
          <span class="sp-tag">任务</span><span class="sp-main">${esc(t.title)}</span>
          <span class="sp-sub">${t.status === "已完成" ? "已完成" : (t.dueDate ? "截止 " + esc(fmtYMD(t.dueDate)) : "待办")}</span></div>`));
      }
      if (data.customers.length) {
        rows.push(`<div class="sp-group">客户（${data.customers.length}）</div>`);
        data.customers.forEach(c => rows.push(`<div class="sp-item" data-search-go="customer" data-id="${c.id}">
          <span class="sp-tag">客户</span><span class="sp-main">${esc(c.name)}</span>
          <span class="sp-sub">${esc(c.status || "")}</span></div>`));
      }
      panel.innerHTML = rows.join("");
      panel.classList.add("show");
      // 绑定点击（searchPanel 每次重建后绑定，避免重复监听）
      panel.querySelectorAll("[data-search-go]").forEach(el => {
        el.addEventListener("click", () => {
          const kind = el.dataset.searchGo;
          const id = el.dataset.id;
          panel.classList.remove("show");
          $("#globalSearch").value = query;
          if (kind === "project") { searchQuery = query; projectPage = 1; go("projects"); }
          else if (kind === "task") { taskQ = query; taskPage = 1; go("tasks"); }
          else if (kind === "customer") openCustomerDetail(id);
        });
      });
    }

    /* ---------------- 主题切换（暗色默认 / 浅色 opt-in） ---------------- */
    // data-theme 由内联引导脚本在首屏前写入（防闪屏），这里负责读写与重渲染。
    function readStoredTheme() {
      try {
        const v = localStorage.getItem(THEME_KEY);
        return v === "light" ? "light" : "dark";
      } catch (e) { return "dark"; }   // file:// 或隐私模式下 localStorage 可能不可用
    }
    function applyTheme(t) {
      const theme = t === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 忽略 */ }
      syncThemeButton();
      return theme;
    }
    function syncThemeButton() {
      const btn = document.getElementById("themeToggle");
      if (!btn) return;
      const light = isLight();
      btn.innerHTML = `${svgIcon(light ? "moon" : "sun", 14)} ${light ? "暗色" : "浅色"}`;
      btn.title = light ? "切换到暗色主题" : "切换到浅色主题";
      btn.setAttribute("aria-label", btn.title);
    }
    // 切主题后必须重渲染：图表颜色是渲染时算出来的（不能只靠 CSS 覆盖）
    async function toggleTheme() {
      const next = isLight() ? "dark" : "light";
      applyTheme(next);
      await renderSidebar();
      await renderMain();
      toast(next === "light" ? "已切换到浅色主题" : "已切换到暗色主题");
    }

    /* ---------------- 后端连通性自检（打不开数据时给出明确原因，而不是空白页） ---------------- */
    function showBackendBanner(protocol, reason) {
      if (document.getElementById("pwBackendBanner")) return;
      const el = document.createElement("div");
      el.id = "pwBackendBanner";
      const viaFile = protocol === "file:";
      el.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 14px;background:#7a1f1f;color:#fff;font-size:13px;line-height:1.75;box-shadow:0 2px 10px rgba(0,0,0,.35)";
      el.innerHTML = viaFile
        ? `<b>取不到数据：当前是用「本地文件」方式打开的（地址栏 file:///…）。</b><br>
           本工作台是「前端 + 8787 后端」的应用，必须通过 <b>http://127.0.0.1:8787/</b> 访问（后端已托管前端页面）。<br>
           若是在编辑器/侧栏的<b>文件预览沙箱</b>里打开的，脚本被禁止访问接口（沙箱只允许渲染静态内容）——请改用系统浏览器打开上面的地址。`
        : `<b>无法连接后端 http://127.0.0.1:8787（${esc(reason || "请求失败")}）。</b><br>
           请先启动后端：双击「启动个人工作台.bat」，或在 v2 目录执行 <code>node backend/src/index.js</code>；然后刷新本页。`;
      document.body.appendChild(el);
    }
    async function checkBackend() {
      try {
        const r = await fetch(API_BASE + "/health", { cache: "no-store" });
        const j = await r.json();
        if (!j || j.success !== true) throw new Error("health 返回异常");
        return true;
      } catch (e) {
        showBackendBanner(location.protocol, e && e.message);
        return false;
      }
    }

    async function init() {
      const searchInput = $("#globalSearch");
      searchInput.addEventListener("input", debounce(() => runGlobalSearch(searchInput.value), 320));
      document.addEventListener("click", (e) => {
        const panel = $("#searchPanel");
        if (panel && !panel.contains(e.target) && e.target !== searchInput) panel.classList.remove("show");
      });
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { searchInput.value = ""; runGlobalSearch(""); hideSearchPanel(); }
      });
      $("#modalMask").addEventListener("click", (e) => { if (e.target === $("#modalMask")) closeForm(); });
      // 确认框：按钮已由 askConfirm 内联绑定 onclick=App.confirmOk()；此处仅处理遮罩关闭
      $("#confirmMask").addEventListener("click", (e) => { if (e.target === $("#confirmMask")) closeConfirm(); });
      $("#importFile").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        handleImportFile(file).finally(() => { e.target.value = ""; });
      });
      $("#restoreFile").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        handleRestoreFile(file).finally(() => { e.target.value = ""; });
      });
      // hash 路由：浏览器前进/后退（hashchange）驱动视图切换
      window.addEventListener("hashchange", () => { renderRoute(); });
      // 首屏主题：内联引导脚本已写入 data-theme，这里同步按钮并把旧值兜底
      applyTheme(document.documentElement.dataset.theme || readStoredTheme());
      calLoadPrefs();                       // 日历偏好：类型筛选 / 只看未完成 / 折叠
      if (calSelDate !== todayStr()) calSelDate = todayStr();
      if (!location.hash) {
        try { history.replaceState(null, "", "#/home"); }
        catch (e) { location.hash = "#/home"; }
      }
      if (!(await checkBackend())) return;   // 后端不可用：显示原因横幅，不再渲染空数据视图
      await renderRoute();
    }

    return {
      init, go, openProjectForm, openDocumentForm, openScheduleForm, openMainForm, openMainNewForm,
      openTaskForm, openTemplateForm, openCustomerForm, openFollowUpForm, openCustomerDetail,
      closeForm, saveForm, parseFill, uploadResult, closePreview, refresh: () => renderMain(),
      exportModule, exportBackup, importData, restoreBackup, askConfirm, confirmOk, closeConfirm, toast,
      requestNotify, jumpProjects, jumpTasks, toggleTheme,
      // AI 助手（公告抽取）
      aiParse, aiCheck, aiApply, aiIgnore, aiCopyHint, aiPurge,
      aiPickFile, aiFileChosen, aiLoadExisting,
    };
  })();

  window.App = App;
  document.addEventListener("DOMContentLoaded", () => App.init());
  
