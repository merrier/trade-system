import type {
  DragonTigerSnapshot,
  LimitUpSnapshot,
  MarketDataset,
  RecommendationResult,
  SectorSnapshot,
  StockSnapshot,
  StrategyDsl
} from "../shared/types.js";

export function rankStocks(dataset: MarketDataset, dsl: StrategyDsl, mode: "intraday" | "post_close"): RecommendationResult[] {
  const sectorScores = rankSectors(dataset).reduce<Map<string, number>>((acc, sector, index) => {
    acc.set(`${sector.type}:${sector.name}`, Math.max(0, 100 - index * 4));
    return acc;
  }, new Map());

  const limitUpByCode = new Map(dataset.limitUps.map((item) => [item.code, item]));
  const dragonByCode = new Map(dataset.dragonTiger.map((item) => [item.code, item]));

  return dataset.stocks
    .filter((stock) => passesFilters(stock, dsl, limitUpByCode.get(stock.code)))
    .map((stock) => scoreStock(stock, dsl, limitUpByCode.get(stock.code), dragonByCode.get(stock.code), dataset.sectors, sectorScores, mode, dataset.dataAsOf))
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
  dataAsOf: string
): RecommendationResult {
  const strategyMatch = getStrategyMatch(stock, dsl, limitUp, dragon);
  const limitUpStrength = limitUp ? clamp(limitUp.consecutive * 18 + (limitUp.openCount === 0 ? 18 : 8) + scale(limitUp.sealedAmount, 0, 800_000_000) * 0.3, 0, 100) : 0;
  const dragonTiger = dragon ? clamp(scale(dragon.netAmount, -80_000_000, 180_000_000), 0, 100) : 30;
  const sectorHeat = getSectorHeat(stock, sectors, sectorScores);
  const moneyFlow = clamp(scale(stock.mainNetInflow ?? 0, -60_000_000, 120_000_000), 0, 100);
  const liquidity = clamp(scale(stock.turnoverAmount, dsl.filters.minTurnoverAmount, 2_000_000_000), 0, 100);
  const riskPenalty = getRiskPenalty(stock, limitUp, dragon);

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

  const reasons = buildReasons(stock, limitUp, dragon, sectorHeat, moneyFlow);
  const risks = buildRisks(stock, limitUp, mode);
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
      riskPenalty: round(riskPenalty)
    },
    dataAsOf
  };
}

function passesFilters(stock: StockSnapshot, dsl: StrategyDsl, limitUp?: LimitUpSnapshot): boolean {
  if (!dsl.markets.includes(stock.market)) return false;
  if (dsl.filters.excludeST && stock.isST) return false;
  if (dsl.filters.excludeSuspended && stock.isSuspended) return false;
  if ((stock.listedDays ?? 9999) < dsl.filters.excludeNewStocksDays) return false;
  if (stock.turnoverAmount < dsl.filters.minTurnoverAmount) return false;
  if (dsl.filters.maxOpenCount !== undefined && limitUp && limitUp.openCount > dsl.filters.maxOpenCount) return false;
  if (dsl.filters.minConsecutiveLimitUps !== undefined && limitUp && limitUp.consecutive < dsl.filters.minConsecutiveLimitUps) return false;
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

function getRiskPenalty(stock: StockSnapshot, limitUp?: LimitUpSnapshot, dragon?: DragonTigerSnapshot): number {
  let penalty = 0;
  if (stock.isST) penalty += 60;
  if (stock.isSuspended) penalty += 80;
  if (limitUp && limitUp.openCount >= 3) penalty += 16;
  if (limitUp && limitUp.consecutive >= 5) penalty += 18;
  if (dragon && dragon.netAmount < 0) penalty += 14;
  if (stock.turnoverRate > 35) penalty += 12;
  if (stock.volumeRatio > 5) penalty += 8;
  return clamp(penalty, 0, 100);
}

function buildReasons(stock: StockSnapshot, limitUp: LimitUpSnapshot | undefined, dragon: DragonTigerSnapshot | undefined, sectorHeat: number, moneyFlow: number): string[] {
  const reasons: string[] = [];
  if (limitUp) reasons.push(`${limitUp.consecutive} 连板，开板 ${limitUp.openCount} 次，封单 ${formatYi(limitUp.sealedAmount)}`);
  if (dragon && dragon.netAmount > 0) reasons.push(`龙虎榜净买入 ${formatYi(dragon.netAmount)}`);
  if (sectorHeat >= 70) reasons.push(`所属板块热度高，板块分 ${round(sectorHeat)}`);
  if (moneyFlow >= 65) reasons.push(`个股主力资金流改善，资金分 ${round(moneyFlow)}`);
  if (stock.industry) reasons.push(`行业：${stock.industry}`);
  return reasons.length > 0 ? reasons : ["满足基础流动性和市场过滤条件"];
}

function buildRisks(stock: StockSnapshot, limitUp: LimitUpSnapshot | undefined, mode: "intraday" | "post_close"): string[] {
  const risks: string[] = [];
  if (mode === "intraday") risks.push("盘中推荐为参考结果，免费源可能延迟");
  if (limitUp && limitUp.openCount >= 3) risks.push("涨停开板次数较多，封板稳定性一般");
  if (limitUp && limitUp.consecutive >= 5) risks.push("连板高度较高，注意高位波动");
  if (stock.turnoverRate > 35) risks.push("换手率较高");
  if (stock.volumeRatio > 5) risks.push("量比过高，可能存在情绪过热");
  return risks;
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
