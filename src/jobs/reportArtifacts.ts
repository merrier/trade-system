import fs from "node:fs/promises";
import path from "node:path";
import { HermesAgentClient } from "../core/hermesAgentClient.js";
import { buildCloseReport, buildIntradaySelectionReport, buildMorningReport, validateReportArtifact } from "../core/reports.js";
import { LIMIT_UP_PULLBACK_PROMPT } from "../core/defaults.js";
import type { DailyBar, ReportArtifact, ReportKind } from "../shared/types.js";

export const defaultStrategyPrompt = process.env.INTRADAY_STRATEGY_PROMPT?.trim() || LIMIT_UP_PULLBACK_PROMPT;

export async function buildReport(
  kind: ReportKind,
  strategyPrompt = defaultStrategyPrompt,
  tradeDate?: string,
  options: { dailyBars?: DailyBar[]; dailyBarWarnings?: string[] } = {}
): Promise<ReportArtifact> {
  const hermes = new HermesAgentClient();
  if (kind === "morning") return buildMorningReport(hermes);
  if (kind === "intraday-selection") return buildIntradaySelectionReport(strategyPrompt, hermes, tradeDate, options);
  return buildCloseReport(hermes, tradeDate);
}

export async function writeReportArtifact(outputRoot: string, report: ReportArtifact): Promise<void> {
  validateReportArtifact(report);
  const reportDir = path.join(outputRoot, "reports", report.kind);
  await fs.mkdir(reportDir, { recursive: true });
  const fileName = `${report.tradeDate}.json`;
  await Promise.all([
    fs.writeFile(path.join(reportDir, fileName), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  ]);
}

export async function readReportArtifact(dataRoot: string, kind: ReportKind): Promise<ReportArtifact | null> {
  try {
    const text = await fs.readFile(path.join(dataRoot, "reports", kind, "latest.json"), "utf8");
    return validateReportArtifact(JSON.parse(text) as ReportArtifact);
  } catch {
    return null;
  }
}

export async function deliverReport(report: ReportArtifact): Promise<ReportArtifact> {
  const hermes = new HermesAgentClient();
  const deliveryWarnings = await hermes.deliver({ kind: report.kind, pushMessage: report.pushMessage, id: report.id, tradeDate: report.tradeDate });
  return deliveryWarnings.length ? { ...report, warnings: [...new Set([...report.warnings, ...deliveryWarnings])] } : report;
}
