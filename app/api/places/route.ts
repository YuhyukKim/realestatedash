import { selectSchools } from "../../places";
import {
  BUNDLED_SCHOOLS,
  BUNDLED_SCHOOL_DATA_YEAR,
} from "../../school-data";
import type {
  NearbySchool,
  PlacesResponse,
  SchoolLevel,
} from "../../place-types";

export const dynamic = "force-dynamic";

const SCHOOL_API_URL = "https://open.neis.go.kr/hub/schoolInfo";
const SEOUL_EDUCATION_OFFICE_CODE = "B10";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;
const MAX_PAGES = 5;
const FILE_DATA_URL = "https://www.data.go.kr/data/15152021/fileData.do";

type NeisSchoolRow = {
  SD_SCHUL_CODE?: string;
  SCHUL_NM?: string;
  SCHUL_KND_SC_NM?: string;
  ORG_RDNMA?: string;
  ORG_RDNDA?: string;
  ORG_TELNO?: string;
  HMPG_ADRES?: string;
  FOND_SC_NM?: string;
};

type NeisPayload = {
  schoolInfo?: Array<{
    head?: Array<{ list_total_count?: number | string }>;
    row?: NeisSchoolRow[];
  }>;
  RESULT?: { CODE?: string; MESSAGE?: string };
};

let schoolCache:
  | { expiresAt: number; fetchedAt: string; schools: NearbySchool[] }
  | undefined;

function schoolLevel(value: string): SchoolLevel | null {
  if (value.includes("초등학교")) return "초등학교";
  if (value.includes("중학교")) return "중학교";
  if (value.includes("고등학교")) return "고등학교";
  return null;
}

function toSchool(row: NeisSchoolRow): NearbySchool | null {
  const level = schoolLevel(row.SCHUL_KND_SC_NM ?? "");
  const name = row.SCHUL_NM?.trim();
  const address = [row.ORG_RDNMA, row.ORG_RDNDA]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");

  if (!level || !name || !address) return null;

  return {
    code: row.SD_SCHUL_CODE?.trim() || `${name}-${address}`,
    name,
    level,
    address,
    phone: row.ORG_TELNO?.trim() || null,
    homepage: row.HMPG_ADRES?.trim() || null,
    foundation: row.FOND_SC_NM?.trim() || null,
    latitude: null,
    longitude: null,
  };
}

function payloadRows(payload: NeisPayload) {
  return payload.schoolInfo?.flatMap((block) => block.row ?? []) ?? [];
}

function payloadTotal(payload: NeisPayload) {
  for (const block of payload.schoolInfo ?? []) {
    for (const head of block.head ?? []) {
      const total = Number(head.list_total_count);
      if (Number.isFinite(total)) return total;
    }
  }
  return payloadRows(payload).length;
}

const bundledSchools: NearbySchool[] = BUNDLED_SCHOOLS.map(
  ([name, level, , address, foundation, latitude, longitude]) => ({
    code: `seoul-${name}-${address}`,
    name,
    level,
    address,
    phone: null,
    homepage: null,
    foundation,
    latitude,
    longitude,
  }),
);

async function fetchPage(apiKey: string, page: number) {
  const requestUrl = new URL(SCHOOL_API_URL);
  requestUrl.searchParams.set("KEY", apiKey);
  requestUrl.searchParams.set("Type", "json");
  requestUrl.searchParams.set("pIndex", String(page));
  requestUrl.searchParams.set("pSize", String(PAGE_SIZE));
  requestUrl.searchParams.set(
    "ATPT_OFCDC_SC_CODE",
    SEOUL_EDUCATION_OFFICE_CODE,
  );

  const response = await fetch(requestUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`학교정보 조회 실패 (${response.status})`);
  }

  const payload = (await response.json()) as NeisPayload;
  if (!payload.schoolInfo) {
    throw new Error(payload.RESULT?.MESSAGE || "학교정보 응답 형식 오류");
  }
  return payload;
}

async function fetchSeoulSchools(apiKey: string) {
  if (schoolCache && schoolCache.expiresAt > Date.now()) return schoolCache;

  const first = await fetchPage(apiKey, 1);
  const total = payloadTotal(first);
  const pageCount = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const rest =
    pageCount > 1
      ? await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) =>
            fetchPage(apiKey, index + 2),
          ),
        )
      : [];
  const schools = [first, ...rest]
    .flatMap(payloadRows)
    .map(toSchool)
    .filter((school): school is NearbySchool => school !== null);

  schoolCache = {
    schools,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return schoolCache;
}

function responseBody(
  district: string,
  dong: string,
  apartment: string | null,
  selected: Pick<PlacesResponse, "schools" | "schoolScope" | "note">,
  fetchedAt: string | null,
  source: "neis" | "file" = "neis",
): PlacesResponse {
  return {
    location: {
      district,
      dong,
      apartment,
      mapQuery: ["서울특별시", district, dong, apartment]
        .filter(Boolean)
        .join(" "),
    },
    ...selected,
    source:
      source === "file"
        ? {
            name: "서울특별시교육청 연도별 학교 위도·경도 데이터",
            url: FILE_DATA_URL,
            fetchedAt: null,
            dataYear: BUNDLED_SCHOOL_DATA_YEAR,
          }
        : {
            name: "나이스 교육정보 개방 포털 학교기본정보",
            url: "https://open.neis.go.kr/",
            fetchedAt,
          },
  };
}

function bundledResponse(
  district: string,
  dong: string,
  apartment: string | null,
  prefix?: string,
) {
  const selected = selectSchools(bundledSchools, district, dong);
  return responseBody(
    district,
    dong,
    apartment,
    {
      ...selected,
      note: [prefix, selected.note, `${BUNDLED_SCHOOL_DATA_YEAR}년 서울시교육청 파일 기준`]
        .filter(Boolean)
        .join(" · "),
    },
    null,
    "file",
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const district = url.searchParams.get("district")?.trim() ?? "";
  const dong = url.searchParams.get("dong")?.trim() ?? "";
  const apartment = url.searchParams.get("apartment")?.trim() || null;

  if (!district || !dong) {
    return Response.json(
      { message: "district와 dong은 필수입니다." },
      { status: 400 },
    );
  }

  const apiKey = process.env.NEIS_API_KEY;
  if (!apiKey) {
    return Response.json(bundledResponse(district, dong, apartment), {
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  }

  try {
    const data = await fetchSeoulSchools(apiKey);
    const selected = selectSchools(data.schools, district, dong);
    return Response.json(
      responseBody(district, dong, apartment, selected, data.fetchedAt),
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    return Response.json(
      bundledResponse(
        district,
        dong,
        apartment,
        error instanceof Error
          ? `${error.message}. 파일 데이터로 대체했습니다.`
          : "나이스 조회 오류로 파일 데이터로 대체했습니다.",
      ),
      {
        headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" },
      },
    );
  }
}
