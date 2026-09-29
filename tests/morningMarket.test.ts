import { afterEach, expect, it, vi } from "vitest";
import { completedMorningQuotes, fetchMorningMarket } from "../src/data/morningMarket.js";
import { fetchUsMarketBrief } from "../src/data/akshareClient.js";
import { buildMorningReport } from "../src/core/reports.js";
import { readReportArtifact, writeReportArtifact } from "../src/jobs/reportArtifacts.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../src/data/akshareClient.js", () => ({ fetchUsMarketBrief: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("excludes current-day, stale, missing and invalid prices", () => {
  const quote = { symbol: "test", name: "test", price: 100, pctChange: 1 };
  expect(completedMorningQuotes([
    { ...quote, date: "2026-09-28" }, { ...quote, date: "2026-09-29" },
    { ...quote, date: "2026-09-01" }, { ...quote, date: "2026-09-28", price: NaN }, quote
  ], "20260929")).toEqual([{ ...quote, date: "2026-09-28" }]);
});

it("keeps Fuyao separate when overseas fails and calculates change from completed sessions", async () => {
  vi.mocked(fetchUsMarketBrief).mockRejectedValue(new Error("rate limit"));
  vi.stubEnv("FUYAO_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { item: [
    { timestamp: Date.parse("2026-09-28T00:00:00+08:00"), close_price: 110 },
    { timestamp: Date.parse("2026-09-24T00:00:00+08:00"), close_price: 100 },
    { timestamp: Date.parse("2026-09-29T00:00:00+08:00"), close_price: 999 }
  ] } }) }));
  const result = await fetchMorningMarket("20260929");
  expect(result.brief.indices).toEqual([]);
  expect(result.brief.domesticFutures).toHaveLength(2);
  expect(result.brief.domesticFutures![0].price).toBe(110);
  expect(result.brief.domesticFutures![0].pctChange).toBeCloseTo(10);
  expect(result.warnings.join(" ")).toContain("外盘数据源");
  expect(result.provider).toBe("fuyao");
}, 10000);

it("does not generate a report when every source fails", async () => {
  vi.mocked(fetchUsMarketBrief).mockRejectedValue(new Error("offline"));
  vi.stubEnv("FUYAO_API_KEY", "");
  await expect(fetchMorningMarket("20260929")).rejects.toThrow("未生成空报告");
});

it("stops Fuyao requests immediately on rate limit", async () => {
  vi.mocked(fetchUsMarketBrief).mockRejectedValue(new Error("offline"));
  vi.stubEnv("FUYAO_API_KEY", "test");
  const fetch = vi.fn().mockResolvedValue({ status: 429, json: async () => ({ code: 4001 }) });
  vi.stubGlobal("fetch", fetch);
  await expect(fetchMorningMarket("20260929")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("saves the A-share report date separately from the previous overseas session", async () => {
  vi.stubEnv("FUYAO_API_KEY", "");
  vi.stubEnv("HERMES_ANALYSIS_COMMAND", "");
  vi.mocked(fetchUsMarketBrief).mockResolvedValue({ provider: "yfinance", warnings: [], runs: [], brief: {
    asOf: "2026-09-29T01:00:00Z", previousSession: "20260928",
    indices: [{ symbol: "^IXIC", name: "纳指", close: 20000, pctChange: 1, date: "2026-09-28", source: "yfinance" }],
    futures: [], currencies: [], sectors: [], commodities: []
  } });
  const report = await buildMorningReport(undefined, "20260929");
  expect(report.tradeDate).toBe("20260929");
  expect(report.payload.brief.previousSession).toBe("2026-09-28");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "morning-report-"));
  try {
    await writeReportArtifact(root, report);
    expect((await readReportArtifact(root, "morning"))?.tradeDate).toBe("20260929");
    expect(await fs.readdir(path.join(root, "reports/morning"))).toEqual(["20260929.json", "latest.json"]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
