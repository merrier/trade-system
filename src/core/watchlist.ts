import { rankStocks } from "./scoring.js";
import type { MarketDataset, RecommendationResult, WatchConditionDsl } from "../shared/types.js";

export interface WatchEvaluation {
  triggered: boolean;
  priority: "high" | "medium" | "low";
  score: number;
  reasons: string[];
  risks: string[];
  recommendation?: RecommendationResult;
}

export function evaluateWatchCondition(code: string, condition: WatchConditionDsl, dataset: MarketDataset): WatchEvaluation {
  const stock = dataset.stocks.find((item) => item.code === code);
  if (!stock) {
    return { triggered: false, priority: "low", score: 0, reasons: [], risks: ["当前数据集中未找到该股票"] };
  }

  const sectorRank = getBestSectorRank(stock.industry, stock.concepts, dataset);
  const limitUp = dataset.limitUps.find((item) => item.code === code);
  const dragon = dataset.dragonTiger.find((item) => item.code === code);
  const reasons: string[] = [];
  const risks: string[] = [];
  let matched = 0;

  for (const template of condition.templates) {
    if (template === "volume_breakout" && stock.volumeRatio >= Number(condition.params.volumeRatio ?? 1.8)) {
      matched += 1;
      reasons.push(`量比 ${stock.volumeRatio} 达到放量条件`);
    }
    if (template === "ma_breakout" && stock.ma5 && stock.close >= stock.ma5) {
      matched += 1;
      reasons.push(`收盘/最新价 ${stock.close} 突破 5 日均线 ${stock.ma5}`);
    }
    if (template === "money_inflow_positive" && (stock.mainNetInflow ?? 0) > 0) {
      matched += 1;
      reasons.push(`主力净流入转正 ${formatYi(stock.mainNetInflow ?? 0)}`);
    }
    if (template === "sector_top_n" && sectorRank > 0 && sectorRank <= Number(condition.params.sectorTopN ?? 3)) {
      matched += 1;
      reasons.push(`所属板块进入天梯第 ${sectorRank} 名`);
    }
    if (template === "limit_up_or_reseal" && limitUp) {
      matched += 1;
      reasons.push(`进入涨停池，${limitUp.consecutive} 连板`);
    }
    if (template === "dragon_tiger_listed" && dragon) {
      matched += 1;
      reasons.push(`龙虎榜上榜，净买入 ${formatYi(dragon.netAmount)}`);
    }
    if (template === "stop_loss_break" && Number(condition.params.stopLossPrice ?? 0) > 0 && stock.close <= Number(condition.params.stopLossPrice)) {
      risks.push(`跌破止损价 ${condition.params.stopLossPrice}`);
    }
  }

  const score = Math.round((matched / Math.max(1, condition.templates.length)) * 100);
  const triggered = matched > 0 && matched >= Math.ceil(condition.templates.length / 2);
  const priority = score >= 80 ? "high" : score >= 50 ? "medium" : "low";

  return { triggered, priority, score, reasons, risks };
}

export function attachRecommendation(code: string, evaluation: WatchEvaluation, dataset: MarketDataset, dsl: Parameters<typeof rankStocks>[1]): WatchEvaluation {
  if (!evaluation.triggered) return evaluation;
  const recommendation = rankStocks(dataset, dsl, "intraday").find((item) => item.code === code);
  return { ...evaluation, recommendation };
}

function getBestSectorRank(industry: string | undefined, concepts: string[], dataset: MarketDataset): number {
  const ranked = [...dataset.sectors].sort((a, b) => b.heatScore - a.heatScore);
  const names = new Set([industry, ...concepts].filter(Boolean));
  const index = ranked.findIndex((sector) => names.has(sector.name));
  return index >= 0 ? index + 1 : 0;
}

function formatYi(value: number): string {
  return `${Math.round((value / 100_000_000) * 100) / 100} 亿`;
}
