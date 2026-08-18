import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the Seoul apartment dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /서울 아파트 실거래가/);
  assert.match(html, /가격대별 배치표/);
  assert.match(html, /연식/);
  assert.match(html, /5년 이하/);
  assert.match(html, /1988년식/);
  assert.match(html, /엑셀 다운로드/);
  assert.match(html, /단지를 누르면 매매·전월세 상세 추이/);
  assert.match(html, /공덕자이/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("includes building years in demo trade data", async () => {
  const response = await render("/api/trades?month=202607");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

  const payload = await response.json();
  assert.equal(payload.mode, "demo");
  assert.equal(payload.trades.length, 60);
  assert.equal(payload.trades[0].buildYear, 1988);
  assert.ok(
    payload.trades.every((trade) => typeof trade.buildYear === "number"),
  );
});

test("returns apartment sale and rental history for the detail panel", async () => {
  const response = await render(
    "/api/complex?district=마포구&dong=아현동&apartment=공덕자이&from=202507&to=202606&asOf=202607&buildYear=2015&basePrice=23.5&baseArea=84.9",
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

  const payload = await response.json();
  assert.equal(payload.mode, "demo");
  assert.equal(payload.complex.apartment, "공덕자이");
  assert.equal(payload.complex.buildYear, 2015);
  assert.ok(payload.transactions.some((transaction) => transaction.type === "sale"));
  assert.ok(payload.transactions.some((transaction) => transaction.type === "jeonse"));
  assert.ok(payload.transactions.some((transaction) => transaction.type === "monthly"));
  assert.ok(
    payload.transactions.every(
      (transaction) =>
        typeof transaction.price === "number" &&
        typeof transaction.area === "number" &&
        typeof transaction.floor === "number",
    ),
  );
});

test("keeps pre-2011 long-range demo history to sale transactions", async () => {
  const response = await render(
    "/api/complex?district=용산구&dong=이촌동&apartment=한강맨션&from=200601&to=200612&asOf=202607&buildYear=1971&basePrice=30.5&baseArea=120.6",
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.mode, "demo");
  assert.ok(payload.transactions.length > 0);
  assert.ok(payload.transactions.every((transaction) => transaction.type === "sale"));
});

