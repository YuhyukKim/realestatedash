// Uses the existing repository secret only inside GitHub Actions. Public records only are saved.
import {spawnSync} from 'node:child_process';
import {staticOptions,DISTRICTS,monthOrdinal,monthString} from '../lib/pages-snapshots.mjs';
import {collectSnapshots,persistSnapshots,collectionFailureCode} from './collect-pages.mjs';
import {saveHistoryIndex} from './map-history-index.mjs';
function git(args){const r=spawnSync('git',args,{stdio:'ignore'});if(r.status!==0)throw Error('CHECKPOINT_GIT_FAILED');}
const env=process.env,district=env.MOLIT_DISTRICT||'양천구',current=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format().replace('-','');
let changed=0,completed=0,errors=0;
async function checkpoint(){await saveHistoryIndex();if(env.GITHUB_ACTIONS==='true'){git(['add','--','data/scopes/'+DISTRICTS[district],'data/map-history-index.json']);const diff=spawnSync('git',['diff','--cached','--quiet']);if(diff.status===1){git(['commit','-m','data: refresh redevelopment map transaction history']);git(['push','origin','HEAD:main']);}else if(diff.status!==0)throw Error('CHECKPOINT_GIT_FAILED');}changed=0;}
try{
 const from=env.MOLIT_FROM||'200601',to=env.MOLIT_TO||current;
 if(!Object.hasOwn(DISTRICTS,district)||!/^(20\d{2})(0[1-9]|1[0-2])$/.test(from)||!/^(20\d{2})(0[1-9]|1[0-2])$/.test(to)||from<'200601'||to>current||from>to||monthOrdinal(to)-monthOrdinal(from)>=264)throw Error('INVALID_SCOPE');
 if(!env.MOLIT_API_KEY?.trim())throw Error('MOLIT_API_KEY is missing.');
 const old=await saveHistoryIndex(),existing=new Map(old.scopes.map(s=>[s.region+':'+s.kind+':'+s.month,s])),cutoff=monthString(monthOrdinal(current)-6),deadline=Date.now()+80*60000;
 for(let n=monthOrdinal(to);n>=monthOrdinal(from);n--){
  const month=monthString(n),options=staticOptions({...env,MOLIT_DISTRICTS:district,MOLIT_FROM:month,MOLIT_TO:month,MOLIT_KIND:'both'});
  for(const scope of options.scopes){
   const previous=existing.get(DISTRICTS[district]+':'+scope.kind+':'+month),ttl=(month>=cutoff?1:90)*86400000;
   if(previous&&Date.now()-Date.parse(previous.fetchedAt)<ttl)continue;
   if(Date.now()>deadline)throw Error('TIME_LIMIT_RESUME_REQUIRED');
   try{await persistSnapshots(await collectSnapshots({...options,scopes:[scope]}));}
   catch(error){errors++;console.error('Collection failed ['+collectionFailureCode(error)+'] '+district+' '+month+' '+scope.kind);throw Error('UPSTREAM_COLLECTION_FAILED');}
   completed++;changed++;if(changed>=24||completed===2)await checkpoint();
  }
 }
 await checkpoint();console.log(JSON.stringify({completed,status:'complete',district,from,to}));
}catch(error){if(changed){try{await checkpoint();}catch{console.error('CHECKPOINT_FAILED');}}console.error('Backfill stopped; completed scopes are preserved. '+(['INVALID_SCOPE','CHECKPOINT_GIT_FAILED','TIME_LIMIT_RESUME_REQUIRED'].includes(error.message)?error.message:errors?'UPSTREAM_COLLECTION_FAILED':'CONFIGURATION_OR_DATA_ERROR'));process.exitCode=1;}
