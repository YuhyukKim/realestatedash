// Public Seoul Open Data Plaza sheet downloads; no API key or geocoding fees.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
async function download(infId, order) {
  const response = await fetch("https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ srvType: "S", infId, serviceKind: "1", pageNo: "1", ssUserId: "SAMPLE_VIEW", strWhere: "", strOrderby: order, filterCol: "필터선택", txtFilter: "" }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${infId}: HTTP ${response.status}`);
  const raw = await response.text();
  const data = JSON.parse(raw).DATA;
  if (!Array.isArray(data) || !data.length) throw new Error(`${infId}: empty download`);
  return { data, sha256: createHash("sha256").update(raw).digest("hex") };
}

const [apartments, railway, kapt, reb] = await Promise.all([
  download("OA-15818", "SN ASC"), download("OA-21232", "BLDN_ID DESC"),
  readFile(new URL("db/generated-complexes.json", root), "utf8").then(JSON.parse),
  readFile(new URL("db/generated-reb-complexes.json", root), "utf8").then(JSON.parse),
]);
const validPoint = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 37.4 && lat <= 37.75 && lon >= 126.7 && lon <= 127.25;
const byCode = new Map();
for (const row of apartments.data) {
  const point = [Number(row.ycrd), Number(row.xcrd)];
  if (!validPoint(...point) || row.use_yn !== "Y") continue;
  const rows = byCode.get(row.apt_cd) ?? [];
  rows.push({ point, district: row.sgg_addr, dong: row.emd_addr });
  byCode.set(row.apt_cd, rows);
}
const master = [...kapt.filter((x) => !["다세대", "연립주택"].includes(x.complexType?.trim())), ...reb];
const complexes = {};
for (const row of master) {
  // Exact K-apt ID AND location only. Never assign a dong centroid or fuzzy name match.
  const matches = (byCode.get(row.kaptCode) ?? []).filter((x) => x.district === row.district && x.dong === row.dong);
  const unique = new Map(matches.map((x) => [x.point.join(","), x.point]));
  if (unique.size === 1) complexes[row.id] = [...unique.values()][0];
}
const lineAliases = {
  경부선: "1호선", 경인선: "1호선", 경원선: "1호선", 장항선: "1호선",
  일산선: "3호선", 안산선: "4호선", 과천선: "4호선", 진접선: "4호선",
  별내선: "8호선", 분당선: "수인분당선", 수인선: "수인분당선", 중앙선: "경의중앙선",
  공항철도1호선: "공항철도",
};
const stations = railway.data.flatMap((row) => {
  const latitude = Number(row.lat), longitude = Number(row.lot);
  // Wider border includes stations just outside Seoul. GTX contains unopened stations
  // in this catalog and is intentionally excluded until operating status is verified.
  if (row.route === "수도권 광역급행철도" || !validPoint(latitude, longitude)) return [];
  const route = row.route.replace(/\([^)]*\)/g, "");
  const lines = lineAliases[route] ?? route;
  const name = row.bldn_nm.replace(/\([^)]*\)/g, "").trim();
  return [{ key: String(row.bldn_id), name, lines, latitude, longitude }];
}).sort((a, b) => a.key.localeCompare(b.key));
if (Object.keys(complexes).length < 2000 || stations.length < 300) throw new Error("Unexpected coordinate coverage loss; preserving previous artifact");
const result = {
  generatedAt: new Date().toISOString(),
  sources: [
    { name: "서울시 공동주택 아파트 정보", url: "https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do", sha256: apartments.sha256 },
    { name: "서울시 역사마스터 정보", url: "https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do", sha256: railway.sha256 },
  ],
  license: "서울특별시 공공데이터 · 출처표시",
  coverage: { totalComplexes: master.length, geocodedComplexes: Object.keys(complexes).length, stationPoints: stations.length },
  complexes, stations,
};
// Generated compact artifact contains only coordinates and public station metadata.
await writeFile(new URL("app/transit-coordinates.json", root), JSON.stringify(result) + "\n");
console.log(result.coverage);
