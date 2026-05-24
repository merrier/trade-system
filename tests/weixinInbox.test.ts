import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendWeixinInboundMessage, readLatestWeixinInboundMessages, resolveWeixinInboxPath } from "../src/inbox/weixinInbox.js";

const tempDirs: string[] = [];

async function createInboxDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trade-system-weixin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("weixin inbox", () => {
  it("appends normalized Weixin messages to jsonl", async () => {
    const inboxDir = await createInboxDir();
    const message = await appendWeixinInboundMessage({
      receivedAt: "2026-05-24T12:00:00.000Z",
      messageId: "wx-1",
      text: "帮我看一下今天主板情绪",
      source: {
        chatId: "chat-1",
        chatType: "dm",
        userId: "user-1"
      }
    }, { inboxDir });

    const file = await fs.readFile(resolveWeixinInboxPath(inboxDir), "utf8");
    expect(JSON.parse(file.trim())).toEqual(message);
    expect(message.platform).toBe("weixin");
  });

  it("reads latest messages newest first", async () => {
    const inboxDir = await createInboxDir();
    await appendWeixinInboundMessage({ receivedAt: "2026-05-24T12:00:00.000Z", messageId: "1", text: "first" }, { inboxDir });
    await appendWeixinInboundMessage({ receivedAt: "2026-05-24T12:01:00.000Z", messageId: "2", text: "second" }, { inboxDir });

    const latest = await readLatestWeixinInboundMessages(2, { inboxDir });
    expect(latest.map((item) => item.text)).toEqual(["second", "first"]);
  });

  it("returns an empty inbox when no file exists", async () => {
    const inboxDir = await createInboxDir();
    await expect(readLatestWeixinInboundMessages(10, { inboxDir })).resolves.toEqual([]);
  });
});
