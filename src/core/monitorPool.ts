import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DailyBar, Market, MarketDataset, MonitorPoolEvaluation, MonitorPoolItem, MonitorPoolSnapshot, StockSnapshot } from "../shared/types.js";

const monitorPoolItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  market: z.enum(["main", "gem", "star", "bse"]),
  thesis: z.string().optional(),
  isActive: z.boolean().default(true),
  addedAt: z.string(),
  updatedAt: z.string().optional()
});

const monitorPoolSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  items: z.array(monitorPoolItemSchema)
});

export const monitorPoolPath = path.join("data", "watchlist", "monitor-pool.json");

export async function readMonitorPool(root = process.cwd()): Promise<MonitorPoolSnapshot> {
  try {
    const text = await fs.readFile(path.resolve(root, monitorPoolPath), "utf8");
    const parsed = monitorPoolSchema.parse(JSON.parse(text));
    return {
      ...parsed,
      items: parsed.items.map(normalizeMonitorItem)
    };
  } catch {
    return emptyMonitorPool();
  }
}

export async function writeMonitorPool(pool: MonitorPoolSnapshot, root = process.cwd()): Promise<void> {
  const normalized = monitorPoolSchema.parse({
    ...pool,
    items: pool.items.map(normalizeMonitorItem)
  });
  const filePath = path.resolve(root, monitorPoolPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function upsertMonitorPoolItem(input: { code: string; name?: string; market?: Market; thesis?: string }, root = process.cwd()): Promise<MonitorPoolItem> {
  const pool = await readMonitorPool(root);
  const now = new Date().toISOString();
  const code = normalizeCode(input.code);
  const existingIndex = pool.items.findIndex((item) => item.code === code);
  const existing = existingIndex >= 0 ? pool.items[existingIndex] : undefined;
  const item: MonitorPoolItem = normalizeMonitorItem({
    code,
    name: input.name?.trim() || existing?.name || code,
    market: input.market ?? existing?.market ?? marketFromCode(code),
    thesis: input.thesis?.trim() || existing?.thesis,
    isActive: true,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now
  });

  if (existingIndex >= 0) pool.items[existingIndex] = item;
  else pool.items.push(item);
  await writeMonitorPool({ ...pool, updatedAt: now }, root);
  return item;
}

export async function setMonitorPoolItemActive(codeInput: string, isActive: boolean, root = process.cwd()): Promise<MonitorPoolItem | null> {
  const pool = await readMonitorPool(root);
  const code = normalizeCode(codeInput);
  const index = pool.items.findIndex((item) => item.code === code);
  if (index < 0) return null;
  const item = normalizeMonitorItem({ ...pool.items[index], isActive, updatedAt: new Date().toISOString() });
  pool.items[index] = item;
  await writeMonitorPool({ ...pool, updatedAt: item.updatedAt ?? new Date().toISOString() }, root);
  return item;
}

export function evaluateMonitorPool(pool: MonitorPoolSnapshot, dataset: MarketDataset, dailyBars: DailyBar[]): MonitorPoolEvaluation[] {
  const dailyBarsByCode = groupDailyBars(dailyBars);
  const stocksByCode = new Map(dataset.stocks.map((stock) => [stock.code, stock]));
  return pool.items
    .filter((item) => item.isActive)
    .map((item) => evaluateMonitorItem(item, stocksByCode.get(item.code), dataset, dailyBarsByCode.get(item.code) ?? []));
}

function evaluateMonitorItem(item: MonitorPoolItem, stock: StockSnapshot | undefined, dataset: MarketDataset, dailyBars: DailyBar[]): MonitorPoolEvaluation {
  const base = {
    code: item.code,
    name: stock?.name || item.name,
    market: item.market,
    thesis: item.thesis,
    dataAsOf: dataset.dataAsOf,
    sectors: uniqueStrings([stock?.industry, ...(stock?.concepts ?? [])]).slice(0, 5)
  };

  if (!stock) {
    return {
      ...base,
      trend: { status: "unknown", reason: "当前行情数据集中未找到该股票" },
      ma: { pullbackToMa5: "unknown", reason: "缺少当前行情，无法判断5日线位置" },
      volume: { reason: "缺少当前行情，无法判断量能" },
      reasons: [],
      risks: ["当前行情数据集中未找到该股票"]
    };
  }

  const prepared = prepareBarsForEvaluation(stock, dailyBars, dataset.tradeDate);
  if (!prepared) {
    return {
      ...base,
      price: stock.close,
      pctChange: stock.pctChange,
      trend: { status: "unknown", reason: "缺少足够日线缓存，无法判断上升趋势" },
      ma: { pullbackToMa5: "unknown", reason: "缺少足够日线缓存，无法判断5日线" },
      volume: { reason: stock.volumeRatio ? `实时量比 ${round(stock.volumeRatio)}` : "缺少昨日成交量，无法计算量比昨" },
      reasons: [`当前价 ${round(stock.close)}，涨幅 ${formatSignedPct(stock.pctChange)}`],
      risks: ["缺少足够日线缓存"]
    };
  }

  const { bars, current } = prepared;
  const previous = bars.at(-2);
  const ma5 = movingAverage(bars, 5);
  const ma10 = movingAverage(bars, 10);
  const ma20 = movingAverage(bars, 20);
  const ma5DistancePct = ma5 > 0 ? ((current.close - ma5) / ma5) * 100 : undefined;
  const ma10DistancePct = ma10 > 0 ? ((current.close - ma10) / ma10) * 100 : undefined;
  const trend = evaluateTrend(current, ma5, ma10, ma20, bars);
  const ma = evaluateMaPullback(current, ma5, ma10, ma20, ma5DistancePct, ma10DistancePct);
  const volume = evaluateVolume(current, previous, stock);
  const reasons = [
    `当前价 ${round(current.close)}，涨幅 ${formatSignedPct(stock.pctChange)}`,
    trend.reason,
    ma.reason,
    volume.reason
  ];
  const risks = [
    trend.status === "weak" ? "上升趋势尚未形成或已经转弱" : "",
    ma.pullbackToMa5 === "below" ? "已跌破5日线" : "",
    ma.pullbackToMa5 === "extended" ? "距离5日线偏远，尚未完成回踩" : "",
    ma10DistancePct !== undefined && ma10DistancePct < 0 ? "跌破10日线" : ""
  ].filter(Boolean);

  return {
    ...base,
    price: round(current.close),
    pctChange: round(stock.pctChange),
    trend,
    ma,
    volume,
    reasons,
    risks
  };
}

function evaluateTrend(current: DailyBar, ma5: number, ma10: number, ma20: number, bars: DailyBar[]): MonitorPoolEvaluation["trend"] {
  const recent = bars.slice(-4);
  const risingCloses = recent.length >= 4 && recent.at(-1)!.close > recent[0].close;
  const ma5Rising = bars.length >= 6 && movingAverage(bars.slice(0, -1), 5) > 0 && ma5 > movingAverage(bars.slice(0, -1), 5);
  if (ma5 > 0 && ma10 > 0 && ma20 > 0 && current.close >= ma5 && ma5 >= ma10 && ma10 >= ma20 && risingCloses) {
    return { status: "uptrend", reason: `已进入上升趋势：价在MA5上方，MA5 ${round(ma5)} >= MA10 ${round(ma10)} >= MA20 ${round(ma20)}` };
  }
  if (ma5 > 0 && ma10 > 0 && current.close >= ma10 && ma5 >= ma10 && ma5Rising) {
    return { status: "forming", reason: `上升趋势形成中：价在MA10上方，MA5 ${round(ma5)} 已站上MA10 ${round(ma10)}` };
  }
  if (ma10 > 0 && current.close < ma10) {
    return { status: "weak", reason: `趋势偏弱：当前价 ${round(current.close)} 低于MA10 ${round(ma10)}` };
  }
  return { status: "unknown", reason: "趋势信号不充分，暂未确认进入上升趋势" };
}

function evaluateMaPullback(current: DailyBar, ma5: number, ma10: number, ma20: number, ma5DistancePct?: number, ma10DistancePct?: number): MonitorPoolEvaluation["ma"] {
  const common = {
    ma5: ma5 > 0 ? round(ma5) : undefined,
    ma10: ma10 > 0 ? round(ma10) : undefined,
    ma20: ma20 > 0 ? round(ma20) : undefined,
    ma5DistancePct: ma5DistancePct === undefined ? undefined : round(ma5DistancePct),
    ma10DistancePct: ma10DistancePct === undefined ? undefined : round(ma10DistancePct)
  };
  if (ma5 <= 0 || ma5DistancePct === undefined) {
    return { ...common, pullbackToMa5: "unknown", reason: "缺少MA5，无法判断是否回踩5日线" };
  }
  if (current.close < ma5) {
    return { ...common, pullbackToMa5: "below", reason: `已跌破5日线：收盘/最新价 ${round(current.close)}，MA5 ${round(ma5)}` };
  }
  if (current.low <= ma5 && current.close >= ma5) {
    return { ...common, pullbackToMa5: "held", reason: `已回踩并守住5日线：最低 ${round(current.low)}，MA5 ${round(ma5)}` };
  }
  if (ma5DistancePct <= 2) {
    return { ...common, pullbackToMa5: "near", reason: `接近5日线：距离MA5 ${round(ma5DistancePct)}%` };
  }
  return { ...common, pullbackToMa5: "extended", reason: `尚未回踩5日线：距离MA5 ${round(ma5DistancePct)}%` };
}

function evaluateVolume(current: DailyBar, previous: DailyBar | undefined, stock: StockSnapshot): MonitorPoolEvaluation["volume"] {
  if (previous?.volume) {
    const ratio = current.volume / previous.volume;
    return { ratioVsPrevious: round(ratio), reason: `今日成交量为昨日 ${Math.round(ratio * 100)}%` };
  }
  if (stock.volumeRatio) return { ratioVsPrevious: round(stock.volumeRatio), reason: `实时量比 ${round(stock.volumeRatio)}` };
  return { reason: "缺少昨日成交量，无法判断量能" };
}

function prepareBarsForEvaluation(stock: StockSnapshot, dailyBars: DailyBar[], tradeDate: string): { bars: DailyBar[]; current: DailyBar } | null {
  const bars = dailyBars.filter((bar) => bar.code === stock.code).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const currentFromBars = bars.find((bar) => bar.tradeDate === tradeDate);
  if (currentFromBars) {
    const current = hydrateCurrentBar(currentFromBars, stock);
    return { bars: bars.map((bar) => (bar.tradeDate === current.tradeDate ? current : bar)), current };
  }
  const previous = bars.at(-1);
  if (!previous || !stock.close) return null;
  const current = stockSnapshotToDailyBar(stock, tradeDate, previous);
  return { bars: [...bars, current].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)), current };
}

