import { getD1OrNull } from "../../../db";
import { readAreaSales } from "../../../db/area-sales";
import { validMonth } from "../../molit-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!validMonth(month)) return Response.json({ message: "조회 월이 올바르지 않습니다." }, { status: 400 });
  const d1 = getD1OrNull();
  try {
    if (!d1) throw new Error("DB unavailable");
    return Response.json({ mode: "stored", summaries: await readAreaSales(d1, month),
      message: "조회 월까지 수집된 면적별 최근 매매 · 미수집 기간과 미확인 가격은 포함하지 않습니다." },
    { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ mode: "unavailable", summaries: {}, message: "저장된 면적별 매매를 불러오지 못했습니다. 현재 조회한 거래만 반영합니다." },
      { headers: { "Cache-Control": "no-store" } });
  }
}
