#!/usr/bin/env node

const input = await readStdin();
const prompt = parseInput(input);
const request = prompt.request ?? {};

try {
  if (!process.env.DEEPSEEK_API_KEY) {
    writeJson(localAnalysis(request, "未配置 DEEPSEEK_API_KEY，Hermes 分析命令已使用本地摘要兜底。"));
  } else {
    const content = await callDeepSeek(prompt);
    writeJson(normalizeAnalysis(parseJsonObject(content), request));
  }
} catch (error) {
  writeJson(localAnalysis(request, `Hermes DeepSeek 分析失败，已使用本地摘要：${error instanceof Error ? error.message : String(error)}`));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseInput(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Hermes prompt 必须是 JSON object");
  return parsed;
}

async function callDeepSeek(prompt) {
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是A股研究报告分析编排助手。只返回JSON，字段为 analysis, rankingNarrative, pushMessage, warnings。基于输入数据生成研究摘要和适合飞书/微信的Markdown简报；盘中选股应按候选顺序展示，不要把排名单独做成表格列，不要突出股票代码和得分，重点说明股票名称、板块、最近涨停原因、唯一性和龙头描述；不要编造缺失数据，不要输出买卖指令，必须提示盘中数据延迟和研究参考属性。"
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek HTTP ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 返回为空");
  return content;
}

function parseJsonObject(value) {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
    throw new Error("DeepSeek 未返回 JSON object");
  }
}

function normalizeAnalysis(value, request) {
  const fallback = localAnalysis(request, "");
  const warnings = Array.isArray(value.warnings) ? value.warnings.map(String).filter(Boolean) : [];
  const rankingNarrative = asText(value.rankingNarrative);
  return {
    analysis: asText(value.analysis) || fallback.analysis,
    ...(rankingNarrative ? { rankingNarrative } : {}),
    pushMessage: asText(value.pushMessage) || fallback.pushMessage,
    warnings
  };
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function localAnalysis(request, warning) {
  const title = typeof request.title === "string" && request.title.trim() ? request.title.trim() : "报告";
  const warnings = warning ? [warning] : [];
  if (request.kind === "morning") {
    return {
      analysis: "隔夜外盘与期货数据已汇总，关注风险偏好、美元/人民币、商品价格对主板权重与周期板块的传导。",
      pushMessage: `【A股晨报】${title}\n外盘、期货与板块线索已更新，详见静态报告。`,
      warnings
    };
  }
  if (request.kind === "intraday-selection") {
    return {
      analysis: "盘中主板选股已按自然语言策略、板块热度、涨停强度、资金和流动性因子排序。",
      rankingNarrative: "优先查看高分且风险提示较少的股票；盘中数据可能延迟，仅作研究参考。",
      pushMessage: `【14:50 主板选股】${title}\n盘中排名已生成，注意数据延迟和高位波动风险。`,
      warnings
    };
  }
  return {
    analysis: "收盘复盘已汇总涨跌家数、成交额、涨停梯队和板块热度，用于复盘市场结构。",
    pushMessage: `【A股复盘】${title}\n收盘复盘已生成，详见连板、成交和板块热度摘要。`,
    warnings
  };
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
