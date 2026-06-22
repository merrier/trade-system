import { createDefaultStrategy } from "./defaults.js";
import { compileStrategyLocally, compileWatchConditionLocally, strategyDslSchema, watchConditionDslSchema } from "./strategy.js";
import type { CompileResult, Market, StrategyDsl, StrategyStyle, WatchConditionDsl } from "../shared/types.js";

interface DeepSeekMessage {
  role: "system" | "user";
  content: string;
}

export interface DeepSeekLeaderAssessmentInput {
  code: string;
  name: string;
  limitUpReason: string;
  sectors: string[];
  sectorFlowRank?: {
    name: string;
    rank: number;
    netInflow: number;
  };
  stock?: {
    industry?: string;
    concepts: string[];
    pctChange: number;
    turnoverAmount: number;
    turnoverRate: number;
    mainNetInflow?: number;
  };
  sectorEvidence: Array<{
    name: string;
    type: string;
    leaderCode?: string;
    leaderName?: string;
    leaderPctChange: number;
    pctChange: number;
    netInflow: number;
    companyCount: number;
    limitUpCount: number;
  }>;
  peerLeaders: Array<{
    code: string;
    name: string;
    pctChange: number;
    turnoverAmount: number;
  }>;
  localReason: string;
}

export interface DeepSeekLeaderAssessment {
  status: "confirmed" | "likely" | "unknown";
  reason: string;
}

