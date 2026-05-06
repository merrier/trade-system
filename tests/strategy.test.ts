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
});
