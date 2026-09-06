import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "vite";

let server, client, tradesRoute, detailRoute, master;
const originalFetch = globalThis.fetch;
const originalKey = process.env.MOLIT_API_KEY;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/molit-tests", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  client = await server.ssrLoadModule("/app/molit-client.ts");
  tradesRoute = await server.ssrLoadModule("/app/api/trades/route.ts");
  detailRoute = await server.ssrLoadModule("/app/api/complex/route.ts");
  const { getComplexSeed } = await server.ssrLoadModule("/db/seed.ts");
  master = getComplexSeed().find((row) => row.id === "A12175203");
  assert.ok(master);
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.MOLIT_API_KEY;
  else process.env.MOLIT_API_KEY = originalKey;
  await server?.close();
});

const item = (extra = "", name = "마포래미안푸르지오2단지") =>
  `<item><aptNm>${name}</aptNm><umdNm>아현동</umdNm><buildYear>2014</buildYear><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>10</dealDay><dealAmount>100000</dealAmount><deposit>60000</deposit><monthlyRent>0</monthlyRent><excluUseAr>84.9</excluUseAr><floor>10</floor>${extra}</item>`;
const envelope = (items, total = items.length, page = 1) =>
  `<response><header><resultCode>000</resultCode></header><body><items>${items.join("")}</items><totalCount>${total}</totalCount><pageNo>${page}</pageNo></body></response>`;
const request = () => new Request("http://localhost/api/complex?complexId=A12175203&from=202607&to=202607");

test("never fabricates list or history prices without a key, even with a reference price", async () => {
  delete process.env.MOLIT_API_KEY;
  for (const [route, req, field] of [
    [tradesRoute, new Request("http://localhost/api/trades?month=202607"), "trades"],
    [detailRoute, new Request(request().url + "&basePrice=25&baseArea=84&referenceDate=2026-07-10"), "transactions"],
  ]) {
    const response = await route.GET(req);
    const payload = await response.json();
    assert.equal(payload.mode, "unavailable");
    assert.deepEqual(payload[field], []);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("403 responses return unavailable, never samples or synthetic history", async () => {
  process.env.MOLIT_API_KEY = "test";
  globalThis.fetch = async () => new Response("", { status: 403 });
  for (const [route, req, field] of [
    [tradesRoute, new Request("http://localhost/api/trades?month=202607"), "trades"],
    [detailRoute, request(), "transactions"],
  ]) {
    const payload = await (await route.GET(req)).json();
    assert.equal(payload.mode, "unavailable");
    assert.deepEqual(payload[field], []);
  }
});

test("canonical list and popup matching agree, across pages, and canceled sales are excluded", async () => {
  process.env.MOLIT_API_KEY = "test";
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("pageNo"));
    calls.push({ path: url.pathname, page });
    if (url.searchParams.get("LAWD_CD") !== "11440") return new Response(envelope([]));
    const rows = page === 1
      ? [item(), ...Array.from({ length: 999 }, () => item("", "다른단지"))]
      : [item(), item("<cdealType>O</cdealType><cdealDay>26.07.20</cdealDay>")];
    return new Response(envelope(rows, 1002, page));
  };
  const list = await (await tradesRoute.GET(new Request("http://localhost/api/trades?month=202607"))).json();
  const detail = await (await detailRoute.GET(request())).json();
  assert.equal(list.mode, "live");
  assert.equal(detail.mode, "live");
  assert.equal(list.trades.filter((row) => row.apartment === "마포래미안푸르지오2단지").length, 2);
  const { groupTradesByMaster } = await server.ssrLoadModule("/app/master-trade-matcher.ts");
  const { listComplexesFromSeed } = await server.ssrLoadModule("/db/complexes.ts");
  const { getComplexSeed } = await server.ssrLoadModule("/db/seed.ts");
  const masters = listComplexesFromSeed(getComplexSeed(), { limit: 20000, offset: 0 }).complexes;
  const grouped = groupTradesByMaster(masters, list.trades);
  assert.equal(grouped.tradesByMasterId.get(master.id).length, 2);
  const sales = detail.transactions.filter((row) => row.type === "sale");
  assert.equal(sales.length, 2);
  assert.equal(new Set(sales.map((row) => row.id)).size, 2);
  assert.equal(detail.transactions.filter((row) => row.type === "jeonse").length, 3);
  assert.ok(calls.some((call) => call.path.includes("AptRent") && call.page === 2));
  assert.ok(calls.some((call) => call.path.includes("AptTrade") && call.page === 2));
});

test("later-page failures discard that entire month/type but retain successful real data as partial", async () => {
  process.env.MOLIT_API_KEY = "test";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("pageNo"));
    if (url.pathname.includes("AptRent")) return new Response(envelope([item()]));
    if (page === 2) return new Response("", { status: 403 });
    return new Response(envelope([item()], 2));
  };
  const response = await detailRoute.GET(request());
  const payload = await response.json();
  assert.equal(payload.mode, "partial");
  assert.equal(payload.transactions.length, 1);
  assert.equal(payload.transactions[0].type, "jeonse");
  assert.match(payload.message, /2026-07 매매/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const list = await (await tradesRoute.GET(new Request("http://localhost/api/trades?month=202607"))).json();
  assert.equal(list.mode, "unavailable");
  assert.deepEqual(list.trades, []);
});

