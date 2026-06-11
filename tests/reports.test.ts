import { describe, expect, it } from "vitest";
import { createDefaultStrategy } from "../src/core/defaults.js";
import { buildCloseReportFromDataset, formatReportMarkdown, reportArtifactSchema } from "../src/core/reports.js";
import { createSampleDataset } from "../src/data/sampleDataset.js";
import type { IntradaySelectionReportPayload, ReportArtifact } from "../src/shared/types.js";

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

  it("formats intraday recommendations as a markdown table", () => {
    const report: ReportArtifact<IntradaySelectionReportPayload> = {
      id: "intraday-selection-20260610-test",
      kind: "intraday-selection",
      tradeDate: "20260610",
      dataAsOf: "2026-06-10T06:50:00.000Z",
      provider: "easyquotation",
      warnings: [],
      payload: {
        strategy: {
          prompt: "涨停倍量阴策略",
          compiledDsl: createDefaultStrategy("short_term", ["main"]),
          warnings: [],
          unsupported: [],
          compiledAt: "2026-06-10T06:50:00.000Z",
          engine: "local"
        },
        recommendations: [
          {
            rank: 1,
            code: "001309",
            name: "德明利",
            market: "main",
            score: 88.8,
            confidence: 72,
            reasons: ["近5日出现实体涨停", "今日收阳站上10日线"],
            risks: ["盘中推荐为参考结果"],
            factors: {},
            context: {
              limitUpReason: "AI PC+存储芯片",
              sectors: ["半导体", "AI PC"],
              sectorFlowRank: {
                name: "半导体",
                type: "industry",
                rank: 3,
                netInflow: 2_400_000_000
              },
              industryLeader: {
                status: "likely",
                reason: "存储模组+自研主控细分头部"
              },
              uniqueness: {
                status: "high",
                reason: "A股稀缺自研主控+模组一体化"
              }
            },
            dataAsOf: "2026-06-10T06:50:00.000Z"
          }
        ],
        sectorFlowLeaders: [
          {
            rank: 1,
            name: "AI应用",
            type: "concept",
            netInflow: 4_600_000_000,
            pctChange: 5.8,
            limitUpCount: 9,
            leaderName: "人民网",
            leaderPctChange: 10
          }
        ],
        factorLegend: {}
      },
      analysis: "测试摘要",
      pushMessage: "",
      generatedAt: "2026-06-10T06:50:00.000Z"
    };

    const markdown = formatReportMarkdown(report);

    expect(markdown).toContain("| 排名 | 股票 | 分数 | 置信度 | 板块 | 板块资金排名 | 涨停原因 | 龙头 | 唯一性 |");
    expect(markdown).toContain("| 1 | 001309 德明利 | 88.8 | 72 | 半导体、AI PC | 半导体 #3（24 亿） | AI PC+存储芯片 | 存储模组+自研主控细分头部 | A股稀缺自研主控+模组一体化 |");
    expect(markdown).toContain("## 补充说明");
    expect(markdown).toContain("形态：近5日出现实体涨停；今日收阳站上10日线");
    expect(markdown).toContain("风险：盘中推荐为参考结果");
    expect(markdown).toContain("## 主力净流入板块 Top 5");
    expect(markdown).toContain("| 排名 | 板块 | 类型 | 主力净流入 | 涨幅 | 涨停数 | 领涨股 |");
    expect(markdown).toContain("| 1 | AI应用 | 概念 | 46 亿 | +5.8% | 9 | 人民网 +10% |");
  });
});
