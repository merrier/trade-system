export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 手
}

export interface StockHistory {
  code: string;
  source: "fuyao";
  adjustment: "forward";
  asOf: string | null;
  bars: Candle[];
}

export const MA_PERIODS = [5, 10, 20, 60] as const;
export type CandlePeriod = "day" | "week";

export function chartCandles(daily: Candle[], period: CandlePeriod) {
  const sorted = [...new Map(daily.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const weeks = new Map<string, Candle>();
  if (period === "week") {
    for (const bar of sorted) {
      const monday = new Date(`${bar.date}T00:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      const key = monday.toISOString().slice(0, 10);
      const previous = weeks.get(key);
      weeks.set(key, previous ? {
        date: bar.date,
        open: previous.open,
        high: Math.max(previous.high, bar.high),
        low: Math.min(previous.low, bar.low),
        close: bar.close,
        volume: previous.volume + bar.volume
      } : { ...bar });
    }
  }
  const bars = period === "week" ? [...weeks.values()] : sorted;
  return bars.map((bar, index) => ({
    ...bar,
    ma: MA_PERIODS.map((window) => index + 1 < window ? null :
      bars.slice(index + 1 - window, index + 1).reduce((sum, item) => sum + item.close, 0) / window)
  }));
}

export function classifyTrend(daily: Candle[]): { label: string; date: string | null } {
  const bars = chartCandles(daily, "day");
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const date = latest?.date ?? null;
  if (!latest || !previous || bars.length < 20 || !daily.every((bar) => Number.isFinite(bar.close) && bar.close > 0)) return { label: "数据不足", date };
  const [ma5, ma10, ma20] = latest.ma;
  const prev5 = previous.ma[0];
  if (ma5 === null || ma10 === null || ma20 === null || prev5 === null) return { label: "数据不足", date };
  return { label: ma5 > ma10 && ma10 > ma20 && ma5 > prev5 ? "多头趋势" : "非多头", date };
}
