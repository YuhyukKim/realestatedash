import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchMolitXml, tag, isCanceledSale } from "../lib/molit-client.mjs";
import { parseFeed } from "../lib/molit-records.mjs";
import { staticOptions, validateSnapshot, scopeFile, DISTRICTS, ENDPOINTS } from "../lib/pages-snapshots.mjs";
export async function collectSnapshots(config, fetchXml = fetchMolitXml) {
  const snapshots = [];
  for (const scope of config.scopes) {
    const fetchedAt = new Date().toISOString();
    const xml = await fetchXml(ENDPOINTS[scope.kind],DISTRICTS[scope.district],scope.month,config.serviceKey,AbortSignal.timeout(180000));
    const records = parseFeed(xml,scope.month,scope.kind,tag,isCanceledSale);
    snapshots.push(validateSnapshot({version:1,...scope,fetchedAt,expectedCount:records.length,records}));
    console.log(scope.district+" "+scope.month+" "+scope.kind+": "+records.length+" validated records");
  }
  return snapshots; // No file replacement until EVERY requested scope succeeded.
}
export async function persistSnapshots(snapshots, root = "data/scopes") {
  const planned = [];
  for (const raw of snapshots) {
    const s = validateSnapshot(raw);
    const path = join(root,scopeFile(s));
    let previous;
    try { previous = validateSnapshot(JSON.parse(await readFile(path,"utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && previous.fetchedAt > s.fetchedAt) throw new Error("Refusing to replace a newer snapshot.");
    // A previously nonempty response suddenly becoming empty deserves review.
    // Keep the old public snapshot; do not silently wipe an entire feed.
    if (previous?.records.length && !s.records.length) throw new Error("Nonempty scope became empty; review upstream data before replacing.");
    planned.push({path,s});
  }
  for (const {path,s} of planned) {
    await mkdir(join(root,DISTRICTS[s.district]),{recursive:true});
    await writeFile(path+".tmp",JSON.stringify(s)+"\n",{mode:0o600});
    await rename(path+".tmp",path);
  }
}

/** Log only fixed diagnostic codes: never upstream text, request URLs or credentials. */
export function collectionFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  const http = /^공공데이터 조회 실패 \(([1-5][0-9]{2})\)$/.exec(message);
  if (http) return "UPSTREAM_HTTP_" + http[1];
  const known = new Map([
    ["공공데이터 응답 시간 초과 (재시도 완료)", "UPSTREAM_TIMEOUT"],
    ["조회 제한시간 초과 또는 요청 취소", "COLLECTION_TIMEOUT"],
    ["공공데이터 연결 실패 (재시도 완료)", "UPSTREAM_CONNECTION"],
    ["공공데이터 API 응답을 확인할 수 없습니다.", "UPSTREAM_RESPONSE"],
    ["실거래 전체 건수가 누락되었습니다.", "MISSING_TOTAL"],
    ["조회 중 전체 건수가 변경되었습니다. 다시 조회해 주세요.", "TOTAL_CHANGED"],
    ["실거래 페이지 응답이 올바르지 않습니다.", "INVALID_PAGE"],
    ["실거래 전체 페이지를 수집하지 못했습니다.", "INCOMPLETE_PAGES"],
    ["실거래 페이지 수가 조회 한도를 초과했습니다.", "PAGE_LIMIT"],
    ["MOLIT_API_KEY is missing.", "MISSING_API_KEY"],
    ["Invalid money field", "INVALID_MONEY"],
    ["Invalid price", "INVALID_PRICE"],
    ["Invalid text field", "INVALID_TEXT"],
    ["Invalid integer field", "INVALID_INTEGER"],
    ["Invalid contract date", "INVALID_DATE"],
    ["Invalid area", "INVALID_AREA"],
    ["Invalid or incomplete snapshot.", "INVALID_SNAPSHOT"],
    ["Refusing to replace a newer snapshot.", "NEWER_SNAPSHOT_EXISTS"],
    ["Nonempty scope became empty; review upstream data before replacing.", "SUSPICIOUS_EMPTY_SCOPE"],
  ]);
  return known.get(message) ?? "UNCLASSIFIED_FAILURE";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await persistSnapshots(await collectSnapshots(staticOptions(process.env))); }
  catch (error) { console.error("Collection failed [" + collectionFailureCode(error) + "]. No snapshot commit or deployment was made. Check API approval, quota, input range and previous successful scopes."); process.exitCode=1; }
}
