import { describe, expect, it } from "vitest";
import { completeTradingWindow, validateHistory } from "../src/data/intradayPreparation.js";
import { measuredVolumeRatio, samplingMinutes } from "../src/data/intradaySnapshot.js";
import type { DailyBar } from "../src/shared/types.js";

describe("scheduled intraday integrity", () => {
  it("requires completed trading sessions, valid OHLC/volume and a real intraday sample", () => {
    const dates = completeTradingWindow("20260929");
    expect(dates).toHaveLength(30);
    expect(dates.at(-1)).toBe("20260928");
    expect(dates).not.toContain("20260925");
    expect(dates).not.toContain("20260929");
    const bars: DailyBar[] = dates.map(tradeDate => ({ tradeDate, code: "600000", name: "浦发银行", market: "main", open: 10, close: 11, high: 12, low: 9, volume: 100, amount: 100000, pctChange: 0, turnoverRate: 0, provider: "fuyao" }));
    expect(validateHistory(bars, dates)).toBe(true);
    expect(validateHistory(bars.slice(1), dates)).toBe(false);
    expect(validateHistory([...bars.slice(1), bars[1]], dates)).toBe(false);
    expect(validateHistory(bars.map(bar => ({ ...bar, volume: 0 })), dates)).toBe(false);
    expect(validateHistory(bars.map(bar => ({ ...bar, low: 13 })), dates)).toBe(false);
    expect(samplingMinutes(new Date("2026-09-29T14:50:00+08:00"), "20260929")).toBe(230);
    expect(() => samplingMinutes(new Date("2026-09-29T15:00:00+08:00"), "20260929")).toThrow();
    expect(() => samplingMinutes(new Date("2026-09-28T14:50:00+08:00"), "20260929")).toThrow();
    expect(measuredVolumeRatio(100 * 230 / 240, bars, 230)).toBeCloseTo(1);
    expect(() => measuredVolumeRatio(100, [], 230)).toThrow();
  });
});
