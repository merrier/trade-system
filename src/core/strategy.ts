import { z } from "zod";
import { createDefaultStrategy, createLimitUpPullbackStrategy } from "./defaults.js";
import type { CompileResult, Market, StrategyDsl, StrategyStyle, WatchConditionDsl, WatchTemplate } from "../shared/types.js";

const marketSchema = z.enum(["main", "gem", "star", "bse"]);
const styleSchema = z.enum(["short_term", "stable", "custom"]);

export const strategyDslSchema: z.ZodType<StrategyDsl> = z.object({
  style: styleSchema,
  markets: z.array(marketSchema).min(1),
  strategyTemplates: z.array(z.enum(["limit_up_pullback"])).optional().default([]),
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  weights: z.object({
    strategyMatch: z.number().min(0).max(100),
    limitUpStrength: z.number().min(0).max(100),
    dragonTiger: z.number().min(0).max(100),
    sectorHeat: z.number().min(0).max(100),
    moneyFlow: z.number().min(0).max(100),
    liquidity: z.number().min(0).max(100),
    riskPenalty: z.number().min(0).max(100)
  }),
  filters: z.object({
    excludeST: z.boolean(),
    excludeSuspended: z.boolean(),
    excludeNewStocksDays: z.number().min(0).max(365),
    minTurnoverAmount: z.number().min(0),
    maxOpenCount: z.number().min(0).optional(),
    minConsecutiveLimitUps: z.number().min(1).optional(),
    sectorTopN: z.number().min(1).max(100).optional(),
    recentLimitUpDays: z.number().min(1).max(30).optional(),
    requireBearishCandle: z.boolean().optional(),
    requireHoldLimitUpPrice: z.boolean().optional(),
    requireAboveMa: z.enum(["ma5_or_ma10"]).optional(),
    requireVolumeContraction: z.boolean().optional(),
    maxTwentyDayGainPct: z.number().min(0).max(100).optional(),
    requireBullishMaAlignment: z.boolean().optional()
  })
});

export const watchConditionDslSchema: z.ZodType<WatchConditionDsl> = z.object({
  templates: z.array(
    z.enum([
      "volume_breakout",
      "ma_breakout",
      "money_inflow_positive",
      "sector_top_n",
      "limit_up_or_reseal",
      "dragon_tiger_listed",
      "stop_loss_break"
    ])
  ),
  prompt: z.string(),
  markets: z.array(marketSchema).min(1),
  params: z.record(z.union([z.number(), z.string(), z.boolean()]))
});

