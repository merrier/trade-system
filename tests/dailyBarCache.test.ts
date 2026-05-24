import { describe, expect, it } from "vitest";
import { mergeDailyBarCache } from "../src/data/dailyBarCache.js";
import type { DailyBar } from "../src/shared/types.js";

describe("daily bar sliding cache", () => {
  it("keeps only the latest 30 trade dates and main-board stocks", () => {
    const bars: DailyBar[] = Array.from({ length: 35 }, (_, index) => {
      const day = String(20260501 + index);
      return {
        tradeDate: day,
        code: "600000",
        name: "浦发银行",
        market: "main",
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
        amount: 200,
        pctChange: 1,
        turnoverRate: 0.5,
        provider: "mock"
      };
    });
    bars.push({ ...bars[0], code: "300001", market: "gem" });

    const cache = mergeDailyBarCache(null, bars, "mock", []);
    const dates = [...new Set(cache.bars.map((bar) => bar.tradeDate))];

    expect(dates).toHaveLength(30);
    expect(cache.bars.some((bar) => bar.code === "300001")).toBe(false);
    expect(dates[0]).toBe("20260506");
  });
});
