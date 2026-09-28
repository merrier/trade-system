import type { Market, StrategyDsl, StrategyStyle, WatchTemplate } from "../shared/types.js";

export const DEFAULT_MARKETS: Market[] = ["main"];
export const LIMIT_UP_PULLBACK_PROMPT = "涨停回调策略：主板股票最近10天内有涨停，今天是阴线，但是没有跌破涨停价，收盘价回调至五日线或十日线附近且距离不超过3%，阴线缩量，最近20天涨幅不超过25%，均线呈多头排列";
export const LIMIT_UP_DOUBLE_VOLUME_BEARISH_PROMPT = "涨停倍量阴策略：主板股票近5日出现实体涨停，涨停后缩量阴线调整，调整区间最低价未跌破涨停当日开盘价，今日收阳线，收盘价站上10日均线，今日成交量大于昨日成交量，今日涨幅小于5%，近20日最大涨幅小于45%，非ST，非科创板，非北交所，非创业板，股价大于5元，近5日日均成交额大于3000万";
export const LIMIT_UP_BEARISH_PULLBACK_PROMPT = "涨停回踩阴线策略：主板股票近5日出现实体涨停，涨停后有阴线调整，调整区间最低价未跌破涨停当日开盘价，今日收阴线但收盘价不跌破10日均线，今日涨幅小于5%，近20日最大涨幅小于45%，非ST，非科创板，非北交所，非创业板，股价大于5元，近5日日均成交额大于3000万";
export const MA5_PULLBACK_PROMPT = "沿五日线阴线回调策略：主板股票，非ST，非科创板，非北交所，非创业板，股价大于5元，近5日日均成交额大于3000万，MA5连续3日上行，MA5大于MA10，MA10大于MA20，今日之前最近5个完整交易日收盘价均在各自5日线上方，今日14:50呈阴线回调且最新价仍在5日线上方，距离5日线0%到2%，今日最低价触碰或接近5日线，最低价距离5日线不超过1.5%，盘中若短暂跌破5日线则跌破幅度不超过0.8%且已收回，今日涨幅在-2%到+2.5%，近5日最大涨幅小于15%，近20日最大涨幅小于35%，今日量比0.7到1.8，剔除涨停、跌停、停牌、长上影、放量大阴线和距离5日线过远的股票";

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

export function createLimitUpDoubleVolumeBearishStrategy(markets: Market[] = DEFAULT_MARKETS): StrategyDsl {
  const dsl = createDefaultStrategy("short_term", markets);
  dsl.strategyTemplates = ["limit_up_double_volume_bearish"];
  dsl.include = ["涨停倍量阴", "近5日实体涨停", "缩量阴线调整", "未跌破涨停日开盘价", "今日阳线", "站上10日均线", "今日放量", "20日不过热"];
  dsl.exclude = ["ST", "科创板", "北交所", "创业板", "股价小于5元", "近5日日均成交额低于3000万", "20日最大涨幅超过45%"];
  dsl.weights.strategyMatch = 42;
  dsl.weights.limitUpStrength = 12;
  dsl.weights.dragonTiger = 2;
  dsl.weights.sectorHeat = 14;
  dsl.weights.moneyFlow = 8;
  dsl.weights.liquidity = 12;
  dsl.weights.riskPenalty = 24;
  dsl.filters.excludeST = true;
  dsl.filters.excludeSuspended = true;
  dsl.filters.excludeNewStocksDays = 20;
  dsl.filters.minTurnoverAmount = 30_000_000;
  dsl.filters.maxOpenCount = undefined;
  dsl.filters.minConsecutiveLimitUps = undefined;
  dsl.filters.recentLimitUpDays = 5;
  dsl.filters.requireSolidLimitUp = true;
  dsl.filters.requirePostLimitUpBearishPullback = true;
  dsl.filters.requirePullbackVolumeContraction = true;
  dsl.filters.requirePullbackLowAboveLimitOpen = true;
  dsl.filters.requireBullishClose = true;
  dsl.filters.requireAboveMa = "ma10";
  dsl.filters.requireVolumeExpansionVsYesterday = true;
  dsl.filters.maxTodayPctChange = 5;
  dsl.filters.maxTwentyDayRangePct = 45;
  dsl.filters.minPrice = 5;
  dsl.filters.minFiveDayAvgAmount = 30_000_000;
  return dsl;
}

