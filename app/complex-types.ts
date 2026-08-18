import type { NearbyStation } from "./stations";

export type ComplexTransactionType = "sale" | "jeonse" | "monthly";

export type ComplexTransaction = {
  id: string;
  type: ComplexTransactionType;
  date: string;
  price: number;
  monthlyRent: number;
  area: number;
  floor: number;
};

export type ComplexDetailResponse = {
  mode: "demo" | "live";
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
};

