import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DailyBar } from "../shared/types.js";

const barSchema = z.object({
  tradeDate: z.string(),
  code: z.string(),
  name: z.string(),
  market: z.enum(["main", "gem", "star", "bse"]),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  amount: z.number(),
  pctChange: z.number(),
  turnoverRate: z.number(),
  provider: z.string()
});

export const dailyBarCacheSchema = z.object({
  tradeDate: z.string().nullable(),
  dataAsOf: z.string(),
  source: z.string(),
  warnings: z.array(z.string()),
  bars: z.array(barSchema)
});

export type DailyBarCache = z.infer<typeof dailyBarCacheSchema>;

export function mergeDailyBarCache(previous: DailyBarCache | null, incoming: DailyBar[], source: string, warnings: string[], windowSize = 30): DailyBarCache {
  const byKey = new Map<string, DailyBar>();
  for (const bar of previous?.bars ?? []) {
    const normalized = normalizeDailyBar(bar);
    if (isMainBoardCode(normalized.code)) byKey.set(`${normalized.tradeDate}:${normalized.code}`, normalized);
  }
  for (const bar of incoming) {
    const normalized = normalizeDailyBar(bar);
    if (isMainBoardCode(normalized.code)) byKey.set(`${normalized.tradeDate}:${normalized.code}`, normalized);
  }

  const sortedDates = [...new Set([...byKey.values()].map((bar) => bar.tradeDate))].sort();
  const keepDates = new Set(sortedDates.slice(Math.max(0, sortedDates.length - windowSize)));
  const bars = [...byKey.values()]
    .filter((bar) => keepDates.has(bar.tradeDate))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.code.localeCompare(b.code));

  return {
    tradeDate: sortedDates.at(-1) ?? null,
    dataAsOf: new Date().toISOString(),
    source,
    warnings,
    bars
  };
}

export async function readDailyBarCache(root: string): Promise<DailyBarCache | null> {
  const filePath = path.join(root, "cache", "main-daily-bars.json");
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = dailyBarCacheSchema.parse(JSON.parse(text));
    return { ...parsed, bars: normalizeDailyBars(parsed.bars) };
  } catch {
    return null;
  }
}

export async function writeDailyBarCache(root: string, cache: DailyBarCache): Promise<void> {
  const filePath = path.join(root, "cache", "main-daily-bars.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  dailyBarCacheSchema.parse(cache);
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function isMainBoardCode(code: string): boolean {
  return /^(000|001|002|600|601|603|605)/.test(code);
}

function normalizeDailyBar(bar: DailyBar): DailyBar {
  return { ...bar, code: normalizeStockCode(bar.code) };
}

function normalizeStockCode(code: string): string {
  return code.trim().toUpperCase().replace(/\.(SH|SZ)$/, "");
}

function normalizeDailyBars(bars: DailyBar[]): DailyBar[] {
  const byKey = new Map<string, DailyBar>();
  for (const bar of bars) {
    const normalized = normalizeDailyBar(bar);
    if (isMainBoardCode(normalized.code)) byKey.set(`${normalized.tradeDate}:${normalized.code}`, normalized);
  }
  return [...byKey.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.code.localeCompare(b.code));
}
