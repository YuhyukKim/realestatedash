import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const SOURCE_URL =
  "https://www.k-apt.go.kr/web/board/goKaptBasicExcelDownload.do";
const SOURCE_PAGE =
  "https://www.k-apt.go.kr/web/board/webReference/boardList.do";
const DEFAULT_OUTPUT = "app/generated/seoul-apartments.json";
const DEFAULT_META_OUTPUT = "app/generated/seoul-apartments.meta.json";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

const FIELD_ALIASES = {
  city: ["시도", "시도명", "광역시도"],
  district: ["시군구", "시군구명"],
  dong: ["동리", "동리명", "읍면동", "읍면동명"],
  kaptCode: ["단지코드", "kaptcode", "aptcode"],
  name: ["단지명", "단지명칭", "공동주택명"],
  complexType: ["단지분류", "단지구분", "주택유형"],
  jibun: ["법정동주소", "지번주소"],
  roadAddress: ["도로명주소", "새주소"],
  saleType: ["분양형태", "분양구분"],
  approvalDate: ["사용승인일", "사용검사일", "준공일"],
  buildings: ["동수", "건물동수", "총동수"],
  households: ["세대수", "총세대수"],
  managementType: ["관리방식", "관리형태"],
  heatingType: ["난방방식", "난방형태"],
  corridorType: ["복도유형", "복도형태"],
  builder: ["시공사", "시공자"],
  developer: ["시행사", "사업시행자"],
  parkingTotal: ["총주차대수", "주차대수", "주차대수합계"],
  parkingGround: ["지상주차대수", "지상주차"],
  parkingUnderground: ["지하주차대수", "지하주차"],
  areaLe60: [
    "전용면적60㎡이하",
    "전용면적60이하",
    "60㎡이하세대수",
    "60이하세대수",
  ],
  area60To85: [
    "전용면적60㎡초과85㎡이하",
    "전용면적60초과85이하",
    "60㎡초과85㎡이하세대수",
    "60초과85이하세대수",
    "60~85㎡세대수",
  ],
  area85To135: [
    "전용면적85㎡초과135㎡이하",
    "전용면적85초과135이하",
    "85㎡초과135㎡이하세대수",
    "85초과135이하세대수",
    "85~135㎡세대수",
  ],
  areaGt135: [
    "전용면적135㎡초과",
    "전용면적135초과",
    "135㎡초과세대수",
    "135초과세대수",
  ],
};

const AREA_BUCKETS = [
  { field: "areaLe60", representativeArea: 59 },
  { field: "area60To85", representativeArea: 84 },
  { field: "area85To135", representativeArea: 114 },
  { field: "areaGt135", representativeArea: 150 },
];

function parseArguments(args) {
  const options = {
    input: null,
    output: DEFAULT_OUTPUT,
    metaOutput: DEFAULT_META_OUTPUT,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") options.input = args[++index];
    else if (argument === "--output") options.output = args[++index];
    else if (argument === "--meta-output") options.metaOutput = args[++index];
    else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node scripts/generate-kapt-seoul-seed.mjs " +
          "[--input kapt-basic.xlsx] [--output apartments.json] " +
          "[--meta-output apartments.meta.json]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_()\[\]{}·ㆍ.\-+/]/g, "");
}

function rowAccessor(row) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );

  return (field) => {
    for (const alias of FIELD_ALIASES[field]) {
      const key = normalizeHeader(alias);
      if (normalized.has(key)) return normalized.get(key);
    }
    return null;
  };
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (
    !text ||
    /^(?:-|없음|모름|미상|정보없음|확인불가|해당없음|해당 없음|n\/?a|null)$/i.test(
      text,
    )
  ) {
    return null;
  }
  return text;
}

function toInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  const numeric = Number(String(value).replace(/[,\s대동세]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function toPositiveInteger(value) {
  const numeric = toInteger(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function formatDateParts(year, month = 1, day = 1) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    year < 1800 ||
    year > 2200 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? formatDateParts(parsed.y, parsed.m, parsed.d) : null;
  }

  const text = cleanText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) {
    return formatDateParts(
      Number(digits.slice(0, 4)),
      Number(digits.slice(4, 6)),
      Number(digits.slice(6, 8)),
    );
  }

  const parts = text.match(/^(\d{4})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
  if (!parts) return null;
  return formatDateParts(
    Number(parts[1]),
    parts[2] ? Number(parts[2]) : 1,
    parts[3] ? Number(parts[3]) : 1,
  );
}

function inferDistrict(jibun, roadAddress) {
  const address = jibun ?? roadAddress ?? "";
  return cleanText(address.match(/서울(?:특별시)?\s+([^\s]+구)\b/)?.[1]);
}

function inferDong(jibun) {
  if (!jibun) return null;
  const addressParts = jibun.split(/\s+/).filter(Boolean);
  const districtIndex = addressParts.findIndex((part) => /구$/.test(part));
  const candidate = districtIndex >= 0 ? addressParts[districtIndex + 1] : null;
  return candidate && /(?:동|가|읍|면|리)$/.test(candidate) ? candidate : null;
}

function normalizeApartment(row, sourceUpdatedAt) {
  const get = rowAccessor(row);
  const kaptCode = cleanText(get("kaptCode"));
  const name = cleanText(get("name"));
  const jibun = cleanText(get("jibun"));
  const roadAddress = cleanText(get("roadAddress"));
  const approvalDate = normalizeDate(get("approvalDate"));
  const city = cleanText(get("city"));
  const district = cleanText(get("district")) ?? inferDistrict(jibun, roadAddress);
  const dong = cleanText(get("dong")) ?? inferDong(jibun);
  const areas = AREA_BUCKETS.filter(({ field }) => toInteger(get(field)) > 0).map(
    ({ representativeArea }) => representativeArea,
  );

  return {
    id: kaptCode,
    kaptCode,
    name,
    apartment: name,
    district,
    dong,
    roadAddress,
    jibunAddress: jibun,
    approvalDate,
    buildYear: approvalDate ? Number(approvalDate.slice(0, 4)) : null,
    households: toPositiveInteger(get("households")),
    buildings: toPositiveInteger(get("buildings")),
    parking: toInteger(get("parkingTotal")),
    parkingTotal: toInteger(get("parkingTotal")),
    parkingGround: toInteger(get("parkingGround")),
    parkingUnderground: toInteger(get("parkingUnderground")),
    builder: cleanText(get("builder")),
    developer: cleanText(get("developer")),
    complexType: cleanText(get("complexType")),
    saleType: cleanText(get("saleType")),
    managementType: cleanText(get("managementType")),
    heatingType: cleanText(get("heatingType")),
    corridorType: cleanText(get("corridorType")),
    ...(areas.length
      ? { areas, areaMin: areas[0], areaMax: areas[areas.length - 1] }
      : {}),
    source: "K-apt",
    sourceUpdatedAt,
    _city: city,
  };
}

function completeness(record) {
  return Object.entries(record).reduce(
    (score, [key, value]) => score + (key.startsWith("_") || value === null ? 0 : 1),
    0,
  );
}

function decodeFileName(header) {
  if (!header) return null;
  const extended = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended.replace(/^"|"$/g, ""));
    } catch {
      return extended.replace(/^"|"$/g, "");
    }
  }
  const regular = header.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
  if (!regular) return null;
  try {
    return decodeURIComponent(regular);
  } catch {
    return regular;
  }
}

function sourceDateFrom(fileName, lastModified, workbook) {
  const match = String(fileName ?? "").match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (match) return formatDateParts(Number(match[1]), Number(match[2]), Number(match[3]));

  const workbookDate = workbook.Props?.ModifiedDate ?? workbook.Props?.CreatedDate;
  if (workbookDate instanceof Date && !Number.isNaN(workbookDate.getTime())) {
    return formatDateParts(
      workbookDate.getUTCFullYear(),
      workbookDate.getUTCMonth() + 1,
      workbookDate.getUTCDate(),
    );
  }

  if (lastModified) {
    const date = new Date(lastModified);
    if (!Number.isNaN(date.getTime())) {
      return formatDateParts(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
      );
    }
  }
  return null;
}

