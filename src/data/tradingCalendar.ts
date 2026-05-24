const A_SHARE_HOLIDAYS = new Set([
  // SSE 2026 holiday calendar, announcement 2025-12-22.
  "20260101",
  "20260102",
  "20260103",
  "20260215",
  "20260216",
  "20260217",
  "20260218",
  "20260219",
  "20260220",
  "20260221",
  "20260222",
  "20260223",
  "20260404",
  "20260405",
  "20260406",
  "20260501",
  "20260502",
  "20260503",
  "20260504",
  "20260505",
  "20260619",
  "20260620",
  "20260621",
  "20260925",
  "20260926",
  "20260927",
  "20261001",
  "20261002",
  "20261003",
  "20261004",
  "20261005",
  "20261006",
  "20261007"
]);

export interface TradingDayDecision {
  tradeDate: string;
  isTradingDay: boolean;
  reason?: string;
}

export function currentShanghaiTradeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
}

export function normalizeTradeDate(value?: string): string {
  if (!value) return currentShanghaiTradeDate();
  const digits = value.replaceAll("-", "").trim();
  if (!/^\d{8}$/.test(digits)) throw new Error(`invalid trade date: ${value}`);
  return digits;
}

export function isAshareTradingDay(tradeDate: string, extraHolidays = process.env.A_SHARE_EXTRA_HOLIDAYS): boolean {
  const normalized = normalizeTradeDate(tradeDate);
  if (isWeekend(normalized)) return false;
  if (A_SHARE_HOLIDAYS.has(normalized)) return false;
  if (parseExtraHolidays(extraHolidays).has(normalized)) return false;
  return true;
}

export function tradingDayDecision(tradeDate?: string, now = new Date()): TradingDayDecision {
  const normalized = tradeDate ? normalizeTradeDate(tradeDate) : currentShanghaiTradeDate(now);
  if (isWeekend(normalized)) {
    return { tradeDate: normalized, isTradingDay: false, reason: "A股周末休市" };
  }
  if (A_SHARE_HOLIDAYS.has(normalized) || parseExtraHolidays(process.env.A_SHARE_EXTRA_HOLIDAYS).has(normalized)) {
    return { tradeDate: normalized, isTradingDay: false, reason: "A股节假日休市" };
  }
  return { tradeDate: normalized, isTradingDay: true };
}

function isWeekend(tradeDate: string): boolean {
  const year = Number(tradeDate.slice(0, 4));
  const month = Number(tradeDate.slice(4, 6));
  const day = Number(tradeDate.slice(6, 8));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function parseExtraHolidays(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().replaceAll("-", ""))
      .filter((item) => /^\d{8}$/.test(item))
  );
}
