import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completeTradingWindow, prepareIntradayHistory, fuyao } from "../src/data/intradayPreparation.js";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

vi.mock("node:fs/promises", () => ({ default: {
  mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn()
} }));
const tradeDate = "20261123";
const dates = completeTradingWindow(tradeDate);
const rows = dates.map(date => ({
  date_ms: Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00+08:00`),
  open_price: 10, high_price: 12, low_price: 9, close_price: 11, volume: 10000, turnover: 110000
}));
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubEnv("FUYAO_API_KEY", "test-key");
  vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mockSource(history = rows) {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { item: [{ ticker: "600000", name: "浦发银行", list_date: null }] } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { item: history } })));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function coverage() {
  const writes = vi.mocked(fs.writeFile).mock.calls.filter(([file]) => String(file).endsWith("coverage.json.tmp"));
  return JSON.parse(String(writes.at(-1)![1]));
}

it("fetches and validates all 30 sessions when the catalog omits the listing date", async () => {
  const source = mockSource();
  const task = prepareIntradayHistory(tradeDate);
  await vi.runAllTimersAsync(); await task;
  expect(source).toHaveBeenCalledTimes(2);
  expect(String(source.mock.calls[1][0])).toContain("adjust=forward");
  expect(coverage()).toMatchObject({ total: 1, fetched: 1, complete: 1, ready: true, missing: [] });
  const stored = vi.mocked(fs.writeFile).mock.calls.find(([file]) => String(file).endsWith("600000.json.tmp"))!;
  expect(JSON.parse(String(stored[1])).bars[0].volume).toBe(100);
});

it("still fails unexplained missing dates instead of assuming suspension or filling bars", async () => {
  mockSource(rows.slice(1));
  const assertion = expect(prepareIntradayHistory(tradeDate)).rejects.toThrow("1 只主板股票");
  await vi.runAllTimersAsync(); await assertion;
  expect(coverage()).toMatchObject({ fetched: 1, complete: 0, ready: false, excluded: [] });
  expect(coverage().missing[0]).toContain("未推定为停牌");
  expect(vi.mocked(fs.writeFile).mock.calls.some(([file]) => String(file).endsWith("600000.json.tmp"))).toBe(false);
});

it("retries transient connection failures but stops after three retries", async () => {
  const source = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", source);
  await expect(fuyao("/api/meta/tickers/list", {})).rejects.toThrow("重试3次仍失败");
  expect(source).toHaveBeenCalledTimes(4);
  source.mockClear();
  source.mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { item: [{ ticker: "600000" }] } })));
  await expect(fuyao("/api/meta/tickers/list", {})).resolves.toMatchObject({ item: [{ ticker: "600000" }] });
  expect(source).toHaveBeenCalledTimes(2);
});

it("does not retry authentication failures or hide business-code failures", async () => {
  const source = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, data: { item: [] } }), { status: 401 }));
  vi.stubGlobal("fetch", source);
  await expect(fuyao("/api/meta/tickers/list", {})).rejects.toThrow("请求失败");
  expect(source).toHaveBeenCalledTimes(1);
  source.mockClear().mockResolvedValue(new Response(JSON.stringify({ code: 500, data: { item: [] } })));
  await expect(fuyao("/api/meta/tickers/list", {})).rejects.toThrow("请求失败");
  expect(source).toHaveBeenCalledTimes(1);
});

it.each([429, 4001])("preserves bounded rate-limit backoff for %s", async (status) => {
  const source = vi.fn().mockImplementation(() => Promise.resolve(new Response(
    JSON.stringify({ code: 4001 }),
    { status: status === 429 ? 429 : 200, headers: { "Retry-After": "120" } }
  )));
  vi.stubGlobal("fetch", source);
  await expect(fuyao("/api/meta/tickers/list", {})).rejects.toThrow("持续限流");
  expect(source).toHaveBeenCalledTimes(4);
  expect(vi.mocked(delay).mock.calls.slice(-3).map(([ms]) => ms)).toEqual([120000, 120000, 240000]);
});
