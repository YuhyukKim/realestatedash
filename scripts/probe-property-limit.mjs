const key=decodeURIComponent((process.env.MOLIT_API_KEY||'').trim());
if(!key)throw Error('MOLIT_API_KEY is not configured');
for(const endpoint of ['getBrTitleInfo','getBrHsprcInfo']){
 const url=new URL('https://apis.data.go.kr/1613000/BldRgstHubService/'+endpoint);
 for(const [k,v] of Object.entries({serviceKey:key,sigunguCd:'11470',bjdongCd:'10100',platGbCd:0,bun:'0312',ji:'0000',_type:'json',numOfRows:1,pageNo:1}))url.searchParams.set(k,String(v));
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)}),body=await response.text();let parsed;try{parsed=JSON.parse(body);}catch{}
  const code=parsed?.response?.header?.resultCode||body.match(/<(?:returnReasonCode|resultCode)>([^<]+)/)?.[1];
  const message=parsed?.response?.header?.resultMsg||body.match(/<(?:returnAuthMsg|errMsg|resultMsg)>([^<]+)/)?.[1];
  const safeMessage=String(message||'').replaceAll(key,'[redacted]').replaceAll(encodeURIComponent(key),'[redacted]').replaceAll(process.env.MOLIT_API_KEY,'[redacted]').slice(0,200);
  console.log(JSON.stringify({probe:'current-property-access',endpoint,http:response.status,code,message:safeMessage,retryAfter:response.headers.get('retry-after'),date:response.headers.get('date'),contentType:response.headers.get('content-type'),bodyBytes:body.length,quotaText:/quota|rate.?limit|exceed|LIMITED_NUMBER|제한|한도/i.test(body)}));
 }catch(e){console.log(JSON.stringify({probe:'current-property-access',endpoint,error:e.name,causeCode:e.cause?.code}));}
 await new Promise(resolve=>setTimeout(resolve,1500));
}
