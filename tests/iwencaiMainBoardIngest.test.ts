import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cli: vi.fn(), write: vi.fn(), persist: vi.fn(), run: vi.fn(), cache: vi.fn()
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.cli }) };
});
vi.mock("node:fs/promises", () => ({ default: { mkdir: vi.fn(), writeFile: mocks.write } }));
vi.mock("../src/server/db.js", () => ({ prisma: {
  tradingDay: { upsert: mocks.persist }, stock: { upsert: mocks.persist },
  dailyBarRecord: { upsert: mocks.persist }, dataProviderRun: { create: mocks.run },
  $disconnect: vi.fn()
} }));
vi.mock("../src/data/dailyBarCache.js", () => ({
  readDailyBarCache: vi.fn(), writeDailyBarCache: mocks.cache,
  mergeDailyBarCache: vi.fn(() => ({ bars: [] }))
}));

const argv = process.argv;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("IWENCAI_API_KEY", "test-key");
  vi.stubEnv("IWENCAI_API_KEY_FALLBACK", "");
  process.argv = ["node", "ingest"];
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { process.argv = argv; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function page(datas: unknown[], count = datas.length, more = false) {
  return { stdout: JSON.stringify({ success: true, datas, code_count: count, has_more: more, page: "1" }) };
}
const row = { 股票代码: "600000.SH", 股票简称: "浦发银行", "收盘价[20261123]": 10 };

it("rejects an API-success empty universe before touching good snapshots or bars", async () => {
  mocks.cli.mockResolvedValue(page([]));
  await expect(import("../src/jobs/ingestIwencaiMainBoard.js")).rejects.toThrow("空名单");
  expect(mocks.persist).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
});

it("rejects truncated pagination instead of publishing a partial main-board universe", async () => {
  mocks.cli.mockResolvedValue(page([row], 2));
  await expect(import("../src/jobs/ingestIwencaiMainBoard.js")).rejects.toThrow("名单不完整");
  expect(mocks.persist).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
});

it("uses the verified comma-separated query and publishes a complete response", async () => {
  mocks.cli.mockResolvedValue(page([row]));
  await import("../src/jobs/ingestIwencaiMainBoard.js");
  expect(mocks.cli.mock.calls[0][1]).toContain("沪深主板股票，开盘价，最高价，最低价，收盘价，成交量，成交额，换手率，主力资金流向，主力增仓占比");
  expect(mocks.cli.mock.calls[0][1]).toContain("10000");
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.cache).toHaveBeenCalledOnce();
});
