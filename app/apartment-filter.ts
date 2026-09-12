import { applyAreaPriceFilter } from "./area-sales";
import type { ComplexMasterRecord } from "./complex-master";
import type { Trade } from "./data";
import { findDirectLineMatch, type WorkplaceId } from "./access";
import { getComplexCoordinates, getNearbyStations, selectNearbyStation, type NearbyStation } from "./stations";

type Range = { min: number; max: number };
export type CandidateFilters = {
  district: string; area: Range | null; price?: Range;
  moveInYear: Range | "unknown" | null; keyword: string;
};
export type TransitFilters = {
  stationKeys: readonly string[]; maxStationMeters: number; workplaces: readonly WorkplaceId[];
};
export type TransitCoverage = {
  active: boolean; candidateCount: number; coordinateCount: number; missingCoordinateCount: number;
  matchedCount: number; unverifiedCount: number; mismatchCount: number;
};

/** Count transit exclusions only AFTER all non-transit conditions have been applied. */
export function filterApartmentCandidates<T extends { record: ComplexMasterRecord; periodTrades: readonly Trade[] }>(
  complexes: readonly T[], filters: CandidateFilters,
) {
  const keyword = filters.keyword.trim().toLowerCase();
  return complexes.flatMap(complex => {
    const original = complex.record;
    if (filters.district !== "서울 전체" && original.district !== filters.district) return [];
    if (keyword && !`${original.district} ${original.dong} ${original.name} ${original.address}`.toLowerCase().includes(keyword)) return [];
    if (filters.moveInYear === "unknown") {
      if (original.buildYear !== null) return [];
    } else if (filters.moveInYear && (!original.buildYear ||
      original.buildYear < filters.moveInYear.min || original.buildYear >= filters.moveInYear.max)) return [];
    const record = applyAreaPriceFilter(original, filters.area, filters.price);
    if (!record) return [];
    const periodTrades = complex.periodTrades.filter(trade =>
      !filters.area || (trade.area >= filters.area.min && trade.area < filters.area.max));
    return [{ ...complex, record, periodTrades }];
  });
}

export function transitFilterActive(filters: TransitFilters): boolean {
  return filters.stationKeys.length > 0 || Number.isFinite(filters.maxStationMeters) || filters.workplaces.length > 0;
}

/** Unknown coordinates are not evidence that an apartment fails the condition. */
export function evaluateTransit(
  hasCoordinates: boolean, stations: readonly NearbyStation[], filters: TransitFilters,
): { status: "matched" | "unverified" | "mismatch"; station: NearbyStation | null } {
  const active = transitFilterActive(filters);
  if (!hasCoordinates) return { status: active ? "unverified" : "matched", station: null };
  const station = selectNearbyStation(stations, filters.stationKeys, filters.maxStationMeters);
  if ((filters.stationKeys.length || Number.isFinite(filters.maxStationMeters)) && !station) {
    return { status: "mismatch", station: null };
  }
  // Preserve existing semantics: selected stations OR; workplaces AND, using any
  // registered station within 1.5 km, not necessarily the selected display station.
  if (!filters.workplaces.every(workplace => findDirectLineMatch(stations, workplace))) {
    return { status: "mismatch", station };
  }
  return { status: "matched", station };
}

export function filterByTransit<T extends { record: { id: string } }>(
  candidates: readonly T[], filters: TransitFilters,
) {
  const matched: (T & { station: NearbyStation | null })[] = [];
  const unverified: T[] = [];
  let coordinateCount = 0, mismatchCount = 0;
  for (const candidate of candidates) {
    const hasCoordinates = getComplexCoordinates(candidate.record.id) !== null;
    if (hasCoordinates) coordinateCount++;
    const result = evaluateTransit(hasCoordinates, getNearbyStations(candidate.record.id), filters);
    if (result.status === "unverified") unverified.push(candidate);
    else if (result.status === "mismatch") mismatchCount++;
    else matched.push({ ...candidate, station: result.station });
  }
  const coverage: TransitCoverage = {
    active: transitFilterActive(filters), candidateCount: candidates.length, coordinateCount,
    missingCoordinateCount: candidates.length - coordinateCount,
    matchedCount: matched.length, unverifiedCount: unverified.length, mismatchCount,
  };
  return { matched, unverified, coverage };
}
