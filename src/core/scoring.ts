import type {
  DailyBar,
  DragonTigerSnapshot,
  LimitUpSnapshot,
  MarketDataset,
  RecommendationResult,
  SectorSnapshot,
  StockSnapshot,
  StrategyDsl
} from "../shared/types.js";

interface RankOptions {
  dailyBars?: DailyBar[];
}

interface PullbackEvaluation {
  matched: boolean;
  score: number;
  reasons: string[];
  risks: string[];
  factors: Record<string, number>;
}

export function rankStocks(dataset: MarketDataset, dsl: StrategyDsl, mode: "intraday" | "post_close", options: RankOptions = {}): RecommendationResult[] {
  const sectorScores = rankSectors(dataset).reduce<Map<string, number>>((acc, sector, index) => {
    acc.set(`${sector.type}:${sector.name}`, Math.max(0, 100 - index * 4));
    return acc;
  }, new Map());

  const limitUpByCode = new Map(dataset.limitUps.map((item) => [item.code, item]));
  const dragonByCode = new Map(dataset.dragonTiger.map((item) => [item.code, item]));
  const dailyBarsByCode = groupDailyBars(options.dailyBars ?? []);

  return dataset.stocks
    .filter((stock) => passesFilters(stock, dsl, limitUpByCode.get(stock.code), dailyBarsByCode.get(stock.code), dataset.tradeDate))
    .map((stock) => scoreStock(stock, dsl, limitUpByCode.get(stock.code), dragonByCode.get(stock.code), dataset.sectors, sectorScores, mode, dataset.dataAsOf, dailyBarsByCode.get(stock.code), dataset.tradeDate))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function rankSectors(dataset: MarketDataset): Array<SectorSnapshot & { heatScore: number; reasons: string[] }> {
  const maxNetInflow = Math.max(1, ...dataset.sectors.map((item) => Math.abs(item.netInflow)));
  const maxLimitUps = Math.max(1, ...dataset.sectors.map((item) => item.limitUpCount));

  return dataset.sectors
    .map((sector) => {
      const pctScore = clamp(scale(sector.pctChange, -3, 8), 0, 100);
      const flowScore = clamp((sector.netInflow / maxNetInflow) * 50 + 50, 0, 100);
      const limitScore = clamp((sector.limitUpCount / maxLimitUps) * 100, 0, 100);
      const leaderScore = clamp(scale(sector.leaderPctChange, 0, 20), 0, 100);
      const trendScore = sector.trend.length > 0 ? clamp(scale(avg(sector.trend), -2, 6), 0, 100) : 50;
      const heatScore = round(pctScore * 0.22 + flowScore * 0.28 + limitScore * 0.24 + leaderScore * 0.16 + trendScore * 0.1);

      const reasons: string[] = [];
      if (sector.netInflow > 0) reasons.push(`主力净流入 ${formatYi(sector.netInflow)}`);
      if (sector.limitUpCount > 0) reasons.push(`${sector.limitUpCount} 只涨停`);
      if (sector.leaderName) reasons.push(`领涨 ${sector.leaderName} ${round(sector.leaderPctChange)}%`);

      return { ...sector, heatScore, reasons };
    })
    .sort((a, b) => b.heatScore - a.heatScore);
}

function scoreStock(
  stock: StockSnapshot,
  dsl: StrategyDsl,
  limitUp: LimitUpSnapshot | undefined,
  dragon: DragonTigerSnapshot | undefined,
  sectors: SectorSnapshot[],
  sectorScores: Map<string, number>,
  mode: "intraday" | "post_close",
  dataAsOf: string,
  dailyBars: DailyBar[] | undefined,
  tradeDate: string
): RecommendationResult {
  const templateEvaluation = evaluateStrategyTemplate(stock, dsl, dailyBars, tradeDate);
  const strategyMatch = templateEvaluation ? templateEvaluation.score : getStrategyMatch(stock, dsl, limitUp, dragon);
  const limitUpStrength = limitUp ? clamp(limitUp.consecutive * 18 + (limitUp.openCount === 0 ? 18 : 8) + scale(limitUp.sealedAmount, 0, 800_000_000) * 0.3, 0, 100) : 0;
  const dragonTiger = dragon ? clamp(scale(dragon.netAmount, -80_000_000, 180_000_000), 0, 100) : 30;
  const sectorHeat = getSectorHeat(stock, sectors, sectorScores);
  const moneyFlow = clamp(scale(stock.mainNetInflow ?? 0, -60_000_000, 120_000_000), 0, 100);
  const liquidity = clamp(scale(stock.turnoverAmount, dsl.filters.minTurnoverAmount, 2_000_000_000), 0, 100);
  const riskPenalty = getRiskPenalty(stock, limitUp, dragon, templateEvaluation);

  const weighted =
    strategyMatch * dsl.weights.strategyMatch +
    limitUpStrength * dsl.weights.limitUpStrength +
    dragonTiger * dsl.weights.dragonTiger +
    sectorHeat * dsl.weights.sectorHeat +
    moneyFlow * dsl.weights.moneyFlow +
    liquidity * dsl.weights.liquidity -
    riskPenalty * dsl.weights.riskPenalty;
  const weightTotal = Object.entries(dsl.weights)
    .filter(([key]) => key !== "riskPenalty")
    .reduce((sum, [, value]) => sum + value, 0);
  const score = clamp(weighted / Math.max(1, weightTotal), 0, 100);

  const reasons = buildReasons(stock, limitUp, dragon, sectorHeat, moneyFlow, templateEvaluation);
  const risks = buildRisks(stock, limitUp, mode, templateEvaluation);
  const confidence = round(clamp((limitUp ? 28 : 8) + (dragon ? 20 : 8) + (sectorHeat > 60 ? 24 : 12) + (stock.turnoverAmount > dsl.filters.minTurnoverAmount ? 18 : 6), 25, 96));

  return {
    rank: 0,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    score: round(score),
    confidence,
    reasons,
    risks,
    factors: {
      strategyMatch: round(strategyMatch),
      limitUpStrength: round(limitUpStrength),
      dragonTiger: round(dragonTiger),
      sectorHeat: round(sectorHeat),
      moneyFlow: round(moneyFlow),
      liquidity: round(liquidity),
      riskPenalty: round(riskPenalty),
      ...(templateEvaluation?.factors ?? {})
    },
    dataAsOf
  };
}

function passesFilters(stock: StockSnapshot, dsl: StrategyDsl, limitUp?: LimitUpSnapshot, dailyBars?: DailyBar[], tradeDate?: string): boolean {
  if (!dsl.markets.includes(stock.market)) return false;
  if (dsl.filters.excludeST && stock.isST) return false;
  if (dsl.filters.excludeSuspended && stock.isSuspended) return false;
  if ((stock.listedDays ?? 9999) < dsl.filters.excludeNewStocksDays) return false;
  if (stock.turnoverAmount < dsl.filters.minTurnoverAmount) return false;
  if (dsl.filters.maxOpenCount !== undefined && limitUp && limitUp.openCount > dsl.filters.maxOpenCount) return false;
  if (dsl.filters.minConsecutiveLimitUps !== undefined && limitUp && limitUp.consecutive < dsl.filters.minConsecutiveLimitUps) return false;
  if (isDailyBarStrategy(dsl) && !evaluateStrategyTemplate(stock, dsl, dailyBars, tradeDate ?? "")?.matched) return false;
  return true;
}

function getStrategyMatch(stock: StockSnapshot, dsl: StrategyDsl, limitUp?: LimitUpSnapshot, dragon?: DragonTigerSnapshot): number {
  let score = 45;
  const haystack = `${stock.name} ${stock.industry ?? ""} ${stock.concepts.join(" ")} ${dsl.include.join(" ")}`;
  if (limitUp && /涨停|连板|封板|回封/.test(haystack)) score += 25;
  if (dragon && /龙虎榜|机构|游资|净买入/.test(haystack)) score += 18;
  if (/板块|概念|行业|主线|热度/.test(haystack)) score += 12;
  if (dsl.exclude.some((term) => haystack.includes(term))) score -= 15;
  return clamp(score, 0, 100);
}

function getSectorHeat(stock: StockSnapshot, sectors: SectorSnapshot[], sectorScores: Map<string, number>): number {
  const keys = [
    stock.industry ? `industry:${stock.industry}` : undefined,
    ...stock.concepts.map((name) => `concept:${name}`)
  ].filter(Boolean) as string[];
  const direct = keys.map((key) => sectorScores.get(key) ?? 0);
  if (direct.length > 0 && Math.max(...direct) > 0) return Math.max(...direct);

  const fuzzy = sectors.filter((sector) => sector.name === stock.industry || stock.concepts.includes(sector.name));
  return fuzzy.length > 0 ? Math.max(...fuzzy.map((sector) => sector.heatScore)) : 35;
}

function getRiskPenalty(stock: StockSnapshot, limitUp?: LimitUpSnapshot, dragon?: DragonTigerSnapshot, pullback?: PullbackEvaluation | null): number {
  let penalty = 0;
  if (stock.isST) penalty += 60;
  if (stock.isSuspended) penalty += 80;
  if (limitUp && limitUp.openCount >= 3) penalty += 16;
  if (limitUp && limitUp.consecutive >= 5) penalty += 18;
  if (dragon && dragon.netAmount < 0) penalty += 14;
  if (stock.turnoverRate > 35) penalty += 12;
  if (stock.volumeRatio > 5) penalty += 8;
  if (pullback?.matched) penalty -= 8;
  return clamp(penalty, 0, 100);
}

function buildReasons(stock: StockSnapshot, limitUp: LimitUpSnapshot | undefined, dragon: DragonTigerSnapshot | undefined, sectorHeat: number, moneyFlow: number, pullback?: PullbackEvaluation | null): string[] {
  const reasons: string[] = [];
  if (pullback?.matched) reasons.push(...pullback.reasons);
  if (limitUp) reasons.push(`${limitUp.consecutive} 连板，开板 ${limitUp.openCount} 次，封单 ${formatYi(limitUp.sealedAmount)}`);
  if (dragon && dragon.netAmount > 0) reasons.push(`龙虎榜净买入 ${formatYi(dragon.netAmount)}`);
  if (sectorHeat >= 70) reasons.push(`所属板块热度高，板块分 ${round(sectorHeat)}`);
  if (moneyFlow >= 65) reasons.push(`个股主力资金流改善，资金分 ${round(moneyFlow)}`);
  if (stock.industry) reasons.push(`行业：${stock.industry}`);
  return reasons.length > 0 ? reasons : ["满足基础流动性和市场过滤条件"];
}

function buildRisks(stock: StockSnapshot, limitUp: LimitUpSnapshot | undefined, mode: "intraday" | "post_close", pullback?: PullbackEvaluation | null): string[] {
  const risks: string[] = [];
  if (mode === "intraday") risks.push("盘中推荐为参考结果，免费源可能延迟");
  if (pullback?.matched) risks.push(...pullback.risks);
  if (limitUp && limitUp.openCount >= 3) risks.push("涨停开板次数较多，封板稳定性一般");
  if (limitUp && limitUp.consecutive >= 5) risks.push("连板高度较高，注意高位波动");
  if (stock.turnoverRate > 35) risks.push("换手率较高");
  if (stock.volumeRatio > 5) risks.push("量比过高，可能存在情绪过热");
  return risks;
}

function isDailyBarStrategy(dsl: StrategyDsl): boolean {
  return Boolean(dsl.strategyTemplates?.some((template) => template === "limit_up_pullback" || template === "limit_up_double_volume_bearish" || template === "limit_up_bearish_pullback"));
}

function isLimitUpPullbackStrategy(dsl: StrategyDsl): boolean {
  return Boolean(dsl.strategyTemplates?.includes("limit_up_pullback"));
}

function isLimitUpDoubleVolumeBearishStrategy(dsl: StrategyDsl): boolean {
  return Boolean(dsl.strategyTemplates?.includes("limit_up_double_volume_bearish"));
}

function isLimitUpBearishPullbackStrategy(dsl: StrategyDsl): boolean {
  return Boolean(dsl.strategyTemplates?.includes("limit_up_bearish_pullback"));
}

function evaluateStrategyTemplate(stock: StockSnapshot, dsl: StrategyDsl, dailyBars: DailyBar[] | undefined, tradeDate: string): PullbackEvaluation | null {
  return evaluateLimitUpBearishPullback(stock, dsl, dailyBars, tradeDate) ?? evaluateLimitUpDoubleVolumeBearish(stock, dsl, dailyBars, tradeDate) ?? evaluateLimitUpPullback(stock, dsl, dailyBars, tradeDate);
}

function evaluateLimitUpBearishPullback(stock: StockSnapshot, dsl: StrategyDsl, dailyBars: DailyBar[] | undefined, tradeDate: string): PullbackEvaluation | null {
  if (!isLimitUpBearishPullbackStrategy(dsl)) return null;
  const prepared = prepareBarsForEvaluation(stock, dailyBars, tradeDate);
  if (!prepared) return { matched: false, score: 0, reasons: [], risks: ["缺少30日日线缓存，无法验证涨停回踩阴线条件"], factors: { bearishPullbackMatch: 0 } };

  const { bars, current } = prepared;
  const currentIndex = bars.findIndex((bar) => bar.tradeDate === current.tradeDate);
  const previous = currentIndex > 0 ? bars[currentIndex - 1] : undefined;
  const recentDays = dsl.filters.recentLimitUpDays ?? 5;
  const recentLimitUp = bars.slice(Math.max(0, currentIndex - recentDays), currentIndex).reverse().find(isSolidLimitUpBar);
  const limitUpIndex = recentLimitUp ? bars.findIndex((bar) => bar.tradeDate === recentLimitUp.tradeDate) : -1;
  const adjustmentWindow = limitUpIndex >= 0 ? bars.slice(limitUpIndex + 1, currentIndex + 1) : [];
  const maBars = bars.slice(0, currentIndex).concat(current);
  const ma10 = movingAverage(maBars, 10);
  const twentyDayBars = bars.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
  const fiveDayBars = bars.slice(Math.max(0, currentIndex - 4), currentIndex + 1);
  const todayPctChange = current.pctChange || (previous && previous.close > 0 ? ((current.close - previous.close) / previous.close) * 100 : 0);
  const twentyDayRangePct = twentyDayBars.length >= 20 ? rangePct(twentyDayBars) : undefined;
  const fiveDayAvgAmount = fiveDayBars.length >= 5 ? avg(fiveDayBars.map((bar) => bar.amount)) : undefined;
  const lowestPullbackLow = adjustmentWindow.length ? Math.min(...adjustmentWindow.map((bar) => bar.low)) : 0;
  const bearishAdjustmentBars = adjustmentWindow.filter(isBearishBar);

  const hasRecentSolidLimitUp = Boolean(recentLimitUp);
  const hasBearishAdjustment = !dsl.filters.requirePostLimitUpBearishPullback || bearishAdjustmentBars.length > 0;
  const holdsLimitOpen = !dsl.filters.requirePullbackLowAboveLimitOpen || Boolean(recentLimitUp && lowestPullbackLow >= recentLimitUp.open);
  const bearishToday = !dsl.filters.requireBearishCandle || current.close < current.open;
  const aboveMa10 = dsl.filters.requireAboveMa !== "ma10" || (ma10 > 0 && current.close >= ma10);
  const withinTodayGain = dsl.filters.maxTodayPctChange === undefined || todayPctChange < dsl.filters.maxTodayPctChange;
  const withinTwentyDayRange = dsl.filters.maxTwentyDayRangePct === undefined || (twentyDayRangePct !== undefined && twentyDayRangePct < dsl.filters.maxTwentyDayRangePct);
  const aboveMinPrice = dsl.filters.minPrice === undefined || current.close > dsl.filters.minPrice;
  const enoughFiveDayAmount = dsl.filters.minFiveDayAvgAmount === undefined || (fiveDayAvgAmount !== undefined && fiveDayAvgAmount > dsl.filters.minFiveDayAvgAmount);
  const matched = hasRecentSolidLimitUp && hasBearishAdjustment && holdsLimitOpen && bearishToday && aboveMa10 && withinTodayGain && withinTwentyDayRange && aboveMinPrice && enoughFiveDayAmount;

  if (!matched) {
    return {
      matched,
      score: 0,
      reasons: [],
      risks: [
        !hasRecentSolidLimitUp ? `近${recentDays}个交易日未识别到实体涨停` : "",
        !hasBearishAdjustment ? "涨停后未出现阴线调整" : "",
        !holdsLimitOpen ? "调整区间最低价跌破涨停当日开盘价" : "",
        !bearishToday ? "今日不是阴线" : "",
        !aboveMa10 ? "今日收盘价跌破10日均线" : "",
        !withinTodayGain ? `今日涨幅 ${round(todayPctChange)}% 不小于 ${round(dsl.filters.maxTodayPctChange ?? 0)}%` : "",
        !withinTwentyDayRange
          ? twentyDayRangePct === undefined
            ? "近20日K线不足，无法验证最大涨幅"
            : `近20日最大涨幅 ${round(twentyDayRangePct)}% 不小于 ${round(dsl.filters.maxTwentyDayRangePct ?? 0)}%`
          : "",
        !aboveMinPrice ? `股价 ${round(current.close)} 元不大于 ${round(dsl.filters.minPrice ?? 0)} 元` : "",
        !enoughFiveDayAmount
          ? fiveDayAvgAmount === undefined
            ? "近5日成交额数据不足"
            : `近5日日均成交额 ${formatYi(fiveDayAvgAmount)} 不大于 ${formatYi(dsl.filters.minFiveDayAvgAmount ?? 0)}`
          : ""
      ].filter(Boolean),
      factors: { bearishPullbackMatch: 0 }
    };
  }

  const daysAgo = currentIndex - limitUpIndex;
  const supportDistancePct = recentLimitUp && recentLimitUp.open > 0 ? ((lowestPullbackLow - recentLimitUp.open) / recentLimitUp.open) * 100 : 0;
  const ma10DistancePct = ma10 > 0 ? ((current.close - ma10) / ma10) * 100 : 99;
  const volumeExpansionRatio = previous && previous.volume > 0 ? current.volume / previous.volume : 1;
  const contractionHits = bearishAdjustmentBars.filter((bar) => {
    const index = bars.findIndex((item) => item.tradeDate === bar.tradeDate);
    const reference = index > 0 ? bars[index - 1] : undefined;
    return Boolean(reference && reference.volume > 0 && bar.volume > 0 && bar.volume < reference.volume);
  }).length;
  const contractionScore = bearishAdjustmentBars.length ? (contractionHits / bearishAdjustmentBars.length) * 100 : 0;
  const rangeRoomScore = dsl.filters.maxTwentyDayRangePct && twentyDayRangePct !== undefined
    ? clamp(scale(dsl.filters.maxTwentyDayRangePct - twentyDayRangePct, 0, dsl.filters.maxTwentyDayRangePct), 0, 100)
    : 50;
  const pullbackScore = clamp(
    48 +
      clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100) * 0.18 +
      clamp(scale(supportDistancePct, 0, 8), 0, 100) * 0.14 +
      clamp(scale(3 - Math.max(ma10DistancePct, 0), 0, 3), 0, 100) * 0.14 +
      contractionScore * 0.12 +
      clamp(scale(volumeExpansionRatio, 0.6, 2), 0, 100) * 0.08 +
      rangeRoomScore * 0.12 +
      clamp(scale((fiveDayAvgAmount ?? 0) / 10_000_000, 3, 20), 0, 100) * 0.1,
    0,
    100
  );

  return {
    matched,
    score: pullbackScore,
    reasons: [
      `近${recentDays}日内 ${recentLimitUp?.tradeDate} 出现实体涨停，涨停日开盘价 ${round(recentLimitUp?.open ?? 0)}`,
      `涨停后出现 ${bearishAdjustmentBars.length} 根阴线调整，区间最低价 ${round(lowestPullbackLow)} 未跌破涨停日开盘价`,
      `今日收阴且未跌破10日均线：收盘 ${round(current.close)}，MA10 ${round(ma10)}`,
      `今日成交量为昨日 ${round(volumeExpansionRatio * 100)}%，涨幅 ${round(todayPctChange)}%`,
      `近20日最大涨幅 ${round(twentyDayRangePct ?? 0)}%，近5日日均成交额 ${formatYi(fiveDayAvgAmount ?? 0)}`
    ],
    risks: [
      supportDistancePct < 1 ? "调整低点距离涨停日开盘价支撑较近，跌破后形态失效" : "",
      ma10DistancePct < 1 ? "收盘价贴近10日均线，继续走弱会触发破位" : "",
      contractionScore < 50 ? "阴线调整缩量不充分，承接质量需继续观察" : ""
    ].filter(Boolean),
    factors: {
      bearishPullbackMatch: round(pullbackScore),
      limitUpRecency: round(clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100)),
      bearishAdjustmentCount: bearishAdjustmentBars.length,
      pullbackVolumeContraction: round(contractionScore),
      supportDistancePct: round(supportDistancePct),
      ma10DistancePct: round(ma10DistancePct),
      todayVolumeVsYesterday: round(volumeExpansionRatio),
      todayPctChange: round(todayPctChange),
      twentyDayRangePct: round(twentyDayRangePct ?? 0),
      fiveDayAvgAmount: round(fiveDayAvgAmount ?? 0)
    }
  };
}

