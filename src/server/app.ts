import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import path from "node:path";
import { z } from "zod";
import { compileStrategy, compileWatchCondition } from "../core/deepseek.js";
import { createDefaultStrategy } from "../core/defaults.js";
import { rankSectors } from "../core/scoring.js";
import { normalizeMarkets, strategyDslSchema } from "../core/strategy.js";
import { fetchMarketDataset } from "../data/akshareClient.js";
import type { RunMode, StrategyStyle } from "../shared/types.js";
import { fromJsonText, toJsonText } from "./json.js";
import { evaluateActiveWatchlist, latestDatasetFromDb, persistMarketDataset, runPostCloseIngest, runRecommendation } from "./repository.js";

const compileBodySchema = z.object({
  prompt: z.string().default(""),
  markets: z.array(z.string()).optional(),
  style: z.enum(["short_term", "stable", "custom"]).default("short_term")
});

const recommendationBodySchema = z.object({
  prompt: z.string().optional(),
  strategyId: z.string().optional(),
  mode: z.enum(["intraday", "post_close"]).default("intraday"),
  markets: z.array(z.string()).optional()
});

const watchlistBodySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  market: z.enum(["main", "gem", "star", "bse"]).default("main"),
  thesis: z.string().default(""),
  conditionPrompt: z.string().default("板块进入前三且主力净流入转正"),
  markets: z.array(z.string()).optional()
});

