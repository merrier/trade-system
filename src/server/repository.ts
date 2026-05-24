import type { PrismaClient } from "@prisma/client";
import { createDefaultStrategy } from "../core/defaults.js";
import { rankSectors, rankStocks } from "../core/scoring.js";
import { attachRecommendation, evaluateWatchCondition } from "../core/watchlist.js";
import { fetchMarketDataset } from "../data/akshareClient.js";
import { createSampleDataset } from "../data/sampleDataset.js";
import type { DailyBar, MarketDataset, RecommendationResult, RunMode, StrategyDsl, WatchConditionDsl } from "../shared/types.js";
import { fromJsonText, toJsonText } from "./json.js";

export async function persistMarketDataset(prisma: PrismaClient, dataset: MarketDataset): Promise<void> {
  await prisma.tradingDay.upsert({
    where: { tradeDate: dataset.tradeDate },
    update: { status: "closed" },
    create: { tradeDate: dataset.tradeDate, status: "closed" }
  });

  await prisma.$transaction([
    prisma.limitUpRecord.deleteMany({ where: { tradeDate: dataset.tradeDate } }),
    prisma.dragonTigerRecord.deleteMany({ where: { tradeDate: dataset.tradeDate } }),
    prisma.sectorRecord.deleteMany({ where: { tradeDate: dataset.tradeDate } })
  ]);

  for (const stock of dataset.stocks) {
    await prisma.stock.upsert({
      where: { code: stock.code },
      update: {
        name: stock.name,
        market: stock.market,
        industry: stock.industry,
        concepts: toJsonText(stock.concepts),
        isST: Boolean(stock.isST),
        isSuspended: Boolean(stock.isSuspended)
      },
      create: {
        code: stock.code,
        name: stock.name,
        market: stock.market,
        industry: stock.industry,
        concepts: toJsonText(stock.concepts),
        isST: Boolean(stock.isST),
        isSuspended: Boolean(stock.isSuspended)
      }
    });
  }

  for (const item of dataset.limitUps) {
    const strengthScore = Math.min(100, item.consecutive * 20 + (item.openCount === 0 ? 20 : 8) + Math.min(30, item.sealedAmount / 30_000_000));
    await prisma.limitUpRecord.upsert({
      where: { tradeDate_code: { tradeDate: item.tradeDate, code: item.code } },
      update: {
        name: item.name,
        market: item.market,
        industry: item.industry,
        concepts: toJsonText(item.concepts),
        consecutive: item.consecutive,
        firstLimitTime: item.firstLimitTime,
        lastLimitTime: item.lastLimitTime,
        openCount: item.openCount,
        sealedAmount: item.sealedAmount,
        turnoverRate: item.turnoverRate,
        pctChange: item.pctChange,
        strengthScore
      },
      create: {
        tradeDate: item.tradeDate,
        code: item.code,
        name: item.name,
        market: item.market,
        industry: item.industry,
        concepts: toJsonText(item.concepts),
        consecutive: item.consecutive,
        firstLimitTime: item.firstLimitTime,
        lastLimitTime: item.lastLimitTime,
        openCount: item.openCount,
        sealedAmount: item.sealedAmount,
        turnoverRate: item.turnoverRate,
        pctChange: item.pctChange,
        strengthScore
      }
    });
  }

  for (const item of dataset.dragonTiger) {
    await prisma.dragonTigerRecord.upsert({
      where: { tradeDate_code: { tradeDate: item.tradeDate, code: item.code } },
      update: {
        name: item.name,
        reason: item.reason,
        buyAmount: item.buyAmount,
        sellAmount: item.sellAmount,
        netAmount: item.netAmount,
        seats: toJsonText(item.seats)
      },
      create: {
        tradeDate: item.tradeDate,
        code: item.code,
        name: item.name,
        reason: item.reason,
        buyAmount: item.buyAmount,
        sellAmount: item.sellAmount,
        netAmount: item.netAmount,
        seats: toJsonText(item.seats)
      }
    });
  }

  const rankedSectors = rankSectors(dataset);
  for (const item of rankedSectors) {
    await prisma.sectorRecord.upsert({
      where: { tradeDate_name_type: { tradeDate: item.tradeDate, name: item.name, type: item.type } },
      update: {
        pctChange: item.pctChange,
        inflowAmount: item.inflowAmount,
        outflowAmount: item.outflowAmount,
        netInflow: item.netInflow,
        companyCount: item.companyCount,
        limitUpCount: item.limitUpCount,
        leaderCode: item.leaderCode,
        leaderName: item.leaderName,
        leaderPctChange: item.leaderPctChange,
        heatScore: item.heatScore,
        trend: toJsonText(item.trend)
      },
      create: {
        tradeDate: item.tradeDate,
        name: item.name,
        type: item.type,
        pctChange: item.pctChange,
        inflowAmount: item.inflowAmount,
        outflowAmount: item.outflowAmount,
        netInflow: item.netInflow,
        companyCount: item.companyCount,
        limitUpCount: item.limitUpCount,
        leaderCode: item.leaderCode,
        leaderName: item.leaderName,
        leaderPctChange: item.leaderPctChange,
        heatScore: item.heatScore,
        trend: toJsonText(item.trend)
      }
    });
  }
}

