import { canonicalComplexId, complexIdentityNames } from "../../../lib/complex-identity.mjs";
import { DISTRICT_CODES } from "../../data";
import type {
  ComplexDetailResponse,
  ComplexTransaction,
} from "../../complex-types";
import { getNearbyStations, STATION_DISTANCE_NOTE } from "../../stations";

import { validRecordMonth } from "../../../lib/molit-records.mjs";
import { getD1OrNull } from "../../../db";
import { readStoredDetail } from "../../../db/trade-store";
import { normalizeApartmentName } from "../../master-trade-matcher";
import { getComplexSeed } from "../../../db/seed";
import { listComplexesFromSeed } from "../../../db/complexes";

// Use the same canonical membership and normalization as the master list.
const master = listComplexesFromSeed(getComplexSeed(), { limit: 20_000, offset: 0 }).complexes;
const masterById = new Map(master.map((record) => [record.id, record]));

export const dynamic = "force-dynamic";

const RENT_FIRST_MONTH = "201101";

function monthOrdinal(value: string) {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(4, 6)) - 1;
}

function formatMonth(ordinal: number) {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}${String(month).padStart(2, "0")}`;
}

function monthsInRange(from: string, to: string) {
  if (!validRecordMonth(from, "sale") || !validRecordMonth(to, "sale")) return [];
  const start = monthOrdinal(from);
  const end = monthOrdinal(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start >= 12) return [];
  return Array.from({ length: end - start + 1 }, (_, index) =>
    formatMonth(start + index),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedId = url.searchParams.get("complexId");
  const requestedDistrict = url.searchParams.get("district") ?? "";
  const requestedDong = url.searchParams.get("dong") ?? "";
  const requestedApartment = url.searchParams.get("apartment") ?? "";
  const candidates = requestedId ? [] : master.filter((record) =>
    record.district === requestedDistrict && record.dong === requestedDong &&
    complexIdentityNames(record.id, record.name).some(name => normalizeApartmentName(name) === normalizeApartmentName(requestedApartment)));
  const selected = requestedId ? masterById.get(canonicalComplexId(requestedId)) : candidates.length === 1 ? candidates[0] : undefined;
  if (requestedId && !selected) return Response.json({ message: "단지 ID를 찾을 수 없습니다." }, { status: 404 });
  const district = selected?.district ?? requestedDistrict;
  const dong = selected?.dong ?? requestedDong;
  const apartment = selected?.name ?? requestedApartment;
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const months = monthsInRange(from, to);
  const districtCode = DISTRICT_CODES[district as keyof typeof DISTRICT_CODES];
  if (!districtCode || !apartment || !months.length) {
    return Response.json({ message: "조회 조건이 올바르지 않습니다." }, { status: 400 });
  }

  const complex = { district, dong, apartment, buildYear: selected?.buildYear ?? null };
  const nearbyStations = getNearbyStations(selected?.id ?? "");
  const nearbyStationsNote = STATION_DISTANCE_NOTE;
  const respond = (mode: ComplexDetailResponse["mode"], transactions: ComplexTransaction[], message: string,
    missing: { month: string; kind: "sale" | "rent" }[], fetchedAt: string | null) =>
    Response.json({ mode, complex, nearbyStations, nearbyStationsNote, transactions, message, missing, fetchedAt } satisfies ComplexDetailResponse,
      { headers: { "Cache-Control": "no-store" } });
  if (!selected) return Response.json({ message: "단지를 특정할 수 없습니다. 목록에서 다시 선택해 주세요." }, { status: 404 });
  const expected = months.flatMap(month => [
    { month, kind: "sale" as const },
    ...(month >= RENT_FIRST_MONTH ? [{ month, kind: "rent" as const }] : []),
  ]);
  const unavailable = (message: string) => respond("unavailable", [], message, expected, null);
  try {
    const db = getD1OrNull();
    if (!db) return unavailable("실거래 저장 DB에 연결되지 않았습니다. 미확인 가격은 표시하지 않습니다.");
    const { heads, transactions } = await readStoredDetail(db, selected.id, district, from, to);
    const complete = new Set(heads.map(head => head.month + ":" + head.kind));
    const missing = expected.filter(item => !complete.has(item.month + ":" + item.kind));
    const fetchedAt = heads.map(head => head.fetched_at).sort().at(-1) ?? null;
    return respond(!heads.length ? "unavailable" : missing.length ? "partial" : "stored", transactions,
      !heads.length ? "이 기간은 아직 수집하지 않았습니다. 거래 0건을 뜻하지 않습니다."
        : missing.length ? "일부 월·거래유형은 미수집입니다. 수집 완료된 자료만 표시합니다."
        : "국토교통부 실거래 저장 자료 · 매매 해제 거래 제외 · 가격은 계약일 기준입니다.",
      missing, fetchedAt);
  } catch {
    return unavailable("저장된 실거래 조회에 실패했습니다. 수집 여부를 확인할 수 없습니다.");
  }
}
