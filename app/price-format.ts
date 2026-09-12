import type { ComplexTransaction } from "./complex-types";

const MANWON_PER_EOK = 10_000;
const koreanNumber = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function toManwon(price: number): number | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  const manwon = Math.round(price * MANWON_PER_EOK);
  return Number.isSafeInteger(manwon) ? manwon : null;
}

/** API prices are in eok; recover the integer-manwon amount only at display time. */
export function formatPrice(price: number): string {
  const manwon = toManwon(price);
  if (manwon === null) return "-";
  if (manwon === 0) return "0원";
  const eok = Math.floor(manwon / MANWON_PER_EOK);
  const remainder = manwon % MANWON_PER_EOK;
  if (!eok) return `${koreanNumber.format(remainder)}만원`;
  return `${koreanNumber.format(eok)}억${remainder ? ` ${koreanNumber.format(remainder)}만원` : ""}`;
}

/** Compact, explicitly approximate aggregates; never use for a single contract. */
export function formatSummaryPrice(price: number): string {
  return toManwon(price) === null ? "-" : `약 ${price.toFixed(1)}억`;
}

export function formatRent(transaction: Pick<ComplexTransaction, "type" | "price" | "monthlyRent">): string {
  if (transaction.type !== "monthly") return formatPrice(transaction.price);
  const deposit = formatPrice(transaction.price);
  if (deposit === "-" || !Number.isSafeInteger(transaction.monthlyRent) || transaction.monthlyRent <= 0) return "-";
  return `보증금 ${deposit} / 월 ${koreanNumber.format(transaction.monthlyRent)}만원`;
}
