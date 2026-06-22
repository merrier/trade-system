import { describe, expect, it } from "vitest";
import { createDefaultStrategy } from "../src/core/defaults.js";
import { buildCloseReportFromDataset, formatReportMarkdown, rankSectorFlows, reportArtifactSchema } from "../src/core/reports.js";
import { createSampleDataset } from "../src/data/sampleDataset.js";
import type { IntradaySelectionReportPayload, MarketDataset, ReportArtifact } from "../src/shared/types.js";

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

  it("formats intraday recommendations as concise markdown items", () => {
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
        monitorPool: [
          {
            code: "600001",
            name: "趋势样本",
            market: "main",
            thesis: "观察回踩5日线后的承接",
            dataAsOf: "2026-06-10T06:50:00.000Z",
            price: 13.35,
            pctChange: 1.2,
            sectors: ["半导体", "AI PC"],
            trend: {
              status: "uptrend",
              reason: "已进入上升趋势：价在MA5上方，MA5 13 >= MA10 12.6 >= MA20 11.8"
            },
            ma: {
              ma5: 13,
              ma10: 12.6,
              ma20: 11.8,
              ma5DistancePct: 1.2,
              ma10DistancePct: 5.95,
              pullbackToMa5: "held",
              reason: "已回踩并守住5日线：最低 12.98，MA5 13"
            },
            volume: {
              ratioVsPrevious: 1.2,
              reason: "今日成交量为昨日 120%"
            },
            reasons: ["已进入上升趋势", "已回踩并守住5日线"],
            risks: []
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

    expect(markdown).toContain("## 推荐关注");
    expect(markdown).toContain("1. **德明利**（置信度 72）");
    expect(markdown).toContain("- 板块：半导体、AI PC；板块资金：半导体 #3（24 亿）");
    expect(markdown).toContain("- 最近涨停原因：AI PC+存储芯片");
    expect(markdown).toContain("- 唯一性：A股稀缺自研主控+模组一体化");
    expect(markdown).toContain("- 龙头描述：存储模组+自研主控细分头部");
    expect(markdown).toContain("- 形态：近5日出现实体涨停；今日收阳站上10日线；风险：盘中推荐为参考结果");
    expect(markdown).not.toContain("| 排名 | 股票 | 分数");
    expect(markdown).not.toContain("001309 德明利");
    expect(markdown).not.toContain("88.8");
    expect(markdown).toContain("## 监控池分析");
    expect(markdown).toContain("1. **趋势样本**");
    expect(markdown).toContain("- 趋势：已进入上升趋势");
    expect(markdown).toContain("- 5日线：已回踩并守住5日线");
    expect(markdown).toContain("- 观察理由：观察回踩5日线后的承接");
    expect(markdown).toContain("## 主力净流入板块 Top 5");
    expect(markdown).toContain("| 排名 | 板块 | 类型 | 主力净流入 | 涨幅 | 涨停数 | 领涨股 |");
    expect(markdown).toContain("| 1 | AI应用 | 概念 | 46 亿 | +5.8% | 9 | 人民网 +10% |");
  });

  it("uses the first limit-up stock as sector flow leader", () => {
    const dataset: MarketDataset = {
      tradeDate: "20260610",
      dataAsOf: "2026-06-10T06:50:00.000Z",
      source: "sample",
      warnings: [],
      stocks: [
        stock("600001", "涨幅龙头", 10.03, "AI应用"),
        stock("600002", "首封样本", 9.99, "AI应用")
      ],
      limitUps: [
        limitUp("600001", "涨幅龙头", 10.03, "10:12:00"),
        limitUp("600002", "首封样本", 9.99, "09:35:00")
      ],
      dragonTiger: [],
      sectors: [
        {
          tradeDate: "20260610",
          name: "AI应用",
          type: "concept",
          pctChange: 5.8,
          inflowAmount: 1_000_000_000,
          outflowAmount: 500_000_000,
          netInflow: 500_000_000,
          companyCount: 2,
          limitUpCount: 2,
          leaderCode: "600001",
          leaderName: "涨幅龙头",
          leaderPctChange: 10.03,
          heatScore: 90,
          trend: []
        }
      ]
    };

    const [sector] = rankSectorFlows(dataset);

    expect(sector.leaderName).toBe("首封样本");
    expect(sector.leaderPctChange).toBe(9.99);
  });
});

function stock(code: string, name: string, pctChange: number, concept: string) {
  return {
    code,
    name,
    market: "main" as const,
    industry: "传媒",
    concepts: [concept],
    pctChange,
    turnoverAmount: 100_000_000,
    turnoverRate: 2,
    volumeRatio: 1.2,
    close: 10,
    listedDays: 999
  };
}

function limitUp(code: string, name: string, pctChange: number, firstLimitTime: string) {
  return {
    tradeDate: "20260610",
    code,
    name,
    market: "main" as const,
    industry: "",
    concepts: [],
    consecutive: 1,
    firstLimitTime,
    lastLimitTime: firstLimitTime,
    openCount: 0,
    sealedAmount: 0,
    turnoverRate: 2,
    pctChange
  };
}
