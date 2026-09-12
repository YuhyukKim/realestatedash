import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * One durable row per Seoul apartment complex, regardless of whether the
 * complex has a transaction in the currently selected month.
 */
export const apartmentComplexes = sqliteTable(
  "apartment_complexes",
  {
    id: text("id").primaryKey(),
    aptSeq: text("apt_seq"),
    kaptCode: text("kapt_code"),
    seoulComplexId: text("seoul_complex_id"),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    district: text("district").notNull(),
    dong: text("dong").notNull().default(""),
    roadAddress: text("road_address"),
    jibunAddress: text("jibun_address"),
    buildYear: integer("build_year"),
    approvalDate: text("approval_date"),
    households: integer("households"),
    buildings: integer("buildings"),
    parking: integer("parking"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    areaMin: real("area_min"),
    areaMax: real("area_max"),
    source: text("source").notNull().default("seoul-open-data"),
    sourceUpdatedAt: text("source_updated_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("uidx_apartment_complexes_apt_seq").on(table.aptSeq),
    uniqueIndex("uidx_apartment_complexes_kapt_code").on(table.kaptCode),
    index("idx_apartment_complexes_district_dong_name").on(
      table.district,
      table.dong,
      table.name,
    ),
    index("idx_apartment_complexes_build_year").on(table.buildYear),
    index("idx_apartment_complexes_normalized_name").on(table.normalizedName),
  ],
);

export const apartmentComplexSeedMemberships = sqliteTable(
  "apartment_complex_seed_memberships",
  {
    complexId: text("complex_id")
      .notNull()
      .references(() => apartmentComplexes.id, { onDelete: "cascade" }),
    seedVersion: text("seed_version").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.complexId, table.seedVersion] }),
    index("idx_apartment_complex_seed_memberships_version").on(
      table.seedVersion,
      table.complexId,
    ),
  ],
);

export const complexAreas = sqliteTable(
  "complex_areas",
  {
    complexId: text("complex_id")
      .notNull()
      .references(() => apartmentComplexes.id, { onDelete: "cascade" }),
    area: real("area").notNull(),
  },
  (table) => [
    uniqueIndex("uidx_complex_areas_complex_area").on(
      table.complexId,
      table.area,
    ),
    index("idx_complex_areas_area").on(table.area),
  ],
);

/** Precomputed list-card values; null prices explicitly mean no recent trade. */
export const complexPriceSummaries = sqliteTable(
  "complex_price_summaries",
  {
    complexId: text("complex_id")
      .primaryKey()
      .references(() => apartmentComplexes.id, { onDelete: "cascade" }),
    latestSalePriceManwon: integer("latest_sale_price_manwon"),
    latestSaleDate: text("latest_sale_date"),
    latestSaleArea: real("latest_sale_area"),
    latestJeonsePriceManwon: integer("latest_jeonse_price_manwon"),
    latestJeonseDate: text("latest_jeonse_date"),
    latestJeonseArea: real("latest_jeonse_area"),
    latestMonthlyDepositManwon: integer("latest_monthly_deposit_manwon"),
    latestMonthlyRentManwon: integer("latest_monthly_rent_manwon"),
    latestMonthlyDate: text("latest_monthly_date"),
    latestMonthlyArea: real("latest_monthly_area"),
    saleCount: integer("sale_count").notNull().default(0),
    rentCount: integer("rent_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_complex_price_summaries_sale_price").on(
      table.latestSalePriceManwon,
    ),
    index("idx_complex_price_summaries_sale_date").on(table.latestSaleDate),
  ],
);

