import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildLarkCliSendArgs } from "../src/core/hermesAgentClient.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("HermesAgentClient lark-cli delivery", () => {
  it("does not use lark-cli without a target", () => {
    delete process.env.LARK_CLI_CHAT_ID;
    delete process.env.LARK_CLI_USER_ID;

    expect(buildLarkCliSendArgs({ kind: "intraday-selection", id: "report-1", pushMessage: "# hello" })).toBeNull();
  });

  it("builds a bot markdown send command for a chat", () => {
    process.env.LARK_CLI_CHAT_ID = "oc_test";
    delete process.env.LARK_CLI_USER_ID;

    expect(buildLarkCliSendArgs({ kind: "intraday-selection", id: "report-1", pushMessage: "# hello" })).toEqual([
      "im",
      "+messages-send",
      "--as",
      "bot",
      "--markdown",
      "# hello",
      "--idempotency-key",
      "report-1",
      "--chat-id",
      "oc_test"
    ]);
  });
});

describe("Hermes analysis command", () => {
  it("returns fallback JSON without a DeepSeek key", async () => {
    const env = { ...process.env };
    delete env.DEEPSEEK_API_KEY;

    const stdout = await runAnalysisCommand(
      JSON.stringify({
        request: {
          kind: "intraday-selection",
          title: "20260612 14:50 主板选股",
          marketContext: {
            topRecommendations: [{ code: "001309", name: "德明利", score: 88.8 }]
          }
        }
      }),
      env
    );
    const parsed = JSON.parse(stdout) as { analysis: string; rankingNarrative?: string; pushMessage: string; warnings: string[] };

    expect(parsed.analysis).toContain("盘中主板选股");
    expect(parsed.rankingNarrative).toContain("盘中数据可能延迟");
    expect(parsed.pushMessage).toContain("【14:50 主板选股】20260612 14:50 主板选股");
    expect(parsed.warnings).toContain("未配置 DEEPSEEK_API_KEY，Hermes 分析命令已使用本地摘要兜底。");
  });
});

function runAnalysisCommand(input: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("./scripts/hermes-analysis.sh", [], { cwd: process.cwd(), env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) {
        reject(new Error(stderr || `hermes-analysis.sh exited with ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(input);
  });
}