export async function compileStrategy(prompt: string, markets: Market[], style: StrategyStyle): Promise<CompileResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return compileStrategyLocally(prompt, markets, style);
  }

  const fallback = compileStrategyLocally(prompt, markets, style);
  try {
    const data = await callDeepSeek([
      {
        role: "system",
        content:
          "你是A股选股策略编译器。只返回JSON。把用户自然语言转换为StrategyDsl，字段必须包括style, markets, strategyTemplates, include, exclude, weights, filters, warnings, unsupported。strategyTemplates可包含limit_up_pullback、limit_up_double_volume_bearish或limit_up_bearish_pullback；对应filters可包含recentLimitUpDays, requireBearishCandle, requireHoldLimitUpPrice, requireAboveMa, maxMaDistancePct, requireVolumeContraction, maxTwentyDayGainPct, requireBullishMaAlignment, requireSolidLimitUp, requirePostLimitUpBearishPullback, requirePullbackVolumeContraction, requirePullbackLowAboveLimitOpen, requireBullishClose, requireVolumeExpansionVsYesterday, maxTodayPctChange, maxTwentyDayRangePct, minPrice, minFiveDayAvgAmount。禁止输出交易指令。"
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          allowedMarkets: ["main", "gem", "star", "bse"],
          defaultDsl: createDefaultStrategy(style, markets)
        })
      }
    ]);

    const raw = JSON.parse(data);
    const dsl = strategyDslSchema.parse(mergeStrategyDsl(fallback.dsl, raw.dsl ?? raw));
    if (fallback.dsl.strategyTemplates?.includes("limit_up_pullback")) {
      if (!dsl.strategyTemplates?.includes("limit_up_pullback")) {
        dsl.strategyTemplates = [...(dsl.strategyTemplates ?? []), "limit_up_pullback"];
      }
      dsl.filters.recentLimitUpDays ??= fallback.dsl.filters.recentLimitUpDays;
      dsl.filters.requireBearishCandle ??= fallback.dsl.filters.requireBearishCandle;
      dsl.filters.requireHoldLimitUpPrice ??= fallback.dsl.filters.requireHoldLimitUpPrice;
      dsl.filters.requireAboveMa ??= fallback.dsl.filters.requireAboveMa;
      dsl.filters.maxMaDistancePct ??= fallback.dsl.filters.maxMaDistancePct;
      dsl.filters.requireVolumeContraction ??= fallback.dsl.filters.requireVolumeContraction;
      dsl.filters.maxTwentyDayGainPct ??= fallback.dsl.filters.maxTwentyDayGainPct;
      dsl.filters.requireBullishMaAlignment ??= fallback.dsl.filters.requireBullishMaAlignment;
    }
    if (fallback.dsl.strategyTemplates?.includes("limit_up_double_volume_bearish")) {
      if (!dsl.strategyTemplates?.includes("limit_up_double_volume_bearish")) {
        dsl.strategyTemplates = [...(dsl.strategyTemplates ?? []), "limit_up_double_volume_bearish"];
      }
      dsl.markets = ["main"];
      dsl.filters.recentLimitUpDays ??= fallback.dsl.filters.recentLimitUpDays;
      dsl.filters.requireSolidLimitUp ??= fallback.dsl.filters.requireSolidLimitUp;
      dsl.filters.requirePostLimitUpBearishPullback ??= fallback.dsl.filters.requirePostLimitUpBearishPullback;
      dsl.filters.requirePullbackVolumeContraction ??= fallback.dsl.filters.requirePullbackVolumeContraction;
      dsl.filters.requirePullbackLowAboveLimitOpen ??= fallback.dsl.filters.requirePullbackLowAboveLimitOpen;
      dsl.filters.requireBullishClose ??= fallback.dsl.filters.requireBullishClose;
      dsl.filters.requireAboveMa ??= fallback.dsl.filters.requireAboveMa;
      dsl.filters.requireVolumeExpansionVsYesterday ??= fallback.dsl.filters.requireVolumeExpansionVsYesterday;
      dsl.filters.maxTodayPctChange ??= fallback.dsl.filters.maxTodayPctChange;
      dsl.filters.maxTwentyDayRangePct ??= fallback.dsl.filters.maxTwentyDayRangePct;
      dsl.filters.minPrice ??= fallback.dsl.filters.minPrice;
      dsl.filters.minFiveDayAvgAmount ??= fallback.dsl.filters.minFiveDayAvgAmount;
    }
    if (fallback.dsl.strategyTemplates?.includes("limit_up_bearish_pullback")) {
      if (!dsl.strategyTemplates?.includes("limit_up_bearish_pullback")) {
        dsl.strategyTemplates = [...(dsl.strategyTemplates ?? []), "limit_up_bearish_pullback"];
      }
      dsl.markets = ["main"];
      dsl.filters.recentLimitUpDays ??= fallback.dsl.filters.recentLimitUpDays;
      dsl.filters.requireSolidLimitUp ??= fallback.dsl.filters.requireSolidLimitUp;
      dsl.filters.requirePostLimitUpBearishPullback ??= fallback.dsl.filters.requirePostLimitUpBearishPullback;
      dsl.filters.requirePullbackVolumeContraction ??= fallback.dsl.filters.requirePullbackVolumeContraction;
      dsl.filters.requirePullbackLowAboveLimitOpen ??= fallback.dsl.filters.requirePullbackLowAboveLimitOpen;
      dsl.filters.requireBearishCandle ??= fallback.dsl.filters.requireBearishCandle;
      dsl.filters.requireAboveMa ??= fallback.dsl.filters.requireAboveMa;
      dsl.filters.requireVolumeExpansionVsYesterday ??= fallback.dsl.filters.requireVolumeExpansionVsYesterday;
      dsl.filters.maxTodayPctChange ??= fallback.dsl.filters.maxTodayPctChange;
      dsl.filters.maxTwentyDayRangePct ??= fallback.dsl.filters.maxTwentyDayRangePct;
      dsl.filters.minPrice ??= fallback.dsl.filters.minPrice;
      dsl.filters.minFiveDayAvgAmount ??= fallback.dsl.filters.minFiveDayAvgAmount;
    }
    return {
      dsl,
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : fallback.warnings,
      unsupported: Array.isArray(raw.unsupported) ? raw.unsupported.map(String) : fallback.unsupported
    };
  } catch (error) {
    return {
      ...fallback,
      warnings: [...fallback.warnings, `DeepSeek 解析失败，已使用本地规则兜底：${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

export async function assessIndustryLeaderWithDeepSeek(input: DeepSeekLeaderAssessmentInput): Promise<DeepSeekLeaderAssessment | null> {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return null;

  try {
    const data = await callDeepSeek([
      {
        role: "system",
        content:
          "你是A股短线研究报告的行业地位证据归纳器。只返回JSON，字段为 status 和 reason。status 只能是 confirmed、likely、unknown。只能基于用户提供的证据判断，不允许使用外部常识、历史记忆或编造事实。若没有行业排名、市占率、板块领涨、同行涨幅/成交额领先等明确证据，必须返回 unknown。reason 用中文，40字以内，必须点明所依据的证据或说明证据不足。"
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "判断候选股是否具备龙头身份",
          input
        })
      }
    ]);
    return normalizeLeaderAssessment(data);
  } catch {
    return null;
  }
}

function mergeStrategyDsl(fallback: StrategyDsl, raw: unknown): StrategyDsl {
  if (!isRecord(raw)) return fallback;
  return {
    ...fallback,
    style: isStrategyStyle(raw.style) ? raw.style : fallback.style,
    markets: normalizeDeepSeekMarkets(raw.markets, fallback.markets),
    strategyTemplates: normalizeStringArray(raw.strategyTemplates, ["limit_up_pullback", "limit_up_double_volume_bearish", "limit_up_bearish_pullback"]) as StrategyDsl["strategyTemplates"],
    include: normalizeStringArray(raw.include) ?? fallback.include,
    exclude: normalizeStringArray(raw.exclude) ?? fallback.exclude,
    weights: {
      ...fallback.weights,
      ...sanitizeNumberRecord(raw.weights)
    },
    filters: {
      ...fallback.filters,
      ...sanitizeFilters(raw.filters)
    }
  };
}

function sanitizeFilters(raw: unknown): Partial<StrategyDsl["filters"]> {
  if (!isRecord(raw)) return {};
  const booleanKeys = [
    "excludeST",
    "excludeSuspended",
    "requireBearishCandle",
    "requireHoldLimitUpPrice",
    "requireVolumeContraction",
    "requireBullishMaAlignment",
    "requireSolidLimitUp",
    "requirePostLimitUpBearishPullback",
    "requirePullbackVolumeContraction",
    "requirePullbackLowAboveLimitOpen",
    "requireBullishClose",
    "requireVolumeExpansionVsYesterday"
  ] as const;
  const numberKeys = [
    "excludeNewStocksDays",
    "minTurnoverAmount",
    "maxOpenCount",
    "minConsecutiveLimitUps",
    "sectorTopN",
    "recentLimitUpDays",
    "maxMaDistancePct",
    "maxTwentyDayGainPct",
    "maxTodayPctChange",
    "maxTwentyDayRangePct",
    "minPrice",
    "minFiveDayAvgAmount"
  ] as const;
  const filters: Partial<StrategyDsl["filters"]> = {};
  for (const key of booleanKeys) {
    if (typeof raw[key] === "boolean") filters[key] = raw[key];
  }
  for (const key of numberKeys) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) filters[key] = raw[key];
  }
  if (raw.requireAboveMa === "ma5_or_ma10" || raw.requireAboveMa === "ma10") filters.requireAboveMa = raw.requireAboveMa;
  return filters;
}

function sanitizeNumberRecord(raw: unknown): Partial<StrategyDsl["weights"]> {
  if (!isRecord(raw)) return {};
  const keys = ["strategyMatch", "limitUpStrength", "dragonTiger", "sectorHeat", "moneyFlow", "liquidity", "riskPenalty"] as const;
  const result: Partial<StrategyDsl["weights"]> = {};
  for (const key of keys) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) result[key] = raw[key];
  }
  return result;
}

function normalizeDeepSeekMarkets(raw: unknown, fallback: Market[]): Market[] {
  const markets = normalizeStringArray(raw, ["main", "gem", "star", "bse"]) as Market[] | undefined;
  return markets?.length ? markets : fallback;
}

function normalizeStringArray(raw: unknown, allowed?: string[]): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw.filter((item): item is string => typeof item === "string" && (!allowed || allowed.includes(item)));
  return values.length ? [...new Set(values)] : undefined;
}

function isStrategyStyle(value: unknown): value is StrategyStyle {
  return value === "short_term" || value === "stable" || value === "custom";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function compileWatchCondition(prompt: string, markets: Market[]): Promise<WatchConditionDsl> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return compileWatchConditionLocally(prompt, markets);
  }

  const fallback = compileWatchConditionLocally(prompt, markets);
  try {
    const data = await callDeepSeek([
      {
        role: "system",
        content:
          "你是A股个股监控条件编译器。只返回JSON，字段包括templates,prompt,markets,params。templates只能来自白名单：volume_breakout,ma_breakout,money_inflow_positive,sector_top_n,limit_up_or_reseal,dragon_tiger_listed,stop_loss_break。"
      },
      {
        role: "user",
        content: JSON.stringify({ prompt, markets, fallback })
      }
    ]);
    return watchConditionDslSchema.parse(JSON.parse(data));
  } catch {
    return fallback;
  }
}

function normalizeLeaderAssessment(data: string): DeepSeekLeaderAssessment | null {
  const raw = parseJsonObject(data);
  const assessment = isRecord(raw.assessment) ? raw.assessment : raw;
  const status = normalizeLeaderStatus(assessment.status);
  const reason = typeof assessment.reason === "string" ? assessment.reason.replace(/\s+/g, " ").trim() : "";
  if (!status || !reason) return null;
  return {
    status,
    reason: reason.length > 60 ? `${reason.slice(0, 59)}…` : reason
  };
}

function normalizeLeaderStatus(value: unknown): DeepSeekLeaderAssessment["status"] | null {
  if (value === "confirmed" || value === "likely" || value === "unknown") return value;
  if (value === "确认" || value === "确定") return "confirmed";
  if (value === "可能" || value === "较可能") return "likely";
  if (value === "未知" || value === "无法确认") return "unknown";
  return null;
}

function parseJsonObject(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return isRecord(parsed) ? parsed : {};
  } catch {
    const start = data.indexOf("{");
    const end = data.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(data.slice(start, end + 1));
      return isRecord(parsed) ? parsed : {};
    }
    return {};
  }
}

async function callDeepSeek(messages: DeepSeekMessage[]): Promise<string> {
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 20_000));
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 返回为空");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}
