import fs from "node:fs/promises";
import path from "node:path";
import { buildReport, deliverReport, defaultStrategyPrompt, writeReportArtifact } from "./reportArtifacts.js";
import { fetchDailyBars } from "../data/akshareClient.js";
import { mergeDailyBarCache, readDailyBarCache, writeDailyBarCache } from "../data/dailyBarCache.js";
import { tradingDayDecision } from "../data/tradingCalendar.js";
import type { DailyBar, ReportKind } from "../shared/types.js";

const outputRoot = path.resolve(process.cwd(), "dist-web", "data");
const previousRoot = path.resolve(process.cwd(), process.env.PREVIOUS_STATIC_DATA_DIR ?? "data");
const kind = (process.argv.find((arg) => arg.startsWith("--kind="))?.split("=")[1] ?? "close") as ReportKind | "all";
const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.split("=")[1];
const strategyArg = process.argv.find((arg) => arg.startsWith("--strategy-prompt="))?.slice("--strategy-prompt=".length).trim();
const strategyPrompt = strategyArg || defaultStrategyPrompt;
const forceNonTrading = process.env.FORCE_REPORT_ON_NON_TRADING_DAY === "true" || process.argv.includes("--force-non-trading");

const kinds: ReportKind[] = kind === "all" ? ["morning", "intraday-selection", "close"] : [kind];
if (/涨停.*回调|阴线.*缩量/.test(strategyPrompt)) {
  process.env.DAILY_BARS_LIMIT_UP_UNIVERSE ??= "true";
}
await fs.mkdir(outputRoot, { recursive: true });

const tradingDay = tradingDayDecision(tradeDate);
if (!tradingDay.isTradingDay && !forceNonTrading) {
  console.log(JSON.stringify({
    skipped: true,
    tradeDate: tradingDay.tradeDate,
    reason: tradingDay.reason ?? "A股非交易日",
    reports: [],
    cache: null
  }, null, 2));
  process.exit(0);
}

let cacheSummary: unknown = null;
let dailyBarsForReport: DailyBar[] = [];
let dailyBarWarnings: string[] = [];
try {
  const previous = await readDailyBarCache(previousRoot);
  dailyBarsForReport = previous?.bars ?? [];
  const dailyBars = await fetchDailyBars(tradingDay.tradeDate, 30);
  const cache = mergeDailyBarCache(previous, dailyBars.bars, dailyBars.provider, dailyBars.warnings);
  await writeDailyBarCache(outputRoot, cache);
  dailyBarsForReport = cache.bars;
  dailyBarWarnings = cache.warnings;
  cacheSummary = { bars: cache.bars.length, tradeDate: cache.tradeDate, source: cache.source, warnings: cache.warnings };
} catch (error) {
  cacheSummary = { error: error instanceof Error ? error.message : String(error) };
  dailyBarWarnings = [`日线缓存更新失败：${error instanceof Error ? error.message : String(error)}`];
}

const reports = [];
for (const reportKind of kinds) {
  const report = await deliverReport(await buildReport(reportKind, strategyPrompt, tradingDay.tradeDate, { dailyBars: dailyBarsForReport, dailyBarWarnings }));
  await writeReportArtifact(outputRoot, report);
  reports.push({ kind: report.kind, tradeDate: report.tradeDate, provider: report.provider, warnings: report.warnings.length });
}

console.log(JSON.stringify({ tradeDate: tradingDay.tradeDate, reports, cache: cacheSummary }, null, 2));
