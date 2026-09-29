import "dotenv/config";
import fs from "node:fs/promises";
import { readMonitorPool } from "../core/monitorPool.js";
import { fetchStockHistory } from "../data/stockHistory.js";

const pool = await readMonitorPool();
const codes = [...new Set([...pool.items.filter((item) => item.isActive).map((item) => item.code), "600519"])];
await fs.mkdir("data/history", { recursive: true });
// Reuse the provider's serial queue and two-second interval.
for (const code of codes) {
  const history = await fetchStockHistory(code);
  if (!history.bars.length) throw new Error(`${code}: empty history; publication stopped`);
  await fs.writeFile(`data/history/${code}.json`, JSON.stringify(history));
  console.log(`${code}: ${history.bars.length} bars, through ${history.asOf}`);
}