async function downloadSource() {
  const pageResponse = await fetch(SOURCE_PAGE, {
    headers: { accept: "text/html", "user-agent": USER_AGENT },
  });
  if (!pageResponse.ok) {
    throw new Error(`K-apt source page returned HTTP ${pageResponse.status}`);
  }

  const pageHtml = await pageResponse.text();
  const csrfToken = pageHtml.match(
    /<meta\s+id=["']_csrf["'][^>]*content=["']([^"']+)/i,
  )?.[1];
  const setCookies =
    typeof pageResponse.headers.getSetCookie === "function"
      ? pageResponse.headers.getSetCookie()
      : [pageResponse.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");

  const entryResponse = await fetch(SOURCE_URL, {
    redirect: "manual",
    headers: {
      accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
        "application/octet-stream;q=0.9,*/*;q=0.8",
      cookie,
      referer: SOURCE_PAGE,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
      "user-agent": USER_AGENT,
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
  });
  if (entryResponse.status !== 302 && entryResponse.status !== 303) {
    throw new Error(
      `K-apt download entry returned HTTP ${entryResponse.status} instead of a current data-page redirect`,
    );
  }
  const location = entryResponse.headers.get("location");
  if (!location) throw new Error("K-apt download entry did not identify the current data page");

  const viewUrl = new URL(location, SOURCE_URL).toString();
  const viewResponse = await fetch(viewUrl, {
    headers: { cookie, referer: SOURCE_PAGE, "user-agent": USER_AGENT },
  });
  if (!viewResponse.ok) {
    throw new Error(`K-apt data page returned HTTP ${viewResponse.status}`);
  }
  const viewHtml = await viewResponse.text();
  const viewCsrfToken =
    viewHtml.match(/<meta\s+id=["']_csrf["'][^>]*content=["']([^"']+)/i)?.[1] ??
    csrfToken;
  const inputTags = [...viewHtml.matchAll(/<input\b[^>]*>/gi)].map(
    (match) => match[0],
  );
  const formData = {};
  for (const tag of inputTags) {
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name || !["boardType", "pageNo", "stype", "keyword", "seq", "scode", "boardPwd", "_csrf"].includes(name)) {
      continue;
    }
    formData[name] = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? "";
  }
  if (!formData.seq) throw new Error("K-apt current data page is missing its record id");

  const listUrl = new URL(
    "/web/board/webReference/fileListData.do?seq=BOARD_FILE",
    viewUrl,
  );
  const listResponse = await fetch(listUrl, {
    method: "POST",
    headers: {
      accept: "application/json, */*",
      "content-type": "application/json;charset=UTF-8",
      cookie,
      referer: viewUrl,
      "user-agent": USER_AGENT,
      ...(viewCsrfToken ? { "x-csrf-token": viewCsrfToken } : {}),
    },
    body: JSON.stringify(formData),
  });
  if (!listResponse.ok) {
    throw new Error(`K-apt attachment list returned HTTP ${listResponse.status}`);
  }
  const listPayload = await listResponse.json();
  const attachment = listPayload.data?.find((item) => /\.xlsx?$/i.test(item.fileName));
  if (!attachment?.seq || !attachment?.fileName) {
    throw new Error("K-apt current data page has no XLS/XLSX attachment");
  }

  const fileUrl = new URL("/cmm/file/BOARD/fileDownload.do", viewUrl);
  fileUrl.searchParams.set("key", attachment.seq);
  fileUrl.searchParams.set("fileName", attachment.fileName);
  const response = await fetch(fileUrl, {
    headers: {
      accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
        "application/octet-stream;q=0.9,*/*;q=0.8",
      cookie,
      referer: viewUrl,
      "user-agent": USER_AGENT,
      ...(viewCsrfToken ? { "x-csrf-token": viewCsrfToken } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`K-apt XLSX attachment returned HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    const responseText = buffer.toString("utf8", 0, Math.min(buffer.length, 500));
    throw new Error(
      `K-apt endpoint did not return an XLSX file: ${responseText.replace(/\s+/g, " ").trim()}`,
    );
  }

  return {
    buffer,
    fileName: decodeFileName(response.headers.get("content-disposition")) ?? attachment.fileName,
    lastModified: response.headers.get("last-modified"),
  };
}

function validateHeaders(headers) {
  const normalized = new Set(headers.map(normalizeHeader));
  const missing = ["city", "kaptCode", "name"].filter(
    (field) => !FIELD_ALIASES[field].some((alias) => normalized.has(normalizeHeader(alias))),
  );
  if (missing.length) {
    throw new Error(
      `Required K-apt columns not found: ${missing.join(", ")}. ` +
        `Available columns: ${headers.join(", ")}`,
    );
  }
}

function buildSeed(buffer, sourceInfo) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("K-apt workbook has no worksheets");
  const sheet = workbook.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerIndex = grid.findIndex((row) =>
    row.some((value) => normalizeHeader(value) === normalizeHeader("단지코드")),
  );
  if (headerIndex < 0) throw new Error("Could not locate the K-apt header row");

  const headers = grid[headerIndex].map((value) => cleanText(value) ?? "");
  validateHeaders(headers);
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  const detectedAreaBuckets = AREA_BUCKETS.filter(({ field }) =>
    FIELD_ALIASES[field].some((alias) => normalizedHeaders.has(normalizeHeader(alias))),
  );
  const rows = grid.slice(headerIndex + 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
  );
  const sourceUpdatedAt = sourceDateFrom(
    sourceInfo.fileName,
    sourceInfo.lastModified,
    workbook,
  );
  const normalizedRows = rows
    .filter((row) => Object.values(row).some((value) => cleanText(value)))
    .map((row) => normalizeApartment(row, sourceUpdatedAt));
  const seoulRows = normalizedRows.filter(
    (record) =>
      /^(?:서울|서울특별시)$/.test(record._city ?? "") ||
      /^(?:서울|서울특별시)\s/.test(record.jibunAddress ?? record.roadAddress ?? ""),
  );

  const missingRequired = {
    kaptCode: seoulRows.filter((record) => !record.kaptCode).length,
    name: seoulRows.filter((record) => !record.name).length,
    district: seoulRows.filter((record) => !record.district).length,
    dong: seoulRows.filter((record) => !record.dong).length,
    address: seoulRows.filter((record) => !record.jibunAddress && !record.roadAddress).length,
    approvalDate: seoulRows.filter((record) => !record.approvalDate).length,
    households: seoulRows.filter((record) => record.households === null).length,
    buildings: seoulRows.filter((record) => record.buildings === null).length,
    parkingTotal: seoulRows.filter((record) => record.parking === null).length,
    parkingGround: seoulRows.filter((record) => record.parkingGround === null).length,
    parkingUnderground: seoulRows.filter(
      (record) => record.parkingUnderground === null,
    ).length,
    builder: seoulRows.filter((record) => !record.builder).length,
    developer: seoulRows.filter((record) => !record.developer).length,
    complexType: seoulRows.filter((record) => !record.complexType).length,
    saleType: seoulRows.filter((record) => !record.saleType).length,
    managementType: seoulRows.filter((record) => !record.managementType).length,
    heatingType: seoulRows.filter((record) => !record.heatingType).length,
    corridorType: seoulRows.filter((record) => !record.corridorType).length,
  };
  if (missingRequired.kaptCode || missingRequired.name) {
    throw new Error(
      `K-apt Seoul rows have missing identifiers: ${JSON.stringify(missingRequired)}`,
    );
  }

  const byCode = new Map();
  let duplicateCodeRows = 0;
  for (const record of seoulRows) {
    const existing = byCode.get(record.kaptCode);
    if (existing) {
      duplicateCodeRows += 1;
      if (completeness(record) > completeness(existing)) byCode.set(record.kaptCode, record);
    } else {
      byCode.set(record.kaptCode, record);
    }
  }

  const records = [...byCode.values()]
    .map((record) => {
      const outputRecord = { ...record };
      delete outputRecord._city;
      return outputRecord;
    })
    .sort((left, right) =>
      `${left.district ?? ""}:${left.dong ?? ""}:${left.name}:${left.kaptCode}`.localeCompare(
        `${right.district ?? ""}:${right.dong ?? ""}:${right.name}:${right.kaptCode}`,
        "ko-KR",
      ),
    );
  const duplicateNamesAndAddresses = records.length - new Set(
    records.map((record) =>
      `${record.name}|${record.roadAddress ?? record.jibunAddress ?? ""}`.toLowerCase(),
    ),
  ).size;
  const districtCounts = Object.fromEntries(
    [...new Set(records.map((record) => record.district))]
      .sort((left, right) => left.localeCompare(right, "ko-KR"))
      .map((district) => [
        district,
        records.filter((record) => record.district === district).length,
      ]),
  );
  const complexTypeCounts = Object.fromEntries(
    [...new Set(records.map((record) => record.complexType ?? "미상"))]
      .sort((left, right) => left.localeCompare(right, "ko-KR"))
      .map((complexType) => [
        complexType,
        records.filter((record) => (record.complexType ?? "미상") === complexType)
          .length,
      ]),
  );

  return {
    records,
    meta: {
      source: "국토교통부 공동주택 단지 기본 정보 (K-apt)",
      sourceUrl: SOURCE_URL,
      sourcePageUrl: "https://www.data.go.kr/data/15073271/fileData.do",
      updateFrequency: "weekly",
      license: "이용허락범위 제한 없음",
      sourceScope: "K-apt 가입·관리비 공개 공동주택",
      coverageNote:
        "K-apt 등록 범위의 서울 공동주택 마스터이며, 미가입 소규모 공동주택까지 포함한 서울 전체 건축물대장은 아닙니다.",
      sourceFile: sourceInfo.fileName,
      sourceUpdatedAt,
      sourceSha256: createHash("sha256").update(buffer).digest("hex"),
      worksheet: sheetName,
      headerRow: headerIndex + 1,
      sourceColumns: headers,
      sourceRows: normalizedRows.length,
      seoulRows: seoulRows.length,
      records: records.length,
      districts: Object.keys(districtCounts).length,
      districtCounts,
      complexTypeCounts,
      duplicateCodeRows,
      duplicateNamesAndAddresses,
      areaData: detectedAreaBuckets.length
        ? {
            status: "representative-buckets",
            sourceBuckets: detectedAreaBuckets.map(({ field }) => field),
            representativeSquareMeters: Object.fromEntries(
              detectedAreaBuckets.map(({ field, representativeArea }) => [
                field,
                representativeArea,
              ]),
            ),
            recordsWithAreas: records.filter((record) => record.areas?.length).length,
            note:
              "면적 구간별 세대수가 1 이상인 경우에만 구간 대표값을 추가했으며, 정확한 전용면적을 의미하지 않습니다.",
          }
        : {
            status: "unavailable",
            sourceBuckets: [],
            representativeSquareMeters: {},
            recordsWithAreas: 0,
            note:
              "현재 K-apt 기본정보 원본에는 전용면적 구간 열이 없어 면적을 추정하거나 생성하지 않았습니다.",
          },
      missing: missingRequired,
    },
  };
}

function writeJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourceInfo = options.input
    ? {
        buffer: fs.readFileSync(options.input),
        fileName: path.basename(options.input),
        lastModified: fs.statSync(options.input).mtime.toUTCString(),
      }
    : await downloadSource();
  const { records, meta } = buildSeed(sourceInfo.buffer, sourceInfo);

  writeJson(options.output, records);
  writeJson(options.metaOutput, meta);
  console.log(
    `Generated ${meta.records.toLocaleString("en-US")} Seoul K-apt records ` +
      `from ${meta.sourceRows.toLocaleString("en-US")} source rows.`,
  );
  console.log(JSON.stringify(meta, null, 2));
}

await main();
