import {spawnSync} from 'node:child_process';
// Log only public schema and explicitly selected building/price fields, never URLs or keys.
const safeFields=['pnu','aphusNm','dongNm','hoNm','stdrYear','stdrMt','prvuseAr','pblntfPc','lastUpdtDt','bldNm','platPlc','newPlatPlc','hhldCnt','mainPurpsCdNm','mgmBldrgstPk','regstrKindCd','stdDay','hsprc'];
const clean=r=>Object.fromEntries(safeFields.filter(k=>r?.[k]!=null).map(k=>[k,r[k]]));
async function probe(endpoint,params){
 const url=new URL(endpoint);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 for(let attempt=1;attempt<=2;attempt++)try{const curl=spawnSync('curl',['--ipv4','--silent','--show-error','--max-time','40','--config','-','--write-out','\n%{http_code}'],{input:'url = '+JSON.stringify(url.toString())+'\nreferer = '+JSON.stringify(params.domain||'https://www.data.go.kr/')+'\n',encoding:'utf8',maxBuffer:5000000});if(curl.status!==0){const message=(curl.stderr||'').replaceAll(process.env.VWORLD_API_KEY||'__missing__','[redacted]').replaceAll(process.env.MOLIT_API_KEY||'__missing__','[redacted]').slice(0,200);console.log(JSON.stringify({endpoint:url.pathname,attempt,curlExit:curl.status,message}));continue;}const split=curl.stdout.lastIndexOf('\n'),text=curl.stdout.slice(0,split),status=Number(curl.stdout.slice(split+1)),r={status,ok:status>=200&&status<300};let b;try{b=JSON.parse(text);}catch{}
 const section=b?.apartHousingPrices,items=section?.field;
 const building=b?.response?.body?.items?.item;
 const rows=items?(Array.isArray(items)?items:[items]):building?(Array.isArray(building)?building:[building]):[];
 console.log(JSON.stringify({endpoint:url.pathname,attempt,year:params.stdrYear,http:r.status,topKeys:b?Object.keys(b):[],sectionKeys:section?Object.keys(section):[],code:section?.resultCode||b?.response?.header?.resultCode||b?.response?.error?.code||b?.error?.code,total:section?.totalCount||b?.response?.body?.totalCount,fields:Object.keys(rows[0]||{}),sample:rows.slice(0,20).map(clean),error:text.match(/(?:INCORRECT_KEY|INVALID_KEY|NOT_AUTHORIZED|SERVICE_ACCESS_DENIED|INVALID_DOMAIN|PERMISSION_DENIED)/)?.[0],json:!!b}));
 if(r.ok&&b)return;
 }catch(e){console.log(JSON.stringify({endpoint:url.pathname,attempt,year:params.stdrYear,status:'network_error',errorName:e.name,causeCode:e.cause?.code}));}
}
const domain=process.env.VWORLD_DOMAIN;
const vkey=process.env.VWORLD_API_KEY||'';
console.log(JSON.stringify({endpoint:'configuration',keyPresent:!!vkey,keyShapeValid:/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(vkey.trim()),keyHasWhitespace:vkey!==vkey.trim(),domain}));
for(const domainVariant of [domain,domain.replace(/\/$/,'')+'/'])await probe('https://api.vworld.kr/ned/data/getApartHousingPriceAttr',{pnu:'1147010200109040000',stdrYear:'2026',key:vkey.trim(),domain:domainVariant,format:'json',numOfRows:3,pageNo:1});
