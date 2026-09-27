import {spawnSync} from 'node:child_process';
const snapshot=await(await fetch('https://raw.githubusercontent.com/YuhyukKim/realestatedash/main/data/property/377.json')).json();
const expected=new Map(Object.values(snapshot.building.records).map(unit=>[unit.registerId,snapshot.prices.records[unit.dong+'|'+unit.ho]?.rows.find(r=>r.year==='2026')?.price]));
for(const endpoint of ['getBrExposPubuseAreaInfo','getBrHsprcInfo']){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 for(const [k,v] of Object.entries({serviceKey:decodeURIComponent(process.env.MOLIT_API_KEY||''),sigunguCd:'11470',bjdongCd:'10200',platGbCd:'0',bun:'0904',ji:'0000',numOfRows:10000,pageNo:1,_type:'json',...(endpoint==='getBrHsprcInfo'?{startDate:'20260101',endDate:'20261231'}:{})}))url.searchParams.set(k,v);
 const started=Date.now(),r=spawnSync('curl',['--ipv4','--silent','--max-time','60','--config','-'],{input:'url = '+JSON.stringify(String(url))+'\n',encoding:'utf8',maxBuffer:30000000});
 let b;try{b=JSON.parse(r.stdout)}catch{}
 const response=b?.response,items=response?.body?.items?.item,rows=Array.isArray(items)?items:items?[items]:[];
 console.log(JSON.stringify({endpoint,ms:Date.now()-started,curlExit:r.status,code:response?.header?.resultCode,total:response?.body?.totalCount,numOfRows:response?.body?.numOfRows,returned:rows.length,years:[...new Set(rows.map(r=>String(r.stdDay||'').slice(0,4)))],mapped:rows.filter(r=>expected.has(String(r.mgmBldrgstPk))).length,matches2026:rows.filter(r=>String(r.stdDay)==='20260101'&&Number(r.hsprc)===expected.get(String(r.mgmBldrgstPk))).length}));
}
