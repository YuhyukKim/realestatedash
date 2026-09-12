import { getComplexSeed, COMPLEX_SEED_VERSION } from "./seed";
// Bump matcher suffix when canonical matching rules change.
const TRADE_MAPPING_VERSION = COMPLEX_SEED_VERSION + ":matcher-v1";
import { listComplexesFromSeed } from "./complexes";
import { createMasterTradeMatcher } from "../app/master-trade-matcher";
import { sanitizeRecord, CHUNK_SIZE, MAX_IMPORT_RECORDS } from "../lib/molit-records.mjs";
import type { Trade } from "../app/data";
import type { ComplexTransaction } from "../app/complex-types";

const matchTrade = createMasterTradeMatcher(listComplexesFromSeed(getComplexSeed(), { limit: 20000, offset: 0 }).complexes);
type Feed = "sale" | "rent";
type Observation = ReturnType<typeof sanitizeRecord>;
export type ImportRun = { id: string; district: string; month: string; kind: Feed; expected_count: number; fetched_at: string; created_at: string; committed: number; abandoned: number; mapping_version: string };
export type SnapshotHead = { district: string; month: string; kind: Feed; run_id: string; fetched_at: string; record_count: number };
type StoredRow = { run_id: string; ordinal: number; district: string; payload: string; complex_id: string | null };
export class ImportError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
async function runById(db: D1Database, id: string) {
  const run = await db.prepare("SELECT * FROM trade_import_runs WHERE id = ?").bind(id).first<ImportRun>();
  if (!run) throw new ImportError("수집 작업이 없습니다.", 404);
  return run;
}
export async function startImport(db: D1Database, input: { id: string; district: string; month: string; kind: Feed; expectedCount: number; fetchedAt: string }) {
  if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 0 || input.expectedCount > MAX_IMPORT_RECORDS) throw new ImportError("수집 건수 범위 오류", 400);
  await db.prepare("INSERT OR IGNORE INTO trade_import_runs (id, district, month, kind, expected_count, fetched_at, created_at, mapping_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(input.id, input.district, input.month, input.kind, input.expectedCount, input.fetchedAt, new Date().toISOString(), TRADE_MAPPING_VERSION).run();
  const run = await runById(db, input.id);
  if (run.abandoned) throw new ImportError("정리 중인 작업입니다. 새 수집 작업을 시작해 주세요.");
  if (run.district !== input.district || run.month !== input.month || run.kind !== input.kind ||
      run.expected_count !== input.expectedCount || run.fetched_at !== input.fetchedAt || run.mapping_version !== TRADE_MAPPING_VERSION) {
    throw new ImportError("기존 작업과 메타데이터가 다릅니다.");
  }
  return run;
}
export async function appendImport(db: D1Database, id: string, offset: number, input: unknown[]) {
  const run = await runById(db, id);
  if (run.abandoned) throw new ImportError("정리 중인 작업입니다. 새 수집 작업을 시작해 주세요.");
  if (!Array.isArray(input) || !input.length || input.length > CHUNK_SIZE || !Number.isSafeInteger(offset) ||
      offset < 0 || offset + input.length > run.expected_count) throw new ImportError("수집 청크 범위 오류", 400);
  let records: Observation[];
  try { records = input.map(row => sanitizeRecord(row, run.month, run.kind)); }
  catch { throw new ImportError("잘못된 거래 자료입니다. 기존 자료를 유지합니다.", 400); }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(records)));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const existing = await db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(batch_hash = ?), 0) AS identical, COALESCE(SUM(complex_id IS NULL), 0) AS unmatched FROM trade_import_rows WHERE run_id = ? AND ordinal >= ? AND ordinal < ?")
    .bind(hash, id, offset, offset + records.length).first<{ count: number; identical: number; unmatched: number }>();
  if (existing?.count) {
    if (existing.count === records.length && existing.identical === records.length) return { accepted: records.length, unmatched: existing.unmatched, repeated: true };
    throw new ImportError("이미 적재된 위치의 내용이 다릅니다.");
  }
  if (run.committed) throw new ImportError("공개된 수집 자료는 변경할 수 없습니다.");
  if (run.mapping_version !== TRADE_MAPPING_VERSION) throw new ImportError("단지 마스터가 변경되었습니다. 새 수집 작업을 시작해 주세요.");
  const rows = records.map((row, index) => ({
    ...row, ordinal: offset + index,
    complexId: matchTrade({ ...row, district: run.district })?.masterId ?? null,
  }));
  // One JSON binding avoids D1's bound-parameter ceiling. The SQL guard prevents
  // a concurrent publication from allowing any subsequent mutation.
  let inserted: D1Result;
  try {
    inserted = await db.prepare(
    "INSERT INTO trade_import_rows (run_id, ordinal, complex_id, type, date, price_manwon, monthly_rent, area, floor, payload, batch_hash) " +
    "SELECT r.id, json_extract(j.value, '$.ordinal'), json_extract(j.value, '$.complexId'), json_extract(j.value, '$.type'), " +
    "json_extract(j.value, '$.date'), json_extract(j.value, '$.priceManwon'), json_extract(j.value, '$.monthlyRent'), " +
    "json_extract(j.value, '$.area'), json_extract(j.value, '$.floor'), j.value, ? " +
    "FROM trade_import_runs r, json_each(?) j WHERE r.id = ? AND r.committed = 0 AND r.abandoned = 0 AND r.mapping_version = ?")
    .bind(hash, JSON.stringify(rows), id, TRADE_MAPPING_VERSION).run();
  } catch (error) {
    // Plain INSERT is atomic: a rejected overlapping/conflicting chunk adds no rows.
    const after = await db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(batch_hash = ?), 0) AS identical, COALESCE(SUM(complex_id IS NULL), 0) AS unmatched FROM trade_import_rows WHERE run_id = ? AND ordinal >= ? AND ordinal < ?")
      .bind(hash, id, offset, offset + rows.length).first<{ count: number; identical: number; unmatched: number }>();
    if (after?.count === rows.length && after.identical === rows.length) return { accepted: rows.length, unmatched: after.unmatched, repeated: true };
    if (after?.count) throw new ImportError("이미 적재된 위치의 내용이 다릅니다.");
    throw error;
  }
  if (inserted.meta.changes !== rows.length) throw new ImportError("수집 작업 상태가 변경되었습니다.");
  return { accepted: rows.length, unmatched: rows.filter(row => !row.complexId).length, repeated: false };
}
export type ImportStorageReport = {
  id: string; district: string; month: string; kind: Feed; fetchedAt: string;
  mappingVersion: string; expectedCount: number; storedCount: number;
  matchedCount: number; unmatchedCount: number; missingCount: number;
  storageComplete: boolean; committed: boolean; abandoned: boolean; published: boolean;
};
/** One read-only statement measures actual stored rows, not acknowledgements. */
export async function readImportReport(db: D1Database, id: string): Promise<ImportStorageReport> {
  const row = await db.prepare(
    "SELECT r.*, COUNT(o.ordinal) AS stored_count, COUNT(o.complex_id) AS matched_count, " +
    "MIN(o.ordinal) AS first_ordinal, MAX(o.ordinal) AS last_ordinal, h.run_id AS active_run_id " +
    "FROM trade_import_runs r LEFT JOIN trade_import_rows o ON o.run_id = r.id " +
    "LEFT JOIN trade_snapshot_heads h ON h.district = r.district AND h.month = r.month AND h.kind = r.kind " +
    "WHERE r.id = ? GROUP BY r.id")
    .bind(id).first<ImportRun & { stored_count: number; matched_count: number; first_ordinal: number | null; last_ordinal: number | null; active_run_id: string | null }>();
  if (!row) throw new ImportError("수집 작업이 없습니다.", 404);
  const storedCount = row.stored_count;
  const storageComplete = !row.abandoned && storedCount === row.expected_count &&
    (storedCount === 0 || (row.first_ordinal === 0 && row.last_ordinal === storedCount - 1));
  return {
    id: row.id, district: row.district, month: row.month, kind: row.kind,
    fetchedAt: row.fetched_at, mappingVersion: row.mapping_version,
    expectedCount: row.expected_count, storedCount, matchedCount: row.matched_count,
    unmatchedCount: storedCount - row.matched_count, missingCount: Math.max(0, row.expected_count - storedCount),
    storageComplete, committed: !!row.committed, abandoned: !!row.abandoned,
    published: row.active_run_id === row.id,
  };
}
export async function commitImport(db: D1Database, id: string) {
  const run = await runById(db, id);
  if (run.abandoned || run.mapping_version !== TRADE_MAPPING_VERSION) throw new ImportError("작업 상태 또는 단지 마스터가 변경되었습니다. 새 수집 작업을 시작해 주세요.");
  // Guarded count and publication are in the same atomic batch. Ordinals are
  // unique and range-checked on input, including complete zero-observation feeds.
  await db.batch([
    db.prepare("UPDATE trade_import_runs SET committed = 1 WHERE id = ? AND abandoned = 0 AND mapping_version = ? AND expected_count = (SELECT COUNT(*) FROM trade_import_rows WHERE run_id = ?) AND NOT EXISTS (SELECT 1 FROM trade_import_rows WHERE run_id = ? AND (ordinal < 0 OR ordinal >= trade_import_runs.expected_count))").bind(id, TRADE_MAPPING_VERSION, id, id),
    db.prepare("INSERT OR IGNORE INTO trade_import_prices (run_id, complex_id, area, price_manwon, date) " +
      "SELECT run_id, complex_id, area, price_manwon, date FROM (" +
      "SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.complex_id, o.area ORDER BY o.date DESC, o.price_manwon DESC, o.ordinal) AS position " +
      "FROM trade_import_rows o JOIN trade_import_runs r ON r.id = o.run_id " +
      "WHERE r.id = ? AND r.mapping_version = ? AND r.abandoned = 0 AND r.committed = 1 AND o.type = 'sale' AND o.complex_id IS NOT NULL) WHERE position = 1").bind(id, TRADE_MAPPING_VERSION),
    db.prepare("INSERT INTO trade_snapshot_heads (district, month, kind, run_id, fetched_at, record_count) " +
      "SELECT district, month, kind, id, fetched_at, expected_count FROM trade_import_runs WHERE id = ? AND abandoned = 0 AND mapping_version = ? AND committed = 1 " +
      "ON CONFLICT(district, month, kind) DO UPDATE SET run_id = excluded.run_id, fetched_at = excluded.fetched_at, record_count = excluded.record_count " +
      "WHERE excluded.fetched_at > trade_snapshot_heads.fetched_at").bind(id, TRADE_MAPPING_VERSION),
  ]);
  const report = await readImportReport(db, id);
  if (!report.committed || !report.storageComplete) throw new ImportError("전체 건수 적재가 끝나지 않았습니다. 기존 자료를 유지합니다.");
  const head = await db.prepare("SELECT * FROM trade_snapshot_heads WHERE district = ? AND month = ? AND kind = ?").bind(run.district, run.month, run.kind).first<SnapshotHead>();
  return { committed: true, published: report.published, recordCount: report.storedCount, fetchedAt: head?.fetched_at ?? null, report };
}

