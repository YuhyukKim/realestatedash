import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateSnapshot,DISTRICTS,scopeFile} from '../lib/pages-snapshots.mjs';
export async function historyIndex(root='data/scopes'){
 const scopes=[];
 for(const district of await readdir(root,{withFileTypes:true})){
  if(!district.isDirectory()||!/^11\d{3}$/.test(district.name))continue;
  for(const file of await readdir(join(root,district.name))){
   if(!/^\d{6}\.(sale|rent)\.json$/.test(file))continue;
   const s=validateSnapshot(JSON.parse(await readFile(join(root,district.name,file),'utf8')));
   if(scopeFile(s)!==district.name+'/'+file)throw Error('Invalid snapshot path');
   scopes.push({region:DISTRICTS[s.district],month:s.month,kind:s.kind,fetchedAt:s.fetchedAt,count:s.records.length});
  }
 }
 return {version:1,scopes:scopes.sort((a,b)=>(a.region+a.month+a.kind).localeCompare(b.region+b.month+b.kind))};
}
export async function saveHistoryIndex(){const index=await historyIndex();await writeFile('data/map-history-index.json',JSON.stringify(index)+'\n');return index;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)saveHistoryIndex().then(i=>console.log('Indexed '+i.scopes.length+' verified scopes')).catch(()=>{console.error('History index validation failed');process.exitCode=1;});
