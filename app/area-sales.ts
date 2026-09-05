import type { ComplexMasterRecord } from "./complex-master";

export type AreaSaleSummary = { area: number; price: number; date: string };

/** One latest observation for each exact exclusive area; never mix area and price. */
export function latestSalesByArea(sales: readonly AreaSaleSummary[]) {
  const byArea = new Map<number, AreaSaleSummary>();
  for (const sale of sales) {
    if (!Number.isFinite(sale.area) || sale.area <= 0 || !Number.isFinite(sale.price) || sale.price <= 0) continue;
    const previous = byArea.get(sale.area);
    if (!previous || sale.date > previous.date || (sale.date === previous.date && sale.price > previous.price)) {
      byArea.set(sale.area, sale);
    }
  }
  return [...byArea.values()].sort((a, b) => a.area - b.area);
}

export function applyAreaPriceFilter(
  record: ComplexMasterRecord,
  area: { min: number; max: number } | null,
  price: { min: number; max: number } | undefined,
): ComplexMasterRecord | null {
  const sales = latestSalesByArea(record.areaSales ?? []).filter((sale) =>
    !area || (sale.area >= area.min && sale.area < area.max));
  const candidates = sales.filter((sale) => !price || (sale.price >= price.min && sale.price < price.max));
  if (area && !record.areas.some((value) => value >= area.min && value < area.max) && !sales.length) return null;
  // A legacy complex-wide price cannot prove a selected area's price.
  if (price && !candidates.length) {
    if (area || record.areaSales?.length || !record.latestSale ||
        record.latestSale.price < price.min || record.latestSale.price >= price.max) return null;
  }
  const latest = candidates.sort((a, b) => b.date.localeCompare(a.date) || b.price - a.price)[0];
  return {
    ...record,
    latestSale: latest ? { price: latest.price, date: latest.date } : area ? null : record.latestSale,
    areas: area ? record.areas.filter((value) => value >= area.min && value < area.max) : record.areas,
  };
}
