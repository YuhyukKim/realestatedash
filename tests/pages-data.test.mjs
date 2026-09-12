import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { derivePagesData } from "../.cache/pages-data.mjs";
import { staticOptions,validateSnapshot,scopeFile } from "../lib/pages-snapshots.mjs";
import { collectSnapshots,persistSnapshots } from "../scripts/collect-pages.mjs";
const row=(extra={})=>({apartment:"테스트",dong:"공덕동",jibun:"1",aptSeq:null,buildYear:2000,date:"2026-01-02",type:"sale",priceManwon:100000,monthlyRent:0,area:84,floor:3,...extra});
const scope=(extra={})=>({version:1,district:"마포구",month:"202601",kind:"sale",fetchedAt:"2026-02-01T00:00:00.000Z",expectedCount:1,records:[row()],...extra});
const seed=[{id:"apt",name:"테스트",district:"마포구",dong:"공덕동",jibunAddress:"서울특별시 마포구 공덕동 1",buildYear:2000,latestSale:{price:999,date:"2026-01-01"},areas:[59]}];
test("GitHub collector needs only the public-data key, no Cloudflare token",()=>{
  const config=staticOptions({MOLIT_API_KEY:"test-key",MOLIT_DISTRICTS:"마포구",MOLIT_FROM:"202601",MOLIT_TO:"202601",MOLIT_KIND:"sale"});
  assert.equal(config.scopes.length,1);assert.equal(config.scopes[0].district,"마포구");
  assert.equal(Object.hasOwn(config,"site"),false);assert.equal(Object.hasOwn(config,"token"),false);
});
test("explicit scopes, history and run-size bounds",()=>{
  const env={MOLIT_API_KEY:"test",MOLIT_DISTRICTS:"마포구",MOLIT_FROM:"202601",MOLIT_TO:"202601"};
  for (const change of [{MOLIT_DISTRICTS:""},{MOLIT_DISTRICTS:"../../tmp"},{MOLIT_KIND:"bad"},{MOLIT_FROM:"202401",MOLIT_TO:"202601"}])
    assert.throws(()=>staticOptions({...env,...change}));
  const before=staticOptions({...env,MOLIT_FROM:"200601",MOLIT_TO:"200601"});
  assert.deepEqual(before.scopes,[{district:"마포구",month:"200601",kind:"sale"}]);
});
test("snapshot sanitization removes extra fields and enforces complete counts",()=>{
  const clean=validateSnapshot({...scope(),serviceKey:"must-not-publish",records:[{...row(),secret:"never"}]});
  assert.equal(JSON.stringify(clean).includes("secret"),false);assert.equal(Object.hasOwn(clean,"serviceKey"),false);
  assert.throws(()=>validateSnapshot(scope({expectedCount:2})));
  assert.throws(()=>validateSnapshot(scope({records:[row({date:"2026-02-01"})]})));
  assert.equal(scopeFile(clean),"11440/202601.sale.json");
});
test("canonical master retained, legacy sample price cleared, unmatched records counted",()=>{
  const data=derivePagesData(seed,[scope({expectedCount:2,records:[row(),row({apartment:"다른단지",jibun:"999"})]})]);
  assert.equal(data.complexes.length,1);assert.equal(data.complexes[0].latestSale,null);
  assert.equal(data.matchedCount,1);assert.equal(data.unmatchedCount,1);assert.equal(data.tradesByMonth["202601"].length,2);
  assert.deepEqual(data.complexes[0].areas,[59,84]);assert.equal(data.details.apt[0].price,10);
});
test("identical transactions remain separate and latest-area ties are deterministic",()=>{
  const data=derivePagesData(seed,[scope({expectedCount:3,records:[row(),row(),row({priceManwon:110000})]})]);
  assert.equal(data.details.apt.length,3);assert.equal(new Set(data.details.apt.map(r=>r.id)).size,3);
  assert.equal(data.summaries["202601"].apt[0].price,11);
});
test("summary history is as-of month, not newest price applied backwards",()=>{
  const data=derivePagesData(seed,[scope(),scope({month:"202602",records:[row({date:"2026-02-01",priceManwon:120000})]})]);
  assert.equal(data.summaries["202601"].apt[0].price,10);assert.equal(data.summaries["202602"].apt[0].price,12);
});
test("zero records still produce a coverage head; duplicate scopes fail",()=>{
  const data=derivePagesData(seed,[scope({expectedCount:0,records:[]})]);
  assert.equal(data.coverage["202601"]["마포구"].sale.count,0);assert.deepEqual(data.tradesByMonth["202601"],[]);
  assert.throws(()=>derivePagesData(seed,[scope(),scope()]));
});
test("incomplete multi-scope collection fails before file persistence",async()=>{
  const config={serviceKey:"fake",scopes:[{district:"마포구",month:"202601",kind:"sale"},{district:"마포구",month:"202602",kind:"sale"}]};
  let calls=0;
  await assert.rejects(()=>collectSnapshots(config,async()=>{if (++calls===2) throw new Error("upstream failed");return "<items></items>";}));
  assert.equal(calls,2);
});
test("snapshot writer retains newer and suspiciously emptied data",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"pages-snapshot-test-"));
  await persistSnapshots([scope()],dir);
  await assert.rejects(()=>persistSnapshots([scope({fetchedAt:"2026-01-30T00:00:00Z"})],dir),/newer/);
  await assert.rejects(()=>persistSnapshots([scope({expectedCount:0,records:[]})],dir),/empty/);
  const saved=JSON.parse(await readFile(join(dir,"11440/202601.sale.json"),"utf8"));
  assert.equal(saved.expectedCount,1);
});
