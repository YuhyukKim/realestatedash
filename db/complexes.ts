export type ComplexSeedRecord = {
  id: string;
  aptSeq?: string | null;
  kaptCode?: string | null;
  seoulComplexId?: string | null;
  apartment?: string;
  name?: string;
  district: string;
  dong?: string | null;
  roadAddress?: string | null;
  jibunAddress?: string | null;
  address?: string | null;
  buildYear?: number | null;
  approvalDate?: string | null;
  households?: number | null;
  buildings?: number | null;
  buildingCount?: number | null;
  parking?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  areaMin?: number | null;
  areaMax?: number | null;
  areas?: number[] | null;
  source?: string | null;
  complexType?: string | null;
  sourceUpdatedAt?: string | null;
  latestSalePrice?: number | null;
  latestSalePriceManwon?: number | null;
  latestSaleDate?: string | null;
  latestSaleArea?: number | null;
  latestSale?: { price: number; date: string } | null;
  latestJeonsePrice?: number | null;
  latestJeonsePriceManwon?: number | null;
  latestJeonseDate?: string | null;
  latestJeonseArea?: number | null;
  latestJeonse?: { price: number; date: string } | null;
  latestMonthlyDeposit?: number | null;
  latestMonthlyDepositManwon?: number | null;
  latestMonthlyRent?: number | null;
  latestMonthlyRentManwon?: number | null;
  latestMonthlyDate?: string | null;
  latestMonthlyArea?: number | null;
  saleCount?: number | null;
  rentCount?: number | null;
};

export type ComplexListItem = {
  id: string;
  name: string;
  district: string;
  dong: string;
  address: string;
  jibunAddress: string | null;
  buildYear: number | null;
  households: number | null;
  buildingCount: number | null;
  parking: number | null;
  latestSale: { price: number; date: string } | null;
  latestJeonse: { price: number; date: string } | null;
  areas: number[];
  source: string;
};

