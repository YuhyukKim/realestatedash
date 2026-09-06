import type { Trade } from "../app/data";
import { groupTradesByMaster, type MasterMatchRecord } from "../app/master-trade-matcher";
import { latestSalesByArea, type AreaSaleSummary } from "../app/area-sales";

export async function replaceDistrictMonthSales(
  d1: D1Database, master: readonly MasterMatchRecord[], district: string, month: string, trades: readonly Trade[],
) {
  const { tradesByMasterId } = groupTradesByMaster(master, trades.filter((trade) =>
    trade.district === district && trade.date.replaceAll("-", "").slice(0, 6) === month));
  const rows = [...tradesByMasterId].flatMap(([id, values]) =>
    latestSalesByArea(values).map((sale) => [id, sale.area, Math.round(sale.price * 10_000), sale.date]));
  // One atomic batch: failed writes retain the previous complete snapshot.
  await d1.batch([
    d1.prepare("DELETE FROM complex_area_monthly_sales WHERE district = ? AND month = ?").bind(district, month),
    d1.prepare(`INSERT INTO complex_area_monthly_sales (complex_id, district, month, area, price_manwon, contract_date)
      SELECT c.id, ?, ?, json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]')
      FROM json_each(?) j JOIN apartment_complexes c ON c.id = json_extract(j.value, '$[0]')`)
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
