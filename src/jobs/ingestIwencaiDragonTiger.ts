import "../server/db.js";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../server/db.js";
import { toJsonText } from "../server/json.js";
import type { Market } from "../shared/types.js";

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

interface FetchPageResult {
  response: IwencaiCliResponse;
  keyIndex: number;
}

interface SeatItem {
  name: string;
  side: "buy" | "sell";
  amount: number;
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  position?: string;
  type: string[];
}

interface DragonTigerItem {
  tradeDate: string;
  code: string;
  name: string;
  market: Market;
  reason?: string;
  buyAmount: number;
  sellAmount: number;
  netAmount: number;
  seats: SeatItem[];
}

const defaultQuery = [
  "今日A股龙虎榜",
  "股票代码 股票简称 上榜日期 上榜原因",
  "龙虎榜净买入额 龙虎榜买入额 龙虎榜卖出额",
  "营业部名称 买卖席位 营业部类型",
  "买入额占成交额比例 卖出额占成交额比例 净买入额占成交额比例"
].join(" ");

const options = parseArgs(process.argv.slice(2));
const startedAt = new Date();

try {
  const result = await ingestIwencaiDragonTiger(options);
  console.log(
    JSON.stringify(
      {
        tradeDate: result.tradeDate,
        rows: result.rows,
        rawRows: result.rawRows,
        rawPath: result.rawPath,
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
      command: "ingest:iwencai-dragon-tiger",
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

async function ingestIwencaiDragonTiger(config: IngestOptions) {
  const cliPath = expandHome(config.cliPath ?? process.env.IWENCAI_SKILL_CLI ?? "~/.codex/skills/hithink-market-query/scripts/cli.py");
  const pythonBin = config.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
  const warnings: string[] = [];
  const apiKeys = uniqueStrings([process.env.IWENCAI_API_KEY, process.env.IWENCAI_API_KEY_FALLBACK]);

  if (apiKeys.length === 0) {
    warnings.push("IWENCAI_API_KEY is not present in the current process environment.");
  }

  const firstPageResult = await fetchPage({ pythonBin, cliPath, query: config.query, page: 1, limit: config.limit, apiKeys, preferredKeyIndex: 0 });
  let activeKeyIndex = firstPageResult.keyIndex;
  const firstPage = firstPageResult.response;
  const total = Number(firstPage.code_count || firstPage.datas.length);
  const maxPages = config.maxPages ?? Math.ceil(total / config.limit);
  const pages: IwencaiCliResponse[] = [firstPage];

  for (let page = 2; page <= maxPages && pages.at(-1)?.has_more; page += 1) {
    await sleep(config.delayMs);
    const pageResult = await fetchPage({ pythonBin, cliPath, query: config.query, page, limit: config.limit, apiKeys, preferredKeyIndex: activeKeyIndex });
    if (pageResult.keyIndex !== activeKeyIndex) {
      warnings.push(`问财龙虎榜分页抓取在第 ${page} 页切换到备用 API key。`);
      activeKeyIndex = pageResult.keyIndex;
    }
    pages.push(pageResult.response);
  }

  const rawRows = pages.flatMap((page) => page.datas);
  const tradeDate = config.tradeDate ?? mostCommon(rawRows.map(inferRowTradeDate).filter((value): value is string => Boolean(value))) ?? inferTradeDate(rawRows) ?? formatDate(new Date());
  const items = aggregateDragonTigerRows(tradeDate, rawRows);

  if (rawRows.length < total) {
    warnings.push(`问财返回龙虎榜明细总数 ${total}，当前抓取 ${rawRows.length} 条。`);
  }

  await persistDragonTiger(tradeDate, items);
  const rawPath = await writeRawSnapshot(tradeDate, {
    source: "iwencai",
    query: config.query,
    fetchedAt: new Date().toISOString(),
    codeCount: total,
    stockCount: items.length,
    rows: rawRows,
    pages: pages.map((page) => ({
      page: page.page,
      returnedCount: page.returned_count,
      hasMore: page.has_more,
      traceId: page.trace_id
    }))
  });

  const finishedAt = new Date();
  await prisma.dataProviderRun.create({
    data: {
      provider: "iwencai",
      command: "ingest:iwencai-dragon-tiger",
      status: warnings.length ? "partial" : "success",
      startedAt,
      finishedAt,
      warnings: toJsonText(warnings),
      rowCount: items.length
    }
  });

  return { tradeDate, rows: items.length, rawRows: rawRows.length, rawPath, warnings };
}

async function fetchPage(input: {
  pythonBin: string;
  cliPath: string;
  query: string;
  page: number;
  limit: number;
  apiKeys: string[];
  preferredKeyIndex: number;
}): Promise<FetchPageResult> {
  const keyOrder = keyAttemptOrder(input.apiKeys, input.preferredKeyIndex);
  const errors: string[] = [];

  for (const keyIndex of keyOrder) {
    try {
      const { stdout } = await execFileAsync(
        input.pythonBin,
        [input.cliPath, "--query", input.query, "--page", String(input.page), "--limit", String(input.limit)],
        {
          env: { ...process.env, IWENCAI_API_KEY: input.apiKeys[keyIndex] },
          maxBuffer: 20 * 1024 * 1024,
          timeout: Number(process.env.IWENCAI_TIMEOUT_MS ?? 60_000)
        }
      );
      const jsonStart = stdout.indexOf("{");
      if (jsonStart < 0) throw new Error("Iwencai CLI did not return JSON output.");
      const response = JSON.parse(stdout.slice(jsonStart)) as IwencaiCliResponse;
      if (!response.success) {
        throw new Error(response.error ?? `Iwencai dragon-tiger query failed on page ${input.page}`);
      }
      return { response, keyIndex };
    } catch (error) {
      errors.push(`key#${keyIndex + 1}: ${error instanceof Error ? sanitizeError(error.message) : String(error)}`);
    }
  }

  throw new Error(`Iwencai dragon-tiger query failed on page ${input.page}; ${errors.join("; ")}`);
}

function aggregateDragonTigerRows(tradeDate: string, rows: Array<Record<string, unknown>>): DragonTigerItem[] {
  const byCode = new Map<string, DragonTigerItem>();

  for (const row of rows) {
    const code = text(row["股票代码"]);
    const name = text(row["股票简称"]);
    if (!code || !name) continue;

    const buyAmount = numberValue(row, "买入额");
    const sellAmount = numberValue(row, "卖出额");
    const netAmount = numberValue(row, "净买入额") || buyAmount - sellAmount;
    const seat = toSeat(row, buyAmount, sellAmount, netAmount);
    const existing = byCode.get(code);

    if (existing) {
      existing.buyAmount += buyAmount;
      existing.sellAmount += sellAmount;
      existing.netAmount += netAmount;
      existing.seats.push(seat);
      if (!existing.reason) existing.reason = textValue(row, "上榜原因");
      continue;
    }

    byCode.set(code, {
      tradeDate,
      code,
      name,
      market: marketFromCode(code),
      reason: textValue(row, "上榜原因"),
      buyAmount,
      sellAmount,
      netAmount,
      seats: [seat]
    });
  }

  return [...byCode.values()].sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount));
}

function toSeat(row: Record<string, unknown>, buyAmount: number, sellAmount: number, netAmount: number): SeatItem {
  const position = text(row["买卖席位"]);
  const side: "buy" | "sell" = position.startsWith("卖") || (sellAmount > buyAmount && !position.startsWith("买")) ? "sell" : "buy";
  return {
    name: text(row["营业部名称"]) || "未知席位",
    side,
    amount: side === "buy" ? buyAmount : sellAmount,
    buyAmount,
    sellAmount,
    netAmount,
    position: position || undefined,
    type: arrayText(row["营业部类型"])
  };
}

async function persistDragonTiger(tradeDate: string, items: DragonTigerItem[]) {
  await prisma.tradingDay.upsert({
    where: { tradeDate },
    update: { status: "closed" },
    create: { tradeDate, status: "closed" }
  });

  for (const item of items) {
    await prisma.stock.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        market: item.market,
        isST: isStName(item.name)
      },
      create: {
        code: item.code,
        name: item.name,
        market: item.market,
        concepts: "[]",
        isST: isStName(item.name)
      }
    });

    await prisma.dragonTigerRecord.upsert({
      where: { tradeDate_code: { tradeDate, code: item.code } },
      update: {
        name: item.name,
        reason: item.reason,
        buyAmount: item.buyAmount,
        sellAmount: item.sellAmount,
        netAmount: item.netAmount,
        seats: toJsonText(item.seats)
      },
      create: {
        tradeDate,
        code: item.code,
        name: item.name,
        reason: item.reason,
        buyAmount: item.buyAmount,
        sellAmount: item.sellAmount,
        netAmount: item.netAmount,
        seats: toJsonText(item.seats)
      }
    });
  }
}

