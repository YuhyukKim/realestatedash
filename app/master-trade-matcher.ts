export type MasterMatchRecord = {
  id: string;
  name: string;
  district: string;
  dong: string;
  address?: string | null;
  jibunAddress?: string | null;
  buildYear: number | null;
};

export type TradeMatchRecord = {
  apartment: string;
  district: string;
  dong: string;
  jibun: string | null;
  buildYear: number | null;
};

export type MasterTradeMatchReason = "jibun" | "exact-name" | "alias";

export type MasterTradeMatch = {
  masterId: string;
  reason: MasterTradeMatchReason;
};

type IndexedMaster = {
  record: MasterMatchRecord;
  exactName: string;
  aliasName: string;
  jibuns: string[];
};

type MasterTradeIndex = {
  byJibun: Map<string, IndexedMaster[]>;
  byExactName: Map<string, IndexedMaster[]>;
  byAlias: Map<string, IndexedMaster[]>;
};

function locationKey(district: string, dong: string) {
  return `${district.normalize("NFKC").trim()}:${dong.normalize("NFKC").trim()}`;
}

function appendToIndex(
  index: Map<string, IndexedMaster[]>,
  key: string,
  value: IndexedMaster,
) {
  index.set(key, [...(index.get(key) ?? []), value]);
}

/**
 * Normalizes spacing, punctuation, and the generic "apartment" suffix while
 * keeping meaningful phase/rental qualifiers intact.
 */
export function normalizeApartmentName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/아파트|\bapt\.?\b/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

/**
 * Produces a conservative alias for public transaction feeds that split one
 * K-apt master complex into numbered phases. Exact names are always attempted
 * first, so genuinely separate numbered masters keep their own transactions.
 */
export function normalizeApartmentAlias(value: string) {
  return normalizeApartmentName(
    value
      .normalize("NFKC")
      .replace(/\((?:공공|민간)?임대\)|\(분양\)/g, "")
      .replace(/(?:제)?\d+(?:[.,·]\d+)*단지\s*$/g, ""),
  );
}

