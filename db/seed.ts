import { assertReviewedComplexIdentities, canonicalComplexRecords, COMPLEX_IDENTITY_VERSION } from "../lib/complex-identity.mjs";
import generatedComplexes from "./generated-complexes.json";
import generatedRebComplexes from "./generated-reb-complexes.json";
import type { ComplexSeedRecord } from "./complexes";

const NON_APARTMENT_COMPLEX_TYPES = new Set(["다세대", "연립주택"]);

// Keep this content-addressed suffix in sync with generated-reb-complexes.json.
// A new version lets D1 backfill the replacement membership without deleting
// rows or transactions that belong to an earlier deployed seed.
export const COMPLEX_SEED_VERSION =
  "kapt-20260814-reb-20250918-016320fa:" + COMPLEX_IDENTITY_VERSION;

// Immutable build-time data: do not rebuild/filter this catalogue on every request.
const rawComplexSeed: readonly ComplexSeedRecord[] = [
  ...(generatedComplexes as ComplexSeedRecord[]).filter(record =>
    !NON_APARTMENT_COMPLEX_TYPES.has(record.complexType?.trim() ?? "")),
  ...(generatedRebComplexes as ComplexSeedRecord[]),
];
assertReviewedComplexIdentities(rawComplexSeed);
const complexSeed: readonly ComplexSeedRecord[] = canonicalComplexRecords(rawComplexSeed);
export const COMPLEX_CATALOG_COVERAGE = Object.freeze({
  sourceRecords: rawComplexSeed.length, canonicalComplexes: complexSeed.length,
  reviewedDuplicateRecords: rawComplexSeed.length - complexSeed.length,
});
export function getComplexSeed(): readonly ComplexSeedRecord[] {
  if (!complexSeed.length) throw new Error("Official apartment catalogue is unavailable");
  return complexSeed;
}
