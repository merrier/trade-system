import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const weixinInboundMessageSchema = z.object({
  platform: z.literal("weixin").default("weixin"),
  receivedAt: z.string().datetime(),
  messageId: z.string().nullable().default(null),
  messageType: z.string().default("text"),
  text: z.string().default(""),
  source: z.object({
    chatId: z.string().default(""),
    chatName: z.string().nullable().default(null),
    chatType: z.string().default("dm"),
    userId: z.string().nullable().default(null),
    userName: z.string().nullable().default(null),
    threadId: z.string().nullable().default(null)
  }).default({}),
  media: z.array(z.object({
    path: z.string(),
    type: z.string().nullable().default(null)
  })).default([]),
  rawMessageKeys: z.array(z.string()).default([])
});

export type WeixinInboundMessage = z.infer<typeof weixinInboundMessageSchema>;

export function resolveWeixinInboxPath(inboxDir = process.env.TRADE_SYSTEM_INBOX_DIR) {
  const root = inboxDir ? path.resolve(inboxDir) : path.resolve(process.cwd(), "data", "inbox");
  return path.join(root, "weixin.jsonl");
}

export async function appendWeixinInboundMessage(
  message: unknown,
  options: { inboxDir?: string } = {}
) {
  const parsed = weixinInboundMessageSchema.parse({
    platform: "weixin",
    receivedAt: new Date().toISOString(),
    ...(typeof message === "object" && message !== null ? message : {})
  });
  const filePath = resolveWeixinInboxPath(options.inboxDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(parsed)}\n`, "utf8");
  return parsed;
}

export async function readLatestWeixinInboundMessages(
  limit = 50,
  options: { inboxDir?: string } = {}
) {
  const filePath = resolveWeixinInboxPath(options.inboxDir);
  let contents = "";
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const parsed: WeixinInboundMessage[] = [];
  const lines = contents.split("\n").filter(Boolean);
  for (const line of lines.slice(-Math.max(1, limit))) {
    try {
      const item = weixinInboundMessageSchema.safeParse(JSON.parse(line));
      if (item.success) parsed.push(item.data);
    } catch {
      // Keep one malformed JSONL line from breaking the whole inbox view.
    }
  }
  return parsed.reverse();
}
