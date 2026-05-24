import fs from "node:fs/promises";
import path from "node:path";
import { createDefaultStrategy } from "../core/defaults.js";
import { buildCloseReportFromDataset } from "../core/reports.js";
import { rankSectors, rankStocks } from "../core/scoring.js";
import { fetchMarketDataset } from "../data/akshareClient.js";
import { writeReportArtifact } from "./reportArtifacts.js";

const outputRoot = path.resolve(process.cwd(), "dist-web", "data");
const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.split("=")[1];

const dataset = await fetchMarketDataset("post_close", tradeDate);
const dsl = createDefaultStrategy("short_term", ["main"]);
const recommendations = rankStocks(dataset, dsl, "post_close");
const sectors = rankSectors(dataset);
const limitUps = [...dataset.limitUps]
  .map((item) => ({
    ...item,
    strengthScore: Math.min(100, item.consecutive * 20 + (item.openCount === 0 ? 20 : 8) + Math.min(30, item.sealedAmount / 30_000_000))
  }))
  .sort((a, b) => b.consecutive - a.consecutive || b.strengthScore - a.strengthScore);

await fs.mkdir(path.join(outputRoot, "recommendations"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "limit-up"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "sectors"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "watchlist"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "stocks"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "reports"), { recursive: true });

await writeJson("manifest.json", {
  tradeDate: dataset.tradeDate,
  dataAsOf: dataset.dataAsOf,
  source: dataset.source,
  warnings: dataset.warnings,
  generatedAt: new Date().toISOString()
});

await writeJson("recommendations/latest.json", {
  id: `static-${dataset.tradeDate}`,
  tradeDate: dataset.tradeDate,
  mode: "post_close",
  source: dataset.source,
  warnings: dataset.warnings,
  prompt: "默认盘后短线强势策略",
  dataAsOf: dataset.dataAsOf,
  recommendations
});

await writeJson("limit-up/ladder.json", {
  tradeDate: dataset.tradeDate,
  source: dataset.source,
  warnings: dataset.warnings,
  items: limitUps
});

await writeJson("sectors/ladder.json", {
  tradeDate: dataset.tradeDate,
  source: dataset.source,
  warnings: dataset.warnings,
  items: sectors
});

await writeJson("watchlist/triggers.json", {
  tradeDate: dataset.tradeDate,
  source: dataset.source,
  warnings: [],
  triggers: []
});

await writeReportArtifact(outputRoot, await buildCloseReportFromDataset(dataset));

for (const stock of dataset.stocks) {
  const stockLimitUps = dataset.limitUps.filter((item) => item.code === stock.code);
  const stockDragonTiger = dataset.dragonTiger.filter((item) => item.code === stock.code);
  const relatedSectors = sectors.filter((sector) => sector.name === stock.industry || stock.concepts.includes(sector.name));
  await writeJson(`stocks/${stock.code}.json`, {
    stock,
    score: recommendations.find((item) => item.code === stock.code),
    limitUps: stockLimitUps,
    dragonTiger: stockDragonTiger,
    relatedSectors,
    dataAsOf: dataset.dataAsOf,
    source: dataset.source,
    warnings: dataset.warnings
  });
}

console.log(
  JSON.stringify(
    {
      tradeDate: dataset.tradeDate,
      source: dataset.source,
      warnings: dataset.warnings,
      stocks: dataset.stocks.length,
      limitUps: limitUps.length,
      sectors: sectors.length,
      recommendations: recommendations.length
    },
    null,
    2
  )
);

async function writeJson(relativePath: string, value: unknown) {
  await fs.writeFile(path.join(outputRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
