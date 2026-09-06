import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SOURCE_PAGE = "https://www.data.go.kr/data/15106861/fileData.do";
const SOURCE_URL =
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003521525&fileDetailSn=1&insertDataPrcus=N";
const SOURCE_DATE = "2025-09-18";
const DEFAULT_OUTPUT = "db/generated-reb-complexes.json";
const DEFAULT_META_OUTPUT = "db/generated-reb-complexes.meta.json";
const DEFAULT_KAPT_INPUT = "db/generated-complexes.json";

const EXPECTED_COLUMNS = [
  "단지고유번호",
  "필지고유번호",
  "주소",
  "단지명_공시가격",
  "단지명_건축물대장",
  "단지명_도로명주소",
  "단지종류",
  "동수",
  "세대수",
  "사용승인일",
];
const NON_APARTMENT_KAPT_TYPES = new Set(["연립주택", "다세대", "다세대주택"]);
const KNOWN_COVERED_REB_IDS = [
  "11410120346474",
  "11410120346473",
  "11410120346472",
  "11410120349026",
  "11440120302476",
  "11440120302058",
  "11440120302481",
  "11440120303385",
  "11680100001442",
  "11305120120808",
  "11305120120809",
  "11530120392440",
  "11530120384167",
  "11530120439033",
  "11530120361291",
  "11230120372936",
  "11545120444976",
  "11440120416534",
  "11500120446750",
  "11740120385852",
];
const KNOWN_DISTINCT_REB_IDS = [
  "11200120412523",
  "11500120139015",
  "11305120444002",
  "11350120343194",
  "11350120357413",
];

function parseArguments(args) {
  const options = {
    input: null,
    output: DEFAULT_OUTPUT,
    metaOutput: DEFAULT_META_OUTPUT,
    kaptInput: DEFAULT_KAPT_INPUT,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") options.input = args[++index];
    else if (argument === "--output") options.output = args[++index];
    else if (argument === "--meta-output") options.metaOutput = args[++index];
    else if (argument === "--kapt-input") options.kaptInput = args[++index];
    else if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: node scripts/generate-reb-seoul-apartment-seed.mjs " +
          "[--input reb-complexes.csv] [--output complexes.json] " +
          "[--meta-output complexes.meta.json] [--kapt-input kapt.json]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function cleanText(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function toPositiveInteger(value) {
  const number = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Small RFC 4180 reader. It handles commas, quotes and embedded newlines. */
function parseCsv(text, onRow) {
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      onRow(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    onRow(row);
  }
}

function preferredName(row) {
  return (
    cleanText(row["단지명_공시가격"]) ??
    cleanText(row["단지명_건축물대장"]) ??
    cleanText(row["단지명_도로명주소"])
  );
}

function addressParts(address) {
  const parts = address.split(/\s+/);
  if (parts[0] !== "서울특별시" || !parts[1] || !parts[2]) return null;
  return { district: parts[1], dong: parts[2] };
}

function rowToRecord(row) {
  const complexId = cleanText(row["단지고유번호"]);
  const pnu = cleanText(row["필지고유번호"]);
  const address = cleanText(row["주소"]);
  const name = preferredName(row);
  const location = address ? addressParts(address) : null;
  if (!complexId || !address || !name || !location) return null;

  const approvalDate = normalizeDate(row["사용승인일"]);
  return {
    id: `reb:${complexId}`,
    seoulComplexId: complexId,
    rebComplexId: complexId,
    pnu,
    name,
    apartment: name,
    district: location.district,
    dong: location.dong,
    jibunAddress: address,
    address,
    approvalDate,
    buildYear: approvalDate ? Number(approvalDate.slice(0, 4)) : null,
    households: toPositiveInteger(row["세대수"]),
    buildings: toPositiveInteger(row["동수"]),
    publicPriceName: cleanText(row["단지명_공시가격"]),
    buildingRegisterName: cleanText(row["단지명_건축물대장"]),
    roadAddressName: cleanText(row["단지명_도로명주소"]),
    complexType: "아파트",
    complexTypeCode: "1",
    source: "한국부동산원 공동주택 단지 식별정보",
    sourceUpdatedAt: SOURCE_DATE,
  };
}

async function loadSource(input) {
  if (input) {
    const absoluteInput = path.resolve(input);
    const buffer = fs.readFileSync(absoluteInput);
    return {
      buffer,
      sourceFile: path.basename(absoluteInput),
      downloaded: false,
    };
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Official source returned HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    sourceFile: "한국부동산원_공동주택 단지 식별정보_기본정보_20250918.csv",
    downloaded: true,
  };
}

function districtCounts(records) {
  return Object.fromEntries(
    [...new Set(records.map((record) => record.district))]
      .sort((left, right) => left.localeCompare(right, "ko-KR"))
      .map((district) => [
        district,
        records.filter((record) => record.district === district).length,
      ]),
  );
}

function normalizeName(value, loose = false) {
  let normalized = String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/e편한/g, "이편한")
    .replace(/[^0-9a-z가-힣]/g, "");
  if (loose) {
    normalized = normalized.replace(/(?:공동주택|주상복합|아파트)$/g, "");
  }
  return normalized;
}

function normalizeFamilyName(value) {
  let family = String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/e편한/g, "이편한")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^0-9a-z가-힣]/g, "")
    .replace(/(?:공동주택|주상복합|아파트)$/g, "")
    .replace(/ii$/g, "2");
  let previous = "";
  while (family && family !== previous) {
    previous = family;
    family = family
      .replace(/(?:임대|분양)$/g, "")
      .replace(/(?:제?\d+)?단지$/g, "")
      .replace(/\d+(?:차|동)$/g, "")
      .replace(/\d+$/g, "");
  }
  return family;
}