async function writeRawSnapshot(tradeDate: string, payload: unknown) {
  const filePath = path.join(process.cwd(), "data", "iwencai", `dragon-tiger-${tradeDate}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function numberValue(row: Record<string, unknown>, prefix: string): number {
  const direct = parseNumber(row[prefix]);
  if (direct !== 0) return direct;
  const matchedKey = Object.keys(row).find((key) => key === prefix || key.startsWith(`${prefix}[`) || key.includes(prefix));
  return parseNumber(matchedKey ? row[matchedKey] : undefined);
}

function textValue(row: Record<string, unknown>, prefix: string): string {
  const direct = text(row[prefix]);
  if (direct) return direct;
  const matchedKey = Object.keys(row).find((key) => key === prefix || key.startsWith(`${prefix}[`) || key.includes(prefix));
  return text(matchedKey ? row[matchedKey] : undefined);
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

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function keyAttemptOrder(apiKeys: string[], preferredKeyIndex: number): number[] {
  if (apiKeys.length === 0) return [];
  const normalized = Math.min(Math.max(preferredKeyIndex, 0), apiKeys.length - 1);
  return [normalized, ...apiKeys.map((_, index) => index).filter((index) => index !== normalized)];
}

function sanitizeError(message: string): string {
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").replace(/sk-proj-[A-Za-z0-9._-]+/g, "sk-proj-***");
}

function inferRowTradeDate(row: Record<string, unknown>): string | null {
  const listedDate = text(row["上榜日期"]);
  if (/^\d{8}$/.test(listedDate)) return listedDate;
  return inferTradeDate([row]);
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

function marketFromCode(code: string): Market {
  const normalized = code.replace(/\.(SZ|SH|BJ)$/i, "");
  if (/^(300|301)/.test(normalized)) return "gem";
  if (/^(688|689)/.test(normalized)) return "star";
  if (/^(8|4|92)/.test(normalized)) return "bse";
  return "main";
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
    maxPages: maxPages ? Number(maxPages) : undefined,
    tradeDate: get("trade-date"),
    cliPath: get("cli-path"),
    pythonBin: get("python-bin")
  };
}
