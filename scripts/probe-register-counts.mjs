import fs from 'node:fs';
const key=decodeURIComponent((process.env.MOLIT_API_KEY||'').trim());
if(!key)throw Error('Missing key');
const candidates=JSON.parse(fs.readFileSync('data/parcel-candidates.json','utf8'));
const candidate=candidates.find(c=>c.id===457),pnu=candidate.registerCandidates?.[0]?.pnu||candidate.pnu;
for(const [endpoint,dates] of [['getBrExposPubuseAreaInfo',{}],['getBrHsprcInfo',{startDate:'20250101',endDate:'20261231'}],['getBrHsprcInfo',{}]]){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 url.search=new URLSearchParams({serviceKey:key,sigunguCd:pnu.slice(0,5),bjdongCd:pnu.slice(5,10),platGbCd:String(Number(pnu[10])-1),bun:pnu.slice(11,15),ji:pnu.slice(15),...dates,numOfRows:'1',pageNo:'1',_type:'json'});
 try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)}),d=await r.json();console.log(JSON.stringify({probe:'record-count',projectId:457,endpoint,recentWindow:!!dates.startDate,http:r.status,code:d.response?.header?.resultCode,total:d.response?.body?.totalCount,pageSize:d.response?.body?.numOfRows}));}
 catch(e){console.log(JSON.stringify({probe:'record-count',endpoint,error:e.name}));}
 await new Promise(r=>setTimeout(r,2000));
}