function evaluateLimitUpDoubleVolumeBearish(stock: StockSnapshot, dsl: StrategyDsl, dailyBars: DailyBar[] | undefined, tradeDate: string): PullbackEvaluation | null {
  if (!isLimitUpDoubleVolumeBearishStrategy(dsl)) return null;
  const prepared = prepareBarsForEvaluation(stock, dailyBars, tradeDate);
  if (!prepared) return { matched: false, score: 0, reasons: [], risks: ["缺少30日日线缓存，无法验证涨停倍量阴条件"], factors: { doubleVolumeBearishMatch: 0 } };

  const { bars, current } = prepared;
  const currentIndex = bars.findIndex((bar) => bar.tradeDate === current.tradeDate);
  const previous = currentIndex > 0 ? bars[currentIndex - 1] : undefined;
  const recentDays = dsl.filters.recentLimitUpDays ?? 5;
  const recentLimitUp = bars.slice(Math.max(0, currentIndex - recentDays), currentIndex).reverse().find(isSolidLimitUpBar);
  const limitUpIndex = recentLimitUp ? bars.findIndex((bar) => bar.tradeDate === recentLimitUp.tradeDate) : -1;
  const adjustmentBars = limitUpIndex >= 0 ? bars.slice(limitUpIndex + 1, currentIndex) : [];
  const pullbackWindow = limitUpIndex >= 0 ? bars.slice(limitUpIndex + 1, currentIndex + 1) : [];
  const maBars = bars.slice(0, currentIndex).concat(current);
  const ma10 = movingAverage(maBars, 10);
  const twentyDayBars = bars.slice(Math.max(0, currentIndex - 19), currentIndex + 1);
  const fiveDayBars = bars.slice(Math.max(0, currentIndex - 4), currentIndex + 1);
  const todayPctChange = current.pctChange || (previous && previous.close > 0 ? ((current.close - previous.close) / previous.close) * 100 : 0);
  const twentyDayRangePct = twentyDayBars.length >= 20 ? rangePct(twentyDayBars) : undefined;
  const fiveDayAvgAmount = fiveDayBars.length >= 5 ? avg(fiveDayBars.map((bar) => bar.amount)) : undefined;
  const lowestPullbackLow = pullbackWindow.length ? Math.min(...pullbackWindow.map((bar) => bar.low)) : 0;

  const hasRecentSolidLimitUp = Boolean(recentLimitUp);
  const hasAdjustment = adjustmentBars.length > 0;
  const bearishPullback = !dsl.filters.requirePostLimitUpBearishPullback || (hasAdjustment && adjustmentBars.every(isBearishBar));
  const pullbackVolumeContraction = !dsl.filters.requirePullbackVolumeContraction || (
    hasAdjustment && adjustmentBars.every((bar, index) => {
      const reference = bars[limitUpIndex + index];
      return reference?.volume > 0 && bar.volume > 0 && bar.volume < reference.volume;
    })
  );
  const holdsLimitOpen = !dsl.filters.requirePullbackLowAboveLimitOpen || Boolean(recentLimitUp && lowestPullbackLow >= recentLimitUp.open);
  const bullishClose = !dsl.filters.requireBullishClose || current.close > current.open;
  const aboveMa10 = dsl.filters.requireAboveMa !== "ma10" || (ma10 > 0 && current.close > ma10);
  const volumeExpansion = !dsl.filters.requireVolumeExpansionVsYesterday || Boolean(previous && current.volume > previous.volume);
  const withinTodayGain = dsl.filters.maxTodayPctChange === undefined || todayPctChange < dsl.filters.maxTodayPctChange;
  const withinTwentyDayRange = dsl.filters.maxTwentyDayRangePct === undefined || (twentyDayRangePct !== undefined && twentyDayRangePct < dsl.filters.maxTwentyDayRangePct);
  const aboveMinPrice = dsl.filters.minPrice === undefined || current.close > dsl.filters.minPrice;
  const enoughFiveDayAmount = dsl.filters.minFiveDayAvgAmount === undefined || (fiveDayAvgAmount !== undefined && fiveDayAvgAmount > dsl.filters.minFiveDayAvgAmount);
  const matched = hasRecentSolidLimitUp && bearishPullback && pullbackVolumeContraction && holdsLimitOpen && bullishClose && aboveMa10 && volumeExpansion && withinTodayGain && withinTwentyDayRange && aboveMinPrice && enoughFiveDayAmount;

  if (!matched) {
    return {
      matched,
      score: 0,
      reasons: [],
      risks: [
        !hasRecentSolidLimitUp ? `近${recentDays}个交易日未识别到实体涨停` : "",
        !hasAdjustment ? "涨停后没有调整日" : "",
        !bearishPullback ? "涨停后调整日不是连续阴线" : "",
        !pullbackVolumeContraction ? "涨停后调整日未缩量" : "",
        !holdsLimitOpen ? "调整区间最低价跌破涨停当日开盘价" : "",
        !bullishClose ? "今日不是阳线" : "",
        !aboveMa10 ? "今日收盘价未站上10日均线" : "",
        !volumeExpansion ? "今日成交量未大于昨日成交量" : "",
        !withinTodayGain ? `今日涨幅 ${round(todayPctChange)}% 不小于 ${round(dsl.filters.maxTodayPctChange ?? 0)}%` : "",
        !withinTwentyDayRange
          ? twentyDayRangePct === undefined
            ? "近20日K线不足，无法验证最大涨幅"
            : `近20日最大涨幅 ${round(twentyDayRangePct)}% 不小于 ${round(dsl.filters.maxTwentyDayRangePct ?? 0)}%`
          : "",
        !aboveMinPrice ? `股价 ${round(current.close)} 元不大于 ${round(dsl.filters.minPrice ?? 0)} 元` : "",
        !enoughFiveDayAmount
          ? fiveDayAvgAmount === undefined
            ? "近5日成交额数据不足"
            : `近5日日均成交额 ${formatYi(fiveDayAvgAmount)} 不大于 ${formatYi(dsl.filters.minFiveDayAvgAmount ?? 0)}`
          : ""
      ].filter(Boolean),
      factors: { doubleVolumeBearishMatch: 0 }
    };
  }

  const daysAgo = currentIndex - limitUpIndex;
  const supportDistancePct = recentLimitUp && recentLimitUp.open > 0 ? ((lowestPullbackLow - recentLimitUp.open) / recentLimitUp.open) * 100 : 0;
  const ma10DistancePct = ma10 > 0 ? ((current.close - ma10) / ma10) * 100 : 99;
  const volumeExpansionRatio = previous && previous.volume > 0 ? current.volume / previous.volume : 1;
  const rangeRoomScore = dsl.filters.maxTwentyDayRangePct && twentyDayRangePct !== undefined
    ? clamp(scale(dsl.filters.maxTwentyDayRangePct - twentyDayRangePct, 0, dsl.filters.maxTwentyDayRangePct), 0, 100)
    : 50;
  const pullbackScore = clamp(
    48 +
      clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100) * 0.18 +
      clamp(scale(supportDistancePct, 0, 8), 0, 100) * 0.12 +
      clamp(scale(4 - Math.abs(adjustmentBars.length - 2), 0, 4), 0, 100) * 0.12 +
      clamp(scale(3 - ma10DistancePct, 0, 3), 0, 100) * 0.12 +
      clamp(scale(volumeExpansionRatio, 1, 2.5), 0, 100) * 0.12 +
      rangeRoomScore * 0.12 +
      clamp(scale((fiveDayAvgAmount ?? 0) / 10_000_000, 3, 20), 0, 100) * 0.1,
    0,
    100
  );

  return {
    matched,
    score: pullbackScore,
    reasons: [
      `近${recentDays}日内 ${recentLimitUp?.tradeDate} 出现实体涨停，涨停日开盘价 ${round(recentLimitUp?.open ?? 0)}`,
      `涨停后 ${adjustmentBars.length} 个交易日缩量阴线调整，区间最低价 ${round(lowestPullbackLow)} 未跌破涨停日开盘价`,
      `今日收阳并站上10日均线：收盘 ${round(current.close)}，MA10 ${round(ma10)}`,
      `今日成交量为昨日 ${round(volumeExpansionRatio * 100)}%，涨幅 ${round(todayPctChange)}%`,
      `近20日最大涨幅 ${round(twentyDayRangePct ?? 0)}%，近5日日均成交额 ${formatYi(fiveDayAvgAmount ?? 0)}`
    ],
    risks: [
      supportDistancePct < 1 ? "调整低点距离涨停日开盘价支撑较近，跌破后形态失效" : "",
      ma10DistancePct > 6 ? "收盘价距离10日均线偏远，追高性价比下降" : ""
    ].filter(Boolean),
    factors: {
      doubleVolumeBearishMatch: round(pullbackScore),
      limitUpRecency: round(clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100)),
      pullbackDays: adjustmentBars.length,
      supportDistancePct: round(supportDistancePct),
      ma10DistancePct: round(ma10DistancePct),
      todayVolumeVsYesterday: round(volumeExpansionRatio),
      todayPctChange: round(todayPctChange),
      twentyDayRangePct: round(twentyDayRangePct ?? 0),
      fiveDayAvgAmount: round(fiveDayAvgAmount ?? 0)
    }
  };
}

