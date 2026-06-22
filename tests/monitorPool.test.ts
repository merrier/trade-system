import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateMonitorPool, readMonitorPool, upsertMonitorPoolItem } from "../src/core/monitorPool.js";
import type { DailyBar, MarketDataset, MonitorPoolSnapshot } from "../src/shared/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("monitor pool", () => {
  it("evaluates uptrend and MA5 pullback for tracked stocks", () => {
    const pool: MonitorPoolSnapshot = {
      version: 1,
      updatedAt: "2026-06-12T00:00:00.000Z",
      items: [
        {
          code: "600001",
          name: "趋势样本",
          market: "main",
          thesis: "观察回踩5日线后的承接",
          isActive: true,
          addedAt: "2026-06-12T00:00:00.000Z"
        }
      ]
    };
    const dataset = createDataset();
    const result = evaluateMonitorPool(pool, dataset, createDailyBars());

    expect(result).toHaveLength(1);
    expect(result[0].trend.status).toBe("uptrend");
    expect(result[0].ma.pullbackToMa5).toBe("held");
    expect(result[0].reasons.join(" ")).toContain("已进入上升趋势");
    expect(result[0].reasons.join(" ")).toContain("已回踩并守住5日线");
  });

  it("upserts local monitor pool items", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "trade-system-monitor-"));
    tempDirs.push(root);

    await upsertMonitorPoolItem({ code: "600001.SH", name: "趋势样本", thesis: "观察回踩" }, root);
    await upsertMonitorPoolItem({ code: "600001", name: "趋势样本", thesis: "更新观察理由" }, root);
    const pool = await readMonitorPool(root);

    expect(pool.items).toHaveLength(1);
    expect(pool.items[0]).toMatchObject({
      code: "600001",
      name: "趋势样本",
      market: "main",
      thesis: "更新观察理由",
      isActive: true
    });
  });
});

function createDataset(): MarketDataset {
  return {
    tradeDate: "20260612",
    dataAsOf: "2026-06-12T06:50:00.000Z",
    source: "easyquotation",
    warnings: [],
    stocks: [
      {
        code: "600001",
        name: "趋势样本",
        market: "main",
        industry: "半导体",
        concepts: ["AI PC"],
        pctChange: 1.2,
        turnoverAmount: 120_000_000,
        turnoverRate: 3,
        volumeRatio: 1.4,
        close: 13.35,
        open: 13.6,
        high: 13.8,
        low: 12.8,
        volume: 1500,
        listedDays: 999
      }
    ],
    limitUps: [],
    dragonTiger: [],
    sectors: []
  };
}

function createDailyBars(): DailyBar[] {
  return Array.from({ length: 20 }, (_, index) => {
    const close = 10 + index * 0.16;
    return {
      tradeDate: `202605${String(20 + index).padStart(2, "0")}`,
      code: "600001",
      name: "趋势样本",
      market: "main",
      open: close - 0.05,
      high: close + 0.15,
      low: close - 0.15,
      close,
      volume: 1000 + index * 20,
      amount: 80_000_000 + index * 1_000_000,
      pctChange: 1,
      turnoverRate: 2,
      provider: "mock"
    };
  });
}
