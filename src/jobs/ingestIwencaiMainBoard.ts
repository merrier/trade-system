import "../server/db.js";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../server/db.js";
import { toJsonText } from "../server/json.js";
import { readDailyBarCache, writeDailyBarCache, mergeDailyBarCache } from "../data/dailyBarCache.js";
import type { DailyBar } from "../shared/types.js";

const execFileAsync = promisify(execFile);

interface IwencaiCliResponse {
  success: boolean;
  query: string;
  code_count: number;
  returned_count: number;
  page: string;
  limit: string;
  has_more: boolean;
  chunks_info?: unknown;
  trace_id?: string;
  datas: Array<Record<string, unknown>>;
  error?: string;
}

const defaultQuery = [
  "A股主板股票",
  "股票代码 股票简称 上市板块",
  "最新价 涨跌幅",
  "开盘价 最高价 最低价 收盘价",
  "成交量 成交额 换手率",
  "主力资金流向 主力增仓占比"
].join(" ");

const options = parseArgs(process.argv.slice(2));
const startedAt = new Date();

try {
  const result = await ingestIwencaiMainBoard(options);
  console.log(
    JSON.stringify(
      {
        tradeDate: result.tradeDate,
        rows: result.rows,
        rawPath: result.rawPath,
        cacheBars: result.cacheBars,
        warnings: result.warnings
      },
      null,
      2
    )
  );
} catch (error) {
  const finishedAt = new Date();
  await prisma.dataProviderRun.create({
    data: {
      provider: "iwencai",
      command: "ingest:iwencai-main-board",
      status: "failed",
      startedAt,
      finishedAt,
      warnings: "[]",
      error: error instanceof Error ? error.message : String(error),
      rowCount: 0
    }
  });
  throw error;
} finally {
  await prisma.$disconnect();
}

async function ingestIwencaiMainBoard(config: IngestOptions) {
  const cliPath = expandHome(config.cliPath ?? process.env.IWENCAI_SKILL_CLI ?? "~/.codex/skills/hithink-market-query/scripts/cli.py");
  const pythonBin = config.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
  const warnings: string[] = [];

  if (!process.env.IWENCAI_API_KEY) {
    warnings.push("IWENCAI_API_KEY is not present in the current process environment.");
  }

  const firstPage = await fetchPage({ pythonBin, cliPath, query: config.query, page: 1, limit: config.limit });
  const total = Number(firstPage.code_count || firstPage.datas.length);
  const maxPages = config.maxPages ?? Math.ceil(total / config.limit);
  const pages: IwencaiCliResponse[] = [firstPage];

  for (let page = 2; page <= maxPages && pages.at(-1)?.has_more; page += 1) {
    await sleep(config.delayMs);
    pages.push(await fetchPage({ pythonBin, cliPath, query: config.query, page, limit: config.limit }));
  }

  const rawRows = uniqueByCode(pages.flatMap((page) => page.datas));
  const bars = rawRows.map(toDailyBar).filter((bar): bar is DailyBar => Boolean(bar));
  const tradeDate = config.tradeDate ?? mostCommon(bars.map((bar) => bar.tradeDate)) ?? inferTradeDate(rawRows) ?? formatDate(new Date());
  const finalBars = bars.map((bar) => ({ ...bar, tradeDate }));

  if (finalBars.length < total) {
    warnings.push(`问财返回总数 ${total}，去重并归一化后可落库 ${finalBars.length} 条。`);
  }

  await persistBars(tradeDate, finalBars);
  const rawPath = await writeRawSnapshot(tradeDate, {
    source: "iwencai",
    query: config.query,
    fetchedAt: new Date().toISOString(),
    codeCount: total,
    rows: rawRows,
    pages: pages.map((page) => ({
      page: page.page,
      returnedCount: page.returned_count,
      hasMore: page.has_more,
      traceId: page.trace_id
    }))
  });

  const previous = await readDailyBarCache(process.cwd());
  const cache = mergeDailyBarCache(previous, finalBars, "iwencai", warnings, config.cacheWindowDays);
  await writeDailyBarCache(process.cwd(), cache);

  const finishedAt = new Date();
  await prisma.dataProviderRun.create({
    data: {
      provider: "iwencai",
      command: "ingest:iwencai-main-board",
      status: warnings.length ? "partial" : "success",
      startedAt,
      finishedAt,
      warnings: toJsonText(warnings),
      rowCount: finalBars.length
    }
  });

  return {
    tradeDate,
    rows: finalBars.length,
    rawPath,
    cacheBars: cache.bars.length,
    warnings
  };
}

