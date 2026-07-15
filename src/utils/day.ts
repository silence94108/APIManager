/** 本地时区 YYYY-MM-DD。所有"今日"判断必须走这里，禁用 toISOString()（UTC 跨日 bug） */
export function localDayString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地时区 YYYY-MM（new-api 签到状态查询的 ?month= 参数） */
export function localMonthString(d: Date = new Date()): string {
  return localDayString(d).slice(0, 7);
}

/** "HH:mm" → 当日分钟数；非法输入返回 null */
export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
