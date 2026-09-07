/** Public identity and dates are independent of the hosting provider. */
export const SITE_NAME = "내집어디";
export const SITE_TITLE = "내집어디 | 서울 아파트 찾기";
export const SITE_DESCRIPTION = "예산, 면적, 지하철, 직장 접근성으로 서울 아파트를 찾고 확인된 실거래와 생활 정보를 비교하세요.";
export function seoulMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now);
  return parts.find(p => p.type === "year")!.value + "-" + parts.find(p => p.type === "month")!.value;
}
export function siteOrigin(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}
