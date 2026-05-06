import type { Market, StrategyDsl, StrategyStyle, WatchTemplate } from "../shared/types.js";

export const DEFAULT_MARKETS: Market[] = ["main"];

export const DEFAULT_STRATEGY_DSL: StrategyDsl = {
  style: "short_term",
  markets: DEFAULT_MARKETS,
  include: [],
  exclude: [],
  weights: {
    strategyMatch: 18,
    limitUpStrength: 24,
    dragonTiger: 16,
    sectorHeat: 18,
    moneyFlow: 12,
    liquidity: 8,
    riskPenalty: 20
  },
  filters: {
    excludeST: true,
    excludeSuspended: true,
    excludeNewStocksDays: 20,
    minTurnoverAmount: 80_000_000,
    maxOpenCount: 4,
    minConsecutiveLimitUps: 1,
    sectorTopN: 10
  }
};

export const WATCH_TEMPLATE_LABELS: Record<WatchTemplate, string> = {
  volume_breakout: "放量",
  ma_breakout: "突破均线",
  money_inflow_positive: "主力净流入转正",
  sector_top_n: "板块进入前列",
  limit_up_or_reseal: "涨停或回封",
  dragon_tiger_listed: "龙虎榜上榜",
  stop_loss_break: "跌破止损线"
};

export function createDefaultStrategy(style: StrategyStyle = "short_term", markets: Market[] = DEFAULT_MARKETS): StrategyDsl {
  const dsl = structuredClone(DEFAULT_STRATEGY_DSL);
  dsl.style = style;
  dsl.markets = markets.length > 0 ? markets : DEFAULT_MARKETS;

  if (style === "stable") {
    dsl.weights.limitUpStrength = 12;
    dsl.weights.dragonTiger = 12;
    dsl.weights.sectorHeat = 16;
    dsl.weights.moneyFlow = 18;
    dsl.weights.liquidity = 18;
    dsl.weights.riskPenalty = 28;
    dsl.filters.minTurnoverAmount = 150_000_000;
    dsl.filters.maxOpenCount = 2;
  }

  if (style === "custom") {
    dsl.filters.minConsecutiveLimitUps = undefined;
  }

  return dsl;
}
