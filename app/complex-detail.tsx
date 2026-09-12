"use client";

import { emptyTradeMessage, rentPeriodSupported } from "../lib/trade-coverage.mjs";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  WORKPLACE_BY_ID,
  findDirectLineMatch,
  type WorkplaceId,
} from "./access";
import type { ComplexDetailSeed } from "./complex-master";
import type {
  ComplexDetailResponse,
  ComplexTransaction,
} from "./complex-types";
import { NaverMap } from "./naver-map";
import { formatPrice, formatRent } from "./price-format";
import type { PlacesResponse } from "./place-types";
import { getNearbyStations, STATION_DISTANCE_NOTE } from "./stations";

type DetailPeriod = 1 | 3 | 5 | 10 | "all";
type ChartMetric = "sale" | "jeonse" | "ratio";

type Props = {
  complex: ComplexDetailSeed;
  endMonth: string;
  workplaceIds?: WorkplaceId[];
  onClose: () => void;
};

const SALE_FIRST_MONTH = "200601";
const EMPTY_TRANSACTIONS: ComplexTransaction[] = [];
const TRANSACTION_LIST_INITIAL_COUNT = 10;
const TRANSACTION_LIST_STEP = 10;
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

function formatStationDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;
}

function naverMapSearchUrl(query: string) {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
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
  return metric === "ratio" ? `${value.toFixed(1)}%` : `약 ${formatPrice(value)}`;
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

export function PriceChart({
  transactions,
  endMonth,
  period,
  buildYear,
  metric,
  emptyNote,
}: {
  transactions: ComplexTransaction[];
  endMonth: string;
  period: DetailPeriod;
  buildYear: number | null;
  metric: ChartMetric;
  emptyNote: string;
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
        <strong>{emptyNote}</strong>
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
        <desc>월별 실거래 중위값을 선과 거래량으로 표시한 차트입니다. 축은 요약 표시, 금액 중위값은 만원 단위 반올림이며 개별 계약금액은 아래 실거래 목록에서 확인할 수 있습니다.</desc>
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
          x={maxPoint.x > width / 2 ? maxPoint.x - 7 : maxPoint.x + 7}
          textAnchor={maxPoint.x > width / 2 ? "end" : "start"}
          y={Math.max(top + 10, maxPoint.y - 8)}
          className="chart-extreme-label maximum"
        >
          최고 {metric === "ratio" ? "전세가율" : "중위값"} {formatChartValue(metric, points[maxPoint.index][metric] as number)}
        </text>
        <text
          x={minPoint.x > width / 2 ? minPoint.x - 7 : minPoint.x + 7}
          textAnchor={minPoint.x > width / 2 ? "end" : "start"}
          y={Math.min(plotBottom - 4, minPoint.y + 16)}
          className="chart-extreme-label minimum"
        >
          최저 {metric === "ratio" ? "전세가율" : "중위값"} {formatChartValue(metric, points[minPoint.index][metric] as number)}
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
              transform={`translate(${Math.min(width - right - 230, Math.max(left, activePoint.x - 115))},${Math.max(top + 4, activePoint.y - 72)})`}
            >
              <rect width="230" height="54" rx="8" className="chart-tooltip-card" />
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

export function TransactionList({
  title,
  caption,
  transactions,
  type,
  emptyNote,
  complete,
}: {
  title: string;
  caption: string;
  transactions: ComplexTransaction[];
  type: "sale" | "rent";
  emptyNote: string;
  complete: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(
    TRANSACTION_LIST_INITIAL_COUNT,
  );
  const componentId = useId();

  const visibleTransactions = transactions.slice(0, visibleCount);
  const remainingCount = Math.max(0, transactions.length - visibleCount);
  const hasMore = remainingCount > 0;
  const isExpanded = visibleCount > TRANSACTION_LIST_INITIAL_COUNT;
  const listId = `detail-transaction-list-${type}-${componentId}`;
  const headingId = `detail-transaction-heading-${type}-${componentId}`;

  return (
    <section className="detail-transaction-card" aria-labelledby={headingId}>
      <header>
        <div>
          <h3 id={headingId}>{title}</h3>
          <p>{caption}</p>
        </div>
        <span>{transactions.length || complete ? `${transactions.length}건` : "미확인"}</span>
      </header>
      <div className="detail-transaction-list" id={listId}>
        {transactions.length ? (
          visibleTransactions.map((transaction) => (
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
          <div className="detail-list-empty">{emptyNote}</div>
        )}
      </div>
      {transactions.length > TRANSACTION_LIST_INITIAL_COUNT && (
        <div className="detail-transaction-more">
          <button
            type="button"
            aria-controls={listId}
            aria-expanded={isExpanded}
            aria-label={
              hasMore
                ? `${title} 더보기, ${Math.min(TRANSACTION_LIST_STEP, remainingCount)}건`
                : `${title} 접기, 처음 ${TRANSACTION_LIST_INITIAL_COUNT}건만 표시`
            }
            onClick={() =>
              setVisibleCount((current) =>
                hasMore
                  ? Math.min(
                      transactions.length,
                      current + TRANSACTION_LIST_STEP,
                    )
                  : TRANSACTION_LIST_INITIAL_COUNT,
              )
            }
          >
            <span>
              {hasMore
                ? `더보기 · ${Math.min(TRANSACTION_LIST_STEP, remainingCount)}건`
                : "접기 · 처음 10건만"}
            </span>
            <i aria-hidden="true">{hasMore ? "↓" : "↑"}</i>
          </button>
        </div>
      )}
    </section>
  );
}

export default function ComplexDetailPanel({
  complex,
  endMonth,
  workplaceIds = [],
  onClose,
}: Props) {
  const [period, setPeriod] = useState<DetailPeriod>(1);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("sale");
  const [transactionState, setTransactionState] = useState<{
    complexId: string;
    items: ComplexTransaction[];
  }>({ complexId: complex.id, items: [] });
  const transactions =
    transactionState.complexId === complex.id
      ? transactionState.items
      : EMPTY_TRANSACTIONS;
  const [selectedArea, setSelectedArea] = useState<number | null>(
    complex.defaultArea === null ? null : Math.round(complex.defaultArea),
  );
  const [mode, setMode] = useState<ComplexDetailResponse["mode"]>("unavailable");
  const [message, setMessage] = useState("실거래 데이터를 불러오고 있습니다.");
  const nearbyStations = getNearbyStations(complex.id);
  const nearbyStationsNote = STATION_DISTANCE_NOTE;
  const [places, setPlaces] = useState<PlacesResponse | null>(null);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [placesError, setPlacesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 1 });
  const [missing, setMissing] = useState({ sale: true, rent: true });
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
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

    async function loadPlaces() {
      setPlacesLoading(true);
      setPlacesError("");
      try {
        const params = new URLSearchParams({
          district: complex.district,
          dong: complex.dong,
          apartment: complex.apartment,
        });
        const response = await fetch(`/api/places?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("생활권 정보를 불러오지 못했습니다.");
        setPlaces((await response.json()) as PlacesResponse);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setPlacesError(
          loadError instanceof Error
            ? loadError.message
            : "생활권 정보를 불러오지 못했습니다.",
        );
      } finally {
        if (!controller.signal.aborted) setPlacesLoading(false);
      }
    }

    void loadPlaces();
    return () => controller.abort();
  }, [complex.apartment, complex.district, complex.dong]);

  useEffect(() => {
    const controller = new AbortController();
    const ranges = chunkRanges(endMonth, period, complex.buildYear);

    async function load() {
      setLoading(true);
      setError("");
      setMode("unavailable");
      setMessage("");
      setMissing({ sale: true, rent: true });
      setFetchedAt(null);
      setTransactionState({ complexId: complex.id, items: [] });
      setLoadProgress({ loaded: 0, total: ranges.length });
      try {
        const payloads: ComplexDetailResponse[] = [];
        for (const [rangeIndex, range] of ranges.entries()) {
          const params = new URLSearchParams({
            complexId: complex.id, from: range.from, to: range.to,
          });
          const response = await fetch("/api/complex?" + params, {
            signal: controller.signal, cache: "no-store",
          });
          if (!response.ok) throw new Error("단지 상세 데이터를 불러오지 못했습니다.");
          const payload = (await response.json()) as ComplexDetailResponse;
          payloads.push(payload);

          if (controller.signal.aborted) return;
          const merged = payloads
            .flatMap((payload) => payload.mode === "stored" || payload.mode === "partial" ? payload.transactions : [])
            .filter(
              (transaction, index, all) =>
                all.findIndex((candidate) => candidate.id === transaction.id) === index,
            )
            .sort((a, b) => b.date.localeCompare(a.date));
          setTransactionState({ complexId: complex.id, items: merged });
          setMode(
            payloads.every((payload) => payload.mode === "stored") ? "stored"
              : payloads.some((payload) => payload.mode === "stored" || payload.mode === "partial")
                ? "partial" : "unavailable",
          );
          setMessage([...new Set(payloads.filter((payload) => payload.mode !== "stored").map((payload) => payload.message))].join(" ") || payloads[0]?.message || "단지 상세 실거래 자료");
          setMissing({
            sale: payloads.some(item => item.missing.some(scope => scope.kind === "sale")),
            rent: payloads.some(item => item.missing.some(scope => scope.kind === "rent")),
          });
          setFetchedAt(payloads.map(item => item.fetchedAt).filter((value): value is string => !!value).sort().at(-1) ?? null);
          setLoadProgress({ loaded: rangeIndex + 1, total: ranges.length });
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setMode("partial");
        setMissing({ sale: true, rent: true });
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
  }, [complex, endMonth, period]);

  const areas = useMemo(
    () =>
      [
        ...new Set(
          [
            ...complex.areas,
            complex.defaultArea,
            ...transactions.map((item) => item.area),
          ]
            .filter((area): area is number => area !== null && area > 0)
            .map((area) => Math.round(area)),
        ),
      ]
        .sort((a, b) => a - b),
    [complex.areas, complex.defaultArea, transactions],
  );
  const effectiveArea = !areas.length
    ? null
    : selectedArea !== null && areas.includes(selectedArea)
      ? selectedArea
      : selectedArea === null
        ? areas[0]
        : areas.reduce((nearest, area) =>
            Math.abs(area - selectedArea) < Math.abs(nearest - selectedArea)
              ? area
              : nearest,
          );
  const areaTransactions = useMemo(
    () =>
      effectiveArea === null
        ? transactions
        : transactions.filter((item) => Math.round(item.area) === effectiveArea),
    [effectiveArea, transactions],
  );
  const recentSales = areaTransactions.filter((item) => item.type === "sale");
  const recentRents = areaTransactions.filter((item) => item.type !== "sale");
  const latestSale = recentSales[0] ?? null;
  const latestJeonse = recentRents.find((item) => item.type === "jeonse") ?? null;
  const latestSaleSummary = latestSale;
  const emptyMessage = (kind: "sale" | "rent") => emptyTradeMessage(kind, endMonth, loading, error, missing);
  const jeonseRatio =
    latestSale && latestJeonse
      ? Math.round((latestJeonse.price / latestSale.price) * 100)
      : null;
  const locationQuery =
    complex.address.trim() ||
    places?.location.mapQuery ||
    ["서울특별시", complex.district, complex.dong, complex.apartment].join(" ");
  const areaCaption =
    effectiveArea === null ? "면적 정보 없음" : `${effectiveArea}㎡ 기준`;
  const workplaceAccess = workplaceIds.map((workplaceId) => ({
    workplace: WORKPLACE_BY_ID[workplaceId],
    match: findDirectLineMatch(nearbyStations, workplaceId),
  }));
  const schoolScopeLabel =
    places?.schoolScope === "same-dong"
      ? "같은 동 주소"
      : places?.schoolScope === "same-district"
        ? "같은 자치구"
        : places?.schoolScope === "dong-name"
          ? "동명 검색"
          : "조회 안내";

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
            <p className="section-kicker">내집어디 · 단지 정보</p>
            <h2 id="complex-detail-title">{complex.apartment}</h2>
            <p>
              {complex.district} {complex.dong}
              <span aria-hidden="true"> · </span>
              {complex.buildYear ? `${complex.buildYear}년 준공` : "준공연도 미확인"}
              {complex.households !== null && (
                <>
                  <span aria-hidden="true"> · </span>
                  {complex.households.toLocaleString()}세대
                </>
              )}
              {complex.buildingCount !== null && (
                <>
                  <span aria-hidden="true"> · </span>
                  {complex.buildingCount}개 동
                </>
              )}
            </p>
          </div>
          <button className="detail-close" onClick={onClose} aria-label="단지 상세 닫기">
            ×
          </button>
        </header>

        <div className={`detail-source ${mode}`}>
          <span>
            {mode === "stored" ? "저장 자료" : mode === "partial" ? "일부 수집" : "미확인"}
          </span>
          <p>{message}{fetchedAt ? ` · 최근 수집 ${new Date(fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : ""}</p>
        </div>

        <section className="detail-summary" aria-label="단지 최근 가격 요약">
          <article>
            <span>최근 매매가</span>
            <strong>
              {latestSaleSummary ? formatPrice(latestSaleSummary.price) : "-"}
            </strong>
            <small>{latestSaleSummary?.date ?? emptyMessage("sale")}</small>
          </article>
          <article>
            <span>최근 전세가</span>
            <strong>{latestJeonse ? formatPrice(latestJeonse.price) : "-"}</strong>
            <small>{latestJeonse?.date ?? emptyMessage("rent")}</small>
          </article>
          <article>
            <span>전세가율</span>
            <strong>{jeonseRatio === null ? "-" : `${jeonseRatio}%`}</strong>
            <small>최근 매매·전세 기준</small>
          </article>
        </section>

        <section className="detail-location" aria-labelledby="detail-location-title">
          <div className="detail-section-heading">
            <div className="detail-section-heading-main">
              <span className="detail-section-index">01</span>
              <div>
                <h3 id="detail-location-title">위치 지도</h3>
                <p>{locationQuery}</p>
              </div>
            </div>
            <span className="detail-section-label">LOCATION MAP</span>
          </div>
          <div className="detail-map-layout">
            <NaverMap
              query={locationQuery}
              apartment={complex.apartment}
              district={complex.district}
              dong={complex.dong}
              externalUrl={naverMapSearchUrl(locationQuery)}
            />
            <div className="detail-map-copy">
              <span>NAVER DYNAMIC MAP</span>
              <strong>{complex.apartment}</strong>
              <p>
                단지명과 법정동 주소로 찾은 위치입니다. 동일 명칭 단지가 있을 수 있으므로
                상세 위치와 길찾기는 네이버지도에서 한 번 더 확인해 주세요.
              </p>
              <div>
                <a
                  href={naverMapSearchUrl(locationQuery)}
                  target="_blank"
                  rel="noreferrer"
                >
                  네이버지도에서 열기
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="detail-stations" aria-labelledby="nearby-stations-title">
          <div className="detail-section-heading">
            <div className="detail-section-heading-main">
              <span className="detail-section-index">02</span>
              <div>
                <h3 id="nearby-stations-title">교통정보</h3>
                <p>인근 지하철역과 선택 직장 직통 노선</p>
              </div>
            </div>
            <span className="detail-section-label">SUBWAY ACCESS</span>
          </div>
          {nearbyStations.length ? (
            <div className="detail-station-list">
              {nearbyStations.map((station, index) => (
                <article key={station.key ?? `${station.name}-${station.lines}`}>
                  <span className="station-rank">0{index + 1}</span>
                  <div className="station-main">
                    <strong>{station.name}역</strong>
                    <span>{station.lines}</span>
                  </div>
                  <div className="station-distance">
                    <strong>직선 {formatStationDistance(station.distanceMeters)}</strong>
                    <span>도보 약 {station.walkMinutes}분</span>
                  </div>
                  <a
                    href={naverMapSearchUrl(`${locationQuery} ${station.name}역`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    네이버지도
                  </a>
                </article>
              ))}
            </div>
          ) : (
            <p className="detail-station-empty">단지 좌표가 미확인이거나 반경 1.5km 내 확인된 역이 없습니다.</p>
          )}
          {workplaceAccess.length ? (
            <div className="detail-workplace-access">
              {workplaceAccess.map(({ workplace, match }) => (
                <article key={workplace.id} className={match ? "available" : "unavailable"}>
                  <div>
                    <span>{match ? "DIRECT LINE" : "ROUTE CHECK"}</span>
                    <strong>{workplace.name}</strong>
                  </div>
                  <p>
                    {match
                      ? `${match.station.name}역에서 ${match.sharedLines.join("·")} 환승 없이 연결`
                      : "현재 생활권 역 정보에서 직통 노선이 확인되지 않습니다."}
                  </p>
                  <a
                    href={naverMapSearchUrl(
                      `${locationQuery} ${workplace.name} 대중교통`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    네이버지도 경로 확인
                  </a>
                </article>
              ))}
            </div>
          ) : (
            <p className="detail-workplace-hint">
              대시보드에서 직장 1·2를 선택하면 이곳에 직통 가능 노선을 함께 표시합니다.
            </p>
          )}
          <p className="detail-station-note">※ {nearbyStationsNote}<br />출처: 서울특별시 <a href="https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do" target="_blank" rel="noreferrer">공동주택 정보</a> · <a href="https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do" target="_blank" rel="noreferrer">역사마스터</a> (공공누리 1유형)</p>
        </section>

        <section className="detail-schools" aria-labelledby="nearby-schools-title">
          <div className="detail-section-heading">
            <div className="detail-section-heading-main">
              <span className="detail-section-index">03</span>
              <div>
                <h3 id="nearby-schools-title">인근 학교정보</h3>
                <p>{places?.source.name ?? "서울시교육청 학교정보"} · {schoolScopeLabel}</p>
              </div>
            </div>
            <span className="detail-section-label">SCHOOL INFO</span>
          </div>
          {placesLoading ? (
            <div className="detail-school-loading" aria-live="polite">
              학교정보를 불러오는 중입니다.
            </div>
          ) : places?.schools.length ? (
            <div className="detail-school-list">
              {places.schools.map((school) => (
                <article key={school.code}>
                  <div>
                    <span>{school.level}</span>
                    {school.foundation && <em>{school.foundation}</em>}
                  </div>
                  <strong>{school.name}</strong>
                  <p>{school.address}</p>
                  <footer>
                    {school.phone && <span>{school.phone}</span>}
                    {school.homepage && (
                      <a href={school.homepage} target="_blank" rel="noreferrer">
                        홈페이지
                      </a>
                    )}
                    <a
                      href={naverMapSearchUrl(`${school.name} ${school.address}`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      지도
                    </a>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="detail-school-empty">
              <p>{placesError || places?.note || "표시할 학교정보가 없습니다."}</p>
              <a
                href={naverMapSearchUrl(`${complex.district} ${complex.dong} 학교`)}
                target="_blank"
                rel="noreferrer"
              >
                지도에서 주변 학교 확인
              </a>
            </div>
          )}
          {places?.note && places.schools.length > 0 && (
            <p className="detail-school-note">
              ※ {places.note}
              <span aria-hidden="true"> · </span>
              <a href={places.source.url} target="_blank" rel="noreferrer">
                공공데이터 원문
              </a>
            </p>
          )}
        </section>

        <section className="detail-chart-section">
          <div className="detail-toolbar">
            <div>
              <span className="detail-control-label">전용면적</span>
              <div className="detail-toggle-list" aria-label="전용면적 선택">
                {areas.length ? (
                  areas.map((area) => (
                    <button
                      key={area}
                      className={effectiveArea === area ? "active" : ""}
                      aria-pressed={effectiveArea === area}
                      onClick={() => setSelectedArea(area)}
                    >
                      {area}㎡
                    </button>
                  ))
                ) : (
                  <span>면적 정보 없음</span>
                )}
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
              <p>월별 중위값과 거래량 · {areaCaption}</p>
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
                buildYear={complex.buildYear}
                metric={chartMetric}
                emptyNote={chartMetric === "ratio" && rentPeriodSupported(endMonth) && !loading && !error && !missing.sale && !missing.rent
                  ? "같은 월의 매매·전세 자료가 함께 있어야 전세가율을 표시합니다."
                  : emptyMessage(chartMetric === "sale" || (chartMetric === "ratio" && missing.sale) ? "sale" : "rent")}
              />
            </>
          )}
        </section>

        <div className="detail-list-grid">
          <TransactionList
            key={`sale:${complex.id}:${effectiveArea ?? "all"}:${period}`}
            title="최근 매매 실거래"
            caption={`${areaCaption} · 최신 계약순 · 금액 만원 단위`}
            transactions={recentSales}
            type="sale"
            emptyNote={emptyMessage("sale")}
            complete={!loading && !error && !missing.sale}
          />
          <TransactionList
            key={`rent:${complex.id}:${effectiveArea ?? "all"}:${period}`}
            title="최근 전세·월세 실거래"
            caption={`${areaCaption} · 보증금/월세 · 금액 만원 단위`}
            transactions={recentRents}
            type="rent"
            emptyNote={emptyMessage("rent")}
            complete={rentPeriodSupported(endMonth) && !loading && !error && !missing.rent}
          />
        </div>

        <p className="detail-footnote">
          실거래 신고 자료는 취소·정정될 수 있으며, 동·호수 정보는 개인정보 보호를 위해
          제공되지 않습니다. 매매는 2006년 1월, 전월세는 2011년 1월 이후 자료를
          단지 준공연도부터 저장된 범위에서 조회합니다. 새로고침으로 외부 자료를 수집하지 않습니다.
        </p>
      </section>
    </div>
  );
}
