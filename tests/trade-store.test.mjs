import assert from "node:assert/strict";
import test, { before, after, afterEach } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import { database } from "./helpers/d1.mjs";
import { collectScope, optionsFromEnv, postImport, verifyStorageReport } from "../scripts/collect-molit.mjs";
import { sanitizeRecord } from "../lib/molit-records.mjs";

let server, store, runtime, trades, detail, admin, summaries;
const originalFetch = globalThis.fetch;
const originalToken = process.env.DATA_REFRESH_TOKEN;
before(async () => {
  server = await createServer({ configFile: false, cacheDir: ".cache/store-tests", optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  store = await server.ssrLoadModule("/db/trade-store.ts");
  runtime = await server.ssrLoadModule("/db/runtime.ts");
  trades = await server.ssrLoadModule("/app/api/trades/route.ts");
  detail = await server.ssrLoadModule("/app/api/complex/route.ts");
  admin = await server.ssrLoadModule("/app/api/admin/trade-import/route.ts");
  summaries = await server.ssrLoadModule("/app/api/area-summaries/route.ts");
});
afterEach(() => { globalThis.fetch = originalFetch; runtime.setRuntimeD1(undefined); });
after(async () => {
  if (originalToken === undefined) delete process.env.DATA_REFRESH_TOKEN;
  else process.env.DATA_REFRESH_TOKEN = originalToken;
  await server?.close();
});
const row = (overrides = {}) => ({ apartment: "마포래미안푸르지오2단지", dong: "아현동", jibun: null,
  aptSeq: null, buildYear: 2014, date: "2026-07-10", type: "sale", priceManwon: 100001, monthlyRent: 0, area: 84.9, floor: 10, ...overrides });
const scope = { district: "마포구", month: "202607", kind: "sale" };
async function start(d1, records, overrides = {}) {
  const input = { id: randomUUID(), ...scope, expectedCount: records.length, fetchedAt: "2026-08-01T00:00:00.000Z", ...overrides };
  await store.startImport(d1, input);
  return input.id;
}
async function publish(d1, records, overrides = {}) {
  const id = await start(d1, records, overrides);
  for (let offset = 0; offset < records.length; offset += 200) await store.appendImport(d1, id, offset, records.slice(offset, offset + 200));
  await store.commitImport(d1, id);
  return id;
}
const head = db => db.prepare("SELECT * FROM trade_snapshot_heads WHERE district='마포구' AND month='202607' AND kind='sale'").get();
const detailRequest = (range = "from=202607&to=202607") => new Request("https://example.test/api/complex?complexId=A12175203&" + range);

test("partial uploads remain private; complete commit preserves exact prices without a D1 master seed", async () => {
  const { db, d1 } = database();
  try {
    const old = await publish(d1, [row()]);
    const id = await start(d1, [row(), row({ date: "2026-07-11" })], { fetchedAt: "2026-08-02T00:00:00.000Z" });
    await store.appendImport(d1, id, 0, [row()]);
    await assert.rejects(store.commitImport(d1, id), /전체 건수/);
    assert.equal(head(db).run_id, old);
    await store.appendImport(d1, id, 1, [row({ date: "2026-07-11" })]);
    assert.equal((await store.commitImport(d1, id)).published, true);
    const list = await store.readStoredTrades(d1, "202607", "마포구");
    assert.equal(list.trades.length, 2);
    assert.equal(list.trades[0].price, 10.0001);
    assert.equal((await store.readStoredDetail(d1, "A12175203", "마포구", "202607", "202607")).transactions.length, 2);
    assert.equal((await store.readStoredAreaSales(d1, "202607")).A12175203[0].price, 10.0001);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apartment_complexes").get().n, 0);
  } finally { db.close(); }
});

test("identical retries are idempotent, including concurrent requests; conflicting overlaps are atomic", async () => {
  const { db, d1 } = database();
  try {
    const id = await start(d1, [row(), row(), row()]);
    const results = await Promise.all([store.appendImport(d1, id, 0, [row(), row()]), store.appendImport(d1, id, 0, [row(), row()])]);
    assert.ok(results.some(result => result.repeated));
    await assert.rejects(store.appendImport(d1, id, 1, [row({ priceManwon: 200000 }), row()]), /내용이 다릅니다/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows").get().n, 2);
    await assert.rejects(store.commitImport(d1, id));
    await assert.rejects(store.startImport(d1, { id, ...scope, expectedCount: 4, fetchedAt: "2026-08-01T00:00:00.000Z" }));
    await store.appendImport(d1, id, 2, [row()]);
    await store.commitImport(d1, id);
    assert.equal((await store.appendImport(d1, id, 0, [row(), row()])).repeated, true);
    assert.equal((await store.commitImport(d1, id)).published, true);
  } finally { db.close(); }
});

test("older delayed imports and failed publication batches never replace the latest complete head", async () => {
  const { db, d1 } = database();
  try {
    const newer = await publish(d1, [row()], { fetchedAt: "2026-08-03T00:00:00.000Z" });
    const older = await publish(d1, [row({ priceManwon: 90000 })]);
    assert.equal(head(db).run_id, newer);
    assert.equal((await store.commitImport(d1, older)).published, false);
    const next = await start(d1, [], { fetchedAt: "2026-08-04T00:00:00.000Z" });
    const prepare = d1.prepare;
    d1.prepare = sql => prepare(sql.startsWith("INSERT INTO trade_snapshot_heads") ? "INSERT INTO missing_table VALUES (?)" : sql);
    await assert.rejects(store.commitImport(d1, next));
    assert.equal(head(db).run_id, newer);
    assert.equal(db.prepare("SELECT committed FROM trade_import_runs WHERE id=?").get(next).committed, 0);
  } finally { db.close(); }
});

test("completed empty scopes differ from missing scopes, and cancel stale legacy prices only in that sale scope", async () => {
  const { db, d1 } = database();
  try {
    db.exec("INSERT INTO apartment_complexes(id,name,normalized_name,district) VALUES ('legacy','기존','기존','마포구')");
    db.exec("INSERT INTO complex_area_monthly_sales VALUES ('legacy','마포구','202606',59,110000,'2026-06-10'),('legacy','마포구','202607',59,120000,'2026-07-10')");
    await publish(d1, [], { kind: "rent" });
    assert.equal((await store.readStoredAreaSales(d1, "202607")).legacy[0].price, 12);
    await publish(d1, []);
    assert.equal((await store.readStoredAreaSales(d1, "202607")).legacy[0].price, 11);
    await publish(d1, [], { month: "202606" });
    assert.deepEqual(await store.readStoredAreaSales(d1, "202607"), {});
    runtime.setRuntimeD1(d1);
    const empty = await (await trades.GET(new Request("https://example.test/api/trades?month=202607&district=" + encodeURIComponent("마포구")))).json();
    assert.equal(empty.mode, "stored");
    assert.deepEqual(empty.trades, []);
    assert.deepEqual(empty.missingDistricts, []);
    assert.equal(empty.fetchedAt, "2026-08-01T00:00:00.000Z");
    const all = await (await trades.GET(new Request("https://example.test/api/trades?month=202607"))).json();
    assert.equal(all.mode, "partial");
    assert.equal(all.missingDistricts.length, 24);
    const completeDetail = await (await detail.GET(detailRequest())).json();
    assert.equal(completeDetail.mode, "stored");
    assert.deepEqual(completeDetail.missing, []);
  } finally { db.close(); }
});

test("unmatched observations remain stored and historical reads exclude future scopes", async () => {
  const { db, d1 } = database();
  try {
    await publish(d1, [row({ apartment: "매칭되지않는단지", dong: "미확인동" })]);
    const stored = db.prepare("SELECT complex_id,payload FROM trade_import_rows").get();
    assert.equal(stored.complex_id, null);
    assert.equal(JSON.parse(stored.payload).apartment, "매칭되지않는단지");
    assert.equal((await store.readStoredTrades(d1, "202607")).trades.length, 1);
    await publish(d1, [row({ date: "2026-08-10" })], { month: "202608" });
    assert.deepEqual(await store.readStoredAreaSales(d1, "202607"), {});
  } finally { db.close(); }
});

test("all public trade GETs are SQL-read-only and make zero external requests", async () => {
  const { db, d1, statements } = database();
  try {
    await publish(d1, [row()]);
    runtime.setRuntimeD1(d1);
    statements.length = 0;
    globalThis.fetch = async () => { throw new Error("Public GET must not fetch"); };
    for (const [route, request] of [[trades, new Request("https://example.test/api/trades?month=202607")],
      [detail, detailRequest()], [summaries, new Request("https://example.test/api/area-summaries?month=202607")]]) {
      const response = await route.GET(request);
      assert.equal(response.status, 200);
      assert.notEqual((await response.json()).mode, "unavailable");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.ok(statements.length > 0);
    assert.ok(statements.every(sql => /^\s*(SELECT|WITH)\b/i.test(sql)));
  } finally { db.close(); }
});

test("public missing feeds and invalid date ranges are explicit; pre-2011 does not require rent", async () => {
  const { db, d1 } = database();
  try {
    runtime.setRuntimeD1(d1);
    let payload = await (await detail.GET(detailRequest())).json();
    assert.equal(payload.mode, "unavailable");
    assert.deepEqual(payload.missing, [{ month: "202607", kind: "sale" }, { month: "202607", kind: "rent" }]);
    await publish(d1, [row()]);
    payload = await (await detail.GET(detailRequest())).json();
    assert.equal(payload.mode, "partial");
    assert.deepEqual(payload.missing, [{ month: "202607", kind: "rent" }]);
    await publish(d1, [], { month: "200601" });
    payload = await (await detail.GET(detailRequest("from=200601&to=200601"))).json();
    assert.equal(payload.mode, "stored");
    for (const range of ["from=000001&to=999912", "from=202613&to=202613", "from=202501&to=202601"]) {
      assert.equal((await detail.GET(detailRequest(range))).status, 400);
    }
    assert.equal((await trades.GET(new Request("https://example.test/api/trades?month=202607x"))).status, 400);
    assert.equal((await trades.GET(new Request("https://example.test/api/trades?month=202607&district=invalid"))).status, 400);
  } finally { db.close(); }
});

test("ingestion fails closed on missing/bad auth and bounds actual streamed body bytes", async () => {
  const { db, d1 } = database();
  try {
    runtime.setRuntimeD1(d1);
    const request = (body, token) => new Request("https://example.test/api/admin/trade-import", { method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body });
    delete process.env.DATA_REFRESH_TOKEN;
    assert.equal((await admin.POST(request("{}"))).status, 503);
    process.env.DATA_REFRESH_TOKEN = "test-collector-token-at-least-thirty-two-characters";
    assert.equal((await admin.POST(request("{}"))).status, 401);
    assert.equal((await admin.POST(request("{}", "wrong"))).status, 401);
    const token = process.env.DATA_REFRESH_TOKEN;
    assert.equal((await admin.POST(request("x".repeat(600000), token))).status, 413);
    assert.equal((await admin.POST(request("{", token))).status, 400);
    assert.equal((await admin.POST(request(JSON.stringify({ action: "start", id: randomUUID(), ...scope, expectedCount: 50001, fetchedAt: "2026-08-01T00:00:00.000Z" }), token))).status, 400);
    const id = randomUUID();
    assert.equal((await admin.POST(request(JSON.stringify({ action: "start", id, ...scope, expectedCount: 0, fetchedAt: "2026-08-01T00:00:00.000Z" }), token))).status, 200);
    assert.equal((await admin.POST(request(JSON.stringify({ action: "commit", id }), token))).status, 200);
  } finally { db.close(); }
});

test("validation rejects out-of-range ordinals, malformed money/dates, and old matcher versions", async () => {
  const { db, d1 } = database();
  try {
    const id = await start(d1, [row()]);
    await assert.rejects(store.appendImport(d1, id, -1, [row()]));
    await assert.rejects(store.appendImport(d1, id, 1, [row()]));
    await assert.rejects(store.appendImport(d1, id, 0, [row({ priceManwon: 1.5 })]));
    assert.throws(() => sanitizeRecord(row({ date: "2026-02-30" }), "202602", "sale"));
    await store.appendImport(d1, id, 0, [row()]);
    db.prepare("UPDATE trade_import_runs SET mapping_version='outdated' WHERE id=?").run(id);
    await assert.rejects(store.commitImport(d1, id), /상태|마스터/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_snapshot_heads").get().n, 0);
  } finally { db.close(); }
});

test("cleanup is bounded, abandons stale staging, and never removes active history", async () => {
  const { db, d1 } = database();
  try {
    const active = await publish(d1, [row()]);
    const stale = await start(d1, Array.from({ length: 1001 }, () => row()), { fetchedAt: "2026-07-31T00:00:00.000Z" });
    for (let n = 0; n < 1001; n += 200) await store.appendImport(d1, stale, n, Array.from({ length: Math.min(200, 1001 - n) }, () => row()));
    db.exec("UPDATE trade_import_runs SET created_at='2020-01-01T00:00:00.000Z'");
    await store.cleanupImport(d1, active);
    assert.equal(head(db).run_id, active);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_rows WHERE run_id=?").get(stale).n, 1);
    await assert.rejects(store.commitImport(d1, stale), /상태|마스터/);
    await assert.rejects(store.appendImport(d1, stale, 0, [row()]), /정리/);
    await store.cleanupImport(d1, active);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trade_import_runs WHERE id=?").get(stale).n, 0);
    assert.equal((await store.readStoredTrades(d1, "202607")).trades.length, 1);
  } finally { db.close(); }
});

const env = { PUBLIC_SITE_URL: "https://example.test/", MOLIT_API_KEY: "test-key", DATA_REFRESH_TOKEN: "test-token-at-least-thirty-two-characters",
  MOLIT_DISTRICTS: "마포구", MOLIT_FROM: "202607", MOLIT_TO: "202607", MOLIT_KIND: "sale" };
test("collector validates HTTPS origin, explicit districts, feed dates and bounded backfills", () => {
  assert.equal(optionsFromEnv(env).scopes.length, 1);
  assert.equal(optionsFromEnv({ ...env, MOLIT_FROM: "200601", MOLIT_TO: "200612", MOLIT_KIND: "both" }).scopes.length, 12);
  for (const extra of [{ PUBLIC_SITE_URL: "http://example.test" }, { PUBLIC_SITE_URL: "https://user:pass@example.test" },
    { PUBLIC_SITE_URL: "https://example.test/subpath" }, { MOLIT_DISTRICTS: "" }, { MOLIT_KIND: "invalid" },
    { MOLIT_FROM: "202501", MOLIT_TO: "202601" }, { MOLIT_TO: "209901" }]) assert.throws(() => optionsFromEnv({ ...env, ...extra }));
});

const xmlItem = "<item><aptNm>마포래미안푸르지오2단지</aptNm><umdNm>아현동</umdNm><dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>10</dealDay><dealAmount>100001</dealAmount><excluUseAr>84.9</excluUseAr></item>";
const commitPayload = (id, count, unmatched = 0) => ({ committed: true, published: true, report: {
  id, expectedCount: count, storedCount: count, matchedCount: count - unmatched, unmatchedCount: unmatched,
  missingCount: 0, storageComplete: true, committed: true, abandoned: false, published: true,
} });
const envelope = (items, total, page) => "<resultCode>000</resultCode><totalCount>" + total + "</totalCount><pageNo>" + page + "</pageNo>" + items;
test("later-page upstream failures never start an upload, while complete zero scopes publish", async () => {
  const config = optionsFromEnv(env);
  let uploads = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "example.test") { uploads++; throw new Error("Unexpected upload"); }
    return url.searchParams.get("pageNo") === "1" ? new Response(envelope(xmlItem, 2, 1)) : new Response("", { status: 403 });
  };
  await assert.rejects(collectScope(config, scope));
  assert.equal(uploads, 0);
  const actions = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "example.test") return new Response(envelope("", 0, 1));
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body); actions.push(body);
    return Response.json(body.action === "commit" ? commitPayload(body.id, actions[0].expectedCount) : { remaining: false });
  };
  assert.equal((await collectScope(config, scope)).records, 0);
  assert.deepEqual(actions.map(item => item.action), ["start", "commit", "cleanup"]);
  assert.equal(actions[0].expectedCount, 0);
});