// Maintenance is separate from publication. A call removes at most 1,000 rows
// and 1,000 precomputed prices from one retired run; never an active snapshot.
export async function cleanupImport(db: D1Database, currentId: string) {
  const current = await runById(db, currentId);
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  const retired = await db.prepare("SELECT id FROM trade_import_runs WHERE district = ? AND month = ? AND kind = ? AND created_at < ? AND id <> ? AND id NOT IN (SELECT run_id FROM trade_snapshot_heads) ORDER BY created_at LIMIT 1")
    .bind(current.district, current.month, current.kind, cutoff, currentId).first<{ id: string }>();
  if (!retired) return { remaining: false };
  const guard = " AND run_id IN (SELECT id FROM trade_import_runs WHERE abandoned = 1) AND run_id NOT IN (SELECT run_id FROM trade_snapshot_heads)";
  await db.batch([
    db.prepare("UPDATE trade_import_runs SET abandoned = 1 WHERE id = ? AND id NOT IN (SELECT run_id FROM trade_snapshot_heads)").bind(retired.id),
    db.prepare("DELETE FROM trade_import_rows WHERE rowid IN (SELECT rowid FROM trade_import_rows WHERE run_id = ?" + guard + " LIMIT 1000)").bind(retired.id),
    db.prepare("DELETE FROM trade_import_prices WHERE rowid IN (SELECT rowid FROM trade_import_prices WHERE run_id = ?" + guard + " LIMIT 1000)").bind(retired.id),
    db.prepare("DELETE FROM trade_import_runs WHERE id = ? AND id NOT IN (SELECT run_id FROM trade_snapshot_heads) AND NOT EXISTS (SELECT 1 FROM trade_import_rows WHERE run_id = ?) AND NOT EXISTS (SELECT 1 FROM trade_import_prices WHERE run_id = ?)").bind(retired.id, retired.id, retired.id),
  ]);
  return { remaining: true };
}

