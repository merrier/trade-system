import { expect, it, vi } from "vitest";
import * as preparation from "../src/data/intradayPreparation.js";
import { fetchCloseMarket } from "../src/data/closeMarket.js";
import { buildCloseReportFromDataset } from "../src/core/reports.js";

it("counts the full main board separately from the limit-up pool and rejects stale or incomplete quotes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T16:00:00+08:00"));
  vi.spyOn(preparation, "mainStockCatalog").mockResolvedValue([
    { ticker: "600000", name: "A", list_date: "2000-01-01" },
    { ticker: "600001", name: "B", list_date: "2000-01-01" },
    { ticker: "001246", name: "Future listing", list_date: "2026-09-30" }
  ]);
  const data = { timestamp: Date.now(), total: 2, item: [
    { ticker: "600000", last_price: 11, prev_price: 10, turnover: 2000, volume: 200 },
    { ticker: "600001", last_price: 9, prev_price: 10, turnover: 3000, volume: 300 }
  ] };
  vi.spyOn(preparation, "fuyao").mockImplementation(async endpoint => {
    if (endpoint === "/api/a-share/prices/snapshot") return data;
    if (endpoint.endsWith("limit-up-pool")) return { timestamp: Date.now(), pagination: { pages: 1 }, item: [{ ticker: "600000" }, { ticker: "300001" }] };
    if (endpoint.endsWith("limit-down-pool")) return { timestamp: Date.now(), pagination: { pages: 1 }, item: [{ ticker: "600001" }] };
    if (endpoint.includes("catalog")) return { item: [{ thscode: "881101.TI", name: "Industry" }] };
    return { timestamp: Date.now(), item: [{ thscode: "881101.TI", price_change_ratio_pct: -2 }] };
  });
  try {
    const report = await buildCloseReportFromDataset(await fetchCloseMarket("20260929"));
    expect(report.payload.marketBreadth).toMatchObject({ total: 2, up: 1, down: 1, turnoverAmount: 5000, limitUp: 1, limitDown: 1 });
    expect(report.payload.industryPerformance).toEqual([{ name: "Industry", pctChange: -2 }]);
    expect(report.dataAsOf).toBe(new Date().toISOString());
    expect(report.payload.recommendations).toEqual([]);
    data.item.pop();
    data.total = 1;
    await expect(fetchCloseMarket("20260929")).rejects.toThrow("覆盖不完整");
    data.timestamp -= 86400000;
    await expect(fetchCloseMarket("20260929")).rejects.toThrow("未获取到指定交易日");
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});
