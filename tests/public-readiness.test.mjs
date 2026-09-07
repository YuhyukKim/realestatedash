import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let server, config, route, runtime, dbHelpers;
const originalToken = process.env.DATA_REFRESH_TOKEN;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/public-tests", optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  config = await server.ssrLoadModule("/app/site-config.ts");
  route = await server.ssrLoadModule("/app/api/complexes/route.ts");
  runtime = await server.ssrLoadModule("/db/runtime.ts");
  dbHelpers = await server.ssrLoadModule("/db/complexes.ts");
});
after(async () => {
  runtime.setRuntimeD1(undefined);
  if (originalToken === undefined) delete process.env.DATA_REFRESH_TOKEN;
  else process.env.DATA_REFRESH_TOKEN = originalToken;
  await server?.close();
});

test("the default month follows Korea time across month and year boundaries", () => {
  assert.equal(config.seoulMonth(new Date("2026-08-31T14:59:59Z")), "2026-08");
  assert.equal(config.seoulMonth(new Date("2026-08-31T15:00:00Z")), "2026-09");
  assert.equal(config.seoulMonth(new Date("2026-12-31T15:00:00Z")), "2027-01");
});

test("only an explicitly configured clean HTTPS origin becomes a canonical URL", () => {
  for (const value of [undefined, "", "javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?secret=x", "https://example.com/#x"]) {
    assert.equal(config.siteOrigin(value), null);
  }
  assert.equal(config.siteOrigin("https://example.com/"), "https://example.com");
});

test("public catalogue GET is read-only even while DB seeding is incomplete", async () => {
  const statements = [];
  runtime.setRuntimeD1({ prepare(sql) {
    statements.push(sql);
    assert.match(sql, /^SELECT /);
    return { bind() { return this; }, async all() { return { results: [] }; } };
  }});
  try {
    const response = await route.GET(new Request("https://example.com/api/complexes?limit=20000"));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.ok(payload.complexes.length > 9000);
    assert.equal(payload.seedProgress.complete, false);
    assert.equal(payload.seedProgress.inserted, 0);
    assert.equal(statements.length, 1);
    assert.match(response.headers.get("cache-control"), /s-maxage=300/);
  } finally { runtime.setRuntimeD1(undefined); }
});

test("read-only seed completeness detects missing and stale members", async () => {
  const d1 = { prepare() { return { bind() { return this; }, async all() {
    return { results: [{ complex_id: "one" }, { complex_id: "stale" }] };
  } }; } };
  const progress = await dbHelpers.readComplexSeedProgress(d1, [
    { id: "one", name: "하나", district: "마포구" },
    { id: "two", name: "둘", district: "마포구" },
  ], "version");
  assert.equal(progress.seeded, 1);
  assert.equal(progress.stale, 1);
  assert.equal(progress.remaining, 1);
  assert.equal(progress.exact, false);
});

test("public seed URLs cannot write; operator endpoint fails closed without credentials", async () => {
  const url = "https://example.com/api/complexes?seedOnly=1&seedBatch=100";
  assert.equal((await route.GET(new Request(url))).status, 405);
  delete process.env.DATA_REFRESH_TOKEN;
  assert.equal((await route.POST(new Request(url, { method: "POST" }))).status, 503);
  process.env.DATA_REFRESH_TOKEN = "test-only-operator-token-0000000000000000";
  assert.equal((await route.POST(new Request(url, { method: "POST" }))).status, 401);
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: { authorization: "Bearer wrong" } }))).status, 401);
  // Valid auth reaches the DB availability check, not a public bypass.
  assert.equal((await route.POST(new Request(url, { method: "POST", headers: {
    authorization: "Bearer " + process.env.DATA_REFRESH_TOKEN,
  } }))).status, 503);
});

test("public browsing is stored-first, scoped refresh is explicit, and unknown is not zero", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const seed = await readFile(new URL("../db/seed.ts", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /refreshLive = false/);
  assert.match(page, /if \(!refreshLive\) return/);
  assert.match(page, /district=\$\{encodeURIComponent\(selectedDistrict\)\}/);
  assert.match(page, /lazy\(\(\) => import\("\.\/complex-detail"\)\)/);
  assert.match(page, /useDeferredValue\(search\)/);
  assert.match(page, /선택월 거래 미조회/);
  assert.match(page, /가격 미확인/);
  assert.doesNotMatch(page, /JAYDEN RESEARCH/);
  assert.doesNotMatch(seed, /sampleTrades|sampleFallback/);
  assert.doesNotMatch(layout, /x-forwarded-host|requestHeaders\.get/);
});

test("clearing the month or choosing an unavailable future month cannot relabel old results", () => {
  const now = new Date("2026-09-07T03:00:00Z");
  for (const value of ["", "2026-13", "2026-10", "2005-12", "2026-9"]) assert.equal(config.isSelectableMonth(value, now), false);
  assert.equal(config.isSelectableMonth("2026-09", now), true);
  assert.equal(config.isSelectableMonth("2006-01", now), true);
});
