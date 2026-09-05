import type { AreaSaleSummary } from "./area-sales";

export type ComplexDealSummary = {
  price: number;
  date: string;
};

/**
 * Canonical complex record returned by the future master-data endpoint.
 * Deal summaries are deliberately nullable: a valid complex can have no trade.
 */
export type ComplexMasterRecord = {
  id: string;
  name: string;
  district: string;
  dong: string;
  address: string;
  jibunAddress?: string | null;
  buildYear: number | null;
  households: number | null;
  buildingCount: number | null;
  parking: number | null;
  areaSales?: AreaSaleSummary[];
  latestSale: ComplexDealSummary | null;
  latestJeonse: ComplexDealSummary | null;
  areas: number[];
  source: string;
};

export type ComplexesApiResponse = {
  complexes: ComplexMasterRecord[];
  mode?: "demo" | "live";
  updatedAt?: string;
  message?: string;
  seedProgress?: {
    complete: boolean;
    exact: boolean;
    seeded: number;
    stored: number;
    stale: number;
    total: number;
    remaining: number;
  };
};

export type ComplexDealState = "sale" | "jeonse-only" | "no-trade";
export type ComplexSortMode = "price-desc" | "latest" | "price-asc";

/**
 * Nullable detail seed for migrating ComplexDetailPanel away from Trade.
 * No sentinel price/date is created for a complex without transactions.
 */
export type ComplexDetailSeed = {
  id: string;
  district: string;
  dong: string;
  apartment: string;
  address: string;
  buildYear: number | null;
  households: number | null;
  buildingCount: number | null;
  parking: number | null;
  areas: number[];
  defaultArea: number | null;
  basePrice: number | null;
  referenceDate: string | null;
  source: string;
};

export const NO_SALE_BUCKET = {
  id: "no-sale",
  label: "최근 매매 없음",
  accent: "#8b929c",
} as const;

function nullableNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeDeal(deal: ComplexDealSummary | null) {
  if (
    !deal ||
    !Number.isFinite(deal.price) ||
    deal.price <= 0 ||
    !deal.date.trim()
  ) {
    return null;
  }

  return { price: deal.price, date: deal.date.trim() };
}

export function normalizeComplexRecord(
  complex: ComplexMasterRecord,
): ComplexMasterRecord {
  const areas = [...new Set(complex.areas)]
    .filter((area) => Number.isFinite(area) && area > 0)
    .sort((a, b) => a - b);

  return {
    ...complex,
    id: complex.id.trim(),
    name: complex.name.trim(),
    district: complex.district.trim(),
    dong: complex.dong.trim(),
    address: complex.address.trim(),
    jibunAddress: complex.jibunAddress?.trim() || null,
    source: complex.source.trim(),
    buildYear: nullableNumber(complex.buildYear),
    households: nullableNumber(complex.households),
    buildingCount: nullableNumber(complex.buildingCount),
    parking: nullableNumber(complex.parking),
    latestSale: normalizeDeal(complex.latestSale),
    latestJeonse: normalizeDeal(complex.latestJeonse),
    areas,
  };
}

export function getComplexDealState(
  complex: ComplexMasterRecord,
): ComplexDealState {
  if (complex.latestSale) return "sale";
  if (complex.latestJeonse) return "jeonse-only";
  return "no-trade";
}

export function matchesSalePriceBand(
  complex: ComplexMasterRecord,
  min: number,
  max: number,
) {
  const price = complex.latestSale?.price;
  return price !== undefined && price >= min && price < max;
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc",
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function compareNullableDates(left: string | null, right: string | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

/** Keeps unpriced complexes in the result, placing them after priced rows. */
export function compareComplexes(
  left: ComplexMasterRecord,
  right: ComplexMasterRecord,
  mode: ComplexSortMode,
) {
  if (mode === "latest") {
    const leftDate = left.latestSale?.date ?? left.latestJeonse?.date ?? null;
    const rightDate = right.latestSale?.date ?? right.latestJeonse?.date ?? null;
    return (
      compareNullableDates(leftDate, rightDate) ||
      left.name.localeCompare(right.name, "ko")
    );
  }

  return (
    compareNullableNumbers(
      left.latestSale?.price ?? null,
      right.latestSale?.price ?? null,
      mode === "price-asc" ? "asc" : "desc",
    ) || left.name.localeCompare(right.name, "ko")
  );
}

export function toComplexDetailSeed(
  complex: ComplexMasterRecord,
): ComplexDetailSeed {
  return {
    id: complex.id,
    district: complex.district,
    dong: complex.dong,
    apartment: complex.name,
    address: complex.address,
    buildYear: complex.buildYear,
    households: complex.households,
    buildingCount: complex.buildingCount,
    parking: complex.parking,
    areas: complex.areas,
    defaultArea: complex.areas[0] ?? null,
    basePrice: complex.latestSale?.price ?? null,
    referenceDate:
      complex.latestSale?.date ?? complex.latestJeonse?.date ?? null,
    source: complex.source,
  };
}
