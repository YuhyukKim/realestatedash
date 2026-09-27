// Log only public schema and explicitly selected building/price fields, never URLs or keys.
const safeFields=['pnu','aphusNm','dongNm','hoNm','stdrYear','stdrMt','prvuseAr','pblntfPc','lastUpdtDt','bldNm','platPlc','newPlatPlc','hhldCnt','mainPurpsCdNm','mgmBldrgstPk','regstrKindCd','stdDay','hsprc'];
const clean=r=>Object.fromEntries(safeFields.filter(k=>r?.[k]!=null).map(k=>[k,r[k]]));
async function probe(endpoint,params){
 const url=new URL(endpoint);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 for(let attempt=1;attempt<=2;attempt++)try{const r=await fetch(url,{signal:AbortSignal.timeout(45000)});const text=await r.text();let b;try{b=JSON.parse(text);}catch{}
 const section=b?.apartHousingPrices,items=section?.field;
 const building=b?.response?.body?.items?.item;
 const rows=items?(Array.isArray(items)?items:[items]):building?(Array.isArray(building)?building:[building]):[];
 console.log(JSON.stringify({endpoint:url.pathname,attempt,year:params.stdrYear,http:r.status,topKeys:b?Object.keys(b):[],sectionKeys:section?Object.keys(section):[],code:section?.resultCode||b?.response?.header?.resultCode||b?.response?.error?.code||b?.error?.code,total:section?.totalCount||b?.response?.body?.totalCount,fields:Object.keys(rows[0]||{}),sample:rows.slice(0,20).map(clean),error:text.match(/(?:INCORRECT_KEY|INVALID_KEY|NOT_AUTHORIZED|SERVICE_ACCESS_DENIED|INVALID_DOMAIN|PERMISSION_DENIED)/)?.[0],json:!!b}));
 if(r.ok&&b)return;
 }catch(e){console.log(JSON.stringify({endpoint:url.pathname,attempt,year:params.stdrYear,status:'network_error',errorName:e.name,causeCode:e.cause?.code}));}
}
const domain=process.env.VWORLD_DOMAIN;
for(const year of ['2026'])await probe('https://api.vworld.kr/ned/data/getApartHousingPriceAttr',{pnu:'1147010200109040000',stdrYear:year,key:process.env.VWORLD_API_KEY,domain,format:'json',numOfRows:3,pageNo:1});
for(const ep of ['getBrTitleInfo','getBrExposInfo','getBrHsprcInfo'])await probe('https://apis.data.go.kr/1613000/BldRgstHubService/'+ep,{serviceKey:decodeURIComponent(process.env.MOLIT_API_KEY||''),sigunguCd:'11470',bjdongCd:'10200',platGbCd:'0',bun:'0904',ji:'0000',numOfRows:3,pageNo:1,_type:'json'});
