// 状态机定义（与 backend-design.md §3 对齐）
export const STATUS = ["跟踪中", "已报名", "已购标书", "已投标", "已开标", "中标", "未中标", "流标"];
export const CATEGORY = ["工程监理", "造价", "咨询", "全过程咨询", "工程管理", "其他"];

const TERMINAL = new Set(["中标", "未中标", "流标"]);

// 允许的流转：当前状态 -> 可流转到的状态集合
const TRANSITIONS = {
  "跟踪中": ["已报名", "流标"],
  "已报名": ["已购标书", "流标"],
  "已购标书": ["已投标", "流标"],
  "已投标": ["已开标", "流标"],
  "已开标": ["中标", "未中标", "流标"],
  "中标": [],
  "未中标": [],
  "流标": [],
};

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function canTransition(from, to) {
  if (!STATUS.includes(to)) return false;
  if (isTerminal(from)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}
