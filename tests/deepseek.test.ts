import { afterEach, describe, expect, it, vi } from "vitest";
import { assessIndustryLeaderWithDeepSeek } from "../src/core/deepseek.js";
import type { DeepSeekLeaderAssessmentInput } from "../src/core/deepseek.js";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DeepSeek leader assessment", () => {
  it("skips assessment when DeepSeek is not configured", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(assessIndustryLeaderWithDeepSeek(sampleLeaderInput())).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks DeepSeek to judge only from supplied evidence", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_BASE_URL = "https://deepseek.test";
    process.env.DEEPSEEK_TIMEOUT_MS = "5000";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "likely",
                reason: "通信设备板块领涨股且同行涨幅领先"
              })
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await assessIndustryLeaderWithDeepSeek(sampleLeaderInput());

    expect(result).toEqual({
      status: "likely",
      reason: "通信设备板块领涨股且同行涨幅领先"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://deepseek.test/chat/completions");
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].content).toContain("只能基于用户提供的证据判断");
    expect(body.messages[0].content).toContain("证据不足");
    expect(body.messages[1].content).toContain("长江通信");
    expect(body.messages[1].content).toContain("sectorEvidence");
  });
});

function sampleLeaderInput(): DeepSeekLeaderAssessmentInput {
  return {
    code: "600345",
    name: "长江通信",
    limitUpReason: "参股长飞光纤+商业航天+国企",
    sectors: ["通信设备", "商业航天"],
    sectorFlowRank: {
      name: "通信设备",
      rank: 2,
      netInflow: 100_300_000_000
    },
    stock: {
      industry: "通信设备",
      concepts: ["商业航天"],
      pctChange: 3.6,
      turnoverAmount: 1_230_000_000,
      turnoverRate: 8.2,
      mainNetInflow: 80_000_000
    },
    sectorEvidence: [
      {
        name: "通信设备",
        type: "industry",
        leaderCode: "600345",
        leaderName: "长江通信",
        leaderPctChange: 3.6,
        pctChange: 4.1,
        netInflow: 100_300_000_000,
        companyCount: 50,
        limitUpCount: 4
      }
    ],
    peerLeaders: [
      {
        code: "600345",
        name: "长江通信",
        pctChange: 3.6,
        turnoverAmount: 1_230_000_000
      }
    ],
    localReason: "缺少完整板块成分或行业排名数据，暂不能确认"
  };
}
