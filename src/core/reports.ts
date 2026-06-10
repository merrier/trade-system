import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { compileStrategy } from "./deepseek.js";
import { createDefaultStrategy } from "./defaults.js";
import { HermesAgentClient } from "./hermesAgentClient.js";
import { rankSectors, rankStocks } from "./scoring.js";
import { fetchMarketDataset, fetchUsMarketBrief } from "../data/akshareClient.js";
import { enrichDatasetWithSectorMap, readSectorMap } from "../data/sectorMap.js";
import type {
  CloseReportPayload,
  IntradaySelectionReportPayload,
  MarketDataset,
  MorningReportPayload,
  RecommendationContext,
  ReportArtifact,
  ReportKind,
  StockSnapshot,
  StrategySnapshot
} from "../shared/types.js";
import type { DailyBar } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export const reportArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum(["morning", "intraday-selection", "close"]),
  tradeDate: z.string(),
  dataAsOf: z.string(),
  provider: z.string(),
  warnings: z.array(z.string()),
  payload: z.unknown(),
  analysis: z.string(),
  rankingNarrative: z.string().optional(),
  pushMessage: z.string(),
  generatedAt: z.string()
});

const factorLegend: Record<string, string> = {
  strategyMatch: "自然语言策略命中程度",
  limitUpStrength: "涨停/连板/封单强度",
  dragonTiger: "龙虎榜净买入与席位参考",
  sectorHeat: "所属行业/概念热度",
  moneyFlow: "个股主力资金方向",
  liquidity: "成交额与流动性",
  riskPenalty: "ST、停牌、高位、炸板、过热等风险扣分",
  pullbackMatch: "涨停回调模板综合命中度",
  limitUpRecency: "最近涨停距离当前交易日的近度",
  volumeContraction: "阴线缩量程度",
  maSupport: "五日线/十日线支撑强度",
  twentyDayGain: "最近20个交易日涨幅",
  bullishMaAlignment: "MA5 > MA10 > MA20 多头排列"
};

export async function buildMorningReport(hermes = new HermesAgentClient()): Promise<ReportArtifact<MorningReportPayload>> {
  const result = await fetchUsMarketBrief();
  const payload: MorningReportPayload = {
    brief: result.brief,
    aShareReadThrough: inferAshareReadThrough(result.brief)
  };
  const hermesResult = await hermes.analyze({
    kind: "morning",
    title: `${result.brief.previousSession || "最近一日"} 外盘晨报`,
    marketContext: payload
  });
  return finalizeReport("morning", result.brief.previousSession || currentTradeDate(), result.provider, [...result.warnings, ...hermesResult.warnings], payload, hermesResult);
}

export async function buildIntradaySelectionReport(
  strategyPrompt: string,
  hermes = new HermesAgentClient(),
  tradeDate?: string,
  options: { dailyBars?: DailyBar[]; dailyBarWarnings?: string[] } = {}
): Promise<ReportArtifact<IntradaySelectionReportPayload>> {
  const rawDataset = await fetchIntradayDatasetWithDailyBarFallback(tradeDate, options.dailyBars ?? []);
  const dataset = enrichDatasetWithSectorMap(rawDataset, await readSectorMap());
  const compiled = strategyPrompt.trim()
    ? await compileStrategy(strategyPrompt, ["main"], "short_term")
    : { dsl: createDefaultStrategy("short_term", ["main"]), warnings: ["未配置策略，使用默认主板短线强势策略。"], unsupported: [] };
  const recommendations = await enrichRecommendations(rankStocks(dataset, compiled.dsl, "intraday", { dailyBars: options.dailyBars }), dataset, options.dailyBars ?? []);
  const dailyBarWarnings = buildDailyBarWarnings(compiled.dsl, options.dailyBars ?? []);
  const strategy: StrategySnapshot = {
    prompt: strategyPrompt || "默认主板短线强势策略",
    compiledDsl: compiled.dsl,
    warnings: compiled.warnings,
    unsupported: compiled.unsupported,
    compiledAt: new Date().toISOString(),
    engine: process.env.HERMES_ANALYSIS_COMMAND ? "hermes" : "local"
  };
  const payload: IntradaySelectionReportPayload = {
    strategy,
    recommendations,
    factorLegend
  };
  const hermesResult = await hermes.analyze({
    kind: "intraday-selection",
    title: `${dataset.tradeDate} 14:50 主板选股`,
    strategyPrompt,
    marketContext: {
      tradeDate: dataset.tradeDate,
      dataAsOf: dataset.dataAsOf,
      topRecommendations: recommendations.slice(0, 10),
      sectorLeaders: rankSectors(dataset).slice(0, 10)
    }
  });
  return finalizeReport("intraday-selection", dataset.tradeDate, dataset.source, [...dataset.warnings, ...(options.dailyBarWarnings ?? []), ...dailyBarWarnings, ...compiled.warnings, ...compiled.unsupported, ...hermesResult.warnings], payload, hermesResult);
}

