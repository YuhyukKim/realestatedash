/**
 * Run only in a trusted operator/GitHub Actions environment.
 * No data files or credentials are written to disk.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fetchMolitXml, tag, isCanceledSale } from "../lib/molit-client.mjs";
import { CHUNK_SIZE, MAX_IMPORT_RECORDS, parseFeed, validRecordMonth } from "../lib/molit-records.mjs";

const DISTRICTS = {
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
const ENDPOINTS = {
  sale: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  rent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
};
function monthOrdinal(value) { return Number(value.slice(0, 4)) * 12 + Number(value.slice(4)) - 1; }
function monthString(ordinal) { return String(Math.floor(ordinal / 12)) + String(ordinal % 12 + 1).padStart(2, "0"); }
export function optionsFromEnv(env, now = new Date()) {
  const site = new URL(env.PUBLIC_SITE_URL ?? "");
  if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash || site.pathname !== "/" ||
      site.hostname === "localhost" || !site.hostname.includes(".")) throw new Error("PUBLIC_SITE_URL must be an HTTPS origin.");
  if (!env.MOLIT_API_KEY || !env.DATA_REFRESH_TOKEN || env.DATA_REFRESH_TOKEN.length < 32) throw new Error("Required collector secrets are missing.");
  const kinds = env.MOLIT_KIND === "both" || !env.MOLIT_KIND ? ["sale", "rent"] : [env.MOLIT_KIND];
  if (kinds.some(kind => !Object.hasOwn(ENDPOINTS, kind))) throw new Error("Invalid feed type.");
  const districts = [...new Set((env.MOLIT_DISTRICTS ?? "").split(",").map(name => name.trim()).filter(Boolean))];
  if (!districts.length || districts.some(name => !Object.hasOwn(DISTRICTS, name))) throw new Error("Specify valid Seoul districts; empty does not mean all.");
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(now).replace("-", "");
  const to = env.MOLIT_TO || current;
  const from = env.MOLIT_FROM || monthString(monthOrdinal(to) - 1);
  if (![from, to].every(month => validRecordMonth(month, "sale", now)) ||
      from > to || monthOrdinal(to) - monthOrdinal(from) >= 12) throw new Error("Use a valid range of at most 12 months.");
  const scopes = [];
  for (let n = monthOrdinal(from); n <= monthOrdinal(to); n++)
    for (const district of districts)
      for (const kind of kinds)
        if (validRecordMonth(monthString(n), kind, now)) scopes.push({ district, month: monthString(n), kind });
  if (!scopes.length || scopes.length > 150) throw new Error("Choose 1–150 district/month/feed scopes per run.");
  return { site: site.origin, serviceKey: env.MOLIT_API_KEY, token: env.DATA_REFRESH_TOKEN, scopes };
}
export async function postImport(site, token, payload, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    let retry = false;
    try {
      const response = await fetch(site + "/api/admin/trade-import", {
        method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) return await response.json();
      await response.body?.cancel();
      if (![429, 500, 502, 503, 504].includes(response.status)) throw new FatalImportError(response.status);
      retry = true;
    } catch (error) {
      if (error instanceof FatalImportError) throw error;
      retry = true;
    }
    if (retry && attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error("Upload failed after bounded retries; existing public snapshot was retained unless commit already succeeded.");
}
class FatalImportError extends Error {
  constructor(status) { super("Ingestion rejected (HTTP " + status + "); check configuration and permissions."); }
}
export function verifyStorageReport(report, expectedCount, id) {
  if (!report || report.id !== id || !report.storageComplete || !report.committed || report.abandoned ||
      !["expectedCount", "storedCount", "matchedCount", "unmatchedCount", "missingCount"].every(
        key => Number.isSafeInteger(report[key]) && report[key] >= 0) ||
      report.expectedCount !== expectedCount || report.storedCount !== expectedCount ||
      report.matchedCount + report.unmatchedCount !== report.storedCount || report.missingCount !== 0) {
    throw new Error("Stored observation counts could not be verified. Inspect the authenticated status report.");
  }
  return report;
}
export async function collectScope(config, scope, signal) {
  // Timestamp describes when collection began, so a delayed older run cannot
  // replace a newer observation. Publish only after ALL upstream pages validate.
  const fetchedAt = new Date().toISOString();
  const xml = await fetchMolitXml(ENDPOINTS[scope.kind], DISTRICTS[scope.district], scope.month, config.serviceKey, signal);
  const records = parseFeed(xml, scope.month, scope.kind, tag, isCanceledSale);
  if (records.length > MAX_IMPORT_RECORDS) throw new Error("Scope exceeds safe record limit.");
  const id = randomUUID();
  await postImport(config.site, config.token, { action: "start", id, ...scope, expectedCount: records.length, fetchedAt }, signal);
  for (let offset = 0; offset < records.length; offset += CHUNK_SIZE) {
    await postImport(config.site, config.token, { action: "chunk", id, offset, records: records.slice(offset, offset + CHUNK_SIZE) }, signal);
  }
  const result = await postImport(config.site, config.token, { action: "commit", id }, signal);
  if (!result.committed) throw new Error("Ingestion did not commit.");
  const report = verifyStorageReport(result.report, records.length, id);
  let cleanupPending = true;
  // GC cannot turn an already-successful publication into an apparent failure.
  try {
    const cleanupSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]);
    for (let attempt = 0; attempt < 10; attempt++) {
      const cleanup = await postImport(config.site, config.token, { action: "cleanup", id }, cleanupSignal);
      if (!cleanup.remaining) { cleanupPending = false; break; }
    }
  } catch { /* Report pending maintenance separately. */ }
  return { ...scope, id, records: records.length, stored: report.storedCount,
    matched: report.matchedCount, unmatched: report.unmatchedCount, published: report.published, cleanupPending };
}
export async function main(env = process.env) {
  const config = optionsFromEnv(env);
  let failures = 0;
  for (const scope of config.scopes) {
    try {
      const result = await collectScope(config, scope, AbortSignal.timeout(300000));
      console.log(JSON.stringify({ status: "complete", ...result }));
    } catch {
      // Never print upstream errors/request objects; they may contain service keys.
      failures++;
      console.error(JSON.stringify({ status: "failed", ...scope, message: "Collection/upload failed or commit acknowledgement lost. No incomplete snapshot is published; verify the stored collection timestamp before retrying. Check key approval, quotas and ingestion configuration." }));
    }
  }
  console.log(JSON.stringify({ scopes: config.scopes.length, failures }));
  if (failures) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Collector configuration failed. Check documented variables and secrets."); process.exitCode = 1; });
}