function lotKeys(address) {
  const keys = new Set();
  const pattern =
    /(?:서울특별시\s+)?([가-힣]+구)\s+([0-9가-힣]+(?:동|가))\s+((?:산\s*)?\d+(?:-\d+)?)/g;
  for (const match of String(address ?? "").matchAll(pattern)) {
    const lot = match[3].replace(/\s+/g, "").replace(/-0+$/g, "");
    keys.add(`${match[1]}|${match[2]}|${lot}`);
  }
  return [...keys];
}

function rebAliases(record, loose = false) {
  return new Set(
    [
      record.name,
      record.publicPriceName,
      record.buildingRegisterName,
      record.roadAddressName,
    ]
      .map((value) => normalizeName(value, loose))
      .filter(Boolean),
  );
}

function rebFamilyAliases(record) {
  return new Set(
    [
      record.name,
      record.publicPriceName,
      record.buildingRegisterName,
      record.roadAddressName,
    ]
      .map(normalizeFamilyName)
      .filter(Boolean),
  );
}

function kaptYear(record) {
  if (Number.isInteger(record.buildYear)) return record.buildYear;
  const approvalDate = normalizeDate(record.approvalDate);
  return approvalDate ? Number(approvalDate.slice(0, 4)) : null;
}

function valuesAgree(left, right) {
  return (
    Number.isInteger(left) &&
    Number.isInteger(right) &&
    Number(left) === Number(right)
  );
}

function yearCompatible(left, right, tolerance = 1) {
  return (
    left === null ||
    right === null ||
    Math.abs(Number(left) - Number(right)) <= tolerance
  );
}

function householdSum(records) {
  if (
    !records.length ||
    records.some(
      (record) =>
        !Number.isInteger(record.households) || Number(record.households) <= 0,
    )
  ) {
    return null;
  }
  return records.reduce((sum, record) => sum + Number(record.households), 0);
}

function nameVariants(value, district, dong) {
  const family = normalizeFamilyName(value);
  const variants = new Set(family ? [family] : []);
  const prefixes = [
    String(district ?? "").replace(/구$/, ""),
    String(dong ?? ""),
    String(dong ?? "").replace(/(?:동|가)$/, ""),
  ]
    .map(normalizeFamilyName)
    .filter(Boolean);
  for (const prefix of prefixes) {
    const minimumRemainder = prefix.length === 1 ? 4 : 2;
    if (
      family.startsWith(prefix) &&
      family.length - prefix.length >= minimumRemainder
    ) {
      variants.add(family.slice(prefix.length));
    }
  }
  return variants;
}

