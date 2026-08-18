"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "./data";
import type {
  ComplexDetailResponse,
  ComplexTransaction,
} from "./complex-types";
import type { NearbyStation } from "./stations";

type DetailPeriod = 1 | 3 | 5 | 10 | "all";
type ChartMetric = "sale" | "jeonse" | "ratio";

type Props = {
  trade: Trade;
  endMonth: string;
  onClose: () => void;
};

const SALE_FIRST_MONTH = "200601";
const PERIODS: { value: DetailPeriod; label: string }[] = [
  { value: 1, label: "1년" },
  { value: 3, label: "3년" },
  { value: 5, label: "5년" },
  { value: 10, label: "10년" },
  { value: "all", label: "전체" },
];

function monthOrdinal(value: string) {
  const compact = value.replace("-", "");
  return Number(compact.slice(0, 4)) * 12 + Number(compact.slice(4, 6)) - 1;
}

function formatMonth(ordinal: number) {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  return `${year}${String(month).padStart(2, "0")}`;
}

function rangeStartMonth(
  endMonth: string,
  period: DetailPeriod,
  buildYear: number | null,
) {
  const end = monthOrdinal(endMonth);
  const officialStart = monthOrdinal(SALE_FIRST_MONTH);
  const complexStart = buildYear
    ? Math.max(officialStart, monthOrdinal(`${buildYear}01`))
    : officialStart;
  return formatMonth(
    period === "all" ? complexStart : Math.max(complexStart, end - period * 12 + 1),
  );
}

function chunkRanges(
  endMonth: string,
  period: DetailPeriod,
  buildYear: number | null,
) {
  const start = monthOrdinal(rangeStartMonth(endMonth, period, buildYear));
  const ranges: { from: string; to: string }[] = [];
  let chunkEnd = monthOrdinal(endMonth);

  while (chunkEnd >= start) {
    const chunkStart = Math.max(start, chunkEnd - 11);
    ranges.push({ from: formatMonth(chunkStart), to: formatMonth(chunkEnd) });
    chunkEnd = chunkStart - 1;
  }
  return ranges;
}

function formatPrice(price: number) {
  return Number.isInteger(price) ? `${price}억` : `${price.toFixed(1)}억`;
}

function formatStationDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
}

function formatRent(transaction: ComplexTransaction) {
  if (transaction.type === "jeonse") return formatPrice(transaction.price);
  const deposit = transaction.price
    ? `${Math.round(transaction.price * 10_000).toLocaleString()}만`
    : "0";
  return `${deposit} / ${transaction.monthlyRent.toLocaleString()}만`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatChartValue(metric: ChartMetric, value: number) {
  return metric === "ratio" ? `${value.toFixed(1)}%` : `${value.toFixed(1)}억`;
}

function smoothPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const controlOffset = (point.x - previous.x) * 0.38;
    return `${path} C${previous.x + controlOffset},${previous.y} ${point.x - controlOffset},${point.y} ${point.x},${point.y}`;
  }, `M${points[0].x},${points[0].y}`);
}

