import { describe, expect, it } from "vitest";
import { currentShanghaiTradeDate, isAshareTradingDay, normalizeTradeDate, tradingDayDecision } from "../src/data/tradingCalendar.js";

describe("A-share trading calendar", () => {
  it("detects weekends as non-trading days", () => {
    const decision = tradingDayDecision("20260524");

    expect(decision).toEqual({
      tradeDate: "20260524",
      isTradingDay: false,
      reason: "A股周末休市"
    });
  });

  it("detects official 2026 A-share holidays", () => {
    expect(isAshareTradingDay("2026-05-01")).toBe(false);
    expect(tradingDayDecision("20260501").reason).toBe("A股节假日休市");
  });

  it("allows normal weekdays", () => {
    expect(isAshareTradingDay("20260525")).toBe(true);
  });

  it("supports operator-provided extra holidays", () => {
    expect(isAshareTradingDay("20260525", "20260525")).toBe(false);
  });

  it("uses Asia/Shanghai date boundaries", () => {
    expect(currentShanghaiTradeDate(new Date("2026-05-24T15:30:00.000Z"))).toBe("20260524");
  });

  it("normalizes dashed trade dates", () => {
    expect(normalizeTradeDate("2026-05-22")).toBe("20260522");
  });
});
