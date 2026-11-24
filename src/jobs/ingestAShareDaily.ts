import "dotenv/config";
import { execFileSync } from "node:child_process";
import { completeTradingWindow } from "../data/intradayPreparation.js";
import { tradingDayDecision } from "../data/tradingCalendar.js";

const now = new Date();
const decision = tradingDayDecision(undefined, now);
if (!decision.isTradingDay) {
  console.log(JSON.stringify({ skipped: true, ...decision }));
} else {
  // Before close, today's candle is incomplete. Allow a settlement buffer at close.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(now));
  const dates = completeTradingWindow(decision.tradeDate);
  if (hour >= 16) { dates.shift(); dates.push(decision.tradeDate); }
  execFileSync(process.env.PYTHON_BIN ?? "python3", ["python/a_share_daily.py", "--dates", dates.join(","), "--run-date", decision.tradeDate], { stdio: "inherit" });
}
