import { DISTRICT_CODES, sampleTrades } from "../../data";
import type {
  ComplexDetailResponse,
  ComplexTransaction,
} from "../../complex-types";
import { getNearbyStations } from "../../stations";

export const dynamic = "force-dynamic";

const SALE_API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
const RENT_API_URL =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent";
const RENT_FIRST_MONTH = "201101";

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

function amount(value: string) {
  return Number(value.replaceAll(",", "").trim()) || 0;
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function normalizeServiceKey(serviceKey: string) {
  try {
    return decodeURIComponent(serviceKey);
  } catch {
    return serviceKey;
  }
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
  const start = monthOrdinal(from);
  const end = monthOrdinal(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) =>
    formatMonth(start + index),
  );
}

function isSelectedComplex(
  item: string,
  apartment: string,
  dong: string,
  aptSeq: string,
) {
  const itemApartment = tag(item, "aptNm", "아파트");
  const itemDong = tag(item, "umdNm", "법정동");
  const itemAptSeq = tag(item, "aptSeq");

  if (aptSeq && itemAptSeq && aptSeq === itemAptSeq) return true;
  return (
    normalizeName(itemApartment) === normalizeName(apartment) &&
    (!dong || normalizeName(itemDong) === normalizeName(dong))
  );
}

function parseSaleTransactions(
  xml: string,
  apartment: string,
  dong: string,
  aptSeq: string,
) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .filter((item) => isSelectedComplex(item, apartment, dong, aptSeq))
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
    .filter((item): item is ComplexTransaction => item !== null);
}

function parseRentTransactions(
  xml: string,
  apartment: string,
  dong: string,
  aptSeq: string,
) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .filter((item) => isSelectedComplex(item, apartment, dong, aptSeq))
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
    .filter((item): item is ComplexTransaction => item !== null);
}

async function fetchMonth(
  endpoint: string,
  districtCode: string,
  month: string,
  serviceKey: string,
) {
  const url = new URL(endpoint);
  url.searchParams.set("serviceKey", normalizeServiceKey(serviceKey));
  url.searchParams.set("LAWD_CD", districtCode);
  url.searchParams.set("DEAL_YMD", month);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "1000");
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const isHistorical = monthOrdinal(month) < monthOrdinal(currentMonth) - 3;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      next: { revalidate: isHistorical ? 2_592_000 : 21_600 },
    } as RequestInit & { next: { revalidate: number } });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      throw new Error(`공공데이터 조회 실패 (${response.status})`);
    }

    const xml = await response.text();
    const resultCode = tag(xml, "resultCode");
    if (resultCode && resultCode !== "00" && resultCode !== "000") {
      throw new Error(tag(xml, "resultMsg") || "공공데이터 API 오류");
    }
    return xml;
  }

  throw new Error("공공데이터 조회 실패");
}

