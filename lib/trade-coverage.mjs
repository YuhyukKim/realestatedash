/** Pure presentation helpers: a missing/unsupported feed is never a confirmed zero. */
export function periodTradeLabel(selectedDistrict, completedDistricts, count, districtCount = 25) {
  if (selectedDistrict === "서울 전체") {
    return completedDistricts.length
      ? "수집된 " + completedDistricts.length + "/" + districtCount + "개 구의 선택월 거래 " + count.toLocaleString() + "건"
      : "선택월 거래 미수집";
  }
  return completedDistricts.includes(selectedDistrict)
    ? "확인된 선택월 거래 " + count.toLocaleString() + "건" : "선택월 거래 미수집";
}
export function rentPeriodSupported(endMonth) { return endMonth.replace("-", "") >= "201101"; }
export function emptyTradeMessage(kind, endMonth, loading, error, missing) {
  if (kind === "rent" && !rentPeriodSupported(endMonth)) return "전월세 자료는 2011년 1월부터 제공됩니다.";
  if (loading) return "저장 자료를 불러오는 중입니다.";
  return error || missing[kind]
    ? "미수집·미확인 기간이 있습니다. 거래 0건을 뜻하지 않습니다."
    : "선택 기간·면적의 거래가 없습니다.";
}
