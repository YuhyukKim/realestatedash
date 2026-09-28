import fs from 'node:fs';
const key=decodeURIComponent((process.env.MOLIT_API_KEY||'').trim());if(!key)throw Error('Missing key');
const catalog=JSON.parse(fs.readFileSync('data/parcel-candidates.json','utf8'));
for(const id of [366,667,1320]){
 const candidate=catalog.find(c=>c.id===id),pnu=candidate.registerCandidates?.[0]?.pnu||candidate.pnu;
 for(const endpoint of ['getBrAtchJibunInfo','getBrTitleInfo']){
  const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
  const params={serviceKey:key,sigunguCd:pnu.slice(0,5),bjdongCd:pnu.slice(5,10),platGbCd:String(Number(pnu[10])-1),bun:pnu.slice(11,15),_type:'json',numOfRows:'100',pageNo:'1'};
  if(endpoint==='getBrAtchJibunInfo')params.ji=pnu.slice(15);
  url.search=new URLSearchParams(params);
  try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)}),d=await r.json(),body=d.response?.body,item=body?.items?.item,rows=Array.isArray(item)?item:item?[item]:[];
   console.log(JSON.stringify({probe:'related-parcels',id,endpoint,http:r.status,code:d.response?.header?.resultCode,total:body?.totalCount,rows:rows.map(x=>endpoint==='getBrTitleInfo'?{name:x.bldNm,dong:x.dongNm,bun:x.bun,ji:x.ji,purpose:x.mainPurpsCdNm}:{name:x.bldNm,bun:x.bun,ji:x.ji,attached:[x.atchSigunguCd,x.atchBjdongCd,x.atchPlatGbCd,x.atchBun,x.atchJi]})}));
  }catch(e){console.log(JSON.stringify({probe:'related-parcels',id,endpoint,error:e.name,causeCode:e.cause?.code}));}
  await new Promise(r=>setTimeout(r,2000));
 }
}

