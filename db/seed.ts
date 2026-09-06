import { sampleTrades } from "../app/data";
import generatedComplexes from "./generated-complexes.json";
import generatedRebComplexes from "./generated-reb-complexes.json";
import type { ComplexSeedRecord } from "./complexes";

const NON_APARTMENT_COMPLEX_TYPES = new Set(["다세대", "연립주택"]);

// Keep this content-addressed suffix in sync with generated-reb-complexes.json.
// A new version lets D1 backfill the replacement membership without deleting
// rows or transactions that belong to an earlier deployed seed.
export const COMPLEX_SEED_VERSION =
  "kapt-20260814-reb-20250918-016320fa";

function sampleFallback(): ComplexSeedRecord[] {
  const byComplex = new Map<string, ComplexSeedRecord>();
  for (const trade of sampleTrades) {
    const key = `${trade.district}:${trade.dong}:${trade.apartment}`;
    const current = byComplex.get(key);
    if (!current || (current.latestSaleDate ?? "") < trade.date) {
      byComplex.set(key, {
        id: trade.aptSeq || `sample:${key}`,
        aptSeq: trade.aptSeq,
        apartment: trade.apartment,
        district: trade.district,
        dong: trade.dong,
        jibunAddress: trade.jibun,
        buildYear: trade.buildYear,
        areaMin: current
          ? Math.min(current.areaMin ?? trade.area, trade.area)
          : trade.area,
        areaMax: current
          ? Math.max(current.areaMax ?? trade.area, trade.area)
          : trade.area,
        latestSalePrice: trade.price,
        latestSaleDate: trade.date,
        latestSaleArea: trade.area,
        saleCount: (current?.saleCount ?? 0) + 1,
        rentCount: 0,
        source: "dashboard-sample",
        sourceUpdatedAt: "2026-07-22T09:00:00+09:00",
      });
    } else {
      current.areaMin = Math.min(current.areaMin ?? trade.area, trade.area);
      current.areaMax = Math.max(current.areaMax ?? trade.area, trade.area);
      current.saleCount = (current.saleCount ?? 0) + 1;
    }
  }
  return Array.from(byComplex.values());
}

export function getComplexSeed(): readonly ComplexSeedRecord[] {
  const apartmentKaptComplexes = (
    generatedComplexes as ComplexSeedRecord[]
  ).filter(
    (record) =>
      !NON_APARTMENT_COMPLEX_TYPES.has(record.complexType?.trim() ?? ""),
  );
  const generated = [
    ...apartmentKaptComplexes,
    ...(generatedRebComplexes as ComplexSeedRecord[]),
  ];
  return generated.length ? generated : sampleFallback();
}
