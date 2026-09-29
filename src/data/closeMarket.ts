import { fuyao, aShareCatalog } from "./intradayPreparation.js";
import { currentShanghaiTradeDate } from "./tradingCalendar.js";
import type { MarketDataset, StockSnapshot } from "../shared/types.js";

export function validateCloseTimestamp(timestamp: number, tradeDate: string) {
  if (!Number.isFinite(timestamp)) throw new Error("收盘行情缺少数据时间");
  const date = new Date(timestamp);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
  if (!Number.isFinite(timestamp) || currentShanghaiTradeDate(date) !== tradeDate || hour < 15 || timestamp > Date.now() + 60000) throw new Error("未获取到指定交易日的收盘行情，未使用旧数据替代");
}

export async function fetchCloseMarket(tradeDate: string): Promise<MarketDataset> {
  const allCodes = await aShareCatalog();
  const undated = allCodes.filter(stock => !stock.list_date);
  const catalog = allCodes.filter(stock => stock.list_date && stock.list_date.replaceAll("-", "") <= tradeDate);
  const names = new Map(catalog.map(stock => [stock.ticker, stock.name]));
  const stocks: StockSnapshot[] = [];
  const seen = new Set<string>();
  let timestamp = Infinity;
  let suspended = 0;
  for (let offset = 0; offset < 100000; offset += 10000) {
    const page = await fuyao("/api/a-share/prices/snapshot", { limit: "10000", offset: String(offset) });
    validateCloseTimestamp(page.timestamp, tradeDate);
    timestamp = Math.min(timestamp, page.timestamp);
    for (const row of page.item) {
      if (!names.has(row.ticker)) continue;
      if (seen.has(row.ticker)) throw new Error("A股行情代码重复");
      seen.add(row.ticker);
      if (row.volume === 0 && row.turnover === 0) { suspended++; continue; }
      if (![row.last_price, row.prev_price, row.turnover, row.volume].every(Number.isFinite) || row.last_price <= 0 || row.prev_price <= 0 || row.turnover <= 0 || row.volume <= 0) throw new Error(`${row.ticker} 收盘价格或成交额无效`);
      stocks.push({ code: row.ticker, name: names.get(row.ticker)!, market: catalog.find(stock => stock.ticker === row.ticker)?.exchange === "BJ" ? "bse" : row.ticker.startsWith("30") ? "gem" : row.ticker.startsWith("68") ? "star" : "main", concepts: [], close: row.last_price,
        pctChange: (row.last_price / row.prev_price - 1) * 100, turnoverAmount: row.turnover,
        volume: row.volume / 100, turnoverRate: 0, volumeRatio: 0 });
    }
    if (offset + page.item.length >= page.total) break;
    if (!page.item.length || offset >= 90000) throw new Error("收盘行情分页不完整");
  }
  if (seen.size !== names.size || !stocks.length) throw new Error(`A股行情覆盖不完整：${seen.size}/${names.size}`);
  const warnings = [`统计范围：全A股 ${names.size} 只，其中 ${stocks.length} 只当日有成交、${suspended} 只无成交；包含沪深主板、创业板、科创板和北交所（含ST），不含尚未上市股票。`];
  if (undated.length) warnings.push(`另有 ${undated.length} 个代码缺少上市日期，未纳入统计：${undated.map(stock => stock.ticker).join("、")}。`);
  const date_ms = String(Date.parse(`${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}T00:00:00+08:00`));
  async function poolCount(kind: "up" | "down"): Promise<number | null> {
    try {
      const codes = new Set<string>();
      for (let page = 1; page <= 100; page++) {
        const data = await fuyao(`/api/a-share/special-data/limit-${kind}-pool`, { date_ms, page: String(page), size: "200" });
        validateCloseTimestamp(data.timestamp, tradeDate);
        for (const row of data.item) if (names.has(row.ticker)) codes.add(row.ticker);
        if (page >= data.pagination.pages) return codes.size;
      }
      throw new Error("分页异常");
    } catch {
      warnings.push(`${kind === "up" ? "涨停" : "跌停"}池暂不可用，对应家数留空。`);
      return null;
    }
  }
  const limitUp = await poolCount("up");
  const limitDown = await poolCount("down");
  const industries: Array<{ name: string; pctChange: number }> = [];
  try {
    const list = await fuyao("/api/a-share-index/catalog/ths-index-list", { tag: "industry" });
    const indexNames = new Map<string, string>(list.item.map((row: { thscode: string; name: string }) => [row.thscode, row.name]));
    const codes = [...indexNames.keys()];
    for (let start = 0; start < codes.length; start += 50) {
      const page = await fuyao("/api/a-share-index/prices/snapshot", { thscodes: codes.slice(start, start + 50).join(",") });
      validateCloseTimestamp(page.timestamp, tradeDate);
      for (const row of page.item) {
        if (!indexNames.has(row.thscode) || !Number.isFinite(row.price_change_ratio_pct)) throw new Error("行业指数行情不完整");
        industries.push({ name: indexNames.get(row.thscode)!, pctChange: row.price_change_ratio_pct });
      }
    }
    if (!codes.length || industries.length !== codes.length) throw new Error("行业指数覆盖不完整");
    industries.sort((a, b) => b.pctChange - a.pctChange);
  } catch {
    industries.length = 0;
    warnings.push("行业指数行情暂不可用，行业排行留空。");
  }
  warnings.push("行业排行按同花顺行业指数涨跌幅排序；资金流、综合热度和开板次数未获取，不使用涨停池代算。行业指数按其实际成分范围统计。");
  return { tradeDate, dataAsOf: new Date(timestamp).toISOString(), source: "fuyao", warnings, stocks,
    limitUps: [], dragonTiger: [], sectors: [], closeSummary: { limitUp, limitDown, industries } };
}