export const apartmentTransactions = sqliteTable(
  "apartment_transactions",
  {
    id: text("id").primaryKey(),
    complexId: text("complex_id")
      .notNull()
      .references(() => apartmentComplexes.id, { onDelete: "cascade" }),
    type: text("transaction_type", {
      enum: ["sale", "jeonse", "monthly"],
    }).notNull(),
    contractDate: text("contract_date").notNull(),
    priceManwon: integer("price_manwon").notNull(),
    monthlyRentManwon: integer("monthly_rent_manwon").notNull().default(0),
    area: real("area").notNull(),
    floor: integer("floor"),
    source: text("source").notNull().default("molit"),
    ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_apartment_transactions_complex_type_date").on(
      table.complexId,
      table.type,
      table.contractDate,
    ),
    index("idx_apartment_transactions_contract_date").on(table.contractDate),
  ],
);

export const dataSyncRuns = sqliteTable(
  "data_sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] })
      .notNull()
      .default("running"),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    finishedAt: text("finished_at"),
    recordCount: integer("record_count").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (table) => [index("idx_data_sync_runs_source_started").on(table.source, table.startedAt)],
);

export type ApartmentComplexRow = typeof apartmentComplexes.$inferSelect;

/** Replaceable complete district/month observations; cancellation refreshes remove stale prices. */
export const complexAreaMonthlySales = sqliteTable("complex_area_monthly_sales", {
  complexId: text("complex_id").notNull().references(() => apartmentComplexes.id, { onDelete: "cascade" }),
  district: text("district").notNull(),
  month: text("month").notNull(),
  area: real("area").notNull(),
  priceManwon: integer("price_manwon").notNull(),
  contractDate: text("contract_date").notNull(),
}, (table) => [
  primaryKey({ columns: [table.complexId, table.area, table.month] }),
  index("idx_area_sales_district_month").on(table.district, table.month),
  index("idx_area_sales_month").on(table.month),
]);
export type NewApartmentComplexRow = typeof apartmentComplexes.$inferInsert;


/** Staged imports never replace the public head until a complete feed is verified. */
export const tradeImportRuns = sqliteTable("trade_import_runs", {
  id: text("id").primaryKey(),
  district: text("district").notNull(), month: text("month").notNull(),
  kind: text("kind", { enum: ["sale", "rent"] }).notNull(),
  expectedCount: integer("expected_count").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  createdAt: text("created_at").notNull(),
  committed: integer("committed").notNull().default(0),
  abandoned: integer("abandoned").notNull().default(0),
  mappingVersion: text("mapping_version").notNull(),
}, (t) => [index("idx_trade_import_scope").on(t.district, t.month, t.kind)]);

export const tradeImportRows = sqliteTable("trade_import_rows", {
  runId: text("run_id").notNull().references(() => tradeImportRuns.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  // Not a master FK: preserve unmatched observations and imports while master loading is incomplete.
  complexId: text("complex_id"),
  type: text("type").notNull(), date: text("date").notNull(),
  priceManwon: integer("price_manwon").notNull(),
  monthlyRent: integer("monthly_rent").notNull(),
  area: real("area").notNull(), floor: integer("floor"),
  payload: text("payload").notNull(), batchHash: text("batch_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.runId, t.ordinal] }),
  index("idx_trade_import_complex").on(t.runId, t.complexId, t.date)]);

export const tradeSnapshotHeads = sqliteTable("trade_snapshot_heads", {
  district: text("district").notNull(), month: text("month").notNull(), kind: text("kind").notNull(),
  runId: text("run_id").notNull().references(() => tradeImportRuns.id),
  fetchedAt: text("fetched_at").notNull(), recordCount: integer("record_count").notNull(),
}, (t) => [primaryKey({ columns: [t.district, t.month, t.kind] }),
  index("idx_trade_heads_month_kind").on(t.month, t.kind)]);

export const tradeImportPrices = sqliteTable("trade_import_prices", {
  runId: text("run_id").notNull().references(() => tradeImportRuns.id, { onDelete: "cascade" }),
  complexId: text("complex_id").notNull(), area: real("area").notNull(),
  priceManwon: integer("price_manwon").notNull(), date: text("date").notNull(),
}, (t) => [primaryKey({ columns: [t.runId, t.complexId, t.area] })]);
