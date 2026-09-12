/**
 * Reviewed identity links, not a fuzzy-name deduplicator.
 * Keep original source records and database rows; only canonical membership changes.
 * Evidence and conflicting fields: docs/complex-identity.md.
 */
export const COMPLEX_IDENTITY_VERSION = "identity-20260912-v1";
export const REVIEWED_COMPLEX_IDENTITIES = Object.freeze([
  Object.freeze({
    canonicalId: "A13613001",
    aliasIds: Object.freeze(["A10022464"]),
    names: Object.freeze(["하월곡아남", "하월곡아남아파트"]),
    district: "성북구", dong: "하월곡동", lot: "218",
    approvalDate: "1996-12-03", buildYear: 1996, households: 198, buildings: 1,
  }),
]);
const groupsById = new Map(REVIEWED_COMPLEX_IDENTITIES.flatMap(group =>
  [group.canonicalId, ...group.aliasIds].map(id => [id, group])));
export const COMPLEX_ALIAS_MAP_JSON = JSON.stringify(Object.fromEntries(
  REVIEWED_COMPLEX_IDENTITIES.flatMap(group => group.aliasIds.map(id => [id, group.canonicalId])),
));
export const RETIRED_COMPLEX_IDS = Object.freeze(REVIEWED_COMPLEX_IDENTITIES.flatMap(group => [...group.aliasIds]));

/** @param {string} id */
export function canonicalComplexId(id) { return groupsById.get(id)?.canonicalId ?? id; }
/** @param {string} id */
export function complexIdentityIds(id) {
  const group = groupsById.get(id);
  return group ? [group.canonicalId, ...group.aliasIds] : [id];
}
/** @param {string} id @param {string} name */
export function complexIdentityNames(id, name) {
  return [...new Set([name, ...(groupsById.get(id)?.names ?? [])])];
}
/** A partial catalogue never loses an alias when its canonical parent is absent.
 * @template {{id: string}} T
 * @param {readonly T[]} records
 * @returns {T[]}
 */
export function canonicalComplexRecords(records) {
  const ids = new Set(records.map(record => record.id));
  return records.filter(record => canonicalComplexId(record.id) === record.id || !ids.has(canonicalComplexId(record.id)));
}

/** Fail closed if a future source refresh changes the reviewed identity evidence.
 * @param {readonly import("../db/complexes").ComplexSeedRecord[]} records
 */
export function assertReviewedComplexIdentities(records) {
  for (const group of REVIEWED_COMPLEX_IDENTITIES) {
    for (const id of [group.canonicalId, ...group.aliasIds]) {
      const matches = records.filter(record => record.id === id);
      const record = matches[0];
      const lot = record?.jibunAddress?.match(/하월곡동\s+(산?\s*\d+(?:-\d+)?)/)?.[1];
      if (matches.length !== 1 || !record || record.district !== group.district || record.dong !== group.dong ||
          lot !== group.lot || record.approvalDate !== group.approvalDate || record.buildYear !== group.buildYear ||
          record.households !== group.households || (record.buildings ?? record.buildingCount) !== group.buildings ||
          !group.names.includes(record.name ?? record.apartment ?? "")) {
        throw new Error("Reviewed apartment identity evidence changed; review before publishing: " + id);
      }
    }
  }
}
