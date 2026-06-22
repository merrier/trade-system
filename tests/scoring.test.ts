import { describe, expect, it } from "vitest";
import { createDefaultStrategy, createLimitUpBearishPullbackStrategy, createLimitUpDoubleVolumeBearishStrategy, createLimitUpPullbackStrategy } from "../src/core/defaults.js";
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
        stock("600001", "缩量回调", 11.6, 120_000_000),
        stock("600002", "放量回调", 11.6, 120_000_000),
        stock("600003", "涨幅过热", 11.6, 120_000_000),
        stock("600004", "离均线过远", 12.8, 120_000_000)
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: []
    };
    const bars = [
      ...pullbackBars("600001", 800, { currentClose: 11.6 }),
      ...pullbackBars("600002", 1500, { currentClose: 11.6 }),
      ...pullbackBars("600003", 800, { firstClose: 8.8, currentClose: 11.6 }),
      ...pullbackBars("600004", 800, { firstClose: 10.3, currentOpen: 13.2, currentClose: 12.8, currentLow: 12.7 })
    ];

    const results = rankStocks(dataset, createLimitUpPullbackStrategy(["main"]), "intraday", { dailyBars: bars });

    expect(results.map((item) => item.code)).toEqual(["600001"]);
    expect(results[0].factors.pullbackMatch).toBeGreaterThan(70);
    expect(results[0].factors.twentyDayGain).toBeLessThanOrEqual(25);
    expect(results[0].factors.maDistancePct).toBeLessThanOrEqual(3);
    expect(results[0].factors.bullishMaAlignment).toBe(100);
    expect(results[0].reasons.join(" ")).toContain("阴线缩量");
    expect(results[0].reasons.join(" ")).toContain("贴近");
    expect(results[0].reasons.join(" ")).toContain("均线多头排列");
  });

  it("filters and ranks the limit-up double-volume bearish strategy from daily bars", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260522",
      dataAsOf: "2026-05-22T06:50:00.000Z",
      source: "sample",
      warnings: [],
      stocks: [
        stock("600101", "涨停倍量阴", 11.05, 120_000_000),
        stock("600102", "跌破支撑", 11.05, 120_000_000),
        stock("600103", "今日缩量", 11.05, 120_000_000),
        stock("600104", "成交不足", 11.05, 20_000_000),
        { ...stock("688001", "科创排除", 11.05, 120_000_000), market: "star" as const }
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: []
    };
    const bars = [
      ...doubleVolumeBearishBars("600101"),
      ...doubleVolumeBearishBars("600102", { pullbackLow: 9.8 }),
      ...doubleVolumeBearishBars("600103", { currentVolume: 1000 }),
      ...doubleVolumeBearishBars("600104", { amount: 20_000_000 }),
      ...doubleVolumeBearishBars("688001")
    ];

    const results = rankStocks(dataset, createLimitUpDoubleVolumeBearishStrategy(["main"]), "intraday", { dailyBars: bars });

    expect(results.map((item) => item.code)).toEqual(["600101"]);
    expect(results[0].factors.doubleVolumeBearishMatch).toBeGreaterThan(70);
    expect(results[0].factors.todayPctChange).toBeLessThan(5);
    expect(results[0].factors.twentyDayRangePct).toBeLessThan(45);
    expect(results[0].factors.fiveDayAvgAmount).toBeGreaterThan(30_000_000);
    expect(results[0].reasons.join(" ")).toContain("实体涨停");
    expect(results[0].reasons.join(" ")).toContain("缩量阴线调整");
    expect(results[0].reasons.join(" ")).toContain("站上10日均线");
  });

  it("filters and ranks the limit-up bearish pullback strategy from daily bars", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260522",
      dataAsOf: "2026-05-22T06:50:00.000Z",
      source: "sample",
      warnings: [],
      stocks: [
        stock("600201", "放量阴线回踩", 10.55, 120_000_000),
        stock("600202", "缩量阴线回踩", 10.55, 120_000_000),
        stock("600203", "今日阳线", 11.05, 120_000_000),
        stock("600204", "跌破支撑", 10.55, 120_000_000),
        stock("600205", "成交不足", 10.55, 20_000_000)
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: []
    };
    const bars = [
      ...bearishPullbackBars("600201", { currentVolume: 1800 }),
      ...bearishPullbackBars("600202", { currentVolume: 700 }),
      ...bearishPullbackBars("600203", { currentOpen: 10.7, currentClose: 11.05, currentVolume: 1800 }),
      ...bearishPullbackBars("600204", { pullbackLow: 9.8, currentVolume: 1800 }),
      ...bearishPullbackBars("600205", { amount: 20_000_000, currentVolume: 1800 })
    ];

    const results = rankStocks(dataset, createLimitUpBearishPullbackStrategy(["main"]), "intraday", { dailyBars: bars });

    expect(results.map((item) => item.code)).toEqual(["600201", "600202"]);
    expect(results[0].factors.bearishPullbackMatch).toBeGreaterThan(results[1].factors.bearishPullbackMatch);
    expect(results[0].factors.todayVolumeVsYesterday).toBeGreaterThan(1);
    expect(results[1].factors.todayVolumeVsYesterday).toBeLessThan(1);
    expect(results[0].factors.todayPctChange).toBeLessThan(5);
    expect(results[0].factors.twentyDayRangePct).toBeLessThan(45);
    expect(results[0].factors.fiveDayAvgAmount).toBeGreaterThan(30_000_000);
    expect(results[0].reasons.join(" ")).toContain("今日收阴且未跌破10日均线");
  });

  it("uses intraday snapshot as the current bar when daily cache lacks today", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260522",
      dataAsOf: "2026-05-22T06:50:00.000Z",
      source: "sample",
      warnings: [],
      stocks: [
        {
          ...stock("600101", "盘中涨停倍量阴", 11.05, 120_000_000),
          open: 10.7,
          high: 11.1,
          low: 10.6,
          volume: 1600,
          pctChange: 4.7
        }
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: []
    };
    const bars = doubleVolumeBearishBars("600101").filter((bar) => bar.tradeDate !== "20260522");

    const results = rankStocks(dataset, createLimitUpDoubleVolumeBearishStrategy(["main"]), "intraday", { dailyBars: bars });

    expect(results.map((item) => item.code)).toEqual(["600101"]);
    expect(results[0].factors.todayPctChange).toBe(4.7);
    expect(results[0].reasons.join(" ")).toContain("今日收阳并站上10日均线");
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

function pullbackBars(code: string, currentVolume: number, options: { firstClose?: number; currentOpen?: number; currentClose?: number; currentLow?: number } = {}): DailyBar[] {
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
    const close = isLimitUp ? 11.2 : isCurrent ? options.currentClose ?? 11.8 : trendClose;
    return {
      tradeDate,
      code,
      name: code,
      market: "main" as const,
      open: isLimitUp ? 10.1 : isCurrent ? options.currentOpen ?? 12 : close - 0.02,
      high: isCurrent ? Math.max(options.currentOpen ?? 12, close) + 0.2 : close + 0.08,
      low: isCurrent ? options.currentLow ?? 11.3 : close - 0.12,
      close,
      volume: isCurrent ? currentVolume : tradeDate === "20260521" ? 1200 : 1000,
      amount: 100_000_000,
      pctChange: isLimitUp ? 10 : isCurrent ? -1.6 : 0.5,
      turnoverRate: 3,
      provider: "test"
    };
  });
}

