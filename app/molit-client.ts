/** Shared XML and paging rules for both MOLIT transaction endpoints. */
export function tag(block: string, ...names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
    if (match) return match[1].trim()
      .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
      .replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  }
  return "";
}

export function isCanceledSale(item: string) {
  const canceled = tag(item, "cdealType", "해제여부").toUpperCase();
  const date = tag(item, "cdealDay", "해제사유발생일");
  return ["O", "Y", "1", "TRUE", "해제"].includes(canceled) || /\d/.test(date);
}

export function validMonth(value: string) {
  return /^(19|20)\d{2}(0[1-9]|1[0-2])$/.test(value);
}

export async function fetchMolitXml(
  endpoint: string, districtCode: string, month: string, serviceKey: string,
  signal?: AbortSignal,
) {
  const url = new URL(endpoint);
  let key = serviceKey;
  try { key = decodeURIComponent(key); } catch { /* Already decoded. */ }
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("LAWD_CD", districtCode);
  url.searchParams.set("DEAL_YMD", month);
  url.searchParams.set("numOfRows", "1000");
  const allItems: string[] = [];
  let expectedTotal: number | undefined;
  for (let page = 1; page <= 100; page += 1) {
    url.searchParams.set("pageNo", String(page));
    let xml = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(attempt === 0 ? 15_000 : 20_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await fetch(url, { cache: "no-store", signal: requestSignal });
        if (!response.ok) {
          await response.body?.cancel();
          if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            continue;
          }
          // Do not retry authentication errors, or expose the credential-bearing URL.
          throw new MolitHttpError(response.status);
        }
        xml = await response.text();
        break;
      } catch (error) {
        if (signal?.aborted) throw new Error("조회 제한시간 초과 또는 요청 취소");
        if (error instanceof MolitHttpError) throw error;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          continue;
        }
        throw new Error(timeout.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
          ? "공공데이터 응답 시간 초과 (재시도 완료)"
          : "공공데이터 연결 실패 (재시도 완료)");
      }
    }
    if (!["00", "000"].includes(tag(xml, "resultCode"))) {
      // Do not expose upstream messages that may contain request credentials.
      throw new Error("공공데이터 API 응답을 확인할 수 없습니다.");
    }
    const totalText = tag(xml, "totalCount");
    if (!/^\d+$/.test(totalText)) throw new Error("실거래 전체 건수가 누락되었습니다.");
    const total = Number(totalText);
    if (!Number.isSafeInteger(total) || (expectedTotal !== undefined && total !== expectedTotal)) {
      throw new Error("조회 중 전체 건수가 변경되었습니다. 다시 조회해 주세요.");
    }
    expectedTotal = total;
    const reportedPage = tag(xml, "pageNo");
    if (reportedPage && Number(reportedPage) !== page) throw new Error("실거래 페이지 응답이 올바르지 않습니다.");
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    allItems.push(...items);
    if (allItems.length === total) return allItems.join("\n");
    if (!items.length || allItems.length > total) throw new Error("실거래 전체 페이지를 수집하지 못했습니다.");
  }
  // Never silently label a truncated month as complete.
  throw new Error("실거래 페이지 수가 조회 한도를 초과했습니다.");
}

class MolitHttpError extends Error {
  constructor(status: number) { super(`공공데이터 조회 실패 (${status})`); }
}
