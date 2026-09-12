import { DISTRICT_CODES, type Trade } from "../app/data";
import { validRecordMonth } from "../lib/molit-records.mjs";
import { groupTradesByMaster, type MasterMatchRecord } from "../app/master-trade-matcher";
import { latestSalesByArea, type AreaSaleSummary } from "../app/area-sales";

/**
 * @deprecated Summary-only compatibility path. Production ingestion belongs in
 * trade-store.ts so every observation, including unmatched records, is retained.
 * Reject incomplete input; never silently filter away a portion of a snapshot.
 */
export async function replaceDistrictMonthSales(
  d1: D1Database, master: readonly MasterMatchRecord[], district: string, month: string, trades: readonly Trade[],
) {
  if (!Object.hasOwn(DISTRICT_CODES, district) || !validRecordMonth(month, "sale")) {
    throw new Error("Legacy summary scope is invalid.");
  }
  for (const trade of trades) {
    if (trade.district !== district || !/^\d{4}-\d{2}-\d{2}$/.test(trade.date) ||
        trade.date.replaceAll("-", "").slice(0, 6) !== month ||
        !Number.isFinite(Date.parse(trade.date)) || new Date(trade.date).toISOString().slice(0, 10) !== trade.date ||
        !Number.isFinite(trade.area) || trade.area <= 0 || !Number.isFinite(trade.price) ||
        !Number.isSafeInteger(Math.round(trade.price * 10000)) || Math.round(trade.price * 10000) <= 0) {
      throw new Error("Legacy summary input is incomplete or outside its scope. Previous data was retained.");
    }
  }
  const { tradesByMasterId, unmatchedTradeCount } = groupTradesByMaster(master, trades);
  if (unmatchedTradeCount) throw new Error("Legacy summaries cannot preserve unmatched observations. Use the snapshot importer.");
  const rows = [...tradesByMasterId].flatMap(([id, values]) =>
    latestSalesByArea(values).map((sale) => [id, sale.area, Math.round(sale.price * 10_000), sale.date]));
  // D1 enforces foreign keys. A missing parent now fails the entire atomic batch,
  // rolling back the DELETE instead of silently dropping rows via INNER JOIN.
  await d1.batch([
    d1.prepare("DELETE FROM complex_area_monthly_sales WHERE district = ? AND month = ?").bind(district, month),
    d1.prepare(`INSERT INTO complex_area_monthly_sales (complex_id, district, month, area, price_manwon, contract_date)
      SELECT json_extract(j.value, '$[0]'), ?, ?, json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]')
      FROM json_each(?) j`)
      .bind(district, month, JSON.stringify(rows)),
  ]);
}

export async function readAreaSales(d1: D1Database, month: string): Promise<Record<string, AreaSaleSummary[]>> {
  const result = await d1.prepare(`SELECT complex_id, area, price_manwon, contract_date FROM (
    SELECT complex_id, area, price_manwon, contract_date,
      ROW_NUMBER() OVER (PARTITION BY complex_id, area ORDER BY contract_date DESC, price_manwon DESC) AS rank
    FROM complex_area_monthly_sales WHERE month <= ?
  ) WHERE rank = 1`).bind(month).all<{ complex_id: string; area: number; price_manwon: number; contract_date: string }>();
  const summaries: Record<string, AreaSaleSummary[]> = {};
  for (const row of result.results) {
    (summaries[row.complex_id] ??= []).push({ area: row.area, price: row.price_manwon / 10_000, date: row.contract_date });
  }
  return summaries;
}
