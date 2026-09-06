import { DISTRICT_CODES, type Trade } from "../../data";

import { fetchMolitXml, isCanceledSale, tag, validMonth } from "../../molit-client";

import { getD1OrNull } from "../../../db";
import { replaceDistrictMonthSales } from "../../../db/area-sales";
import { getComplexSeed } from "../../../db/seed";
import { listComplexesFromSeed } from "../../../db/complexes";
const master = listComplexesFromSeed(getComplexSeed(), { limit: 20_000, offset: 0 }).complexes;

export const dynamic = "force-dynamic";

const API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

function parseTrades(xml: string, district: string): Trade[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items
    .filter((item) => !isCanceledSale(item))
    .map((item, index) => {
      const rawPrice = tag(item, "dealAmount", "거래금액").replaceAll(",", "");
      const year = tag(item, "dealYear", "년");
      const month = tag(item, "dealMonth", "월").padStart(2, "0");
      const day = tag(item, "dealDay", "일").padStart(2, "0");
      const price = Number(rawPrice) / 10_000;
      const area = Number(tag(item, "excluUseAr", "전용면적"));
      const buildYear = Number(tag(item, "buildYear", "건축년도")) || null;

      if (!price || !area) return null;

      return {
        id: `${district}-${year}${month}${day}-${index}-${tag(item, "aptSeq")}`,
        aptSeq: tag(item, "aptSeq") || null,
        district,
        dong: tag(item, "umdNm", "법정동"),
        apartment: tag(item, "aptNm", "아파트"),
        price: Number(price.toFixed(2)),
        area: Number(area.toFixed(2)),
        date: `${year}-${month}-${day}`,
        floor: Number(tag(item, "floor", "층")) || 0,
        buildYear,
        jibun: tag(item, "jibun", "지번") || null,
      } satisfies Trade;
    })
    .filter((trade): trade is Trade => trade !== null);
}

async function fetchDistrict(
  district: keyof typeof DISTRICT_CODES,
  month: string,
  serviceKey: string,
  signal?: AbortSignal,
) {
  const xml = await fetchMolitXml(API_URL, DISTRICT_CODES[district], month, serviceKey, signal);
  return parseTrades(xml, district);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month")?.replace(/\D/g, "").slice(0, 6) || "202607";
  const requestedDistrict = url.searchParams.get("district");
  if (!validMonth(month)) return Response.json({ message: "조회 월이 올바르지 않습니다." }, { status: 400 });
  if (requestedDistrict && !Object.hasOwn(DISTRICT_CODES, requestedDistrict)) {
    return Response.json({ message: "조회 지역이 올바르지 않습니다." }, { status: 400 });
  }
  const serviceKey = process.env.MOLIT_API_KEY;
  const headers = { "Cache-Control": "no-store" };
  if (!serviceKey) return Response.json({
    mode: "unavailable", trades: [], completedDistricts: [], failedDistricts: [],
    updatedAt: new Date().toISOString(), message: "실거래 API가 연결되지 않아 가격을 표시하지 않습니다.",
  }, { headers });

  const districts = (requestedDistrict ? [requestedDistrict] : Object.keys(DISTRICT_CODES)) as (keyof typeof DISTRICT_CODES)[];
  // Bound the whole response, including paging and retries, not just each fetch.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
  const d1 = getD1OrNull();
  const trades: Trade[] = [];
  const completedDistricts: string[] = [];
  const failedDistricts: { district: string; reason: string }[] = [];
  let storageFailed = !d1;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, districts.length) }, async () => {
    while (cursor < districts.length) {
      const district = districts[cursor++];
      try {
        signal.throwIfAborted();
        const rows = await fetchDistrict(district, month, serviceKey, signal);
        trades.push(...rows);
        completedDistricts.push(district);
        if (d1) {
          try { await replaceDistrictMonthSales(d1, master, district, month, rows); }
          catch { storageFailed = true; }
        }
      } catch (error) {
        failedDistricts.push({ district, reason: signal.aborted ? "조회 제한시간 초과 또는 요청 취소"
          : error instanceof Error ? error.message : "실거래 조회 실패" });
      }
    }
  }));
  trades.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  completedDistricts.sort();
  failedDistricts.sort((a, b) => a.district.localeCompare(b.district));
  const mode = completedDistricts.length === 0 ? "unavailable" : failedDistricts.length ? "partial" : "live";
  const message = failedDistricts.length
    ? `매매 조회 ${completedDistricts.length}/${districts.length}개 구 완료. 미조회: ${failedDistricts.map((f) => f.district + " (" + f.reason + ")").join(", ")}. 성공한 지역과 저장된 가격만 표시합니다.`
    : storageFailed ? "국토교통부 실거래 신고 자료 · 면적별 DB 저장 미완료" : "국토교통부 실거래 신고 자료 · 면적별 최근 매매 DB 저장 완료";
  return Response.json({ mode, trades, completedDistricts, failedDistricts, storageFailed,
    updatedAt: new Date().toISOString(), message }, { headers });
}
