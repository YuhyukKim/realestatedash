// Shared, dependency-free validation used by the collector and ingestion endpoint.
export const MAX_IMPORT_RECORDS = 50000;
export const CHUNK_SIZE = 200;
export function validRecordMonth(month, kind, now = new Date()) {
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now).replace("-", "");
  return /^20\d{2}(0[1-9]|1[0-2])$/.test(month) && month >= (kind === "rent" ? "201101" : "200601") && month <= current;
}
function text(value, max, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid text field");
  return value.trim();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid integer field");
  return value;
}
/**
 * @typedef {Object} MolitRecord
 * @property {string} apartment
 * @property {string} dong
 * @property {string|null} jibun
 * @property {string|null} aptSeq
 * @property {number|null} buildYear
 * @property {string} date
 * @property {"sale"|"jeonse"|"monthly"} type
 * @property {number} priceManwon
 * @property {number} monthlyRent
 * @property {number} area
 * @property {number|null} floor
 */
/** @returns {MolitRecord} */
export function sanitizeRecord(record, month, kind) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Invalid observation");
  const date = text(record.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.replaceAll("-", "").slice(0, 6) !== month ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Invalid contract date");
  const type = record.type;
  if (!(kind === "sale" ? type === "sale" : type === "jeonse" || type === "monthly")) throw new Error("Invalid feed type");
  const priceManwon = integer(record.priceManwon, 0, 1000000000);
  const monthlyRent = integer(record.monthlyRent, 0, 10000000);
  if ((type !== "monthly" && (priceManwon <= 0 || monthlyRent !== 0)) || (type === "monthly" && monthlyRent <= 0)) throw new Error("Invalid price");
  if (typeof record.area !== "number" || !Number.isFinite(record.area) || record.area <= 0 || record.area > 10000) throw new Error("Invalid area");
  return {
    apartment: text(record.apartment, 200), dong: text(record.dong, 80),
    jibun: text(record.jibun, 100, true), aptSeq: text(record.aptSeq, 100, true),
    buildYear: record.buildYear == null ? null : integer(record.buildYear, 1800, 2200),
    date, type, priceManwon, monthlyRent, area: record.area,
    floor: record.floor == null ? null : integer(record.floor, -20, 300),
  };
}

/** A malformed non-cancelled row invalidates the entire snapshot. */
export function parseFeed(xml, month, kind, tag, isCanceledSale) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const money = value => {
    const clean = value.replaceAll(",", "").trim();
    if (!/^\d+$/.test(clean)) throw new Error("Invalid money field");
    return Number(clean);
  };
  const optionalNumber = value => value.trim() === "" ? null : Number(value);
  return items.filter(item => kind !== "sale" || !isCanceledSale(item)).map(item => {
    const monthlyRent = kind === "rent" ? money(tag(item, "monthlyRent", "월세금액")) : 0;
    return sanitizeRecord({
      apartment: tag(item, "aptNm", "아파트"), dong: tag(item, "umdNm", "법정동"),
      jibun: tag(item, "jibun", "지번") || null, aptSeq: tag(item, "aptSeq") || null,
      buildYear: optionalNumber(tag(item, "buildYear", "건축년도")),
      date: tag(item, "dealYear", "년") + "-" + tag(item, "dealMonth", "월").padStart(2, "0") + "-" + tag(item, "dealDay", "일").padStart(2, "0"),
      type: kind === "sale" ? "sale" : monthlyRent > 0 ? "monthly" : "jeonse",
      priceManwon: money(kind === "sale" ? tag(item, "dealAmount", "거래금액") : tag(item, "deposit", "보증금액")),
      monthlyRent, area: Number(tag(item, "excluUseAr", "전용면적")), floor: optionalNumber(tag(item, "floor", "층")),
    }, month, kind);
  });
}