async function fetchIntradayDatasetWithDailyBarFallback(tradeDate: string | undefined, dailyBars: DailyBar[]): Promise<MarketDataset> {
  try {
    return await fetchMarketDataset("intraday", tradeDate);
  } catch (error) {
    const errorSummary = summarizeProviderError(error);
    if (!dailyBars.length) {
      try {
        const fallback = await fetchMarketDataset("post_close", tradeDate);
        return {
          ...fallback,
          warnings: [
            `盘中快照源不可用，已使用涨停池/静态市场数据生成盘中降级视图：${errorSummary}`,
            ...fallback.warnings
          ]
        };
      } catch {
        throw error;
      }
    }
    const resolvedTradeDate = tradeDate ?? dailyBars.at(-1)?.tradeDate ?? currentTradeDate();
    const availableDates = [...new Set(dailyBars.filter((bar) => bar.tradeDate <= resolvedTradeDate).map((bar) => bar.tradeDate))].sort();
    const latestDailyBarDate = availableDates.includes(resolvedTradeDate) ? resolvedTradeDate : availableDates.at(-1);
    const latestByCode = new Map<string, DailyBar>();
    for (const bar of dailyBars) {
      if (bar.tradeDate <= (latestDailyBarDate ?? resolvedTradeDate)) latestByCode.set(bar.code, bar);
    }
    const latestBars = latestDailyBarDate ? [...latestByCode.values()].filter((bar) => bar.tradeDate === latestDailyBarDate) : [];
    const stocks = latestBars.map((bar) => ({
      code: bar.code,
      name: bar.name,
      market: bar.market,
      industry: "涨停回调候选",
      concepts: [],
      pctChange: bar.pctChange,
      turnoverAmount: bar.amount,
      turnoverRate: bar.turnoverRate,
      volumeRatio: 1,
      close: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
      listedDays: 999,
      mainNetInflow: 0
    }));
    const leader = [...stocks].sort((a, b) => b.pctChange - a.pctChange)[0];
    return {
      tradeDate: resolvedTradeDate,
      dataAsOf: new Date().toISOString(),
      source: "baostock",
      warnings: [
        `盘中快照源不可用，已使用日线缓存构造盘中降级视图：${errorSummary}`,
        latestDailyBarDate && latestDailyBarDate !== resolvedTradeDate ? `日线缓存最新交易日为 ${latestDailyBarDate}，非 ${resolvedTradeDate}。` : ""
      ].filter(Boolean),
      stocks,
      limitUps: latestBars
        .filter((bar) => bar.pctChange >= 9.8)
        .map((bar) => ({
          tradeDate: bar.tradeDate,
          code: bar.code,
          name: bar.name,
          market: bar.market,
          industry: "涨停回调候选",
          concepts: [],
          consecutive: 1,
          firstLimitTime: "",
          lastLimitTime: "",
          openCount: 0,
          sealedAmount: 0,
          turnoverRate: bar.turnoverRate,
          pctChange: bar.pctChange
        })),
      dragonTiger: [],
      sectors: [
        {
          tradeDate: resolvedTradeDate,
          name: "涨停回调候选",
          type: "concept",
          pctChange: avg(stocks.map((stock) => stock.pctChange)),
          inflowAmount: 0,
          outflowAmount: 0,
          netInflow: stocks.reduce((sum, stock) => sum + stock.turnoverAmount, 0),
          companyCount: stocks.length,
          limitUpCount: latestBars.filter((bar) => bar.pctChange >= 9.8).length,
          leaderCode: leader?.code,
          leaderName: leader?.name,
          leaderPctChange: leader?.pctChange ?? 0,
          heatScore: 50,
          trend: []
        }
      ]
    };
  }
}

function summarizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 360 ? `${normalized.slice(0, 357)}...` : normalized;
}

export async function buildCloseReport(hermes = new HermesAgentClient(), tradeDate?: string): Promise<ReportArtifact<CloseReportPayload>> {
  const dataset = await fetchMarketDataset("post_close", tradeDate);
  return buildCloseReportFromDataset(dataset, hermes);
}

export async function buildCloseReportFromDataset(dataset: MarketDataset, hermes = new HermesAgentClient()): Promise<ReportArtifact<CloseReportPayload>> {
  const dsl = createDefaultStrategy("short_term", ["main"]);
  const recommendations = rankStocks(dataset, dsl, "post_close");
  const sectors = rankSectors(dataset);
  const limitUps = [...dataset.limitUps]
    .map((item) => ({
      ...item,
      strengthScore: Math.min(100, item.consecutive * 20 + (item.openCount === 0 ? 20 : 8) + Math.min(30, item.sealedAmount / 30_000_000))
    }))
    .sort((a, b) => b.consecutive - a.consecutive || b.strengthScore - a.strengthScore);
  const payload: CloseReportPayload = {
    marketBreadth: marketBreadth(dataset, limitUps.length),
    limitUps,
    sectors,
    recommendations
  };
  const hermesResult = await hermes.analyze({
    kind: "close",
    title: `${dataset.tradeDate} 收盘复盘`,
    marketContext: {
      tradeDate: dataset.tradeDate,
      breadth: payload.marketBreadth,
      topLimitUps: limitUps.slice(0, 20),
      topSectors: sectors.slice(0, 15)
    }
  });
  return finalizeReport("close", dataset.tradeDate, dataset.source, [...dataset.warnings, ...hermesResult.warnings], payload, hermesResult);
}

export function validateReportArtifact<T>(value: ReportArtifact<T>): ReportArtifact<T> {
  reportArtifactSchema.parse(value);
  return value;
}

function finalizeReport<T>(
  kind: ReportKind,
  tradeDate: string,
  provider: string,
  warnings: string[],
  payload: T,
  hermesResult: { analysis: string; rankingNarrative?: string; pushMessage: string }
): ReportArtifact<T> {
  const report = {
    id: `${kind}-${tradeDate}-${Date.now()}`,
    kind,
    tradeDate,
    dataAsOf: new Date().toISOString(),
    provider,
    warnings: [...new Set(warnings.filter(Boolean))],
    payload,
    analysis: hermesResult.analysis,
    rankingNarrative: hermesResult.rankingNarrative,
    pushMessage: hermesResult.pushMessage,
    generatedAt: new Date().toISOString()
  };
  return validateReportArtifact({
    ...report,
    pushMessage: formatReportMarkdown(report)
  });
}