test("cancellation flags and Korean cancellation dates are recognized without excluding placeholders", () => {
  for (const xml of ["<cdealType>O</cdealType>", "<cdealType>Y</cdealType>", "<cdealDay>20260720</cdealDay>", "<해제사유발생일>2026.07.20</해제사유발생일>"]) {
    assert.equal(client.isCanceledSale(xml), true);
  }
  assert.equal(client.isCanceledSale("<cdealType>X</cdealType><cdealDay>-</cdealDay>"), false);
});

test("pagination rejects malformed responses, missing counts, early empty pages and changed totals", async () => {
  for (const responses of [
    ["<html>Denied</html>"],
    ["<resultCode>000</resultCode>"],
    [envelope([item()], 2), envelope([], 2, 2)],
    [envelope([item()], 2), envelope([item()], 3, 2)],
    [envelope([item()], 2), envelope([item()], 2, 1)],
  ]) {
    let index = 0;
    globalThis.fetch = async () => new Response(responses[index++]);
    await assert.rejects(client.fetchMolitXml("https://example.test/api", "11440", "202607", "test"));
  }
  globalThis.fetch = async () => new Response(envelope([]));
  assert.equal(await client.fetchMolitXml("https://example.test/api", "11440", "202607", "test"), "");
});

test("pre-2011 ranges do not request rent; malformed or excessive month ranges are rejected", async () => {
  process.env.MOLIT_API_KEY = "test";
  const calls = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); return new Response(envelope([])); };
  const historical = await detailRoute.GET(new Request("http://localhost/api/complex?complexId=A12175203&from=200601&to=200612"));
  assert.equal((await historical.json()).mode, "live");
  assert.equal(calls.length, 12);
  assert.ok(calls.every((url) => !url.includes("AptRent")));
  for (const range of ["from=000001&to=999912", "from=202613&to=202613", "from=202501&to=202601"]) {
    assert.equal((await detailRoute.GET(new Request("http://localhost/api/complex?complexId=A12175203&" + range))).status, 400);
  }
});

test("temporary transport failures retry once, but authentication errors never retry or leak the key", async () => {
  for (const failure of [
    () => { throw new DOMException("timed out", "TimeoutError"); },
    () => { throw new TypeError("fetch failed with credential"); },
    () => new Response("", { status: 503 }),
    () => new Response("", { status: 429 }),
  ]) {
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1 ? failure() : new Response(envelope([item()]));
    assert.match(await client.fetchMolitXml("https://example.test/api", "11440", "202607", "secret-test-key"), /<item>/);
    assert.equal(calls, 2);
  }
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 403 }); };
  await assert.rejects(client.fetchMolitXml("https://example.test/api", "11440", "202607", "secret-test-key"),
    (error) => error.message === "공공데이터 조회 실패 (403)");
  assert.equal(calls, 1);
  globalThis.fetch = async () => { throw new TypeError("https://example.test/?serviceKey=secret-test-key"); };
  await assert.rejects(client.fetchMolitXml("https://example.test/api", "11440", "202607", "secret-test-key"),
    (error) => !error.message.includes("secret-test-key") && /재시도 완료/.test(error.message));
});

