import { createDefaultStrategy } from "./defaults.js";
import { compileStrategyLocally, compileWatchConditionLocally, strategyDslSchema, watchConditionDslSchema } from "./strategy.js";
import type { CompileResult, Market, StrategyStyle, WatchConditionDsl } from "../shared/types.js";

interface DeepSeekMessage {
  role: "system" | "user";
  content: string;
}

export async function compileStrategy(prompt: string, markets: Market[], style: StrategyStyle): Promise<CompileResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return compileStrategyLocally(prompt, markets, style);
  }

  const fallback = compileStrategyLocally(prompt, markets, style);
  try {
    const data = await callDeepSeek([
      {
        role: "system",
        content:
          "你是A股选股策略编译器。只返回JSON。把用户自然语言转换为StrategyDsl，字段必须包括style, markets, strategyTemplates, include, exclude, weights, filters, warnings, unsupported。strategyTemplates可包含limit_up_pullback；对应filters可包含recentLimitUpDays, requireBearishCandle, requireHoldLimitUpPrice, requireAboveMa, requireVolumeContraction, maxTwentyDayGainPct, requireBullishMaAlignment。禁止输出交易指令。"
      },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          allowedMarkets: ["main", "gem", "star", "bse"],
          defaultDsl: createDefaultStrategy(style, markets)
        })
      }
    ]);

    const raw = JSON.parse(data);
    const dsl = strategyDslSchema.parse(raw.dsl ?? raw);
    if (fallback.dsl.strategyTemplates?.includes("limit_up_pullback")) {
      if (!dsl.strategyTemplates?.includes("limit_up_pullback")) {
        dsl.strategyTemplates = [...(dsl.strategyTemplates ?? []), "limit_up_pullback"];
      }
      dsl.filters.recentLimitUpDays ??= fallback.dsl.filters.recentLimitUpDays;
      dsl.filters.requireBearishCandle ??= fallback.dsl.filters.requireBearishCandle;
      dsl.filters.requireHoldLimitUpPrice ??= fallback.dsl.filters.requireHoldLimitUpPrice;
      dsl.filters.requireAboveMa ??= fallback.dsl.filters.requireAboveMa;
      dsl.filters.requireVolumeContraction ??= fallback.dsl.filters.requireVolumeContraction;
      dsl.filters.maxTwentyDayGainPct ??= fallback.dsl.filters.maxTwentyDayGainPct;
      dsl.filters.requireBullishMaAlignment ??= fallback.dsl.filters.requireBullishMaAlignment;
    }
    return {
      dsl,
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : fallback.warnings,
      unsupported: Array.isArray(raw.unsupported) ? raw.unsupported.map(String) : fallback.unsupported
    };
  } catch (error) {
    return {
      ...fallback,
      warnings: [...fallback.warnings, `DeepSeek 解析失败，已使用本地规则兜底：${error instanceof Error ? error.message : "unknown error"}`]
    };
  }
}

export async function compileWatchCondition(prompt: string, markets: Market[]): Promise<WatchConditionDsl> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return compileWatchConditionLocally(prompt, markets);
  }

  const fallback = compileWatchConditionLocally(prompt, markets);
  try {
    const data = await callDeepSeek([
      {
        role: "system",
        content:
          "你是A股个股监控条件编译器。只返回JSON，字段包括templates,prompt,markets,params。templates只能来自白名单：volume_breakout,ma_breakout,money_inflow_positive,sector_top_n,limit_up_or_reseal,dragon_tiger_listed,stop_loss_break。"
      },
      {
        role: "user",
        content: JSON.stringify({ prompt, markets, fallback })
      }
    ]);
    return watchConditionDslSchema.parse(JSON.parse(data));
  } catch {
    return fallback;
  }
}

async function callDeepSeek(messages: DeepSeekMessage[]): Promise<string> {
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
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 返回为空");
  return content;
}