export type ComplexListFilters = {
  district?: string;
  dong?: string;
  query?: string;
  buildYearMin?: number;
  buildYearMax?: number;
  hasTransactions?: boolean;
  limit: number;
  offset: number;
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS apartment_complexes (
    id text PRIMARY KEY NOT NULL,
    apt_seq text,
    kapt_code text,
    seoul_complex_id text,
    name text NOT NULL,
    normalized_name text NOT NULL,
    district text NOT NULL,
    dong text DEFAULT '' NOT NULL,
    road_address text,
    jibun_address text,
    build_year integer,
    approval_date text,
    households integer,
    buildings integer,
    parking integer,
    latitude real,
    longitude real,
    area_min real,
    area_max real,
    source text DEFAULT 'seoul-open-data' NOT NULL,
    source_updated_at text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uidx_apartment_complexes_apt_seq ON apartment_complexes (apt_seq)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uidx_apartment_complexes_kapt_code ON apartment_complexes (kapt_code)`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_complexes_district_dong_name ON apartment_complexes (district, dong, name)`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_complexes_build_year ON apartment_complexes (build_year)`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_complexes_normalized_name ON apartment_complexes (normalized_name)`,
  `CREATE TABLE IF NOT EXISTS apartment_complex_seed_memberships (
    complex_id text NOT NULL,
    seed_version text NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (complex_id, seed_version),
    FOREIGN KEY (complex_id) REFERENCES apartment_complexes(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_complex_seed_memberships_version ON apartment_complex_seed_memberships (seed_version, complex_id)`,
  `CREATE TABLE IF NOT EXISTS complex_areas (
    complex_id text NOT NULL,
    area real NOT NULL,
    FOREIGN KEY (complex_id) REFERENCES apartment_complexes(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uidx_complex_areas_complex_area ON complex_areas (complex_id, area)`,
  `CREATE INDEX IF NOT EXISTS idx_complex_areas_area ON complex_areas (area)`,
  `CREATE TABLE IF NOT EXISTS complex_price_summaries (
    complex_id text PRIMARY KEY NOT NULL,
    latest_sale_price_manwon integer,
    latest_sale_date text,
    latest_sale_area real,
    latest_jeonse_price_manwon integer,
    latest_jeonse_date text,
    latest_jeonse_area real,
    latest_monthly_deposit_manwon integer,
    latest_monthly_rent_manwon integer,
    latest_monthly_date text,
    latest_monthly_area real,
    sale_count integer DEFAULT 0 NOT NULL,
    rent_count integer DEFAULT 0 NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (complex_id) REFERENCES apartment_complexes(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE INDEX IF NOT EXISTS idx_complex_price_summaries_sale_price ON complex_price_summaries (latest_sale_price_manwon)`,
  `CREATE INDEX IF NOT EXISTS idx_complex_price_summaries_sale_date ON complex_price_summaries (latest_sale_date)`,
  `CREATE TABLE IF NOT EXISTS apartment_transactions (
    id text PRIMARY KEY NOT NULL,
    complex_id text NOT NULL,
    transaction_type text NOT NULL,
    contract_date text NOT NULL,
    price_manwon integer NOT NULL,
    monthly_rent_manwon integer DEFAULT 0 NOT NULL,
    area real NOT NULL,
    floor integer,
    source text DEFAULT 'molit' NOT NULL,
    ingested_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (complex_id) REFERENCES apartment_complexes(id) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_transactions_complex_type_date ON apartment_transactions (complex_id, transaction_type, contract_date)`,
  `CREATE INDEX IF NOT EXISTS idx_apartment_transactions_contract_date ON apartment_transactions (contract_date)`,
  `CREATE TABLE IF NOT EXISTS data_sync_runs (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    source text NOT NULL,
    status text DEFAULT 'running' NOT NULL,
    started_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at text,
    record_count integer DEFAULT 0 NOT NULL,
    error_message text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_data_sync_runs_source_started ON data_sync_runs (source, started_at)`,
] as const;

let schemaReady: Promise<void> | null = null;

export function normalizeComplexName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function wonEokToManwon(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10_000);
}

export function manwonToEok(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Number((value / 10_000).toFixed(4));
}

