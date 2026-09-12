import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { parseFeed } from "../lib/molit-records.mjs";
import { tag, isCanceledSale } from "../lib/molit-client.mjs";

let server, money, detail, areas;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/price-tests",
    optimizeDeps: { noDiscovery: true }, esbuild: { jsx: "automatic", jsxImportSource: "react" },
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  money = await server.ssrLoadModule("/app/price-format.ts");
  detail = await server.ssrLoadModule("/app/complex-detail.tsx");
  areas = await server.ssrLoadModule("/app/area-sales.ts");
});
after(async () => { await server?.close(); });

test("individual amounts preserve every manwon across eok boundaries", () => {
  for (const [manwon, expected] of [
    [0, "0원"], [1, "1만원"], [999, "999만원"], [1000, "1,000만원"],
    [9999, "9,999만원"], [10000, "1억"], [10001, "1억 1만원"],
    [100000, "10억"], [100001, "10억 1만원"], [105550, "10억 5,550만원"],
    [109999, "10억 9,999만원"], [110000, "11억"], [110001, "11억 1만원"],
    [999999, "99억 9,999만원"], [1000000000, "100,000억"],
  ]) assert.equal(money.formatPrice(manwon / 10000), expected);
  // Decimal eok uses binary floating point; normalize only when formatting.
  for (let manwon = 1; manwon < 1000000; manwon += 997) {
    const eok = Math.floor(manwon / 10000), rest = manwon % 10000;
    const expected = eok
      ? String(eok) + "억" + (rest ? " " + rest.toLocaleString("ko-KR") + "만원" : "")
      : rest.toLocaleString("ko-KR") + "만원";
    assert.equal(money.formatPrice(manwon / 10000), expected);
  }
});

