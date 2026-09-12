import assert from "node:assert/strict";
import test from "node:test";
import { emptyTradeMessage, periodTradeLabel, rentPeriodSupported } from "../lib/trade-coverage.mjs";

test("one collected district does not label another selected district as confirmed zero", () => {
  assert.equal(periodTradeLabel("강남구", ["마포구"], 0), "선택월 거래 미수집");
  assert.equal(periodTradeLabel("마포구", ["마포구"], 0), "확인된 선택월 거래 0건");
  assert.match(periodTradeLabel("서울 전체", ["마포구"], 3), /수집된 1\/25개 구.*3건/);
  assert.equal(periodTradeLabel("서울 전체", [], 0), "선택월 거래 미수집");
});
test("unsupported pre-2011 rent and loading/incomplete feeds never claim no transactions", () => {
  assert.equal(rentPeriodSupported("2010-12"), false);
  assert.equal(rentPeriodSupported("2011-01"), true);
  const complete = { sale: false, rent: false };
  assert.match(emptyTradeMessage("rent", "2010-12", false, "", complete), /2011년 1월부터/);
  assert.match(emptyTradeMessage("sale", "2010-12", false, "", complete), /거래가 없습니다/);
  assert.match(emptyTradeMessage("sale", "2026-07", true, "", complete), /불러오는 중/);
  assert.match(emptyTradeMessage("rent", "2026-07", false, "", { sale: false, rent: true }), /0건을 뜻하지 않습니다/);
});
