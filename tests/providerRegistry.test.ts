import { describe, expect, it } from "vitest";
import { getDailyBarProviders, runProviderFailover, type WorkerEnvelope } from "../src/data/akshareClient.js";
import type { DailyBar } from "../src/shared/types.js";

describe("provider failover", () => {
  it("switches to the next provider and records failed attempts", async () => {
    const result = await runProviderFailover<DailyBar[]>(
      "daily-bars",
      ["akshare", "efinance", "baostock"],
      {},
      async (provider, command): Promise<WorkerEnvelope<DailyBar[]>> => {
        if (provider !== "baostock") throw new Error(`${provider} unavailable`);
        return {
          provider,
          command,
          status: "success",
          data: [
            {
              tradeDate: "20260506",
              code: "600000",
              name: "浦发银行",
              market: "main",
              open: 1,
              high: 2,
              low: 1,
              close: 2,
              volume: 100,
              amount: 200,
              pctChange: 1,
              turnoverRate: 0.5,
              provider
            }
          ],
          warnings: [],
          dataAsOf: "2026-05-06T00:00:00.000Z"
        };
      }
    );

    expect(result.envelope.provider).toBe("baostock");
    expect(result.runs.map((run) => run.status)).toEqual(["failed", "failed", "success"]);
  });

  it("fails when all real providers fail instead of silently returning sample data", async () => {
    await expect(
      runProviderFailover("intraday-snapshot", ["akshare", "efinance"], {}, async (provider) => {
        throw new Error(`${provider} unavailable`);
      })
    ).rejects.toThrow("all providers failed");
  });

  it("uses Tushare first for daily bars when a token is configured", () => {
    const previousToken = process.env.TUSHARE_TOKEN;
    const previousUniverse = process.env.DAILY_BARS_LIMIT_UP_UNIVERSE;
    try {
      process.env.TUSHARE_TOKEN = "test-token";
      process.env.DAILY_BARS_LIMIT_UP_UNIVERSE = "true";

      expect(getDailyBarProviders()).toEqual(["tushare", "baostock", "efinance", "akshare"]);
    } finally {
      if (previousToken === undefined) {
        delete process.env.TUSHARE_TOKEN;
      } else {
        process.env.TUSHARE_TOKEN = previousToken;
      }
      if (previousUniverse === undefined) {
        delete process.env.DAILY_BARS_LIMIT_UP_UNIVERSE;
      } else {
        process.env.DAILY_BARS_LIMIT_UP_UNIVERSE = previousUniverse;
      }
    }
  });
});