function evaluateLimitUpPullback(stock: StockSnapshot, dsl: StrategyDsl, dailyBars: DailyBar[] | undefined, tradeDate: string): PullbackEvaluation | null {
  if (!isLimitUpPullbackStrategy(dsl)) return null;
  const prepared = prepareBarsForEvaluation(stock, dailyBars, tradeDate);
  if (!prepared) return { matched: false, score: 0, reasons: [], risks: ["缺少30日日线缓存，无法验证涨停回调条件"], factors: { pullbackMatch: 0 } };

  const { bars, current } = prepared;
  const currentIndex = bars.findIndex((bar) => bar.tradeDate === current.tradeDate);
  const priorBars = bars.slice(0, currentIndex >= 0 ? currentIndex : -1);
  const previous = priorBars.at(-1);
  const recentDays = dsl.filters.recentLimitUpDays ?? 10;
  const recentLimitUp = priorBars.slice(-recentDays).reverse().find(isLimitUpBar);
  const maBars = [...priorBars, current];
  const ma5 = movingAverage(maBars, 5);
  const ma10 = movingAverage(maBars, 10);
  const ma20 = movingAverage(maBars, 20);
  const twentyDayReference = maBars.length >= 20 ? maBars.at(-20) : undefined;
  const twentyDayGainPct = twentyDayReference && twentyDayReference.close > 0
    ? ((current.close - twentyDayReference.close) / twentyDayReference.close) * 100
    : undefined;
  const maxTwentyDayGainPct = dsl.filters.maxTwentyDayGainPct;

  const hasRecentLimitUp = Boolean(recentLimitUp);
  const bearish = !dsl.filters.requireBearishCandle || current.close < current.open;
  const holdsLimitPrice = !dsl.filters.requireHoldLimitUpPrice || Boolean(recentLimitUp && current.low >= recentLimitUp.close);
  const maProximity = closestMaProximity(current.close, ma5, ma10);
  const maxMaDistancePct = dsl.filters.maxMaDistancePct;
  const aboveMa = dsl.filters.requireAboveMa !== "ma5_or_ma10" || Boolean(maProximity);
  const nearMa = maxMaDistancePct === undefined || Boolean(maProximity && maProximity.distancePct <= maxMaDistancePct);
  const volumeContraction = !dsl.filters.requireVolumeContraction || Boolean(previous && current.volume > 0 && previous.volume > 0 && current.volume < previous.volume);
  const withinTwentyDayGain = maxTwentyDayGainPct === undefined || (twentyDayGainPct !== undefined && twentyDayGainPct <= maxTwentyDayGainPct);
  const bullishMaAlignment = !dsl.filters.requireBullishMaAlignment || Boolean(ma5 > 0 && ma10 > 0 && ma20 > 0 && ma5 > ma10 && ma10 > ma20);
  const matched = hasRecentLimitUp && bearish && holdsLimitPrice && aboveMa && nearMa && volumeContraction && withinTwentyDayGain && bullishMaAlignment;
  const maFailure = !aboveMa
    ? "收盘价未站上5日线或10日线"
    : !nearMa && maProximity
      ? `收盘价距${maProximity.label} ${round(maProximity.distancePct)}%，超过附近阈值 ${round(maxMaDistancePct ?? 0)}%`
      : !nearMa
        ? "收盘价未贴近5日线或10日线"
        : "";

  if (!matched) {
    return {
      matched,
      score: 0,
      reasons: [],
      risks: [
        !hasRecentLimitUp ? `近${recentDays}个交易日未识别到涨停` : "",
        !bearish ? "今日不是阴线" : "",
        !holdsLimitPrice ? "今日低点已跌破最近涨停价" : "",
        maFailure,
        !volumeContraction ? "阴线未缩量" : "",
        !withinTwentyDayGain
          ? twentyDayGainPct === undefined
            ? "近20日涨幅数据不足"
            : `近20日涨幅 ${round(twentyDayGainPct)}% 超过 ${round(maxTwentyDayGainPct ?? 0)}%`
          : "",
        !bullishMaAlignment ? "均线未形成 MA5 > MA10 > MA20 的多头排列" : ""
      ].filter(Boolean),
      factors: { pullbackMatch: 0 }
    };
  }

  const daysAgo = recentLimitUp ? priorBars.length - priorBars.findIndex((bar) => bar.tradeDate === recentLimitUp.tradeDate) : recentDays;
  const shrinkRatio = previous && previous.volume > 0 ? current.volume / previous.volume : 1;
  const holdDistance = recentLimitUp ? ((current.low - recentLimitUp.close) / recentLimitUp.close) * 100 : 0;
  const maDistancePct = maProximity?.distancePct ?? 99;
  const maSupport = maxMaDistancePct !== undefined
    ? clamp(scale(maxMaDistancePct - maDistancePct, 0, maxMaDistancePct), 0, 100)
    : Math.max(scale(current.close, Math.min(ma5, ma10) * 0.98, Math.max(ma5, ma10) * 1.06), 0);
  const gainRoomScore = maxTwentyDayGainPct === undefined || twentyDayGainPct === undefined
    ? 50
    : clamp(scale(maxTwentyDayGainPct - Math.max(twentyDayGainPct, 0), 0, maxTwentyDayGainPct), 0, 100);
  const pullbackScore = clamp(
    28 +
      clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100) * 0.16 +
      clamp(scale(1 - shrinkRatio, 0, 0.55), 0, 100) * 0.2 +
      clamp(scale(holdDistance, 0, 8), 0, 100) * 0.1 +
      clamp(maSupport, 0, 100) * 0.1 +
      gainRoomScore * 0.12 +
      (bullishMaAlignment ? 100 : 0) * 0.14,
    0,
    100
  );

  const reasons = [
    `近${recentDays}日内 ${recentLimitUp?.tradeDate} 曾涨停，当前未跌破涨停价 ${round(recentLimitUp?.close ?? 0)}`,
    `今日阴线缩量，成交量为前一交易日 ${round(shrinkRatio * 100)}%`,
    maProximity
      ? `收盘价 ${round(current.close)} 站上并贴近 ${maProximity.label} ${round(maProximity.value)}，距离 ${round(maDistancePct)}%`
      : `收盘价 ${round(current.close)} 站上5日线或10日线`,
    `近20日涨幅 ${round(twentyDayGainPct ?? 0)}%，未超过 ${round(maxTwentyDayGainPct ?? 25)}%`,
    `均线多头排列：MA5 ${round(ma5)} > MA10 ${round(ma10)} > MA20 ${round(ma20)}`
  ];
  const risks = [
    holdDistance < 1 ? "距离最近涨停价支撑较近，破位需快速降权" : "",
    maxMaDistancePct !== undefined && maDistancePct > maxMaDistancePct * 0.75
      ? `距离${maProximity?.label ?? "均线"}支撑接近阈值，继续上冲而不回踩会降权`
      : ""
  ].filter(Boolean);

  return {
    matched,
    score: pullbackScore,
    reasons,
    risks,
    factors: {
      pullbackMatch: round(pullbackScore),
      limitUpRecency: round(clamp(scale(recentDays - daysAgo + 1, 0, recentDays), 0, 100)),
      volumeContraction: round(clamp(scale(1 - shrinkRatio, 0, 0.55), 0, 100)),
      maSupport: round(clamp(maSupport, 0, 100)),
      maDistancePct: round(maDistancePct),
      twentyDayGain: round(twentyDayGainPct ?? 0),
      bullishMaAlignment: bullishMaAlignment ? 100 : 0
    }
  };
}

