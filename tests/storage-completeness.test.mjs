import assert from "node:assert/strict";
import test, { before, after, afterEach } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { database } from "./helpers/d1.mjs";

let server, legacy, store, runtime, admin;
const originalToken = process.env.DATA_REFRESH_TOKEN;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/completeness-tests", optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  legacy = await server.ssrLoadModule("/db/area-sales.ts");
  store = await server.ssrLoadModule("/db/trade-store.ts");
  runtime = await server.ssrLoadModule("/db/runtime.ts");
  admin = await server.ssrLoadModule("/app/api/admin/trade-import/route.ts");
});
afterEach(() => { runtime.setRuntimeD1(undefined); });
after(async () => {
  if (originalToken === undefined) delete process.env.DATA_REFRESH_TOKEN;
  else process.env.DATA_REFRESH_TOKEN = originalToken;
  await server?.close();
});
const scope = { district: "마포구", month: "202607", kind: "sale" };
const masters = [
  { id: "one", name: "첫째단지", district: "마포구", dong: "아현동", buildYear: 2014 },
  { id: "two", name: "둘째단지", district: "마포구", dong: "아현동", buildYear: 2014 },
];
const trade = (apartment = "첫째단지", price = 12) => ({
  id: apartment, apartment, district: "마포구", dong: "아현동", jibun: null, aptSeq: null,
  buildYear: 2014, date: "2026-07-10", area: 59.9, price, floor: 5,
});
function seedParent(db, id, name) {
  db.prepare("INSERT INTO apartment_complexes(id,name,normalized_name,district) VALUES (?,?,?,'마포구')").run(id, name, name);
}
const observation = (overrides = {}) => ({
  apartment: "마포래미안푸르지오2단지", dong: "아현동", jibun: null, aptSeq: null, buildYear: 2014,
  date: "2026-07-10", type: "sale", priceManwon: 100001, monthlyRent: 0, area: 84.9, floor: 10, ...overrides,
});
async function start(d1, expectedCount, fetchedAt = "2026-08-01T00:00:00.000Z") {
  const id = randomUUID();
  await store.startImport(d1, { id, ...scope, expectedCount, fetchedAt });
  return id;
}

