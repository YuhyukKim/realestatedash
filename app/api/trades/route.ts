import { DISTRICT_CODES, sampleTrades, type Trade } from "../../data";

export const dynamic = "force-dynamic";

const API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function tag(block: string, ...names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
    if (match) return decodeXml(match[1].trim());
  }
  return "";
}

function parseTrades(xml: string, district: string): Trade[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items
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
      } satisfies Trade;
    })
    .filter((trade): trade is Trade => trade !== null);
}

async function fetchDistrict(
  district: keyof typeof DISTRICT_CODES,
  month: string,
  serviceKey: string,
) {
  const url = new URL(API_URL);
  let normalizedKey = serviceKey;
  try {
    normalizedKey = decodeURIComponent(serviceKey);
  } catch {
    // Keep the original key when it is not URI encoded.
  }
  url.searchParams.set("serviceKey", normalizedKey);
  url.searchParams.set("LAWD_CD", DISTRICT_CODES[district]);
  url.searchParams.set("DEAL_YMD", month);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${district} 데이터 조회 실패 (${response.status})`);
  }

  const xml = await response.text();
  const resultCode = tag(xml, "resultCode");
  if (resultCode && resultCode !== "00" && resultCode !== "000") {
    throw new Error(tag(xml, "resultMsg") || `${district} API 오류`);
  }

  return parseTrades(xml, district);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month =
    url.searchParams.get("month")?.replace(/\D/g, "").slice(0, 6) || "202607";
  const serviceKey = process.env.MOLIT_API_KEY;

  if (!serviceKey) {
    return Response.json({
      mode: "demo",
      trades: sampleTrades,
      updatedAt: "2026-07-22T09:00:00+09:00",
      message: "공공데이터포털 API 키를 연결하면 실제 신고 자료로 자동 전환됩니다.",
    });
  }

  try {
    const districts = Object.keys(
      DISTRICT_CODES,
    ) as (keyof typeof DISTRICT_CODES)[];
    const batches: Trade[][] = [];

    for (let i = 0; i < districts.length; i += 5) {
      const batch = districts.slice(i, i + 5);
      batches.push(
        ...(await Promise.all(
          batch.map((district) =>
            fetchDistrict(district, month, serviceKey),
          ),
        )),
      );
    }

    return Response.json({
      mode: "live",
      trades: batches.flat(),
      updatedAt: new Date().toISOString(),
      message: "국토교통부 실거래 신고 자료",
    });
  } catch (error) {
    return Response.json({
      mode: "demo",
      trades: sampleTrades,
      updatedAt: "2026-07-22T09:00:00+09:00",
      message:
        error instanceof Error
          ? `${error.message} — 예시 데이터로 표시합니다.`
          : "실거래 조회 중 오류가 발생해 예시 데이터로 표시합니다.",
    });
  }
}

