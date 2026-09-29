import { setTimeout as delay } from "node:timers/promises";
import { fetchUsMarketBrief } from "./akshareClient.js";
import type { MorningQuote, UsMarketBrief } from "../shared/types.js";

// Daily bars from the report date are unfinished at 09:00 and must not enter a morning report.
export function completedMorningQuotes(rows: MorningQuote[], tradeDate: string): MorningQuote[] {
  const end = new Date(`${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}T00:00:00+08:00`).getTime();
  return rows.filter((row) => {
    const stamp = Date.parse(`${row.date}T00:00:00+08:00`);
    return stamp < end && end - stamp <= 7 * 86400000 &&
      Number.isFinite(row.close ?? row.price) && (row.close ?? row.price ?? 0) > 0 && Number.isFinite(row.pctChange);
  });
}

export async function fetchMorningMarket(tradeDate: string) {
  const warnings: string[] = [];
  const brief: UsMarketBrief = { asOf: new Date().toISOString(), previousSession: "", indices: [], futures: [], sectors: [], currencies: [], commodities: [], domesticFutures: [] };
  try {
    const overseas = await fetchUsMarketBrief();
    for (const group of ["indices", "futures", "sectors", "currencies", "commodities"] as const) {
      brief[group] = completedMorningQuotes(overseas.brief[group], tradeDate);
    }
    warnings.push(...overseas.warnings);
    for (const [group, expected] of [["indices", 4], ["futures", 5], ["sectors", 6], ["currencies", 2], ["commodities", 2]] as const) {
      if (brief[group].length && brief[group].length < expected) warnings.push(`外盘 ${group} 仅获取 ${brief[group].length}/${expected} 项，其余缺失或日期无效。`);
    }
  } catch {
    warnings.push("外盘数据源 yfinance 请求失败或限流，美股、国际期货和汇率留空，未使用国内行情替代。");
  }
  for (const [group, label] of [["indices", "美股指数"], ["futures", "国际期货"], ["sectors", "美股板块"], ["currencies", "汇率"], ["commodities", "国际商品"]] as const) {
    if (!brief[group].length) warnings.push(`${label}暂无有效的近期已完成日线数据。`);
  }
  const key = process.env.FUYAO_API_KEY?.trim();
  if (key) {
    for (const [symbol, name] of [["SC00.INE", "国内原油连续"], ["850002.TI", "期货通商品指数"]]) {
      try {
        const response = await fetch(`https://fuyao.aicubes.cn/api/futures/prices/daily?thscode=${symbol}&time_period=day_1`, {
          headers: { "X-api-key": key }, signal: AbortSignal.timeout(20_000)
        });
        if (response.status === 429) { warnings.push("Fuyao 限流，本次停止后续请求。"); break; }
        const result = await response.json();
        if (result.code === 4001) { warnings.push("Fuyao 限流，本次停止后续请求。"); break; }
        if (!response.ok || result.code !== 0 || !Array.isArray(result.data?.item)) throw new Error("invalid response");
        const bars = result.data.item.map((bar: { timestamp: number; close_price: number }) => ({
          date: new Date(bar.timestamp + 8 * 3600000).toISOString().slice(0, 10),
          price: bar.close_price, symbol, name, pctChange: 0, source: "fuyao"
        }));
        const completed = [...new Map(completedMorningQuotes(bars, tradeDate).map((row) => [row.date, row])).values()].sort((a, b) => a.date!.localeCompare(b.date!));
        const last = completed.at(-1), previous = completed.at(-2);
        if (!last || !previous) throw new Error("insufficient history");
        brief.domesticFutures!.push({ ...last, pctChange: (last.price! / previous.price! - 1) * 100 });
      } catch { warnings.push(`${name}行情不可用或日期过旧，已留空。`); }
      await delay(2100);
    }
  } else warnings.push("未配置 FUYAO_API_KEY，国内期货留空。");
  const quotes = [...brief.indices, ...brief.futures, ...brief.sectors, ...brief.currencies, ...brief.commodities, ...brief.domesticFutures!];
  if (!quotes.length) throw new Error("晨报所有行情源均不可用，未生成空报告；请重试。");
  brief.previousSession = quotes.map((row) => row.date!).sort().at(-1)!;
  return { brief, warnings, provider: [...new Set(quotes.map((row) => row.source))].join(" + ") };
}
