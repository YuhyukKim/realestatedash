import type { NearbyStation } from "./stations";

export type ComplexTransactionType = "sale" | "jeonse" | "monthly";

export type ComplexTransaction = {
  id: string;
  type: ComplexTransactionType;
  date: string;
  /** Sale/deposit in eok; preserve all four decimal places (one manwon). */
  price: number;
  /** Monthly rent in integer manwon, not eok. */
  monthlyRent: number;
  area: number;
  floor: number;
};

export type ComplexDetailResponse = {
  mode: "partial" | "stored" | "unavailable";
  complex: {
    district: string;
    dong: string;
    apartment: string;
    buildYear: number | null;
  };
  transactions: ComplexTransaction[];
  nearbyStations: NearbyStation[];
  nearbyStationsNote: string;
  message: string;
  missing: { month: string; kind: "sale" | "rent" }[];
  fetchedAt: string | null;
};
