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
