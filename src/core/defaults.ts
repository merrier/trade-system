import type { Market, StrategyDsl, StrategyStyle, WatchTemplate } from "../shared/types.js";

export const DEFAULT_MARKETS: Market[] = ["main"];
export const LIMIT_UP_PULLBACK_PROMPT = "涨停回调策略：主板股票最近10天内有涨停，今天是阴线，但是没有跌破涨停价，收盘价回调至五日线或十日线附近且距离不超过3%，阴线缩量，最近20天涨幅不超过25%，均线呈多头排列";

export const DEFAULT_STRATEGY_DSL: StrategyDsl = {
  style: "short_term",
  markets: DEFAULT_MARKETS,
  strategyTemplates: [],
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

export function createLimitUpPullbackStrategy(markets: Market[] = DEFAULT_MARKETS): StrategyDsl {
  const dsl = createDefaultStrategy("short_term", markets);
  dsl.strategyTemplates = ["limit_up_pullback"];
  dsl.include = ["涨停回调", "10日内涨停", "阴线缩量", "未跌破涨停价", "五日线或十日线附近支撑", "20日涨幅不过热", "均线多头排列"];
  dsl.exclude = ["ST", "停牌", "跌破涨停价", "放量阴线", "跌破五日线和十日线", "距离均线过远", "20日涨幅超过25%", "均线未多头排列"];
  dsl.weights.strategyMatch = 36;
  dsl.weights.limitUpStrength = 16;
  dsl.weights.dragonTiger = 4;
  dsl.weights.sectorHeat = 14;
  dsl.weights.moneyFlow = 8;
  dsl.weights.liquidity = 10;
  dsl.weights.riskPenalty = 22;
  dsl.filters.excludeST = true;
  dsl.filters.excludeSuspended = true;
  dsl.filters.excludeNewStocksDays = 20;
  dsl.filters.minTurnoverAmount = 80_000_000;
  dsl.filters.maxOpenCount = undefined;
  dsl.filters.minConsecutiveLimitUps = undefined;
  dsl.filters.recentLimitUpDays = 10;
  dsl.filters.requireBearishCandle = true;
  dsl.filters.requireHoldLimitUpPrice = true;
  dsl.filters.requireAboveMa = "ma5_or_ma10";
  dsl.filters.maxMaDistancePct = 3;
  dsl.filters.requireVolumeContraction = true;
  dsl.filters.maxTwentyDayGainPct = 25;
  dsl.filters.requireBullishMaAlignment = true;
  return dsl;
}
