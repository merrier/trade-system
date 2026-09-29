import { fuyao, mainStockCatalog, completeTradingWindow } from "./intradayPreparation.js";
import { currentShanghaiTradeDate } from "./tradingCalendar.js";
import type { DailyBar, MarketDataset, StockSnapshot } from "../shared/types.js";

export function samplingMinutes(now: Date, tradeDate: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  const minutes = parts[0] * 60 + parts[1];
  if (currentShanghaiTradeDate(now) !== tradeDate || minutes < 890 || minutes >= 900) throw new Error("未在当日14:50至15:00采样窗口内，未使用盘后数据补造选股报告");
  return minutes - 570 - 90;
}

export function measuredVolumeRatio(volume: number, bars: DailyBar[], minutes: number): number {
  const average = bars.slice(-5).reduce((sum, bar) => sum + bar.volume, 0) / 5;
  if (bars.length < 5 || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(average) || average <= 0) throw new Error("计算量比所需成交量缺失");
  return volume / (average * minutes / 240);
}

export async function strictIntradaySnapshot(tradeDate: string, bars: DailyBar[]): Promise<MarketDataset> {
  samplingMinutes(new Date(), tradeDate);
  const catalog = await mainStockCatalog();
  const histories = new Map<string, DailyBar[]>();
  for (const bar of bars) histories.set(bar.code, [...(histories.get(bar.code) ?? []), bar]);
  for (const history of histories.values()) history.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const quotes = new Map<string, Record<string, number | string>>();
  let earliest = Date.now();
  for (let offset = 0; offset < 100000; offset += 10000) {
    const page = await fuyao("/api/a-share/prices/snapshot", { limit: "10000", offset: String(offset) });
    samplingMinutes(new Date(page.timestamp), tradeDate);
    if (Math.abs(Date.now() - page.timestamp) > 120_000) throw new Error("实时行情时间戳超过2分钟，停止选股");
    earliest = Math.min(earliest, page.timestamp);
    for (const item of page.item) quotes.set(item.ticker, item);
    if (offset + page.item.length >= page.total) break;
    if (!page.item.length || offset >= 90000) throw new Error("行情分页不完整");
  }
  const stocks: StockSnapshot[] = [];
  for (const stock of catalog) {
    if (/ST|退/.test(stock.name)) continue;
    const row = quotes.get(stock.ticker);
    if (!row) throw new Error(`${stock.ticker} 缺少实时行情`);
    const close = Number(row.last_price), open = Number(row.open_price), high = Number(row.high_price), low = Number(row.low_price);
    const volume = Number(row.volume) / 100, amount = Number(row.turnover), previous = Number(row.prev_price);
    if (volume === 0 && amount === 0) continue;
    if (![close, open, high, low, volume, amount, previous].every(Number.isFinite) || low <= 0 || volume <= 0 || amount <= 0 || previous <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) throw new Error(`${stock.ticker} 实时OHLC或成交量额无效`);
    const listedDays = Math.floor((Date.now() - Date.parse(stock.list_date ?? "")) / 86400000);
    if (!Number.isFinite(listedDays)) throw new Error(`${stock.ticker} 上市日期缺失`);
    if (listedDays < 20 || close <= 5 || stock.list_date!.replaceAll("-", "") > completeTradingWindow(tradeDate)[0]) continue;
    const history = histories.get(stock.ticker);
    if (!history) throw new Error(`${stock.ticker} 缺少完整历史窗口`);
    if (Math.abs(history.at(-1)!.close - previous) > Math.max(0.02, previous * 0.005)) throw new Error(`${stock.ticker} 历史前复权价格与实时昨收不一致`);
    stocks.push({ code: stock.ticker, name: stock.name, market: "main", concepts: [], close, open, high, low, volume,
      pctChange: (close / previous - 1) * 100, turnoverAmount: amount, turnoverRate: 0,
      volumeRatio: measuredVolumeRatio(volume, history, samplingMinutes(new Date(earliest), tradeDate)), listedDays, isST: false, isSuspended: false });
  }
  if (!stocks.length) throw new Error("有效主板行情为空");
  return { tradeDate, dataAsOf: new Date(earliest).toISOString(), source: "fuyao", stocks, limitUps: [], dragonTiger: [], sectors: [],
    warnings: ["量比由实际累计成交量÷近5日平均成交量÷当日已交易分钟占比计算；行业资金与龙虎榜数据未参与排序。"] };
}