export function createApp(prisma: PrismaClient) {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(sensible);

  app.get("/api/health", async () => ({
    ok: true,
    name: "trade-system",
    now: new Date().toISOString()
  }));

  app.post("/api/strategies/compile", async (request) => {
    const body = compileBodySchema.parse(request.body ?? {});
    const markets = normalizeMarkets(body.markets);
    const result = await compileStrategy(body.prompt, markets, body.style as StrategyStyle);
    const strategy = await prisma.strategy.create({
      data: {
        name: body.prompt.slice(0, 40) || "未命名策略",
        prompt: body.prompt,
        dsl: toJsonText(result.dsl),
        markets: toJsonText(markets),
        style: result.dsl.style,
        compileWarnings: toJsonText({ warnings: result.warnings, unsupported: result.unsupported })
      }
    });
    return { strategyId: strategy.id, ...result };
  });

  app.post("/api/recommendations/run", async (request) => {
    const body = recommendationBodySchema.parse(request.body ?? {});
    const markets = normalizeMarkets(body.markets);
    let dsl = createDefaultStrategy("short_term", markets);
    let prompt = body.prompt;

    if (body.strategyId) {
      const strategy = await prisma.strategy.findUnique({ where: { id: body.strategyId } });
      if (!strategy) {
        return app.httpErrors.notFound("strategy not found");
      }
      dsl = strategyDslSchema.parse(fromJsonText(strategy.dsl, {}));
      prompt = strategy.prompt;
    } else if (body.prompt) {
      const compiled = await compileStrategy(body.prompt, markets, "short_term");
      dsl = compiled.dsl;
    }

    const dataset = body.mode === "intraday" ? await fetchMarketDataset("intraday") : await latestDatasetFromDb(prisma);
    if (body.mode === "post_close") {
      await persistMarketDataset(prisma, dataset);
    }
    const result = await runRecommendation(prisma, dataset, dsl, body.mode as RunMode, prompt, body.strategyId);
    return {
      runId: result.runId,
      mode: body.mode,
      source: dataset.source,
      warnings: dataset.warnings,
      dataAsOf: dataset.dataAsOf,
      results: result.results
    };
  });

  app.get("/api/recommendations/latest", async (request) => {
    const query = request.query as { tradeDate?: string; market?: string; strategyId?: string };
    const run = await prisma.recommendationRun.findFirst({
      where: {
        tradeDate: query.tradeDate,
        strategyId: query.strategyId,
        mode: "post_close"
      },
      orderBy: { createdAt: "desc" },
      include: {
        recommendations: {
          where: query.market ? { market: query.market } : undefined,
          orderBy: { rank: "asc" },
          take: 50
        }
      }
    });
    if (!run) return { recommendations: [] };
    return {
      ...run,
      recommendations: run.recommendations.map((item) => ({
        ...item,
        reasons: fromJsonText<string[]>(item.reasons, []),
        risks: fromJsonText<string[]>(item.risks, []),
        factors: fromJsonText<Record<string, number>>(item.factors, {})
      }))
    };
  });

  app.get("/api/limit-up/ladder", async (request) => {
    const query = request.query as { tradeDate?: string; markets?: string };
    const latestDay = query.tradeDate ?? (await prisma.tradingDay.findFirst({ orderBy: { tradeDate: "desc" } }))?.tradeDate;
    if (!latestDay) return { tradeDate: null, items: [] };
    const markets = query.markets?.split(",").filter(Boolean);
    const items = await prisma.limitUpRecord.findMany({
      where: {
        tradeDate: latestDay,
        market: markets?.length ? { in: markets } : undefined
      },
      orderBy: [{ consecutive: "desc" }, { strengthScore: "desc" }]
    });
    return {
      tradeDate: latestDay,
      items: items.map((item) => ({
        ...item,
        concepts: fromJsonText<string[]>(item.concepts, [])
      }))
    };
  });

  app.get("/api/sectors/ladder", async (request) => {
    const query = request.query as { tradeDate?: string; type?: string };
    const latestDay = query.tradeDate ?? (await prisma.tradingDay.findFirst({ orderBy: { tradeDate: "desc" } }))?.tradeDate;
    if (!latestDay) return { tradeDate: null, items: [] };
    const items = await prisma.sectorRecord.findMany({
      where: {
        tradeDate: latestDay,
        type: query.type
      },
      orderBy: { heatScore: "desc" }
    });
    return {
      tradeDate: latestDay,
      items: items.map((item) => ({
        ...item,
        trend: fromJsonText<number[]>(item.trend, [])
      }))
    };
  });

  app.get("/api/stocks/:code/analysis", async (request) => {
    const { code } = request.params as { code: string };
    const dataset = await latestDatasetFromDb(prisma);
    const stock = dataset.stocks.find((item) => item.code === code) ?? (await prisma.stock.findUnique({ where: { code } }));
    if (!stock) return app.httpErrors.notFound("stock not found");

    const limitUps = await prisma.limitUpRecord.findMany({ where: { code }, orderBy: { tradeDate: "desc" }, take: 20 });
    const dragonTiger = await prisma.dragonTigerRecord.findMany({ where: { code }, orderBy: { tradeDate: "desc" }, take: 20 });
    const dsl = createDefaultStrategy("short_term", ["main", "gem", "star", "bse"]);
    const recommendation = await runRecommendation(prisma, dataset, dsl, "intraday", `单票分析 ${code}`);
    const rankedSectors = rankSectors(dataset);
    const relatedSectors = rankedSectors.filter((sector) => {
      const concepts = "concepts" in stock ? (Array.isArray(stock.concepts) ? stock.concepts : fromJsonText<string[]>(stock.concepts as string, [])) : [];
      return sector.name === ("industry" in stock ? stock.industry : undefined) || concepts.includes(sector.name);
    });

    return {
      stock,
      score: recommendation.results.find((item) => item.code === code),
      limitUps,
      dragonTiger,
      relatedSectors,
      dataAsOf: dataset.dataAsOf
    };
  });

  app.post("/api/watchlist", async (request) => {
    const body = watchlistBodySchema.parse(request.body ?? {});
    const markets = normalizeMarkets(body.markets);
    const conditionDsl = await compileWatchCondition(body.conditionPrompt, markets);
    const item = await prisma.watchlistItem.create({
      data: {
        code: body.code,
        name: body.name,
        market: body.market,
        thesis: body.thesis,
        conditionPrompt: body.conditionPrompt,
        conditionDsl: toJsonText(conditionDsl),
        markets: toJsonText(markets)
      }
    });
    return { item, conditionDsl };
  });

  app.get("/api/watchlist", async () => {
    const items = await prisma.watchlistItem.findMany({ orderBy: { createdAt: "desc" } });
    return {
      items: items.map((item) => ({
        ...item,
        conditionDsl: fromJsonText(item.conditionDsl, null),
        markets: fromJsonText<string[]>(item.markets, [])
      }))
    };
  });

  app.patch("/api/watchlist/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ isActive: z.boolean().optional(), conditionPrompt: z.string().optional(), thesis: z.string().optional() }).parse(request.body ?? {});
    const update: Record<string, unknown> = { ...body };
    if (body.conditionPrompt) {
      update.conditionDsl = toJsonText(await compileWatchCondition(body.conditionPrompt, ["main"]));
    }
    const item = await prisma.watchlistItem.update({ where: { id }, data: update });
    return { item };
  });

  app.delete("/api/watchlist/:id", async (request) => {
    const { id } = request.params as { id: string };
    await prisma.watchlistItem.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/watchlist/triggers", async () => {
    const latestDay = await prisma.tradingDay.findFirst({ orderBy: { tradeDate: "desc" } });
    const triggers = await prisma.watchlistTrigger.findMany({
      where: latestDay ? { tradeDate: latestDay.tradeDate } : undefined,
      orderBy: [{ priority: "asc" }, { score: "desc" }],
      include: { item: true }
    });
    return {
      tradeDate: latestDay?.tradeDate ?? null,
      triggers: triggers.map((item) => ({
        ...item,
        reasons: fromJsonText<string[]>(item.reasons, []),
        risks: fromJsonText<string[]>(item.risks, []),
        item: {
          ...item.item,
          conditionDsl: fromJsonText(item.item.conditionDsl, null),
          markets: fromJsonText<string[]>(item.item.markets, [])
        }
      }))
    };
  });

  app.post("/api/jobs/post-close-ingest", async (request) => {
    const body = z.object({ tradeDate: z.string().optional() }).parse(request.body ?? {});
    const result = await runPostCloseIngest(prisma, body.tradeDate);
    return {
      tradeDate: result.dataset.tradeDate,
      source: result.dataset.source,
      warnings: result.dataset.warnings,
      dataAsOf: result.dataset.dataAsOf,
      stocks: result.dataset.stocks.length,
      limitUps: result.dataset.limitUps.length,
      sectors: result.dataset.sectors.length,
      recommendations: result.recommendation.results.length,
      triggers: result.triggers.length
    };
  });

  app.post("/api/watchlist/evaluate", async () => {
    const dataset = await fetchMarketDataset("intraday");
    const triggers = await evaluateActiveWatchlist(prisma, dataset);
    return { tradeDate: dataset.tradeDate, triggers };
  });

  const staticRoot = path.resolve(process.cwd(), "dist-web");
  app.register(fastifyStatic, {
    root: staticRoot,
    prefix: "/"
  });

  return app;
}
