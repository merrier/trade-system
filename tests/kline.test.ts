import { afterEach, describe, expect, it, vi } from "vitest";
import { chartCandles, type Candle } from "../src/shared/kline.js";

vi.mock("node:timers/promises", () => ({ setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) }));

const candle = (date: string, close: number, volume = 10): Candle => ({ date, open: close - 1, high: close + 2, low: close - 2, close, volume });

describe("K-line aggregation and moving averages", () => {
  it("computes MA60 using history before the visible 30 bars without future prices", () => {
    const daily = Array.from({ length: 90 }, (_, index) => candle(new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10), index + 1));
    const bars = chartCandles(daily, "day");
    expect(bars[58].ma[3]).toBeNull();
    expect(bars[59].ma[3]).toBe(30.5);
    expect(bars.slice(-30)[0].ma[3]).toBe(31.5);
    expect(bars.at(-1)?.ma).toEqual([88, 85.5, 80.5, 60.5]);
  });

  it("groups across year boundaries into Monday weeks and sums volume, including partial weeks", () => {
    const bars = chartCandles([candle("2026-01-05", 30, 40), candle("2025-12-29", 10, 10), candle("2026-01-02", 20, 20)], "week");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ date: "2026-01-02", open: 9, close: 20, high: 22, low: 8, volume: 30 });
    expect(bars[1]).toMatchObject({ date: "2026-01-05", volume: 40 });
    expect(bars[0].ma).toEqual([null, null, null, null]);
  });

  it("calculates weekly averages from weekly closes, not daily averages", () => {
    const daily = Array.from({ length: 90 }, (_, index) => [
      candle(new Date(Date.UTC(2024, 0, 1 + index * 7)).toISOString().slice(0, 10), 500),
      candle(new Date(Date.UTC(2024, 0, 5 + index * 7)).toISOString().slice(0, 10), index + 1)
    ]).flat();
    const bars = chartCandles(daily, "week");
    expect(bars.at(-1)?.ma).toEqual([88, 85.5, 80.5, 60.5]);
    expect(bars.at(-1)?.volume).toBe(20);
    expect(chartCandles([], "day")).toEqual([]);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function historyModule() {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T06:50:00Z"));
  vi.stubEnv("FUYAO_API_KEY", "test-only");
  return import("../src/data/stockHistory.js");
}

describe("Fuyao chart history", () => {
  it("resolves completed sessions using Shanghai time and the holiday calendar", async () => {
    const { historyEndDate } = await historyModule();
    expect(historyEndDate()).toBe("2026-09-24");
    expect(historyEndDate(new Date("2026-09-28T07:15:00Z"))).toBe("2026-09-28");
  });

  it("normalizes, caches and deduplicates concurrent requests without exposing a key", async () => {
    const { fetchStockHistory } = await historyModule();
    const row = { date_ms: Date.parse("2026-09-24T00:00:00+08:00"), open_price: 10, high_price: 12, low_price: 9, close_price: 11, volume: 12345 };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { item: [row, row, { ...row, date_ms: Date.parse("2026-09-28T00:00:00+08:00") }] } })));
    vi.stubGlobal("fetch", fetch);
    const first = fetchStockHistory("600519");
    const second = fetchStockHistory("600519");
    await vi.advanceTimersByTimeAsync(0);
    const result = await first;
    expect(await second).toEqual(result);
    expect(await fetchStockHistory("600519")).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.bars).toEqual([{ date: "2026-09-24", open: 10, high: 12, low: 9, close: 11, volume: 123.45 }]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("adjust")).toBe("forward");
    expect(url.searchParams.get("thscode")).toBe("600519.SH");
    expect(url.searchParams.get("start")).toBe(String(Date.parse("2023-09-24T00:00:00+08:00")));
    expect(JSON.stringify(result)).not.toContain("test-only");
    await expect(fetchStockHistory("300001")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns safe errors and backs off on an HTTP-200 rate-limit response", async () => {
    const { fetchStockHistory } = await historyModule();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ code: 4001, message: "test-only" }))));
    vi.stubGlobal("fetch", fetch);
    const first = expect(fetchStockHistory("600519")).rejects.toThrow("行情接口限流");
    await vi.advanceTimersByTimeAsync(0);
    await first;
    const second = expect(fetchStockHistory("000001")).rejects.toThrow("行情接口限流");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