test("collector uploads sanitized chunks and never lets GC failure undo successful status", async () => {
  const config = optionsFromEnv(env);
  const actions = [];
  globalThis.fetch = async (input, options) => {
    if (new URL(String(input)).hostname !== "example.test") return new Response(envelope(xmlItem, 1, 1));
    const body = JSON.parse(options.body); actions.push(body);
    if (body.action === "cleanup") return new Response("", { status: 401 });
    return Response.json(body.action === "commit" ? commitPayload(body.id, actions[0].expectedCount) : { unmatched: 0 });
  };
  const result = await collectScope(config, scope);
  assert.equal(result.published, true);
  assert.equal(result.cleanupPending, true);
  assert.equal(actions.find(item => item.action === "chunk").records[0].priceManwon, 100001);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 401 }); };
  await assert.rejects(postImport(config.site, config.token, {}), /HTTP 401/);
  assert.equal(calls, 1);
});

test("collector rejects incomplete or contradictory persisted counts, even after a successful HTTP response", async () => {
  const report = commitPayload("run", 3, 1).report;
  assert.equal(verifyStorageReport(report, 3, "run").unmatchedCount, 1);
  for (const changed of [undefined, { ...report, storedCount: 2 }, { ...report, matchedCount: 3 },
    { ...report, id: "different" }, { ...report, committed: false }, { ...report, abandoned: true },
    { ...report, storageComplete: false }, { ...report, unmatchedCount: -1 }, { ...report, expectedCount: 4 }]) {
    assert.throws(() => verifyStorageReport(changed, 3, "run"), /counts could not be verified/);
  }
  const config = optionsFromEnv(env);
  const actions = [];
  globalThis.fetch = async (input, options) => {
    if (new URL(String(input)).hostname !== "example.test") return new Response(envelope(xmlItem, 1, 1));
    const body = JSON.parse(options.body); actions.push(body.action);
    return Response.json(body.action === "commit" ? commitPayload(body.id, 0) : { accepted: 1 });
  };
  await assert.rejects(collectScope(config, scope), /counts could not be verified/);
  assert.deepEqual(actions, ["start", "chunk", "commit"]);
});
