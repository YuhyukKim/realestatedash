import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

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
  assert.match(html, /JAYDEN RESEARCH/);
  assert.match(html, /내집어디/);
  assert.match(html, /공식 서울 아파트 단지 마스터/);
  assert.match(html, /공식 단지 마스터를 불러오고 있습니다/);
  assert.doesNotMatch(html, /SEOUL APARTMENT FINDER|서울 아파트 파인더/);
  assert.match(html, /아파트 찾기/);
  assert.match(html, /가격대별 단지 분포/);
  assert.match(html, /2021년 이후/);
  assert.match(html, /1981~1990년/);
  assert.match(html, /엑셀 다운로드/);
  assert.match(html, /면적별 매매·전세 차트/);
  assert.match(html, /가까운 지하철역/);
  assert.match(html, /200m/);
  assert.match(html, /가까운 거리순/);
  assert.match(html, /먼 거리순/);
  assert.match(html, /직장 1 접근 가까운 순/);
  assert.match(html, /직장 1 접근 먼 순/);
  assert.doesNotMatch(html, /class="finder-price-group"/);
  assert.match(html, /직장\s*1/);
  assert.match(html, /직장\s*2/);
  assert.match(html, /지하철\s*1/);
  assert.match(html, /지하철\s*2/);
  assert.match(html, /입주(?:·준공)?년도/);
  assert.doesNotMatch(html, /<nav[^>]+aria-label="대시보드 메뉴"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("sorts Yeouido workplace access by a disclosed walk and direct-stop estimate", async () => {
  const [pageSource, commuteSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/commute.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /"workplace-asc"/);
  assert.match(pageSource, /"workplace-desc"/);
  assert.match(pageSource, /compareWorkplaceCommutes/);
  assert.match(pageSource, /complex\.workplaceCommute/);
  assert.match(pageSource, /직선거리 기반 도보 추정 \+ 직통 정거장당 2분 환산/);
  assert.match(commuteSource, /const YEOUIDO_ROUTES/);
  assert.match(commuteSource, /"5호선"/);
  assert.match(commuteSource, /"9호선"/);
  assert.match(commuteSource, /"여의도"/);
  assert.match(commuteSource, /"공덕"/);
  assert.match(commuteSource, /"애오개"/);
  assert.match(commuteSource, /"마천"/);
  assert.match(commuteSource, /station\.walkMinutes \+ stopCount \* 2/);
  assert.match(
    commuteSource,
    /left\.estimatedMinutes - right\.estimatedMinutes/,
  );
  assert.match(commuteSource, /if \(left === null\) return 1/);
  assert.match(commuteSource, /if \(right === null\) return -1/);
});

test("computes coordinate-based Yeouido access and keeps unknowns last", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());

  const commute = await vite.ssrLoadModule("/app/commute.ts");
  const ahyeon = commute.getWorkplaceCommuteEstimate(
    "A10027906",
    "yeouido",
  );
  const mapo = commute.getWorkplaceCommuteEstimate(
    "A12180506",
    "yeouido",
  );
  const heukseok = commute.getWorkplaceCommuteEstimate(
    "A15679109",
    "yeouido",
  );

  assert.equal(ahyeon?.station.name, "애오개");
  assert.equal(ahyeon?.stopCount, 4);
  assert.equal(ahyeon?.estimatedMinutes, ahyeon.station.walkMinutes + 8);
  assert.equal(mapo?.station.name, "공덕");
  assert.equal(mapo?.estimatedMinutes, mapo.station.walkMinutes + mapo.stopCount * 2);
  assert.equal(heukseok?.station.name, "흑석");
  assert.equal(heukseok?.line, "9호선");
  assert.equal(Math.sign(commute.compareWorkplaceCommutes(mapo, ahyeon, "asc")), -Math.sign(commute.compareWorkplaceCommutes(mapo, ahyeon, "desc")));
  assert.ok(commute.compareWorkplaceCommutes(null, mapo, "asc") > 0);
  assert.ok(commute.compareWorkplaceCommutes(null, mapo, "desc") > 0);
});

