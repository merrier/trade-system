export type Market = "main" | "gem" | "star" | "bse";
export type RunMode = "intraday" | "post_close";
export type SectorType = "industry" | "concept";
export type StrategyStyle = "short_term" | "stable" | "custom";
export type StrategyTemplate = "limit_up_pullback";
export type MarketDataSource = "akshare" | "akshare_partial" | "efinance" | "baostock" | "tushare" | "provider_chain" | "sample";
export type ReportKind = "morning" | "intraday-selection" | "close";

export interface StrategyDsl {
  style: StrategyStyle;
  markets: Market[];
  strategyTemplates?: StrategyTemplate[];
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
    recentLimitUpDays?: number;
    requireBearishCandle?: boolean;
    requireHoldLimitUpPrice?: boolean;
    requireAboveMa?: "ma5_or_ma10";
    requireVolumeContraction?: boolean;
    maxTwentyDayGainPct?: number;
    requireBullishMaAlignment?: boolean;
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
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  ma5?: number;
  isST?: boolean;
  isSuspended?: boolean;
  listedDays?: number;
  mainNetInflow?: number;
}

export interface DailyBar {
  tradeDate: string;
  code: string;
  name: string;
  market: Market;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  pctChange: number;
  turnoverRate: number;
  provider: string;
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
  source: MarketDataSource;
  warnings: string[];
  stocks: StockSnapshot[];
  limitUps: LimitUpSnapshot[];
  dragonTiger: DragonTigerSnapshot[];
  sectors: SectorSnapshot[];
}

export interface DataProviderRun {
  provider: string;
  command: string;
  status: "success" | "failed" | "partial";
  startedAt: string;
  finishedAt: string;
  warnings: string[];
  error?: string;
  rowCount?: number;
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

export interface StrategySnapshot {
  prompt: string;
  compiledDsl: StrategyDsl;
  warnings: string[];
  unsupported: string[];
  compiledAt: string;
  engine: "local" | "deepseek" | "hermes";
}

export interface ReportArtifact<TPayload = unknown> {
  id: string;
  kind: ReportKind;
  tradeDate: string;
  dataAsOf: string;
  provider: string;
  warnings: string[];
  payload: TPayload;
  analysis: string;
  rankingNarrative?: string;
  pushMessage: string;
  generatedAt: string;
}

export interface UsMarketBrief {
  asOf: string;
  previousSession: string;
  indices: Array<{ symbol: string; name: string; close: number; pctChange: number }>;
  futures: Array<{ symbol: string; name: string; price: number; pctChange: number }>;
  sectors: Array<{ symbol: string; name: string; pctChange: number }>;
  currencies: Array<{ symbol: string; name: string; price: number; pctChange: number }>;
  commodities: Array<{ symbol: string; name: string; price: number; pctChange: number }>;
}

export interface MorningReportPayload {
  brief: UsMarketBrief;
  aShareReadThrough: string[];
}

export interface IntradaySelectionReportPayload {
  strategy: StrategySnapshot;
  recommendations: RecommendationResult[];
  factorLegend: Record<string, string>;
}

export interface CloseReportPayload {
  marketBreadth: {
    total: number;
    up: number;
    down: number;
    flat: number;
    limitUp: number;
    limitDown: number;
    turnoverAmount: number;
  };
  limitUps: Array<LimitUpSnapshot & { strengthScore: number }>;
  sectors: Array<SectorSnapshot & { reasons: string[] }>;
  recommendations: RecommendationResult[];
}
