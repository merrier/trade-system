import { describe, expect, it } from "vitest";
import { buildTdx2dbDailyBarsQuery, normalizeTdx2dbDailyBars } from "../src/data/tdx2dbDailyBars.js";

describe("tdx2db daily bars", () => {
  it("builds a main-board query against an allowed tdx2db view", () => {
    const query = buildTdx2dbDailyBarsQuery({ days: 90, view: "v_stock_qfq" });

    expect(query).toContain("FROM v_stock_qfq");
    expect(query).toContain("LIMIT 90");
    expect(query).toContain("raw_symbol_name");
    expect(query).toContain("AND (d.symbol LIKE 'sz000%'");
    expect(query).toContain("d.symbol LIKE 'sh600%'");
    expect(query).toContain("d.symbol LIKE 'sz002%'");
  });

  it("rejects unsupported view names", () => {
    expect(() => buildTdx2dbDailyBarsQuery({ days: 30, view: "raw_kline_daily" })).toThrow("不支持的 tdx2db 视图");
  });

  it("normalizes rows and keeps only main-board stocks", () => {
    const bars = normalizeTdx2dbDailyBars([
      {
        tradeDate: "2026-06-12",
        symbol: "sh600001",
        name: "样本主板",
        open: "10.1",
        high: 11,
        low: 10,
        close: "10.8",
        volume: 123400,
        amount: 12345678,
        change_pct: 1.23,
        turnover: 2.5
      },
      {
        tradeDate: "20260612",
        symbol: "sz300001",
        name: "样本创业板",
        open: 20,
        high: 21,
        low: 19,
        close: 20.5,
        volume: 200,
        amount: 4000,
        change_pct: 2,
        turnover: 3
      }
    ]);

    expect(bars).toEqual([
      {
        tradeDate: "20260612",
        code: "600001",
        name: "样本主板",
        market: "main",
        open: 10.1,
        high: 11,
        low: 10,
        close: 10.8,
        volume: 123400,
        amount: 12345678,
        pctChange: 1.23,
        turnoverRate: 2.5,
        provider: "tdx2db"
      }
    ]);
  });
});