function recordsNameRelated(kapt, reb) {
  const kaptVariants = nameVariants(
    kapt.name ?? kapt.apartment,
    kapt.district,
    kapt.dong,
  );
  const rebVariants = new Set();
  for (const alias of [
    reb.name,
    reb.publicPriceName,
    reb.buildingRegisterName,
    reb.roadAddressName,
  ]) {
    for (const variant of nameVariants(alias, reb.district, reb.dong)) {
      rebVariants.add(variant);
    }
  }
  return [...kaptVariants].some((left) =>
    [...rebVariants].some(
      (right) =>
        left === right ||
        (Math.min(left.length, right.length) >= 2 &&
          (left.includes(right) || right.includes(left))),
    ),
  );
}

function recordsCanonicalNameEqual(kapt, reb) {
  const kaptVariants = nameVariants(
    kapt.name ?? kapt.apartment,
    kapt.district,
    kapt.dong,
  );
  const rebVariants = new Set();
  for (const alias of [
    reb.name,
    reb.publicPriceName,
    reb.buildingRegisterName,
    reb.roadAddressName,
  ]) {
    for (const variant of nameVariants(alias, reb.district, reb.dong)) {
      if (variant.length >= 3) rebVariants.add(variant);
    }
  }
  return [...kaptVariants].some(
    (variant) => variant.length >= 3 && rebVariants.has(variant),
  );
}

function hasStrongProfileConflict(kapt, reb) {
  const leftYear = kaptYear(kapt);
  const rightYear = reb.buildYear;
  return (
    leftYear !== null &&
    rightYear !== null &&
    Math.abs(leftYear - rightYear) >= 10 &&
    Number.isInteger(kapt.households) &&
    Number.isInteger(reb.households) &&
    Number(kapt.households) !== Number(reb.households)
  );
}

function uniqueCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((record) => [record.rebComplexId, record]),
    ).values(),
  ];
}

function buildIndex(records, keyFactory) {
  const index = new Map();
  for (const record of records) {
    for (const key of keyFactory(record)) {
      if (!key) continue;
      const current = index.get(key) ?? [];
      current.push(record);
      index.set(key, current);
    }
  }
  return index;
}

