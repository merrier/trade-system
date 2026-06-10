import fs from "node:fs/promises";
import path from "node:path";
import type { MarketDataset, SectorSnapshot, StockSnapshot } from "../shared/types.js";

export interface SectorMapRecord {
  code: string;
  name: string;
  industry?: string;
  concepts: string[];
}

export async function readSectorMap(root = process.cwd()): Promise<Map<string, SectorMapRecord>> {
  try {
    const body = await fs.readFile(path.join(root, "data", "sector-map", "latest.json"), "utf8");
    const parsed = JSON.parse(body) as { records?: Array<Record<string, unknown>> };
    const records = new Map<string, SectorMapRecord>();
    for (const item of parsed.records ?? []) {
      const code = normalizeCode(text(item.code));
      if (!code) continue;
      records.set(code, {
        code,
        name: text(item.name),
        industry: text(item.industry) || undefined,
        concepts: arrayText(item.concepts)
      });
    }
    return records;
  } catch {
    return new Map();
  }
}

export function enrichDatasetWithSectorMap(dataset: MarketDataset, sectorMap: Map<string, SectorMapRecord>): MarketDataset {
  if (!sectorMap.size) return dataset;
  let enrichedCount = 0;
  const stocks = dataset.stocks.map((stock) => {
    const mapped = sectorMap.get(stock.code);
    if (!mapped) return stock;
    const industry = stock.industry || mapped.industry;
    const concepts = uniqueStrings([...(stock.concepts ?? []), ...mapped.concepts]);
    if (industry !== stock.industry || concepts.length !== stock.concepts.length) enrichedCount += 1;
    return { ...stock, industry, concepts };
  });

  if (!enrichedCount) return dataset;
  const sectors = shouldRebuildSectors(dataset.sectors) ? deriveSectors(dataset.tradeDate, stocks) : dataset.sectors;
  return {
    ...dataset,
    stocks,
    sectors,
    warnings: [...dataset.warnings, `已用离线板块映射补齐 ${enrichedCount} 只股票的行业/概念。`]
  };
}

function shouldRebuildSectors(sectors: SectorSnapshot[]): boolean {
  if (sectors.length === 0) return true;
  if (sectors.length === 1 && ["未分类", ""].includes(sectors[0]?.name ?? "")) return true;
  return false;
}

function deriveSectors(tradeDate: string, stocks: StockSnapshot[]): SectorSnapshot[] {
  const industryGroups = new Map<string, StockSnapshot[]>();
  const conceptGroups = new Map<string, StockSnapshot[]>();
  for (const stock of stocks) {
    if (stock.industry) pushGroup(industryGroups, stock.industry, stock);
    for (const concept of stock.concepts ?? []) pushGroup(conceptGroups, concept, stock);
  }
  return [
    ...groupsToSectors(tradeDate, "industry", industryGroups),
    ...groupsToSectors(tradeDate, "concept", conceptGroups)
  ];
}

function groupsToSectors(tradeDate: string, type: "industry" | "concept", groups: Map<string, StockSnapshot[]>): SectorSnapshot[] {
  return [...groups.entries()]
    .filter(([, stocks]) => stocks.length >= (type === "industry" ? 3 : 2))
    .map(([name, stocks]) => {
      const leader = [...stocks].sort((a, b) => b.pctChange - a.pctChange || b.turnoverAmount - a.turnoverAmount)[0];
      return {
        tradeDate,
        name,
        type,
        pctChange: avg(stocks.map((stock) => stock.pctChange)),
        inflowAmount: 0,
        outflowAmount: 0,
        netInflow: stocks.reduce((sum, stock) => sum + stock.turnoverAmount, 0),
        companyCount: stocks.length,
        limitUpCount: stocks.filter((stock) => stock.pctChange >= 9.8).length,
        leaderCode: leader?.code,
        leaderName: leader?.name,
        leaderPctChange: leader?.pctChange ?? 0,
        heatScore: 0,
        trend: []
      };
    });
}

function pushGroup(groups: Map<string, StockSnapshot[]>, key: string, stock: StockSnapshot) {
  const values = groups.get(key) ?? [];
  values.push(stock);
  groups.set(key, values);
}

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeCode(value: string): string {
  return value.replace(/\.(SZ|SH)$/i, "");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => Boolean(value.trim())))];
}
