import { describe, expect, it } from "vitest";
import { buildCloseReportFromDataset, reportArtifactSchema } from "../src/core/reports.js";
import { createSampleDataset } from "../src/data/sampleDataset.js";

describe("reports", () => {
  it("generates schema-valid close report artifacts", async () => {
    const report = await buildCloseReportFromDataset(createSampleDataset("20260506"));

    expect(() => reportArtifactSchema.parse(report)).not.toThrow();
    expect(report.kind).toBe("close");
    expect(report.payload.marketBreadth.total).toBeGreaterThan(0);
    expect(report.pushMessage).toContain("# A股收盘复盘");
    expect(report.pushMessage).toContain("## 市场概览");
    expect(report.pushMessage).toContain("**数据源**");
  });
});