export function createLimitUpBearishPullbackStrategy(markets: Market[] = DEFAULT_MARKETS): StrategyDsl {
  const dsl = createDefaultStrategy("short_term", markets);
  dsl.strategyTemplates = ["limit_up_bearish_pullback"];
  dsl.include = ["涨停回踩阴线", "近5日实体涨停", "涨停后阴线调整", "未跌破涨停日开盘价", "今日阴线", "不破10日均线", "20日不过热"];
  dsl.exclude = ["ST", "科创板", "北交所", "创业板", "股价小于5元", "近5日日均成交额低于3000万", "20日最大涨幅超过45%"];
  dsl.weights.strategyMatch = 42;
  dsl.weights.limitUpStrength = 12;
  dsl.weights.dragonTiger = 2;
  dsl.weights.sectorHeat = 14;
  dsl.weights.moneyFlow = 8;
  dsl.weights.liquidity = 12;
  dsl.weights.riskPenalty = 24;
  dsl.filters.excludeST = true;
  dsl.filters.excludeSuspended = true;
  dsl.filters.excludeNewStocksDays = 20;
  dsl.filters.minTurnoverAmount = 30_000_000;
  dsl.filters.maxOpenCount = undefined;
  dsl.filters.minConsecutiveLimitUps = undefined;
  dsl.filters.recentLimitUpDays = 5;
  dsl.filters.requireSolidLimitUp = true;
  dsl.filters.requirePostLimitUpBearishPullback = true;
  dsl.filters.requirePullbackVolumeContraction = false;
  dsl.filters.requirePullbackLowAboveLimitOpen = true;
  dsl.filters.requireBearishCandle = true;
  dsl.filters.requireAboveMa = "ma10";
  dsl.filters.requireVolumeExpansionVsYesterday = false;
  dsl.filters.maxTodayPctChange = 5;
  dsl.filters.maxTwentyDayRangePct = 45;
  dsl.filters.minPrice = 5;
  dsl.filters.minFiveDayAvgAmount = 30_000_000;
  return dsl;
}

export function createMa5PullbackStrategy(markets: Market[] = DEFAULT_MARKETS): StrategyDsl {
  const dsl = createDefaultStrategy("short_term", markets);
  dsl.strategyTemplates = ["ma5_pullback"];
  dsl.include = ["沿五日线回调", "MA5连续上行", "回踩五日线", "五日线止损", "均线多头排列", "量能不过热"];
  dsl.exclude = ["ST", "科创板", "北交所", "创业板", "股价小于5元", "近5日日均成交额低于3000万", "跌破五日线", "距离五日线过远", "涨停", "跌停", "长上影", "放量大阴线"];
  dsl.weights.strategyMatch = 44;
  dsl.weights.limitUpStrength = 0;
  dsl.weights.dragonTiger = 2;
  dsl.weights.sectorHeat = 14;
  dsl.weights.moneyFlow = 12;
  dsl.weights.liquidity = 12;
  dsl.weights.riskPenalty = 24;
  dsl.filters.excludeST = true;
  dsl.filters.excludeSuspended = true;
  dsl.filters.excludeNewStocksDays = 20;
  dsl.filters.minTurnoverAmount = 30_000_000;
  dsl.filters.maxOpenCount = undefined;
  dsl.filters.minConsecutiveLimitUps = undefined;
  dsl.filters.minPrice = 5;
  dsl.filters.minFiveDayAvgAmount = 30_000_000;
  dsl.filters.requireBullishMaAlignment = true;
  dsl.filters.requireAboveMa = "ma5_or_ma10";
  dsl.filters.requireMa5RisingDays = 3;
  dsl.filters.closeAboveMa5LookbackDays = 5;
  dsl.filters.minCloseAboveMa5Days = 5;
  dsl.filters.requireBearishCandle = true;
  dsl.filters.maxMaDistancePct = 2;
  dsl.filters.maxLowMa5DistancePct = 1.5;
  dsl.filters.maxIntradayBreakMa5Pct = 0.8;
  dsl.filters.minTodayPctChange = -2;
  dsl.filters.maxTodayPctChange = 2.5;
  dsl.filters.maxFiveDayRangePct = 15;
  dsl.filters.maxTwentyDayRangePct = 35;
  dsl.filters.minVolumeRatio = 0.7;
  dsl.filters.maxVolumeRatio = 1.8;
  return dsl;
}
