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

test("parent cancellation stops collector upstream work without retries", async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); throw new DOMException("aborted", "AbortError"); };
  await assert.rejects(client.fetchMolitXml("https://example.test/api", "11440", "202607", "test", controller.signal));
  assert.equal(calls, 1);
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

test("collector parses complete pages, excludes cancelled sales, and preserves integer won-unit precision", async () => {
  const { parseFeed } = await import("../lib/molit-records.mjs");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(envelope(calls === 1 ? [item()] : [item("<cdealType>O</cdealType>")], 2, calls));
  };
  const xml = await client.fetchMolitXml("https://example.test/api", "11440", "202607", "test");
  assert.equal(calls, 2);
  assert.equal(parseFeed(xml, "202607", "sale", client.tag, client.isCanceledSale).length, 1);
  assert.equal(parseFeed(xml, "202607", "rent", client.tag, client.isCanceledSale).length, 2);
  const precise = item().replace("<dealAmount>100000", "<dealAmount>100001");
  assert.equal(parseFeed(precise, "202607", "sale", client.tag, client.isCanceledSale)[0].priceManwon, 100001);
  assert.throws(() => parseFeed(item().replace("<excluUseAr>84.9", "<excluUseAr>bad"), "202607", "sale", client.tag, client.isCanceledSale));
});
