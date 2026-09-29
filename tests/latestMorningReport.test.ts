import { afterEach, expect, it, vi } from "vitest";
import { readReportArtifact } from "../src/jobs/reportArtifacts.js";
import { readLatestMorningReport } from "../src/jobs/latestMorningReport.js";
import type { ReportArtifact } from "../src/shared/types.js";

vi.mock("../src/jobs/reportArtifacts.js", () => ({ readReportArtifact: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("replaces an old local report with the published version, deduplicates requests and falls back safely", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T06:00:00Z"));
  const local: ReportArtifact = { id: "local", kind: "morning", tradeDate: "20260929", generatedAt: "2026-09-29T05:34:00Z", dataAsOf: "2026-09-29T05:34:00Z", provider: "fuyao", payload: {}, warnings: [], analysis: "", pushMessage: "" };
  const cloud = { ...local, id: "cloud", generatedAt: "2026-09-29T05:42:00Z", provider: "yfinance + fuyao" };
  vi.mocked(readReportArtifact).mockResolvedValue(local);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => cloud });
  vi.stubGlobal("fetch", fetch);
  const reports = await Promise.all([readLatestMorningReport(["data"]), readLatestMorningReport(["data"])]);
  expect(reports.map((item) => item?.id)).toEqual(["cloud", "cloud"]);
  expect(fetch).toHaveBeenCalledTimes(1);
  await readLatestMorningReport(["data"]);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(61000);
  fetch.mockRejectedValue(new Error("offline"));
  expect((await readLatestMorningReport(["data"]))?.id).toBe("cloud");
  vi.mocked(readReportArtifact).mockResolvedValue({ ...local, id: "new-local", tradeDate: "20260930" });
  expect((await readLatestMorningReport(["data"]))?.id).toBe("new-local");
  vi.advanceTimersByTime(61000);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ ...cloud, kind: "close", tradeDate: "20261001" }) });
  expect((await readLatestMorningReport(["data"]))?.id).toBe("new-local");
});
