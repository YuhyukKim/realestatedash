import { getD1OrNull } from "../../../../db";
import { appendImport, cleanupImport, commitImport, ImportError, startImport } from "../../../../db/trade-store";
import { DISTRICT_CODES } from "../../../data";
import { validRecordMonth } from "../../../../lib/molit-records.mjs";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 512 * 1024;

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ImportError("JSON 요청만 가능합니다.", 415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new ImportError("요청이 너무 큽니다.", 413);
  if (!request.body) throw new ImportError("요청 내용이 없습니다.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ImportError("요청이 너무 큽니다.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ImportError("JSON 형식이 올바르지 않습니다.", 400); }
}

export async function POST(request: Request) {
  const expected = process.env.DATA_REFRESH_TOKEN;
  if (!expected || expected.length < 32) return Response.json({ message: "관리자 수집 인증이 설정되지 않았습니다." }, { status: 503, headers });
  const provided = request.headers.get("authorization") ?? "";
  if (provided.length > 4096) return Response.json({ message: "인증이 필요합니다." }, { status: 401, headers });
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode("Bearer " + expected)),
  ]);
  const l = new Uint8Array(left), r = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < l.length; i++) difference |= l[i] ^ r[i];
  if (difference) return Response.json({ message: "인증이 필요합니다." }, { status: 401, headers });
  const db = getD1OrNull();
  if (!db) return Response.json({ message: "수집 DB를 사용할 수 없습니다." }, { status: 503, headers });
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) {
      throw new ImportError("수집 작업 ID가 올바르지 않습니다.", 400);
    }
    if (body.action === "start") {
      if (!Object.hasOwn(DISTRICT_CODES, body.district) || !["sale", "rent"].includes(body.kind) ||
          typeof body.month !== "string" || !validRecordMonth(body.month, body.kind) ||
          typeof body.fetchedAt !== "string" || !Number.isFinite(Date.parse(body.fetchedAt)) ||
          new Date(body.fetchedAt).toISOString() !== body.fetchedAt ||
          Date.parse(body.fetchedAt) > Date.now() + 300000) throw new ImportError("수집 범위가 올바르지 않습니다.", 400);
      const run = await startImport(db, body);
      return Response.json({ id: run.id, committed: !!run.committed, expectedCount: run.expected_count }, { headers });
    }
    if (body.action === "chunk") return Response.json(await appendImport(db, body.id, body.offset, body.records), { headers });
    if (body.action === "cleanup") return Response.json(await cleanupImport(db, body.id), { headers });
    if (body.action === "commit") return Response.json(await commitImport(db, body.id), { headers });
    throw new ImportError("알 수 없는 수집 동작입니다.", 400);
  } catch (error) {
    // Never return SQL, records, credentials, or upstream request URLs.
    return Response.json({ message: error instanceof ImportError ? error.message : "수집 저장 실패. 기존 공개 자료는 유지됩니다." },
      { status: error instanceof ImportError ? error.status : 503, headers });
  }
}
