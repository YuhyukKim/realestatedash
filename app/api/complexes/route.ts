import {
  readComplexSeedProgress,
  listComplexesFromD1,
  listComplexesFromSeed,
  normalizeComplexName,
  seedComplexesIfEmpty,
  type ComplexListFilters,
} from "../../../db/complexes";
import { getD1OrNull } from "../../../db";
import { COMPLEX_SEED_VERSION, getComplexSeed } from "../../../db/seed";
import type { ComplexesApiResponse } from "../../complex-master";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 20_000;

function integerParam(value: string | null, min: number, max: number) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function decodeCursor(value: string | null) {
  if (!value) return 0;
  const match = /^offset:(\d+)$/.exec(value);
  return match ? Number(match[1]) : 0;
}

function getFilters(url: URL): ComplexListFilters {
  const transactionParam = url.searchParams.get("hasTransactions");
  const query = url.searchParams.get("q")?.trim();
  return {
    district: url.searchParams.get("district")?.trim() || undefined,
    dong: url.searchParams.get("dong")?.trim() || undefined,
    query: query ? normalizeComplexName(query).slice(0, 80) : undefined,
    buildYearMin: integerParam(
      url.searchParams.get("buildYearMin"),
      1800,
      2200,
    ),
    buildYearMax: integerParam(
      url.searchParams.get("buildYearMax"),
      1800,
      2200,
    ),
    hasTransactions:
      transactionParam === "true"
        ? true
        : transactionParam === "false"
          ? false
          : undefined,
    limit:
      integerParam(url.searchParams.get("limit"), 1, MAX_LIMIT) ??
      DEFAULT_LIMIT,
    offset: decodeCursor(url.searchParams.get("cursor")),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = getFilters(url);
  if (url.searchParams.get("seedOnly") === "1") {
    return Response.json({ message: "DB 적재는 인증된 관리자 POST 요청으로만 가능합니다." },
      { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  const seed = getComplexSeed();
  const d1 = getD1OrNull();

  if (d1) {
    try {
      const seedProgress = await readComplexSeedProgress(d1, seed, COMPLEX_SEED_VERSION);
      const useD1Master = seedProgress.complete && seedProgress.exact;
      const result = useD1Master
        ? await listComplexesFromD1(d1, filters, COMPLEX_SEED_VERSION)
        : listComplexesFromSeed(seed, filters);
      const response: ComplexesApiResponse = {
        mode: "live",
        complexes: result.complexes,
        updatedAt: new Date().toISOString(),
        message: useD1Master
          ? "서울 아파트 단지 마스터 DB를 기준으로 조회했습니다. 최근 거래가 없는 단지도 포함됩니다."
          : seedProgress.complete
            ? `DB에 이전 마스터 ${seedProgress.stale.toLocaleString()}개가 남아 있어, 검증된 내장 마스터 ${seedProgress.total.toLocaleString()}개만 표시합니다.`
            : `공식 단지 마스터 ${seedProgress.seeded.toLocaleString()}/${seedProgress.total.toLocaleString()}개 DB 적재. 목록은 검증된 내장 마스터를 사용하며 실거래 수집 범위와 다릅니다.`,
        seedProgress,
      };
      return Response.json(response, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    } catch (error) {
      console.error("Failed to read apartment complexes from D1", error);
    }
  }

  const result = listComplexesFromSeed(seed, filters);
  const response: ComplexesApiResponse = {
    mode: "demo",
    complexes: result.complexes,
    updatedAt: new Date().toISOString(),
    message:
      "단지 DB를 준비하는 동안 내장 단지 마스터를 표시합니다. 최근 거래가 없는 단지도 포함됩니다.",
  };
  return Response.json(response, {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}

/** Operators only. Apply schema migrations through deployment before seeding. */
export async function POST(request: Request) {
  const expected = process.env.DATA_REFRESH_TOKEN;
  if (!expected || expected.length < 32) return Response.json({ message: "관리자 적재가 설정되지 않았습니다." }, { status: 503 });
  const provided = request.headers.get("authorization") ?? "";
  const encode = (value: string) => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(provided)),
    crypto.subtle.digest("SHA-256", encode("Bearer " + expected)),
  ]);
  const l = new Uint8Array(left), r = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < l.length; i++) difference |= l[i] ^ r[i];
  if (difference !== 0) return Response.json({ message: "인증이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const d1 = getD1OrNull();
  if (!d1) return Response.json({ message: "DB를 사용할 수 없습니다." }, { status: 503 });
  const seedBatch = integerParam(new URL(request.url).searchParams.get("seedBatch"), 1, 100) ?? 100;
  try {
    const seedProgress = await seedComplexesIfEmpty(d1, getComplexSeed(), COMPLEX_SEED_VERSION, seedBatch);
    return Response.json({ seedProgress }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ message: "DB 적재 실패. 마이그레이션과 연결을 확인해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