export async function runRecommendation(
  prisma: PrismaClient,
  dataset: MarketDataset,
  dsl: StrategyDsl,
  mode: RunMode,
  prompt?: string,
  strategyId?: string,
  options: { dailyBars?: DailyBar[] } = {}
): Promise<{ runId: string; results: RecommendationResult[] }> {
  const results = rankStocks(dataset, dsl, mode, { dailyBars: options.dailyBars });
  const run = await prisma.recommendationRun.create({
    data: {
      tradeDate: dataset.tradeDate,
      mode,
      source: dataset.source,
      strategyId,
      prompt,
      dataAsOf: new Date(dataset.dataAsOf)
    }
  });

  for (const result of results) {
    await prisma.recommendation.create({
      data: {
        runId: run.id,
        tradeDate: dataset.tradeDate,
        mode,
        rank: result.rank,
        code: result.code,
        name: result.name,
        market: result.market,
        score: result.score,
        confidence: result.confidence,
        reasons: toJsonText(result.reasons),
        risks: toJsonText(result.risks),
        factors: toJsonText(result.factors),
        dataAsOf: new Date(result.dataAsOf)
      }
    });
  }

  return { runId: run.id, results };
}

export async function runPostCloseIngest(prisma: PrismaClient, tradeDate?: string) {
  const dataset = await fetchMarketDataset("post_close", tradeDate);
  await persistMarketDataset(prisma, dataset);
  const dsl = createDefaultStrategy("short_term", ["main"]);
  const recommendation = await runRecommendation(prisma, dataset, dsl, "post_close", "默认盘后短线强势策略");
  const triggers = await evaluateActiveWatchlist(prisma, dataset);
  return { dataset, recommendation, triggers };
}

export async function latestDatasetFromDb(prisma: PrismaClient): Promise<MarketDataset> {
  const latestDay = await prisma.tradingDay.findFirst({ orderBy: { tradeDate: "desc" } });
  if (!latestDay) return createSampleDataset();
  const [stocks, limitUps, dragonTiger, sectors] = await Promise.all([
    prisma.stock.findMany(),
    prisma.limitUpRecord.findMany({ where: { tradeDate: latestDay.tradeDate } }),
    prisma.dragonTigerRecord.findMany({ where: { tradeDate: latestDay.tradeDate } }),
    prisma.sectorRecord.findMany({ where: { tradeDate: latestDay.tradeDate } })
  ]);

  return {
    tradeDate: latestDay.tradeDate,
    dataAsOf: new Date().toISOString(),
    source: "akshare_partial",
    warnings: [],
    stocks: stocks.map((stock) => ({
      code: stock.code,
      name: stock.name,
      market: stock.market as any,
      industry: stock.industry ?? undefined,
      concepts: fromJsonText<string[]>(stock.concepts, []),
      pctChange: 0,
      turnoverAmount: 100_000_000,
      turnoverRate: 0,
      volumeRatio: 1,
      close: 0,
      isST: stock.isST,
      isSuspended: stock.isSuspended,
      listedDays: 999
    })),
    limitUps: limitUps.map((item) => ({
      tradeDate: item.tradeDate,
      code: item.code,
      name: item.name,
      market: item.market as any,
      industry: item.industry ?? undefined,
      concepts: fromJsonText<string[]>(item.concepts, []),
      consecutive: item.consecutive,
      firstLimitTime: item.firstLimitTime ?? undefined,
      lastLimitTime: item.lastLimitTime ?? undefined,
      openCount: item.openCount,
      sealedAmount: item.sealedAmount,
      turnoverRate: item.turnoverRate,
      pctChange: item.pctChange
    })),
    dragonTiger: dragonTiger.map((item) => ({
      tradeDate: item.tradeDate,
      code: item.code,
      name: item.name,
      reason: item.reason ?? undefined,
      buyAmount: item.buyAmount,
      sellAmount: item.sellAmount,
      netAmount: item.netAmount,
      seats: fromJsonText<any[]>(item.seats, [])
    })),
    sectors: sectors.map((item) => ({
      tradeDate: item.tradeDate,
      name: item.name,
      type: item.type as any,
      pctChange: item.pctChange,
      inflowAmount: item.inflowAmount,
      outflowAmount: item.outflowAmount,
      netInflow: item.netInflow,
      companyCount: item.companyCount,
      limitUpCount: item.limitUpCount,
      leaderCode: item.leaderCode ?? undefined,
      leaderName: item.leaderName ?? undefined,
      leaderPctChange: item.leaderPctChange,
      heatScore: item.heatScore,
      trend: fromJsonText<number[]>(item.trend, [])
    }))
  };
}

export async function evaluateActiveWatchlist(prisma: PrismaClient, dataset: MarketDataset) {
  const items = await prisma.watchlistItem.findMany({ where: { isActive: true } });
  const dsl = createDefaultStrategy("short_term", ["main", "gem", "star", "bse"]);
  const triggers = [];

  for (const item of items) {
    const evaluation = attachRecommendation(item.code, evaluateWatchCondition(item.code, fromJsonText<WatchConditionDsl>(item.conditionDsl, {
      prompt: item.conditionPrompt,
      templates: ["sector_top_n"],
      markets: ["main"],
      params: { sectorTopN: 3 }
    }), dataset), dataset, dsl);
    if (!evaluation.triggered) continue;

    const trigger = await prisma.watchlistTrigger.create({
      data: {
        watchlistItemId: item.id,
        tradeDate: dataset.tradeDate,
        code: item.code,
        name: item.name,
        priority: evaluation.priority,
        score: evaluation.score,
        reasons: toJsonText(evaluation.reasons),
        risks: toJsonText(evaluation.risks),
        dataAsOf: new Date(dataset.dataAsOf)
      }
    });
    triggers.push({ ...trigger, recommendation: evaluation.recommendation });
  }

  return triggers;
}
