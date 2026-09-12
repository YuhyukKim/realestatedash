import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server, filters, transit, notice;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/transit-filter-tests",
    optimizeDeps: { noDiscovery: true }, esbuild: { jsx: "automatic", jsxImportSource: "react" },
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  filters = await server.ssrLoadModule("/app/apartment-filter.ts");
  transit = await server.ssrLoadModule("/app/stations.ts");
  notice = await server.ssrLoadModule("/app/transit-coverage.tsx");
});
after(async () => { await server?.close(); });

const none = { stationKeys: [], maxStationMeters: Infinity, workplaces: [] };
const station = (key, lines, distanceMeters) => ({ key, name: key, lines, distanceMeters, walkMinutes: 3 });
const candidate = (id, overrides = {}) => ({
  key: id,
  record: {
    id, name: "공덕 후보", district: "마포구", dong: "아현동", address: "서울특별시 마포구 아현동",
    buildYear: 2015, households: 100, buildingCount: 1, parking: 100, areas: [84.9],
    latestSale: { price: 12, date: "2026-07-10" }, latestJeonse: null,
    areaSales: [{ area: 84.9, price: 12, date: "2026-07-10" }], source: "test", ...overrides,
  },
  periodTrades: [{ area: 59.9 }, { area: 84.9 }],
});
const base = { district: "서울 전체", area: null, price: undefined, moveInYear: null, keyword: "" };

test("transit distinguishes unknown coordinates from a measured mismatch, without hiding default results", () => {
  assert.deepEqual(filters.evaluateTransit(false, [], none), { status: "matched", station: null });
  assert.equal(filters.evaluateTransit(false, [], { ...none, maxStationMeters: 200 }).status, "unverified");
  assert.equal(filters.evaluateTransit(false, [], { ...none, stationKeys: ["a"], workplaces: ["yeouido"] }).status, "unverified");
  assert.equal(filters.evaluateTransit(true, [], { ...none, workplaces: ["yeouido"] }).status, "mismatch");
  assert.equal(filters.evaluateTransit(true, [], none).status, "matched");
  assert.equal(filters.transitFilterActive(none), false);
  for (const extra of [{ stationKeys: ["a"] }, { maxStationMeters: 200 }, { workplaces: ["yeouido"] }]) {
    assert.equal(filters.transitFilterActive({ ...none, ...extra }), true);
  }
});

test("station OR, workplace AND and unrounded distance boundaries retain their original semantics", () => {
  const nearby = [station("a", "5호선", 200.01), station("b", "2호선", 199.99)];
  assert.equal(filters.evaluateTransit(true, nearby, { ...none, stationKeys: ["a"], maxStationMeters: 200 }).status, "mismatch");
  const either = filters.evaluateTransit(true, nearby, { ...none, stationKeys: ["a", "b"], maxStationMeters: 200 });
  assert.equal(either.status, "matched"); assert.equal(either.station.key, "b");
  assert.equal(filters.evaluateTransit(true, nearby, { ...none, workplaces: ["yeouido", "gangnam"] }).status, "matched");
  assert.equal(filters.evaluateTransit(true, nearby, { ...none, workplaces: ["yeouido", "pangyo"] }).status, "mismatch");
  // Workplace access can use a different nearby station from the selected display station.
  assert.equal(filters.evaluateTransit(true, nearby, {
    stationKeys: ["b"], maxStationMeters: 200, workplaces: ["yeouido"],
  }).status, "matched");
});

test("missing-coordinate counts use all current non-transit conditions, never the Seoul-wide total", () => {
  const rows = [
    candidate("A10027906", { name: "공덕자이" }), candidate("missing:eligible"),
    candidate("missing:district", { district: "강남구" }),
    candidate("missing:keyword", { name: "다른 이름" }),
    candidate("missing:area", { areas: [59.9], areaSales: [{ area: 59.9, price: 12, date: "2026-07-10" }] }),
    candidate("missing:price", { areaSales: [{ area: 84.9, price: 20, date: "2026-07-10" }] }),
    candidate("missing:year", { buildYear: 1980 }),
  ];
  const candidates = filters.filterApartmentCandidates(rows, {
    district: "마포구", area: { min: 60, max: 85 }, price: { min: 11, max: 16 },
    moveInYear: { min: 2011, max: 2021 }, keyword: " 공덕 ",
  });
  assert.deepEqual(candidates.map(row => row.key), ["A10027906", "missing:eligible"]);
  assert.deepEqual(candidates[0].periodTrades.map(row => row.area), [84.9]);
  const aeogae = transit.getNearbyStations("A10027906").find(row => row.name === "애오개");
  assert.ok(aeogae);
  const result = filters.filterByTransit(candidates, {
    stationKeys: [aeogae.key], maxStationMeters: 200, workplaces: ["yeouido"],
  });
  assert.deepEqual(result.coverage, {
    active: true, candidateCount: 2, coordinateCount: 1, missingCoordinateCount: 1,
    matchedCount: 1, unverifiedCount: 1, mismatchCount: 0,
  });
  assert.deepEqual(result.matched.map(row => row.key), ["A10027906"]);
  assert.equal(result.matched[0].station.key, aeogae.key);
  assert.deepEqual(result.unverified.map(row => row.key), ["missing:eligible"]);
});