function hydrateCurrentBar(bar: DailyBar, stock: StockSnapshot): DailyBar {
  return {
    ...bar,
    open: bar.open || stock.open || bar.close,
    high: bar.high || stock.high || bar.close,
    low: bar.low || stock.low || bar.close,
    close: stock.close || bar.close,
    volume: stock.volume || bar.volume || 0,
    amount: stock.turnoverAmount || bar.amount || 0,
    pctChange: stock.pctChange || bar.pctChange || 0
  };
}

function stockSnapshotToDailyBar(stock: StockSnapshot, tradeDate: string, previous: DailyBar): DailyBar {
  const close = stock.close || previous.close;
  const open = stock.open || close;
  return {
    tradeDate,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    open,
    high: stock.high || Math.max(open, close),
    low: stock.low || Math.min(open, close),
    close,
    volume: stock.volume || 0,
    amount: stock.turnoverAmount || 0,
    pctChange: stock.pctChange || (previous.close > 0 ? ((close - previous.close) / previous.close) * 100 : 0),
    turnoverRate: stock.turnoverRate || 0,
    provider: "intraday-snapshot"
  };
}

function groupDailyBars(bars: DailyBar[]): Map<string, DailyBar[]> {
  const grouped = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const code = normalizeCode(bar.code);
    const items = grouped.get(code) ?? [];
    items.push({ ...bar, code });
    grouped.set(code, items);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
  return grouped;
}

function emptyMonitorPool(): MonitorPoolSnapshot {
  return { version: 1, updatedAt: new Date(0).toISOString(), items: [] };
}

function normalizeMonitorItem(item: MonitorPoolItem): MonitorPoolItem {
  const code = normalizeCode(item.code);
  return {
    ...item,
    code,
    name: item.name.trim() || code,
    market: item.market ?? marketFromCode(code),
    thesis: item.thesis?.trim() || undefined,
    isActive: item.isActive ?? true
  };
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/^(SH|SZ|BJ)/, "").replace(/\.(SH|SZ|BJ)$/, "");
}

function marketFromCode(code: string): Market {
  if (/^(300|301)/.test(code)) return "gem";
  if (/^(688|689)/.test(code)) return "star";
  if (/^(8|4)/.test(code)) return "bse";
  return "main";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}

function movingAverage(bars: DailyBar[], days: number): number {
  const values = bars.slice(-days).map((bar) => bar.close).filter((value) => value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value)}%`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