test("legacy missing-parent writes fail atomically instead of silently losing matched apartments", async () => {
  const { db, d1 } = database();
  try {
    seedParent(db, "one", "첫째단지");
    await legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", [trade()]);
    await assert.rejects(legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", [trade("첫째단지", 13), trade("둘째단지", 20)]), /FOREIGN KEY/i);
    assert.equal((await legacy.readAreaSales(d1, "202607")).one[0].price, 12);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM complex_area_monthly_sales").get().n, 1);
    seedParent(db, "two", "둘째단지");
    await legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", [trade("첫째단지", 13), trade("둘째단지", 20)]);
    const stored = await legacy.readAreaSales(d1, "202607");
    assert.equal(stored.one[0].price, 13);
    assert.equal(stored.two[0].price, 20);
  } finally { db.close(); }
});

test("legacy unmatched, wrong-scope and malformed input cannot erase an existing snapshot", async () => {
  const { db, d1 } = database();
  try {
    seedParent(db, "one", "첫째단지");
    await legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", [trade()]);
    for (const row of [trade("알수없는단지"), { ...trade(), district: "강남구" },
      { ...trade(), date: "2026-06-10" }, { ...trade(), date: "2026-07-99" },
      { ...trade(), area: 0 }, { ...trade(), price: NaN }]) {
      await assert.rejects(legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", [row]));
      assert.equal((await legacy.readAreaSales(d1, "202607")).one[0].price, 12);
    }
    // Explicit complete empty feed remains a legitimate cancellation refresh.
    await legacy.replaceDistrictMonthSales(d1, masters, "마포구", "202607", []);
    assert.deepEqual(await legacy.readAreaSales(d1, "202607"), {});
  } finally { db.close(); }
});

test("durable accounting covers every chunk, unmatched rows and retries independently of master seeding", async () => {
  const { db, d1 } = database();
  try {
    const id = await start(d1, 201);
    const matched = Array.from({ length: 200 }, () => observation());
    const unmatched = observation({ apartment: "미연결관측단지", dong: "미확인동" });
    await store.appendImport(d1, id, 0, matched);
    let report = await store.readImportReport(d1, id);
    assert.deepEqual([report.expectedCount, report.storedCount, report.matchedCount, report.unmatchedCount, report.missingCount], [201, 200, 200, 0, 1]);
    assert.equal(report.storageComplete, false);
    assert.equal(report.committed, false);
    assert.equal(report.published, false);
    await assert.rejects(store.commitImport(d1, id));
    await store.appendImport(d1, id, 200, [unmatched]);
    assert.equal((await store.appendImport(d1, id, 200, [unmatched])).unmatched, 1);
    const result = await store.commitImport(d1, id);
    report = result.report;
    assert.deepEqual([report.expectedCount, report.storedCount, report.matchedCount, report.unmatchedCount, report.missingCount], [201, 201, 200, 1, 0]);
    assert.equal(report.storageComplete, true);
    assert.equal(report.published, true);
    assert.equal(result.recordCount, 201);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apartment_complexes").get().n, 0);
    seedParent(db, "A12175203", "마포래미안푸르지오");
    assert.deepEqual(await store.readImportReport(d1, id), report);
    assert.equal((await store.readStoredTrades(d1, "202607")).trades.length, 201);
    assert.equal((await store.readStoredDetail(d1, "A12175203", "마포구", "202607", "202607")).transactions.length, 200);
    // A price summary is deliberately aggregated, not 200 separate observations.
    assert.equal((await store.readStoredAreaSales(d1, "202607")).A12175203.length, 1);
  } finally { db.close(); }
});

test("zero-row accounting and superseded runs retain precise run-specific status", async () => {
  const { db, d1 } = database();
  try {
    const old = await start(d1, 0);
    const zero = (await store.commitImport(d1, old)).report;
    assert.deepEqual([zero.expectedCount, zero.storedCount, zero.matchedCount, zero.unmatchedCount, zero.missingCount], [0, 0, 0, 0, 0]);
    assert.equal(zero.storageComplete, true);
    const newer = await start(d1, 0, "2026-08-02T00:00:00.000Z");
    await store.commitImport(d1, newer);
    const report = await store.readImportReport(d1, old);
    assert.equal(report.storageComplete, true);
    assert.equal(report.committed, true);
    assert.equal(report.published, false);
    assert.equal(report.fetchedAt, "2026-08-01T00:00:00.000Z");
  } finally { db.close(); }
});

test("status action requires auth and only reads stored counters, never exposing payloads", async () => {
  const { db, d1, statements } = database();
  try {
    const id = await start(d1, 2);
    await store.appendImport(d1, id, 0, [observation()]);
    runtime.setRuntimeD1(d1);
    process.env.DATA_REFRESH_TOKEN = "test-status-token-at-least-thirty-two-characters";
    const request = token => new Request("https://example.test/api/admin/trade-import", { method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: JSON.stringify({ action: "status", id }) });
    statements.length = 0;
    assert.equal((await admin.POST(request())).status, 401);
    assert.equal(statements.length, 0);
    const response = await admin.POST(request(process.env.DATA_REFRESH_TOKEN));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const report = await response.json();
    assert.equal(report.missingCount, 1);
    assert.equal(report.storageComplete, false);
    assert.equal(report.published, false);
    assert.ok(statements.every(sql => /^\s*SELECT/.test(sql)));
    assert.ok(!JSON.stringify(report).includes("마포래미안푸르지오"));
    assert.ok(!Object.hasOwn(report, "payload"));
    await assert.rejects(store.readImportReport(d1, randomUUID()), error => error.status === 404);
  } finally { db.close(); }
});

test("same-count but invalid ordinals cannot satisfy publication completeness", async () => {
  const { db, d1 } = database();
  try {
    const id = await start(d1, 1);
    await store.appendImport(d1, id, 0, [observation()]);
    db.prepare("UPDATE trade_import_rows SET ordinal=1 WHERE run_id=?").run(id);
    assert.equal((await store.readImportReport(d1, id)).storageComplete, false);
    await assert.rejects(store.commitImport(d1, id));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_snapshot_heads").get().n, 0);
  } finally { db.close(); }
});
