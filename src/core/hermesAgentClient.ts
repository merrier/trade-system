import { execFile } from "node:child_process";
import { deliverFeishuWebhook } from "./feishuWebhookDelivery.js";

export interface HermesRequest {
  kind: "morning" | "intraday-selection" | "close";
  title: string;
  marketContext: unknown;
  strategyPrompt?: string;
}

export interface HermesAnalysis {
  analysis: string;
  rankingNarrative?: string;
  pushMessage: string;
  warnings: string[];
}

export class HermesAgentClient {
  async analyze(request: HermesRequest): Promise<HermesAnalysis> {
    const prompt = buildPrompt(request);
    const command = process.env.HERMES_ANALYSIS_COMMAND;
    if (!command) {
      return localAnalysis(request, "未配置 HERMES_ANALYSIS_COMMAND，已使用本地规则生成报告摘要。");
    }

    try {
      const output = await execCommand(command, prompt);
      const parsed = parseHermesOutput(output);
      return { ...parsed, warnings: parsed.warnings };
    } catch (error) {
      const fallback = localAnalysis(request, `Hermes 分析失败，已使用本地摘要：${error instanceof Error ? error.message : "unknown error"}`);
      return fallback;
    }
  }

  async deliver(artifact: { kind: string; pushMessage: string; id: string; tradeDate?: string }): Promise<string[]> {
    const warnings: string[] = [];
    const feishuWebhookUrl = process.env.FEISHU_WEBHOOK_URL || process.env.HERMES_FEISHU_WEBHOOK_URL;
    if (feishuWebhookUrl) {
      try {
        await deliverFeishuWebhook(artifact, {
          webhookUrl: feishuWebhookUrl,
          secret: process.env.FEISHU_WEBHOOK_SECRET || process.env.HERMES_FEISHU_WEBHOOK_SECRET,
          keyword: process.env.FEISHU_WEBHOOK_KEYWORD || process.env.HERMES_FEISHU_WEBHOOK_KEYWORD,
          mode: normalizeFeishuWebhookMode(process.env.FEISHU_WEBHOOK_MODE)
        });
      } catch (error) {
        warnings.push(`Feishu webhook 推送失败：${error instanceof Error ? error.message : "unknown error"}`);
      }
      return warnings;
    }

    if (process.env.HERMES_SEND_TARGET) {
      try {
        await execCommandWithArgs(
          process.env.HERMES_SEND_BIN ?? "hermes",
          ["send", "--to", process.env.HERMES_SEND_TARGET, "--subject", `[trade-system:${artifact.kind}]`, "--file", "-"],
          artifact.pushMessage
        );
      } catch (error) {
        warnings.push(`Hermes send 推送失败：${error instanceof Error ? error.message : "unknown error"}`);
      }
      return warnings;
    }

    if (process.env.HERMES_DELIVERY_WEBHOOK_URL) {
      const response = await fetch(process.env.HERMES_DELIVERY_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artifact)
      });
      if (!response.ok) warnings.push(`Hermes webhook 推送失败：HTTP ${response.status}`);
      return warnings;
    }

    if (process.env.HERMES_DELIVERY_COMMAND) {
      try {
        await execCommand(process.env.HERMES_DELIVERY_COMMAND, artifact.pushMessage);
      } catch (error) {
        warnings.push(`Hermes command 推送失败：${error instanceof Error ? error.message : "unknown error"}`);
      }
      return warnings;
    }

    warnings.push("未配置 FEISHU_WEBHOOK_URL、HERMES_DELIVERY_COMMAND 或 HERMES_DELIVERY_WEBHOOK_URL，仅生成静态报告。");
    return warnings;
  }
}

function normalizeFeishuWebhookMode(value: string | undefined): "feishu-card" | "signed-message" | undefined {
  if (value === "feishu-card" || value === "signed-message") return value;
  return undefined;
}

function buildPrompt(request: HermesRequest): string {
  return JSON.stringify(
    {
      role: "A股主板研究报告编排",
      output: "只返回JSON，字段为 analysis, rankingNarrative, pushMessage。pushMessage 使用 Markdown 简报格式，适合飞书渲染。",
      request
    },
    null,
    2
  );
}

function parseHermesOutput(output: string): HermesAnalysis {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as Partial<HermesAnalysis>;
    return {
      analysis: String(parsed.analysis ?? output.trim()),
      rankingNarrative: parsed.rankingNarrative ? String(parsed.rankingNarrative) : undefined,
      pushMessage: String(parsed.pushMessage ?? parsed.analysis ?? output.trim()),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : []
    };
  }
  return { analysis: output.trim(), pushMessage: output.trim(), warnings: [] };
}

function localAnalysis(request: HermesRequest, warning: string): HermesAnalysis {
  if (request.kind === "morning") {
    return {
      analysis: "隔夜外盘与期货数据已汇总，关注风险偏好、美元/人民币、商品价格对主板权重与周期板块的传导。",
      pushMessage: `【A股晨报】${request.title}\n外盘、期货与板块线索已更新，详见静态报告。`,
      warnings: [warning]
    };
  }
  if (request.kind === "intraday-selection") {
    return {
      analysis: "盘中主板选股已按自然语言策略、板块热度、涨停强度、资金和流动性因子排序。",
      rankingNarrative: "优先查看高分且风险提示较少的股票；盘中数据可能延迟，仅作研究参考。",
      pushMessage: `【14:50 主板选股】${request.title}\n盘中排名已生成，注意数据延迟和高位波动风险。`,
      warnings: [warning]
    };
  }
  return {
    analysis: "收盘复盘已汇总涨跌家数、成交额、涨停梯队和板块热度，用于复盘市场结构。",
    pushMessage: `【A股复盘】${request.title}\n收盘复盘已生成，详见连板、成交和板块热度摘要。`,
    warnings: [warning]
  };
}

function execCommand(command: string, input: string): Promise<string> {
  return execCommandWithArgs(command, [], input);
}

function execCommandWithArgs(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: Number(process.env.HERMES_TIMEOUT_MS ?? 120_000) }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout || stderr);
    });
    child.stdin?.end(input);
  });
}
