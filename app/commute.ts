import { parseTransitLines, type WorkplaceId } from "./access";
import { getNearbyStations, type NearbyStation } from "./stations";

export type WorkplaceCommuteEstimate = {
  workplaceId: WorkplaceId;
  workplaceName: string;
  destinationStation: string;
  station: NearbyStation;
  line: string;
  stopCount: number;
  estimatedMinutes: number;
};

type WorkplaceRoute = {
  workplaceName: string;
  destinationStation: string;
  lines: Readonly<Record<string, readonly (readonly string[])[]>>;
};

// Station order sources:
// - Seoul Metro Lines 1–8 distance/time data: https://data.seoul.go.kr/dataList/OA-12034/S/1/datasetView.do
// - Korea National Railway Line 9 distance data: https://www.data.go.kr/data/15041298/fileData.do
const LINE_5_COMMON = [
  "방화",
  "개화산",
  "김포공항",
  "송정",
  "마곡",
  "발산",
  "우장산",
  "화곡",
  "까치산",
  "신정",
  "목동",
  "오목교",
  "양평",
  "영등포구청",
  "영등포시장",
  "신길",
  "여의도",
  "여의나루",
  "마포",
  "공덕",
  "애오개",
  "충정로",
  "서대문",
  "광화문",
  "종로3가",
  "을지로4가",
  "동대문역사문화공원",
  "청구",
  "신금호",
  "행당",
  "왕십리",
  "마장",
  "답십리",
  "장한평",
  "군자",
  "아차산",
  "광나루",
  "천호",
  "강동",
] as const;

const YEOUIDO_ROUTES = {
  "5호선": [
    [
      ...LINE_5_COMMON,
      "길동",
      "굽은다리",
      "명일",
      "고덕",
      "상일동",
      "강일",
      "미사",
      "하남풍산",
      "하남시청",
      "하남검단산",
    ],
    [
      ...LINE_5_COMMON,
      "둔촌동",
      "올림픽공원",
      "방이",
      "오금",
      "개롱",
      "거여",
      "마천",
    ],
  ],
  "9호선": [
    [
      "개화",
      "김포공항",
      "공항시장",
      "신방화",
      "마곡나루",
      "양천향교",
      "가양",
      "증미",
      "등촌",
      "염창",
      "신목동",
      "선유도",
      "당산",
      "국회의사당",
      "여의도",
      "샛강",
      "노량진",
      "노들",
      "흑석",
      "동작",
      "구반포",
      "신반포",
      "고속터미널",
      "사평",
      "신논현",
      "언주",
      "선정릉",
      "삼성중앙",
      "봉은사",
      "종합운동장",
      "삼전",
      "석촌고분",
      "석촌",
      "송파나루",
      "한성백제",
      "올림픽공원",
      "둔촌오륜",
      "중앙보훈병원",
    ],
  ],
} as const;

const WORKPLACE_ROUTES: Partial<Record<WorkplaceId, WorkplaceRoute>> = {
  yeouido: {
    workplaceName: "여의도",
    destinationStation: "여의도",
    lines: YEOUIDO_ROUTES,
  },
};

/**
 * Whether the selected workplace has a verified direct-line station order.
 * The first release covers Yeouido's Line 5 and Line 9 approaches.
 */
export function supportsWorkplaceCommuteSort(
  workplaceId: WorkplaceId | "",
): workplaceId is "yeouido" {
  return Boolean(workplaceId && WORKPLACE_ROUTES[workplaceId]);
}

function getStopCount(
  routes: readonly (readonly string[])[],
  originStation: string,
  destinationStation: string,
) {
  const stopCounts = routes.flatMap((route) => {
    const originIndex = route.indexOf(originStation);
    const destinationIndex = route.indexOf(destinationStation);
    return originIndex === -1 || destinationIndex === -1
      ? []
      : [Math.abs(originIndex - destinationIndex)];
  });
  return stopCounts.length ? Math.min(...stopCounts) : null;
}

/**
 * Returns the best direct approach among coordinate-verified stations within 1.5km.
 * This is deliberately a comparable estimate, not a claim of door-to-door time:
 * straight-line walking estimate + two minutes per direct subway stop. Waiting,
 * congestion, express services, and platform transfers are not included.
 */
export function getWorkplaceCommuteEstimate(
  complexId: string,
  workplaceId: WorkplaceId,
): WorkplaceCommuteEstimate | null {
  const workplaceRoute = WORKPLACE_ROUTES[workplaceId];
  if (!workplaceRoute) return null;

  const candidates = getNearbyStations(complexId).flatMap((station) =>
    parseTransitLines(station.lines).flatMap((line) => {
      const routes = workplaceRoute.lines[line];
      if (!routes) return [];
      const stopCount = getStopCount(
        routes,
        station.name,
        workplaceRoute.destinationStation,
      );
      if (stopCount === null) return [];
      return [
        {
          workplaceId,
          workplaceName: workplaceRoute.workplaceName,
          destinationStation: workplaceRoute.destinationStation,
          station,
          line,
          stopCount,
          estimatedMinutes: station.walkMinutes + stopCount * 2,
        },
      ];
    }),
  );

  return (
    candidates.sort(
      (left, right) =>
        left.estimatedMinutes - right.estimatedMinutes ||
        left.stopCount - right.stopCount ||
        left.station.distanceMeters - right.station.distanceMeters ||
        left.station.name.localeCompare(right.station.name, "ko-KR"),
    )[0] ?? null
  );
}

export function compareWorkplaceCommutes(
  left: WorkplaceCommuteEstimate | null,
  right: WorkplaceCommuteEstimate | null,
  direction: "asc" | "desc",
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const minuteDifference =
    direction === "asc"
      ? left.estimatedMinutes - right.estimatedMinutes
      : right.estimatedMinutes - left.estimatedMinutes;
  if (minuteDifference) return minuteDifference;

  const stopDifference =
    direction === "asc"
      ? left.stopCount - right.stopCount
      : right.stopCount - left.stopCount;
  if (stopDifference) return stopDifference;

  return direction === "asc"
    ? left.station.distanceMeters - right.station.distanceMeters
    : right.station.distanceMeters - left.station.distanceMeters;
}
