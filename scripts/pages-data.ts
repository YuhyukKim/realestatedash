import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { getComplexSeed, COMPLEX_CATALOG_COVERAGE } from "../db/seed";
import { listComplexesFromSeed } from "../db/complexes";
import { createMasterTradeMatcher } from "../app/master-trade-matcher";
import { BUNDLED_SCHOOLS, BUNDLED_SCHOOL_DATA_YEAR } from "../app/school-data";
import { selectSchools } from "../app/places";
import { DISTRICTS, validateSnapshot, scopeFile } from "../lib/pages-snapshots.mjs";

export async function readSnapshots(root = "data/scopes") {
  const snapshots = [];
  let directories;
  try { directories = await readdir(root,{withFileTypes:true}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  for (const dir of directories.sort((a,b)=>a.name.localeCompare(b.name))) {
    if (!dir.isDirectory() || !Object.values(DISTRICTS).includes(dir.name)) throw new Error("Unexpected scope directory.");
    for (const file of (await readdir(join(root,dir.name),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (!file.isFile() || !/^20\d{2}(0[1-9]|1[0-2])\.(sale|rent)\.json$/.test(file.name)) throw new Error("Unexpected scope file.");
      const s = validateSnapshot(JSON.parse(await readFile(join(root,dir.name,file.name),"utf8")));
      if (scopeFile(s) !== dir.name+"/"+file.name) throw new Error("Scope path does not match content.");
      snapshots.push(s);
    }
  }
  return snapshots;
}
export function derivePagesData(seed: ReturnType<typeof getComplexSeed>, snapshots: ReturnType<typeof validateSnapshot>[]) {
  const complexes = listComplexesFromSeed(seed,{limit:20000,offset:0}).complexes.map(c=>({
    ...c,latestSale:null,latestJeonse:null,areas:[...c.areas],
  }));
  const matcher = createMasterTradeMatcher(complexes);
  const masterById = new Map(complexes.map(c=>[c.id,c]));
  const coverage: Record<string,Record<string,Record<string,{fetchedAt:string;count:number}>>> = {};
  const tradesByMonth: Record<string,any[]> = {};
  const details: Record<string,any[]> = {};
  const salesByMonth: Record<string,any[]> = {};
  let recordCount = 0, matchedCount = 0;
  const scopeKeys = new Set<string>();
  for (const raw of snapshots) {
    const s = validateSnapshot(raw);
    const key = scopeFile(s);
    if (scopeKeys.has(key)) throw new Error("Duplicate scope.");
    scopeKeys.add(key);
    coverage[s.month] ??= {};
    coverage[s.month][s.district] ??= {};
    coverage[s.month][s.district][s.kind] = {fetchedAt:s.fetchedAt,count:s.records.length};
    if (s.kind === "sale") { tradesByMonth[s.month] ??= []; salesByMonth[s.month] ??= []; }
    s.records.forEach((r:any,index:number)=>{
      recordCount++;
      const trade = {id:DISTRICTS[s.district as keyof typeof DISTRICTS]+"-"+s.month+"-"+s.kind+"-"+index,
        aptSeq:r.aptSeq,district:s.district,dong:r.dong,apartment:r.apartment,
        price:r.priceManwon/10000,area:r.area,date:r.date,floor:r.floor,buildYear:r.buildYear,jibun:r.jibun};
      if (s.kind === "sale") tradesByMonth[s.month].push(trade);
      const match = matcher(trade);
      if (!match) return;
      matchedCount++;
      const c = masterById.get(match.masterId)!;
      if (!c.areas.includes(r.area)) c.areas.push(r.area);
      (details[c.id] ??= []).push({id:trade.id,type:r.type,date:r.date,price:trade.price,
        monthlyRent:r.monthlyRent,area:r.area,floor:r.floor});
      if (r.type === "sale") (salesByMonth[s.month] ??= []).push({id:c.id,area:r.area,price:trade.price,date:r.date});
    });
  }
  complexes.forEach(c=>c.areas.sort((a,b)=>a-b));
  Object.values(details).forEach(rows=>rows.sort((a,b)=>b.date.localeCompare(a.date)||b.price-a.price||a.id.localeCompare(b.id)));
  const summaries: Record<string,Record<string,any[]>> = {};
  const latest = new Map<string,Map<number,any>>();
  for (const month of Object.keys(salesByMonth).sort()) {
    for (const row of salesByMonth[month]) {
      if (!latest.has(row.id)) latest.set(row.id,new Map());
      const areas = latest.get(row.id)!;
      const previous = areas.get(row.area);
      if (!previous || row.date>previous.date || (row.date===previous.date && row.price>previous.price))
        areas.set(row.area,{area:row.area,price:row.price,date:row.date});
    }
    summaries[month] = Object.fromEntries([...latest].map(([id,areas])=>[id,[...areas.values()].sort((a,b)=>a.area-b.area)]));
  }
  return {complexes,coverage,tradesByMonth,details,summaries,recordCount,matchedCount,unmatchedCount:recordCount-matchedCount};
}
export async function generatePagesData() {
  const data = derivePagesData(getComplexSeed(),await readSnapshots());
  const root = "pages/public";
  await mkdir(root,{recursive:true});
  // Public assets only. Do not copy a working directory, .env, raw API response or server build.
  for (const entry of await readdir("public",{withFileTypes:true})) {
    if (entry.isFile() && /\.(svg|png|ico|webp)$/.test(entry.name)) await copyFile(join("public",entry.name),join(root,entry.name));
  }
  let bytes = 0;
  async function writeAsset(group:string,value:unknown) {
    const content = JSON.stringify(value);
    const size = Buffer.byteLength(content);
    bytes += size;
    if (size>40*1024*1024 || bytes>450*1024*1024) throw new Error("Static dataset size budget exceeded; review hosting/data partitioning before publishing.");
    const name = createHash("sha256").update(content).digest("hex").slice(0,24)+".json";
    const path = "data/"+group+"/"+name;
    await mkdir(join(root,"data",group),{recursive:true});
    await writeFile(join(root,path),content);
    return path;
  }
  const catalog = await writeAsset("catalog",{complexes:data.complexes,mode:"live",coverage:COMPLEX_CATALOG_COVERAGE,
    message:"공식 단지 마스터 · 실거래는 GitHub Actions 수집 완료 범위만 제공"});
  const schools = BUNDLED_SCHOOLS.map(([name,level,,address,foundation,latitude,longitude])=>({
    code:"seoul-"+name+"-"+address,name,level,address,phone:null,homepage:null,foundation,latitude,longitude,
  }));
  const places: Record<string,unknown> = {};
  for (const c of data.complexes) {
    const key = c.district+":"+c.dong;
    if (Object.hasOwn(places,key)) continue;
    const selected = selectSchools(schools,c.district,c.dong);
    places[key] = {...selected,note:selected.note+" · "+BUNDLED_SCHOOL_DATA_YEAR+"년 서울시교육청 파일 기준",
      source:{name:"서울특별시교육청 연도별 학교 위도·경도 데이터",url:"https://www.data.go.kr/data/15152021/fileData.do",fetchedAt:null,dataYear:BUNDLED_SCHOOL_DATA_YEAR}};
  }
  const clientId = process.env.NAVER_MAP_CLIENT_ID?.trim() || "";
  if (clientId && !/^[a-zA-Z0-9_-]{1,100}$/.test(clientId)) throw new Error("Invalid public map client ID.");
  const manifest = {version:1,generatedAt:new Date().toISOString(),catalog,
    places:await writeAsset("places",places),mapConfig:await writeAsset("config",{enabled:!!clientId,clientId}),
    districts:Object.keys(DISTRICTS),coverage:data.coverage,tradeFiles:{} as Record<string,string>,
    summaryFiles:{} as Record<string,string>,detailFiles:{} as Record<string,string>,
    recordCount:data.recordCount,matchedCount:data.matchedCount,unmatchedCount:data.unmatchedCount};
  for (const [month,trades] of Object.entries(data.tradesByMonth)) manifest.tradeFiles[month] = await writeAsset("trades",trades);
  for (const [month,summary] of Object.entries(data.summaries)) manifest.summaryFiles[month] = await writeAsset("summaries",summary);
  for (const [id,rows] of Object.entries(data.details)) manifest.detailFiles[id] = await writeAsset("details",rows);
  await mkdir(join(root,"data"),{recursive:true});
  await writeFile(join(root,"data/manifest.json"),JSON.stringify(manifest));
  await writeFile(join(root,".nojekyll"),"");
  console.log(JSON.stringify({complexes:data.complexes.length,records:data.recordCount,matched:data.matchedCount,unmatched:data.unmatchedCount,dataBytes:bytes}));
}