export async function ensureComplexSchema(d1: D1Database) {
  schemaReady ??= (async () => {
    await d1.batch(SCHEMA_STATEMENTS.map((statement) => d1.prepare(statement)));
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function optionalNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value;
}

function manwonValue(
  manwon: number | null | undefined,
  eok: number | null | undefined,
) {
  return optionalNumber(manwon) ?? wonEokToManwon(eok);
}

function getSeedName(record: ComplexSeedRecord) {
  return (record.name ?? record.apartment ?? "").trim();
}

function getSeedAreas(record: ComplexSeedRecord) {
  return Array.from(
    new Set(
      [
        ...(record.areas ?? []),
        record.areaMin ?? null,
        record.areaMax ?? null,
      ].filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    ),
  ).sort((left, right) => left - right);
}

export async function seedComplexesIfEmpty(
  d1: D1Database,
  records: readonly ComplexSeedRecord[],
  seedVersion: string,
  maxComplexesPerRun = 25,
) {
  const validRecords = records.filter(
    (record) =>
      Boolean(record.id?.trim()) &&
      Boolean(getSeedName(record)) &&
      Boolean(record.district?.trim()),
  );
  if (!validRecords.length) {
    return {
      complete: true,
      exact: true,
      inserted: 0,
      seeded: 0,
      stored: 0,
      stale: 0,
      total: 0,
      remaining: 0,
    };
  }

  const validIds = new Set(validRecords.map((record) => record.id));
  const existingRows = await d1
    .prepare(
      "SELECT complex_id FROM apartment_complex_seed_memberships WHERE seed_version = ?",
    )
    .bind(seedVersion)
    .all<{ complex_id: string }>();
  const existingIds = new Set(
    existingRows.results.map((row) => row.complex_id),
  );
  const seededBefore = validRecords.reduce(
    (count, record) => count + Number(existingIds.has(record.id)),
    0,
  );
  const missing = validRecords.filter((record) => !existingIds.has(record.id));
  if (!missing.length) {
    const stale = [...existingIds].filter((id) => !validIds.has(id)).length;
    return {
      complete: true,
      exact: stale === 0,
      inserted: 0,
      seeded: validRecords.length,
      stored: existingIds.size,
      stale,
      total: validRecords.length,
      remaining: 0,
    };
  }

  const runLimit = Math.min(200, Math.max(1, maxComplexesPerRun));
  const chunk = missing.slice(0, runLimit);

  const now = new Date().toISOString();
  const statementGroups: D1PreparedStatement[][] = [];

  for (const record of chunk) {
    const name = getSeedName(record);
    const statements: D1PreparedStatement[] = [];

    statements.push(
      d1
        .prepare(
          `INSERT INTO apartment_complexes (
            id, apt_seq, kapt_code, seoul_complex_id, name, normalized_name,
            district, dong, road_address, jibun_address, build_year,
            approval_date, households, buildings, parking, latitude, longitude,
            area_min, area_max, source, source_updated_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            apt_seq = excluded.apt_seq,
            kapt_code = excluded.kapt_code,
            seoul_complex_id = excluded.seoul_complex_id,
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            district = excluded.district,
            dong = excluded.dong,
            road_address = excluded.road_address,
            jibun_address = excluded.jibun_address,
            build_year = excluded.build_year,
            approval_date = excluded.approval_date,
            households = excluded.households,
            buildings = excluded.buildings,
            parking = excluded.parking,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            area_min = excluded.area_min,
            area_max = excluded.area_max,
            source = excluded.source,
            source_updated_at = excluded.source_updated_at,
            updated_at = excluded.updated_at`,
        )
        .bind(
          record.id,
          cleanText(record.aptSeq),
          cleanText(record.kaptCode),
          cleanText(record.seoulComplexId),
          name,
          normalizeComplexName(name),
          record.district.trim(),
          record.dong?.trim() ?? "",
          cleanText(record.roadAddress) ?? cleanText(record.address),
          cleanText(record.jibunAddress) ?? cleanText(record.address),
          optionalNumber(record.buildYear),
          cleanText(record.approvalDate),
          optionalNumber(record.households),
          optionalNumber(record.buildings ?? record.buildingCount),
          optionalNumber(record.parking),
          optionalNumber(record.latitude),
          optionalNumber(record.longitude),
          optionalNumber(record.areaMin),
          optionalNumber(record.areaMax),
          cleanText(record.source) ?? "generated-seed",
          cleanText(record.sourceUpdatedAt),
          now,
        ),
    );
    statements.push(
      d1
        .prepare(
          `INSERT INTO apartment_complex_seed_memberships (
            complex_id, seed_version, updated_at
          ) VALUES (?, ?, ?)
          ON CONFLICT(complex_id, seed_version) DO UPDATE SET
            updated_at = excluded.updated_at`,
        )
        .bind(record.id, seedVersion, now),
    );

    for (const area of getSeedAreas(record)) {
      statements.push(
        d1
          .prepare(
            "INSERT OR IGNORE INTO complex_areas (complex_id, area) VALUES (?, ?)",
          )
          .bind(record.id, area),
      );
    }

    const latestSalePrice = manwonValue(
      record.latestSalePriceManwon,
      record.latestSalePrice ?? record.latestSale?.price,
    );
    const latestJeonsePrice = manwonValue(
      record.latestJeonsePriceManwon,
      record.latestJeonsePrice ?? record.latestJeonse?.price,
    );
    const latestMonthlyDeposit = manwonValue(
      record.latestMonthlyDepositManwon,
      record.latestMonthlyDeposit,
    );
    const latestMonthlyRent = manwonValue(
      record.latestMonthlyRentManwon,
      record.latestMonthlyRent,
    );
    const saleCount = Math.max(0, Math.trunc(record.saleCount ?? 0));
    const rentCount = Math.max(0, Math.trunc(record.rentCount ?? 0));
    const hasPriceSummary =
      latestSalePrice !== null ||
      latestJeonsePrice !== null ||
      latestMonthlyDeposit !== null ||
      latestMonthlyRent !== null ||
      saleCount > 0 ||
      rentCount > 0;

    if (hasPriceSummary) {
      statements.push(
        d1
          .prepare(
            `INSERT OR IGNORE INTO complex_price_summaries (
              complex_id, latest_sale_price_manwon, latest_sale_date,
              latest_sale_area, latest_jeonse_price_manwon, latest_jeonse_date,
              latest_jeonse_area, latest_monthly_deposit_manwon,
              latest_monthly_rent_manwon, latest_monthly_date,
              latest_monthly_area, sale_count, rent_count, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            record.id,
            latestSalePrice,
            cleanText(record.latestSaleDate ?? record.latestSale?.date),
            optionalNumber(record.latestSaleArea),
            latestJeonsePrice,
            cleanText(record.latestJeonseDate ?? record.latestJeonse?.date),
            optionalNumber(record.latestJeonseArea),
            latestMonthlyDeposit,
            latestMonthlyRent,
            cleanText(record.latestMonthlyDate),
            optionalNumber(record.latestMonthlyArea),
            saleCount,
            rentCount,
            now,
          ),
      );
    }

    statementGroups.push(statements);
  }

  // Keep every complex and its child rows in the same D1 batch. The bounded
  // chunk makes repeated normal API requests a safe, resumable backfill.
  for (let index = 0; index < statementGroups.length; index += 20) {
    await d1.batch(statementGroups.slice(index, index + 20).flat());
  }

  const refreshedRows = await d1
    .prepare(
      "SELECT complex_id FROM apartment_complex_seed_memberships WHERE seed_version = ?",
    )
    .bind(seedVersion)
    .all<{ complex_id: string }>();
  const refreshedIds = new Set(
    refreshedRows.results.map((row) => row.complex_id),
  );
  const seeded = validRecords.reduce(
    (count, record) => count + Number(refreshedIds.has(record.id)),
    0,
  );
  const remaining = validRecords.length - seeded;
  const staleIds = [...refreshedIds].filter((id) => !validIds.has(id));
  if (remaining === 0) await d1.prepare("PRAGMA optimize").run();
  const stale = staleIds.length;
  return {
    complete: remaining === 0,
    exact: remaining === 0 && stale === 0,
    inserted: Math.max(0, seeded - seededBefore),
    seeded,
    stored: refreshedIds.size,
    stale,
    total: validRecords.length,
    remaining,
  };
}

type D1ComplexRow = {
  id: string;
  apt_seq: string | null;
  kapt_code: string | null;
  seoul_complex_id: string | null;
  name: string;
  district: string;
  dong: string;
  road_address: string | null;
  jibun_address: string | null;
  build_year: number | null;
  approval_date: string | null;
  households: number | null;
  buildings: number | null;
  parking: number | null;
  latitude: number | null;
  longitude: number | null;
  area_min: number | null;
  area_max: number | null;
  source: string;
  source_updated_at: string | null;
  updated_at: string;
  latest_sale_price_manwon: number | null;
  latest_sale_date: string | null;
  latest_sale_area: number | null;
  latest_jeonse_price_manwon: number | null;
  latest_jeonse_date: string | null;
  latest_jeonse_area: number | null;
  latest_monthly_deposit_manwon: number | null;
  latest_monthly_rent_manwon: number | null;
  latest_monthly_date: string | null;
  latest_monthly_area: number | null;
  sale_count: number | null;
  rent_count: number | null;
  areas_csv: string | null;
};

function rowToComplex(row: D1ComplexRow): ComplexListItem {
  const latestSalePrice = manwonToEok(row.latest_sale_price_manwon);
  const latestJeonsePrice = manwonToEok(row.latest_jeonse_price_manwon);
  return {
    id: row.id,
    name: row.name,
    district: row.district,
    dong: row.dong,
    address:
      row.road_address ??
      row.jibun_address ??
      `서울특별시 ${row.district} ${row.dong}`.trim(),
    jibunAddress: row.jibun_address,
    buildYear: row.build_year,
    households: row.households,
    buildingCount: row.buildings,
    parking: row.parking,
    latestSale:
      latestSalePrice !== null && row.latest_sale_date
        ? { price: latestSalePrice, date: row.latest_sale_date }
        : null,
    latestJeonse:
      latestJeonsePrice !== null && row.latest_jeonse_date
        ? { price: latestJeonsePrice, date: row.latest_jeonse_date }
        : null,
    areas: (row.areas_csv ?? "")
      .split("|")
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0),
    source: row.source,
  };
}

function buildWhere(filters: ComplexListFilters) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.district) {
    clauses.push("c.district = ?");
    values.push(filters.district);
  }
  if (filters.dong) {
    clauses.push("c.dong = ?");
    values.push(filters.dong);
  }
  if (filters.query) {
    clauses.push(
      "(c.normalized_name LIKE ? ESCAPE '\\' OR c.road_address LIKE ? ESCAPE '\\' OR c.jibun_address LIKE ? ESCAPE '\\')",
    );
    const escaped = filters.query
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
    const query = `%${escaped}%`;
    values.push(query, query, query);
  }
  if (filters.buildYearMin !== undefined) {
    clauses.push("c.build_year >= ?");
    values.push(filters.buildYearMin);
  }
  if (filters.buildYearMax !== undefined) {
    clauses.push("c.build_year <= ?");
    values.push(filters.buildYearMax);
  }
  if (filters.hasTransactions === true) {
    clauses.push(
      "(COALESCE(p.sale_count, 0) + COALESCE(p.rent_count, 0) > 0 OR p.latest_sale_price_manwon IS NOT NULL OR p.latest_jeonse_price_manwon IS NOT NULL OR p.latest_monthly_rent_manwon IS NOT NULL)",
    );
  } else if (filters.hasTransactions === false) {
    clauses.push(
      "COALESCE(p.sale_count, 0) + COALESCE(p.rent_count, 0) = 0 AND p.latest_sale_price_manwon IS NULL AND p.latest_jeonse_price_manwon IS NULL AND p.latest_monthly_rent_manwon IS NULL",
    );
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

const COMPLEX_SELECT = `SELECT
  c.id, c.apt_seq, c.kapt_code, c.seoul_complex_id, c.name, c.district,
  c.dong, c.road_address, c.jibun_address, c.build_year, c.approval_date,
  c.households, c.buildings, c.parking, c.latitude, c.longitude, c.area_min, c.area_max,
  c.source, c.source_updated_at, c.updated_at,
  p.latest_sale_price_manwon, p.latest_sale_date, p.latest_sale_area,
  p.latest_jeonse_price_manwon, p.latest_jeonse_date, p.latest_jeonse_area,
  p.latest_monthly_deposit_manwon, p.latest_monthly_rent_manwon,
  p.latest_monthly_date, p.latest_monthly_area, p.sale_count, p.rent_count,
  (SELECT GROUP_CONCAT(a.area, '|') FROM complex_areas a WHERE a.complex_id = c.id) AS areas_csv
FROM apartment_complexes c
JOIN apartment_complex_seed_memberships m
  ON m.complex_id = c.id AND m.seed_version = ?
LEFT JOIN complex_price_summaries p ON p.complex_id = c.id`;

export async function listComplexesFromD1(
  d1: D1Database,
  filters: ComplexListFilters,
  seedVersion: string,
) {
  const where = buildWhere(filters);
  const count = await d1
    .prepare(
      `SELECT COUNT(*) AS count
       FROM apartment_complexes c
       JOIN apartment_complex_seed_memberships m
         ON m.complex_id = c.id AND m.seed_version = ?
       LEFT JOIN complex_price_summaries p ON p.complex_id = c.id${where.sql}`,
    )
    .bind(seedVersion, ...where.values)
    .first<{ count: number }>();

  const results = await d1
    .prepare(
      `${COMPLEX_SELECT}${where.sql} ORDER BY c.district, c.dong, c.name, c.id LIMIT ? OFFSET ?`,
    )
    .bind(seedVersion, ...where.values, filters.limit, filters.offset)
    .all<D1ComplexRow>();

  return {
    complexes: results.results.map(rowToComplex),
    total: Number(count?.count ?? 0),
  };
}

function recordToListItem(record: ComplexSeedRecord): ComplexListItem {
  const salePriceManwon = manwonValue(
    record.latestSalePriceManwon,
    record.latestSalePrice ?? record.latestSale?.price,
  );
  const jeonsePriceManwon = manwonValue(
    record.latestJeonsePriceManwon,
    record.latestJeonsePrice ?? record.latestJeonse?.price,
  );
  const name = getSeedName(record);
  return {
    id: record.id,
    name,
    district: record.district.trim(),
    dong: record.dong?.trim() ?? "",
    address:
      cleanText(record.address) ??
      cleanText(record.roadAddress) ??
      cleanText(record.jibunAddress) ??
      `서울특별시 ${record.district} ${record.dong ?? ""}`.trim(),
    jibunAddress: cleanText(record.jibunAddress),
    buildYear: optionalNumber(record.buildYear),
    households: optionalNumber(record.households),
    buildingCount: optionalNumber(record.buildingCount ?? record.buildings),
    parking: optionalNumber(record.parking),
    latestSale:
      salePriceManwon !== null &&
      cleanText(record.latestSaleDate ?? record.latestSale?.date)
        ? {
            price: manwonToEok(salePriceManwon)!,
            date: cleanText(record.latestSaleDate ?? record.latestSale?.date)!,
          }
        : null,
    latestJeonse:
      jeonsePriceManwon !== null &&
      cleanText(record.latestJeonseDate ?? record.latestJeonse?.date)
        ? {
            price: manwonToEok(jeonsePriceManwon)!,
            date: cleanText(
              record.latestJeonseDate ?? record.latestJeonse?.date,
            )!,
          }
        : null,
    areas: getSeedAreas(record),
    source: cleanText(record.source) ?? "generated-seed",
  };
}

export function listComplexesFromSeed(
  records: readonly ComplexSeedRecord[],
  filters: ComplexListFilters,
) {
  const normalizedQuery = filters.query
    ? normalizeComplexName(filters.query)
    : "";
  const filtered = records
    .map(recordToListItem)
    .filter((record) => !filters.district || record.district === filters.district)
    .filter((record) => !filters.dong || record.dong === filters.dong)
    .filter((record) => {
      if (!normalizedQuery) return true;
      return normalizeComplexName(`${record.name} ${record.address}`).includes(
        normalizedQuery,
      );
    })
    .filter(
      (record) =>
        filters.buildYearMin === undefined ||
        (record.buildYear !== null && record.buildYear >= filters.buildYearMin),
    )
    .filter(
      (record) =>
        filters.buildYearMax === undefined ||
        (record.buildYear !== null && record.buildYear <= filters.buildYearMax),
    )
    .filter(
      (record) =>
        filters.hasTransactions === undefined ||
        Boolean(record.latestSale || record.latestJeonse) ===
        filters.hasTransactions,
    )
    .sort(
      (left, right) =>
        left.district.localeCompare(right.district, "ko-KR") ||
        left.dong.localeCompare(right.dong, "ko-KR") ||
        left.name.localeCompare(right.name, "ko-KR") ||
        left.id.localeCompare(right.id),
    );

  return {
    complexes: filtered.slice(filters.offset, filters.offset + filters.limit),
    total: filtered.length,
  };
}
