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