function hash(value: string) {
  return [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
}

function createDemoTransactions(
  apartment: string,
  from: string,
  to: string,
  asOf: string,
  basePrice: number,
  baseArea: number,
) {
  const seed = hash(apartment);
  const anchor = monthOrdinal(asOf);
  const areas = [baseArea, Math.max(39, Number((baseArea * 0.7).toFixed(1)))];
  const transactions: ComplexTransaction[] = [];

  monthsInRange(from, to).forEach((month, index) => {
    const ordinal = monthOrdinal(month);
    const trend = Math.max(0.68, 1 + (ordinal - anchor) * 0.0045);
    const wave = 1 + Math.sin((ordinal + seed) * 0.72) * 0.035;
    const year = month.slice(0, 4);
    const monthPart = month.slice(4, 6);
    const area = areas[(ordinal + seed) % areas.length];

    if ((ordinal + seed) % 2 === 0) {
      transactions.push({
        id: `demo-sale-${month}-${index}`,
        type: "sale",
        date: `${year}-${monthPart}-${String(((seed + index * 7) % 25) + 1).padStart(2, "0")}`,
        price: Number((basePrice * trend * wave * (area / baseArea) ** 0.72).toFixed(2)),
        monthlyRent: 0,
        area,
        floor: ((seed + index * 3) % 28) + 2,
      });
    }

    if (month >= RENT_FIRST_MONTH && (ordinal + seed) % 2 === 1) {
      transactions.push({
        id: `demo-jeonse-${month}-${index}`,
        type: "jeonse",
        date: `${year}-${monthPart}-${String(((seed + index * 5) % 25) + 1).padStart(2, "0")}`,
        price: Number((basePrice * 0.56 * trend * wave * (area / baseArea) ** 0.72).toFixed(2)),
        monthlyRent: 0,
        area,
        floor: ((seed + index * 5) % 25) + 1,
      });
    }

    if (month >= RENT_FIRST_MONTH && (ordinal + seed) % 5 === 0) {
      transactions.push({
        id: `demo-monthly-${month}-${index}`,
        type: "monthly",
        date: `${year}-${monthPart}-${String(((seed + index * 11) % 25) + 1).padStart(2, "0")}`,
        price: Number((basePrice * 0.08 * trend * (area / baseArea) ** 0.72).toFixed(2)),
        monthlyRent: Math.max(45, Math.round(basePrice * 11 * (area / baseArea))),
        area,
        floor: ((seed + index * 7) % 22) + 1,
      });
    }
  });

  return transactions.sort((a, b) => b.date.localeCompare(a.date));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const district = url.searchParams.get("district") ?? "";
  const dong = url.searchParams.get("dong")?.slice(0, 30) ?? "";
  const apartment = url.searchParams.get("apartment")?.slice(0, 80) ?? "";
  const aptSeq = url.searchParams.get("aptSeq")?.slice(0, 40) ?? "";
  const from = url.searchParams.get("from")?.replace(/\D/g, "").slice(0, 6) ?? "";
  const to = url.searchParams.get("to")?.replace(/\D/g, "").slice(0, 6) ?? "";
  const asOf = url.searchParams.get("asOf")?.replace(/\D/g, "").slice(0, 6) || to;
  const buildYear = Number(url.searchParams.get("buildYear")) || null;
  const basePrice = Math.max(0.1, Number(url.searchParams.get("basePrice")) || 10);
  const baseArea = Math.max(1, Number(url.searchParams.get("baseArea")) || 84.9);
  const months = monthsInRange(from, to);
  const districtCode = DISTRICT_CODES[district as keyof typeof DISTRICT_CODES];

  if (!districtCode || !apartment || !months.length || months.length > 12) {
    return Response.json(
      { message: "조회 조건이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const matchedSample = sampleTrades.find(
    (trade) =>
      trade.district === district &&
      trade.dong === dong &&
      trade.apartment === apartment,
  );
  const complex = {
    district,
    dong,
    apartment,
    buildYear: buildYear ?? matchedSample?.buildYear ?? null,
  };
  const nearbyStations = getNearbyStations(district, dong);
  const nearbyStationsNote = "법정동 중심 직선거리 추정 · 실제 도보경로와 다를 수 있습니다.";
  const serviceKey = process.env.MOLIT_API_KEY;

  if (!serviceKey) {
    const response: ComplexDetailResponse = {
      mode: "demo",
      complex,
      nearbyStations,
      nearbyStationsNote,
      transactions: createDemoTransactions(
        apartment,
        from,
        to,
        asOf,
        matchedSample?.price ?? basePrice,
        matchedSample?.area ?? baseArea,
      ),
      message: "실거래 API 연결 전 예시 추이를 표시합니다.",
    };
    return Response.json(response);
  }

  try {
    const monthPayloads: ComplexTransaction[][] = [];
    const errors: Error[] = [];
    let saleSuccessCount = 0;
    let rentSuccessCount = 0;

    for (let index = 0; index < months.length; index += 3) {
      const batch = months.slice(index, index + 3);
      const batchPayloads = await Promise.all(
        batch.map(async (month) => {
          const [saleResult, rentResult] = await Promise.allSettled([
            fetchMonth(SALE_API_URL, districtCode, month, serviceKey),
            month >= RENT_FIRST_MONTH
              ? fetchMonth(RENT_API_URL, districtCode, month, serviceKey)
              : Promise.resolve(null),
          ]);
          const transactions: ComplexTransaction[] = [];

          if (saleResult.status === "fulfilled") {
            saleSuccessCount += 1;
            transactions.push(
              ...parseSaleTransactions(saleResult.value, apartment, dong, aptSeq),
            );
          } else {
            errors.push(
              saleResult.reason instanceof Error
                ? saleResult.reason
                : new Error("매매 실거래 조회 실패"),
            );
          }

          if (rentResult.status === "fulfilled" && rentResult.value !== null) {
            rentSuccessCount += 1;
            transactions.push(
              ...parseRentTransactions(rentResult.value, apartment, dong, aptSeq),
            );
          } else if (rentResult.status === "rejected") {
            errors.push(
              rentResult.reason instanceof Error
                ? rentResult.reason
                : new Error("전월세 실거래 조회 실패"),
            );
          }

          return transactions;
        }),
      );
      monthPayloads.push(...batchPayloads);
    }

    const needsRentData = months.some((month) => month >= RENT_FIRST_MONTH);
    if (!saleSuccessCount || (needsRentData && !rentSuccessCount)) {
      throw errors[0] ?? new Error("매매·전월세 실거래 조회 실패");
    }

    const response: ComplexDetailResponse = {
      mode: "live",
      complex,
      nearbyStations,
      nearbyStationsNote,
      transactions: monthPayloads
        .flat()
        .sort((a, b) => b.date.localeCompare(a.date)),
      message: errors.length
        ? `국토교통부 매매·전월세 실거래 신고 자료 · 일부 기간 ${errors.length}건 제외`
        : "국토교통부 매매·전월세 실거래 신고 자료",
    };
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const historicalChunk = monthOrdinal(to) < monthOrdinal(currentMonth) - 3;
    return Response.json(response, {
      headers: {
        "Cache-Control": historicalChunk
          ? "public, s-maxage=2592000, stale-while-revalidate=7776000"
          : "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    const response: ComplexDetailResponse = {
      mode: "demo",
      complex,
      nearbyStations,
      nearbyStationsNote,
      transactions: createDemoTransactions(
        apartment,
        from,
        to,
        asOf,
        matchedSample?.price ?? basePrice,
        matchedSample?.area ?? baseArea,
      ),
      message:
        error instanceof Error
          ? `${error.message} — 예시 추이로 표시합니다.`
          : "상세 실거래 조회 중 오류가 발생해 예시 추이로 표시합니다.",
    };
    return Response.json(response);
  }
}

