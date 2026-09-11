import { DISTRICT_CODES } from "../../data";
import { seoulMonth } from "../../site-config";
import { getD1OrNull } from "../../../db";
import { readStoredTrades, NO_FETCH_HEADERS } from "../../../db/trade-store";
import { validRecordMonth } from "../../../lib/molit-records.mjs";

export const dynamic = "force-dynamic";

/** Public reads never contact MOLIT or mutate the database. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? seoulMonth().replace("-", "");
  const district = url.searchParams.get("district") ?? undefined;
  if (!validRecordMonth(month, "sale") || (district !== undefined && !Object.hasOwn(DISTRICT_CODES, district))) {
    return Response.json({ message: "조회 월 또는 지역이 올바르지 않습니다." }, { status: 400, headers: NO_FETCH_HEADERS });
  }
  const expected = district ? [district] : Object.keys(DISTRICT_CODES);
  const unavailable = (message: string) => Response.json({
    mode: "unavailable", trades: [], completedDistricts: [], missingDistricts: expected,
    fetchedAt: null, oldestFetchedAt: null, message,
  }, { headers: NO_FETCH_HEADERS });
  try {
    const db = getD1OrNull();
    if (!db) return unavailable("실거래 저장 DB에 연결되지 않았습니다. 미확인 가격은 표시하지 않습니다.");
    const { heads, trades } = await readStoredTrades(db, month, district);
    const completedDistricts = heads.map(head => head.district).sort();
    const missingDistricts = expected.filter(name => !completedDistricts.includes(name));
    const timestamps = heads.map(head => head.fetched_at).sort();
    return Response.json({
      mode: !heads.length ? "unavailable" : missingDistricts.length ? "partial" : "stored",
      trades, completedDistricts, missingDistricts,
      fetchedAt: timestamps.at(-1) ?? null, oldestFetchedAt: timestamps[0] ?? null,
      message: !heads.length ? "선택 월·지역의 실거래를 아직 수집하지 않았습니다. 거래 0건을 뜻하지 않습니다."
        : missingDistricts.length
          ? "저장 자료 " + completedDistricts.length + "/" + expected.length + "개 구. 미수집: " + missingDistricts.join(", ") + "."
          : "선택 월·지역의 수집 완료 자료입니다. 새로고침은 저장 자료만 다시 읽습니다.",
    }, { headers: NO_FETCH_HEADERS });
  } catch {
    return unavailable("저장된 실거래 조회에 실패했습니다. 수집 여부를 확인할 수 없습니다.");
  }
}
