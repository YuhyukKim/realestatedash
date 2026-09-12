import assert from "node:assert/strict";
import test, { before, after, afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { database } from "./helpers/d1.mjs";
import { assertReviewedComplexIdentities, canonicalComplexRecords, canonicalComplexId,
  complexIdentityIds, RETIRED_COMPLEX_IDS } from "../lib/complex-identity.mjs";

const CANONICAL = "A13613001", ALIAS = "A10022464";
let server, seed, catalog, matcher, transit, filter, store, legacy, detail, runtime, raw, pair;
const originalFetch = globalThis.fetch;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/identity-tests",
    optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  [seed, catalog, matcher, transit, filter, store, legacy, detail, runtime] = await Promise.all([
    "/db/seed.ts", "/db/complexes.ts", "/app/master-trade-matcher.ts", "/app/stations.ts",
    "/app/apartment-filter.ts", "/db/trade-store.ts", "/db/area-sales.ts",
    "/app/api/complex/route.ts", "/db/runtime.ts",
  ].map(path => server.ssrLoadModule(path)));
  const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  raw = [
    ...(await read("../db/generated-complexes.json")).filter(row => !["다세대", "연립주택"].includes(row.complexType)),
    ...await read("../db/generated-reb-complexes.json"),
  ];
  pair = raw.filter(row => [CANONICAL, ALIAS].includes(row.id));
});
afterEach(() => { globalThis.fetch = originalFetch; runtime.setRuntimeD1(undefined); });
after(async () => { await server?.close(); });
const all = { limit: 20000, offset: 0 };
const trade = (changes = {}) => ({ apartment: "하월곡아남아파트", district: "성북구", dong: "하월곡동",
  jibun: "218", buildYear: 1996, ...changes });

test("reviewed duplicate is one canonical member; source, metadata and unrelated records are untouched", () => {
  assert.equal(raw.length, 9547);
  assert.equal(pair.length, 2);
  assert.deepEqual(seed.COMPLEX_CATALOG_COVERAGE, { sourceRecords: 9547, canonicalComplexes: 9546, reviewedDuplicateRecords: 1 });
  const canonical = seed.getComplexSeed();
  assert.equal(canonical.length, 9546);
  assert.deepEqual(raw.filter(row => !canonical.some(item => item.id === row.id)).map(row => row.id), [ALIAS]);
  assert.deepEqual(canonical.find(row => row.id === CANONICAL), pair.find(row => row.id === CANONICAL));
  assert.equal(canonical.find(row => row.id === CANONICAL).households, 198);
  assert.equal(canonical.find(row => row.id === CANONICAL).parking, 151);
  assert.match(seed.COMPLEX_SEED_VERSION, /identity-20260912-v1/);
  assertReviewedComplexIdentities(raw);
});

test("changed identity evidence fails closed; a missing canonical does not silently drop an alias", () => {
  for (const change of [{ jibunAddress: "서울특별시 성북구 하월곡동 218-1" }, { households: 199 },
    { approvalDate: "1997-12-03" }, { buildYear: 1997 }, { buildings: 2 }, { district: "중구" }]) {
    assert.throws(() => assertReviewedComplexIdentities(raw.map(row => row.id === ALIAS ? { ...row, ...change } : row)), /evidence changed/);
  }
  assert.throws(() => assertReviewedComplexIdentities(raw.filter(row => row.id !== CANONICAL)), /evidence changed/);
  assert.deepEqual(canonicalComplexRecords(pair.filter(row => row.id === ALIAS)).map(row => row.id), [ALIAS]);
  assert.equal(canonicalComplexId("__proto__"), "__proto__");
  assert.equal(canonicalComplexId("constructor"), "constructor");
  const ids = complexIdentityIds(ALIAS); ids.pop();
  assert.deepEqual(complexIdentityIds(CANONICAL), [CANONICAL, ALIAS], "callers cannot mutate registry arrays");
});

