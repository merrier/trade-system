import { describe, expect, it } from "vitest";
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
});
