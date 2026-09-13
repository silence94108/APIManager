/** Retry-After 支持秒数和 HTTP 日期；无有效值时至少等待一分钟。 */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  const text = value?.trim();
  if (text && /^\d+(?:\.\d+)?$/.test(text)) {
    const at = now + Number(text) * 1000;
    if (Number.isFinite(at) && at <= 8.64e15) return at;
  } else if (text && /(?:GMT|UTC)$/i.test(text)) {
    const at = Date.parse(text);
    if (Number.isFinite(at)) return Math.max(now, at);
  }
  return now + 60_000;
}
