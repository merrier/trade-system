import { describe, expect, it } from "vitest";
import { enrichDatasetWithSectorMap, type SectorMapRecord } from "../src/data/sectorMap.js";
import type { MarketDataset } from "../src/shared/types.js";

describe("sector map enrichment", () => {
  it("fills stock sectors and rebuilds empty sector snapshots", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260610",
      dataAsOf: "2026-06-10T06:50:00.000Z",
      source: "easyquotation",
      warnings: [],
      stocks: [
        stock("600000", "浦发银行", 2),
        stock("600001", "银行A", 1),
        stock("600002", "银行B", 3)
      ],
      limitUps: [],
      dragonTiger: [],
      sectors: [{ tradeDate: "20260610", name: "未分类", type: "industry", pctChange: 0, inflowAmount: 0, outflowAmount: 0, netInflow: 0, companyCount: 3, limitUpCount: 0, leaderPctChange: 0, heatScore: 0, trend: [] }]
    };
    const map = new Map<string, SectorMapRecord>([
      ["600000", { code: "600000", name: "浦发银行", industry: "银行", concepts: ["中特估"] }],
      ["600001", { code: "600001", name: "银行A", industry: "银行", concepts: ["中特估"] }],
      ["600002", { code: "600002", name: "银行B", industry: "银行", concepts: ["中特估"] }]
    ]);

    const enriched = enrichDatasetWithSectorMap(dataset, map);

    expect(enriched.stocks[0].industry).toBe("银行");
    expect(enriched.stocks[0].concepts).toContain("中特估");
    expect(enriched.sectors.map((item) => `${item.type}:${item.name}`)).toContain("industry:银行");
    expect(enriched.sectors.map((item) => `${item.type}:${item.name}`)).toContain("concept:中特估");
    expect(enriched.warnings[0]).toContain("离线板块映射");
  });
});

function stock(code: string, name: string, pctChange: number) {
  return {
    code,
    name,
    market: "main" as const,
    industry: "",
    concepts: [],
    pctChange,
    turnoverAmount: 100000000,
    turnoverRate: 1,
    volumeRatio: 1,
    close: 10,
    open: 9.8,
    high: 10.2,
    low: 9.7,
    volume: 1000000,
    listedDays: 999,
    mainNetInflow: 0
  };
}
