import { getNearbyStations, STATION_CATALOG, type NearbyStation } from "./stations";

export type WorkplaceId =
  | "gwanghwamun"
  | "gangnam"
  | "yeouido"
  | "gasan"
  | "magoknaru"
  | "pangyo";

export type Workplace = {
  id: WorkplaceId;
  name: string;
  label: string;
  directLines: readonly string[];
  description: string;
};

export type StationOption = {
  value: string;
  name: string;
  label: string;
  lines: readonly string[];
  linesLabel: string;
};

export type DirectLineMatch = {
  workplace: Workplace;
  station: NearbyStation;
  sharedLines: readonly string[];
};

const LINE_ALIASES: Record<string, string> = {
  경의중앙: "경의중앙선",
  경의중앙선: "경의중앙선",
  경춘: "경춘선",
  경춘선: "경춘선",
  경강: "경강선",
  경강선: "경강선",
  공항: "공항철도",
  공항선: "공항철도",
  공항철도: "공항철도",
  수인분당: "수인분당선",
  수인분당선: "수인분당선",
  신분당: "신분당선",
  신분당선: "신분당선",
  신림: "신림선",
  신림선: "신림선",
  우이신설: "우이신설선",
  우이신설선: "우이신설선",
};

const LINE_ORDER = [
  "1호선",
  "2호선",
  "3호선",
  "4호선",
  "5호선",
  "6호선",
  "7호선",
  "8호선",
  "9호선",
  "신분당선",
  "수인분당선",
  "경의중앙선",
  "공항철도",
  "경춘선",
  "경강선",
  "신림선",
  "우이신설선",
] as const;

/**
 * Converts display strings such as `2·8호선`, `1 / 5호선`,
 * `경의·중앙선`, and `공항철도` into stable, comparable line names.
 */
export function parseTransitLines(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .replace(/경의\s*[·ㆍ-]\s*중앙선?/g, "경의중앙선")
    .replace(/\s+/g, "")
    .replace(/[ㆍ,|/+&]/g, "·");

  const tokens = normalized
    .split("·")
    .flatMap((part) => {
      const matches = part.match(
        /인천[12]호선|\d{1,2}(?:호선)?|수인분당선?|신분당선?|경의중앙선?|경춘선?|경강선?|공항철도|공항선|신림선?|우이신설선?/g,
      );
      return matches ?? [part];
    })
    .map((token) => {
      const compact = token.trim();
      const numeric = compact.match(/^(\d{1,2})(?:호선)?$/);
      if (numeric) return `${Number(numeric[1])}호선`;
      return LINE_ALIASES[compact] ?? compact;
    })
    .filter(Boolean);

  return Array.from(new Set(tokens)).sort(compareLines);
}

function compareLines(left: string, right: string) {
  const leftIndex = LINE_ORDER.indexOf(left as (typeof LINE_ORDER)[number]);
  const rightIndex = LINE_ORDER.indexOf(right as (typeof LINE_ORDER)[number]);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right, "ko-KR");
}

export const WORKPLACES: readonly Workplace[] = [
  {
    id: "gwanghwamun",
    name: "광화문",
    label: "광화문 업무권 직통권",
    directLines: ["1호선", "2호선", "3호선", "5호선"],
    description: "광화문·시청·종각·경복궁 업무권역까지 환승 없이 접근 가능한 노선 기준",
  },
  {
    id: "gangnam",
    name: "강남",
    label: "강남역 직통권",
    directLines: ["2호선", "신분당선"],
    description: "강남역까지 환승 없이 접근 가능한 노선 기준",
  },
  {
    id: "yeouido",
    name: "여의도",
    label: "여의도 직통권",
    directLines: ["5호선", "9호선"],
    description: "여의도역까지 환승 없이 접근 가능한 노선 기준",
  },
  {
    id: "gasan",
    name: "가산디지털단지",
    label: "가산디지털단지 직통권",
    directLines: ["1호선", "7호선"],
    description: "가산디지털단지역까지 환승 없이 접근 가능한 노선 기준",
  },
  {
    id: "magoknaru",
    name: "마곡나루",
    label: "마곡나루 직통권",
    directLines: ["9호선", "공항철도"],
    description: "마곡나루역까지 환승 없이 접근 가능한 노선 기준",
  },
  {
    id: "pangyo",
    name: "판교",
    label: "판교 직통권",
    directLines: ["신분당선", "경강선"],
    description: "판교역까지 환승 없이 접근 가능한 노선 기준",
  },
] as const;

export const WORKPLACE_BY_ID = Object.fromEntries(
  WORKPLACES.map((workplace) => [workplace.id, workplace]),
) as Record<WorkplaceId, Workplace>;

function buildStationOptions(): StationOption[] {
  // Keep each line's station ID separate; equal names need not be a transfer.
  return STATION_CATALOG
    .map((station) => {
      const { name } = station;
      const lines = parseTransitLines(station.lines);
      const linesLabel = lines.join("·");
      return {
        value: station.key,
        name,
        lines,
        linesLabel,
        label: `${name}역${linesLabel ? ` · ${linesLabel}` : ""}`,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
}

/** Official station coordinates, including central Seoul. */
export const STATION_OPTIONS: readonly StationOption[] = buildStationOptions();

export function findDirectLineMatch(
  stations: readonly NearbyStation[],
  workplaceId: WorkplaceId,
): DirectLineMatch | null {
  const workplace = WORKPLACE_BY_ID[workplaceId];
  const candidates = stations
    .map((station) => ({
      station,
      sharedLines: parseTransitLines(station.lines).filter((line) =>
        workplace.directLines.includes(line),
      ),
    }))
    .filter((candidate) => candidate.sharedLines.length > 0)
    .sort(
      (left, right) =>
        left.station.distanceMeters - right.station.distanceMeters,
    );

  const best = candidates[0];
  return best
    ? {
        workplace,
        station: best.station,
        sharedLines: best.sharedLines,
      }
    : null;
}

export function getDirectWorkplaceMatch(
  complexId: string,
  workplaceId: WorkplaceId,
): DirectLineMatch | null {
  return findDirectLineMatch(
    getNearbyStations(complexId),
    workplaceId,
  );
}

export function hasDirectWorkplaceAccess(
  complexId: string,
  workplaceId: WorkplaceId,
): boolean {
  return getDirectWorkplaceMatch(complexId, workplaceId) !== null;
}
