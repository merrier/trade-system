import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSampleDataset } from "./sampleDataset.js";
import type { DailyBar, DataProviderRun, MarketDataset, RunMode, UsMarketBrief } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export type WorkerCommand = "intraday-snapshot" | "limit-up-ladder" | "sector-flow" | "daily-bars" | "us-market-brief";

export interface WorkerEnvelope<T> {
  provider: string;
  command: WorkerCommand;
  status: "success" | "failed" | "partial";
  data: T;
  warnings: string[];
  dataAsOf: string;
}

export interface ProviderAttempt<T> {
  envelope: WorkerEnvelope<T>;
  runs: DataProviderRun[];
}

export type WorkerRunner<T> = (provider: string, command: WorkerCommand) => Promise<WorkerEnvelope<T>>;

const datasetProviders = ["akshare", "efinance", "baostock"];
const usBriefProviders = ["yfinance", "stooq", "alpha_vantage"];

export async function fetchMarketDataset(mode: RunMode = "post_close", tradeDate?: string): Promise<MarketDataset> {
  const command: WorkerCommand = mode === "intraday" ? "intraday-snapshot" : "limit-up-ladder";
  try {
    const attempt = await runProviderFailover<MarketDataset>(command, datasetProviders, { mode, tradeDate });
    const dataset = normalizeDataset(attempt.envelope.data, attempt.envelope.provider, attempt.runs);
    if (!dataset.stocks.length || !dataset.sectors.length) {
      throw new Error("provider chain returned empty dataset");
    }
    return dataset;
  } catch (error) {
    if (process.env.ALLOW_SAMPLE_DATA === "true") {
      const dataset = createSampleDataset(tradeDate);
      dataset.dataAsOf = new Date().toISOString();
      dataset.warnings = [
        ...dataset.warnings,
        `真实数据源不可用，已按显式 ALLOW_SAMPLE_DATA=true 使用样例：${error instanceof Error ? error.message : "unknown error"}`
      ];
      return dataset;
    }
    throw error;
  }
}

export async function fetchDailyBars(tradeDate?: string, days = 30): Promise<{ bars: DailyBar[]; provider: string; warnings: string[]; runs: DataProviderRun[] }> {
  const attempt = await runProviderFailover<DailyBar[]>("daily-bars", getDailyBarProviders(), { tradeDate, days });
  return {
    bars: attempt.envelope.data.filter((bar) => isMainBoardCode(bar.code)),
    provider: attempt.envelope.provider,
    warnings: mergeWarnings(attempt.envelope.warnings, attempt.runs),
    runs: attempt.runs
  };
}

function getDailyBarProviders(): string[] {
  if (process.env.DAILY_BARS_LIMIT_UP_UNIVERSE === "true") {
    return ["baostock", "efinance", "akshare"];
  }
  return ["efinance", "akshare", "baostock"];
}

export async function fetchUsMarketBrief(): Promise<{ brief: UsMarketBrief; provider: string; warnings: string[]; runs: DataProviderRun[] }> {
  const attempt = await runProviderFailover<UsMarketBrief>("us-market-brief", usBriefProviders, {});
  return {
    brief: attempt.envelope.data,
    provider: attempt.envelope.provider,
    warnings: mergeWarnings(attempt.envelope.warnings, attempt.runs),
    runs: attempt.runs
  };
}

export async function runProviderFailover<T>(
  command: WorkerCommand,
  providers: string[],
  options: { mode?: RunMode; tradeDate?: string; days?: number },
  runner: WorkerRunner<T> = (provider, cmd) => runPythonWorker<T>(provider, cmd, options)
): Promise<ProviderAttempt<T>> {
  const runs: DataProviderRun[] = [];
  for (const provider of providers) {
    const startedAt = new Date().toISOString();
    try {
      const envelope = await runner(provider, command);
      const finishedAt = new Date().toISOString();
      runs.push({
        provider,
        command,
        status: envelope.status,
        startedAt,
        finishedAt,
        warnings: envelope.warnings,
        rowCount: Array.isArray(envelope.data) ? envelope.data.length : undefined
      });
      if (envelope.status !== "failed") return { envelope, runs };
    } catch (error) {
      runs.push({
        provider,
        command,
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        warnings: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  throw new Error(`${command} all providers failed: ${runs.map((run) => `${run.provider}: ${run.error ?? run.status}`).join("；")}`);
}

function normalizeDataset(dataset: MarketDataset, provider: string, runs: DataProviderRun[]): MarketDataset {
  return {
    ...dataset,
    source: dataset.source === "akshare_partial" ? "akshare_partial" : (provider as MarketDataset["source"]),
    warnings: mergeWarnings(dataset.warnings, runs),
    stocks: dataset.stocks.filter((stock) => isMainBoardCode(stock.code)),
    limitUps: dataset.limitUps.filter((item) => isMainBoardCode(item.code))
  };
}

function mergeWarnings(warnings: string[], runs: DataProviderRun[]): string[] {
  const failed = runs.filter((run) => run.status === "failed").map((run) => `${run.provider}失败：${run.error ?? "unknown error"}`);
  return [...new Set([...failed, ...warnings])];
}

function isMainBoardCode(code: string): boolean {
  return /^(000|001|002|600|601|603|605)/.test(code);
}

function runPythonWorker<T>(provider: string, command: WorkerCommand, options: { mode?: RunMode; tradeDate?: string; days?: number }): Promise<WorkerEnvelope<T>> {
  return new Promise((resolve, reject) => {
    const worker = process.env.AKSHARE_WORKER ?? "python/akshare_worker.py";
    const workerPath = path.isAbsolute(worker) ? worker : path.join(repoRoot, worker);
    const pythonBin = process.env.PYTHON_BIN ?? "python3";
    const args = [workerPath, "--command", command, "--provider", provider];
    if (options.mode) args.push("--mode", options.mode);
    if (options.tradeDate) args.push("--trade-date", options.tradeDate);
    if (options.days) args.push("--days", String(options.days));
    if (process.env.ALLOW_SAMPLE_DATA === "true") args.push("--allow-sample");

    const child = spawn(pythonBin, args, {
      cwd: repoRoot,
      env: process.env
    });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${provider} ${command} timeout`));
    }, Number(process.env.DATA_PROVIDER_TIMEOUT_MS ?? 120_000));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(extractWorkerError(stderr) || `${provider} ${command} exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as WorkerEnvelope<T>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function extractWorkerError(stderr: string): string {
  const firstLine = stderr.trim().split("\n")[0];
  if (!firstLine) return "";
  try {
    const parsed = JSON.parse(firstLine) as { error?: string };
    return parsed.error ?? firstLine;
  } catch {
    return firstLine;
  }
}