test("same-name and same-year apartments at other legal lots are not auto-merged", () => {
  const ids = ["reb:11440112035024", "reb:11440120360265", "reb:11470120000088",
    "reb:11470100003229", "reb:11470100248915", "reb:11470100248917"];
  const candidates = raw.filter(row => ids.includes(row.id));
  assert.equal(candidates.length, 6);
  assert.deepEqual(canonicalComplexRecords(candidates), candidates);
  for (const id of ids) assert.ok(seed.getComplexSeed().some(row => row.id === id));
  const rawPair = [{ id: "different-1", name: "동명아파트", district: "성북구", dong: "하월곡동", buildYear: 1996, jibunAddress: "219" },
    { id: "different-2", name: "동명아파트", district: "성북구", dong: "하월곡동", buildYear: 1996, jibunAddress: "220" }];
  assert.equal(matcher.matchTradeToMaster(rawPair, trade({ apartment: "동명아파트", jibun: null })), null);
  assert.deepEqual(matcher.matchTradeToMaster(rawPair, trade({ apartment: "동명아파트", jibun: "220" })),
    { masterId: "different-2", reason: "jibun" });
});

test("reviewed raw aliases no longer make lot or normalized-name matching ambiguous", () => {
  const master = catalog.listComplexesFromSeed(pair, all).complexes;
  for (const apartment of ["하월곡아남", "하월곡아남아파트", "하월곡 아남 아파트"]) {
    assert.deepEqual(matcher.matchTradeToMaster(master, trade({ apartment })), { masterId: CANONICAL, reason: "jibun" });
    assert.deepEqual(matcher.matchTradeToMaster(master, trade({ apartment, jibun: null })),
      { masterId: CANONICAL, reason: "exact-name" });
  }
  const grouped = matcher.groupTradesByMaster(master, [trade(), trade({ jibun: null }), trade({ apartment: "미확인", jibun: "999" })]);
  assert.equal(grouped.matchedTradeCount, 2); assert.equal(grouped.unmatchedTradeCount, 1);
  assert.equal(grouped.tradesByMasterId.get(CANONICAL).length, 2);
  assert.equal(matcher.matchTradeToMaster(master, trade({ buildYear: 2020 })), null);
});

test("old names work in seed and UI search without a duplicate card or extra coordinates", async () => {
  const listed = catalog.listComplexesFromSeed(seed.getComplexSeed(), { ...all, query: "하월곡아남아파트" });
  assert.deepEqual(listed.complexes.map(row => row.id), [CANONICAL]);
  const candidates = listed.complexes.map(record => ({ record, periodTrades: [] }));
  assert.equal(filter.filterApartmentCandidates(candidates, { district: "서울 전체", area: null, moveInYear: null, keyword: "하월곡아남아파트" }).length, 1);
  assert.deepEqual(transit.getComplexCoordinates(ALIAS), transit.getComplexCoordinates(CANONICAL));
  assert.deepEqual(transit.getNearbyStations(ALIAS), transit.getNearbyStations(CANONICAL));
  const snapshot = JSON.parse(await readFile(new URL("../app/transit-coordinates.json", import.meta.url), "utf8"));
  assert.equal(snapshot.complexes[ALIAS], undefined);
  assert.equal(snapshot.coverage.totalComplexes, 9547);
  assert.equal(transit.TRANSIT_COVERAGE.totalComplexes, 9546);
  assert.equal(transit.TRANSIT_COVERAGE.geocodedComplexes, 2727);
  assert.equal(transit.TRANSIT_COVERAGE.totalComplexes - transit.TRANSIT_COVERAGE.geocodedComplexes, 6819);
  assert.deepEqual(RETIRED_COMPLEX_IDS, [ALIAS]);
});