async function fetchPage(input: { pythonBin: string; cliPath: string; query: string; page: number; limit: number }): Promise<IwencaiCliResponse> {
  const { stdout } = await execFileAsync(
    input.pythonBin,
    [input.cliPath, "--query", input.query, "--page", String(input.page), "--limit", String(input.limit)],
    {
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(process.env.IWENCAI_TIMEOUT_MS ?? 60_000)
    }
  );
  const response = JSON.parse(stdout.slice(stdout.indexOf("{"))) as IwencaiCliResponse;
  if (!response.success) {
    throw new Error(response.error ?? `Iwencai query failed on page ${input.page}`);
  }
  return response;
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
        market: bar.market,
        isST: isStName(bar.name),
        isSuspended: bar.close <= 0
      },
      create: {
        code: bar.code,
        name: bar.name,
        market: bar.market,
        concepts: "[]",
        isST: isStName(bar.name),
        isSuspended: bar.close <= 0
      }
    });

    await prisma.dailyBarRecord.upsert({
      where: { tradeDate_code: { tradeDate, code: bar.code } },
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
        tradeDate,
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
  const filePath = path.join(process.cwd(), "data", "iwencai", `main-board-${tradeDate}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function toDailyBar(row: Record<string, unknown>): DailyBar | null {
  const code = text(row["股票代码"]);
  const name = text(row["股票简称"]);
  if (!code || !name || !isMainBoardCode(code)) return null;

  const tradeDate = inferTradeDate([row]) ?? formatDate(new Date());
  const close = numberValue(row, "收盘价") || numberValue(row, "最新价");
  const pctChange = numberValue(row, "涨跌幅") || numberValue(row, "最新涨跌幅");

  return {
    tradeDate,
    code,
    name,
    market: "main",
    open: numberValue(row, "开盘价_前复权") || numberValue(row, "开盘价") || close,
    high: numberValue(row, "最高价_前复权") || numberValue(row, "最高价") || close,
    low: numberValue(row, "最低价_前复权") || numberValue(row, "最低价") || close,
    close,
    volume: numberValue(row, "成交量"),
    amount: numberValue(row, "成交额"),
    pctChange,
    turnoverRate: numberValue(row, "换手率"),
    provider: "iwencai"
  };
}

function numberValue(row: Record<string, unknown>, prefix: string): number {
  const direct = parseNumber(row[prefix]);
  if (direct !== 0) return direct;
  const matchedKey = Object.keys(row).find((key) => key === prefix || key.startsWith(`${prefix}[`));
  return parseNumber(matchedKey ? row[matchedKey] : undefined);
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (!normalized || normalized === "--") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueByCode(rows: Array<Record<string, unknown>>) {
  const byCode = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const code = text(row["股票代码"]);
    if (code) byCode.set(code, row);
  }
  return [...byCode.values()];
}

function inferTradeDate(rows: Array<Record<string, unknown>>): string | null {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const match = key.match(/\[(\d{8})\]/);
      if (match) return match[1];
    }
  }
  return null;
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isMainBoardCode(code: string): boolean {
  return /^(000|001|002|600|601|603|605)/.test(code.replace(/\.(SZ|SH)$/i, ""));
}

function isStName(name: string): boolean {
  return /(^\*?ST|退$)/i.test(name);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(date)
    .replace(/\//g, "");
}

function expandHome(input: string): string {
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface IngestOptions {
  query: string;
  limit: number;
  delayMs: number;
  cacheWindowDays: number;
  maxPages?: number;
  tradeDate?: string;
  cliPath?: string;
  pythonBin?: string;
}

function parseArgs(args: string[]): IngestOptions {
  const get = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const maxPages = get("max-pages");
  return {
    query: get("query") ?? defaultQuery,
    limit: Number(get("limit") ?? 100),
    delayMs: Number(get("delay-ms") ?? 250),
    cacheWindowDays: Number(get("cache-window-days") ?? 90),
    maxPages: maxPages ? Number(maxPages) : undefined,
    tradeDate: get("trade-date"),
    cliPath: get("cli-path"),
    pythonBin: get("python-bin")
  };
}
