import { DISTRICT_CODES } from "../../data";
import type {
  ComplexDetailResponse,
  ComplexTransaction,
} from "../../complex-types";
import { getNearbyStations } from "../../stations";

import { fetchMolitXml, isCanceledSale, tag, validMonth } from "../../molit-client";
import { createMasterTradeMatcher, normalizeApartmentName } from "../../master-trade-matcher";
import { getComplexSeed } from "../../../db/seed";
import { listComplexesFromSeed } from "../../../db/complexes";

// Use the same canonical membership and normalization as the master list.
const master = listComplexesFromSeed(getComplexSeed(), { limit: 20_000, offset: 0 }).complexes;
const masterById = new Map(master.map((record) => [record.id, record]));
const matchTrade = createMasterTradeMatcher(master);

export const dynamic = "force-dynamic";

const SALE_API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
const RENT_API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent";
const RENT_FIRST_MONTH = "201101";

function amount(value: string) {
  return Number(value.replaceAll(",", "").trim()) || 0;
}

function monthOrdinal(value: string) {
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(4, 6)) - 1;
}

function formatMonth(ordinal: number) {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}${String(month).padStart(2, "0")}`;
}

function monthsInRange(from: string, to: string) {
  if (!validMonth(from) || !validMonth(to)) return [];
  const start = monthOrdinal(from);
  const end = monthOrdinal(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start >= 12) return [];
  return Array.from({ length: end - start + 1 }, (_, index) =>
    formatMonth(start + index),
  );
}

function isSelectedComplex(item: string, complexId: string, district: string) {
  return matchTrade({
    apartment: tag(item, "aptNm", "아파트"),
    district,
    dong: tag(item, "umdNm", "법정동"),
    jibun: tag(item, "jibun", "지번") || null,
    buildYear: Number(tag(item, "buildYear", "건축년도")) || null,
  })?.masterId === complexId;
}

function parseSaleTransactions(
  xml: string,
  complexId: string,
  district: string,
) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .filter((item) => !isCanceledSale(item))
    .filter((item) => isSelectedComplex(item, complexId, district))
    .map((item, index) => {
      const year = tag(item, "dealYear", "년");
      const month = tag(item, "dealMonth", "월").padStart(2, "0");
      const day = tag(item, "dealDay", "일").padStart(2, "0");
      const price = amount(tag(item, "dealAmount", "거래금액")) / 10_000;
      const area = Number(tag(item, "excluUseAr", "전용면적"));
      if (!price || !area || !year || !month || !day) return null;

      return {
        id: `sale-${year}${month}${day}-${index}-${tag(item, "aptSeq")}`,
        type: "sale",
        date: `${year}-${month}-${day}`,
        price: Number(price.toFixed(2)),
        monthlyRent: 0,
        area: Number(area.toFixed(2)),
        floor: Number(tag(item, "floor", "층")) || 0,
      } satisfies ComplexTransaction;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function parseRentTransactions(
  xml: string,
  complexId: string,
  district: string,
) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .filter((item) => isSelectedComplex(item, complexId, district))
    .map((item, index) => {
      const year = tag(item, "dealYear", "년");
      const month = tag(item, "dealMonth", "월").padStart(2, "0");
      const day = tag(item, "dealDay", "일").padStart(2, "0");
      const deposit = amount(tag(item, "deposit", "보증금액")) / 10_000;
      const monthlyRent = amount(tag(item, "monthlyRent", "월세금액"));
      const area = Number(tag(item, "excluUseAr", "전용면적"));
      if ((!deposit && !monthlyRent) || !area || !year || !month || !day) {
        return null;
      }

      const type = monthlyRent > 0 ? "monthly" : "jeonse";
      return {
        id: `${type}-${year}${month}${day}-${index}-${tag(item, "aptSeq")}`,
        type,
        date: `${year}-${month}-${day}`,
        price: Number(deposit.toFixed(2)),
        monthlyRent,
        area: Number(area.toFixed(2)),
        floor: Number(tag(item, "floor", "층")) || 0,
      } satisfies ComplexTransaction;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedId = url.searchParams.get("complexId");
  const requestedDistrict = url.searchParams.get("district") ?? "";
  const requestedDong = url.searchParams.get("dong") ?? "";
  const requestedApartment = url.searchParams.get("apartment") ?? "";
  const candidates = requestedId ? [] : master.filter((record) =>
    record.district === requestedDistrict && record.dong === requestedDong &&
    normalizeApartmentName(record.name) === normalizeApartmentName(requestedApartment));
  const selected = requestedId ? masterById.get(requestedId) : candidates.length === 1 ? candidates[0] : undefined;
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
  const nearbyStations = getNearbyStations(district, dong);
  const nearbyStationsNote = "법정동 중심 직선거리 추정 · 실제 도보경로와 다를 수 있습니다.";
  const respond = (mode: ComplexDetailResponse["mode"], transactions: ComplexTransaction[], message: string) =>
    Response.json({ mode, complex, nearbyStations, nearbyStationsNote, transactions, message } satisfies ComplexDetailResponse,
      { headers: { "Cache-Control": "no-store" } });
  const serviceKey = process.env.MOLIT_API_KEY;
  if (!serviceKey) return respond("unavailable", [], "실거래 API가 연결되지 않았습니다. 확인되지 않은 가격은 표시하지 않습니다.");
  if (!selected) return Response.json({ message: "단지를 특정할 수 없습니다. 목록에서 다시 선택해 주세요." }, { status: 404 });

  const transactions: ComplexTransaction[] = [];
  const failed: string[] = [];
  let successCount = 0;
  for (let index = 0; index < months.length; index += 3) {
    await Promise.all(months.slice(index, index + 3).map(async (month) => {
      await Promise.all([
        { endpoint: SALE_API_URL, label: "매매", parse: parseSaleTransactions },
        ...(month >= RENT_FIRST_MONTH ? [{ endpoint: RENT_API_URL, label: "전월세", parse: parseRentTransactions }] : []),
      ].map(async ({ endpoint, label, parse }) => {
        try {
          // A failed later page discards the entire month/type, never a silent partial month.
          const xml = await fetchMolitXml(endpoint, districtCode, month, serviceKey);
          transactions.push(...parse(xml, selected.id, district));
          successCount += 1;
        } catch {
          failed.push(`${month.slice(0, 4)}-${month.slice(4)} ${label}`);
        }
      }));
    }));
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  return respond(
    !successCount ? "unavailable" : failed.length ? "partial" : "live",
    transactions,
    failed.length
      ? `조회 실패: ${failed.sort().join(", ")}. 성공한 기간만 표시합니다. 확인되지 않은 가격은 표시하지 않습니다.`
      : "국토교통부 매매·전월세 실거래 신고 자료 · 해제 거래 제외",
  );
}