test("new D1 membership preserves old parents, memberships, prices and area union", async () => {
  const { db, d1, statements } = database();
  try {
    await catalog.seedComplexesIfEmpty(d1, pair.map(row => row.id === CANONICAL
      ? { ...row, areas: [59], latestSalePriceManwon: 80001, latestSaleDate: "2026-06-10",
          latestJeonsePriceManwon: 50001, latestJeonseDate: "2026-07-15" }
      : { ...row, areas: [59, 84.9], latestSalePriceManwon: 90001, latestSaleDate: "2026-07-10",
          latestJeonsePriceManwon: 40001, latestJeonseDate: "2026-06-15" }), "previous", 200);
    const progress = await catalog.seedComplexesIfEmpty(d1, canonicalComplexRecords(pair), seed.COMPLEX_SEED_VERSION, 200);
    assert.equal(progress.exact, true); assert.equal(progress.total, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apartment_complexes").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apartment_complex_seed_memberships WHERE seed_version='previous'").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM complex_price_summaries").get().n, 2);
    statements.length = 0;
    const result = await catalog.listComplexesFromD1(d1, { ...all, query: "하월곡아남아파트", hasTransactions: true }, seed.COMPLEX_SEED_VERSION);
    assert.equal(result.total, 1); assert.equal(result.complexes.length, 1);
    const row = result.complexes[0];
    assert.equal(row.id, CANONICAL); assert.equal(row.parking, 151); assert.equal(row.households, 198);
    assert.deepEqual(row.latestSale, { price: 9.0001, date: "2026-07-10" });
    assert.deepEqual(row.latestJeonse, { price: 5.0001, date: "2026-07-15" });
    assert.deepEqual(row.areas, [59, 84.9]);
    assert.equal((await catalog.listComplexesFromD1(d1, { ...all, hasTransactions: false }, seed.COMPLEX_SEED_VERSION)).total, 0);
    assert.equal((await catalog.listComplexesFromD1(d1, { ...all, query: "%' OR 1=1 --" }, seed.COMPLEX_SEED_VERSION)).total, 0);
    assert.equal((await catalog.listComplexesFromD1(d1, { ...all, limit: 1, offset: 1 }, seed.COMPLEX_SEED_VERSION)).complexes.length, 0);
    assert.ok(statements.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)), "listing is read-only");
  } finally { db.close(); }
});

test("price availability can come solely from an old alias and still obey filters", async () => {
  const { db, d1 } = database();
  try {
    await catalog.seedComplexesIfEmpty(d1, pair.map(row => row.id === ALIAS
      ? { ...row, latestSalePriceManwon: 123456, latestSaleDate: "2026-07-10" } : row), "old", 200);
    await catalog.seedComplexesIfEmpty(d1, canonicalComplexRecords(pair), seed.COMPLEX_SEED_VERSION, 200);
    const result = await catalog.listComplexesFromD1(d1, { ...all, hasTransactions: true }, seed.COMPLEX_SEED_VERSION);
    assert.equal(result.total, 1);
    assert.deepEqual(result.complexes[0].latestSale, { price: 12.3456, date: "2026-07-10" });
  } finally { db.close(); }
});

