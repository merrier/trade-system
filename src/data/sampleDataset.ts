import type { MarketDataset } from "../shared/types.js";

export function createSampleDataset(tradeDate = new Date().toISOString().slice(0, 10).replaceAll("-", "")): MarketDataset {
  const dataAsOf = new Date().toISOString();

  return {
    tradeDate,
    dataAsOf,
    source: "sample",
    warnings: ["当前展示的是内置样例数据，不代表真实市场。"],
    stocks: [
      {
        code: "600519",
        name: "贵州茅台",
        market: "main",
        industry: "白酒",
        concepts: ["消费", "中字头"],
        pctChange: 2.1,
        turnoverAmount: 3_600_000_000,
        turnoverRate: 0.8,
        volumeRatio: 1.2,
        close: 1710,
        ma5: 1688,
        listedDays: 8000,
        mainNetInflow: 180_000_000
      },
      {
        code: "603000",
        name: "人民网",
        market: "main",
        industry: "传媒",
        concepts: ["AI应用", "数据要素"],
        pctChange: 10,
        turnoverAmount: 1_180_000_000,
        turnoverRate: 12.4,
        volumeRatio: 2.8,
        close: 38.8,
        ma5: 35.2,
        listedDays: 3000,
        mainNetInflow: 126_000_000
      },
      {
        code: "601127",
        name: "赛力斯",
        market: "main",
        industry: "汽车整车",
        concepts: ["智能驾驶", "新能源汽车"],
        pctChange: 9.99,
        turnoverAmount: 4_800_000_000,
        turnoverRate: 8.7,
        volumeRatio: 2.2,
        close: 97.4,
        ma5: 91.6,
        listedDays: 2500,
        mainNetInflow: 320_000_000
      },
      {
        code: "000977",
        name: "浪潮信息",
        market: "main",
        industry: "计算机设备",
        concepts: ["算力", "AI服务器"],
        pctChange: 6.4,
        turnoverAmount: 5_200_000_000,
        turnoverRate: 9.1,
        volumeRatio: 1.9,
        close: 48.6,
        ma5: 46.1,
        listedDays: 5200,
        mainNetInflow: 260_000_000
      },
      {
        code: "300750",
        name: "宁德时代",
        market: "gem",
        industry: "电池",
        concepts: ["新能源汽车", "储能"],
        pctChange: 3.6,
        turnoverAmount: 6_800_000_000,
        turnoverRate: 2.2,
        volumeRatio: 1.4,
        close: 214.2,
        ma5: 209.5,
        listedDays: 2300,
        mainNetInflow: 410_000_000
      },
      {
        code: "002230",
        name: "科大讯飞",
        market: "main",
        industry: "软件开发",
        concepts: ["AI应用", "教育信息化"],
        pctChange: 7.2,
        turnoverAmount: 3_100_000_000,
        turnoverRate: 5.9,
        volumeRatio: 2.1,
        close: 56.4,
        ma5: 53.2,
        listedDays: 4300,
        mainNetInflow: 188_000_000
      }
    ],
    limitUps: [
      {
        tradeDate,
        code: "603000",
        name: "人民网",
        market: "main",
        industry: "传媒",
        concepts: ["AI应用", "数据要素"],
        consecutive: 3,
        firstLimitTime: "09:43:12",
        lastLimitTime: "13:18:09",
        openCount: 1,
        sealedAmount: 620_000_000,
        turnoverRate: 12.4,
        pctChange: 10
      },
      {
        tradeDate,
        code: "601127",
        name: "赛力斯",
        market: "main",
        industry: "汽车整车",
        concepts: ["智能驾驶", "新能源汽车"],
        consecutive: 2,
        firstLimitTime: "10:12:48",
        lastLimitTime: "10:41:02",
        openCount: 0,
        sealedAmount: 880_000_000,
        turnoverRate: 8.7,
        pctChange: 9.99
      }
    ],
    dragonTiger: [
      {
        tradeDate,
        code: "603000",
        name: "人民网",
        reason: "日涨幅偏离值达7%",
        buyAmount: 510_000_000,
        sellAmount: 230_000_000,
        netAmount: 280_000_000,
        seats: [
          { name: "机构专用", side: "buy", amount: 180_000_000 },
          { name: "沪股通专用", side: "buy", amount: 110_000_000 }
        ]
      },
      {
        tradeDate,
        code: "601127",
        name: "赛力斯",
        reason: "日涨幅偏离值达7%",
        buyAmount: 680_000_000,
        sellAmount: 360_000_000,
        netAmount: 320_000_000,
        seats: [{ name: "机构专用", side: "buy", amount: 220_000_000 }]
      }
    ],
    sectors: [
      {
        tradeDate,
        name: "AI应用",
        type: "concept",
        pctChange: 5.8,
        inflowAmount: 14_200_000_000,
        outflowAmount: 9_600_000_000,
        netInflow: 4_600_000_000,
        companyCount: 78,
        limitUpCount: 9,
        leaderCode: "603000",
        leaderName: "人民网",
        leaderPctChange: 10,
        heatScore: 96,
        trend: [1.1, 2.3, 3.8, 5.8]
      },
      {
        tradeDate,
        name: "智能驾驶",
        type: "concept",
        pctChange: 4.6,
        inflowAmount: 13_800_000_000,
        outflowAmount: 10_100_000_000,
        netInflow: 3_700_000_000,
        companyCount: 64,
        limitUpCount: 7,
        leaderCode: "601127",
        leaderName: "赛力斯",
        leaderPctChange: 9.99,
        heatScore: 91,
        trend: [0.6, 1.4, 2.8, 4.6]
      },
      {
        tradeDate,
        name: "传媒",
        type: "industry",
        pctChange: 3.9,
        inflowAmount: 7_300_000_000,
        outflowAmount: 4_900_000_000,
        netInflow: 2_400_000_000,
        companyCount: 42,
        limitUpCount: 5,
        leaderCode: "603000",
        leaderName: "人民网",
        leaderPctChange: 10,
        heatScore: 84,
        trend: [0.2, 1.2, 2.4, 3.9]
      },
      {
        tradeDate,
        name: "汽车整车",
        type: "industry",
        pctChange: 3.4,
        inflowAmount: 8_400_000_000,
        outflowAmount: 6_500_000_000,
        netInflow: 1_900_000_000,
        companyCount: 24,
        limitUpCount: 3,
        leaderCode: "601127",
        leaderName: "赛力斯",
        leaderPctChange: 9.99,
        heatScore: 80,
        trend: [0.4, 1.1, 2.2, 3.4]
      }
    ]
  };
}
