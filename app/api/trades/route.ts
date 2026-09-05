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
) {
  const xml = await fetchMolitXml(API_URL, DISTRICT_CODES[district], month, serviceKey);
  return parseTrades(xml, district);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month =
    url.searchParams.get("month")?.replace(/\D/g, "").slice(0, 6) || "202607";
  if (!validMonth(month)) return Response.json({ message: "조회 월이 올바르지 않습니다." }, { status: 400 });
  const serviceKey = process.env.MOLIT_API_KEY;

  if (!serviceKey) {
    return Response.json({
      mode: "unavailable",
      trades: [],
      updatedAt: new Date().toISOString(),
      message: "실거래 API가 연결되지 않아 가격을 표시하지 않습니다.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const districts = Object.keys(
      DISTRICT_CODES,
    ) as (keyof typeof DISTRICT_CODES)[];
    const batches: Trade[][] = [];
    const d1 = getD1OrNull();
    let storageFailed = !d1;

    for (let i = 0; i < districts.length; i += 5) {
      const batch = districts.slice(i, i + 5);
      batches.push(
        ...(await Promise.all(
          batch.map(async (district) => {
            const trades = await fetchDistrict(district, month, serviceKey);
            if (d1) {
              try { await replaceDistrictMonthSales(d1, master, district, month, trades); }
              catch { storageFailed = true; }
            }
            return trades;
          }),
        )),
      );
    }

    return Response.json({
      mode: "live",
      trades: batches.flat(),
      updatedAt: new Date().toISOString(),
      message: storageFailed ? "국토교통부 실거래 신고 자료 · 면적별 DB 저장 미완료" : "국토교통부 실거래 신고 자료 · 면적별 최근 매매 DB 저장 완료",
    });
  } catch (error) {
    return Response.json({
      mode: "unavailable",
      trades: [],
      updatedAt: new Date().toISOString(),
      message:
        error instanceof Error
          ? `${error.message} — 확인되지 않은 가격은 표시하지 않습니다.`
          : "실거래 조회에 실패해 가격을 표시하지 않습니다.",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