test("one failing district preserves complete districts and caps simultaneous upstream requests", async () => {
  process.env.MOLIT_API_KEY = "test";
  let active = 0, peak = 0;
  globalThis.fetch = async (input) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    const district = new URL(String(input)).searchParams.get("LAWD_CD");
    return district === "11680" ? new Response("", { status: 403 })
      : new Response(envelope(district === "11440" ? [item()] : []));
  };
  const response = await tradesRoute.GET(new Request("http://localhost/api/trades?month=202607"));
  const payload = await response.json();
  assert.equal(payload.mode, "partial");
  assert.equal(payload.trades.length, 1);
  assert.equal(payload.completedDistricts.length, 24);
  assert.ok(payload.completedDistricts.includes("마포구"));
  assert.deepEqual(payload.failedDistricts, [{ district: "강남구", reason: "공공데이터 조회 실패 (403)" }]);
  assert.ok(peak <= 3);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("district-scoped requests only fetch that district and validate the district name", async () => {
  process.env.MOLIT_API_KEY = "test";
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(new URL(String(input)).searchParams.get("LAWD_CD"));
    return new Response(envelope([]));
  };
  const payload = await (await tradesRoute.GET(new Request("http://localhost/api/trades?month=202607&district=" + encodeURIComponent("마포구")))).json();
  assert.equal(payload.mode, "live");
  assert.deepEqual(payload.completedDistricts, ["마포구"]);
  assert.deepEqual(calls, ["11440"]);
  assert.equal((await tradesRoute.GET(new Request("http://localhost/api/trades?district=invalid"))).status, 400);
});

test("parent cancellation stops upstream work without retries", async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); throw new DOMException("aborted", "AbortError"); };
  await assert.rejects(client.fetchMolitXml("https://example.test/api", "11440", "202607", "test", controller.signal));
  assert.equal(calls, 1);
  calls = 0;
  process.env.MOLIT_API_KEY = "test";
  const payload = await (await tradesRoute.GET(new Request("http://localhost/api/trades?month=202607", { signal: controller.signal }))).json();
  assert.equal(payload.mode, "unavailable");
  assert.equal(payload.failedDistricts.length, 25);
  assert.equal(calls, 0);
});

test("partial refresh removes canceled current-month prices only in successfully refreshed districts", async () => {
  const { mergeMasterWithTrades } = await server.ssrLoadModule("/app/page.tsx");
  const base = { name: "테스트단지", dong: "테스트동", address: "", buildYear: 2014, households: 100,
    buildingCount: 1, parking: 100, latestSale: { price: 10, date: "2026-07-10" },
    latestJeonse: null, areas: [84.9], source: "K-apt" };
  const masters = [{ ...base, id: "mapo", district: "마포구" }, { ...base, id: "gangnam", district: "강남구" }];
  const summaries = Object.fromEntries(masters.map((row) => [row.id, [{ area: 84.9, price: 10, date: "2026-07-10" }]]));
  const merged = mergeMasterWithTrades(masters, [], summaries, "202607", ["마포구"]);
  assert.equal(merged[0].record.latestSale, null);
  assert.equal(merged[0].record.areaSales.length, 0);
  assert.equal(merged[1].record.latestSale.price, 10);
  assert.equal(merged[1].record.areaSales.length, 1);
  const unavailable = mergeMasterWithTrades(masters, [], summaries, undefined, []);
  assert.equal(unavailable[0].record.latestSale.price, 10);
});