function matchKaptToReb(kaptRecords, rebRecords) {
  const byLot = buildIndex(rebRecords, (record) => lotKeys(record.jibunAddress));
  const byStrictName = buildIndex(rebRecords, (record) =>
    [...rebAliases(record)].map(
      (name) => `${record.district}|${record.dong}|${name}`,
    ),
  );
  const byLooseName = buildIndex(rebRecords, (record) =>
    [...rebAliases(record, true)].map(
      (name) => `${record.district}|${record.dong}|${name}`,
    ),
  );
  const byFamilyName = buildIndex(rebRecords, (record) =>
    [...rebFamilyAliases(record)].map(
      (name) => `${record.district}|${record.dong}|${name}`,
    ),
  );
  const byProfile = buildIndex(rebRecords, (record) =>
    record.buildYear !== null && Number.isInteger(record.households)
      ? [
          `${record.district}|${record.dong}|${record.buildYear}|${record.households}`,
        ]
      : [],
  );
  const matchedIds = new Set();
  const matchedKaptIds = new Set();
  const reasonCounts = {};

  function accept(kapt, rebRecords, reason) {
    if (!rebRecords.length) return;
    matchedKaptIds.add(kapt.kaptCode ?? kapt.id);
    const newlyMatched = rebRecords.filter(
      (record) => !matchedIds.has(record.rebComplexId),
    );
    for (const record of newlyMatched) matchedIds.add(record.rebComplexId);
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + newlyMatched.length;
  }

  for (const kapt of kaptRecords) {
    const strictName = normalizeName(kapt.name ?? kapt.apartment);
    const looseName = normalizeName(kapt.name ?? kapt.apartment, true);
    const familyName = normalizeFamilyName(kapt.name ?? kapt.apartment);
    const year = kaptYear(kapt);
    const approvalDate = normalizeDate(kapt.approvalDate);
    const lots = lotKeys(kapt.jibunAddress ?? kapt.address);
    const lotCandidates = uniqueCandidates(
      lots.flatMap((key) => byLot.get(key) ?? []),
    );
    const compatibleLotCandidates = lotCandidates.filter(
      (record) => !hasStrongProfileConflict(kapt, record),
    );

    if (compatibleLotCandidates.length) {
      if (
        valuesAgree(kapt.households, householdSum(compatibleLotCandidates))
      ) {
        accept(kapt, compatibleLotCandidates, "jibun-household-sum");
      }

      const approvalGroups = new Map();
      for (const record of compatibleLotCandidates) {
        if (!record.approvalDate) continue;
        const group = approvalGroups.get(record.approvalDate) ?? [];
        group.push(record);
        approvalGroups.set(record.approvalDate, group);
      }
      for (const group of approvalGroups.values()) {
        if (valuesAgree(kapt.households, householdSum(group))) {
          accept(kapt, group, "jibun-approval-group-household-sum");
        }
      }

      const relatedCandidates = compatibleLotCandidates.filter((record) =>
        recordsNameRelated(kapt, record),
      );
      if (
        relatedCandidates.length > 1 &&
        valuesAgree(kapt.households, householdSum(relatedCandidates))
      ) {
        accept(kapt, relatedCandidates, "jibun-alias-household-sum");
      }

      const directCandidates = compatibleLotCandidates.filter(
        (record) =>
          (approvalDate && record.approvalDate === approvalDate) ||
          valuesAgree(kapt.households, record.households) ||
          recordsCanonicalNameEqual(kapt, record) ||
          (recordsNameRelated(kapt, record) &&
            yearCompatible(year, record.buildYear)),
      );
      if (directCandidates.length) {
        accept(kapt, directCandidates, "jibun-strong-profile");
      } else if (compatibleLotCandidates.length === 1) {
        const [candidate] = compatibleLotCandidates;
        const strongConflict =
          year !== null &&
          candidate.buildYear !== null &&
          Math.abs(year - candidate.buildYear) > 3 &&
          !recordsNameRelated(kapt, candidate) &&
          !valuesAgree(kapt.households, candidate.households);
        if (!strongConflict) {
          accept(kapt, compatibleLotCandidates, "unique-jibun");
        }
      }
    }

    if (strictName) {
      const strictCandidates = uniqueCandidates(
        byStrictName.get(`${kapt.district}|${kapt.dong ?? ""}|${strictName}`) ?? [],
      ).filter(
        (record) => yearCompatible(year, record.buildYear),
      );
      if (strictCandidates.length === 1) {
        accept(kapt, strictCandidates, "name-and-compatible-year");
      }
    }

    if (looseName) {
      const looseCandidates = uniqueCandidates(
        byLooseName.get(`${kapt.district}|${kapt.dong ?? ""}|${looseName}`) ?? [],
      ).filter(
        (record) =>
          (approvalDate && record.approvalDate === approvalDate) ||
          (year !== null &&
            record.buildYear === year &&
            valuesAgree(kapt.households, record.households)),
      );
      if (looseCandidates.length === 1) {
        accept(kapt, looseCandidates, "loose-name-and-profile");
      }
    }

    if (familyName) {
      const familyVariants = nameVariants(
        kapt.name ?? kapt.apartment,
        kapt.district,
        kapt.dong,
      );
      const familyCandidates = uniqueCandidates(
        [...familyVariants].flatMap(
          (variant) =>
            byFamilyName.get(
              `${kapt.district}|${kapt.dong ?? ""}|${variant}`,
            ) ?? [],
        ),
      ).filter(
        (record) =>
          !hasStrongProfileConflict(kapt, record) &&
          ((approvalDate && record.approvalDate === approvalDate) ||
            (yearCompatible(year, record.buildYear) &&
              valuesAgree(kapt.households, record.households))),
      );
      if (familyCandidates.length) {
        accept(kapt, familyCandidates, "family-name-and-profile");
      }
    }

    if (year !== null && Number.isInteger(kapt.households)) {
      const profileCandidates = uniqueCandidates(
        byProfile.get(
          `${kapt.district}|${kapt.dong ?? ""}|${year}|${kapt.households}`,
        ) ?? [],
      ).filter(
        (record) =>
          !hasStrongProfileConflict(kapt, record) &&
          recordsNameRelated(kapt, record),
      );
      if (profileCandidates.length === 1) {
        accept(kapt, profileCandidates, "profile-and-strong-name-unique");
      }
    }
  }

  return { matchedIds, matchedKaptIds, reasonCounts };
}

