import {
  ensureComplexSchema,
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
  const seedOnly = url.searchParams.get("seedOnly") === "1";
  const seedBatch = integerParam(url.searchParams.get("seedBatch"), 1, 100) ?? 100;
  const seed = getComplexSeed();
  const d1 = getD1OrNull();

  if (d1) {
    try {
      await ensureComplexSchema(d1);
      const seedProgress = await seedComplexesIfEmpty(
        d1,
        seed,
        COMPLEX_SEED_VERSION,
        seedBatch,
      );
      if (seedOnly) {
        const response: ComplexesApiResponse = {
          mode: "live",
          complexes: [],
          updatedAt: new Date().toISOString(),
          message: seedProgress.complete && seedProgress.exact
            ? "서울 아파트 단지 마스터 DB 적재가 완료되었습니다."
            : seedProgress.complete
              ? `DB에 이전 마스터 ${seedProgress.stale.toLocaleString()}개가 남아 있어 내장 마스터를 사용합니다.`
              : `단지 마스터를 분할 적재 중입니다. ${seedProgress.remaining.toLocaleString()}개가 남았습니다.`,
          seedProgress,
        };
        return Response.json(response, {
          headers: { "Cache-Control": "no-store" },
        });
      }
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
            : `공식 단지 마스터 ${seedProgress.seeded.toLocaleString()}/${seedProgress.total.toLocaleString()}개를 DB에 안전하게 나눠 적재 중입니다. 전체 목록은 내장 마스터로 빠짐없이 표시합니다.`,
        seedProgress,
      };
      return Response.json(response, {
        headers: {
          "Cache-Control": useD1Master
            ? "public, max-age=60, s-maxage=300"
            : "no-store",
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
