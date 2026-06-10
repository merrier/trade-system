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
