import { canonicalComplexId, RETIRED_COMPLEX_IDS } from "../lib/complex-identity.mjs";
import coordinates from "./transit-coordinates.json";

export type NearbyStation = {
  key?: string;
  name: string;
  lines: string;
  distanceMeters: number;
  walkMinutes: number;
};
export type Coordinate = { latitude: number; longitude: number };
export type StationPoint = Coordinate & { key: string; name: string; lines: string };

export const STATION_CATALOG: readonly StationPoint[] = coordinates.stations;
// The source artifact retains its raw catalogue scope; UI uses reviewed identities.
export const TRANSIT_COVERAGE = {
  ...coordinates.coverage,
  sourceComplexes: coordinates.coverage.totalComplexes,
  totalComplexes: coordinates.coverage.totalComplexes - RETIRED_COMPLEX_IDS.length,
  geocodedComplexes: new Set(Object.keys(coordinates.complexes).map(canonicalComplexId)).size,
};
export const NEARBY_RADIUS_METERS = 1500;
export const STATION_DISTANCE_NOTE = "서울시 단지·역사 대표 좌표 간 직선거리(출입구·보행경로 아님) · 인근역 반경 1.5km · 도보는 분당 65m 단순 환산 추정";
const complexPoints = coordinates.complexes as Record<string, number[]>;
const cache = new Map<string, NearbyStation[]>();

export function getComplexCoordinates(id: string): Coordinate | null {
  const point = complexPoints[canonicalComplexId(id)];
  return Array.isArray(point) && point.length === 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    point[0] >= 37.4 && point[0] <= 37.75 && point[1] >= 126.7 && point[1] <= 127.25
    ? { latitude: point[0], longitude: point[1] } : null;
}

export function straightLineMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function getStationDistances(point: Coordinate | null, stations: readonly StationPoint[] = STATION_CATALOG): NearbyStation[] {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return [];
  return stations.map((station) => {
    const distanceMeters = straightLineMeters(point, station);
    return { key: station.key, name: station.name, lines: station.lines, distanceMeters, walkMinutes: Math.max(1, Math.round(distanceMeters / 65)) };
  }).filter((station) => station.distanceMeters <= NEARBY_RADIUS_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || (a.key ?? "").localeCompare(b.key ?? ""));
}

/** No district/dong fallback: unknown coordinates must never produce invented distances. */
export function getNearbyStations(complexId: string): NearbyStation[] {
  if (!cache.has(complexId)) cache.set(complexId, getStationDistances(getComplexCoordinates(complexId)));
  return cache.get(complexId)!;
}

/** OR across selected stations; the radius must apply to that same station. */
export function selectNearbyStation(stations: readonly NearbyStation[], selectedKeys: readonly string[], maxMeters: number): NearbyStation | null {
  return stations.filter((station) =>
    (!selectedKeys.length || selectedKeys.includes(station.key ?? "")) && station.distanceMeters <= maxMeters,
  ).sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
}

/** Distinguish absent coordinates from a measured radius with no registered station. */
export function stationAvailabilityMessage(complexId: string): string {
  if (!getComplexCoordinates(complexId)) return "단지 좌표 미확인 · 교통조건 확인 필요";
  return getNearbyStations(complexId).length
    ? "좌표 확인 · 인근 등록 역 정보 있음"
    : "좌표 확인 · 반경 1.5km 내 등록된 역 없음";
}
