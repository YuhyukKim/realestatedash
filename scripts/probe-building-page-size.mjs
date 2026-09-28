const key=decodeURIComponent((process.env.MOLIT_API_KEY||'').trim());
if(!key)throw Error('Missing key');
for(const size of [10,100,1000,10000]){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposInfo');
 url.search=new URLSearchParams({serviceKey:key,sigunguCd:'11470',bjdongCd:'10200',platGbCd:'0',bun:'0904',ji:'0000',numOfRows:String(size),pageNo:'1',_type:'json'});
 try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)}),data=await response.json(),body=data.response?.body,item=body?.items?.item;
 console.log(JSON.stringify({probe:'page-size',requested:size,http:response.status,code:data.response?.header?.resultCode,reported:body?.numOfRows,returned:Array.isArray(item)?item.length:item?1:0,total:body?.totalCount}));}
 catch(e){console.log(JSON.stringify({probe:'page-size',requested:size,error:e.name}));}
 await new Promise(r=>setTimeout(r,2000));
}