function PriceChart({
  transactions,
  endMonth,
  period,
  buildYear,
  metric,
}: {
  transactions: ComplexTransaction[];
  endMonth: string;
  period: DetailPeriod;
  buildYear: number | null;
  metric: ChartMetric;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const months = useMemo(() => {
    const start = monthOrdinal(rangeStartMonth(endMonth, period, buildYear));
    const end = monthOrdinal(endMonth);
    return Array.from({ length: end - start + 1 }, (_, index) =>
      formatMonth(start + index),
    );
  }, [buildYear, endMonth, period]);

  const points = useMemo(() => {
    const grouped = new Map<
      string,
      { sale: number[]; jeonse: number[]; saleCount: number; jeonseCount: number }
    >();
    transactions.forEach((transaction) => {
      const month = transaction.date.replaceAll("-", "").slice(0, 6);
      const group = grouped.get(month) ?? {
        sale: [],
        jeonse: [],
        saleCount: 0,
        jeonseCount: 0,
      };
      if (transaction.type === "sale") {
        group.sale.push(transaction.price);
        group.saleCount += 1;
      } else if (transaction.type === "jeonse") {
        group.jeonse.push(transaction.price);
        group.jeonseCount += 1;
      }
      grouped.set(month, group);
    });

    return months.map((month) => {
      const group = grouped.get(month) ?? {
        sale: [],
        jeonse: [],
        saleCount: 0,
        jeonseCount: 0,
      };
      const sale = median(group.sale);
      const jeonse = median(group.jeonse);
      return {
        month,
        sale,
        jeonse,
        ratio: sale && jeonse ? (jeonse / sale) * 100 : null,
        saleCount: group.saleCount,
        jeonseCount: group.jeonseCount,
      };
    });
  }, [months, transactions]);

  const values = points
    .map((point) => point[metric])
    .filter((value): value is number => value !== null);
  if (!values.length) {
    return (
      <div className="detail-chart-empty">
        <strong>선택 면적의 거래 기록이 없습니다.</strong>
        <span>다른 전용면적이나 조회 기간을 선택해보세요.</span>
      </div>
    );
  }

  const width = 760;
  const height = 320;
  const left = 58;
  const right = 24;
  const top = 22;
  const plotBottom = 226;
  const volumeTop = 246;
  const volumeBottom = 286;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(
    (rawMax - rawMin) * 0.16,
    rawMax * 0.06,
    metric === "ratio" ? 2 : 0.5,
  );
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const x = (index: number) =>
    left + (index / Math.max(1, points.length - 1)) * (width - left - right);
  const y = (value: number) =>
    top + ((max - value) / Math.max(0.1, max - min)) * (plotBottom - top);
  const linePoints = points
    .map((point, index) =>
      point[metric] === null
        ? null
        : { x: x(index), y: y(point[metric] as number), index },
    )
    .filter(
      (point): point is { x: number; y: number; index: number } => point !== null,
    );
  const path = smoothPath(linePoints);
  const maxVolume = Math.max(
    1,
    ...points.map((point) =>
      metric === "sale"
        ? point.saleCount
        : metric === "jeonse"
          ? point.jeonseCount
          : point.saleCount + point.jeonseCount,
    ),
  );
  const yTicks = Array.from({ length: 5 }, (_, index) =>
    min + ((max - min) * index) / 4,
  ).reverse();
  const labelStep = Math.max(3, Math.round(points.length / 8));
  const periodLabel = period === "all" ? "전체 기간" : `${period}년`;
  const minPoint = linePoints.reduce((selected, point) =>
    (points[point.index][metric] as number) < (points[selected.index][metric] as number)
      ? point
      : selected,
  );
  const maxPoint = linePoints.reduce((selected, point) =>
    (points[point.index][metric] as number) > (points[selected.index][metric] as number)
      ? point
      : selected,
  );
  const activePoint =
    activeIndex === null || !points[activeIndex] || points[activeIndex][metric] === null
      ? null
      : {
          ...points[activeIndex],
          value: points[activeIndex][metric] as number,
          x: x(activeIndex),
          y: y(points[activeIndex][metric] as number),
        };

  function updateActive(clientX: number, element: SVGSVGElement) {
    const bounds = element.getBoundingClientRect();
    const pointerX = ((clientX - bounds.left) / bounds.width) * width;
    const nearest = linePoints.reduce((selected, point) =>
      Math.abs(point.x - pointerX) < Math.abs(selected.x - pointerX)
        ? point
        : selected,
    );
    setActiveIndex(nearest.index);
  }

  return (
    <div className="detail-chart-wrap">
      <svg
        className="detail-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${periodLabel} ${metric === "sale" ? "매매" : metric === "jeonse" ? "전세" : "전세가율"} 실거래 추이`}
        onPointerMove={(event) => updateActive(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <desc>월별 실거래 중위값을 선과 거래량으로 표시한 차트입니다.</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-grid-line"
            />
            <text x={left - 10} y={y(tick) + 4} className="chart-axis-label">
              {metric === "ratio" ? `${Math.round(tick)}%` : `${tick.toFixed(1)}억`}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={width - right}
          y1={volumeTop - 8}
          y2={volumeTop - 8}
          className="chart-volume-divider"
        />
        <text x={left - 10} y={volumeBottom - 2} className="chart-axis-label">
          거래량
        </text>
        {points.map((point, index) => {
          const count =
            metric === "sale"
              ? point.saleCount
              : metric === "jeonse"
                ? point.jeonseCount
                : point.saleCount + point.jeonseCount;
          const barWidth = Math.max(1.2, (width - left - right) / points.length - 1);
          const barHeight = (count / maxVolume) * (volumeBottom - volumeTop);
          return count ? (
            <rect
              key={`volume-${point.month}`}
              x={x(index) - barWidth / 2}
              y={volumeBottom - barHeight}
              width={barWidth}
              height={barHeight}
              className="chart-volume-bar"
            />
          ) : null;
        })}
        {points.map((point, index) =>
          index % labelStep === 0 || index === points.length - 1 ? (
            <text
              key={point.month}
              x={x(index)}
              y={height - 12}
              className="chart-month-label"
            >
              {`${point.month.slice(2, 4)}.${point.month.slice(4)}`}
            </text>
          ) : null,
        )}
        <path d={path} className="chart-line chart-main-line" />
        <text
          x={Math.min(width - right - 8, maxPoint.x + 7)}
          y={Math.max(top + 10, maxPoint.y - 8)}
          className="chart-extreme-label maximum"
        >
          최고 {formatChartValue(metric, points[maxPoint.index][metric] as number)}
        </text>
        <text
          x={Math.min(width - right - 8, minPoint.x + 7)}
          y={Math.min(plotBottom - 4, minPoint.y + 16)}
          className="chart-extreme-label minimum"
        >
          최저 {formatChartValue(metric, points[minPoint.index][metric] as number)}
        </text>
        {activePoint && (
          <g className="chart-active-layer">
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={top}
              y2={volumeBottom}
              className="chart-crosshair"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="4" className="chart-active-dot" />
            <g
              transform={`translate(${Math.min(width - 172, Math.max(left, activePoint.x - 76))},${Math.max(top + 4, activePoint.y - 72)})`}
            >
              <rect width="154" height="54" rx="8" className="chart-tooltip-card" />
              <text x="12" y="19" className="chart-tooltip-month">
                {activePoint.month.slice(0, 4)}년 {Number(activePoint.month.slice(4))}월
              </text>
              <text x="12" y="39" className="chart-tooltip-value">
                {formatChartValue(metric, activePoint.value)} · {
                  metric === "sale"
                    ? activePoint.saleCount
                    : metric === "jeonse"
                      ? activePoint.jeonseCount
                      : activePoint.saleCount + activePoint.jeonseCount
                }건
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

function TransactionList({
  title,
  caption,
  transactions,
  type,
}: {
  title: string;
  caption: string;
  transactions: ComplexTransaction[];
  type: "sale" | "rent";
}) {
  return (
    <section className="detail-transaction-card">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{caption}</p>
        </div>
        <span>{transactions.length}건</span>
      </header>
      <div className="detail-transaction-list">
        {transactions.length ? (
          transactions.slice(0, 10).map((transaction) => (
            <article key={transaction.id}>
              <div className="transaction-date">
                <strong>{transaction.date.slice(5).replace("-", ".")}</strong>
                <span>{transaction.date.slice(0, 4)}</span>
              </div>
              <div className="transaction-price">
                <span>
                  {transaction.type === "sale"
                    ? "매매"
                    : transaction.type === "jeonse"
                      ? "전세"
                      : "월세"}
                </span>
                <strong>
                  {type === "sale" ? formatPrice(transaction.price) : formatRent(transaction)}
                </strong>
              </div>
              <div className="transaction-spec">
                <span>{transaction.area.toFixed(1)}㎡</span>
                <span>{transaction.floor ? `${transaction.floor}층` : "층 미확인"}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="detail-list-empty">선택 조건의 최근 거래가 없습니다.</div>
        )}
      </div>
    </section>
  );
}

export default function ComplexDetailPanel({ trade, endMonth, onClose }: Props) {
  const [period, setPeriod] = useState<DetailPeriod>(1);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("sale");
  const [transactions, setTransactions] = useState<ComplexTransaction[]>([]);
  const [selectedArea, setSelectedArea] = useState(Math.round(trade.area));
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [message, setMessage] = useState("실거래 데이터를 불러오고 있습니다.");
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [nearbyStationsNote, setNearbyStationsNote] = useState(
    "법정동 중심 직선거리 추정 · 실제 도보경로와 다를 수 있습니다.",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 1 });
  const cacheRef = useRef<Record<string, ComplexDetailResponse>>({});
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const ranges = chunkRanges(endMonth, period, trade.buildYear);

    async function load() {
      setLoading(true);
      setError("");
      setLoadProgress({ loaded: 0, total: ranges.length });
      try {
        const payloads: ComplexDetailResponse[] = [];
        for (const [rangeIndex, range] of ranges.entries()) {
          const key = `${range.from}-${range.to}`;
          if (cacheRef.current[key]) {
            payloads.push(cacheRef.current[key]);
          } else {
            const params = new URLSearchParams({
              district: trade.district,
              dong: trade.dong,
              apartment: trade.apartment,
              from: range.from,
              to: range.to,
              asOf: endMonth.replace("-", ""),
              basePrice: String(trade.price),
              baseArea: String(trade.area),
            });
            if (trade.aptSeq) params.set("aptSeq", trade.aptSeq);
            if (trade.buildYear) params.set("buildYear", String(trade.buildYear));

            const response = await fetch(`/api/complex?${params}`, {
              signal: controller.signal,
            });
            if (!response.ok) throw new Error("단지 상세 데이터를 불러오지 못했습니다.");
            const payload = (await response.json()) as ComplexDetailResponse;
            cacheRef.current[key] = payload;
            payloads.push(payload);
          }

          if (controller.signal.aborted) return;
          const merged = payloads
            .flatMap((payload) => payload.transactions)
            .filter(
              (transaction, index, all) =>
                all.findIndex((candidate) => candidate.id === transaction.id) === index,
            )
            .sort((a, b) => b.date.localeCompare(a.date));
          setTransactions(merged);
          setMode(payloads.every((payload) => payload.mode === "live") ? "live" : "demo");
          setMessage(payloads[0]?.message ?? "단지 상세 실거래 자료");
          setNearbyStations(payloads[0]?.nearbyStations ?? []);
          setNearbyStationsNote(
            payloads[0]?.nearbyStationsNote ??
              "법정동 중심 직선거리 추정 · 실제 도보경로와 다를 수 있습니다.",
          );
          setLoadProgress({ loaded: rangeIndex + 1, total: ranges.length });
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "단지 상세 데이터를 불러오지 못했습니다.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [endMonth, period, trade]);

  const areas = useMemo(
    () =>
      [...new Set([Math.round(trade.area), ...transactions.map((item) => Math.round(item.area))])]
        .sort((a, b) => a - b),
    [trade.area, transactions],
  );
  const effectiveArea = areas.includes(selectedArea)
    ? selectedArea
    : areas.reduce((nearest, area) =>
        Math.abs(area - selectedArea) < Math.abs(nearest - selectedArea) ? area : nearest,
      );
  const areaTransactions = useMemo(
    () => transactions.filter((item) => Math.round(item.area) === effectiveArea),
    [effectiveArea, transactions],
  );
  const recentSales = areaTransactions.filter((item) => item.type === "sale");
  const recentRents = areaTransactions.filter((item) => item.type !== "sale");
  const latestSale = recentSales[0] ?? null;
  const latestJeonse = recentRents.find((item) => item.type === "jeonse") ?? null;
  const jeonseRatio =
    latestSale && latestJeonse
      ? Math.round((latestJeonse.price / latestSale.price) * 100)
      : null;

  return (
    <div
      className="detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="complex-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="complex-detail-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="detail-header">
          <div>
            <p className="section-kicker">JAYDEN RESEARCH · COMPLEX NOTE</p>
            <h2 id="complex-detail-title">{trade.apartment}</h2>
            <p>
              {trade.district} {trade.dong}
              <span aria-hidden="true"> · </span>
              {trade.buildYear ? `${trade.buildYear}년 준공` : "준공연도 미확인"}
            </p>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="단지 상세 닫기">
            ×
          </button>
        </header>

        <div className={`detail-source ${mode}`}>
          <span>{mode === "live" ? "LIVE" : "DEMO"}</span>
          <p>{message}</p>
        </div>

        <section className="detail-summary" aria-label="단지 최근 가격 요약">
          <article>
            <span>최근 매매가</span>
            <strong>{latestSale ? formatPrice(latestSale.price) : "-"}</strong>
            <small>{latestSale?.date ?? "거래 없음"}</small>
          </article>
          <article>
            <span>최근 전세가</span>
            <strong>{latestJeonse ? formatPrice(latestJeonse.price) : "-"}</strong>
            <small>{latestJeonse?.date ?? "거래 없음"}</small>
          </article>
          <article>
            <span>전세가율</span>
            <strong>{jeonseRatio === null ? "-" : `${jeonseRatio}%`}</strong>
            <small>최근 매매·전세 기준</small>
          </article>
        </section>

        <section className="detail-stations" aria-labelledby="nearby-stations-title">
          <div className="detail-section-heading">
            <div className="detail-section-heading-main">
              <span className="detail-section-index">03</span>
              <div>
                <h3 id="nearby-stations-title">인근 지하철역</h3>
                <p>단지 법정동 중심 · 가까운 역 3곳</p>
              </div>
            </div>
            <span className="detail-section-label">SUBWAY ACCESS</span>
          </div>
          {nearbyStations.length ? (
            <div className="detail-station-list">
              {nearbyStations.map((station, index) => (
                <article key={`${station.name}-${station.lines}`}>
                  <span className="station-rank">0{index + 1}</span>
                  <div className="station-main">
                    <strong>{station.name}역</strong>
                    <span>{station.lines}</span>
                  </div>
                  <div className="station-distance">
                    <strong>약 {formatStationDistance(station.distanceMeters)}</strong>
                    <span>도보 약 {station.walkMinutes}분</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="detail-station-empty">인근 지하철역 정보를 준비 중입니다.</p>
          )}
          <p className="detail-station-note">※ {nearbyStationsNote}</p>
        </section>

        <section className="detail-chart-section">
          <div className="detail-toolbar">
            <div>
              <span className="detail-control-label">전용면적</span>
              <div className="detail-toggle-list" aria-label="전용면적 선택">
                {areas.map((area) => (
                  <button
                    key={area}
                    className={effectiveArea === area ? "active" : ""}
                    aria-pressed={effectiveArea === area}
                    onClick={() => setSelectedArea(area)}
                  >
                    {area}㎡
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="detail-control-label">조회기간</span>
              <div className="detail-toggle-list" aria-label="조회기간 선택">
                {PERIODS.map((option) => (
                  <button
                    key={option.value}
                    className={period === option.value ? "active" : ""}
                    aria-pressed={period === option.value}
                    onClick={() => setPeriod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="detail-chart-heading">
            <div>
              <h3>
                {chartMetric === "sale"
                  ? "매매 실거래가 추이"
                  : chartMetric === "jeonse"
                    ? "전세 실거래가 추이"
                    : "전세가율 추이"}
              </h3>
              <p>월별 중위값과 거래량 · {effectiveArea}㎡ 기준</p>
            </div>
            <div className="chart-metric-tabs" aria-label="차트 지표 선택">
              {([
                ["sale", "매매"],
                ["jeonse", "전세"],
                ["ratio", "전세가율"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={chartMetric === value ? "active" : ""}
                  aria-pressed={chartMetric === value}
                  onClick={() => setChartMetric(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && !transactions.length ? (
            <div className="detail-loading" aria-live="polite">
              <span />
              {period === "all" ? "전체" : `${period}년`} 실거래를 불러오는 중입니다.
            </div>
          ) : error && !transactions.length ? (
            <div className="detail-error" role="alert">{error}</div>
          ) : (
            <>
              {(loading || error) && (
                <div className={`detail-progress ${error ? "error" : ""}`} aria-live="polite">
                  <span>
                    <i
                      style={{
                        width: `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%`,
                      }}
                    />
                  </span>
                  <strong>
                    {error
                      ? `${error} 불러온 기간까지 표시합니다.`
                      : `장기 실거래 불러오는 중 · ${loadProgress.loaded}/${loadProgress.total} 구간`}
                  </strong>
                </div>
              )}
              <PriceChart
                transactions={areaTransactions}
                endMonth={endMonth}
                period={period}
                buildYear={trade.buildYear}
                metric={chartMetric}
              />
            </>
          )}
        </section>

        <div className="detail-list-grid">
          <TransactionList
            title="최근 매매 실거래"
            caption={`${effectiveArea}㎡ 기준 · 최신 계약순`}
            transactions={recentSales}
            type="sale"
          />
          <TransactionList
            title="최근 전세·월세 실거래"
            caption={`${effectiveArea}㎡ 기준 · 보증금/월세`}
            transactions={recentRents}
            type="rent"
          />
        </div>

        <p className="detail-footnote">
          실거래 신고 자료는 취소·정정될 수 있으며, 동·호수 정보는 개인정보 보호를 위해
          제공되지 않습니다. 매매는 2006년 1월, 전월세는 2011년 1월 이후 자료를
          단지 준공연도부터 조회합니다.
        </p>
      </section>
    </div>
  );
}

