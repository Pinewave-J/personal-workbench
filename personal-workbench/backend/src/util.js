// 通用工具：响应封装 + 时间
export function now() {
  return new Date().toISOString();
}

export function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data, error: null });
}

export function fail(res, status, code, message, fields) {
  const error = { code, message };
  if (fields) error.fields = fields;
  res.status(status).json({ success: false, data: null, error });
}
