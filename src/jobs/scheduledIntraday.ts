import "dotenv/config";
import fs from "node:fs/promises";
import { prepareIntradayHistory, readPreparedHistory } from "../data/intradayPreparation.js";
import { strictIntradaySnapshot, samplingMinutes } from "../data/intradaySnapshot.js";
import { tradingDayDecision } from "../data/tradingCalendar.js";
import { createMa5PullbackStrategy, MA5_PULLBACK_PROMPT } from "../core/defaults.js";
import { rankStocks } from "../core/scoring.js";
import { deliverReport, writeReportArtifact } from "./reportArtifacts.js";
import type { ReportArtifact, IntradaySelectionReportPayload } from "../shared/types.js";

const day = tradingDayDecision();
if (!day.isTradingDay) {
  console.log(JSON.stringify(day));
  process.exit(0);
}
if (process.argv.includes("--prepare")) {
  await prepareIntradayHistory(day.tradeDate);
  process.exit(0);
}
const now = new Date().toISOString();
const report: ReportArtifact<IntradaySelectionReportPayload & { runStatus: string }> = {
  id: `intraday-selection-${day.tradeDate}-${Date.now()}`, kind: "intraday-selection", tradeDate: day.tradeDate,
  dataAsOf: now, generatedAt: now, provider: "fuyao", warnings: [], analysis: "", pushMessage: "",
  payload: { runStatus: "failed", strategy: { prompt: MA5_PULLBACK_PROMPT, compiledDsl: createMa5PullbackStrategy(), warnings: [], unsupported: [], compiledAt: now, engine: "local" }, recommendations: [], monitorPool: [], sectorFlowLeaders: [], factorLegend: {} }
};
try {
  samplingMinutes(new Date(), day.tradeDate);
  const bars = await readPreparedHistory(day.tradeDate);
  const dataset = await strictIntradaySnapshot(day.tradeDate, bars);
  report.dataAsOf = dataset.dataAsOf;
  report.warnings = dataset.warnings;
  report.payload.recommendations = rankStocks(dataset, report.payload.strategy.compiledDsl, "intraday", { dailyBars: bars }).slice(0, 5);
  report.payload.runStatus = "success";
  report.analysis = report.payload.recommendations.length ? `筛选完成，展示前${report.payload.recommendations.length}只。` : "数据校验通过，当前没有符合全部条件的股票。";
} catch (error) {
  report.analysis = `选股任务失败：${error instanceof Error ? error.message : String(error)}。本次未生成选股结果。`;
  report.warnings = [report.analysis];
}
report.pushMessage = [
  `${day.tradeDate} 沿五日线阴线回调策略`,
  `状态：${report.payload.runStatus === "success" ? "已完成" : "失败"}`,
  `${report.payload.runStatus === "success" ? "实际采样" : "任务检查"}时间：${new Date(report.dataAsOf).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
  report.analysis,
  ...report.payload.recommendations.map((item, i) => `${i + 1}. ${item.name}（${item.code}） ${item.score.toFixed(2)}\n${item.reasons.join("；")}`),
  ...report.warnings,
  "https://merrier.wang/trade-system/"
].join("\n\n");
// Persist before delivery: webhook failure must not discard the website report.
await writeReportArtifact("data", report);
if (process.env.SKIP_REPORT_DELIVERY !== "true") {
  const delivered = await deliverReport(report);
  await writeReportArtifact("data", delivered);
  if (delivered.warnings.length > report.warnings.length) process.exitCode = 1;
}
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `failed=${report.payload.runStatus !== "success" || !!process.exitCode}\n`);
console.log(JSON.stringify({ tradeDate: report.tradeDate, status: report.payload.runStatus, count: report.payload.recommendations.length }));
