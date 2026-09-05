import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const [inputPath, outputPath = "app/school-data.ts"] = process.argv.slice(2);

if (!inputPath) {
  throw new Error("Usage: node scripts/generate-school-data.mjs <source.csv> [output.ts]");
}

const decoded = new TextDecoder("euc-kr").decode(fs.readFileSync(inputPath));
const workbook = XLSX.read(decoded, { type: "string", raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
const latestYear = Math.max(...rows.map((row) => Number(row.연도) || 0));
const levels = new Set(["초등학교", "중학교", "고등학교"]);
const schools = rows
  .filter((row) => Number(row.연도) === latestYear && levels.has(row.학교급))
  .map((row) => [
    String(row.학교).trim(),
    String(row.학교급).trim(),
    String(row.자치구).trim(),
    String(row.주소).trim(),
    String(row.설립구분).trim(),
    Number(Number(row.위도).toFixed(7)),
    Number(Number(row.경도).toFixed(7)),
  ])
  .sort((left, right) =>
    `${left[2]}:${left[1]}:${left[0]}`.localeCompare(
      `${right[2]}:${right[1]}:${right[0]}`,
      "ko-KR",
    ),
  );

const source = `// Generated from the Seoul Metropolitan Office of Education public file dataset.\n` +
  `// Source: https://www.data.go.kr/data/15152021/fileData.do\n` +
  `import type { SchoolLevel } from "./place-types";\n\n` +
  `export type BundledSchoolRow = readonly [\n` +
  `  name: string,\n  level: SchoolLevel,\n  district: string,\n` +
  `  address: string,\n  foundation: string,\n  latitude: number,\n  longitude: number,\n];\n\n` +
  `export const BUNDLED_SCHOOL_DATA_YEAR = ${latestYear};\n\n` +
  `export const BUNDLED_SCHOOLS: readonly BundledSchoolRow[] = ${JSON.stringify(schools)};\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, source);
console.log(`Generated ${schools.length} schools for ${latestYear}: ${outputPath}`);
