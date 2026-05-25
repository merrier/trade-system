import { createHmac } from "node:crypto";

export interface FeishuWebhookArtifact {
  id: string;
  kind: string;
  pushMessage: string;
}

export interface FeishuWebhookOptions {
  webhookUrl: string;
  secret?: string;
  keyword?: string;
  mode?: "feishu-card" | "signed-message";
  now?: Date;
}

interface FeishuWebhookResponse {
  code?: number;
  msg?: string;
  StatusCode?: number;
  StatusMessage?: string;
}

export async function deliverFeishuWebhook(artifact: FeishuWebhookArtifact, options: FeishuWebhookOptions): Promise<void> {
  const request = buildFeishuWebhookRequest(artifact, options);
  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: request.headers,
    body: request.body
  });
  const bodyText = await response.text();
  let body: FeishuWebhookResponse | null = null;
  try {
    body = bodyText ? JSON.parse(bodyText) as FeishuWebhookResponse : null;
  } catch {
    body = null;
  }

  const feishuCode = body?.code ?? body?.StatusCode;
  if (!response.ok || (feishuCode !== undefined && feishuCode !== 0)) {
    const message = (body?.msg ?? body?.StatusMessage ?? bodyText) || response.statusText;
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
}

export function buildFeishuWebhookRequest(artifact: FeishuWebhookArtifact, options: FeishuWebhookOptions): { headers: Record<string, string>; body: string } {
  const mode = resolveWebhookMode(options);
  if (mode === "signed-message") {
    const message = splitTitleAndContent(withKeyword(artifact.pushMessage, options.keyword), artifact.kind);
    const body = JSON.stringify(message);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = options.secret?.trim();
    if (secret) {
      headers["X-Hub-Signature-256"] = signHubWebhook(body, secret);
    }
    return { headers, body };
  }

  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildFeishuWebhookPayload(artifact, options))
  };
}

export function buildFeishuWebhookPayload(artifact: FeishuWebhookArtifact, options: FeishuWebhookOptions): Record<string, unknown> {
  const pushMessage = withKeyword(artifact.pushMessage, options.keyword);
  const markdownChunks = splitMarkdown(pushMessage);
  const payload: Record<string, unknown> = {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      config: {
        update_multi: true
      },
      header: {
        template: templateForKind(artifact.kind),
        title: {
          tag: "plain_text",
          content: titleFromMarkdown(pushMessage) ?? `trade-system ${artifact.kind}`
        }
      },
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements: markdownChunks.map((content) => ({
          tag: "markdown",
          content,
          text_align: "left",
          text_size: "normal_v2"
        }))
      }
    }
  };

  const secret = options.secret?.trim();
  if (secret) {
    const timestamp = Math.floor((options.now?.getTime() ?? Date.now()) / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = signFeishuWebhook(timestamp, secret);
  }
  return payload;
}

export function signFeishuWebhook(timestamp: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

export function signHubWebhook(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function resolveWebhookMode(options: FeishuWebhookOptions): "feishu-card" | "signed-message" {
  if (options.mode) return options.mode;
  return options.webhookUrl.includes("open.feishu.cn/open-apis/bot/") ? "feishu-card" : "signed-message";
}

function titleFromMarkdown(markdown: string): string | null {
  const firstHeading = markdown.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  return firstHeading?.replace(/^#\s+/, "").trim() || null;
}

function splitTitleAndContent(markdown: string, kind: string): { title: string; content: string } {
  const lines = markdown.trim().split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  if (headingIndex >= 0) {
    const title = lines[headingIndex].trim().replace(/^#\s+/, "").trim();
    const content = [...lines.slice(0, headingIndex), ...lines.slice(headingIndex + 1)].join("\n").trim();
    return { title, content: content || title };
  }
  return {
    title: `trade-system ${kind}`,
    content: markdown.trim() || "报告已生成。"
  };
}

function withKeyword(markdown: string, keyword?: string): string {
  const normalized = keyword?.trim();
  if (!normalized || markdown.includes(normalized)) return markdown;
  return `**${normalized}**\n\n${markdown}`;
}

function splitMarkdown(markdown: string): string[] {
  const trimmed = markdown.trim() || "报告已生成。";
  const maxLength = 7000;
  if (trimmed.length <= maxLength) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLength) {
    const splitAt = Math.max(rest.lastIndexOf("\n", maxLength), Math.floor(maxLength * 0.8));
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function templateForKind(kind: string): string {
  if (kind === "morning") return "blue";
  if (kind === "intraday-selection") return "orange";
  if (kind === "close") return "green";
  return "grey";
}
