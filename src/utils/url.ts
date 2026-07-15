/** 用户输入 → 规范化 origin（补协议、去路径和尾斜杠）。输入非法时抛 TypeError，由表单校验兜住 */
export function normalizeOrigin(input: string): string {
  const trimmed = input.trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProto).origin;
}

export function isValidSiteUrl(input: string): boolean {
  try {
    normalizeOrigin(input);
    return true;
  } catch {
    return false;
  }
}