function doubleVolumeBearishBars(code: string, options: { pullbackLow?: number; currentVolume?: number; amount?: number } = {}): DailyBar[] {
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
    const baseClose = 9.4 + index * 0.04;
    const amount = options.amount ?? 50_000_000;
    const bar = {
      tradeDate,
      code,
      name: code,
      market: code.startsWith("688") ? "star" as const : "main" as const,
      open: baseClose - 0.03,
      high: baseClose + 0.08,
      low: baseClose - 0.08,
      close: baseClose,
      volume: 1000,
      amount,
      pctChange: 0.4,
      turnoverRate: 3,
      provider: "test"
    };
    if (tradeDate === "20260515") {
      return { ...bar, open: 10, high: 11.05, low: 9.95, close: 11, volume: 3000, amount: 90_000_000, pctChange: 10 };
    }
    if (tradeDate === "20260518") {
      return { ...bar, open: 11.2, high: 11.25, low: 10.4, close: 10.8, volume: 1800, amount, pctChange: -1.8 };
    }
    if (tradeDate === "20260519") {
      return { ...bar, open: 10.9, high: 10.95, low: 10.2, close: 10.7, volume: 1400, amount, pctChange: -0.9 };
    }
    if (tradeDate === "20260520") {
      return { ...bar, open: 10.8, high: 10.85, low: options.pullbackLow ?? 10.1, close: 10.6, volume: 1200, amount, pctChange: -0.9 };
    }
    if (tradeDate === "20260521") {
      return { ...bar, open: 10.7, high: 10.75, low: 10.2, close: 10.55, volume: 1100, amount, pctChange: -0.5 };
    }
    if (tradeDate === "20260522") {
      return { ...bar, open: 10.7, high: 11.1, low: 10.6, close: 11.05, volume: options.currentVolume ?? 1600, amount: amount + 10_000_000, pctChange: 4.7 };
    }
    return bar;
  });
}

function bearishPullbackBars(code: string, options: { pullbackLow?: number; currentOpen?: number; currentClose?: number; currentVolume?: number; amount?: number } = {}): DailyBar[] {
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
    const baseClose = 9.4 + index * 0.04;
    const amount = options.amount ?? 50_000_000;
    const bar = {
      tradeDate,
      code,
      name: code,
      market: "main" as const,
      open: baseClose - 0.03,
      high: baseClose + 0.08,
      low: baseClose - 0.08,
      close: baseClose,
      volume: 1000,
      amount,
      pctChange: 0.4,
      turnoverRate: 3,
      provider: "test"
    };
    if (tradeDate === "20260515") {
      return { ...bar, open: 10, high: 11.05, low: 9.95, close: 11, volume: 3000, amount: 90_000_000, pctChange: 10 };
    }
    if (tradeDate === "20260518") {
      return { ...bar, open: 11.2, high: 11.25, low: 10.4, close: 10.8, volume: 1800, amount, pctChange: -1.8 };
    }
    if (tradeDate === "20260519") {
      return { ...bar, open: 10.9, high: 10.95, low: 10.2, close: 10.7, volume: 1400, amount, pctChange: -0.9 };
    }
    if (tradeDate === "20260520") {
      return { ...bar, open: 10.8, high: 10.85, low: options.pullbackLow ?? 10.1, close: 10.6, volume: 1200, amount, pctChange: -0.9 };
    }
    if (tradeDate === "20260521") {
      return { ...bar, open: 10.7, high: 10.75, low: 10.2, close: 10.55, volume: 1100, amount, pctChange: -0.5 };
    }
    if (tradeDate === "20260522") {
      const open = options.currentOpen ?? 10.7;
      const close = options.currentClose ?? 10.55;
      return { ...bar, open, high: Math.max(open, close) + 0.05, low: Math.min(open, close) - 0.1, close, volume: options.currentVolume ?? 900, amount: amount + 10_000_000, pctChange: 3.2 };
    }
    return bar;
  });
}