function groupDailyBars(bars: DailyBar[]): Map<string, DailyBar[]> {
  const grouped = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const current = grouped.get(bar.code) ?? [];
    current.push(bar);
    grouped.set(bar.code, current);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
  return grouped;
}

function prepareBarsForEvaluation(stock: StockSnapshot, dailyBars: DailyBar[] | undefined, tradeDate: string): { bars: DailyBar[]; current: DailyBar } | null {
  const bars = [...(dailyBars ?? [])].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const currentFromBars = bars.find((bar) => bar.tradeDate === tradeDate);
  if (currentFromBars) {
    const current = hydrateCurrentBar(currentFromBars, stock);
    const nextBars = bars.map((bar) => (bar.tradeDate === current.tradeDate ? current : bar));
    return { bars: nextBars, current };
  }

  const previous = bars.at(-1);
  if (!tradeDate || !previous || !stock.close) return null;
  const current = stockSnapshotToDailyBar(stock, tradeDate, previous);
  return {
    bars: [...bars, current].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
    current
  };
}

function hydrateCurrentBar(bar: DailyBar, stock: StockSnapshot): DailyBar {
  return {
    ...bar,
    open: bar.open || stock.open || bar.close,
    high: bar.high || stock.high || bar.close,
    low: bar.low || stock.low || bar.close,
    close: bar.close || stock.close,
    volume: bar.volume || stock.volume || 0,
    amount: bar.amount || stock.turnoverAmount || 0,
    pctChange: bar.pctChange || stock.pctChange || 0
  };
}

