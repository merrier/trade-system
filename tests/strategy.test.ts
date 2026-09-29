import { readFileSync } from "node:fs";
import { compileStrategy } from "../src/core/deepseek.js";
import { MA5_PULLBACK_PROMPT, createMa5PullbackStrategy } from "../src/core/defaults.js";
import { describe, expect, it, vi } from "vitest";
import { compileStrategyLocally, compileWatchConditionLocally } from "../src/core/strategy.js";

describe("strategy compiler", () => {
  it("compiles natural language into a safe DSL", () => {
    const result = compileStrategyLocally("主板里找连板强、龙虎榜净买入高、板块前三、炸板少的短线票", ["main"], "short_term");

    expect(result.dsl.markets).toEqual(["main"]);
    expect(result.dsl.include).toContain("连板");
    expect(result.dsl.include).toContain("龙虎榜");
    expect(result.dsl.filters.excludeST).toBe(true);
    expect(result.dsl.filters.sectorTopN).toBe(3);
  });

  it("compiles watch prompts into templates", () => {
    const dsl = compileWatchConditionLocally("所属概念进入前三且个股放量突破5日线", ["main", "gem"]);

    expect(dsl.templates).toContain("sector_top_n");
    expect(dsl.templates).toContain("volume_breakout");
    expect(dsl.templates).toContain("ma_breakout");
    expect(dsl.params.sectorTopN).toBe(3);
  });

  it("remembers the limit-up pullback strategy template", () => {
    const result = compileStrategyLocally("涨停回调策略，最近10天内有涨停，今天阴线缩量，没跌破涨停价，收盘站上五日线或十日线，最近20天涨幅不要超过25%，呈多头排列", ["main"], "short_term");

    expect(result.dsl.strategyTemplates).toContain("limit_up_pullback");
    expect(result.dsl.filters.recentLimitUpDays).toBe(10);
    expect(result.dsl.filters.requireBearishCandle).toBe(true);
    expect(result.dsl.filters.requireHoldLimitUpPrice).toBe(true);
    expect(result.dsl.filters.requireAboveMa).toBe("ma5_or_ma10");
    expect(result.dsl.filters.maxMaDistancePct).toBe(3);
    expect(result.dsl.filters.requireVolumeContraction).toBe(true);
    expect(result.dsl.filters.maxTwentyDayGainPct).toBe(25);
    expect(result.dsl.filters.requireBullishMaAlignment).toBe(true);
  });

  it("compiles the limit-up double-volume bearish strategy template", () => {
    const result = compileStrategyLocally("涨停倍量阴：近5日实体涨停，涨停后缩量阴线调整，今日收阳并站上10日线", ["main", "gem"], "short_term");

    expect(result.dsl.markets).toEqual(["main"]);
    expect(result.dsl.strategyTemplates).toContain("limit_up_double_volume_bearish");
    expect(result.dsl.filters.recentLimitUpDays).toBe(5);
    expect(result.dsl.markets).toEqual(["main"]);
    expect(result.dsl.filters.requireSolidLimitUp).toBe(true);
    expect(result.dsl.filters.requirePostLimitUpBearishPullback).toBe(true);
    expect(result.dsl.filters.requirePullbackVolumeContraction).toBe(true);
    expect(result.dsl.filters.requirePullbackLowAboveLimitOpen).toBe(true);
    expect(result.dsl.filters.requireBullishClose).toBe(true);
    expect(result.dsl.filters.requireAboveMa).toBe("ma10");
    expect(result.dsl.filters.requireVolumeExpansionVsYesterday).toBe(true);
    expect(result.dsl.filters.maxTodayPctChange).toBe(5);
    expect(result.dsl.filters.maxTwentyDayRangePct).toBe(45);
    expect(result.dsl.filters.minPrice).toBe(5);
    expect(result.dsl.filters.minFiveDayAvgAmount).toBe(30_000_000);
  });

  it("compiles the limit-up bearish pullback strategy template", () => {
    const result = compileStrategyLocally("涨停回踩阴线策略：主板股票近5日出现实体涨停，涨停后有阴线调整，今日收阴线但不破10日线", ["main", "gem"], "short_term");

    expect(result.dsl.markets).toEqual(["main"]);
    expect(result.dsl.strategyTemplates).toContain("limit_up_bearish_pullback");
    expect(result.dsl.filters.recentLimitUpDays).toBe(5);
    expect(result.dsl.filters.requireSolidLimitUp).toBe(true);
    expect(result.dsl.filters.requirePostLimitUpBearishPullback).toBe(true);
    expect(result.dsl.filters.requirePullbackVolumeContraction).toBe(false);
    expect(result.dsl.filters.requirePullbackLowAboveLimitOpen).toBe(true);
    expect(result.dsl.filters.requireBearishCandle).toBe(true);
    expect(result.dsl.filters.requireAboveMa).toBe("ma10");
    expect(result.dsl.filters.maxMaDistancePct).toBeUndefined();
    expect(result.dsl.filters.requireVolumeExpansionVsYesterday).toBe(false);
    expect(result.dsl.filters.maxTodayPctChange).toBe(5);
    expect(result.dsl.filters.maxTwentyDayGainPct).toBeUndefined();
    expect(result.dsl.filters.maxTwentyDayRangePct).toBe(45);
    expect(result.dsl.filters.minPrice).toBe(5);
    expect(result.dsl.filters.minFiveDayAvgAmount).toBe(30_000_000);
  });

  it("compiles the MA5 pullback strategy template", () => {
    const result = compileStrategyLocally("沿五日线回调策略：主板股票，今日14:50最新价在5日线上方，距离5日线0%到2%，今日最低价回踩五日线但未有效跌破，五日线止损", ["main", "gem"], "short_term");

    expect(result.dsl.markets).toEqual(["main"]);
    expect(result.dsl.strategyTemplates).toContain("ma5_pullback");
    expect(result.dsl.filters.requireMa5RisingDays).toBe(3);
    expect(result.dsl.filters.minCloseAboveMa5Days).toBe(5);
    expect(result.dsl.filters.requireBearishCandle).toBe(true);
    expect(result.dsl.filters.maxMaDistancePct).toBe(2);
    expect(result.dsl.filters.maxLowMa5DistancePct).toBe(1.5);
    expect(result.dsl.filters.maxIntradayBreakMa5Pct).toBe(0.8);
    expect(result.dsl.filters.minTodayPctChange).toBe(-2);
    expect(result.dsl.filters.maxTodayPctChange).toBe(2.5);
    expect(result.dsl.filters.maxFiveDayRangePct).toBe(15);
    expect(result.dsl.filters.maxTwentyDayRangePct).toBe(35);
    expect(result.dsl.filters.minVolumeRatio).toBe(0.7);
    expect(result.dsl.filters.maxVolumeRatio).toBe(1.8);
  });

  it("does not expand markets for excluded board names", () => {
    const result = compileStrategyLocally("主板股票，非ST，非科创板，非北交所，非创业板", ["main"], "short_term");

    expect(result.dsl.markets).toEqual(["main"]);
  });
});


it("uses one MA5 default in scheduled CI and keeps its thresholds when DeepSeek is configured", async () => {
  const workflow = readFileSync(new URL("../.github/workflows/intraday-selection-1450.yml", import.meta.url), "utf8");
  expect(workflow).not.toContain("INTRADAY_STRATEGY_PROMPT:");
  expect(workflow).toContain("ref: dev");
  expect(workflow).toContain("src/jobs/scheduledIntraday.ts");
  vi.stubEnv("INTRADAY_STRATEGY_PROMPT", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    const { defaultStrategyPrompt } = await import("../src/jobs/reportArtifacts.js");
    expect(defaultStrategyPrompt).toBe(MA5_PULLBACK_PROMPT);
    const result = await compileStrategy(defaultStrategyPrompt, ["main"], "short_term");
    expect(result.dsl.strategyTemplates).toEqual(["ma5_pullback"]);
    expect(result.dsl.filters).toEqual(createMa5PullbackStrategy().filters);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
