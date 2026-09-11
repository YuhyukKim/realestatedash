"use client";

import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  STATION_OPTIONS,
  WORKPLACES,
  WORKPLACE_BY_ID,
  getDirectWorkplaceMatch,
  hasDirectWorkplaceAccess,
  type WorkplaceId,
} from "./access";
import {
  compareWorkplaceCommutes,
  getWorkplaceCommuteEstimate,
  supportsWorkplaceCommuteSort,
  type WorkplaceCommuteEstimate,
} from "./commute";
import { isSelectableMonth, seoulMonth } from "./site-config";
import { periodTradeLabel } from "../lib/trade-coverage.mjs";

const ComplexDetailPanel = lazy(() => import("./complex-detail"));
import {
  NO_SALE_BUCKET,
  compareComplexes,
  normalizeComplexRecord,
  toComplexDetailSeed,
  type ComplexMasterRecord,
  type ComplexesApiResponse,
  type ComplexSortMode,
} from "./complex-master";
import { SEOUL_DISTRICTS, type Trade } from "./data";
import { groupTradesByMaster } from "./master-trade-matcher";
import { getNearbyStations, selectNearbyStation, TRANSIT_COVERAGE, type NearbyStation } from "./stations";

import { applyAreaPriceFilter, latestSalesByArea, type AreaSaleSummary } from "./area-sales";

type DataMode = "unavailable" | "live" | "partial" | "stored";
type MasterLoadState = "loading" | "ready" | "error";

type TradesApiResponse = {
  mode: "unavailable" | "stored" | "partial";
  trades: Trade[];
  completedDistricts?: string[];
  fetchedAt: string | null;
  message: string;
};

type ComplexResult = {
  key: string;
  record: ComplexMasterRecord;
  periodTrades: Trade[];
  latestObservedTrade: Trade | null;
  station: NearbyStation | null;
};

type RankedComplexResult = ComplexResult & {
  workplaceCommute: WorkplaceCommuteEstimate | null;
};

type ApartmentSortMode =
  | ComplexSortMode
  | "distance-asc"
  | "distance-desc"
  | "workplace-asc"
  | "workplace-desc";

const PRICE_BANDS = [
  { id: "under-6", label: "6억 미만", min: 0, max: 6, accent: "#58a88c" },
  { id: "6-10", label: "6억~10억", min: 6, max: 11, accent: "#5b93c7" },
  { id: "11-15", label: "11억~15억", min: 11, max: 16, accent: "#6478bd" },
  { id: "16-20", label: "16억~20억", min: 16, max: 21, accent: "#7a69a9" },
  { id: "21-25", label: "21억~25억", min: 21, max: 26, accent: "#a45f82" },
  { id: "26-30", label: "26억~30억", min: 26, max: 31, accent: "#c36068" },
  { id: "31-40", label: "31억~40억", min: 31, max: 41, accent: "#d17a4f" },
  { id: "41-50", label: "41억~50억", min: 41, max: 51, accent: "#b48a34" },
  { id: "51-70", label: "51억~70억", min: 51, max: 71, accent: "#7d9341" },
  { id: "71-100", label: "71억 이상", min: 71, max: Infinity, accent: "#4d68a8" },
] as const;

const AREA_BANDS = [
  { id: "all", label: "전체", min: 0, max: Infinity },
  { id: "small", label: "10평대", min: 0, max: 60 },
  { id: "20s", label: "20평대", min: 60, max: 85 },
  { id: "30s", label: "30평대", min: 85, max: 115 },
  { id: "40s", label: "40평대", min: 115, max: 150 },
  { id: "large", label: "50평+", min: 150, max: Infinity },
] as const;

const MOVE_IN_YEAR_BANDS = [
  { id: "all", label: "전체 연도", min: 0, max: Infinity },
  { id: "2021-plus", label: "2021년 이후", min: 2021, max: Infinity },
  { id: "2011-2020", label: "2011~2020년", min: 2011, max: 2021 },
  { id: "2001-2010", label: "2001~2010년", min: 2001, max: 2011 },
  { id: "1991-2000", label: "1991~2000년", min: 1991, max: 2001 },
  { id: "1981-1990", label: "1981~1990년", min: 1981, max: 1991 },
  { id: "before-1981", label: "1980년 이전", min: 0, max: 1981 },
  { id: "unknown", label: "연도 미확인", min: 0, max: 0 },
] as const;

const STATION_RANGES = [
  { id: "all", label: "전체", max: Infinity },
  { id: "200", label: "200m", max: 200 },
  { id: "500", label: "500m", max: 500 },
  { id: "800", label: "800m", max: 800 },
  { id: "1000", label: "1km", max: 1000 },
] as const;

