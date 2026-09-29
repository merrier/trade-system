import { afterEach, expect, it, vi } from "vitest";
import { resolveStock } from "../web/src/StockSearch.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("resolves codes and exact company names without guessing ambiguous or partial names", () => {
  const items = [{ code: "600519", name: "贵州茅台" }, { code: "000001", name: "平安银行" }];
  expect(resolveStock(" 600519 ", items)).toEqual(items[0]);
  expect(resolveStock("600519 贵州茅台", items)).toEqual(items[0]);
  expect(resolveStock("贵州茅台", items)).toEqual(items[0]);
  expect(resolveStock("平安银行", items)).toEqual(items[1]);
  expect(resolveStock("平安", items)).toBeNull();
  expect(resolveStock("", items)).toBeNull();
  expect(resolveStock("600", items)).toBeNull();
  expect(resolveStock("贵州茅台", [...items, { code: "600001", name: "贵州茅台" }])).toBeNull();
  expect(resolveStock("600000", [])).toEqual({ code: "600000", name: "" });
});

it("caches and shares the ticker request and returns only public name/code fields", async () => {
  vi.resetModules();
  vi.stubEnv("FUYAO_API_KEY", "test-only");
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { item: [{ ticker: "600519", name: "贵州茅台" }] } })));
  vi.stubGlobal("fetch", fetch);
  const { fetchStockCatalog } = await import("../src/data/stockCatalog.js");
  const [first, second] = await Promise.all([fetchStockCatalog(), fetchStockCatalog()]);
  expect(first).toEqual([{ code: "600519", name: "贵州茅台" }]);
  expect(second).toEqual(first);
  expect(await fetchStockCatalog()).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(1);
});
