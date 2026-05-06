import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSampleDataset } from "./sampleDataset.js";
import type { MarketDataset, RunMode } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export async function fetchMarketDataset(mode: RunMode = "post_close", tradeDate?: string): Promise<MarketDataset> {
  const worker = process.env.AKSHARE_WORKER ?? "python/akshare_worker.py";
  const workerPath = path.isAbsolute(worker) ? worker : path.join(repoRoot, worker);
  const pythonBin = process.env.PYTHON_BIN ?? "python3";

  try {
    const raw = await runPythonWorker(pythonBin, workerPath, mode, tradeDate);
    const parsed = JSON.parse(raw) as MarketDataset;
    if (!parsed.stocks?.length || !parsed.sectors?.length) {
      throw new Error("worker returned empty dataset");
    }
    return parsed;
  } catch {
    if (process.env.ALLOW_SAMPLE_DATA !== "true") {
      throw new Error("真实数据源不可用；如需开发演示数据，请设置 ALLOW_SAMPLE_DATA=true。");
    }
    const dataset = createSampleDataset(tradeDate);
    dataset.dataAsOf = new Date().toISOString();
    return dataset;
  }
}

function runPythonWorker(pythonBin: string, workerPath: string, mode: RunMode, tradeDate?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [workerPath, "--mode", mode];
    if (tradeDate) args.push("--trade-date", tradeDate);
    if (process.env.ALLOW_SAMPLE_DATA === "true") args.push("--allow-sample");
    const child = spawn(pythonBin, args, {
      cwd: repoRoot,
      env: process.env
    });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("AKShare worker timeout"));
    }, 30_000);

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
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(stderr || `worker exited with ${code}`));
    });
  });
}
