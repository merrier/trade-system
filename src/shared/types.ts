export type Market = "main" | "gem" | "star" | "bse";
export type RunMode = "intraday" | "post_close";
export type SectorType = "industry" | "concept";
export type StrategyStyle = "short_term" | "stable" | "custom";

export interface StrategyDsl {
  style: StrategyStyle;
  markets: Market[];
  include: string[];
  exclude: string[];
  weights: {
    strategyMatch: number;
    limitUpStrength: number;
    dragonTiger: number;
    sectorHeat: number;
    moneyFlow: number;
    liquidity: number;
    riskPenalty: number;
  };
  filters: {
    excludeST: boolean;
    excludeSuspended: boolean;
    excludeNewStocksDays: number;
    minTurnoverAmount: number;
    maxOpenCount?: number;
    minConsecutiveLimitUps?: number;
    sectorTopN?: number;
  };
}

export interface WatchConditionDsl {
  templates: WatchTemplate[];
  prompt: string;
  markets: Market[];
  params: Record<string, number | string | boolean>;
}

export type WatchTemplate =
  | "volume_breakout"
  | "ma_breakout"
  | "money_inflow_positive"
  | "sector_top_n"
  | "limit_up_or_reseal"
  | "dragon_tiger_listed"
  | "stop_loss_break";

export interface StockSnapshot {
  code: string;
  name: string;
  market: Market;
  industry?: string;
  concepts: string[];
  pctChange: number;
  turnoverAmount: number;
  turnoverRate: number;
  volumeRatio: number;
  close: number;
  ma5?: number;
  isST?: boolean;
  isSuspended?: boolean;
  listedDays?: number;
  mainNetInflow?: number;
}

export interface LimitUpSnapshot {
  tradeDate: string;
  code: string;
  name: string;
  market: Market;
  industry?: string;
  concepts: string[];
  consecutive: number;
  firstLimitTime?: string;
  lastLimitTime?: string;
  openCount: number;
  sealedAmount: number;
  turnoverRate: number;
  pctChange: number;
}

export interface DragonTigerSnapshot {
  tradeDate: string;
  code: string;
  name: string;
  reason?: string;
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  seats: Array<{ name: string; side: "buy" | "sell"; amount: number }>;
}

export interface SectorSnapshot {
  tradeDate: string;
  name: string;
  type: SectorType;
  pctChange: number;
  inflowAmount: number;
  outflowAmount: number;
  netInflow: number;
  companyCount: number;
  limitUpCount: number;
  leaderCode?: string;
  leaderName?: string;
  leaderPctChange: number;
  heatScore: number;
  trend: number[];
}

export interface MarketDataset {
  tradeDate: string;
  dataAsOf: string;
  source: "akshare" | "akshare_partial" | "sample";
  warnings: string[];
  stocks: StockSnapshot[];
  limitUps: LimitUpSnapshot[];
  dragonTiger: DragonTigerSnapshot[];
  sectors: SectorSnapshot[];
}

export interface RecommendationResult {
  rank: number;
  code: string;
  name: string;
  market: Market;
  score: number;
  confidence: number;
  reasons: string[];
  risks: string[];
  factors: Record<string, number>;
  dataAsOf: string;
}

export interface CompileResult {
  dsl: StrategyDsl;
  warnings: string[];
  unsupported: string[];
}
