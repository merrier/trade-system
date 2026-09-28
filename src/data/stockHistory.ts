import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { currentShanghaiTradeDate, isAshareTradingDay } from "./tradingCalendar.js";
import type { StockHistory } from "../shared/kline.js";

const barSchema = z.object({
  date_ms: z.number().finite(),
  open_price: z.number().finite().positive(),
  high_price: z.number().finite().positive(),
  low_price: z.number().finite().positive(),
  close_price: z.number().finite().positive(),
  volume: z.number().finite().nonnegative()
}).refine((bar) => bar.high_price >= Math.max(bar.open_price, bar.close_price, bar.low_price) &&
  bar.low_price <= Math.min(bar.open_price, bar.close_price));

const cache = new Map<string, { expires: number; data: StockHistory }>();
const pending = new Map<string, Promise<StockHistory>>();
let queue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;

export function historyEndDate(now = new Date()): string {
  const date = currentShanghaiTradeDate(now);
  const cursor = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00+08:00`);
  // Give the upstream a short settlement window after the 15:00 close.
  if (now.getTime() < cursor.getTime() + (15 * 60 + 10) * 60_000) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (!isAshareTradingDay(currentShanghaiTradeDate(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  return `${currentShanghaiTradeDate(cursor).slice(0, 4)}-${currentShanghaiTradeDate(cursor).slice(4, 6)}-${currentShanghaiTradeDate(cursor).slice(6)}`;
}

export async function fetchStockHistory(code: string): Promise<StockHistory> {
  if (!/^(000|001|002|600|601|603|605)\d{3}$/.test(code)) {
    throw Object.assign(new Error("请输入六位主板股票代码"), { statusCode: 400 });
  }
  const endDate = historyEndDate();
  const cacheKey = `${code}:${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;
  const existing = pending.get(cacheKey);
  if (existing) return existing;
  const key = process.env.FUYAO_API_KEY?.trim();
  if (!key) throw Object.assign(new Error("服务端尚未配置 FUYAO_API_KEY"), { statusCode: 503 });
  // ponytail: process-wide serial queue; use a shared limiter if deployed with multiple workers.
  const task = queue.then(async () => {
    await delay(Math.max(0, nextRequestAt - Date.now()));
    const end = new Date(`${endDate}T00:00:00+08:00`);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 3);
    const params = new URLSearchParams({ thscode: `${code}.${code.startsWith("6") ? "SH" : "SZ"}`, interval: "1d", adjust: "forward", start: String(start.getTime()), end: String(end.getTime()) });
    try {
      const response = await fetch(`https://fuyao.aicubes.cn/api/a-share/prices/historical?${params}`, {
        headers: { "X-api-key": key }, signal: AbortSignal.timeout(20_000)
      });
      const payload = response.ok ? await response.json() : null;
      if (response.status === 429 || payload?.code === 4001) {
        const retry = response.headers.get("retry-after") ?? "60";
        const waitMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        nextRequestAt = Date.now() + Math.max(60_000, Number.isFinite(waitMs) ? waitMs : 60_000);
        throw new Error("行情接口限流，请稍后重试");
      }
      if (!response.ok || payload?.code !== 0) throw new Error("历史行情暂不可用，请稍后重试");
      const rows = z.array(barSchema).parse(payload?.data?.item);
      const bars = rows.map((row) => ({
        date: new Date(row.date_ms + 8 * 3600_000).toISOString().slice(0, 10),
        open: row.open_price, high: row.high_price, low: row.low_price, close: row.close_price,
        volume: row.volume / 100
      })).filter((bar) => bar.date <= endDate);
      const unique = [...new Map(bars.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
      const data: StockHistory = { code, source: "fuyao", adjustment: "forward", asOf: unique.at(-1)?.date ?? null, bars: unique };
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: Date.now() + 10 * 60_000, data });
      return data;
    } catch (error) {
      const message = error instanceof Error && error.message === "行情接口限流，请稍后重试" ? error.message : "历史行情暂不可用，请稍后重试";
      throw Object.assign(new Error(message), { statusCode: 503 });
    } finally {
      nextRequestAt = Math.max(nextRequestAt, Date.now() + 2000);
    }
  });
  pending.set(cacheKey, task);
  queue = task.catch(() => undefined);
  try { return await task; } finally { pending.delete(cacheKey); }
}
