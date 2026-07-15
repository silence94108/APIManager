/** 各分叉后端认不同的用户 ID 头，全部带上（值 = 站点用户 id） */
const COMPAT_USER_HEADER_NAMES = [
  "New-API-User",
  "Veloera-User",
  "voapi-user",
  "User-id",
] as const;

export function buildCompatUserHeaders(userId: string): Record<string, string> {
  if (!userId) return {};
  return Object.fromEntries(COMPAT_USER_HEADER_NAMES.map((name) => [name, userId]));
}
