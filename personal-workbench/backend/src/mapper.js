// DB 行 -> API 对象（snake_case -> camelCase），供各路由复用
const API_FIELDS = {
  id: "id", project_code: "projectCode", name: "name", tender_no: "tenderNo", lot_no: "lotNo",
  category: "category", industry: "industry", region: "region", tenderer: "tenderer", agency: "agency",
  budget: "budget", bond: "bond", bid_price: "bidPrice", status: "status",
  register_time: "registerTime", deadline: "deadline", open_time: "openTime",
  validity_days: "validityDays", duration: "duration", contact_name: "contactName", contact_phone: "contactPhone", notes: "notes",
  created_at: "createdAt", updated_at: "updatedAt",
};

export function toApi(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(API_FIELDS)) out[v] = row[k] ?? null;
  return out;
}
