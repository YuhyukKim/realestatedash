import { validRecordMonth } from "./molit-records.mjs";
import { monthsInRange, monthOrdinal } from "./pages-snapshots.mjs";

/**
 * GET-only API compatibility layer. Only published, same-origin JSON is read.
 * @param {{base:string,fetchImpl?:typeof fetch,nearbyStations?:(id:string)=>unknown[],stationNote?:string}} options
 */
export function createStaticApi({base,fetchImpl=globalThis.fetch,nearbyStations=()=>[],stationNote=""}) {
  if (!/^\/[a-zA-Z0-9_/-]*\/$/.test(base) && base !== "/") throw new Error("Invalid public base.");
  const cache = new Map();
  let manifestPromise;
  function asset(path, manifest=false) {
    if (!(manifest ? path==="data/manifest.json" : /^data\/[a-z-]+\/[a-f0-9]{24}\.json$/.test(path)))
      return Promise.reject(new Error("Invalid published asset path."));
    if (cache.has(path)) return cache.get(path);
    const promise = Promise.resolve().then(async()=>{
      const response = await fetchImpl(base+path,{cache:manifest?"no-cache":"force-cache",signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error("Published dataset is unavailable.");
      return response.json();
    }).catch(error=>{cache.delete(path);throw error;});
    cache.set(path,promise);
    if (cache.size>100) cache.delete(cache.keys().next().value);
    return promise;
  }
  function metadata() {
    manifestPromise ??= asset("data/manifest.json",true).then(m=>{
      if (m.version!==1 || !Array.isArray(m.districts) || !m.coverage || !m.detailFiles || !m.tradeFiles || !m.summaryFiles)
        throw new Error("Unsupported published dataset.");
      return m;
    }).catch(error=>{manifestPromise=undefined;cache.delete("data/manifest.json");throw error;});
    return manifestPromise;
  }
  function cancellable(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason ?? new DOMException("Aborted","AbortError"));
      signal.addEventListener("abort",abort,{once:true});
      promise.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
    });
  }
  const reply=(body,status=200)=>Response.json(body,{status});
  const times=heads=>{
    const values=heads.map(h=>h.fetchedAt).sort();
    return {fetchedAt:values.at(-1)??null,oldestFetchedAt:values[0]??null};
  };
  async function handle(path,init) {
    if (init.method && init.method!=="GET") return reply({message:"정적 사이트는 조회만 지원합니다."},405);
    const url=new URL(path,"https://static.invalid");
    if (url.origin!=="https://static.invalid" || !url.pathname.startsWith("/api/")) return reply({message:"잘못된 조회 경로입니다."},400);
    const allowed=["/api/complexes","/api/trades","/api/area-summaries","/api/complex","/api/places","/api/map-config"];
    if (!allowed.includes(url.pathname)) return reply({message:"지원하지 않는 조회입니다."},404);
    const m=await metadata();
    const p=url.searchParams;
    if (url.pathname==="/api/map-config") return reply(await asset(m.mapConfig));
    if (url.pathname==="/api/complexes") {
      const result=await asset(m.catalog);
      let complexes=result.complexes;
      if (p.get("district")) complexes=complexes.filter(c=>c.district===p.get("district"));
      const offset=Math.max(0,Number.parseInt(p.get("offset")??"0")||0);
      const limit=Math.min(20000,Math.max(1,Number.parseInt(p.get("limit")??"20000")||20000));
      return reply({...result,total:complexes.length,complexes:complexes.slice(offset,offset+limit),updatedAt:m.generatedAt});
    }
    if (url.pathname==="/api/trades" || url.pathname==="/api/area-summaries") {
      const month=p.get("month")??"";
      if (!validRecordMonth(month,"sale")) return reply({message:"조회 월이 올바르지 않습니다."},400);
      if (url.pathname==="/api/area-summaries") {
        const latest=Object.keys(m.summaryFiles).filter(k=>k<=month).sort().at(-1);
        return reply({mode:"stored",summaries:latest?await asset(m.summaryFiles[latest]):{},
          message:"선택 월까지 수집된 매매 기준 · 미수집 기간의 거래는 포함되지 않습니다."});
      }
      const coverage=m.coverage[month]??{};
      const completedDistricts=m.districts.filter(d=>coverage[d]?.sale);
      const missingDistricts=m.districts.filter(d=>!coverage[d]?.sale);
      const trades=m.tradeFiles[month]?await asset(m.tradeFiles[month]):[];
      if (completedDistricts.length && !m.tradeFiles[month]) throw new Error("Missing published trade file.");
      return reply({mode:!completedDistricts.length?"unavailable":missingDistricts.length?"partial":"stored",
        trades,completedDistricts,missingDistricts,...times(completedDistricts.map(d=>coverage[d].sale)),
        message:!completedDistricts.length?"이 월의 실거래는 아직 수집하지 않았습니다. 거래 0건을 의미하지 않습니다.":
          "GitHub 저장 데이터 · "+completedDistricts.length+"/25개 구 수집 완료 · "+(missingDistricts.length?"나머지는 미수집":"조회 시점까지의 신고분")});
    }
    if (url.pathname==="/api/places") {
      const district=p.get("district")??"",dong=p.get("dong")??"",apartment=p.get("apartment")||null;
      if (!m.districts.includes(district) || !dong || dong.length>80 || (apartment?.length??0)>200)
        return reply({message:"위치 정보가 올바르지 않습니다."},400);
      const places=await asset(m.places);
      const selected=places[district+":"+dong]??{schools:[],schoolScope:"none",note:"등록된 학교 정보가 없습니다.",source:{name:"서울시교육청 파일 데이터",url:"https://www.data.go.kr/data/15152021/fileData.do",fetchedAt:null,dataYear:2025}};
      return reply({...selected,location:{district,dong,apartment,mapQuery:["서울특별시",district,dong,apartment].filter(Boolean).join(" ")}});
    }
    const id=p.get("complexId")??"",from=p.get("from")??"",to=p.get("to")??"";
    if (![from,to].every(v=>validRecordMonth(v,"sale")) || from>to || monthOrdinal(to)-monthOrdinal(from)>=12)
      return reply({message:"최대 12개월 단위의 올바른 기간을 선택하세요."},400);
    const catalog=await asset(m.catalog);
    const c=catalog.complexes.find(c=>c.id===id);
    if (!c) return reply({message:"등록된 단지를 찾을 수 없습니다."},404);
    const rows=m.detailFiles[id]?await asset(m.detailFiles[id]):[];
    const transactions=rows.filter(r=>{const month=r.date.replaceAll("-","").slice(0,6);return month>=from&&month<=to;});
    const missing=[],heads=[];
    for (const month of monthsInRange(from,to)) {
      for (const kind of month>="201101"?["sale","rent"]:["sale"]) {
        const head=m.coverage[month]?.[c.district]?.[kind];
        if (head) heads.push(head); else missing.push({month,kind});
      }
    }
    return reply({mode:!heads.length?"unavailable":missing.length?"partial":"stored",
      complex:{district:c.district,dong:c.dong,apartment:c.name,buildYear:c.buildYear},transactions,
      nearbyStations:nearbyStations(c.id),nearbyStationsNote:stationNote,missing,...times(heads),
      message:missing.length?"미수집 기간이 있습니다. 비어 있는 기간은 거래 0건을 뜻하지 않습니다.":
        "GitHub Actions 수집 시점까지 신고된 실거래입니다. 이후 신고·해제·정정은 다음 수집에 반영됩니다."});
  }
  return async (path,init={})=>{
    try { init.signal?.throwIfAborted(); return await cancellable(handle(path,init),init.signal); }
    catch (error) {
      if (init.signal?.aborted) throw init.signal.reason ?? error;
      return reply({message:"저장 데이터 파일을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요."},503);
    }
  };
}
