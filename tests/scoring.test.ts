import { describe, expect, it } from "vitest";
import { createDefaultStrategy, createLimitUpPullbackStrategy } from "../src/core/defaults.js";
import { rankSectors, rankStocks } from "../src/core/scoring.js";
import { evaluateWatchCondition } from "../src/core/watchlist.js";
import { createSampleDataset } from "../src/data/sampleDataset.js";
import { compileWatchConditionLocally } from "../src/core/strategy.js";
import type { DailyBar, MarketDataset } from "../src/shared/types.js";

describe("ranking", () => {
  it("ranks stocks with explanations and risk fields", () => {
    const dataset = createSampleDataset("20260506");
    const results = rankStocks(dataset, createDefaultStrategy("short_term", ["main"]), "post_close");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].rank).toBe(1);
    expect(results[0].reasons.length).toBeGreaterThan(0);
    expect(results[0].factors.sectorHeat).toBeGreaterThan(0);
  });

  it("ranks sector heat by flow and limit-up count", () => {
    const sectors = rankSectors(createSampleDataset("20260506"));

    expect(sectors[0].name).toBe("AI应用");
    expect(sectors[0].heatScore).toBeGreaterThan(80);
  });

  it("triggers watchlist conditions when enough templates match", () => {
    const dataset = createSampleDataset("20260506");
    const condition = compileWatchConditionLocally("所属概念进入前三且个股放量突破5日线", ["main"]);
    const evaluation = evaluateWatchCondition("603000", condition, dataset);

    expect(evaluation.triggered).toBe(true);
    expect(evaluation.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("filters and ranks the limit-up pullback strategy from daily bars", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260522",
      dataAsOf: "2026-05-22T06:50:00.000Z",
      source: "sample",
      warnings: [],
      stocks: [
        stock("600001", "缩量回调", 11.8, 120_000_000),
        stock("600002", "放量回调", 11.8, 120_000_000),
        stock("600003", "涨幅过热", 11.8, 120_000_000)
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: []
    };
    const bars = [
      ...pullbackBars("600001", 800),
      ...pullbackBars("600002", 1500),
      ...pullbackBars("600003", 800, { firstClose: 8.8 })
    ];

    const results = rankStocks(dataset, createLimitUpPullbackStrategy(["main"]), "intraday", { dailyBars: bars });

    expect(results.map((item) => item.code)).toEqual(["600001"]);
    expect(results[0].factors.pullbackMatch).toBeGreaterThan(70);
    expect(results[0].factors.twentyDayGain).toBeLessThanOrEqual(25);
    expect(results[0].factors.bullishMaAlignment).toBe(100);
    expect(results[0].reasons.join(" ")).toContain("阴线缩量");
    expect(results[0].reasons.join(" ")).toContain("均线多头排列");
  });
});

function stock(code: string, name: string, close: number, turnoverAmount: number) {
  return {
    code,
    name,
    market: "main" as const,
    industry: "测试",
    concepts: [],
    pctChange: -1,
    turnoverAmount,
    turnoverRate: 3,
    volumeRatio: 0.8,
    close,
    open: 12,
    high: 12.2,
    low: 11.1,
    volume: 800,
    listedDays: 1000,
    mainNetInflow: 0
  };
}

function pullbackBars(code: string, currentVolume: number, options: { firstClose?: number } = {}): DailyBar[] {
  const dates = [
    "20260422",
    "20260423",
    "20260424",
    "20260427",
    "20260428",
    "20260429",
    "20260430",
    "20260506",
    "20260507",
    "20260508",
    "20260511",
    "20260512",
    "20260513",
    "20260514",
    "20260515",
    "20260518",
    "20260519",
    "20260520",
    "20260521",
    "20260522"
  ];
  return dates.map((tradeDate, index) => {
    const isLimitUp = tradeDate === "20260515";
    const isCurrent = tradeDate === "20260522";
    const trendClose = options.firstClose !== undefined && index === 0 ? options.firstClose : 10 + index * 0.08;
    const close = isLimitUp ? 11.2 : isCurrent ? 11.8 : trendClose;
    return {
      tradeDate,
      code,
      name: code,
      market: "main" as const,
      open: isLimitUp ? 10.1 : isCurrent ? 12 : close - 0.02,
      high: isCurrent ? 12.2 : close + 0.08,
      low: isCurrent ? 11.3 : close - 0.12,
      close,
      volume: isCurrent ? currentVolume : tradeDate === "20260521" ? 1200 : 1000,
      amount: 100_000_000,
      pctChange: isLimitUp ? 10 : isCurrent ? -1.6 : 0.5,
      turnoverRate: 3,
      provider: "test"
    };
  });
}
