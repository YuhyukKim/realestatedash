import test, {before,after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "vite";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFile} from "node:fs/promises";
let vite, ComparisonPanel, ComplexDetailPanel;
before(async()=>{
  vite=await createServer({configFile:false,appType:"custom",logLevel:"silent",cacheDir:".cache/explorer-tests",optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false}});
  ({ComparisonPanel}=await vite.ssrLoadModule("/app/comparison-panel.tsx"));
  ({default:ComplexDetailPanel}=await vite.ssrLoadModule("/app/complex-detail.tsx"));
});
after(async()=>{await vite?.close();});
const record={id:"test-unpriced",name:"자료 없는 단지",district:"마포구",dong:"상암동",address:"서울 마포구",buildYear:null,households:null,buildingCount:null,parking:null,latestSale:null,latestJeonse:null,areas:[],source:"test"};
test("comparison never replaces missing prices and area with zeros",()=>{
  const priced={...record,id:"test-priced",name:"거래 확인 단지",latestSale:{price:7.5,date:"2026-09-01"},areas:[59.9],areaSales:[{area:84.9,price:7.5,date:"2026-09-01"},{area:59.9,price:7.5,date:"2026-09-01"}]};
  const html=renderToStaticMarkup(createElement(ComparisonPanel,{records:[record,priced],month:"2026-09",areaLabel:"전체",onClose(){},onSelect(){}}));
  assert.match(html,/role="dialog"/);assert.match(html,/aria-modal="true"/);
  assert.match(html,/가격 미확인/);assert.match(html,/59.9㎡/);assert.doesNotMatch(html,/84.9㎡/);
  assert.match(html,/2026-09-01/);assert.match(html,/7억 5,000만원/);
  assert.match(html,/거래 면적·계약일이 다를 수 있습니다/);
});
test("desktop detail is a non-modal region; mobile retains a dialog",()=>{
  const complex={...record,apartment:record.name,defaultArea:null,basePrice:null,referenceDate:null};
  const render=docked=>renderToStaticMarkup(createElement(ComplexDetailPanel,{complex,endMonth:"2026-09",docked,onClose(){}}));
  const docked=render(true), modal=render(false);
  assert.match(docked,/class="detail-docked"/);assert.match(docked,/role="region"/);assert.doesNotMatch(docked,/aria-modal/);
  assert.match(modal,/role="dialog"/);assert.match(modal,/aria-modal="true"/);
  assert.ok(docked.indexOf('data-detail-section="trades"')<docked.indexOf('data-detail-section="location"'));
  assert.match(docked,/단지 상세 탐색/);
});
test("new search tools preserve the continuous master list and distinguish coverage",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(page,/aria-label="결과 보기 방식"/);assert.match(page,/관심 단지만/);
  assert.match(page,/aria-label="아파트 결과 비교표"/);assert.match(page,/condition.clear/);
  assert.match(page,/선택월 거래 미수집/);assert.match(page,/setVisibleResultLimit\(60\)/);
  assert.doesNotMatch(page,/finder-price-group/);
  const hook=await readFile(new URL("../app/use-shortlist.ts",import.meta.url),"utf8");
  assert.match(hook,/localStorage.setItem/);assert.doesNotMatch(hook,/fetch\(/);
});
