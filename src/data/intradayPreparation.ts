import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { currentShanghaiTradeDate, isAshareTradingDay } from "./tradingCalendar.js";
import type { DailyBar } from "../shared/types.js";

export const historyRoot = "data/intraday-history";
let nextRequestAt = 0;

export function completeTradingWindow(tradeDate: string): string[] {
  const day = new Date(`${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}T00:00:00+08:00`);
  const dates: string[] = [];
  while (dates.length < 30) {
    day.setUTCDate(day.getUTCDate() - 1);
    const date = currentShanghaiTradeDate(day);
    if (isAshareTradingDay(date)) dates.unshift(date);
  }
  return dates;
}

export async function pacedFetch(url: string, headers: Record<string, string> = {}) {
  await delay(Math.max(0, nextRequestAt - Date.now()));
  try { return await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }); }
  finally { nextRequestAt = Date.now() + 2000; }
}

export async function fuyao(endpoint: string, params: Record<string, string>) {
  const key = process.env.FUYAO_API_KEY;
  if (!key) throw new Error("缺少 FUYAO_API_KEY");
  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = await pacedFetch(`https://fuyao.aicubes.cn${endpoint}?${new URLSearchParams(params)}`, { "X-api-key": key });
    const body = response.status === 429 ? null : await response.json();
    if (response.status === 429 || body?.code === 4001) {
      if (attempt === 3) throw new Error("Fuyao 持续限流，停止本轮并保留补齐进度");
      const header = response.headers.get("retry-after") ?? "0";
      const retry = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      nextRequestAt = Date.now() + Math.max(60_000 * 2 ** attempt, Number.isFinite(retry) ? retry : 0);
      continue;
    }
    if (!response.ok || body?.code !== 0 || !Array.isArray(body.data?.item)) throw new Error(`Fuyao ${endpoint} 请求失败`);
    return body.data;
  }
  throw new Error("Fuyao 请求失败");
}

export interface MainStock { ticker: string; name: string; list_date: string | null }
export async function mainStockCatalog(): Promise<MainStock[]> {
  const items: MainStock[] = [];
  for (let offset = 0; offset < 100000; offset += 10000) {
    const page = await fuyao("/api/meta/tickers/list", { asset_type: "a-share", limit: "10000", offset: String(offset) });
    items.push(...page.item.filter((item: MainStock) => /^(000|001|002|600|601|603|605)\d{3}$/.test(item.ticker)));
    if (page.item.length < 10000) {
      if (!items.length) throw new Error("主板代码表为空");
      return items;
    }
  }
  throw new Error("主板代码表分页异常");
}

export function validateHistory(bars: DailyBar[], dates: string[]): boolean {
  return bars.length === dates.length && new Set(bars.map((bar) => bar.tradeDate)).size === dates.length &&
    dates.every((date) => bars.some((bar) => bar.tradeDate === date)) && bars.every((bar) =>
      [bar.open, bar.high, bar.low, bar.close, bar.volume, bar.amount].every(Number.isFinite) &&
      bar.low > 0 && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close) &&
      bar.volume > 0 && bar.amount > 0);
}

export async function atomicJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value));
  await fs.rename(`${file}.tmp`, file);
}

export async function prepareIntradayHistory(tradeDate: string) {
  const dates = completeTradingWindow(tradeDate);
  const endDate = dates.at(-1)!;
  const catalog = await mainStockCatalog();
  const coverage = { tradeDate, startDate: dates[0], endDate, total: catalog.length, complete: 0, codes: [] as string[], fetched: 0, excluded: [] as string[], missing: [] as string[], adjustment: "forward", volumeUnit: "lots", ready: false };
  await atomicJson(`${historyRoot}/coverage.json`, coverage);
  const stamp = (date: string) => String(Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00+08:00`));
  for (const stock of catalog) {
    if (/ST|退/.test(stock.name) || (stock.list_date && stock.list_date.replaceAll("-", "") > dates[0])) {
      coverage.excluded.push(`${stock.ticker}:ST/退市标记或上市不足30个完整交易日`); continue;
    }
    if (!stock.list_date) { coverage.missing.push(`${stock.ticker}:上市日期缺失`); continue; }
    const file = `${historyRoot}/${stock.ticker}.json`;
    let stored: { endDate: string; adjustment: string; volumeUnit: string; bars: DailyBar[] } | null = null;
    try { stored = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* First collection. */ }
    if (stored?.endDate === endDate && stored.adjustment === "forward" && stored.volumeUnit === "lots" && validateHistory(stored.bars, dates)) { coverage.complete++; coverage.codes.push(stock.ticker); continue; }
    // Refresh the affected stock's entire window so different forward-adjustment anchors never mix.
    const data = await fuyao("/api/a-share/prices/historical", { thscode: `${stock.ticker}.${stock.ticker.startsWith("6") ? "SH" : "SZ"}`, interval: "1d", adjust: "forward", start: stamp(dates[0]), end: stamp(endDate) });
    const bars: DailyBar[] = data.item.map((row: Record<string, number>) => ({
      code: stock.ticker, name: stock.name, market: "main", tradeDate: currentShanghaiTradeDate(new Date(row.date_ms)),
      open: row.open_price, high: row.high_price, low: row.low_price, close: row.close_price,
      volume: row.volume / 100, amount: row.turnover, pctChange: 0, turnoverRate: 0, provider: "fuyao"
    })).filter((bar: DailyBar) => dates.includes(bar.tradeDate));
    coverage.fetched++;
    if (!validateHistory(bars, dates)) coverage.missing.push(`${stock.ticker}:日期/OHLC/成交量额不完整，未推定为停牌`);
    else {
      if (stored) await atomicJson(`${file}.bak`, stored);
      await atomicJson(file, { endDate, adjustment: "forward", volumeUnit: "lots", bars });
      coverage.complete++; coverage.codes.push(stock.ticker);
    }
    if (coverage.fetched % 20 === 0) { await atomicJson(`${historyRoot}/coverage.json`, coverage); console.log(JSON.stringify({ complete: coverage.complete, fetched: coverage.fetched, missing: coverage.missing.length })); }
  }
  coverage.ready = coverage.missing.length === 0;
  await atomicJson(`${historyRoot}/coverage.json`, coverage);
  console.log(JSON.stringify(coverage));
  if (!coverage.ready) throw new Error(`日线校验失败：${coverage.missing.length} 只主板股票仍有无法解释的缺口`);
}

export async function readPreparedHistory(tradeDate: string): Promise<DailyBar[]> {
  const coverage = JSON.parse(await fs.readFile(`${historyRoot}/coverage.json`, "utf8").catch(() => { throw new Error("未找到历史准备结果，请检查当天08:00的 GitHub 日线准备任务"); }));
  const dates = completeTradingWindow(tradeDate);
  if (!coverage.ready || coverage.tradeDate !== tradeDate || coverage.endDate !== dates.at(-1)) throw new Error("近30个完整交易日日线尚未补齐或已过期");
  const bars: DailyBar[] = [];
  for (const code of coverage.codes as string[]) {
    const file = `${code}.json`;
    const stored = JSON.parse(await fs.readFile(`${historyRoot}/${file}`, "utf8"));
    if (stored.endDate === coverage.endDate && stored.adjustment === "forward" && stored.volumeUnit === "lots" && validateHistory(stored.bars, dates)) bars.push(...stored.bars);
  }
  if (bars.length / 30 !== coverage.complete) throw new Error("历史文件与覆盖统计不一致");
  return bars;
}
