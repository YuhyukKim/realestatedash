"""Stream official HUB ZIPs and retain only reviewed map parcels/public columns.

Usage: python scripts/filter-official-property-bulk.py ARCHIVE_DIRECTORY titles|expos|areas|prices [YYYYMM]
No full extraction, credentials, owner fields, or API requests are involved.
"""
import calendar,hashlib,io,json,sys,time,zipfile
from pathlib import Path
root=Path(sys.argv[1]);kind=sys.argv[2];period=sys.argv[3] if len(sys.argv)>3 else '202608'
year,month=int(period[:4]),int(period[4:]);source_as_of=f'{year:04}-{month:02}-{calendar.monthrange(year,month)[1]:02}'
tasks={'titles':'03','expos':'09','areas':'06','prices':'08'}
if kind not in tasks:raise ValueError('Unknown bulk dataset')
catalog=json.loads(Path('data/parcel-candidates.json').read_text(encoding='utf8'))
parcels={c['pnu'] for c in catalog if c.get('pnu')}
parcels.update(p['pnu'] for c in catalog for p in c.get('registerCandidates',[]))
targets={p.encode() for p in parcels};schema=json.loads((root/('schema-'+kind+'.json')).read_text(encoding='utf8'))
columns={r['name']:r['position']-1 for r in schema}
mapping={'mgmBldrgstPk':'관리_건축물대장_PK','bldNm':'건물_명','platPlc':'대지_위치','newPlatPlc':'도로명_대지_위치','dongNm':'동_명','crtnDay':'생성_일자'}
if kind=='prices':mapping={'mgmBldrgstPk':'관리_건축물대장_PK','stdDay':'기준_일자','hsprc':'주택가격','crtnDay':'생성_일자'}
elif kind=='titles':mapping.update({'mainAtchGbCd':'주_부속_구분_코드','mainPurpsCdNm':'주_용도_코드_명','etcPurps':'기타_용도','strctCdNm':'구조_코드_명','useAprDay':'사용승인_일','grndFlrCnt':'지상_층_수','ugrndFlrCnt':'지하_층_수','hhldCnt':'세대_수(세대)','bcRat':'건폐_율(%)','vlRat':'용적_률(%)'})
else:mapping.update({'hoNm':'호_명','flrNo':'층_번호','flrGbCdNm':'층_구분_코드_명'})
if kind=='areas':mapping.update({'flrNoNm':'층_번호_명','exposPubuseGbCdNm':'전유_공용_구분_코드_명','mainPurpsCdNm':'주_용도_코드_명','etcPurps':'기타_용도','area':'면적(㎡)'})
mapping={key:columns[name] for key,name in mapping.items()}
assert [columns[n] for n in ['시군구_코드','법정동_코드','대지_구분_코드','번','지']]==[8,9,10,11,12]
output=root/(kind+'-by-parcel');output.mkdir(exist_ok=True);handles={};counts={};scanned=matched=0;started=last=time.time()
manifest_path=root/(kind+'-manifest.json')
# Never leave the previous successful manifest attached to files being rewritten.
manifest_path.write_text(json.dumps({'complete':False,'kind':kind,'sourceAsOf':source_as_of}),encoding='utf8')
archive=root/('hub-'+kind+'-'+period+'.zip');seoul='서울특별시'.encode()
with zipfile.ZipFile(archive) as z:
 infos=[i for i in z.infolist() if i.filename.endswith('.txt')]
 assert len(infos)==1 and infos[0].filename=='mart_djy_'+tasks[kind]+'.txt'
 with io.BufferedReader(z.open(infos[0]),8*1024*1024) as lines:
  for line in lines:
   scanned+=1
   if seoul not in line:continue
   parts=line.rstrip(b'\r\n').split(b'|')
   if len(parts)!=len(columns):raise ValueError('Unexpected official '+kind+' column count '+str(len(parts)))
   pnu=parts[8]+parts[9]+(b'1' if parts[10]==b'0' else b'2' if parts[10]==b'1' else b'?')+parts[11].zfill(4)+parts[12].zfill(4)
   if pnu not in targets:continue
   if kind=='prices' and parts[columns['기준_일자']][:4] not in [str(y).encode() for y in range(year-4,year+1)]:continue
   fields={key:parts[i].decode('utf8') for key,i in mapping.items()};key=pnu.decode();f=handles.get(key)
   if f is None:f=handles[key]=(output/(key+'.jsonl')).open('w',encoding='utf8')
   f.write(json.dumps(fields,ensure_ascii=False,separators=(',',':'))+'\n');matched+=1;counts[key]=counts.get(key,0)+1
   if time.time()-last>30:
    print(json.dumps({'kind':kind,'scanned':scanned,'matched':matched,'parcels':len(counts),'elapsedSeconds':round(time.time()-started)}),flush=True);last=time.time()
for f in handles.values():f.close()
with archive.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
manifest={'complete':True,'kind':kind,'archive':archive.name,'sha256':digest,'sourceAsOf':source_as_of,'sourceUrl':'https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do','scanned':scanned,'matched':matched,'parcels':counts,'targetParcels':sorted(parcels)}
if kind=='prices':manifest['years']=[str(y) for y in range(year-4,year+1)]
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'complete':True,'kind':kind,'scanned':scanned,'matched':matched,'parcels':len(counts),'sha256':digest,'elapsedSeconds':round(time.time()-started)}),flush=True)
