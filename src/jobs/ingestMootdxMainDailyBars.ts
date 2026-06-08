import "../server/db.js";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../server/db.js";
import { mergeDailyBarCache, readDailyBarCache, writeDailyBarCache } from "../data/dailyBarCache.js";
import { toJsonText } from "../server/json.js";
import type { DailyBar } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const startedAt = new Date();
const options = parseArgs(process.argv.slice(2));

try {
  const result = await ingestMootdxMainDailyBars(options);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await prisma.dataProviderRun.create({
    data: {
      provider: "mootdx",
      command: "ingest:mootdx-main-daily-bars",
      status: "failed",
      startedAt,
      finishedAt: new Date(),
      warnings: "[]",
      error: error instanceof Error ? error.message : String(error),
      rowCount: 0
    }
  });
  throw error;
} finally {
  await prisma.$disconnect();
}

async function ingestMootdxMainDailyBars(config: IngestOptions) {
  const envelope = await fetchMootdxBars(config);
  const bars = envelope.data.bars;
  const tradeDate = envelope.data.tradeDate ?? latestTradeDate(bars);
  if (!tradeDate) throw new Error("mootdx returned bars without tradeDate");

  await persistBars(tradeDate, bars);
  const previous = await readDailyBarCache(process.cwd());
  const cache = mergeDailyBarCache(previous, bars, "mootdx", envelope.warnings, config.cacheWindowDays);
  await writeDailyBarCache(process.cwd(), cache);

  const rawPath = await writeRawSnapshot(tradeDate, {
    source: "mootdx",
    fetchedAt: new Date().toISOString(),
    ...envelope.data,
    warnings: envelope.warnings
  });

  await prisma.dataProviderRun.create({
    data: {
      provider: "mootdx",
      command: "ingest:mootdx-main-daily-bars",
      status: envelope.status,
      startedAt,
      finishedAt: new Date(),
      warnings: toJsonText(envelope.warnings),
      rowCount: bars.length
    }
  });

  return {
    tradeDate,
    bars: bars.length,
    stocks: new Set(bars.map((bar) => bar.code)).size,
    rawPath,
    cacheBars: cache.bars.length,
    warnings: envelope.warnings
  };
}

async function fetchMootdxBars(config: IngestOptions): Promise<MootdxEnvelope> {
  const pythonBin = config.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
  const worker = process.env.MOOTDX_WORKER ?? "python/mootdx_daily_bars.py";
  const workerPath = path.isAbsolute(worker) ? worker : path.join(process.cwd(), worker);
  const args = [
    workerPath,
    "--days",
    String(config.days),
    "--concurrency",
    String(config.concurrency),
    "--delay-ms",
    String(config.delayMs)
  ];
  if (config.maxCodes) args.push("--max-codes", String(config.maxCodes));
  if (config.universeFile) args.push("--universe-file", config.universeFile);

  const { stdout } = await execFileAsync(pythonBin, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 256 * 1024 * 1024,
    timeout: Number(process.env.MOOTDX_TIMEOUT_MS ?? 1_800_000)
  });
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) throw new Error("mootdx worker did not return JSON");
  return JSON.parse(stdout.slice(jsonStart)) as MootdxEnvelope;
}

async function persistBars(tradeDate: string, bars: DailyBar[]) {
  await prisma.tradingDay.upsert({
    where: { tradeDate },
    update: { status: "closed" },
    create: { tradeDate, status: "closed" }
  });

  for (const bar of bars) {
    await prisma.stock.upsert({
      where: { code: bar.code },
      update: {
        name: bar.name,
        market: bar.market
      },
      create: {
        code: bar.code,
        name: bar.name,
        market: bar.market,
        concepts: "[]"
      }
    });

    await prisma.dailyBarRecord.upsert({
      where: { tradeDate_code: { tradeDate: bar.tradeDate, code: bar.code } },
      update: {
        name: bar.name,
        market: bar.market,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        amount: bar.amount,
        pctChange: bar.pctChange,
        turnoverRate: bar.turnoverRate,
        provider: bar.provider
      },
      create: {
        tradeDate: bar.tradeDate,
        code: bar.code,
        name: bar.name,
        market: bar.market,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        amount: bar.amount,
        pctChange: bar.pctChange,
        turnoverRate: bar.turnoverRate,
        provider: bar.provider
      }
    });
  }
}

async function writeRawSnapshot(tradeDate: string, payload: unknown) {
  const filePath = path.join(process.cwd(), "data", "mootdx", `main-daily-bars-${tradeDate}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function latestTradeDate(bars: DailyBar[]): string | null {
  return [...new Set(bars.map((bar) => bar.tradeDate))].sort().at(-1) ?? null;
}

interface MootdxEnvelope {
  provider: string;
  command: string;
  status: "success" | "failed" | "partial";
  data: {
    tradeDate: string | null;
    universeCount: number;
    failedCount: number;
    bars: DailyBar[];
  };
  warnings: string[];
  dataAsOf: string;
}

interface IngestOptions {
  days: number;
  concurrency: number;
  delayMs: number;
  cacheWindowDays: number;
  maxCodes?: number;
  universeFile?: string;
  pythonBin?: string;
}

function parseArgs(args: string[]): IngestOptions {
  const get = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const maxCodes = get("max-codes");
  return {
    days: Number(get("days") ?? 30),
    concurrency: Number(get("concurrency") ?? 8),
    delayMs: Number(get("delay-ms") ?? 0),
    cacheWindowDays: Number(get("cache-window-days") ?? 30),
    maxCodes: maxCodes ? Number(maxCodes) : undefined,
    universeFile: get("universe-file"),
    pythonBin: get("python-bin")
  };
}