function normalizeJibun(value: string) {
  const compact = value.replace(/\s+/g, "");
  const isMountain = compact.startsWith("산");
  const numeric = compact.replace(/^산/, "");
  const [main, sub] = numeric.split("-");
  const normalizedMain = String(Number(main));
  if (!Number.isFinite(Number(main))) return "";
  const normalizedSub =
    sub !== undefined && Number.isFinite(Number(sub))
      ? `-${Number(sub)}`
      : "";
  return `${isMountain ? "산" : ""}${normalizedMain}${normalizedSub}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extracts only legal-lot numbers that follow the supplied legal dong. */
export function extractJibuns(value: string | null | undefined, dong: string) {
  const cleaned = value?.normalize("NFKC").trim();
  if (!cleaned) return [];

  if (/^산?\s*\d+(?:-\d+)?$/.test(cleaned)) {
    const normalized = normalizeJibun(cleaned);
    return normalized ? [normalized] : [];
  }

  const matches = cleaned.matchAll(
    new RegExp(`${escapeRegExp(dong)}\\s+(산?\\s*\\d+(?:-\\d+)?)`, "g"),
  );
  return [
    ...new Set(
      Array.from(matches, (match) => normalizeJibun(match[1])).filter(Boolean),
    ),
  ];
}

function buildMasterTradeIndex(master: readonly MasterMatchRecord[]) {
  const index: MasterTradeIndex = {
    byJibun: new Map(),
    byExactName: new Map(),
    byAlias: new Map(),
  };

  master.forEach((record) => {
    const location = locationKey(record.district, record.dong);
    const indexed: IndexedMaster = {
      record,
      exactName: normalizeApartmentName(record.name),
      aliasName: normalizeApartmentAlias(record.name),
      jibuns: extractJibuns(record.jibunAddress ?? record.address, record.dong),
    };

    indexed.jibuns.forEach((jibun) =>
      appendToIndex(index.byJibun, `${location}:${jibun}`, indexed),
    );
    if (indexed.exactName) {
      appendToIndex(
        index.byExactName,
        `${location}:${indexed.exactName}`,
        indexed,
      );
    }
    if (indexed.aliasName) {
      appendToIndex(index.byAlias, `${location}:${indexed.aliasName}`, indexed);
    }
  });

  return index;
}

function hasCompatibleBuildYear(
  masterYear: number | null,
  tradeYear: number | null,
) {
  if (masterYear === null || tradeYear === null) return true;
  return Math.abs(masterYear - tradeYear) <= 1;
}

function compatibleCandidates(
  candidates: readonly IndexedMaster[],
  trade: TradeMatchRecord,
) {
  return candidates.filter((candidate) =>
    hasCompatibleBuildYear(candidate.record.buildYear, trade.buildYear),
  );
}

function selectUniqueCandidate(
  candidates: readonly IndexedMaster[],
  trade: TradeMatchRecord,
) {
  const compatible = compatibleCandidates(candidates, trade);
  if (compatible.length === 1) return compatible[0];
  if (compatible.length < 2) return null;

  if (trade.buildYear !== null) {
    const sameYear = compatible.filter(
      (candidate) => candidate.record.buildYear === trade.buildYear,
    );
    if (sameYear.length === 1) return sameYear[0];
  }

  return null;
}

function matchTradeWithIndex(
  index: MasterTradeIndex,
  trade: TradeMatchRecord,
): MasterTradeMatch | null {
  const location = locationKey(trade.district, trade.dong);
  const exactName = normalizeApartmentName(trade.apartment);
  const aliasName = normalizeApartmentAlias(trade.apartment);
  const tradeJibuns = extractJibuns(trade.jibun, trade.dong);

  // A legal-lot match is the strongest public identifier available here.
  const jibunCandidates = new Map<string, IndexedMaster>();
  tradeJibuns.forEach((jibun) => {
    (index.byJibun.get(`${location}:${jibun}`) ?? []).forEach((candidate) =>
      jibunCandidates.set(candidate.record.id, candidate),
    );
  });
  const jibunMatch = selectUniqueCandidate(
    [...jibunCandidates.values()],
    trade,
  );
  if (jibunMatch) {
    return { masterId: jibunMatch.record.id, reason: "jibun" };
  }

  const exactMatch = selectUniqueCandidate(
    index.byExactName.get(`${location}:${exactName}`) ?? [],
    trade,
  );
  if (exactMatch) {
    return { masterId: exactMatch.record.id, reason: "exact-name" };
  }

  // Phase aliases are accepted only with a known, compatible completion year.
  // This prevents similarly named numbered complexes from being collapsed.
  if (trade.buildYear === null || !aliasName || aliasName === exactName) {
    return null;
  }
  const aliasCandidates = (
    index.byAlias.get(`${location}:${aliasName}`) ?? []
  ).filter((candidate) => candidate.record.buildYear !== null);
  const aliasMatch = selectUniqueCandidate(aliasCandidates, trade);
  return aliasMatch
    ? { masterId: aliasMatch.record.id, reason: "alias" }
    : null;
}

export function matchTradeToMaster(
  master: readonly MasterMatchRecord[],
  trade: TradeMatchRecord,
) {
  return matchTradeWithIndex(buildMasterTradeIndex(master), trade);
}

export function createMasterTradeMatcher(master: readonly MasterMatchRecord[]) {
  const index = buildMasterTradeIndex(master);
  return (trade: TradeMatchRecord) => matchTradeWithIndex(index, trade);
}

export function groupTradesByMaster<T extends TradeMatchRecord>(
  master: readonly MasterMatchRecord[],
  trades: readonly T[],
) {
  const index = buildMasterTradeIndex(master);
  const tradesByMasterId = new Map<string, T[]>();
  let matchedTradeCount = 0;

  trades.forEach((trade) => {
    const match = matchTradeWithIndex(index, trade);
    if (!match) return;
    tradesByMasterId.set(match.masterId, [
      ...(tradesByMasterId.get(match.masterId) ?? []),
      trade,
    ]);
    matchedTradeCount += 1;
  });

  return {
    tradesByMasterId,
    matchedTradeCount,
    unmatchedTradeCount: trades.length - matchedTradeCount,
  };
}
