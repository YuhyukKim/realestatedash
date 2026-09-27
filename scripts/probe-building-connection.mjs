import {spawnSync} from 'node:child_process';
const raw=process.env.MOLIT_API_KEY||'';let key=raw.trim();try{key=decodeURIComponent(key);}catch{}
console.log(JSON.stringify({probe:'configuration',keyPresent:!!key,keyHasWhitespace:raw!==raw.trim()}));
if(!key)process.exit(1);
const fields=['bldNm','dongNm','hoNm','platPlc','exposPubuseGbCdNm','mainPurpsCdNm','etcPurps','area','flrGbCdNm','flrNoNm'];
async function probe(endpoint,size,transport){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 for(const [k,v] of Object.entries({serviceKey:key,sigunguCd:'11470',bjdongCd:'10200',platGbCd:'0',bun:'0904',ji:'0000',numOfRows:size,pageNo:1,_type:'json'}))url.searchParams.set(k,String(v));
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
for(const [endpoint,size,transport] of [['getBrTitleInfo',10,'fetch'],['getBrTitleInfo',10,'curl'],['getBrExposPubuseAreaInfo',20,'fetch']])await probe(endpoint,size,transport);