function compactSupplementRecord(record) {
  return {
    id: record.id,
    seoulComplexId: record.seoulComplexId,
    name: record.name,
    apartment: record.apartment,
    district: record.district,
    dong: record.dong,
    jibunAddress: record.jibunAddress,
    address: record.address,
    approvalDate: record.approvalDate,
    buildYear: record.buildYear,
    households: record.households,
    buildings: record.buildings,
    source: record.source,
    sourceUpdatedAt: record.sourceUpdatedAt,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = await loadSource(options.input);
  const sha256 = createHash("sha256").update(source.buffer).digest("hex");
  const text = source.buffer.toString("utf8").replace(/^\uFEFF/, "");

  let headers = null;
  let sourceRows = 0;
  let seoulRows = 0;
  let seoulApartmentRows = 0;
  let invalidRows = 0;
  const byId = new Map();

  parseCsv(text, (values) => {
    if (!headers) {
      headers = values.map((value) => cleanText(value) ?? "");
      const missing = EXPECTED_COLUMNS.filter(
        (column) => !headers.includes(column),
      );
      if (missing.length) {
        throw new Error(`Official source is missing columns: ${missing.join(", ")}`);
      }
      return;
    }

    if (!values.some((value) => value.trim())) return;
    sourceRows += 1;
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
    const address = cleanText(row["주소"]);
    if (!address?.startsWith("서울특별시 ")) return;
    seoulRows += 1;
    if (cleanText(row["단지종류"]) !== "1") return;
    seoulApartmentRows += 1;

    const record = rowToRecord(row);
    if (!record) {
      invalidRows += 1;
      return;
    }
    if (!byId.has(record.rebComplexId)) byId.set(record.rebComplexId, record);
  });

  const officialRecords = [...byId.values()].sort(
    (left, right) =>
      left.district.localeCompare(right.district, "ko-KR") ||
      left.dong.localeCompare(right.dong, "ko-KR") ||
      left.name.localeCompare(right.name, "ko-KR") ||
      left.rebComplexId.localeCompare(right.rebComplexId),
  );
  const kaptPath = path.resolve(options.kaptInput);
  const sourceKaptRecords = JSON.parse(fs.readFileSync(kaptPath, "utf8"));
  if (!Array.isArray(sourceKaptRecords)) {
    throw new Error("K-apt seed must be a JSON array");
  }
  const excludedKaptRecords = sourceKaptRecords.filter((record) =>
    NON_APARTMENT_KAPT_TYPES.has(cleanText(record.complexType)),
  );
  const kaptRecords = sourceKaptRecords.filter(
    (record) => !NON_APARTMENT_KAPT_TYPES.has(cleanText(record.complexType)),
  );
  const overlap = matchKaptToReb(kaptRecords, officialRecords);
  const records = officialRecords
    .filter((record) => !overlap.matchedIds.has(record.rebComplexId))
    .map(compactSupplementRecord);
  const officialIds = new Set(
    officialRecords.map((record) => record.rebComplexId),
  );
  const knownCovered = KNOWN_COVERED_REB_IDS.filter((id) => officialIds.has(id));
  const missedKnownCovered = knownCovered.filter(
    (id) => !overlap.matchedIds.has(id),
  );
  if (missedKnownCovered.length) {
    throw new Error(
      `Known K-apt aggregate components were not matched: ${missedKnownCovered.join(", ")}`,
    );
  }
  const knownDistinct = KNOWN_DISTINCT_REB_IDS.filter((id) => officialIds.has(id));
  const wronglyMergedKnownDistinct = knownDistinct.filter((id) =>
    overlap.matchedIds.has(id),
  );
  if (wronglyMergedKnownDistinct.length) {
    throw new Error(
      `Known distinct REB records were merged: ${wronglyMergedKnownDistinct.join(", ")}`,
    );
  }
  const kaptLotKeys = new Set(
    kaptRecords.flatMap((record) =>
      lotKeys(record.jibunAddress ?? record.address),
    ),
  );
  const sameJibunSupplementRecords = records.filter((record) =>
    lotKeys(record.jibunAddress).some((key) => kaptLotKeys.has(key)),
  ).length;
  const meta = {
    source: "한국부동산원 공동주택 단지 식별정보 기본정보",
    sourcePageUrl: SOURCE_PAGE,
    sourceUrl: SOURCE_URL,
    sourceFile: source.sourceFile,
    sourceUpdatedAt: SOURCE_DATE,
    updateFrequency: "annual",
    license: "이용허락범위 제한 없음",
    sourceScope:
      "전년도까지 사용승인된 공시대상 공동주택 중 단지종류 코드 1(아파트)",
    coverageNote:
      "서울특별시 주소이면서 단지종류 코드가 1인 공시대상 공동주택입니다. 건축물대장 등과 기준시점 차이로 일부 명칭·주소가 비어 있을 수 있으며, 공시대상이 아닌 건물까지 포함한 전수 건축물대장은 아닙니다.",
    sourceSha256: sha256,
    sourceRows,
    seoulRows,
    seoulApartmentRows,
    officialSeoulApartmentRecords: officialRecords.length,
    duplicateComplexIds:
      seoulApartmentRows - officialRecords.length - invalidRows,
    invalidRows,
    sourceKaptRecords: sourceKaptRecords.length,
    excludedNonApartmentKaptRecords: excludedKaptRecords.length,
    excludedNonApartmentKaptTypeCounts: Object.fromEntries(
      [...NON_APARTMENT_KAPT_TYPES]
        .map((type) => [
          type,
          excludedKaptRecords.filter((record) => record.complexType === type)
            .length,
        ])
        .filter(([, count]) => count > 0),
    ),
    kaptRecords: kaptRecords.length,
    matchedKaptRecords: overlap.matchedKaptIds.size,
    matchedRebRecords: overlap.matchedIds.size,
    unmatchedKaptRecords: kaptRecords.length - overlap.matchedKaptIds.size,
    records: records.length,
    supplementRecords: records.length,
    mergedRecords: kaptRecords.length + records.length,
    sameJibunSupplementRecords,
    knownRegressionChecks: {
      coveredAggregateComponents: knownCovered,
      preservedDistinctRecords: knownDistinct,
    },
    matchRelationCounts: overlap.reasonCounts,
    districtCount: Object.keys(districtCounts(officialRecords)).length,
    officialDistrictCounts: districtCounts(officialRecords),
    supplementDistrictCounts: districtCounts(records),
    deduplicationKey: "한국부동산원 단지고유번호",
    mergePolicy:
      "K-apt 아파트·주상복합 ID와 레코드를 우선 보존하고, 같은 지번에서 이름 별칭·사용승인일·세대수 합계가 일치하는 REB 세부 행을 다대일로 연결합니다. 준공연도와 세대수가 모두 크게 충돌하는 행은 별도 단지로 남깁니다.",
  };

  const outputPath = path.resolve(options.output);
  const metaOutputPath = path.resolve(options.metaOutput);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(metaOutputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`);
  fs.writeFileSync(metaOutputPath, `${JSON.stringify(meta, null, 2)}\n`);

  console.log(
    `Generated ${records.length.toLocaleString("en-US")} REB-only Seoul apartment records ` +
      `from ${sourceRows.toLocaleString("en-US")} official rows.`,
  );
  console.log(
    JSON.stringify(
      {
        downloaded: source.downloaded,
        seoulRows,
        seoulApartmentRows,
        officialRecords: officialRecords.length,
        sourceKaptRecords: sourceKaptRecords.length,
        excludedNonApartmentKaptRecords: excludedKaptRecords.length,
        kaptRecords: kaptRecords.length,
        matchedKaptRecords: overlap.matchedKaptIds.size,
        matchedRebRecords: overlap.matchedIds.size,
        supplementRecords: records.length,
        mergedRecords: kaptRecords.length + records.length,
        sameJibunSupplementRecords,
        invalidRows,
        duplicateComplexIds: meta.duplicateComplexIds,
        districts: meta.districtCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
