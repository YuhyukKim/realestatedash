import {spawnSync} from 'node:child_process';
const raw=process.env.MOLIT_API_KEY||'';let key=raw.trim();try{key=decodeURIComponent(key);}catch{}
console.log(JSON.stringify({probe:'configuration',keyPresent:!!key,keyHasWhitespace:raw!==raw.trim()}));
if(!key)process.exit(1);
const fields=['bldNm','dongNm','hoNm','platPlc','exposPubuseGbCdNm','mainPurpsCdNm','etcPurps','area','flrGbCdNm','flrNoNm','stdDay','hsprc'];
async function probe(endpoint,size,transport,pnu='1147010200109040000'){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 for(const [k,v] of Object.entries({serviceKey:key,sigunguCd:pnu.slice(0,5),bjdongCd:pnu.slice(5,10),platGbCd:'0',bun:pnu.slice(11,15),ji:pnu.slice(15),...(endpoint==='getBrHsprcInfo'?{startDate:'20260101',endDate:'20261231'}:{}),numOfRows:size,pageNo:1,_type:'json'}))url.searchParams.set(k,String(v));
 const start=Date.now();
 try{
  let text,status;
  if(transport==='curl'){
   const c=spawnSync('curl',['--ipv4','--silent','--max-time','20','--config','-','--write-out','\n%{http_code}'],{input:'url = '+JSON.stringify(url.toString())+'\n',encoding:'utf8',maxBuffer:5000000});
   if(c.status!==0){console.log(JSON.stringify({probe:endpoint,size,transport,ms:Date.now()-start,curlExit:c.status}));return;}
   const split=c.stdout.lastIndexOf('\n');text=c.stdout.slice(0,split);status=Number(c.stdout.slice(split+1));
  }else{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});status=r.status;text=await r.text();}
  let b;try{b=JSON.parse(text);}catch{}
  const h=b?.response?.header||b?.OpenAPI_ServiceResponse?.cmmMsgHeader,body=b?.response?.body,rawRows=body?.items?.item,rows=Array.isArray(rawRows)?rawRows:rawRows?[rawRows]:[];
  console.log(JSON.stringify({probe:endpoint,size,transport,ms:Date.now()-start,http:status,code:String(h?.resultCode??h?.returnReasonCode??''),total:body?.totalCount,json:!!b,sample:rows.slice(0,8).map(r=>Object.fromEntries(fields.filter(k=>r[k]!=null).map(k=>[k,r[k]])))}));
 }catch(e){console.log(JSON.stringify({probe:endpoint,size,transport,ms:Date.now()-start,error:e.name}));}
}
 if(process.argv.includes('--prices')){
 for(const [endpoint,pnu] of [['getBrHsprcInfo','1147010100103290000'],['getBrHsprcInfo','1147010100103120000'],['getBrTitleInfo','1147010100103250000']]){
  await probe(endpoint,1,'fetch',pnu);await new Promise(resolve=>setTimeout(resolve,2500));
 }
 const vk=(process.env.VWORLD_API_KEY||'').trim(),url=new URL('https://api.vworld.kr/ned/data/getApartHousingPriceAttr');
 for(const [k,v] of Object.entries({key:vk,domain:process.env.VWORLD_DOMAIN||'https://seoul-redevelopment-map-yuhyu.whisky88.chatgpt.site',pnu:'1147010100103290000',stdrYear:'2026',format:'json',numOfRows:1,pageNo:1}))url.searchParams.set(k,String(v));
 try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});let b;try{b=await r.json();}catch{}const p=b?.apartHousingPrices;console.log(JSON.stringify({probe:'vworld-prices',keyPresent:!!vk,http:r.status,keys:b?Object.keys(b):null,code:p?.resultCode||b?.response?.error?.code||b?.error?.code,total:p?.totalCount,sample:(Array.isArray(p?.field)?p.field:[]).slice(0,1).map(x=>({pnu:x.pnu,name:x.aphusNm,dong:x.dongNm,ho:x.hoNm,price:x.pblntfPc}))}));}catch(e){console.log(JSON.stringify({probe:'vworld-prices',error:e.name,cause:e.cause?.code}));}
}else for(const [endpoint,size,transport] of [['getBrTitleInfo',10,'fetch'],['getBrTitleInfo',10,'curl'],['getBrExposPubuseAreaInfo',20,'fetch']])await probe(endpoint,size,transport);