test("unknown or invalid prices never become a zero-price contract", () => {
  for (const value of [undefined, null, "", "10", NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(money.formatPrice(value), "-");
    assert.equal(money.formatSummaryPrice(value), "-");
  }
  assert.equal(money.formatPrice(-0), "0원");
});

test("monthly deposits and monthly rent keep their distinct units", () => {
  assert.equal(money.formatRent({ type: "jeonse", price: 6.0001, monthlyRent: 0 }), "6억 1만원");
  assert.equal(money.formatRent({ type: "monthly", price: 1.0001, monthlyRent: 123 }), "보증금 1억 1만원 / 월 123만원");
  assert.equal(money.formatRent({ type: "monthly", price: 0, monthlyRent: 1 }), "보증금 0원 / 월 1만원");
  assert.equal(money.formatRent({ type: "monthly", price: 0.9999, monthlyRent: 1234 }), "보증금 9,999만원 / 월 1,234만원");
  for (const monthlyRent of [undefined, null, NaN, -1, 0, 1.5]) {
    assert.equal(money.formatRent({ type: "monthly", price: 1, monthlyRent }), "-");
  }
  assert.equal(money.formatRent({ type: "monthly", price: NaN, monthlyRent: 100 }), "-");
});

test("aggregates are explicitly approximate rather than pretending to be contract amounts", () => {
  assert.equal(money.formatPrice(10.9999), "10억 9,999만원");
  assert.equal(money.formatSummaryPrice(10.9999), "약 11.0억");
  // A two-contract median can contain half a manwon; only its label is rounded.
  const midpoint = (100001 + 100002) / 2 / 10000;
  assert.equal(money.formatPrice(midpoint), "10억 2만원");
});

const xml = (amount = "100,001", deposit = "10,001", monthly = "123") =>
  "<item><aptNm>정밀도단지</aptNm><umdNm>아현동</umdNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>10</dealDay>" +
  "<dealAmount>" + amount + "</dealAmount><deposit>" + deposit + "</deposit><monthlyRent>" + monthly +
  "</monthlyRent><excluUseAr>84.9</excluUseAr><floor>10</floor></item>";

test("validated source money reaches display without one-decimal quantization", () => {
  const sale = parseFeed(xml(), "202607", "sale", tag, isCanceledSale)[0];
  const monthly = parseFeed(xml(), "202607", "rent", tag, isCanceledSale)[0];
  const jeonse = parseFeed(xml("100,001", "60,001", "0"), "202607", "rent", tag, isCanceledSale)[0];
  assert.equal(sale.priceManwon, 100001);
  assert.equal(money.formatPrice(sale.priceManwon / 10000), "10억 1만원");
  assert.equal(money.formatRent({ ...monthly, price: monthly.priceManwon / 10000 }), "보증금 1억 1만원 / 월 123만원");
  assert.equal(money.formatRent({ ...jeonse, price: jeonse.priceManwon / 10000 }), "6억 1만원");
});

const observation = (overrides = {}) => ({
  id: "sale", date: "2026-07-10", type: "sale", price: 10.0001, monthlyRent: 0,
  area: 84.9, floor: 10, ...overrides,
});
function renderList(transactions, type) {
  return renderToStaticMarkup(createElement(detail.TransactionList, {
    title: "실거래", caption: "금액 만원 단위", transactions, type, emptyNote: "미수집", complete: true,
  }));
}

test("actual sale and rent list components render precise amounts and keep contract context", () => {
  const sale = renderList([observation()], "sale");
  assert.match(sale, /10억 1만원/);
  assert.doesNotMatch(sale, /10\.0억/);
  assert.match(sale, /2026/); assert.match(sale, /07\.10/);
  assert.match(sale, /84\.9㎡/); assert.match(sale, /10층/);
  const rent = renderList([
    observation({ id: "jeonse", type: "jeonse", price: 6.0001 }),
    observation({ id: "monthly", type: "monthly", price: 1.0001, monthlyRent: 123 }),
  ], "rent");
  assert.match(rent, /6억 1만원/);
  assert.match(rent, /보증금 1억 1만원 \/ 월 123만원/);
});

test("chart labels retain manwon precision while identifying monthly median approximations", () => {
  const props = { transactions: [observation(), observation({ id: "rent", type: "jeonse", price: 6.0001 })],
    endMonth: "202607", period: 1, buildYear: 2014, emptyNote: "미수집" };
  const sale = renderToStaticMarkup(createElement(detail.PriceChart, { ...props, metric: "sale" }));
  assert.match(sale, /최고 중위값 약 10억 1만원/);
  assert.match(sale, /최저 중위값 약 10억 1만원/);
  assert.match(sale, /만원 단위 반올림/);
  const rent = renderToStaticMarkup(createElement(detail.PriceChart, { ...props, metric: "jeonse" }));
  assert.match(rent, /약 6억 1만원/);
  const ratio = renderToStaticMarkup(createElement(detail.PriceChart, { ...props, metric: "ratio" }));
  assert.match(ratio, /최고 전세가율 60\.0%/);
  assert.doesNotMatch(ratio, /60\.0억/);
});

test("price boundaries and exact exported numeric values are not rounded for presentation", async () => {
  const base = { id: "one", name: "단지", district: "마포구", areas: [84.9], latestSale: null };
  const below = { ...base, areaSales: [{ area: 84.9, date: "2026-07-10", price: 10.9999 }] };
  assert.equal(areas.applyAreaPriceFilter(below, null, { min: 0, max: 11 }).latestSale.price, 10.9999);
  assert.equal(areas.applyAreaPriceFilter(below, null, { min: 11, max: 16 }), null);
  const above = { ...base, areaSales: [{ area: 84.9, date: "2026-07-10", price: 11.0001 }] };
  assert.equal(areas.applyAreaPriceFilter(above, null, { min: 0, max: 11 }), null);
  assert.equal(areas.applyAreaPriceFilter(above, null, { min: 11, max: 16 }).latestSale.price, 11.0001);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/complex-detail.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ formatPrice, formatSummaryPrice \} from "\.\/price-format"/);
  assert.match(panel, /import \{ formatPrice, formatRent \} from "\.\/price-format"/);
  assert.match(page, /"최근매매가\(억원\)": record\.latestSale\?\.price \?\? ""/);
  assert.doesNotMatch(page + panel, /function formatPrice\(/);
});
