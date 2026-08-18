"use client";

import { useEffect, useMemo, useState } from "react";
import ComplexDetailPanel from "./complex-detail";
import { SEOUL_DISTRICTS, sampleTrades, type Trade } from "./data";

type DataMode = "demo" | "live";

type ApiResponse = {
  mode: DataMode;
  trades: Trade[];
  updatedAt: string;
  message: string;
};

const PRICE_BANDS = [
  { id: "under-6", label: "6억 미만", min: 0, max: 6, accent: "#55c2a3" },
  { id: "6-10", label: "6억~10억", min: 6, max: 11, accent: "#75b8ed" },
  { id: "11-15", label: "11억~15억", min: 11, max: 16, accent: "#8f9cf4" },
  { id: "16-20", label: "16억~20억", min: 16, max: 21, accent: "#ae8de8" },
  { id: "21-25", label: "21억~25억", min: 21, max: 26, accent: "#d47fb0" },
  { id: "26-30", label: "26억~30억", min: 26, max: 31, accent: "#ec7f85" },
  { id: "31-40", label: "31억~40억", min: 31, max: 41, accent: "#f29962" },
  { id: "41-50", label: "41억~50억", min: 41, max: 51, accent: "#e9b949" },
  { id: "51-70", label: "51억~70억", min: 51, max: 71, accent: "#b0bf48" },
  { id: "71-100", label: "71억~100억", min: 71, max: Infinity, accent: "#7489e8" },
] as const;

const AREA_BANDS = [
  { id: "all", label: "전체 면적", min: 0, max: Infinity },
  { id: "small", label: "40㎡ 이하", min: 0, max: 40 },
  { id: "40-59", label: "40~59㎡", min: 40, max: 60 },
  { id: "60-84", label: "60~84㎡", min: 60, max: 85 },
  { id: "85-114", label: "85~114㎡", min: 85, max: 115 },
  { id: "115-plus", label: "115㎡ 이상", min: 115, max: Infinity },
] as const;

const BUILDING_AGE_BANDS = [
  { id: "all", label: "전체 연식", min: 0, max: Infinity },
  { id: "0-5", label: "5년 이하", min: 0, max: 6 },
  { id: "6-10", label: "6~10년", min: 6, max: 11 },
  { id: "11-20", label: "11~20년", min: 11, max: 21 },
  { id: "21-30", label: "21~30년", min: 21, max: 31 },
  { id: "31-plus", label: "31년 이상", min: 31, max: Infinity },
  { id: "unknown", label: "연식 미확인", min: 0, max: 0 },
] as const;

const COLLAPSED_TRADE_LIMIT = 16;

