import test from "node:test";
import assert from "node:assert/strict";
import { createStaticApi } from "../lib/pages-api.mjs";
const hash=n=>String(n).padStart(24,"0");
function fixture() {
  const paths=Object.fromEntries(["catalog","places","config","trades","summaries","details"].map((key,i)=>[key,"data/"+key+"/"+hash(i)+".json"]));
  const manifest={version:1,generatedAt:"2026-01-31T00:00:00.000Z",catalog:paths.catalog,places:paths.places,mapConfig:paths.config,
    districts:["마포구","강남구"],coverage:{"202601":{"마포구":{sale:{fetchedAt:"2026-01-31T00:00:00.000Z",count:2},rent:{fetchedAt:"2026-01-31T00:00:00.000Z",count:0}}}},
    tradeFiles:{"202601":paths.trades},summaryFiles:{"202601":paths.summaries},detailFiles:{apt:paths.details}};
  const c={id:"apt",name:"테스트",district:"마포구",dong:"공덕동",buildYear:2000};
  const assets={
    "data/manifest.json":manifest,[paths.catalog]:{complexes:[c],mode:"live"},
    [paths.places]:{"마포구:공덕동":{schools:[],schoolScope:"none",note:"배정학교 정보 아님"}},
    [paths.config]:{enabled:false,clientId:""},[paths.trades]:[{id:"a"},{id:"b"}],
    [paths.summaries]:{apt:[{area:84,price:10,date:"2026-01-02"}]},
    [paths.details]:[{id:"a",date:"2026-01-02",type:"sale",price:10},{id:"b",date:"2025-12-02",type:"sale",price:9}]
  };
  const requests=[];
  const fetchImpl=async url=>{
    requests.push(url);
    assert.ok(url.startsWith("/realestatedash/data/"));
    const value=assets[url.replace("/realestatedash/","")];
    return value===undefined?new Response("",{status:404}):Response.json(value);
  };
  return {assets,paths,manifest,requests,fetchImpl,api:createStaticApi({base:"/realestatedash/",fetchImpl})};
}
test("Pages asset prefix and complete vs missing districts",async()=>{
  const f=fixture(),r=await(await f.api("/api/trades?month=202601")).json();
  assert.equal(r.mode,"partial");assert.deepEqual(r.completedDistricts,["마포구"]);assert.deepEqual(r.missingDistricts,["강남구"]);
  assert.equal(r.trades.length,2);
});
test("uncollected month is unavailable, not a confirmed zero",async()=>{
  const f=fixture(),r=await(await f.api("/api/trades?month=202512")).json();
  assert.equal(r.mode,"unavailable");assert.equal(r.trades.length,0);assert.match(r.message,/0건/);
});
test("complete empty scope is retained as coverage",async()=>{
  const f=fixture();f.assets[f.paths.trades]=[];f.manifest.coverage["202601"]["마포구"].sale.count=0;
  const r=await(await f.api("/api/trades?month=202601")).json();
  assert.deepEqual(r.completedDistricts,["마포구"]);assert.equal(r.trades.length,0);
});
test("price summaries never leak future months",async()=>{
  const f=fixture();
  assert.deepEqual((await(await f.api("/api/area-summaries?month=202512")).json()).summaries,{});
  assert.equal((await(await f.api("/api/area-summaries?month=202601")).json()).summaries.apt[0].price,10);
});
test("detail filters chunks while reusing one immutable file",async()=>{
  const f=fixture();
  const a=await(await f.api("/api/complex?complexId=apt&from=202601&to=202601")).json();
  assert.equal(a.mode,"stored");assert.equal(a.transactions.length,1);assert.deepEqual(a.missing,[]);
  const b=await(await f.api("/api/complex?complexId=apt&from=202512&to=202512")).json();
  assert.equal(b.mode,"unavailable");assert.deepEqual(b.missing,[{month:"202512",kind:"sale"},{month:"202512",kind:"rent"}]);
  assert.equal(f.requests.filter(url=>url.endsWith(f.paths.details)).length,1);
});
test("rent is not expected before 2011",async()=>{
  const f=fixture(),r=await(await f.api("/api/complex?complexId=apt&from=200601&to=200601")).json();
  assert.deepEqual(r.missing,[{month:"200601",kind:"sale"}]);
});
test("missing referenced file fails, never supplies fake data",async()=>{
  const f=fixture();delete f.assets[f.paths.trades];
  assert.equal((await f.api("/api/trades?month=202601")).status,503);
});
test("failed asset can be retried",async()=>{
  const f=fixture(),rows=f.assets[f.paths.trades];delete f.assets[f.paths.trades];
  assert.equal((await f.api("/api/trades?month=202601")).status,503);
  f.assets[f.paths.trades]=rows;
  assert.equal((await f.api("/api/trades?month=202601")).status,200);
});
test("rejects external paths, methods, invalid ranges, unknown apartment",async()=>{
  const f=fixture();
  for (const path of ["/api/complex?complexId=apt&from=202401&to=202501","/api/trades?month=209901","https://example.com/api/trades"])
    assert.equal((await f.api(path)).status,400);
  assert.equal((await f.api("/api/admin",{method:"POST"})).status,405);
  assert.equal((await f.api("/api/admin")).status,404);
  assert.equal((await f.api("/api/complex?complexId=unknown&from=202601&to=202601")).status,404);
});
test("malicious manifest paths cannot make cross-origin requests",async()=>{
  const f=fixture();f.manifest.catalog="https://example.com/secret";
  assert.equal((await f.api("/api/complexes")).status,503);
  assert.equal(f.requests.length,1);
});
test("one caller abort does not poison a shared dataset",async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(()=>f.api("/api/complexes",{signal:controller.signal}),{name:"AbortError"});
  assert.equal((await f.api("/api/complexes")).status,200);
});
test("places and map config require no server",async()=>{
  const f=fixture(),r=await(await f.api("/api/places?district=마포구&dong=공덕동&apartment=테스트")).json();
  assert.equal(r.location.mapQuery,"서울특별시 마포구 공덕동 테스트");
  assert.match(r.note,/배정학교/);
  assert.equal((await(await f.api("/api/map-config")).json()).enabled,false);
});

test("explicit dashboard refresh reloads the manifest and retains project base",async()=>{
  const f=fixture();
  await f.api("/api/complexes");
  await f.api("/api/trades?month=202601");
  f.api.refresh();
  await f.api("/api/complexes");
  assert.equal(f.requests.filter(url=>url.endsWith("data/manifest.json")).length,2);
});
