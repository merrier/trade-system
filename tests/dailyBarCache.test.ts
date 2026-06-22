import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeDailyBarCache, readDailyBarCache } from "../src/data/dailyBarCache.js";
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

  it("normalizes suffixed stock codes when merging and reading old caches", async () => {
    const bar = createBar("20260609", "000001.SZ");
    const cache = mergeDailyBarCache(null, [bar, { ...bar, code: "000001", close: 12 }], "mock", []);

    expect(cache.bars).toHaveLength(1);
    expect(cache.bars[0]).toMatchObject({ code: "000001", close: 12 });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "trade-system-cache-"));
    try {
      await fs.mkdir(path.join(root, "cache"), { recursive: true });
      await fs.writeFile(
        path.join(root, "cache", "main-daily-bars.json"),
        `${JSON.stringify({ tradeDate: "20260609", dataAsOf: "2026-06-09T00:00:00.000Z", source: "mock", warnings: [], bars: [bar, { ...bar, code: "000001", close: 12 }] })}\n`,
        "utf8"
      );

      const read = await readDailyBarCache(root);

      expect(read?.bars).toHaveLength(1);
      expect(read?.bars[0]).toMatchObject({ code: "000001", close: 12 });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

function createBar(tradeDate: string, code: string): DailyBar {
  return {
    tradeDate,
    code,
    name: "平安银行",
    market: "main",
    open: 10,
    high: 12,
    low: 10,
    close: 11,
    volume: 100,
    amount: 200,
    pctChange: 1,
    turnoverRate: 0.5,
    provider: "mock"
  };
}