test("old and canonical area summaries combine by exact area, latest date and price without deletion", async () => {
  const { db, d1 } = database();
  try {
    await catalog.seedComplexesIfEmpty(d1, pair, "old", 200);
    const insert = db.prepare("INSERT INTO complex_area_monthly_sales (complex_id,district,month,area,price_manwon,contract_date) VALUES (?,'성북구',?,?,?,?)");
    insert.run(CANONICAL, "202606", 59, 80001, "2026-06-10");
    insert.run(ALIAS, "202607", 59, 90001, "2026-07-10");
    insert.run(ALIAS, "202607", 84.9, 110001, "2026-07-11");
    for (const read of [legacy.readAreaSales, store.readStoredAreaSales]) {
      assert.deepEqual(await read(d1, "202606"), { [CANONICAL]: [{ area: 59, price: 8.0001, date: "2026-06-10" }] });
      assert.deepEqual(await read(d1, "202607"), { [CANONICAL]: [
        { area: 59, price: 9.0001, date: "2026-07-10" }, { area: 84.9, price: 11.0001, date: "2026-07-11" },
      ] });
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM complex_area_monthly_sales").get().n, 3);
  } finally { db.close(); }
});

const observation = (changes = {}) => ({ ...trade(), aptSeq: null, date: "2026-07-10", type: "sale",
  priceManwon: 100001, monthlyRent: 0, area: 59, floor: 10, ...changes });
async function publish(d1, records, changes = {}) {
  const id = randomUUID();
  await store.startImport(d1, { id, district: "성북구", month: "202607", kind: "sale", expectedCount: records.length,
    fetchedAt: "2026-08-01T00:00:00.000Z", ...changes });
  if (records.length) await store.appendImport(d1, id, 0, records);
  await store.commitImport(d1, id);
  return id;
}

test("new snapshots match both names, retain unmatched originals and never collapse identical observations", async () => {
  const { db, d1 } = database();
  try {
    const records = [observation(), observation(), observation({ apartment: "하월곡아남", date: "2026-07-11" }),
      observation({ apartment: "알수없는단지", jibun: "999" })];
    const id = await publish(d1, records);
    const report = await store.readImportReport(d1, id);
    assert.equal(report.expectedCount, 4); assert.equal(report.storedCount, 4);
    assert.equal(report.matchedCount, 3); assert.equal(report.unmatchedCount, 1);
    assert.match(report.mappingVersion, /identity-20260912-v1:matcher-v2$/);
    assert.equal((await store.appendImport(d1, id, 0, records)).repeated, true);
    assert.equal((await store.readStoredDetail(d1, CANONICAL, "성북구", "202607", "202607")).transactions.length, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows WHERE complex_id IS NULL").get().n, 1);
    assert.equal((await store.readStoredTrades(d1, "202607", "성북구")).trades.length, 4);
  } finally { db.close(); }
});

test("old alias IDs open sale, jeonse and monthly history through the read-only detail API", async () => {
  const { db, d1, statements } = database();
  try {
    const sale = await publish(d1, [observation(), observation({ date: "2026-07-11", priceManwon: 110001 })]);
    const rent = await publish(d1, [observation({ type: "jeonse", priceManwon: 60001 }),
      observation({ type: "monthly", priceManwon: 20001, monthlyRent: 85 })], { kind: "rent" });
    // Simulate committed snapshots written under the former master IDs.
    db.prepare("UPDATE trade_import_rows SET complex_id=? WHERE run_id=? AND ordinal=0").run(ALIAS, sale);
    db.prepare("UPDATE trade_import_rows SET complex_id=? WHERE run_id=?").run(ALIAS, rent);
    db.prepare("UPDATE trade_import_prices SET complex_id=? WHERE run_id=?").run(ALIAS, sale);
    runtime.setRuntimeD1(d1);
    globalThis.fetch = async () => { throw new Error("Public reads must not collect data"); };
    statements.length = 0;
    let canonicalResponse;
    for (const id of [CANONICAL, ALIAS]) {
      const response = await detail.GET(new Request("https://example.test/api/complex?complexId=" + id + "&from=202607&to=202607"));
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.complex.apartment, "하월곡아남");
      assert.equal(payload.mode, "stored");
      assert.equal(payload.transactions.length, 4);
      assert.equal(payload.transactions.filter(row => row.type === "sale").length, 2);
      assert.equal(payload.transactions.find(row => row.type === "monthly").monthlyRent, 85);
      if (canonicalResponse) assert.deepEqual(payload, canonicalResponse);
      canonicalResponse = payload;
    }
    const named = await detail.GET(new Request("https://example.test/api/complex?district=성북구&dong=하월곡동&apartment=하월곡아남아파트&from=202607&to=202607"));
    assert.equal((await named.json()).transactions.length, 4);
    assert.deepEqual(await store.readStoredAreaSales(d1, "202607"), {
      [CANONICAL]: [{ area: 59, price: 11.0001, date: "2026-07-11" }],
    });
    assert.ok(statements.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)), "no public reparenting or rematching writes");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows").get().n, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows WHERE complex_id=?").get(ALIAS).n, 3);
  } finally { db.close(); }
});

test("formerly unmatched rows remain explicit until a complete fresh snapshot replaces them", async () => {
  const { db, d1 } = database();
  try {
    const old = await publish(d1, [observation()]);
    db.prepare("UPDATE trade_import_rows SET complex_id=NULL WHERE run_id=?").run(old);
    db.prepare("DELETE FROM trade_import_prices WHERE run_id=?").run(old);
    db.prepare("UPDATE trade_import_runs SET mapping_version='old-matcher' WHERE id=?").run(old);
    assert.equal((await store.readImportReport(d1, old)).unmatchedCount, 1);
    assert.equal((await store.readStoredDetail(d1, CANONICAL, "성북구", "202607", "202607")).transactions.length, 0);
    const fresh = await publish(d1, [observation()], { fetchedAt: "2026-08-02T00:00:00.000Z" });
    assert.equal((await store.readImportReport(d1, fresh)).matchedCount, 1);
    assert.equal((await store.readStoredDetail(d1, CANONICAL, "성북구", "202607", "202607")).transactions.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows WHERE run_id=?").get(old).n, 1, "old raw row still exists");
  } finally { db.close(); }
});