function stockSnapshotToDailyBar(stock: StockSnapshot, tradeDate: string, previous: DailyBar): DailyBar {
  const close = stock.close || previous.close;
  const open = stock.open || close;
  const pctChange = stock.pctChange || (previous.close > 0 ? ((close - previous.close) / previous.close) * 100 : 0);
  return {
    tradeDate,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    open,
    high: stock.high || Math.max(open, close),
    low: stock.low || Math.min(open, close),
    close,
    volume: stock.volume || 0,
    amount: stock.turnoverAmount || 0,
    pctChange,
    turnoverRate: stock.turnoverRate || 0,
    provider: "intraday-snapshot"
  };
}

function isLimitUpBar(bar: DailyBar): boolean {
  return bar.pctChange >= 9.8 || (bar.open > 0 && ((bar.close - bar.open) / bar.open) * 100 >= 9.8);
}

function isSolidLimitUpBar(bar: DailyBar): boolean {
  return bar.pctChange >= 9.8 && bar.close > bar.open;
}

function isBearishBar(bar: DailyBar): boolean {
  return bar.close < bar.open;
}

function closestMaProximity(close: number, ma5: number, ma10: number): { label: "MA5" | "MA10"; value: number; distancePct: number } | null {
  const candidates = [
    { label: "MA5" as const, value: ma5 },
    { label: "MA10" as const, value: ma10 }
  ]
    .filter((item) => item.value > 0 && close >= item.value)
    .map((item) => ({
      ...item,
      distancePct: ((close - item.value) / item.value) * 100
    }))
    .sort((a, b) => a.distancePct - b.distancePct);

  return candidates[0] ?? null;
}

function movingAverage(bars: DailyBar[], days: number): number {
  const values = bars.slice(-days).map((bar) => bar.close).filter((value) => value > 0);
  if (!values.length) return 0;
  return avg(values);
}

function rangePct(bars: DailyBar[]): number {
  const lows = bars.map((bar) => bar.low).filter((value) => value > 0);
  if (!lows.length) return 0;
  const minLow = Math.min(...lows);
  const maxHigh = Math.max(...bars.map((bar) => bar.high));
  return ((maxHigh - minLow) / minLow) * 100;
}

function scale(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((value - min) / (max - min)) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatYi(value: number): string {
  return `${round(value / 100_000_000)} 亿`;
}