export function formatReportMarkdown(report: ReportArtifact): string {
  const lines = [
    `# ${reportTitle(report.kind, report.tradeDate)}`,
    "",
    `**数据源**：${report.provider}  `,
    `**生成时间**：${report.generatedAt}`,
    "",
    "## 核心摘要",
    report.analysis || report.pushMessage || "报告已生成。"
  ];

  if (report.rankingNarrative) {
    lines.push("", "## 排名解读", report.rankingNarrative);
  }

  if (report.kind === "morning") {
    lines.push(...formatMorningPayload(report.payload as MorningReportPayload));
  } else if (report.kind === "intraday-selection") {
    lines.push(...formatIntradayPayload(report.payload as IntradaySelectionReportPayload));
  } else if (report.kind === "close") {
    lines.push(...formatClosePayload(report.payload as CloseReportPayload));
  }

  if (report.warnings.length) {
    lines.push("", "## 数据提示", ...report.warnings.slice(0, 5).map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

function reportTitle(kind: ReportKind, tradeDate: string): string {
  if (kind === "morning") return `A股晨报 ${tradeDate}`;
  if (kind === "intraday-selection") return `14:50 主板选股 ${tradeDate}`;
  return `A股收盘复盘 ${tradeDate}`;
}

function formatMorningPayload(payload: MorningReportPayload): string[] {
  return [
    "",
    "## 外盘线索",
    ...payload.brief.indices.slice(0, 4).map((item) => `- **${item.name}**：${formatNumber(item.close)}（${formatSignedPct(item.pctChange)}）`),
    ...payload.brief.futures.slice(0, 4).map((item) => `- **${item.name}**：${formatNumber(item.price)}（${formatSignedPct(item.pctChange)}）`),
    "",
    "## A股预判",
    ...payload.aShareReadThrough.slice(0, 4).map((item) => `- ${item}`)
  ];
}

function formatIntradayPayload(payload: IntradaySelectionReportPayload): string[] {
  const lines = [
    "",
    "## 策略",
    payload.strategy.prompt,
    "",
    "## 推荐排名"
  ];
  if (!payload.recommendations.length) {
    lines.push("- 暂无命中新版策略的主板股票。");
    return lines;
  }
  lines.push(
    ...payload.recommendations.slice(0, 10).map((item) => {
      const reasons = item.reasons.slice(0, 2).join("；");
      const risks = item.risks.slice(0, 2).join("；") || "暂无额外风险提示";
      const context = item.context
        ? `涨停原因：${item.context.limitUpReason}；板块：${item.context.sectors.join("、") || "数据不足"}；龙头：${item.context.industryLeader.reason}；唯一性：${item.context.uniqueness.reason}`
        : "涨停原因/板块/龙头/唯一性：数据不足";
      return `- **${item.rank}. ${item.code} ${item.name}**：${item.score} 分，置信度 ${item.confidence}。${context}。形态：${reasons}。风险：${risks}`;
    })
  );
  return lines;
}

async function enrichRecommendations(recommendations: ReturnType<typeof rankStocks>, dataset: MarketDataset, dailyBars: DailyBar[]) {
  if (!recommendations.length) return recommendations;
  const limitUpInsights = await readLimitUpInsights();
  const cachedContexts = await readCachedCompanyContexts();
  const missingContextRecommendations = recommendations.slice(0, 10).filter((item) => !cachedContexts.has(item.code));
  const liveContexts = await fetchIwencaiRecommendationContexts(missingContextRecommendations);
  const companyContexts = new Map([...cachedContexts, ...liveContexts]);
  const stocksByCode = new Map(dataset.stocks.map((stock) => [stock.code, stock]));
  return recommendations.map((item) => ({
    ...item,
    context: buildRecommendationContext(item.code, item.name, stocksByCode.get(item.code), dataset, dailyBars, limitUpInsights, companyContexts.get(item.code))
  }));
}

interface LimitUpInsight {
  tradeDate: string;
  code: string;
  reason: string;
  industry?: string;
  sectors: string[];
  keywords: string[];
}

interface IwencaiRecommendationContext {
  code: string;
  reason?: string;
  industry?: string;
  sectors: string[];
  keywords: string[];
  leaderEvidence?: string;
  uniquenessEvidence?: string;
}

async function readCachedCompanyContexts(): Promise<Map<string, IwencaiRecommendationContext>> {
  try {
    const text = await fs.readFile(path.resolve(process.cwd(), "data", "company-context", "latest.json"), "utf8");
    const parsed = JSON.parse(text) as { records?: Array<Record<string, unknown>> };
    const contexts = new Map<string, IwencaiRecommendationContext>();
    for (const record of parsed.records ?? []) {
      const code = normalizeCode(textValue(record, "code"));
      if (!code) continue;
      contexts.set(code, {
        code,
        reason: textValue(record, "limitUpReason"),
        industry: textValue(record, "industry"),
        sectors: arrayText(record.sectors),
        keywords: arrayText(record.keywords),
        leaderEvidence: textValue(record, "leaderEvidence"),
        uniquenessEvidence: textValue(record, "uniquenessEvidence")
      });
    }
    return contexts;
  } catch {
    return new Map();
  }
}

function buildRecommendationContext(
  code: string,
  name: string,
  stock: StockSnapshot | undefined,
  dataset: MarketDataset,
  dailyBars: DailyBar[],
  limitUpInsights: LimitUpInsight[],
  iwencaiContext?: IwencaiRecommendationContext
): RecommendationContext {
  const recentLimitUpDate = findRecentSolidLimitUpDate(code, dataset.tradeDate, dailyBars);
  const exactInsight = limitUpInsights.find((item) => item.code === code && item.tradeDate === recentLimitUpDate);
  const fallbackInsight = [...limitUpInsights].reverse().find((item) => item.code === code);
  const insight = exactInsight ?? fallbackInsight;
  const sectors = uniqueStrings([
    stock?.industry,
    ...(stock?.concepts ?? []),
    iwencaiContext?.industry,
    ...(iwencaiContext?.sectors ?? []),
    insight?.industry,
    ...(insight?.sectors ?? [])
  ]).filter(isRealSectorName).slice(0, 5);
  const reason = iwencaiContext?.reason || insight?.reason || "";
  const keywords = uniqueStrings([...(iwencaiContext?.keywords ?? []), ...(insight?.keywords ?? [])]);

  return {
    limitUpDate: recentLimitUpDate ?? insight?.tradeDate,
    limitUpReason: reason || "未找到历史涨停原因",
    sectors,
    industryLeader: inferIndustryLeader(code, name, stock, dataset, sectors, iwencaiContext),
    uniqueness: inferUniqueness(keywords, limitUpInsights, iwencaiContext)
  };
}

async function fetchIwencaiRecommendationContexts(recommendations: ReturnType<typeof rankStocks>): Promise<Map<string, IwencaiRecommendationContext>> {
  if (!process.env.IWENCAI_API_KEY?.trim()) return new Map();
  const cliPath = expandHome(process.env.IWENCAI_SKILL_CLI ?? "~/.codex/skills/hithink-market-query/scripts/cli.py");
  const pythonBin = process.env.PYTHON_BIN ?? "python3";
  const contexts = new Map<string, IwencaiRecommendationContext>();
  const topN = Number(process.env.IWENCAI_CONTEXT_TOP_N ?? 10);

  for (const item of recommendations.slice(0, topN)) {
    const row = await queryIwencaiContextRow(pythonBin, cliPath, item.code, item.name);
    if (!row) continue;
    const context = iwencaiRowToContext(row);
    if (context) contexts.set(context.code, context);
  }
  return contexts;
}

async function queryIwencaiContextRow(pythonBin: string, cliPath: string, code: string, name: string): Promise<Record<string, unknown> | null> {
  const queries = [
    `${code} ${name} 所属同花顺行业 所属概念 主营业务`,
    `${code} ${name} 近5日涨停原因 涨停日期 所属概念`,
    `${code} ${name} 行业地位 行业排名 市占率 龙头 竞争对手 主营产品`
  ];
  const apiKeys = uniqueStrings([process.env.IWENCAI_API_KEY, process.env.IWENCAI_API_KEY_FALLBACK]);
  const normalizedCode = normalizeCode(code);
  const merged: Record<string, unknown> = {};
  for (const query of queries) {
    for (const apiKey of apiKeys) {
      try {
        const { stdout } = await execFileAsync(
          pythonBin,
          [cliPath, "--query", query, "--page", "1", "--limit", "3"],
          {
            env: { ...process.env, IWENCAI_API_KEY: apiKey },
            timeout: Number(process.env.IWENCAI_TIMEOUT_MS ?? 30_000),
            maxBuffer: 10 * 1024 * 1024
          }
        );
        const jsonStart = stdout.indexOf("{");
        if (jsonStart < 0) continue;
        const parsed = JSON.parse(stdout.slice(jsonStart)) as { datas?: Array<Record<string, unknown>> };
        const row = parsed.datas?.find((item) => normalizeCode(text(item["股票代码"])) === normalizedCode) ?? parsed.datas?.[0];
        if (row) Object.assign(merged, row);
        break;
      } catch {
        // Fall back to the next key or historical snapshots.
      }
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function iwencaiRowToContext(row: Record<string, unknown>): IwencaiRecommendationContext | null {
  const code = normalizeCode(text(row["股票代码"]));
  if (!code) return null;
  const reason = textValue(row, "涨停原因");
  const industryPath = arrayText(row["所属同花顺行业"]);
  const concepts = arrayText(row["所属概念"]);
  const keywords = splitReason(reason);
  const leaderEvidence = leaderEvidenceFromRow(row);
  return {
    code,
    reason,
    industry: industryPath[0],
    sectors: uniqueStrings([...industryPath.slice(1), ...concepts, ...keywords]),
    keywords,
    leaderEvidence,
    uniquenessEvidence: uniquenessEvidenceFromKeywords(keywords)
  };
}

async function readLimitUpInsights(): Promise<LimitUpInsight[]> {
  const dir = path.resolve(process.cwd(), "data", "iwencai");
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const insights: LimitUpInsight[] = [];
  for (const file of files.filter((item) => /^limit-ups-\d{8}\.json$/.test(item)).sort()) {
    const tradeDate = file.match(/(\d{8})/)?.[1] ?? "";
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { rows?: Array<Record<string, unknown>> };
      for (const row of parsed.rows ?? []) {
        const code = normalizeCode(text(row["股票代码"]));
        if (!code) continue;
        const reason = textValue(row, "涨停原因");
        const industryPath = arrayText(row["所属同花顺行业"]);
        insights.push({
          tradeDate,
          code,
          reason,
          industry: industryPath[0],
          sectors: uniqueStrings([...industryPath.slice(1), ...splitReason(reason)]),
          keywords: splitReason(reason)
        });
      }
    } catch {
      // Ignore malformed historical snapshots; the report will mark missing context.
    }
  }
  return insights;
}

function inferIndustryLeader(code: string, name: string, stock: StockSnapshot | undefined, dataset: MarketDataset, sectors: string[], iwencaiContext?: IwencaiRecommendationContext): RecommendationContext["industryLeader"] {
  if (iwencaiContext?.leaderEvidence) {
    return { status: /龙头|领先|第一|排名|市占率|市占/.test(iwencaiContext.leaderEvidence) ? "likely" : "unknown", reason: iwencaiContext.leaderEvidence };
  }
  const directLeader = dataset.sectors.find((sector) => sectors.includes(sector.name) && (sector.leaderCode === code || sector.leaderName === name));
  if (directLeader) {
    return { status: "likely", reason: `${directLeader.name}领涨股` };
  }
  if (stock?.industry) {
    const peers = dataset.stocks.filter((item) => item.industry === stock.industry);
    const leader = [...peers].sort((a, b) => b.pctChange - a.pctChange || b.turnoverAmount - a.turnoverAmount)[0];
    if (leader?.code === code && peers.length >= 3) {
      return { status: "likely", reason: `${stock.industry}内涨幅/成交额领先` };
    }
  }
  return { status: "unknown", reason: "缺少完整板块成分或行业排名数据，暂不能确认" };
}

function inferUniqueness(keywords: string[], allInsights: LimitUpInsight[], iwencaiContext?: IwencaiRecommendationContext): RecommendationContext["uniqueness"] {
  if (iwencaiContext?.uniquenessEvidence) {
    return { status: keywords.length >= 3 ? "high" : "medium", reason: iwencaiContext.uniquenessEvidence };
  }
  if (!keywords.length) {
    return { status: "unknown", reason: "缺少涨停原因关键词，暂不能确认" };
  }
  const keywordCounts = keywords.map((keyword) => ({
    keyword,
    count: allInsights.filter((item) => item.keywords.includes(keyword)).length
  }));
  const rare = keywordCounts.filter((item) => item.count <= 2);
  if (rare.length) {
    return { status: "high", reason: `${rare.map((item) => item.keyword).slice(0, 2).join("、")}标签较少见` };
  }
  return { status: "medium", reason: `${keywords.slice(0, 2).join("、")}有同题材共振，唯一性一般` };
}

function findRecentSolidLimitUpDate(code: string, tradeDate: string, dailyBars: DailyBar[]): string | undefined {
  return [...dailyBars]
    .filter((bar) => bar.code === code && bar.tradeDate < tradeDate && bar.pctChange >= 9.8 && bar.close > bar.open)
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0]?.tradeDate;
}

function leaderEvidenceFromRow(row: Record<string, unknown>): string | undefined {
  const directKeys = Object.keys(row).filter((key) => /龙头|行业地位|行业排名|市场地位|市占率|市占/.test(key));
  const direct = directKeys
    .map((key) => `${key}：${fieldSummary(row[key])}`)
    .filter((item) => !item.endsWith("："))
    .slice(0, 2)
    .join("；");
  if (direct) return direct;

  const competitors = arrayText(row["竞争对手"]);
  if (competitors.length) {
    return `问财返回竞争对手：${competitors.slice(0, 3).join("、")}；未见直接龙头/市占率字段`;
  }
  return undefined;
}

function uniquenessEvidenceFromKeywords(keywords: string[]): string | undefined {
  if (!keywords.length) return undefined;
  if (keywords.length >= 3) return `${keywords.slice(0, 3).join("+")} 复合题材，辨识度较高`;
  return `${keywords.join("+")} 题材，需结合同题材数量确认唯一性`;
}

function fieldSummary(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).slice(0, 3).join("、");
  if (typeof value === "number") return String(round(value));
  return text(value);
}

function formatClosePayload(payload: CloseReportPayload): string[] {
  const breadth = payload.marketBreadth;
  return [
    "",
    "## 市场概览",
    `- 上涨 ${breadth.up} 家，下跌 ${breadth.down} 家，平盘 ${breadth.flat} 家`,
    `- 涨停 ${breadth.limitUp} 家，跌停 ${breadth.limitDown} 家，主板成交额 ${formatYi(breadth.turnoverAmount)}`,
    "",
    "## 连板梯队",
    ...(payload.limitUps.length
      ? payload.limitUps.slice(0, 10).map((item) => `- **${item.code} ${item.name}**：${item.consecutive} 连板，开板 ${item.openCount} 次，强度 ${formatNumber(item.strengthScore)}`)
      : ["- 暂无涨停梯队数据。"]),
    "",
    "## 板块热度",
    ...(payload.sectors.length
      ? payload.sectors.slice(0, 8).map((item) => {
          const heatScore = "heatScore" in item && typeof item.heatScore === "number" ? item.heatScore : 0;
          return `- **${item.name}**：热度 ${formatNumber(heatScore)}，涨幅 ${formatSignedPct(item.pctChange)}，涨停 ${item.limitUpCount} 家`;
        })
      : ["- 暂无板块热度数据。"])
  ];
}

function formatSignedPct(value: number): string {
  const rounded = round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatYi(value: number): string {
  return `${formatNumber(value / 100_000_000)} 亿`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(round(value)) : "0";
}

function marketBreadth(dataset: MarketDataset, limitUpCount: number): CloseReportPayload["marketBreadth"] {
  const mainStocks = dataset.stocks.filter((stock) => stock.market === "main");
  return {
    total: mainStocks.length,
    up: mainStocks.filter((stock) => stock.pctChange > 0).length,
    down: mainStocks.filter((stock) => stock.pctChange < 0).length,
    flat: mainStocks.filter((stock) => stock.pctChange === 0).length,
    limitUp: limitUpCount,
    limitDown: mainStocks.filter((stock) => stock.pctChange <= -9.8).length,
    turnoverAmount: mainStocks.reduce((sum, stock) => sum + stock.turnoverAmount, 0)
  };
}

function inferAshareReadThrough(brief: MorningReportPayload["brief"]): string[] {
  const nasdaq = brief.indices.find((item) => item.symbol === "^IXIC");
  const oil = [...brief.futures, ...brief.commodities].find((item) => item.symbol === "CL=F");
  const cnh = brief.currencies.find((item) => item.symbol === "CNH=X");
  const lines: string[] = [];
  if (nasdaq) lines.push(nasdaq.pctChange >= 0 ? "纳指走强时，A股主板科技映射和风险偏好通常更容易获得支撑。" : "纳指回落时，关注高估值科技映射回撤对主板情绪的拖累。");
  if (oil) lines.push(oil.pctChange >= 0 ? "原油偏强时，留意能源、化工与通胀链条。" : "原油走弱时，周期资源链条可能承压。");
  if (cnh) lines.push(cnh.pctChange >= 0 ? "离岸人民币价格上行需结合美元方向判断，重点观察北向风险偏好。" : "人民币偏弱时，主板权重和外资敏感资产需降低预期。");
  return lines.length ? lines : ["外盘关键指标已更新，需结合开盘集合竞价确认 A 股主板风险偏好。"];
}

function textValue(row: Record<string, unknown>, prefix: string): string {
  const direct = text(row[prefix]);
  if (direct) return direct;
  const matchedKey = Object.keys(row).find((key) => key === prefix || key.startsWith(`${prefix}[`));
  return text(matchedKey ? row[matchedKey] : undefined);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function splitReason(reason: string): string[] {
  return reason.split(/[+＋、,，/]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeCode(code: string): string {
  return code.replace(/\.(SZ|SH|BJ)$/i, "");
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function isRealSectorName(value: string): boolean {
  return !["涨停回调候选"].includes(value);
}

function expandHome(input: string): string {
  return input.startsWith("~/") ? path.join(process.env.HOME ?? "", input.slice(2)) : input;
}

function currentTradeDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDailyBarWarnings(dsl: StrategySnapshot["compiledDsl"], dailyBars: DailyBar[]): string[] {
  const needsDailyBars = dsl.strategyTemplates?.some((template) => template === "limit_up_pullback" || template === "limit_up_double_volume_bearish");
  if (!needsDailyBars) return [];
  if (!dailyBars.length) return ["该策略需要30日日线缓存；当前未读取到日线缓存，无法验证形态条件。"];
  const dates = new Set(dailyBars.map((bar) => bar.tradeDate));
  if (dates.size < 20) return [`该策略需要近20个交易日以上日线以验证涨幅和均线条件；当前缓存仅 ${dates.size} 个交易日。`];
  return [];
}