const NO_FETCH_HEADERS = { "Cache-Control": "no-store" };
export { NO_FETCH_HEADERS };

export async function readStoredTrades(db: D1Database, month: string, district?: string) {
  const scope = "h.month = ? AND h.kind = 'sale'" + (district ? " AND h.district = ?" : "");
  const args = district ? [month, district] : [month];
  const result = await db.batch([
    db.prepare("SELECT h.* FROM trade_snapshot_heads h WHERE " + scope).bind(...args),
    db.prepare("SELECT o.run_id, o.ordinal, o.payload, o.complex_id, h.district FROM trade_import_rows o JOIN trade_snapshot_heads h ON h.run_id = o.run_id WHERE " + scope).bind(...args),
  ]);
  const heads = result[0].results as SnapshotHead[];
  const trades = (result[1].results as StoredRow[]).map(row => {
    const value = JSON.parse(row.payload) as Observation;
    return { id: row.run_id + ":" + row.ordinal, district: row.district, apartment: value.apartment,
      dong: value.dong, jibun: value.jibun, aptSeq: value.aptSeq, buildYear: value.buildYear,
      date: value.date, price: value.priceManwon / 10000, area: value.area, floor: value.floor ?? 0 } satisfies Trade;
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { heads, trades };
}
export async function readStoredDetail(db: D1Database, complexId: string, district: string, from: string, to: string) {
  const args = [district, from, to];
  const result = await db.batch([
    db.prepare("SELECT h.* FROM trade_snapshot_heads h WHERE h.district = ? AND h.month >= ? AND h.month <= ?").bind(...args),
    db.prepare("SELECT o.run_id, o.ordinal, o.payload FROM trade_import_rows o JOIN trade_snapshot_heads h ON h.run_id = o.run_id " +
      "WHERE h.district = ? AND h.month >= ? AND h.month <= ? AND o.complex_id = ?").bind(...args, complexId),
  ]);
  const heads = result[0].results as SnapshotHead[];
  const transactions = (result[1].results as StoredRow[]).map(row => {
    const value = JSON.parse(row.payload) as Observation;
    return { id: row.run_id + ":" + row.ordinal, type: value.type, date: value.date,
      price: value.priceManwon / 10000, monthlyRent: value.monthlyRent, area: value.area, floor: value.floor ?? 0 } as ComplexTransaction;
  }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { heads, transactions };
}
export async function readStoredAreaSales(db: D1Database, month: string) {
  // Existing monthly summaries survive rollout until that exact district/month is
  // replaced by a complete new snapshot (including a valid empty/cancelled month).
  const rows = await db.prepare("WITH candidates AS (" +
    "SELECT p.complex_id, p.area, p.price_manwon, p.date AS contract_date FROM trade_import_prices p " +
    "JOIN trade_snapshot_heads h ON h.run_id = p.run_id WHERE h.kind = 'sale' AND h.month <= ? " +
    "UNION ALL SELECT old.complex_id, old.area, old.price_manwon, old.contract_date FROM complex_area_monthly_sales old " +
    "WHERE old.month <= ? AND NOT EXISTS (SELECT 1 FROM trade_snapshot_heads h WHERE h.district = old.district AND h.month = old.month AND h.kind = 'sale')" +
    ") SELECT complex_id, area, price_manwon, contract_date FROM (" +
    "SELECT *, ROW_NUMBER() OVER (PARTITION BY complex_id, area ORDER BY contract_date DESC, price_manwon DESC) AS position FROM candidates) WHERE position = 1")
    .bind(month, month).all<{ complex_id: string; area: number; price_manwon: number; contract_date: string }>();
  const summaries: Record<string, { area: number; price: number; date: string }[]> = {};
  for (const row of rows.results) (summaries[row.complex_id] ??= []).push({ area: row.area, price: row.price_manwon / 10000, date: row.contract_date });
  return summaries;
}
