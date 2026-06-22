import fs from "node:fs/promises";
import path from "node:path";
import { fetchTdx2dbDailyBars } from "../data/tdx2dbDailyBars.js";
import { mergeDailyBarCache, readDailyBarCache, writeDailyBarCache } from "../data/dailyBarCache.js";
import type { DailyBar } from "../shared/types.js";

const startedAt = new Date();
const options = parseArgs(process.argv.slice(2));

const bars = await fetchTdx2dbDailyBars(options);
const tradeDate = latestTradeDate(bars);
if (!tradeDate) throw new Error("tdx2db 未导出任何主板日线");

const previous = await readDailyBarCache(process.cwd());
const warnings = buildWarnings(options);
const cache = mergeDailyBarCache(previous, bars, "tdx2db", warnings, options.cacheWindowDays);
await writeDailyBarCache(process.cwd(), cache);
const rawPath = await writeRawSnapshot(tradeDate, {
  source: "tdx2db",
  fetchedAt: new Date().toISOString(),
  dbPath: options.dbPath,
  view: options.view,
  days: options.days,
  tradeDate,
  bars,
  warnings
});

console.log(JSON.stringify({
  provider: "tdx2db",
  command: "ingest:tdx2db-daily-bars",
  status: "success",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  tradeDate,
  bars: bars.length,
  stocks: new Set(bars.map((bar) => bar.code)).size,
  rawPath,
  cacheBars: cache.bars.length,
  warnings
}, null, 2));

async function writeRawSnapshot(tradeDate: string, payload: unknown) {
  const filePath = path.join(process.cwd(), "data", "tdx2db", `main-daily-bars-${tradeDate}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function latestTradeDate(bars: DailyBar[]): string | null {
  return [...new Set(bars.map((bar) => bar.tradeDate))].sort().at(-1) ?? null;
}

interface IngestOptions {
  dbPath: string;
  days: number;
  view: string;
  duckdbBin: string;
  timeoutMs: number;
  cacheWindowDays: number;
}

function parseArgs(args: string[]): IngestOptions {
  const get = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  return {
    dbPath: get("db") ?? process.env.TDX2DB_DUCKDB_PATH ?? "data/tdx/tdx.db",
    days: Number(get("days") ?? process.env.TDX2DB_EXPORT_DAYS ?? 90),
    view: get("view") ?? process.env.TDX2DB_VIEW ?? "v_stock_qfq",
    duckdbBin: get("duckdb-bin") ?? process.env.DUCKDB_BIN ?? "duckdb",
    timeoutMs: Number(get("timeout-ms") ?? process.env.TDX2DB_TIMEOUT_MS ?? 300_000),
    cacheWindowDays: Number(get("cache-window-days") ?? process.env.TDX2DB_CACHE_WINDOW_DAYS ?? 90)
  };
}

function buildWarnings(options: IngestOptions): string[] {
  return [
    options.view !== "v_stock_qfq" ? `tdx2db 使用 ${options.view} 视图，可能与默认前复权口径不同。` : "",
    "tdx2db 只补历史日线，不提供盘中实时快照、涨停原因、龙虎榜或主力资金。"
  ].filter(Boolean);
}