test("unknown construction year and no-price selections keep their previous meaning", () => {
  const rows = [candidate("unknown", { buildYear: null, latestSale: null, areaSales: [] }), candidate("known")];
  assert.deepEqual(filters.filterApartmentCandidates(rows, { ...base, moveInYear: "unknown" }).map(row => row.key), ["unknown"]);
  assert.equal(filters.filterApartmentCandidates(rows, base).length, 2);
  assert.deepEqual(filters.filterApartmentCandidates(rows, { ...base, price: { min: 11, max: 16 } }).map(row => row.key), ["known"]);
});

test("partition totals remain disjoint, and disabling filters restores unverified apartments", () => {
  const rows = [candidate("A10027906"), candidate("missing:one"), candidate("missing:two")];
  for (const options of [none, { ...none, stationKeys: ["nonexistent"] },
    { ...none, workplaces: ["yeouido"] }, { ...none, stationKeys: ["nonexistent"], workplaces: ["yeouido", "gangnam"] }]) {
    const result = filters.filterByTransit(rows, options);
    const c = result.coverage;
    assert.equal(c.candidateCount, c.matchedCount + c.unverifiedCount + c.mismatchCount);
    assert.equal(c.candidateCount, c.coordinateCount + c.missingCoordinateCount);
    assert.equal(new Set(result.unverified.map(row => row.key)).size, result.unverified.length);
  }
  const excluded = filters.filterByTransit(rows, { ...none, stationKeys: ["nonexistent"] });
  assert.equal(excluded.coverage.mismatchCount, 1);
  assert.equal(excluded.coverage.unverifiedCount, 2);
  const restored = filters.filterByTransit(rows, none);
  assert.equal(restored.matched.length, 3);
  assert.equal(restored.unverified.length, 0);
  assert.equal(restored.coverage.missingCoordinateCount, 2);
  assert.equal(restored.matched.find(row => row.key === "missing:one").station, null);
});

test("no candidates and invalid coordinate keys cannot create fake counts or positions", () => {
  const result = filters.filterByTransit([], { ...none, workplaces: ["yeouido"] });
  assert.deepEqual(result.coverage, {
    active: true, candidateCount: 0, coordinateCount: 0, missingCoordinateCount: 0,
    matchedCount: 0, unverifiedCount: 0, mismatchCount: 0,
  });
  assert.equal(transit.getComplexCoordinates("__proto__"), null);
  assert.equal(transit.getComplexCoordinates("constructor"), null);
  assert.equal(transit.getComplexCoordinates("missing"), null);
  assert.match(transit.stationAvailabilityMessage("missing"), /단지 좌표 미확인/);
  assert.match(transit.stationAvailabilityMessage("A10027906"), /인근 등록 역 정보 있음/);
});

function renderNotice(result) {
  return renderToStaticMarkup(createElement(notice.TransitCoverageNotice, {
    coverage: result.coverage, unverified: result.unverified.map(row => row.record), onSelect: () => {},
  }));
}

test("actual coverage component separates unverifiable apartments and bounds its initial list", () => {
  const rows = Array.from({ length: 25 }, (_, i) => candidate("missing:" + i, { name: "미확인 단지 " + i }));
  const result = filters.filterByTransit(rows, { ...none, maxStationMeters: 200 });
  const html = renderNotice(result);
  assert.match(html, /좌표 미확인으로 결과에서 제외 25개/);
  assert.match(html, /교통조건 확인 필요 · 25개 단지 보기/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.equal((html.match(/<li>/g) ?? []).length, 20);
  assert.match(html, /확인 필요 단지 더 보기 · 5개/);
  assert.match(html, /교통조건 미확인 단지 상세 보기/);
  assert.match(html, /가격 통계·엑셀에 포함되지 않습니다/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test("default coverage keeps unknown rows included and hides the exclusion-only disclosure", () => {
  const html = renderNotice(filters.filterByTransit([candidate("missing")], none));
  assert.match(html, /교통 조건을 적용하지 않아 좌표 미확인 단지도 결과에 포함/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /결과에서 제외/);
});

test("page wires scoped counts separately from matched results, statistics and exports", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/complex-detail.tsx", import.meta.url), "utf8");
  assert.match(page, /const searchPool = favoritesOnly/);
  assert.match(page, /mergedComplexes\.filter\(complex => favoriteSet\.has\(complex\.key\)\) : mergedComplexes/);
  assert.match(page, /const candidates = filterApartmentCandidates\(searchPool/);
  assert.match(page, /return filterByTransit\(candidates/);
  assert.match(page, /const filteredComplexes = transitResults\.matched/);
  assert.match(page, /coverage=\{transitResults\.coverage\}/);
  assert.match(page, /unverified=\{transitResults\.unverified\.map/);
  assert.match(page, /onSelect=\{setSelectedComplex\}/);
  assert.match(page, /const rows = complexes\.map/);
  assert.match(page, /확인된 좌표에서 교통 조건을 충족하는 단지가 없습니다/);
  assert.match(detail, /stationAvailabilityMessage\(complex\.id\)/);
});