test("sorts apartment cards by station distance and keeps unknown distances last", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /sortMode === "distance-asc" \|\| sortMode === "distance-desc"/,
  );
  assert.match(source, /left\.station\?\.distanceMeters \?\? null/);
  assert.match(source, /if \(leftDistance === null\) return 1/);
  assert.match(source, /if \(rightDistance === null\) return -1/);
  assert.match(source, /sortMode === "distance-asc" \? "asc" : "desc"/);
});

test("renders apartment results as one continuous list without price-band sections", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /const groupedComplexes/);
  assert.doesNotMatch(source, /className="finder-price-group"/);
  assert.match(source, /complexes\s*\.slice\(0, visibleResultLimit\)/);
  assert.match(source, /단지 더 보기/);
});

test("keeps every detail map action on Naver Map", async () => {
  const detailSource = await readFile(
    new URL("../app/complex-detail.tsx", import.meta.url),
    "utf8",
  );
  const mapSource = await readFile(
    new URL("../app/naver-map.tsx", import.meta.url),
    "utf8",
  );
  const source = `${detailSource}\n${mapSource}`;

  assert.match(source, /https:\/\/map\.naver\.com\/p\/search/);
  assert.match(source, /https:\/\/oapi\.map\.naver\.com\/openapi\/v3\/maps\.js/);
  assert.match(source, /ncpKeyId/);
  assert.match(source, /submodules=geocoder/);
  assert.match(source, /NAVER DYNAMIC MAP/);
  assert.doesNotMatch(source, /maps\.google|map\.kakao|Google 지도|카카오맵/);
});

test("keeps the embedded Naver Map optional until a client ID is configured", async () => {
  const response = await render("/api/map-config");
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.enabled, false);
  assert.equal(payload.clientId, null);
});