export function compileStrategyLocally(prompt: string, markets: Market[] = ["main"], style: StrategyStyle = "short_term"): CompileResult {
  const dsl = createDefaultStrategy(style, markets);
  const normalized = prompt.trim().toLowerCase();
  const warnings: string[] = [];
  const unsupported: string[] = [];

  if (!prompt.trim()) {
    warnings.push("未输入自然语言策略，已使用默认短线强势策略。");
  }

  addKeyword(dsl.include, prompt, ["涨停", "连板", "封板", "回封"]);
  addKeyword(dsl.include, prompt, ["龙虎榜", "机构", "游资", "净买入"]);
  addKeyword(dsl.include, prompt, ["板块", "概念", "行业", "主线", "热度"]);
  addKeyword(dsl.exclude, prompt, ["炸板多", "高位风险", "st"]);

  if (isLimitUpPullbackPrompt(prompt)) {
    Object.assign(dsl, createLimitUpPullbackStrategy(markets));
  }

  const twentyDayGainMatch = prompt.match(/(?:近|最近)?\s*20\s*(?:天|日).*?(?:涨幅|涨跌幅).*?(?:不超过|不要超过|小于|低于|<=|≤)\s*(\d+(?:\.\d+)?)\s*%?/);
  if (twentyDayGainMatch?.[1]) {
    dsl.filters.maxTwentyDayGainPct = Number(twentyDayGainMatch[1]);
  }
  if (/多头排列|均线多头/.test(prompt)) {
    dsl.filters.requireBullishMaAlignment = true;
  }

  if (normalized.includes("稳健") || normalized.includes("低回撤")) {
    Object.assign(dsl, createDefaultStrategy("stable", markets));
    dsl.include.push("稳健低回撤");
  }

  if (normalized.includes("创业板")) {
    dsl.markets = uniqueMarkets([...dsl.markets, "gem"]);
  }
  if (normalized.includes("科创")) {
    dsl.markets = uniqueMarkets([...dsl.markets, "star"]);
  }
  if (normalized.includes("北交")) {
    dsl.markets = uniqueMarkets([...dsl.markets, "bse"]);
  }
  if (normalized.includes("全a") || normalized.includes("全 A".toLowerCase())) {
    dsl.markets = ["main", "gem", "star", "bse"];
  }

  const topMatch = prompt.match(/板块.*?(前|top)\s*(\d+)/i);
  if (topMatch?.[2]) {
    dsl.filters.sectorTopN = Number(topMatch[2]);
  } else if (/板块.*前三|前三.*板块/.test(prompt)) {
    dsl.filters.sectorTopN = 3;
  } else if (/板块.*前五|前五.*板块/.test(prompt)) {
    dsl.filters.sectorTopN = 5;
  }

  if (prompt.includes("不排除ST") || prompt.includes("包含ST")) {
    dsl.filters.excludeST = false;
    warnings.push("已允许 ST 股票，排名会增加风险扣分。");
  }

  if (prompt.includes("基本面") || prompt.includes("财报")) {
    unsupported.push("基本面/财报筛选暂未接入，已忽略该条件。");
  }

  return { dsl: strategyDslSchema.parse(dsl), warnings, unsupported };
}

function isLimitUpPullbackPrompt(prompt: string): boolean {
  const text = prompt.trim();
  return Boolean(
    text.includes("涨停") &&
    (
      text.includes("回调") ||
      (/阴线/.test(text) && /缩量/.test(text)) ||
      /五日线|5日线|十日线|10日线/.test(text)
    )
  );
}

export function compileWatchConditionLocally(prompt: string, markets: Market[] = ["main"]): WatchConditionDsl {
  const templates: WatchTemplate[] = [];
  const text = prompt.trim();

  if (/放量|量比|成交量/.test(text)) templates.push("volume_breakout");
  if (/突破|均线|5日|五日/.test(text)) templates.push("ma_breakout");
  if (/资金|净流入|主力/.test(text)) templates.push("money_inflow_positive");
  if (/板块|概念|行业|前三|前五|top/i.test(text)) templates.push("sector_top_n");
  if (/涨停|回封/.test(text)) templates.push("limit_up_or_reseal");
  if (/龙虎榜/.test(text)) templates.push("dragon_tiger_listed");
  if (/止损|跌破/.test(text)) templates.push("stop_loss_break");

  const sectorTopMatch = text.match(/(?:前|top)\s*(\d+)/i);
  const stopLossMatch = text.match(/(?:跌破|止损).*?(\d+(?:\.\d+)?)/);

  const dsl: WatchConditionDsl = {
    templates: templates.length > 0 ? templates : ["sector_top_n", "money_inflow_positive"],
    prompt: text || "板块进入前列且主力净流入转正",
    markets,
    params: {
      volumeRatio: 1.8,
      sectorTopN: sectorTopMatch?.[1] ? Number(sectorTopMatch[1]) : 3,
      stopLossPrice: stopLossMatch?.[1] ? Number(stopLossMatch[1]) : 0
    }
  };

  return watchConditionDslSchema.parse(dsl);
}

export function normalizeMarkets(input?: unknown): Market[] {
  if (!Array.isArray(input)) return ["main"];
  const parsed = input.filter((item): item is Market => ["main", "gem", "star", "bse"].includes(String(item)));
  return parsed.length > 0 ? uniqueMarkets(parsed) : ["main"];
}

function addKeyword(target: string[], prompt: string, terms: string[]) {
  if (terms.some((term) => prompt.includes(term))) {
    target.push(...terms.filter((term) => prompt.includes(term)));
  }
}

function uniqueMarkets(markets: Market[]): Market[] {
  return [...new Set(markets)];
}
