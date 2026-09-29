import { validateReportArtifact } from "../core/reports.js";
import type { ReportArtifact } from "../shared/types.js";
import { readReportArtifact } from "./reportArtifacts.js";

let published: ReportArtifact | null = null;
let checkedAt = 0;
let pending: Promise<void> | undefined;

export async function readLatestMorningReport(dataRoots: string[]): Promise<ReportArtifact | null> {
  if (Date.now() - checkedAt > 60_000) {
    pending ??= (async () => {
      try {
        const response = await fetch("https://raw.githubusercontent.com/merrier/trade-system/main/data/reports/morning/latest.json", {
          signal: AbortSignal.timeout(8_000), cache: "no-store"
        });
        if (!response.ok) throw new Error("Published morning report unavailable");
        const report = validateReportArtifact(await response.json());
        if (report.kind !== "morning" || !/^\d{8}$/.test(report.tradeDate) || !Number.isFinite(Date.parse(report.generatedAt))) {
          throw new Error("Invalid published morning report");
        }
        published = report;
      } catch {
        // Keep the last verified cloud report and local files available during network failures.
      } finally { checkedAt = Date.now(); }
    })();
    try { await pending; } finally { pending = undefined; }
  }
  const local = await Promise.all(dataRoots.map((root) => readReportArtifact(root, "morning")));
  return [...local, published].filter((item): item is ReportArtifact => item !== null)
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] ?? null;
}