test("waits for the Naver geocoder submodule before failing the first map", async () => {
  const source = await readFile(
    new URL("../app/naver-map.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /readinessPoll = window\.setInterval\(finish, 50\)/);
  assert.match(source, /!window\.naver\?\.maps\?\.Service/);
  assert.match(source, /window\.navermap_authFailure = authFailure/);
  assert.match(source, /window\.clearInterval\(readinessPoll\)/);
});

test("lets each popup transaction list expand beyond the first ten rows", async () => {
  const source = await readFile(
    new URL("../app/complex-detail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /TRANSACTION_LIST_INITIAL_COUNT = 10/);
  assert.match(source, /TRANSACTION_LIST_STEP = 10/);
  assert.match(source, /transactions\.slice\(0, visibleCount\)/);
  assert.match(source, /더보기/);
  assert.match(source, /접기/);
  assert.match(source, /aria-controls=\{listId\}/);
  assert.match(source, /aria-expanded=\{isExpanded\}/);
  assert.match(source, /key=\{`sale:\$\{complex\.id\}/);
  assert.match(source, /key=\{`rent:\$\{complex\.id\}/);
});

test("returns the full apartment master including complexes without a recent sale", async () => {
  const response = await render("/api/complexes?limit=20000");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

  const payload = await response.json();
  const kaptMeta = JSON.parse(
    await readFile(
      new URL("../db/generated-complexes.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const rebMeta = JSON.parse(
    await readFile(
      new URL("../db/generated-reb-complexes.meta.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(payload.complexes));
  assert.equal(
    payload.complexes.length,
    rebMeta.mergedRecords,
    "the unfiltered endpoint must return the exact deduplicated official master",
  );
  assert.equal(rebMeta.sourceKaptRecords, kaptMeta.records);
  assert.equal(
    new Set(payload.complexes.map((complex) => complex.id)).size,
    payload.complexes.length,
  );
  assert.ok(
    payload.complexes.length > 60,
    "the master endpoint must not collapse to the 60-row demo trade feed",
  );

  const noRecentSale = payload.complexes.find(
    (complex) => complex.latestSale === null,
  );
  assert.ok(
    noRecentSale,
    "a valid master record may exist without a recent sale",
  );
  assert.equal(typeof noRecentSale.id, "string");
  assert.equal(typeof noRecentSale.name, "string");
  assert.equal(typeof noRecentSale.district, "string");
  assert.equal(typeof noRecentSale.address, "string");
  assert.ok(
    noRecentSale.jibunAddress === null ||
      typeof noRecentSale.jibunAddress === "string",
  );
  assert.equal(noRecentSale.latestSale, null);
  assert.ok(Array.isArray(noRecentSale.areas));
});

test("versions D1 seed membership without deleting older master rows", async () => {
  const dbSource = await readFile(
    new URL("../db/complexes.ts", import.meta.url),
    "utf8",
  );
  const routeSource = await readFile(
    new URL("../app/api/complexes/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(dbSource, /apartment_complex_seed_memberships/);
  assert.match(dbSource, /seed_version = \?/);
  assert.match(
    dbSource,
    /ON CONFLICT\(complex_id, seed_version\) DO UPDATE SET/,
  );
  assert.doesNotMatch(dbSource, /DELETE FROM apartment_complexes/);
  assert.match(routeSource, /COMPLEX_SEED_VERSION/);
  assert.match(routeSource, /seedBatch[^\n]+\?\? 100/);
  assert.match(routeSource, /seedProgress\.complete && seedProgress\.exact/);
});

test("ships a reproducible official Seoul complex seed", async () => {
  const kaptSeed = JSON.parse(
    await readFile(new URL("../db/generated-complexes.json", import.meta.url), "utf8"),
  );
  const kaptMeta = JSON.parse(
    await readFile(
      new URL("../db/generated-complexes.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const rebSupplement = JSON.parse(
    await readFile(
      new URL("../db/generated-reb-complexes.json", import.meta.url),
      "utf8",
    ),
  );
  const rebMeta = JSON.parse(
    await readFile(
      new URL("../db/generated-reb-complexes.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const apartmentKaptSeed = kaptSeed.filter(
    (complex) => !["다세대", "연립주택"].includes(complex.complexType),
  );
  const seed = [...apartmentKaptSeed, ...rebSupplement];

  assert.equal(kaptSeed.length, 3181);
  assert.equal(apartmentKaptSeed.length, rebMeta.kaptRecords);
  assert.equal(rebMeta.excludedNonApartmentKaptRecords, 19);
  assert.equal(rebSupplement.length, rebMeta.supplementRecords);
  assert.equal(seed.length, rebMeta.mergedRecords);
  assert.equal(new Set(seed.map((complex) => complex.id)).size, seed.length);
  assert.equal(new Set(seed.map((complex) => complex.district)).size, 25);
  assert.equal(kaptMeta.records, kaptSeed.length);
  assert.equal(kaptMeta.sourceUpdatedAt, "2026-08-14");
  assert.equal(rebMeta.officialSeoulApartmentRecords, 9458);
  assert.equal(rebMeta.matchedRebRecords + rebMeta.supplementRecords, 9458);
  assert.equal(rebMeta.sameJibunSupplementRecords, 4);
  assert.match(kaptMeta.coverageNote, /K-apt|소규모/);
  assert.match(rebMeta.coverageNote, /공시대상|전수 건축물대장/);
  assert.doesNotMatch(JSON.stringify(rebMeta), /generatedAt/);

  const knownAggregateFamilies = [
    /(?:e|이)편한세상신촌/,
    /마포래미안푸르지오/,
    /수유역두산위브/,
  ];
  for (const pattern of knownAggregateFamilies) {
    assert.equal(
      seed.filter((complex) => pattern.test(complex.name)).length,
      1,
      `${pattern} must remain one K-apt aggregate card`,
    );
  }
  assert.equal(
    seed.filter(
      (complex) =>
        complex.district === "강남구" &&
        ["개포경남아파트", "경남2차"].includes(complex.name),
    ).length,
    1,
  );
  for (const id of rebMeta.knownRegressionChecks.coveredAggregateComponents) {
    assert.ok(!rebSupplement.some((complex) => complex.id === `reb:${id}`));
  }
  for (const id of rebMeta.knownRegressionChecks.preservedDistinctRecords) {
    assert.ok(rebSupplement.some((complex) => complex.id === `reb:${id}`));
  }
});

test("builds dashboard results from the apartment master as well as trades", async () => {
  const pageSource = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /공식 서울 아파트 단지 마스터/);
  assert.match(pageSource, /매매가 미확인/);
  assert.match(pageSource, /fetch\(["']\/api\/complexes\?limit=20000["'], \{ signal \}\)/);
  assert.match(pageSource, /setMasterComplexes\(data\.complexes/);
  assert.match(pageSource, /mergeMasterWithTrades\(masterComplexes, trades, storedSales, refreshedMonth, refreshedDistricts\)/);
  assert.match(pageSource, /useState<ComplexMasterRecord\[\]>\(\[\]\)/);
  assert.match(pageSource, /loadController\.current\?\.abort\(\)/);
  assert.match(pageSource, /기존 목록을 유지합니다/);
  assert.doesNotMatch(pageSource, /sampleComplexesFromTrades|molit:/);
});

test("keeps dashboard cards anchored to the master when trades do not match", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());

  const { mergeMasterWithTrades } = await vite.ssrLoadModule("/app/page.tsx");
  const master = [
    {
      id: "kapt:matched",
      name: "공덕자이 아파트",
      district: "마포구",
      dong: "아현동",
      address: "서울특별시 마포구 마포대로26길 22",
      buildYear: 2015,
      households: 1164,
      buildingCount: 18,
      parking: 1527,
      latestSale: null,
      latestJeonse: null,
      areas: [84.9],
      source: "K-apt",
    },
    {
      id: "kapt:without-trade",
      name: "거래없는마스터단지",
      district: "마포구",
      dong: "공덕동",
      address: "서울특별시 마포구 공덕동 1",
      buildYear: 2000,
      households: 100,
      buildingCount: 1,
      parking: 80,
      latestSale: null,
      latestJeonse: null,
      areas: [59.9],
      source: "K-apt",
    },
    {
      id: "kapt:mapo-raemian-prugio",
      name: "마포래미안푸르지오",
      district: "마포구",
      dong: "아현동",
      address: "서울특별시 마포구 마포대로 195",
      buildYear: 2014,
      households: 3885,
      buildingCount: 51,
      parking: 4580,
      latestSale: null,
      latestJeonse: null,
      areas: [59.9, 84.9],
      source: "K-apt",
    },
  ];
  const trades = [
    {
      id: "matched-trade",
      aptSeq: "matched",
      district: "마포구",
      dong: "아현동",
      apartment: "공덕자이",
      price: 23.5,
      area: 84.9,
      date: "2026-07-22",
      floor: 17,
      buildYear: 2015,
      jibun: "800",
    },
    {
      id: "unmatched-trade",
      aptSeq: "transaction-only",
      district: "마포구",
      dong: "대흥동",
      apartment: "거래전용가상단지",
      price: 18.9,
      area: 84.9,
      date: "2026-07-17",
      floor: 15,
      buildYear: 2020,
      jibun: "1",
    },
    {
      id: "mapo-phase-1",
      aptSeq: "mapo-phase-1",
      district: "마포구",
      dong: "아현동",
      apartment: "마포래미안푸르지오1단지",
      price: 18.1,
      area: 59.9,
      date: "2026-07-10",
      floor: 10,
      buildYear: 2014,
      jibun: null,
    },
    {
      id: "mapo-phase-2",
      aptSeq: "mapo-phase-2",
      district: "마포구",
      dong: "아현동",
      apartment: "마포래미안푸르지오2단지",
      price: 21.2,
      area: 84.9,
      date: "2026-07-20",
      floor: 15,
      buildYear: 2014,
      jibun: null,
    },
  ];

  assert.equal(typeof mergeMasterWithTrades, "function");
  const merged = mergeMasterWithTrades(master, trades);

  assert.equal(merged.length, master.length);
  assert.deepEqual(
    merged.map((complex) => complex.record.id),
    master.map((complex) => complex.id),
  );
  assert.deepEqual(
    merged.flatMap((complex) => complex.periodTrades.map((trade) => trade.id)),
    ["matched-trade", "mapo-phase-1", "mapo-phase-2"],
  );
  assert.equal(merged[0].record.latestSale?.price, 23.5);
  assert.equal(merged[1].record.latestSale, null);
  assert.deepEqual(
    merged[2].periodTrades.map((trade) => trade.apartment),
    ["마포래미안푸르지오1단지", "마포래미안푸르지오2단지"],
  );
  assert.equal(merged[2].record.latestSale?.price, 21.2);
  assert.doesNotMatch(
    JSON.stringify(merged),
    /거래전용가상단지|transaction-only|unmatched-trade|molit:/,
  );
});

test("uses legal-lot addresses to disambiguate same-name masters", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: fileURLToPath(new URL("../", import.meta.url)),
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());

  const { matchTradeToMaster } = await vite.ssrLoadModule(
    "/app/master-trade-matcher.ts",
  );
  const master = [
    {
      id: "lot-1",
      name: "센트럴아파트",
      district: "마포구",
      dong: "아현동",
      jibunAddress: "서울특별시 마포구 아현동 1",
      buildYear: 2010,
    },
    {
      id: "lot-2",
      name: "센트럴아파트",
      district: "마포구",
      dong: "아현동",
      jibunAddress: "서울특별시 마포구 아현동 2",
      buildYear: 2010,
    },
  ];

  assert.deepEqual(
    matchTradeToMaster(master, {
      apartment: "센트럴",
      district: "마포구",
      dong: "아현동",
      jibun: "2",
      buildYear: 2010,
    }),
    { masterId: "lot-2", reason: "jibun" },
  );
  assert.equal(
    matchTradeToMaster(master, {
      apartment: "센트럴",
      district: "마포구",
      dong: "아현동",
      jibun: null,
      buildYear: 2010,
    }),
    null,
  );
});

test("does not substitute demo prices when the trade API is unavailable", async () => {
  const response = await render("/api/trades?month=202607");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "unavailable");
  assert.deepEqual(payload.trades, []);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("does not generate synthetic history from a known apartment or reference price", async () => {
  const response = await render(
    "/api/complex?district=마포구&dong=아현동&apartment=공덕자이&from=202507&to=202606&basePrice=23.5&baseArea=84.9",
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "unavailable");
  assert.equal(payload.complex.apartment, "공덕자이 아파트");
  assert.deepEqual(payload.transactions, []);
});

test("client accepts only real trades and sends the canonical ID to history requests", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/complex-detail.tsx", import.meta.url), "utf8");
  assert.ok(!page.includes("sampleTrades"));
  assert.ok(!page.includes('masterMode === "live" ||'));
  assert.ok(page.includes('data.mode === "live" || data.mode === "partial"'));
  assert.ok(page.includes("setTrades(hasRealResponse ? data.trades : [])"));
  assert.ok(panel.includes("complexId: complex.id"));
  assert.ok(panel.includes('if (payload.mode === "live") cacheRef.current'));
});

test("does not fabricate history for a master complex without an observed trade", async () => {
  const response = await render(
    "/api/complex?district=강남구&dong=개포동&apartment=거래없는테스트단지&from=202507&to=202606&asOf=202607&buildYear=1986&master=1",
  );
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.mode, "unavailable");
  assert.deepEqual(payload.transactions, []);
  assert.match(payload.message, /예시 가격을 만들지 않습니다|확인되지 않은 가격/);
});

test("returns location and school context with a successful fallback response", async () => {
  const originalKey = process.env.NEIS_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.NEIS_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://open.neis.go.kr/")) {
      throw new Error("simulated school API network failure");
    }
    return originalFetch(input, init);
  };

  try {
    const response = await render(
      "/api/places?district=마포구&dong=아현동&apartment=공덕자이",
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);

    const payload = await response.json();
    assert.deepEqual(payload.location, {
      district: "마포구",
      dong: "아현동",
      apartment: "공덕자이",
      mapQuery: "서울특별시 마포구 아현동 공덕자이",
    });
    assert.ok(Array.isArray(payload.schools));
    assert.ok(
      ["same-dong", "same-district", "dong-name", "none"].includes(
        payload.schoolScope,
      ),
    );
    assert.equal(typeof payload.note, "string");
    assert.match(payload.note, /network failure|학교정보/);
    assert.match(payload.source?.name ?? "", /나이스|서울특별시교육청/);
    assert.match(payload.source?.url ?? "", /^https:\/\//);
    assert.ok(
      payload.source?.fetchedAt === null ||
        typeof payload.source?.fetchedAt === "string",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NEIS_API_KEY;
    else process.env.NEIS_API_KEY = originalKey;
  }
});
