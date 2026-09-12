import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchMolitXml, tag, isCanceledSale } from "../lib/molit-client.mjs";
import { parseFeed } from "../lib/molit-records.mjs";
import { staticOptions, validateSnapshot, scopeFile, DISTRICTS, ENDPOINTS } from "../lib/pages-snapshots.mjs";
export async function collectSnapshots(config, fetchXml = fetchMolitXml) {
  const snapshots = [];
  for (const scope of config.scopes) {
    const fetchedAt = new Date().toISOString();
    const xml = await fetchXml(ENDPOINTS[scope.kind],DISTRICTS[scope.district],scope.month,config.serviceKey,AbortSignal.timeout(180000));
    const records = parseFeed(xml,scope.month,scope.kind,tag,isCanceledSale);
    snapshots.push(validateSnapshot({version:1,...scope,fetchedAt,expectedCount:records.length,records}));
    console.log(scope.district+" "+scope.month+" "+scope.kind+": "+records.length+" validated records");
  }
  return snapshots; // No file replacement until EVERY requested scope succeeded.
}
export async function persistSnapshots(snapshots, root = "data/scopes") {
  const planned = [];
  for (const raw of snapshots) {
    const s = validateSnapshot(raw);
    const path = join(root,scopeFile(s));
    let previous;
    try { previous = validateSnapshot(JSON.parse(await readFile(path,"utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && previous.fetchedAt > s.fetchedAt) throw new Error("Refusing to replace a newer snapshot.");
    // A previously nonempty response suddenly becoming empty deserves review.
    // Keep the old public snapshot; do not silently wipe an entire feed.
    if (previous?.records.length && !s.records.length) throw new Error("Nonempty scope became empty; review upstream data before replacing.");
    planned.push({path,s});
  }
  for (const {path,s} of planned) {
    await mkdir(join(root,DISTRICTS[s.district]),{recursive:true});
    await writeFile(path+".tmp",JSON.stringify(s)+"\n",{mode:0o600});
    await rename(path+".tmp",path);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await persistSnapshots(await collectSnapshots(staticOptions(process.env))); }
  catch { console.error("Collection failed. No snapshot commit or deployment was made. Check API approval, quota, input range and previous successful scopes."); process.exitCode=1; }
}
