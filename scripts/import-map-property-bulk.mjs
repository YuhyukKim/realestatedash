// scripts/import-official-property-bulk.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// server/official-property.mjs
var SOURCES = {
  building: { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uAC74\uCD95HUB \xB7 \uAC74\uCD95\uBB3C\uB300\uC7A5", url: "https://www.data.go.kr/data/15134735/openapi.do" },
  price: { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \xB7 \uACF5\uB3D9\uC8FC\uD0DD \uACF5\uC2DC\uAC00\uACA9", url: "https://www.realtyprice.kr/notice/town/nfSiteLink.htm" },
  school: { name: "\uD55C\uAD6D\uAD50\uC721\uC2DC\uC124\uC548\uC804\uC6D0 \xB7 \uC804\uAD6D\uCD08\uC911\uB4F1\uD559\uAD50\uC704\uCE58\uD45C\uC900\uB370\uC774\uD130", url: "https://www.data.go.kr/data/15021148/standard.do" },
  rail: { name: "\uC11C\uC6B8\uD2B9\uBCC4\uC2DC \xB7 \uC5ED\uC0AC\uB9C8\uC2A4\uD130 \uC815\uBCF4", url: "https://data.seoul.go.kr/dataList/OA-21232/A/1/datasetView.do" },
  bus: { name: "\uC11C\uC6B8\uD2B9\uBCC4\uC2DC \xB7 \uBC84\uC2A4\uC815\uB958\uC18C \uC704\uCE58\uC815\uBCF4", url: "https://data.seoul.go.kr/dataList/OA-15067/S/1/datasetView.do" },
  rules: { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uD1A0\uC9C0\uC774\uC74C \xB7 \uD1A0\uC9C0\uC774\uC6A9\uACC4\uD68D", url: "https://www.eum.go.kr/" }
};
var cleanText = (v) => v == null ? "" : String(v).trim().slice(0, 240);
var finite = (v) => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
var normalizeName = (v) => cleanText(v).normalize("NFKC").replace(/아파트|신시가지|[\s()·.\-]/g, "");
var sortNames = (a, b) => a.localeCompare(b, "ko", { numeric: true });
function matchedBuildingTitles(candidate, titles) {
  const reviewed = candidate.registerIdentity?.reviewedTitleIds;
  if (reviewed) {
    if (!reviewed.length || new Set(reviewed).size !== reviewed.length) throw Error("needs_review");
    const found = titles.filter((r) => reviewed.includes(cleanText(r.mgmBldrgstPk)));
    if (found.length !== reviewed.length) throw Error("needs_review");
    return found;
  }
  const names = new Set(candidate.names.map(normalizeName));
  const verifiedParcel = candidate.registerIdentity?.singleComplex || candidate.registerIdentity?.coversWholeParcel;
  if (verifiedParcel) for (const name of [...names]) {
    if (/[가-힣].*?(?:제)?\d+동$/.test(name)) names.add(name.replace(/(?:제)?\d+동$/, ""));
  }
  const ancillary = /관리사무실|경비실|보일러실|변전실|노인정|독서실|기계실|중앙공급실|공중변소|체육관/;
  const residential = titles.filter((r) => (!r.mainPurpsCdNm || /공동주택|아파트|연립주택|다세대주택/.test(r.mainPurpsCdNm)) && !ancillary.test(cleanText(r.dongNm)));
  const named = (r) => {
    const name = normalizeName(r.bldNm);
    if (!name) return false;
    if (names.has(name)) return true;
    const dong = normalizeName(r.dongNm).replace(/^제/, "").replace(/동$/, "");
    if (!dong) return false;
    return [dong + "\uB3D9", "\uC81C" + dong + "\uB3D9", dong].some((suffix) => name.endsWith(suffix) && names.has(name.slice(0, -suffix.length)));
  };
  const identity = candidate.registerIdentity;
  const numbered = residential.filter((r) => /^(?:제)?\d+동?$/.test(cleanText(r.dongNm)));
  const housing = verifiedParcel && numbered.length === identity.residentialBuildings ? numbered : residential;
  const allowBlank = verifiedParcel && housing.length === identity.residentialBuildings && housing.every((r) => !cleanText(r.bldNm) || named(r));
  const approvedBlank = new Set(allowBlank ? housing : []);
  return residential.filter((r) => named(r) || approvedBlank.has(r) && !cleanText(r.bldNm));
}
function buildingProfile(candidate, titles, expos, areas) {
  const matched = matchedBuildingTitles(candidate, titles);
  if (!matched.length) throw Error("needs_review");
  const byDong = new Set(matched.map((r) => cleanText(r.dongNm))), units = {}, records = {};
  const selected = expos.filter((r) => cleanText(r.hoNm) && byDong.has(cleanText(r.dongNm))), seen = /* @__PURE__ */ new Map(), qualified = /* @__PURE__ */ new Set();
  const namedTitle = (r) => cleanText(r.bldNm) && matched.some((t) => cleanText(t.dongNm) === cleanText(r.dongNm) && cleanText(t.bldNm) === cleanText(r.bldNm));
  for (const r of selected) {
    const key = cleanText(r.dongNm) + "|" + cleanText(r.hoNm), prior = seen.get(key);
    if (prior && cleanText(prior.mgmBldrgstPk) !== cleanText(r.mgmBldrgstPk)) {
      if (!namedTitle(prior) || !namedTitle(r) || cleanText(prior.bldNm) === cleanText(r.bldNm)) throw Error("needs_review");
      qualified.add(cleanText(r.dongNm));
    }
    seen.set(key, r);
  }
  const dongLabel = (r) => (qualified.has(cleanText(r.dongNm)) ? cleanText(r.bldNm) + " \xB7 " : "") + (cleanText(r.dongNm) || "\uB3D9 \uAD6C\uBD84 \uC5C6\uC74C");
  for (const r of selected) {
    if (qualified.has(cleanText(r.dongNm)) && !namedTitle(r)) throw Error("needs_review");
    const dong = dongLabel(r), ho = cleanText(r.hoNm);
    const key = dong + "|" + ho, registerId = cleanText(r.mgmBldrgstPk);
    if (records[key] && records[key].registerId !== registerId) throw Error("needs_review");
    records[key] = { dong, ho, registerId, ...qualified.has(cleanText(r.dongNm)) ? { registerDong: cleanText(r.dongNm), registerName: cleanText(r.bldNm) } : {}, floor: cleanText(r.flrNo), producedAt: cleanText(r.crtnDay), rows: [] };
  }
  const byId = new Map(Object.values(records).map((r) => [r.registerId, r]));
  for (const r of areas) {
    const id = cleanText(r.mgmBldrgstPk), unit = id ? byId.get(id) : records[dongLabel(r) + "|" + cleanText(r.hoNm)];
    if (!unit) continue;
    const kind = cleanText(r.exposPubuseGbCdNm), area = finite(r.area);
    if (!["\uC804\uC720", "\uACF5\uC6A9"].includes(kind) || area === null || area < 0) continue;
    unit.rows.push({ kind, floor: cleanText(r.flrNoNm || r.flrNo), floorGroup: cleanText(r.flrGbCdNm), purpose: cleanText(r.etcPurps) || cleanText(r.mainPurpsCdNm), area, producedAt: cleanText(r.crtnDay) });
  }
  for (const [key, r] of Object.entries(records)) {
    if (/^(복도|계단|현관|옥탑|지하실|보일러실|변전실|기계실)$/.test(r.ho) && r.rows.length && r.rows.every((a) => a.kind === "\uACF5\uC6A9")) {
      delete records[key];
      continue;
    }
    (units[r.dong] ??= []).push(r.ho);
  }
  for (const dong of Object.keys(units)) units[dong] = [...new Set(units[dong])].sort(sortNames);
  return { status: "ready", name: cleanText(matched[0].bldNm), address: cleanText(matched[0].platPlc), source: SOURCES.building, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), units, records, buildings: matched.map((r) => ({ dong: dongLabel(r), name: cleanText(r.bldNm), address: cleanText(r.newPlatPlc || r.platPlc), purpose: cleanText(r.mainPurpsCdNm), structure: cleanText(r.strctCdNm), approval: cleanText(r.useAprDay), floors: finite(r.grndFlrCnt), basementFloors: finite(r.ugrndFlrCnt), households: finite(r.hhldCnt), coverage: finite(r.bcRat), floorAreaRatio: finite(r.vlRat) })) };
}

// server/register-buildings.mjs
function registerCandidates(candidate, previous = {}) {
  const entries = candidate.registerCandidates?.length ? candidate.registerCandidates : (previous.registerParcels || [candidate.pnu]).map((pnu) => ({ pnu, names: candidate.names }));
  return entries.map((p) => {
    if (!/^11\d{17}$/.test(p.pnu) || p.pnu.slice(0, 5) !== candidate.pnu.slice(0, 5)) throw Error("needs_review");
    return { ...candidate, pnu: p.pnu, registerIdentity: p.identity, names: [.../* @__PURE__ */ new Set([...p.names, ...candidate.id >= 374 && candidate.id <= 387 ? ["\uBAA9\uB3D9\uC2E0\uC2DC\uAC00\uC9C0\uC544\uD30C\uD2B8"] : []])] };
  });
}
async function collectBuildingParcels(candidate, previous, getRows) {
  const parcels = registerCandidates(candidate, previous), profiles = [];
  for (const parcel of parcels) {
    const titles = await getRows("getBrTitleInfo", parcel.pnu);
    const matched = matchedBuildingTitles(parcel, titles);
    if (!matched.length || (parcel.registerIdentity?.singleComplex || parcel.registerIdentity?.coversWholeParcel) && matched.length < parcel.registerIdentity.residentialBuildings) {
      const e = Error("needs_review");
      e.observedBuildings = titles.map((t) => ({ name: t.bldNm, dong: t.dongNm, address: t.platPlc, purpose: t.mainPurpsCdNm }));
      throw e;
    }
    const expos = await getRows("getBrExposInfo", parcel.pnu), areas = await getRows("getBrExposPubuseAreaInfo", parcel.pnu);
    const profile = buildingProfile(parcel, titles, expos, areas);
    if (!Object.keys(profile.records).length || Object.values(profile.records).some((r) => !r.registerId || !r.rows.some((row) => row.kind === "\uC804\uC720"))) throw Error("incomplete_response");
    profiles.push(profile);
  }
  const byLabel = /* @__PURE__ */ new Map(), qualify = /* @__PURE__ */ new Set();
  for (const p of profiles) for (const [key, r] of Object.entries(p.records)) {
    if (byLabel.has(key) && byLabel.get(key) !== r.registerId) qualify.add(r.dong);
    byLabel.set(key, r.registerId);
  }
  const building = { ...profiles[0], units: {}, records: {}, buildings: [] };
  for (const [index, p] of profiles.entries()) {
    const parcel = parcels[index];
    const prefix = (p.address || parcel.pnu).replace(/^서울특별시 \S+ /, "").replace(/번지$/, "");
    for (const [key, record] of Object.entries(p.records)) {
      const unit = qualify.has(record.dong) ? { ...record, dong: prefix + " \xB7 " + record.dong, registerDong: record.dong, registerPnu: parcel.pnu } : record;
      const target = unit.dong + "|" + unit.ho;
      if (building.records[target] && building.records[target].registerId !== unit.registerId) throw Error("needs_review");
      building.records[target] ??= unit;
    }
    for (const row of p.buildings) {
      const entry = qualify.has(row.dong) ? { ...row, dong: prefix + " \xB7 " + row.dong } : row;
      if (!building.buildings.some((r) => r.dong === entry.dong && r.address === entry.address)) building.buildings.push(entry);
    }
  }
  for (const unit of Object.values(building.records)) (building.units[unit.dong] ??= []).push(unit.ho);
  for (const units of Object.values(building.units)) units.sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  return { building, registerParcels: parcels.map((p) => p.pnu) };
}

// server/assessment-years.mjs
function assessmentYears(selection2 = "recent5", currentYear = (/* @__PURE__ */ new Date()).getUTCFullYear()) {
  const value = String(selection2).trim();
  if (value === "all") return null;
  if (value === "recent5") return Array.from({ length: 5 }, (_, i) => String(currentYear - 4 + i));
  const match = value.match(/^(20\d{2})(?:-(20\d{2}))?$/);
  if (!match) throw Error("Invalid assessment year");
  const start = Number(match[1]), end = Number(match[2] || match[1]);
  if (end < start || end - start > 49) throw Error("Invalid assessment year range");
  return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
}

// server/official-prices.mjs
function registerPriceProfile(building, rows2, selectedYear) {
  const byId = new Map(Object.values(building.records || {}).filter((r) => r.registerId).map((r) => [r.registerId, r])), units = {}, records = {}, years2 = /* @__PURE__ */ new Set();
  const selected = selectedYear ? assessmentYears(selectedYear) : null;
  for (const r of rows2) {
    const unit = byId.get(cleanText(r.mgmBldrgstPk)), price = finite(r.hsprc), day = cleanText(r.stdDay);
    if (!unit || price === null || price <= 0 || !/^\d{8}$/.test(day) || selected && !selected.includes(day.slice(0, 4))) continue;
    const year = day.slice(0, 4), key = unit.dong + "|" + unit.ho, privateRows = unit.rows.filter((x) => x.kind === "\uC804\uC720");
    const record = records[key] ??= { dong: unit.dong, ho: unit.ho, rows: [] };
    const value = { year, date: year + "." + day.slice(4, 6) + "." + day.slice(6, 8), area: privateRows.length ? privateRows.reduce((sum, x) => sum + x.area, 0) : null, areaSource: "building-register", price, updatedAt: cleanText(r.crtnDay) };
    if (!record.rows.some((x) => x.date === value.date && x.price === price)) record.rows.push(value);
    years2.add(year);
    (units[unit.dong] ??= /* @__PURE__ */ new Set()).add(unit.ho);
  }
  if (rows2.length && !Object.keys(records).length) throw Error("needs_review");
  for (const record of Object.values(records)) record.rows.sort((a, b) => b.date.localeCompare(a.date));
  return { status: Object.keys(records).length ? "ready" : "empty", address: building.address, units: Object.fromEntries(Object.entries(units).map(([d, hs]) => [d, [...hs].sort(sortNames)])), records, years: [...years2].sort().reverse(), source: { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uAC74\uCD95HUB \xB7 \uC8FC\uD0DD\uAC00\uACA9\uC815\uBCF4", url: "https://www.data.go.kr/data/15134735/openapi.do" }, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function expectsHousingPrice(unit) {
  const privateRows = (unit.rows || []).filter((r) => r.kind === "\uC804\uC720");
  const business = /근린생활시설|근생활시설|교육연구시설|점포|학원|은행|슈퍼마켓|약국|부동산중개|소매점|음식점|미용원|제조업소/;
  return !privateRows.length || !privateRows.every((r) => business.test(r.purpose || "") && !/주택|아파트|주거/.test(r.purpose || ""));
}

// server/bulk-property-prices.mjs
function mergeBulkPrices(previous, building, incoming, sourceAsOf) {
  const byId = new Map(Object.values(building.records || {}).map((r) => [r.registerId, r]));
  const records = {}, preserved = [];
  for (const [key, record] of Object.entries(previous.prices?.records || {})) {
    const current = byId.get(previous.building?.records?.[key]?.registerId);
    if (!current) continue;
    records[current.dong + "|" + current.ho] = { dong: current.dong, ho: current.ho, rows: record.rows.map((r) => ({ ...r })) };
  }
  let added = 0;
  for (const [key, record] of Object.entries(incoming.records || {})) {
    if (!building.records?.[key]?.registerId) throw Error("bulk_price_register_mismatch");
    const incomingDates = /* @__PURE__ */ new Map();
    for (const row of record.rows) {
      if (incomingDates.has(row.date) && incomingDates.get(row.date) !== row.price) throw Error("bulk_price_conflicting_values");
      incomingDates.set(row.date, row.price);
    }
    const result = records[key] ??= { dong: record.dong, ho: record.ho, rows: [] };
    for (const row of record.rows) {
      const existing = result.rows.filter((r) => r.date === row.date);
      if (existing.length) {
        if (existing.some((r) => r.price !== row.price)) preserved.push({ dong: record.dong, ho: record.ho, date: row.date });
        continue;
      }
      result.rows.push({ ...row, sourceAsOf, sourceKind: "official-hub-bulk" });
      added++;
    }
  }
  const units = {};
  for (const record of Object.values(records)) {
    record.rows.sort((a, b) => b.date.localeCompare(a.date));
    (units[record.dong] ??= []).push(record.ho);
  }
  for (const values of Object.values(units)) values.sort(sortNames);
  return { profile: { ...incoming, status: Object.keys(records).length ? "ready" : "empty", records, units, years: [...new Set(Object.values(records).flatMap((r) => r.rows.map((r2) => r2.year)))].sort().reverse() }, added, preserved };
}

// scripts/import-official-property-bulk.mjs
var input = process.argv[2];
var output = process.argv[3] || "data/property";
if (!input) throw Error("Pass the verified bulk extraction directory");
var catalog = JSON.parse(fs.readFileSync("data/parcel-candidates.json", "utf8"));
var kinds = { getBrTitleInfo: "titles", getBrExposInfo: "expos", getBrExposPubuseAreaInfo: "areas", getBrHsprcInfo: "prices" };
var manifests = Object.fromEntries(Object.values(kinds).map((k) => [k, JSON.parse(fs.readFileSync(path.join(input, k + "-manifest.json"), "utf8"))]));
for (const m of Object.values(manifests)) assert.ok(m.complete && /^[a-f0-9]{64}$/.test(m.sha256));
var years = manifests.prices.years;
var selection = years[0] + "-" + years.at(-1);
var asOf = manifests.prices.sourceAsOf;
assert.ok(Object.values(manifests).every((m) => m.sourceAsOf === asOf));
var source = { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uAC74\uCD95HUB \xB7 \uC8FC\uD0DD\uAC00\uACA9\uC815\uBCF4", url: manifests.prices.sourceUrl };
var audit = { checkedAt: (/* @__PURE__ */ new Date()).toISOString(), collectionMethod: "official_bulk", sourceAsOf: asOf, assessmentYears: years, catalogTotal: catalog.length, located: catalog.filter((c) => c.pnu).length, buildingReady: 0, pricesReady: 0, rangeCollected: 0, priceRowsAdded: 0, preservedNewerObservations: 0, projects: [] };
async function rows(endpoint, pnu) {
  const kind = kinds[endpoint], m = manifests[kind];
  if (!m.targetParcels.includes(pnu)) throw Error("bulk_scope_missing");
  const count = m.parcels[pnu] || 0;
  if (!count) return [];
  const data = fs.readFileSync(path.join(input, kind + "-by-parcel", pnu + ".jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(data.length, count);
  return data;
}
fs.mkdirSync(output, { recursive: true });
for (const candidate of catalog) {
  const row = { id: candidate.id, name: candidate.name };
  if (!candidate.pnu) {
    audit.projects.push({ ...row, building: "address_review", prices: "address_review" });
    continue;
  }
  const c = { ...candidate, names: [...candidate.names, ...candidate.id >= 374 && candidate.id <= 387 ? ["\uBAA9\uB3D9\uC2E0\uC2DC\uAC00\uC9C0\uC544\uD30C\uD2B8"] : []] }, file = path.join(output, c.id + ".json");
  let old = {};
  try {
    old = JSON.parse(fs.readFileSync(file, "utf8"));
    if (old.pnu !== c.pnu) old = {};
  } catch {
  }
  const result = { version: 1, id: c.id, pnu: c.pnu, registerParcels: old.registerParcels || [c.pnu], building: old.building, prices: old.prices };
  const expected = (c.registerCandidates || []).reduce((n, p) => n + (p.identity?.residentialBuildings || 0), 0);
  const reusable = result.building?.status === "ready" && (result.building.buildings?.length || 0) >= expected && registerCandidates(c, result).every((p) => result.registerParcels.includes(p.pnu));
  if (!reusable) {
    try {
      Object.assign(result, await collectBuildingParcels(c, result, rows));
      result.building.source = { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uAC74\uCD95HUB \xB7 \uAC74\uCD95\uBB3C\uB300\uC7A5", url: source.url };
      result.building.bulkSourceAsOf = asOf;
    } catch (error) {
      result.building = { ...old.building, status: "needs_review", source: { name: "\uAD6D\uD1A0\uAD50\uD1B5\uBD80 \uAC74\uCD95HUB \xB7 \uAC74\uCD95\uBB3C\uB300\uC7A5", url: source.url }, bulkReviewReason: error.message, observedBuildings: error.observedBuildings };
      if (result.prices?.status === "ready") result.prices = { ...result.prices, status: "needs_review" };
    }
  }
  if (result.building?.status === "ready") {
    try {
      let raw = [];
      for (const pnu of result.registerParcels) raw = raw.concat(await rows("getBrHsprcInfo", pnu));
      const incoming = registerPriceProfile(result.building, raw, selection);
      const merged = mergeBulkPrices(old, result.building, incoming, asOf);
      if (incoming.status === "ready") result.prices = { ...merged.profile, source, sources: [...new Map([old.prices?.source, source].filter(Boolean).map((s) => [s.url, s])).values()], collectionVersion: 2, collectedYear: selection, bulkImport: { sourceAsOf: asOf, sha256: manifests.prices.sha256, checkedAt: audit.checkedAt } };
      else if (result.prices?.status !== "ready") result.prices = { ...incoming, source };
      row.added = merged.added;
      row.preservedNewerObservations = merged.preserved.length;
      audit.priceRowsAdded += merged.added;
      audit.preservedNewerObservations += merged.preserved.length;
    } catch (error) {
      row.priceReviewReason = error.message;
      if (result.prices?.status !== "ready") result.prices = { status: "needs_review", source };
    }
  }
  result.prices ??= { status: "needs_review", source };
  row.building = result.building.status;
  row.prices = result.prices.status;
  row.collectedYear = result.prices.collectedYear;
  row.years = result.prices.years || [];
  row.buildingReviewReason = result.building.bulkReviewReason;
  if (row.building === "ready") audit.buildingReady++;
  if (row.prices === "ready") {
    audit.pricesReady++;
    if (row.collectedYear === selection) audit.rangeCollected++;
    const homes = Object.values(result.building.records).filter(expectsHousingPrice), records = result.prices.records || {};
    row.units = Object.keys(records).length;
    row.unitsByYear = Object.fromEntries(years.map((y) => [y, Object.values(records).filter((r) => r.rows.some((p) => p.year === y)).length]));
    row.expectedHousingUnits = homes.length;
    row.housingUnitsWithAllFiveYears = homes.filter((h) => years.every((y) => records[h.dong + "|" + h.ho]?.rows.some((r) => r.year === y))).length;
    row.missingHousingUnitsByYear = Object.fromEntries(years.map((y) => [y, homes.filter((h) => !records[h.dong + "|" + h.ho]?.rows.some((r) => r.year === y)).length]));
    for (const [key, record] of Object.entries(records)) {
      assert.ok(result.building.records[key]?.registerId);
      for (const p of record.rows) assert.ok(Number.isFinite(p.price) && p.price > 0 && p.date.startsWith(p.year));
    }
  }
  fs.writeFileSync(file, JSON.stringify(result));
  audit.projects.push(row);
  console.log(JSON.stringify({ id: c.id, building: row.building, prices: row.prices, years: row.years, added: row.added, review: row.priceReviewReason }));
}
audit.status = "processed_all_candidates";
audit.pending = [];
fs.writeFileSync(path.join(output, "bulk-import.json"), JSON.stringify(audit, null, 2) + "\n");
fs.writeFileSync(path.join(output, "index.json"), JSON.stringify({ ...audit, projects: void 0, results: audit.projects, requested: audit.located, processed: audit.located, unlocated: catalog.filter((c) => !c.pnu).map((c) => c.id), requests: { attempts: 0, networkErrors: 0, http: {} } }) + "\n");
var { projects, ...counts } = audit;
console.log(JSON.stringify(counts));
