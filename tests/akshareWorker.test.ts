import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const PYTHON_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("akshare worker helpers", () => {
  it("maps paginated Fuyao quotes and rejects stale, incomplete or failed responses", async () => {
    const stdout = await runPython(`
import io
import json
import os
import sys
from types import SimpleNamespace
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo
from python import akshare_worker as worker

stamp = int(datetime(2026, 9, 28, 10, 30, tzinfo=ZoneInfo("Asia/Shanghai")).timestamp() * 1000)
quote = {"ticker": "600519", "last_price": 101, "prev_price": 100, "open_price": 100,
         "high_price": 102, "low_price": 99, "volume": 12345, "turnover": 1234567}
calls = []
def request(endpoint, **params):
    calls.append((endpoint, params))
    if endpoint.endswith("/list"):
        if params["offset"] == 0:
            return {"item": [{"ticker": "600519", "name": "贵州茅台"}] * 10000}
        return {"item": [{"ticker": "000001", "name": "*ST测试"}]}
    rows = [quote, {**quote, "ticker": "300001"}] if params["offset"] == 0 else [{**quote, "ticker": "000001", "last_price": None}]
    return {"timestamp": stamp, "total": 3, "item": rows}

with patch.object(worker, "fuyao_request", side_effect=request):
    stocks, as_of = worker.fuyao_stocks("20260928")
assert [s["code"] for s in stocks] == ["600519", "000001"]
assert stocks[0]["volume"] == 123.45 and stocks[0]["turnoverAmount"] == 1234567
assert stocks[0]["pctChange"] == 1 and stocks[0]["name"] == "贵州茅台"
assert stocks[1]["isST"] and stocks[1]["isSuspended"]
assert as_of == "2026-09-28T10:30:00+08:00"
assert calls[1][1]["offset"] == 10000 and calls[3][1]["offset"] == 2

def unavailable(**kwargs):
    raise RuntimeError("sector service unavailable")
with patch.dict(sys.modules, {"akshare": SimpleNamespace(stock_sector_fund_flow_rank=unavailable)}):
    with patch.object(worker, "fuyao_stocks", return_value=(stocks, as_of)):
        result = worker.run_command("intraday-snapshot", "fuyao", "20260928", "intraday", 30, 60, "5m", [], False)
assert result["data"]["source"] == "fuyao" and result["data"]["dataAsOf"] == as_of
assert result["data"]["sectors"] == [] and result["data"]["stocks"] == stocks
assert any("板块资金流留空" in warning for warning in result["warnings"])

for trade_date, data, names in [
    ("20260925", {"timestamp": stamp, "total": 1, "item": [quote]}, [{"ticker": "600519", "name": "茅台"}]),
    ("20260928", {"timestamp": None, "total": 1, "item": [quote]}, []),
    ("20260928", {"timestamp": stamp, "total": 1, "item": []}, []),
    ("20260928", {"timestamp": stamp, "total": 1, "item": [quote]}, []),
]:
    with patch.object(worker, "fuyao_request", side_effect=[{"item": names}, data]):
        try:
            worker.fuyao_stocks(trade_date)
        except RuntimeError:
            pass
        else:
            raise AssertionError("invalid quote data was accepted")

with patch.dict(os.environ, {"FUYAO_API_KEY": "test-secret"}):
    for payload in [{"code": 2001, "message": "test-secret"}, {"code": 4001}, {"code": 0, "data": None}]:
        with patch.object(worker, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            try:
                worker.fuyao_request("/api/a-share/prices/snapshot")
            except RuntimeError as exc:
                assert "test-secret" not in str(exc)
            else:
                raise AssertionError("invalid response was accepted")
print("ok")
`);
    expect(stdout).toBe("ok");
  }, PYTHON_TEST_TIMEOUT_MS);

  it("serializes non-finite numbers as valid JSON nulls", async () => {
    const stdout = await runPython(`
import json
import math
from python.akshare_worker import safe_json_dumps

text = safe_json_dumps({"pctChange": math.nan, "turnoverRate": math.inf, "nested": [{"x": -math.inf}]})
print(text)
`);

    expect(stdout).not.toContain("NaN");
    expect(JSON.parse(stdout)).toEqual({
      pctChange: null,
      turnoverRate: null,
      nested: [{ x: null }]
    });
  }, PYTHON_TEST_TIMEOUT_MS);

  it("loads same-day Iwencai snapshots for fallback limit-up and dragon-tiger fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trade-system-iwencai-"));
    tempDirs.push(dir);
    await fs.writeFile(
      path.join(dir, "limit-ups-20260612.json"),
      JSON.stringify({
        rows: [
          {
            "股票代码": "605318.SH",
            "股票简称": "法狮龙",
            "涨停原因[20260612]": "AI智算+算力调度",
            "连续涨停天数[20260612]": 2,
            "首次涨停时间[20260612]": "2026-06-12 09:36:40",
            "最终涨停时间[20260612]": "2026-06-12 09:43:21",
            "涨停封单额[20260612]": 51064936,
            "涨停开板次数[20260612]": 14,
            "涨跌幅[20260612]": 10.003775,
            "所属同花顺行业": ["建筑材料", "其他建材"]
          }
        ]
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(dir, "dragon-tiger-20260612.json"),
      JSON.stringify({
        rows: [
          {
            "股票代码": "605318.SH",
            "股票简称": "法狮龙",
            "上榜原因": "日涨幅偏离值达7%的证券",
            "净买入额[20260612]": 80,
            "买入额[20260612]": 100,
            "卖出额[20260612]": 20,
            "营业部名称": "机构专用",
            "买卖席位": "买1席位",
            "营业部类型": ["机构游资"]
          },
          {
            "股票代码": "605318.SH",
            "股票简称": "法狮龙",
            "上榜原因": "日涨幅偏离值达7%的证券",
            "净买入额[20260612]": -20,
            "买入额[20260612]": 10,
            "卖出额[20260612]": 30,
            "营业部名称": "测试营业部",
            "买卖席位": "卖1席位",
            "营业部类型": []
          }
        ]
      }),
      "utf8"
    );

    const stdout = await runPython(
      `
import sys
from python.akshare_worker import iwencai_dragon_tiger, iwencai_limit_up_snapshots, safe_json_dumps

print(safe_json_dumps({
    "limitUps": iwencai_limit_up_snapshots("20260612", sys.argv[1]),
    "dragonTiger": iwencai_dragon_tiger("20260612", sys.argv[1]),
}))
`,
      [dir]
    );

    const parsed = JSON.parse(stdout);
    expect(parsed.limitUps[0]).toMatchObject({
      code: "605318",
      consecutive: 2,
      firstLimitTime: "09:36:40",
      lastLimitTime: "09:43:21",
      openCount: 14,
      sealedAmount: 51064936,
      concepts: ["AI智算", "算力调度", "其他建材"]
    });
    expect(parsed.dragonTiger[0]).toMatchObject({
      code: "605318",
      buyAmount: 110,
      sellAmount: 50,
      netAmount: 60
    });
    expect(parsed.dragonTiger[0].seats).toHaveLength(2);
  }, PYTHON_TEST_TIMEOUT_MS);

  it("normalizes easyquotation share volume to lots", async () => {
    const stdout = await runPython(`
from python.akshare_worker import normalize_easyquotation_snapshot, safe_json_dumps

stocks = normalize_easyquotation_snapshot({
    "sz002430": {
        "name": "杭氧股份",
        "open": 26.91,
        "close": 27.72,
        "now": 26.04,
        "high": 27.22,
        "low": 26.0,
        "turnover": 39737316,
        "volume": 1048150886.68,
    }
})
print(safe_json_dumps(stocks[0]))
`);

    const parsed = JSON.parse(stdout);
    expect(parsed.volume).toBe(397373.16);
    expect(parsed.turnoverAmount).toBe(1048150886.68);
  }, PYTHON_TEST_TIMEOUT_MS);
});

function runPython(code: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", code, ...args], { cwd: process.cwd() });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (codeValue) => {
      if (codeValue) {
        reject(new Error(stderr || `python3 exited with ${codeValue}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