function formatPrice(price: number) {
  return Number.isInteger(price) ? `${price}억` : `${price.toFixed(1)}억`;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}.${day}`;
}

function getPriceBand(price: number) {
  return PRICE_BANDS.find((band) => price >= band.min && price < band.max);
}

function getBuildingAge(trade: Trade) {
  if (!trade.buildYear) return null;
  const dealYear = Number(trade.date.slice(0, 4));
  if (!Number.isFinite(dealYear)) return null;
  return Math.max(0, dealYear - trade.buildYear);
}

function formatBuildingInfo(trade: Trade) {
  const age = getBuildingAge(trade);
  return trade.buildYear && age !== null
    ? `${trade.buildYear}년식 · ${age}년`
    : "연식 미확인";
}

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>(sampleTrades);
  const [selectedDistrict, setSelectedDistrict] = useState("서울 전체");
  const [selectedArea, setSelectedArea] = useState("all");
  const [selectedBuildingAge, setSelectedBuildingAge] = useState("all");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("2026-07");
  const [mode, setMode] = useState<DataMode>("demo");
  const [statusMessage, setStatusMessage] = useState(
    "공공데이터 API 연결 전 예시 데이터를 표시하고 있습니다.",
  );
  const [updatedAt, setUpdatedAt] = useState("2026-07-22T09:00:00+09:00");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  async function loadTrades(targetMonth: string) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/trades?month=${targetMonth.replace("-", "")}`,
      );
      const data = (await response.json()) as ApiResponse;
      setTrades(data.trades);
      setMode(data.mode);
      setUpdatedAt(data.updatedAt);
      setStatusMessage(data.message);
    } catch {
      setTrades(sampleTrades);
      setMode("demo");
      setStatusMessage("연결 상태를 확인할 수 없어 예시 데이터를 표시합니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrades(month);
    // The first request hydrates the dashboard with the configured data source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTrades = useMemo(() => {
    const area = AREA_BANDS.find((band) => band.id === selectedArea)!;
    const buildingAge = BUILDING_AGE_BANDS.find(
      (band) => band.id === selectedBuildingAge,
    )!;
    const keyword = search.trim().toLowerCase();

    return trades
      .filter(
        (trade) =>
          selectedDistrict === "서울 전체" ||
          trade.district === selectedDistrict,
      )
      .filter((trade) => trade.area >= area.min && trade.area < area.max)
      .filter((trade) => {
        if (selectedBuildingAge === "all") return true;
        const age = getBuildingAge(trade);
        if (selectedBuildingAge === "unknown") return age === null;
        return age !== null && age >= buildingAge.min && age < buildingAge.max;
      })
      .filter((trade) => {
        if (!keyword) return true;
        return `${trade.district} ${trade.dong} ${trade.apartment}`
          .toLowerCase()
          .includes(keyword);
      })
      .sort((a, b) => b.price - a.price || b.date.localeCompare(a.date));
  }, [trades, selectedDistrict, selectedArea, selectedBuildingAge, search]);

  const groupedTrades = useMemo(
    () =>
      PRICE_BANDS.map((band) => ({
        ...band,
        trades: filteredTrades.filter(
          (trade) => trade.price >= band.min && trade.price < band.max,
        ),
      })),
    [filteredTrades],
  );

  const summary = useMemo(() => {
    if (!filteredTrades.length) {
      return { count: 0, median: 0, average: 0, latest: "-" };
    }
    const prices = filteredTrades.map((trade) => trade.price).sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    const median =
      prices.length % 2
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2;
    const average =
      prices.reduce((total, price) => total + price, 0) / prices.length;
    const latest = [...filteredTrades].sort((a, b) =>
      b.date.localeCompare(a.date),
    )[0].date;
    return { count: prices.length, median, average, latest };
  }, [filteredTrades]);

  async function downloadExcel() {
    const XLSX = await import("xlsx");
    const rows = filteredTrades.map((trade) => ({
      가격구간: getPriceBand(trade.price)?.label ?? "",
      표시결과: `[${trade.district} ${trade.dong}] ${trade.apartment} (${formatPrice(trade.price)})`,
      자치구: trade.district,
      법정동: trade.dong,
      아파트명: trade.apartment,
      "거래금액(억원)": trade.price,
      "전용면적(㎡)": trade.area,
      건축연도: trade.buildYear ?? "",
      "거래당시 연식(년)": getBuildingAge(trade) ?? "",
      계약일: trade.date,
      층: trade.floor,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 13 },
      { wch: 44 },
      { wch: 10 },
      { wch: 12 },
      { wch: 24 },
      { wch: 16 },
      { wch: 14 },
      { wch: 12 },
      { wch: 18 },
      { wch: 13 },
      { wch: 8 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "실거래가");
    const district = selectedDistrict.replace(" ", "");
    XLSX.writeFile(
      workbook,
      `서울_아파트_실거래가_${month.replace("-", "")}_${district}.xlsx`,
    );
  }

  function resetFilters() {
    setSelectedDistrict("서울 전체");
    setSelectedArea("all");
    setSelectedBuildingAge("all");
    setSearch("");
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            JR
          </span>
          <div>
            <p className="brand-eyebrow">JAYDEN RESEARCH</p>
            <strong>서울 주거시장 데이터 노트</strong>
          </div>
        </div>
        <div className={`data-status ${mode}`}>
          <span className="status-dot" aria-hidden="true" />
          {mode === "live" ? "실거래 데이터 연결됨" : "예시 데이터 모드"}
        </div>
      </header>

      <section className="hero">
        <span className="hero-page" aria-hidden="true">01</span>
        <div className="hero-story">
          <p className="section-kicker">SEOUL APARTMENT MARKET · DATA BRIEF</p>
          <h1><mark>10개 가격대</mark>로 읽는<br />서울 아파트 시장.</h1>
          <p className="hero-copy">
            국토교통부 실거래 신고 자료를 가격대·지역·면적·연식으로 정리했습니다.
            단지별 매매와 전월세 흐름까지 한 화면에서 비교해보세요.
          </p>
          <p className="hero-byline">JAYDEN RESEARCH · SEOUL HOUSING SERIES</p>
        </div>
        <div className="hero-actions">
          <label className="month-field">
            <span>계약 연월</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <button
            className="refresh-button"
            onClick={() => void loadTrades(month)}
            disabled={loading}
          >
            {loading ? "불러오는 중…" : "데이터 새로고침"}
          </button>
        </div>
      </section>

      <section className="summary-strip" aria-label="조회 결과 요약">
        <article>
          <span>표본 거래</span>
          <strong>{summary.count.toLocaleString()}건</strong>
          <small>{selectedDistrict}</small>
        </article>
        <article>
          <span>중위 거래가</span>
          <strong>{summary.count ? formatPrice(summary.median) : "-"}</strong>
          <small>선택 조건 기준</small>
        </article>
        <article>
          <span>평균 거래가</span>
          <strong>{summary.count ? formatPrice(summary.average) : "-"}</strong>
          <small>선택 조건 기준</small>
        </article>
        <article>
          <span>최근 계약일</span>
          <strong>{summary.latest === "-" ? "-" : summary.latest.slice(5)}</strong>
          <small>
            {new Date(updatedAt).toLocaleString("ko-KR", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            갱신
          </small>
        </article>
      </section>

      <section className="control-panel" aria-label="실거래가 필터">
        <div className="control-heading">
          <div>
            <p className="section-kicker">RESEARCH SCOPE</p>
            <h2>분석 조건</h2>
          </div>
          <button className="reset-button" onClick={resetFilters}>
            조건 초기화
          </button>
        </div>

        <div className="filter-row">
          <div className="filter-label">
            <span>01</span>
            <div>
              <strong>지역</strong>
              <small>서울 전체 또는 자치구</small>
            </div>
          </div>
          <div className="toggle-list district-list">
            {["서울 전체", ...SEOUL_DISTRICTS].map((district) => (
              <button
                key={district}
                aria-pressed={selectedDistrict === district}
                className={selectedDistrict === district ? "active" : ""}
                onClick={() => setSelectedDistrict(district)}
              >
                {district}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-label">
            <span>02</span>
            <div>
              <strong>전용면적</strong>
              <small>거래 전용면적 구간</small>
            </div>
          </div>
          <div className="toggle-list">
            {AREA_BANDS.map((area) => (
              <button
                key={area.id}
                aria-pressed={selectedArea === area.id}
                className={selectedArea === area.id ? "active" : ""}
                onClick={() => setSelectedArea(area.id)}
              >
                {area.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-label">
            <span>03</span>
            <div>
              <strong>연식</strong>
              <small>계약연도 기준 건축연식</small>
            </div>
          </div>
          <div className="toggle-list">
            {BUILDING_AGE_BANDS.map((buildingAge) => (
              <button
                key={buildingAge.id}
                aria-pressed={selectedBuildingAge === buildingAge.id}
                className={selectedBuildingAge === buildingAge.id ? "active" : ""}
                onClick={() => setSelectedBuildingAge(buildingAge.id)}
              >
                {buildingAge.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row search-row">
          <div className="filter-label">
            <span>04</span>
            <div>
              <strong>검색</strong>
              <small>동·아파트명</small>
            </div>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="예: 아현동, 공덕자이"
            />
          </label>
        </div>
      </section>

      <section className="board-section">
        <div className="board-heading">
          <div>
            <p className="section-kicker">PRICE MAP</p>
            <h2>가격대별 배치표</h2>
            <p>
              거래금액 내림차순 · 71억~100억 구간에는 100억 초과 거래도
              함께 표시됩니다. 단지를 누르면 매매·전월세 상세 추이를 볼 수 있습니다.
            </p>
          </div>
          <button
            className="excel-button"
            onClick={() => void downloadExcel()}
            disabled={!filteredTrades.length}
          >
            <span aria-hidden="true">↓</span>
            엑셀 다운로드
          </button>
        </div>

        <div className="price-board">
          {groupedTrades.map((band) => {
            const visible = expanded[band.id]
              ? band.trades
              : band.trades.slice(0, COLLAPSED_TRADE_LIMIT);
            return (
              <article
                className="price-column"
                key={band.id}
                style={{ "--band-accent": band.accent } as React.CSSProperties}
              >
                <header>
                  <div>
                    <span className="band-index">
                      {String(
                        PRICE_BANDS.findIndex((item) => item.id === band.id) + 1,
                      ).padStart(2, "0")}
                    </span>
                    <h3>{band.label}</h3>
                  </div>
                  <strong>{band.trades.length}</strong>
                </header>
                <div className="trade-list">
                  {visible.length ? (
                    visible.map((trade) => (
                      <button
                        type="button"
                        className="trade-item"
                        key={trade.id}
                        onClick={() => setSelectedTrade(trade)}
                        aria-label={`${trade.apartment} 단지 상세 보기`}
                        title={`[${trade.district} ${trade.dong}] ${trade.apartment} ${trade.area.toFixed(1)}㎡ · ${trade.floor}층 · ${formatDate(trade.date)} · ${formatBuildingInfo(trade)} · ${formatPrice(trade.price)}`}
                      >
                        <div className="trade-line">
                          <span className="trade-location">
                            [{trade.district} {trade.dong}]
                          </span>
                          <strong className="trade-name">{trade.apartment}</strong>
                          <small className="trade-meta">
                            {trade.area.toFixed(1)}㎡ · {trade.floor}층 ·{" "}
                            {formatDate(trade.date)} ·{" "}
                            {trade.buildYear ? `${trade.buildYear}년식` : "연식 미확인"}
                          </small>
                        </div>
                        <strong className="trade-price">
                          {formatPrice(trade.price)}
                        </strong>
                      </button>
                    ))
                  ) : (
                    <div className="empty-column">
                      <span>—</span>
                      <p>조건에 맞는 거래가 없습니다.</p>
                    </div>
                  )}
                </div>
                {band.trades.length > COLLAPSED_TRADE_LIMIT && (
                  <button
                    className="more-button"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [band.id]: !current[band.id],
                      }))
                    }
                  >
                    {expanded[band.id]
                      ? "접기"
                      : `${band.trades.length - COLLAPSED_TRADE_LIMIT}건 더 보기`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <aside className={`source-notice ${mode}`}>
        <div>
          <strong>
            {mode === "live" ? "국토교통부 실거래 신고 자료" : "예시 데이터 안내"}
          </strong>
          <p>{statusMessage}</p>
        </div>
        <span>{mode === "live" ? "LIVE" : "DEMO"}</span>
      </aside>

      <footer>
        <p><strong>JAYDEN RESEARCH</strong> · 서울 주거시장 데이터 노트</p>
        <p>
          거래금액은 억원 단위 · 전용면적은 ㎡ 단위 · 실거래 신고 자료는
          취소·정정될 수 있습니다.
        </p>
      </footer>

      {selectedTrade && (
        <ComplexDetailPanel
          key={selectedTrade.id}
          trade={selectedTrade}
          endMonth={month}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </main>
  );
}

