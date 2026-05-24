import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildFeishuWebhookPayload, buildFeishuWebhookRequest, signFeishuWebhook, signHubWebhook } from "../src/core/feishuWebhookDelivery.js";

describe("feishu webhook delivery", () => {
  it("builds an interactive markdown card payload", () => {
    const payload = buildFeishuWebhookPayload(
      {
        id: "intraday-selection-20260522",
        kind: "intraday-selection",
        pushMessage: "# 14:50 主板选股 20260522\n\n## 推荐排名\n- **1. 603090 宏盛股份**：47 分"
      },
      { webhookUrl: "https://example.invalid/webhook" }
    ) as {
      msg_type: string;
      card: {
        header: { template: string; title: { content: string } };
        body: { elements: Array<{ tag: string; content: string }> };
      };
    };

    expect(payload.msg_type).toBe("interactive");
    expect(payload.card.header.template).toBe("orange");
    expect(payload.card.header.title.content).toBe("14:50 主板选股 20260522");
    expect(payload.card.body.elements[0].tag).toBe("markdown");
    expect(payload.card.body.elements[0].content).toContain("**1. 603090 宏盛股份**");
  });

  it("prepends the configured keyword when keyword security is used", () => {
    const payload = buildFeishuWebhookPayload(
      {
        id: "morning-20260522",
        kind: "morning",
        pushMessage: "# A股晨报 20260522"
      },
      { webhookUrl: "https://example.invalid/webhook", keyword: "trade-system" }
    ) as {
      card: {
        body: { elements: Array<{ content: string }> };
      };
    };

    expect(payload.card.body.elements[0].content).toContain("**trade-system**");
    expect(payload.card.body.elements[0].content).toContain("# A股晨报 20260522");
  });

  it("builds a signed message request for relay webhooks", () => {
    const artifact = {
      id: "intraday-selection-20260522",
      kind: "intraday-selection",
      pushMessage: "# 14:50 主板选股 20260522"
    };
    const request = buildFeishuWebhookRequest(artifact, {
      webhookUrl: "https://relay.example.invalid/webhooks/feishu-group",
      secret: "relay-secret"
    });
    const expectedBody = JSON.stringify({ message: artifact.pushMessage });

    expect(request.body).toBe(expectedBody);
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.headers["X-Hub-Signature-256"]).toBe(signHubWebhook(expectedBody, "relay-secret"));
  });

  it("signs payloads when a webhook secret is configured", () => {
    const secret = "test-secret";
    const timestamp = "1770000000";
    const expected = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");

    expect(signFeishuWebhook(timestamp, secret)).toBe(expected);

    const payload = buildFeishuWebhookPayload(
      {
        id: "close-20260522",
        kind: "close",
        pushMessage: "# A股收盘复盘 20260522"
      },
      { webhookUrl: "https://example.invalid/webhook", secret, now: new Date(Number(timestamp) * 1000) }
    ) as { timestamp: string; sign: string };

    expect(payload.timestamp).toBe(timestamp);
    expect(payload.sign).toBe(expected);
  });
});
