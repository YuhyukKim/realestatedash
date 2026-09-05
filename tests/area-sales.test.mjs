import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

let server, applyAreaPriceFilter, latestSalesByArea, replaceDistrictMonthSales, readAreaSales;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/area-tests", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  ({ applyAreaPriceFilter, latestSalesByArea } = await server.ssrLoadModule("/app/area-sales.ts"));
  ({ replaceDistrictMonthSales, readAreaSales } = await server.ssrLoadModule("/db/area-sales.ts"));
});
after(async () => { await server?.close(); });

const record = {
  id: "test", name: "테스트", district: "마포구", dong: "아현동",
  address: "", buildYear: 2014, households: null, buildingCount: null, parking: null,
  latestSale: { price: 20, date: "2026-07-20" }, latestJeonse: null, source: "test", areas: [59, 84],
  areaSales: [{ area: 59, price: 12, date: "2026-06-10" }, { area: 84, price: 20, date: "2026-07-20" }],
};

test("59㎡ and 11–15억 match the same trade and display its price even without a current-month sale", () => {
  const filtered = applyAreaPriceFilter(record, { min: 0, max: 60 }, { min: 11, max: 16 });
  assert.ok(filtered);
  assert.equal(filtered.latestSale.price, 12);
  assert.deepEqual(filtered.areas, [59]);
  assert.equal(applyAreaPriceFilter(record, { min: 60, max: 85 }, { min: 11, max: 16 }), null);
});

test("unknown prices stay unknown and newer observations supersede older ones in the same area", () => {
  const unknown = { ...record, areaSales: [], latestSale: null };
  assert.ok(applyAreaPriceFilter(unknown, null));
  assert.equal(applyAreaPriceFilter(unknown, { min: 0, max: 60 }, { min: 11, max: 16 }), null);
  assert.equal(applyAreaPriceFilter({ ...record, areaSales: [] }, { min: 0, max: 60 }, { min: 16, max: 21 }), null);
  const updated = latestSalesByArea([...record.areaSales, { area: 59, price: 17, date: "2026-07-21" }]);
  assert.equal(applyAreaPriceFilter({ ...record, areaSales: updated }, { min: 0, max: 60 }, { min: 11, max: 16 }), null);
});

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("CREATE TABLE apartment_complexes (id TEXT PRIMARY KEY)");
  db.exec("INSERT INTO apartment_complexes VALUES ('test')");
  db.exec("CREATE TABLE complex_area_monthly_sales (complex_id TEXT NOT NULL REFERENCES apartment_complexes(id), district TEXT NOT NULL, month TEXT NOT NULL, area REAL NOT NULL, price_manwon INTEGER NOT NULL, contract_date TEXT NOT NULL, PRIMARY KEY(complex_id,area,month))");
  const d1 = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() { return { results: db.prepare(sql).all(...this.values) }; } };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { for (const statement of statements) db.prepare(statement.sql).run(...statement.values); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, d1 };
}
const trade = (date, area, price) => ({ id: date + area, apartment: "테스트", district: "마포구", dong: "아현동", jibun: null, buildYear: 2014, date, area, price, floor: 5, aptSeq: null });

test("durable summaries survive month changes, replace canceled snapshots, and do not leak future prices", async () => {
  const { db, d1 } = database();
  try {
    await replaceDistrictMonthSales(d1, [record], "마포구", "202606", [trade("2026-06-10", 59, 12)]);
    await replaceDistrictMonthSales(d1, [record], "마포구", "202607", [trade("2026-07-10", 84, 20), trade("2026-07-20", 59, 17)]);
    assert.deepEqual(await readAreaSales(d1, "202606"), { test: [{ area: 59, price: 12, date: "2026-06-10" }] });
    assert.equal((await readAreaSales(d1, "202608")).test.find((sale) => sale.area === 59).price, 17);
    await replaceDistrictMonthSales(d1, [record], "마포구", "202607", [trade("2026-07-10", 84, 20)]);
    assert.equal((await readAreaSales(d1, "202608")).test.find((sale) => sale.area === 59).price, 12);
    await replaceDistrictMonthSales(d1, [record], "마포구", "202607", []);
    assert.equal((await readAreaSales(d1, "202608")).test.length, 1);
    await replaceDistrictMonthSales(d1, [record], "마포구", "202606", [trade("2026-06-10", 59, 12)]);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM complex_area_monthly_sales").get().count, 1);
  } finally { db.close(); }
});

test("failed snapshot batches preserve the previous data atomically", async () => {
  const { db, d1 } = database();
  try {
    await replaceDistrictMonthSales(d1, [record], "마포구", "202606", [trade("2026-06-10", 59, 12)]);
    const prepare = d1.prepare;
    d1.prepare = (sql) => prepare(sql.startsWith("INSERT INTO complex_area_monthly_sales") ? "INSERT INTO missing_table VALUES (?,?,?)" : sql);
    await assert.rejects(replaceDistrictMonthSales(d1, [record], "마포구", "202606", []));
    assert.equal((await readAreaSales(d1, "202607")).test[0].price, 12);
  } finally { db.close(); }
});
