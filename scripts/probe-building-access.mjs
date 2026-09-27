// Keys stay in Actions; only public field names/counts and service status are logged.
const key=decodeURIComponent(process.env.MOLIT_API_KEY||'');
for(const endpoint of ['getBrTitleInfo','getBrExposInfo','getBrExposPubuseAreaInfo','getBrHsprcInfo','getBrJijiguInfo']){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 for(const [k,v] of Object.entries({serviceKey:key,sigunguCd:'11470',bjdongCd:'10200',platGbCd:'0',bun:'0904',ji:'0000',numOfRows:'1',pageNo:'1',_type:'json'}))url.searchParams.set(k,v);
 try{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});const text=await r.text();let b;try{b=JSON.parse(text)}catch{}
 const result=b?.response;const item=result?.body?.items?.item;
 console.log(JSON.stringify({endpoint,http:r.status,code:result?.header?.resultCode,message:result?.header?.resultMsg,total:result?.body?.totalCount,fields:Object.keys(Array.isArray(item)?item[0]||{}:item||{}),error:b?undefined:text.match(/(?:SERVICE_[A-Z_]+|PERMISSION_DENIED|LIMITED_[A-Z_]+)/)?.[0]||'non_json'}));
 }catch{console.log(JSON.stringify({endpoint,status:'network_error'}));}
}