function formatPrice(price: number) {
  return Number.isInteger(price) ? `${price}억` : `${price.toFixed(1)}억`;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}.${day}`;
}

function formatPyeong(area: number) {
  return `${(area / 3.3058).toFixed(0)}평`;
}

function getPriceBand(price: number) {
  return PRICE_BANDS.find((band) => price >= band.min && price < band.max);
}

function getBuildingAge(buildYear: number | null) {
  if (!buildYear) return null;
  return Math.max(0, new Date().getFullYear() - buildYear);
}

function formatBuildingInfo(buildYear: number | null) {
  const age = getBuildingAge(buildYear);
  return buildYear && age !== null
    ? `${buildYear}년 · ${age}년차`
    : "연식 미확인";
}

function compareStationDistances(
  left: ComplexResult,
  right: ComplexResult,
  direction: "asc" | "desc",
) {
  const leftDistance = left.station?.distanceMeters ?? null;
  const rightDistance = right.station?.distanceMeters ?? null;

  if (leftDistance === null && rightDistance === null) {
    return left.record.name.localeCompare(right.record.name, "ko");
  }
  if (leftDistance === null) return 1;
  if (rightDistance === null) return -1;

  const distanceDifference =
    direction === "asc"
      ? leftDistance - rightDistance
      : rightDistance - leftDistance;
  return (
    distanceDifference || left.record.name.localeCompare(right.record.name, "ko")
  );
}

export function mergeMasterWithTrades(
  master: ComplexMasterRecord[],
  trades: Trade[],
  storedSales: Record<string, AreaSaleSummary[]> = {},
  refreshedMonth?: string,
  refreshedDistricts?: string[],
): ComplexResult[] {
  const normalizedMaster = master.map(normalizeComplexRecord);
  const { tradesByMasterId } = groupTradesByMaster(normalizedMaster, trades);
  return normalizedMaster.map((record) => {
    const periodTrades = tradesByMasterId.get(record.id) ?? [];
    const ordered = [...periodTrades].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    const latestObservedTrade = ordered[0] ?? null;
    const districtRefreshed = !!refreshedMonth && (!refreshedDistricts || refreshedDistricts.includes(record.district));
    const isRefreshedSale = (sale: { date: string }) => districtRefreshed && sale.date.replaceAll("-", "").slice(0, 6) === refreshedMonth;
    const areaSales = latestSalesByArea([
      ...(storedSales[record.id] ?? record.areaSales ?? []).filter((sale) =>
        !isRefreshedSale(sale)),
      ...periodTrades,
    ]);
    const storedLatest = [...areaSales].sort((a, b) => b.date.localeCompare(a.date) || b.price - a.price)[0];
    const existingSale = storedLatest ?? (record.latestSale && !isRefreshedSale(record.latestSale) ? record.latestSale : null);
    const observedSale = latestObservedTrade
      ? { price: latestObservedTrade.price, date: latestObservedTrade.date }
      : null;
    const latestSale =
      !existingSale ||
      (observedSale && observedSale.date.localeCompare(existingSale.date) > 0)
        ? observedSale
        : existingSale;
    const mergedRecord = normalizeComplexRecord({
      ...record,
      latestSale,
      areaSales,
      areas: [...record.areas, ...areaSales.map((sale) => sale.area)],
    });

    return {
      key: mergedRecord.id,
      record: mergedRecord,
      periodTrades,
      latestObservedTrade,
      station:
        getNearbyStations(mergedRecord.id)[0] ?? null,
    };
  });
}

export default function Home() {
  const [masterComplexes, setMasterComplexes] =
    useState<ComplexMasterRecord[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [storedSales, setStoredSales] = useState<Record<string, AreaSaleSummary[]>>({});
  const [refreshedMonth, setRefreshedMonth] = useState<string | undefined>();
  const [refreshedDistricts, setRefreshedDistricts] = useState<string[]>([]);
  const loadController = useRef<AbortController | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState("서울 전체");
  const [selectedArea, setSelectedArea] = useState("all");
  const [selectedMoveInYear, setSelectedMoveInYear] = useState("all");
  const [selectedPriceBand, setSelectedPriceBand] = useState("all");
  const [selectedStationRange, setSelectedStationRange] = useState("all");
  const [selectedWorkplace1, setSelectedWorkplace1] = useState<WorkplaceId | "">("");
  const [selectedWorkplace2, setSelectedWorkplace2] = useState<WorkplaceId | "">("");
  const [selectedSubway1, setSelectedSubway1] = useState("");
  const [selectedSubway2, setSelectedSubway2] = useState("");
  const [visibleResultLimit, setVisibleResultLimit] = useState(60);
  const [sortMode, setSortMode] =
    useState<ApartmentSortMode>("price-desc");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(() => seoulMonth());
  const deferredSearch = useDeferredValue(search);
  const [mode, setMode] = useState<DataMode>("unavailable");
  const [masterLoadState, setMasterLoadState] =
    useState<MasterLoadState>("loading");
  const [statusMessage, setStatusMessage] = useState(
    "공식 서울 아파트 단지 마스터와 실거래 자료를 불러오고 있습니다.",
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedComplex, setSelectedComplex] =
    useState<ComplexMasterRecord | null>(null);

  async function loadDashboard(targetMonth: string) {
    if (!isSelectableMonth(targetMonth)) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    const current = () => loadController.current === controller && !controller.signal.aborted;
    const requestMonth = targetMonth.replace("-", "");
    setLoading(true);
    setTrades([]);
    setStoredSales({});
    setRefreshedMonth(undefined);
    setRefreshedDistricts([]);
    setMode("unavailable");
    setUpdatedAt(null);
    setStatusMessage("단지 목록과 저장된 매매 자료를 불러옵니다.");
    if (!masterComplexes.length) setMasterLoadState("loading");
    const messages: string[] = [];
    let tradesMode: DataMode = "unavailable";
    let savedCount = 0;

    async function readSavedSales() {
      const response = await fetch(`/api/area-summaries?month=${requestMonth}`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("summary unavailable");
      const saved = await response.json();
      if (saved.mode !== "stored") throw new Error("summary unavailable");
      if (!current()) return;
      savedCount = Object.values(saved.summaries as Record<string, AreaSaleSummary[]>)
        .reduce((count, rows) => count + rows.length, 0);
      setStoredSales(saved.summaries);
      if (savedCount && tradesMode === "unavailable") {
        setMode("stored");
        setStatusMessage("저장된 매매가를 표시합니다. 가격 옆 날짜는 계약일입니다.");
      }
    }

    // Independent database reads; collection runs outside visitor requests.
    const masterTask = (async () => {
      try {
        const response = await fetch("/api/complexes?limit=20000", { signal });
        if (!response.ok) throw new Error("master unavailable");
        const data = (await response.json()) as ComplexesApiResponse;
        if (!data.complexes.length) throw new Error("empty master");
        if (!current()) return;
        setMasterComplexes(data.complexes.map(normalizeComplexRecord));
        setMasterLoadState("ready");
        if (data.message) messages.push(data.message);
      } catch {
        if (!current()) return;
        setMasterLoadState(masterComplexes.length ? "ready" : "error");
        messages.push(masterComplexes.length
          ? "단지 목록 갱신 실패: 기존 목록을 유지합니다."
          : "단지 마스터 연결을 확인할 수 없습니다.");
      }
    })();
    const savedTask = readSavedSales().catch(() => {
      messages.push("저장된 매매 자료를 불러오지 못했습니다.");
    });
    const tradesTask = (async () => {
      try {
        const response = await fetch(`/api/trades?month=${requestMonth}`, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("trades unavailable");
        const data = (await response.json()) as TradesApiResponse;
        if (!current()) return;
        const hasRealResponse = data.mode === "stored" || data.mode === "partial";
        setTrades(hasRealResponse ? data.trades : []);
        tradesMode = data.mode;
        setRefreshedMonth(hasRealResponse ? requestMonth : undefined);
        setRefreshedDistricts(data.completedDistricts ?? []);
        setUpdatedAt(data.fetchedAt);
        if (data.message) messages.push(data.message);
      } catch {
        if (current()) messages.push("선택 월 실거래 조회에 실패했습니다. 미조회 지역은 거래가 없는 지역을 뜻하지 않습니다.");
      }
    })();

    await Promise.allSettled([masterTask, savedTask, tradesTask]);
    if (!current()) return;
    setMode(tradesMode === "unavailable" && savedCount ? "stored" : tradesMode);
    messages.push("가격의 날짜는 계약일입니다. 실시간 시세나 매물 호가가 아니며, 선택월 실거래 미조회는 거래 0건을 의미하지 않습니다.");
    setStatusMessage(messages.join(" "));
    setLoading(false);
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadDashboard(month);
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      loadController.current?.abort();
    };
    // The first request hydrates the dashboard with the configured data source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mergedComplexes = useMemo(
    () => mergeMasterWithTrades(masterComplexes, trades, storedSales, refreshedMonth, refreshedDistricts),
    [masterComplexes, trades, storedSales, refreshedMonth, refreshedDistricts],
  );

  const complexes = useMemo(() => {
    const area = AREA_BANDS.find((band) => band.id === selectedArea)!;
    const moveInYear = MOVE_IN_YEAR_BANDS.find(
      (band) => band.id === selectedMoveInYear,
    )!;
    const priceBand = PRICE_BANDS.find((band) => band.id === selectedPriceBand);
    const stationRange = STATION_RANGES.find(
      (range) => range.id === selectedStationRange,
    )!;
    const keyword = deferredSearch.trim().toLowerCase();
    const selectedWorkplaces = [selectedWorkplace1, selectedWorkplace2].filter(
      (value): value is WorkplaceId => Boolean(value),
    );
    const selectedSubways = [selectedSubway1, selectedSubway2].filter(Boolean);

    const filteredComplexes = mergedComplexes
      .filter(
        (complex) =>
          selectedDistrict === "서울 전체" ||
          complex.record.district === selectedDistrict,
      )
      .flatMap((complex) => {
        const record = applyAreaPriceFilter(complex.record, selectedArea === "all" ? null : area, priceBand);
        if (!record) return [];
        const periodTrades = complex.periodTrades.filter((trade) =>
          selectedArea === "all" || (trade.area >= area.min && trade.area < area.max));
        return [{ ...complex, record, periodTrades }];
      })
      .filter((complex) => {
        if (selectedMoveInYear === "all") return true;
        if (selectedMoveInYear === "unknown") {
          return complex.record.buildYear === null;
        }
        return Boolean(
          complex.record.buildYear &&
            complex.record.buildYear >= moveInYear.min &&
            complex.record.buildYear < moveInYear.max,
        );
      })

      .flatMap((complex) => {
        const station = selectNearbyStation(getNearbyStations(complex.record.id), selectedSubways, stationRange.max);
        if ((selectedSubways.length || selectedStationRange !== "all") && !station) return [];
        return [{ ...complex, station }];
      })
      .filter((complex) =>
        selectedWorkplaces.every((workplaceId) =>
          hasDirectWorkplaceAccess(complex.record.id, workplaceId),
        ),
      )
      .filter((complex) => {
        if (!keyword) return true;
        return `${complex.record.district} ${complex.record.dong} ${complex.record.name} ${complex.record.address}`
          .toLowerCase()
          .includes(keyword);
      });

    return filteredComplexes
      .map<RankedComplexResult>((complex) => ({
        ...complex,
        workplaceCommute: selectedWorkplace1
          ? getWorkplaceCommuteEstimate(
              complex.record.id,
              selectedWorkplace1,
            )
          : null,
      }))
      .sort((left, right) => {
        if (sortMode === "distance-asc" || sortMode === "distance-desc") {
          return compareStationDistances(
            left,
            right,
            sortMode === "distance-asc" ? "asc" : "desc",
          );
        }
        if (sortMode === "workplace-asc" || sortMode === "workplace-desc") {
          return (
            compareWorkplaceCommutes(
              left.workplaceCommute,
              right.workplaceCommute,
              sortMode === "workplace-asc" ? "asc" : "desc",
            ) || left.record.name.localeCompare(right.record.name, "ko-KR")
          );
        }
        return compareComplexes(left.record, right.record, sortMode);
      });
  }, [
    mergedComplexes,
    selectedDistrict,
    selectedArea,
    selectedMoveInYear,
    selectedPriceBand,
    selectedStationRange,
    selectedWorkplace1,
    selectedWorkplace2,
    selectedSubway1,
    selectedSubway2,
    deferredSearch,
    sortMode,
  ]);

  const summary = useMemo(() => {
    const prices = complexes
      .map((complex) => complex.record.latestSale?.price ?? null)
      .filter((price): price is number => price !== null)
      .sort((a, b) => a - b);
    const periodTradeCount = complexes.reduce(
      (total, complex) => total + complex.periodTrades.length,
      0,
    );
    if (!prices.length) {
      return {
        count: 0,
        median: 0,
        average: 0,
        latest: "-",
        periodTradeCount,
        noSaleCount: complexes.length,
      };
    }
    const middle = Math.floor(prices.length / 2);
    const median =
      prices.length % 2
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2;
    const average =
      prices.reduce((total, price) => total + price, 0) / prices.length;
    const latest = complexes
      .map((complex) => complex.record.latestSale?.date ?? null)
      .filter((date): date is string => date !== null)
      .sort((a, b) => b.localeCompare(a))[0] ?? "-";
    return {
      count: prices.length,
      median,
      average,
      latest,
      periodTradeCount,
      noSaleCount: complexes.length - prices.length,
    };
  }, [complexes]);

  const distribution = useMemo(() => {
    const bands = [
      ...PRICE_BANDS.map((band) => ({
        ...band,
        count: complexes.filter((complex) => {
          const price = complex.record.latestSale?.price;
          return price !== undefined && price >= band.min && price < band.max;
        }).length,
      })),
      {
        ...NO_SALE_BUCKET,
        count: complexes.filter((complex) => !complex.record.latestSale).length,
      },
    ];
    const max = Math.max(1, ...bands.map((band) => band.count));
    return bands.map((band) => ({ ...band, ratio: (band.count / max) * 100 }));
  }, [complexes]);

  const activeConditions = useMemo(() => {
    const selectedSubways = [selectedSubway1, selectedSubway2].filter(Boolean);
    const conditions = [
      selectedDistrict,
      AREA_BANDS.find((band) => band.id === selectedArea)?.label,
      selectedMoveInYear === "all"
        ? null
        : `입주·준공 ${MOVE_IN_YEAR_BANDS.find((band) => band.id === selectedMoveInYear)?.label}`,
      selectedPriceBand === "all"
        ? null
        : PRICE_BANDS.find((band) => band.id === selectedPriceBand)?.label,
      selectedStationRange === "all"
        ? null
        : `역 ${STATION_RANGES.find((range) => range.id === selectedStationRange)?.label} 이내`,
      selectedWorkplace1 ? WORKPLACE_BY_ID[selectedWorkplace1].label : null,
      selectedWorkplace2 ? WORKPLACE_BY_ID[selectedWorkplace2].label : null,
      selectedSubways.length
        ? `인근역 ${selectedSubways.map((name) => `${name}역`).join(" 또는 ")}`
        : null,
    ];
    return conditions.filter(Boolean) as string[];
  }, [
    selectedDistrict,
    selectedArea,
    selectedMoveInYear,
    selectedPriceBand,
    selectedStationRange,
    selectedWorkplace1,
    selectedWorkplace2,
    selectedSubway1,
    selectedSubway2,
  ]);

  async function downloadExcel() {
    const XLSX = await import("xlsx");
    const rows = complexes.map(({ record, station, periodTrades }) => ({
      가격구간: record.latestSale
        ? getPriceBand(record.latestSale.price)?.label ?? ""
        : "매매가 미확인",
      자치구: record.district,
      법정동: record.dong,
      아파트명: record.name,
      주소: record.address,
      "최근매매가(억원)": record.latestSale?.price ?? "",
      최근매매일: record.latestSale?.date ?? "",
      "전용면적(㎡)": record.areas.join(", "),
      건축연도: record.buildYear ?? "",
      현재연식: getBuildingAge(record.buildYear) ?? "",
      세대수: record.households ?? "",
      동수: record.buildingCount ?? "",
      인근역: station?.name ?? "",
      "선택월 거래(건)": refreshedDistricts.includes(record.district) ? periodTrades.length : "",
      "선택월 조회상태": refreshedDistricts.includes(record.district) ? "수집 완료" : "미수집",
      출처: record.source,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 13 },
      { wch: 10 },
      { wch: 12 },
      { wch: 24 },
      { wch: 35 },
      { wch: 18 },
      { wch: 14 },
      { wch: 24 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 8 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "서울 단지 마스터");
    const district = selectedDistrict.replace(" ", "");
    XLSX.writeFile(
      workbook,
      `서울_아파트_단지마스터_${month.replace("-", "")}_${district}.xlsx`,
    );
  }

  function resetFilters() {
    setSelectedDistrict("서울 전체");
    setSelectedArea("all");
    setSelectedMoveInYear("all");
    setSelectedPriceBand("all");
    setSelectedStationRange("all");
    setSelectedWorkplace1("");
    setSelectedWorkplace2("");
    setSelectedSubway1("");
    setSelectedSubway2("");
    setVisibleResultLimit(60);
    setSortMode("price-desc");
    setSearch("");
  }

  return (
    <main className="dashboard-shell finder-layout">
      <header className="finder-topbar">
        <a className="finder-brand" href="#top" aria-label="내집어디 홈">
          <span className="finder-brand-mark" aria-hidden="true">집</span>
          <span>
            <strong>내집어디</strong>
            <small>서울 아파트 찾기</small>
          </span>
        </a>
        <div className={`finder-data-status ${mode}`}>
          <span aria-hidden="true" />
          {loading ? "자료 불러오는 중" : mode === "live" ? "실거래 확인" : mode === "partial" ? "일부 지역 확인" : mode === "stored" ? "저장된 매매" : "매매 자료 미확인"}
        </div>
      </header>

      <section className="finder-intro" id="top">
        <div>
          <p className="finder-kicker">서울 아파트 탐색</p>
          <h1>내 조건에 맞는 <em>집 찾기</em></h1>
          <p>
            공식 서울 아파트 단지 마스터에서 가격·면적·입주·준공년도·직장 직통권으로
            후보를 찾습니다. 등록 단지와 실거래 수집 범위는 서로 다릅니다.
          </p>
        </div>
        <div className="finder-intro-stats" aria-label="현재 조회 결과 요약">
          <article>
            <span>조회 단지</span>
            <strong>{complexes.length.toLocaleString()}</strong>
            <small>COMPLEXES</small>
          </article>
          <article>
            <span>최근 매매 중위가</span>
            <strong>{summary.count ? formatPrice(summary.median) : "-"}</strong>
            <small>MEDIAN</small>
          </article>
          <article>
            <span>최근 계약</span>
            <strong>{summary.latest === "-" ? "-" : summary.latest.slice(5)}</strong>
            <small>LATEST DEAL</small>
          </article>
        </div>
      </section>

      <div className="finder-workspace">
        <aside className="finder-filter-panel" aria-label="아파트 검색 조건">
          <div className="finder-panel-heading">
            <div>
              <span>01</span>
              <h2>아파트 찾기</h2>
            </div>
            <button type="button" onClick={resetFilters}>초기화</button>
          </div>

          <label className="finder-search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="주소 또는 단지명 검색"
            />
          </label>

          <div className="finder-filter-group">
            <label htmlFor="district-select">지역</label>
            <select
              id="district-select"
              value={selectedDistrict}
              onChange={(event) => setSelectedDistrict(event.target.value)}
            >
              <option>서울 전체</option>
              {SEOUL_DISTRICTS.map((district) => (
                <option key={district}>{district}</option>
              ))}
            </select>
          </div>

          <div className="finder-filter-group">
            <span className="finder-filter-title">전용면적</span>
            <div className="finder-chip-grid three">
              {AREA_BANDS.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  aria-pressed={selectedArea === area.id}
                  className={selectedArea === area.id ? "active" : ""}
                  onClick={() => setSelectedArea(area.id)}
                >
                  {area.label}
                </button>
              ))}
            </div>
          </div>

          <div className="finder-filter-group">
            <span className="finder-filter-title">매매 가격</span>
            <small className="finder-filter-note">선택 면적별 최근 매매 기준 · 미수집 가격 제외 · 같은 날 여러 거래는 최고가 기준</small>
            <div className="finder-chip-grid two">
              <button
                type="button"
                className={selectedPriceBand === "all" ? "active" : ""}
                aria-pressed={selectedPriceBand === "all"}
                onClick={() => setSelectedPriceBand("all")}
              >
                전체 가격
              </button>
              {PRICE_BANDS.map((band) => (
                <button
                  key={band.id}
                  type="button"
                  aria-pressed={selectedPriceBand === band.id}
                  className={selectedPriceBand === band.id ? "active" : ""}
                  onClick={() => setSelectedPriceBand(band.id)}
                >
                  {band.label}
                </button>
              ))}
            </div>
          </div>

          <div className="finder-filter-group">
            <label htmlFor="move-in-year-select">입주·준공년도</label>
            <select
              id="move-in-year-select"
              value={selectedMoveInYear}
              onChange={(event) => setSelectedMoveInYear(event.target.value)}
            >
              {MOVE_IN_YEAR_BANDS.map((band) => (
                <option key={band.id} value={band.id}>{band.label}</option>
              ))}
            </select>
            <small className="finder-filter-note">공동주택 단지 마스터의 사용승인·준공년도 기준</small>
          </div>

          <div className="finder-filter-group">
            <span className="finder-filter-title">가까운 지하철역</span>
            <div className="finder-chip-grid five">
              {STATION_RANGES.map((range) => (
                <button
                  key={range.id}
                  type="button"
                  aria-pressed={selectedStationRange === range.id}
                  className={selectedStationRange === range.id ? "active" : ""}
                  onClick={() => setSelectedStationRange(range.id)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>

          <div className="finder-filter-group finder-access-filter">
            <span className="finder-filter-title">직장 직통권</span>
            <div className="finder-select-pair">
              <label>
                <span>직장 1</span>
                <select
                  aria-label="직장 1 선택"
                  value={selectedWorkplace1}
                  onChange={(event) => {
                    const workplaceId = event.target.value as WorkplaceId | "";
                    setSelectedWorkplace1(workplaceId);
                    if (
                      !supportsWorkplaceCommuteSort(workplaceId) &&
                      (sortMode === "workplace-asc" ||
                        sortMode === "workplace-desc")
                    ) {
                      setSortMode("price-desc");
                    }
                  }}
                >
                  <option value="">선택 안 함</option>
                  {WORKPLACES.map((workplace) => (
                    <option
                      key={workplace.id}
                      value={workplace.id}
                      disabled={selectedWorkplace2 === workplace.id}
                    >
                      {workplace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>직장 2</span>
                <select
                  aria-label="직장 2 선택"
                  value={selectedWorkplace2}
                  onChange={(event) =>
                    setSelectedWorkplace2(event.target.value as WorkplaceId | "")
                  }
                >
                  <option value="">선택 안 함</option>
                  {WORKPLACES.map((workplace) => (
                    <option
                      key={workplace.id}
                      value={workplace.id}
                      disabled={selectedWorkplace1 === workplace.id}
                    >
                      {workplace.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="finder-filter-note">
              여의도 접근순 = 직선거리 기반 도보 추정 + 직통 정거장당 2분 환산 · 대기·혼잡 제외 · 2곳은 모두 충족
            </small>
          </div>

          <div className="finder-filter-group finder-access-filter">
            <span className="finder-filter-title">인근 지하철역 선택</span>
            <small className="finder-filter-note">단지·역사 좌표 간 직선거리 · 역 미선택 시 가장 가까운 역, 선택 시 해당 역 기준(2곳은 하나 이상 충족). 반경 1.5km 내 역만 조회합니다. 좌표 확인 {TRANSIT_COVERAGE.geocodedComplexes.toLocaleString()}/{TRANSIT_COVERAGE.totalComplexes.toLocaleString()}개 · 미확인 단지는 역·거리·직장 필터에서 제외됩니다.</small>
            <div className="finder-select-pair">
              <label>
                <span>지하철 1</span>
                <select
                  aria-label="지하철 1 선택"
                  value={selectedSubway1}
                  onChange={(event) => setSelectedSubway1(event.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {STATION_OPTIONS.map((station) => (
                    <option
                      key={station.value}
                      value={station.value}
                      disabled={selectedSubway2 === station.value}
                    >
                      {station.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>지하철 2</span>
                <select
                  aria-label="지하철 2 선택"
                  value={selectedSubway2}
                  onChange={(event) => setSelectedSubway2(event.target.value)}
                >
                  <option value="">선택 안 함</option>
                  {STATION_OPTIONS.map((station) => (
                    <option
                      key={station.value}
                      value={station.value}
                      disabled={selectedSubway1 === station.value}
                    >
                      {station.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="finder-filter-note">
              선택한 두 역 중 한 곳이 인근역인 단지를 표시
            </small>
          </div>

          <div className="finder-month-control">
            <label htmlFor="deal-month">실거래 기준월</label>
            <input
              id="deal-month"
              type="month"
              value={month}
              min="2006-01"
              max={seoulMonth()}
              onChange={(event) => {
                if (!isSelectableMonth(event.target.value)) return;
                setMonth(event.target.value);
                void loadDashboard(event.target.value);
              }}
            />
          </div>
          <button
            className="finder-search-button"
            type="button"
            onClick={() => void loadDashboard(month)}
            disabled={loading}
          >
            {loading ? "불러오는 중…" : "저장 자료 다시 불러오기"}
            <span aria-hidden="true">→</span>
          </button>
          <p className="finder-filter-note">새로고침은 저장 자료만 다시 읽습니다. 공공데이터 수집은 별도의 관리자 작업으로 진행됩니다.</p>
        </aside>

        <section className="finder-results" id="finder-results">
          <header className="finder-results-heading">
            <div>
              <p className="finder-kicker">APARTMENT RESULTS</p>
              <h2><strong>{complexes.length.toLocaleString()}</strong>개 단지</h2>
            </div>
            <label className="finder-sort">
              <span>정렬</span>
              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(event.target.value as ApartmentSortMode)
                }
              >
                <option value="price-desc">높은 가격순</option>
                <option value="price-asc">낮은 가격순</option>
                <option value="latest">최근 거래순</option>
                <option value="distance-asc">가까운 거리순</option>
                <option value="distance-desc">먼 거리순</option>
                <option
                  value="workplace-asc"
                  disabled={!supportsWorkplaceCommuteSort(selectedWorkplace1)}
                >
                  {selectedWorkplace1
                    ? `${WORKPLACE_BY_ID[selectedWorkplace1].name} 접근 가까운 순`
                    : "직장 1 접근 가까운 순"}
                </option>
                <option
                  value="workplace-desc"
                  disabled={!supportsWorkplaceCommuteSort(selectedWorkplace1)}
                >
                  {selectedWorkplace1
                    ? `${WORKPLACE_BY_ID[selectedWorkplace1].name} 접근 먼 순`
                    : "직장 1 접근 먼 순"}
                </option>
              </select>
            </label>
          </header>

          <div className="finder-condition-bar">
            <span>조회 조건</span>
            <div>
              {activeConditions.map((condition) => (
                <em key={condition}>{condition}</em>
              ))}
            </div>
            <small>
              가격 확인 {summary.count.toLocaleString()}개 · {periodTradeLabel(selectedDistrict, refreshedDistricts, summary.periodTradeCount)}
            </small>
          </div>

          {masterLoadState === "loading" && !masterComplexes.length ? (
            <div className="finder-empty-state" role="status">
              <span aria-hidden="true">…</span>
              <h3>공식 단지 마스터를 불러오고 있습니다.</h3>
              <p>서울 25개 구의 단지 정보를 준비하는 중입니다.</p>
            </div>
          ) : masterLoadState === "error" && !masterComplexes.length ? (
            <div className="finder-empty-state" role="alert">
              <span aria-hidden="true">!</span>
              <h3>단지 마스터를 불러오지 못했습니다.</h3>
              <p>연결 상태를 확인한 뒤 단지·실거래 갱신을 다시 눌러주세요.</p>
            </div>
          ) : complexes.length ? (
            <div className="finder-result-groups">
              <section
                className="finder-result-list"
                aria-label="아파트 조회 결과"
              >
                <div className="finder-complex-list">
                  {complexes
                    .slice(0, visibleResultLimit)
                    .map((complex) => {
                      const { record, periodTrades } = complex;
                      const latestSale = record.latestSale;
                      const latestSaleArea = record.areaSales?.find((sale) =>
                        sale.date === latestSale?.date && sale.price === latestSale?.price &&
                        record.areas.includes(sale.area))?.area;
                      const periodPrices = periodTrades.map((trade) => trade.price);
                      const minPrice = periodPrices.length
                        ? Math.min(...periodPrices)
                        : null;
                      const maxPrice = periodPrices.length
                        ? Math.max(...periodPrices)
                        : null;
                      return (
                        <button
                          type="button"
                          className={`finder-complex-card${latestSale ? "" : " no-trade"}`}
                          key={complex.key}
                          onClick={() => setSelectedComplex(record)}
                          aria-label={`${record.name} 단지 상세 보기`}
                        >
                          <div className="finder-card-main">
                            <div className="finder-card-location">
                              <span>{record.district} {record.dong}</span>
                              <small>
                                {latestSale
                                  ? `${formatDate(latestSale.date)} 최근 매매`
                                  : "매매가 미확인"}
                              </small>
                            </div>
                            <h4>{record.name}</h4>
                            <div className="finder-card-tags">
                              <span>{formatBuildingInfo(record.buildYear)}</span>
                              {record.households ? (
                                <span>{record.households.toLocaleString()}세대</span>
                              ) : (
                                <span>세대수 확인 중</span>
                              )}
                              <span>{refreshedDistricts.includes(record.district) ? `선택월 거래 ${periodTrades.length}건` : "선택월 거래 미수집"}</span>
                            </div>
                            <div className="finder-station-line">
                              <span className="finder-station-icon" aria-hidden="true">M</span>
                              {complex.station ? (
                                <>
                                  <strong>{complex.station.name}역</strong>
                                  <span>{complex.station.lines}</span>
                                  <small>직선 {Math.round(complex.station.distanceMeters)}m</small>
                                </>
                              ) : (
                                <span>좌표 미확인 또는 1.5km 내 역 없음</span>
                              )}
                            </div>
                            {(selectedWorkplace1 || selectedWorkplace2) && (
                              <div className="finder-direct-access">
                                {[selectedWorkplace1, selectedWorkplace2]
                                  .filter((value): value is WorkplaceId => Boolean(value))
                                  .map((workplaceId) => {
                                    const commute =
                                      workplaceId === selectedWorkplace1
                                        ? complex.workplaceCommute
                                        : getWorkplaceCommuteEstimate(
                                            record.id,
                                            workplaceId,
                                          );
                                    if (commute) {
                                      return (
                                        <span key={workplaceId}>
                                          {commute.workplaceName} · {commute.station.name}역 {commute.line} 직통 ·{" "}
                                          약 {commute.estimatedMinutes}분
                                          {commute.stopCount === 0
                                            ? " · 목적역 생활권"
                                            : ` · ${commute.stopCount}정거장`}
                                        </span>
                                      );
                                    }
                                    const match = getDirectWorkplaceMatch(
                                      record.id,
                                            workplaceId,
                                    );
                                    return match ? (
                                      <span key={workplaceId}>
                                        {match.workplace.name} · {match.sharedLines.join("·")} 직통
                                      </span>
                                    ) : null;
                                  })}
                              </div>
                            )}
                          </div>
                          <div className={`finder-card-price${latestSale ? "" : " no-trade"}`}>
                            <span>최근 매매</span>
                            <strong>
                              {latestSale ? formatPrice(latestSale.price) : "가격 미확인"}
                            </strong>
                            {latestSaleArea ? (
                              <small>
                                {latestSaleArea.toFixed(1)}㎡ ·{" "}
                                {formatPyeong(latestSaleArea)}
                              </small>
                            ) : record.areas.length ? (
                              <small>전용면적 {record.areas.length}종 등록</small>
                            ) : (
                              <small>단지 마스터 등록</small>
                            )}
                            {minPrice !== null &&
                              maxPrice !== null &&
                              minPrice !== maxPrice && (
                              <em>
                                {formatPrice(minPrice)}~{formatPrice(maxPrice)}
                              </em>
                            )}
                            <i aria-hidden="true">→</i>
                          </div>
                        </button>
                      );
                    })}
                </div>
                {complexes.length > visibleResultLimit && (
                  <button
                    type="button"
                    className="finder-group-more"
                    onClick={() => setVisibleResultLimit((current) => current + 60)}
                  >
                    단지 더 보기 ·{" "}
                    {Math.min(60, complexes.length - visibleResultLimit)}개
                  </button>
                )}
              </section>
            </div>
          ) : (
            <div className="finder-empty-state">
              <span aria-hidden="true">⌕</span>
              <h3>조건에 맞는 단지가 없습니다.</h3>
              <p>지역이나 가격·면적 범위를 넓혀 다시 확인해보세요.</p>
              <button type="button" onClick={resetFilters}>전체 조건으로 보기</button>
            </div>
          )}
        </section>

        <aside className="finder-insight-panel" id="market-snapshot">
          <div className="finder-panel-heading compact">
            <div>
              <span>02</span>
              <h2>시장 스냅샷</h2>
            </div>
          </div>

          <div className="finder-key-metrics">
            <article>
              <span>중위가</span>
              <strong>{summary.count ? formatPrice(summary.median) : "-"}</strong>
            </article>
            <article>
              <span>평균가</span>
              <strong>{summary.count ? formatPrice(summary.average) : "-"}</strong>
            </article>
          </div>

          <section className="finder-distribution">
            <header>
              <h3>가격대별 단지 분포</h3>
              <span>COMPLEX MIX</span>
            </header>
            <div>
              {distribution.map((band) => (
                <article key={band.id}>
                  <span>{band.label}</span>
                  <i><b style={{ width: `${band.ratio}%`, background: band.accent }} /></i>
                  <strong>{band.count}</strong>
                </article>
              ))}
            </div>
          </section>

          <section className="finder-selection-guide">
            <span className="finder-guide-icon" aria-hidden="true">↗</span>
            <p className="finder-kicker">COMPLEX DETAIL</p>
            <h3>단지를 선택해<br />가격 흐름을 확인하세요.</h3>
            <p>
              결과 카드를 누르면 면적별 매매·전세 차트와 최근 실거래, 위치 지도,
              교통·학교 정보를 상세 패널에서 볼 수 있습니다.
            </p>
          </section>

          <button
            className="finder-excel-button"
            type="button"
            onClick={() => void downloadExcel()}
            disabled={!complexes.length}
          >
            <span>↓</span>
            조회 결과 엑셀 다운로드
          </button>

          <section className={`finder-source ${mode}`} id="data-guide">
            <div>
              <span aria-hidden="true" />
              <strong>{masterLoadState === "ready" ? "단지 마스터 연결됨" : "단지 마스터 미연결"}</strong>
            </div>
            <p>{statusMessage}</p>
            <small>
              {updatedAt ? new Date(updatedAt).toLocaleString("ko-KR", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Seoul",
              }) : "수집 시각 미확인"} · 선택월 자료 중 최근 수집 시각
            </small>
          </section>
        </aside>
      </div>

      <footer className="finder-footer">
        <p><strong>내집어디</strong></p>
        <p>K-apt와 한국부동산원 공시대상 아파트를 중복 정리한 공식 마스터 기준입니다. 전수 건축물대장은 아니며 실거래 신고는 취소·정정될 수 있습니다.</p>
      </footer>

      {selectedComplex && (
        <Suspense fallback={<div className="finder-detail-loading" role="status">단지 상세 정보를 준비하고 있습니다.<button type="button" onClick={() => setSelectedComplex(null)}>닫기</button></div>}>
        <ComplexDetailPanel
          key={selectedComplex.id}
          complex={toComplexDetailSeed(selectedComplex)}
          endMonth={month}
          workplaceIds={[selectedWorkplace1, selectedWorkplace2].filter(
            (value): value is WorkplaceId => Boolean(value),
          )}
          onClose={() => setSelectedComplex(null)}
        />
        </Suspense>
      )}
    </main>
  );
}
