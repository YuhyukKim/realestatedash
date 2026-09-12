import { validRecordMonth, sanitizeRecord, MAX_IMPORT_RECORDS } from "./molit-records.mjs";
export const DISTRICTS = {
  "종로구": "11110",
  "중구": "11140",
  "용산구": "11170",
  "성동구": "11200",
  "광진구": "11215",
  "동대문구": "11230",
  "중랑구": "11260",
  "성북구": "11290",
  "강북구": "11305",
  "도봉구": "11320",
  "노원구": "11350",
  "은평구": "11380",
  "서대문구": "11410",
  "마포구": "11440",
  "양천구": "11470",
  "강서구": "11500",
  "구로구": "11530",
  "금천구": "11545",
  "영등포구": "11560",
  "동작구": "11590",
  "관악구": "11620",
  "서초구": "11650",
  "강남구": "11680",
  "송파구": "11710",
  "강동구": "11740"
};
export const ENDPOINTS = {
  sale: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  rent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
};
export function monthOrdinal(value) { return Number(value.slice(0, 4)) * 12 + Number(value.slice(4)) - 1; }
export function monthString(n) { return String(Math.floor(n / 12)) + String(n % 12 + 1).padStart(2, "0"); }
export function monthsInRange(from, to) {
  return Array.from({length: monthOrdinal(to)-monthOrdinal(from)+1}, (_,i)=>monthString(monthOrdinal(from)+i));
}
export function staticOptions(env, now = new Date()) {
  if (!env.MOLIT_API_KEY?.trim()) throw new Error("MOLIT_API_KEY is missing.");
  const kinds = !env.MOLIT_KIND || env.MOLIT_KIND === "both" ? ["sale", "rent"] : [env.MOLIT_KIND];
  if (kinds.some(k => !Object.hasOwn(ENDPOINTS,k))) throw new Error("Invalid feed type.");
  const districts = [...new Set((env.MOLIT_DISTRICTS ?? "").split(",").map(s=>s.trim()).filter(Boolean))];
  if (!districts.length || districts.some(d=>!Object.hasOwn(DISTRICTS,d))) throw new Error("Specify valid Seoul districts; empty does not mean all.");
  const current = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit"}).format(now).replace("-","");
  const to = env.MOLIT_TO || current;
  const from = env.MOLIT_FROM || monthString(monthOrdinal(to)-1);
  if (![from,to].every(m=>validRecordMonth(m,"sale",now)) || from>to || monthOrdinal(to)-monthOrdinal(from)>=12)
    throw new Error("Use a valid range of at most 12 months.");
  const scopes = monthsInRange(from,to).flatMap(month=>districts.flatMap(district=>kinds
    .filter(kind=>validRecordMonth(month,kind,now)).map(kind=>({district,month,kind}))));
  if (!scopes.length || scopes.length>150) throw new Error("Choose 1–150 district/month/feed scopes per run.");
  return {serviceKey:env.MOLIT_API_KEY.trim(),scopes};
}
/** Whitelist all persisted fields. Never persist API URLs, headers or credentials. */
export function validateSnapshot(value, now = new Date()) {
  if (!value || value.version !== 1 || !Object.hasOwn(DISTRICTS,value.district) ||
      !Object.hasOwn(ENDPOINTS,value.kind) || !validRecordMonth(value.month,value.kind,now) ||
      typeof value.fetchedAt !== "string" || !Number.isFinite(Date.parse(value.fetchedAt)) ||
      !Array.isArray(value.records) || value.records.length>MAX_IMPORT_RECORDS ||
      value.expectedCount !== value.records.length) throw new Error("Invalid or incomplete snapshot.");
  return {version:1,district:value.district,month:value.month,kind:value.kind,
    fetchedAt:new Date(value.fetchedAt).toISOString(),expectedCount:value.expectedCount,
    records:value.records.map(r=>sanitizeRecord(r,value.month,value.kind))};
}
export function scopeFile(snapshot) {
  return DISTRICTS[snapshot.district]+"/"+snapshot.month+"."+snapshot.kind+".json";
}
