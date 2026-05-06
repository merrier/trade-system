import { describe, expect, it } from "vitest";
import { createDefaultStrategy } from "../src/core/defaults.js";
import { rankSectors, rankStocks } from "../src/core/scoring.js";
import { evaluateWatchCondition } from "../src/core/watchlist.js";
import { createSampleDataset } from "../src/data/sampleDataset.js";
import { compileWatchConditionLocally } from "../src/core/strategy.js";

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
});
