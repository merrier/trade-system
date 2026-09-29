import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const rows = z.array(z.object({ ticker: z.string().regex(/^\d{6}$/), name: z.string().min(1) }));
let cached: { expires: number; items: { code: string; name: string }[] } | undefined;
let pending: Promise<{ code: string; name: string }[]> | undefined;
let retryAfter = 0;

export async function fetchStockCatalog() {
  if (cached && cached.expires > Date.now()) return cached.items;
  if (pending) return pending;
  if (!process.env.FUYAO_API_KEY || Date.now() < retryAfter) throw new Error("股票名称索引暂不可用");
  pending = (async () => {
    const items = new Map<string, { code: string; name: string }>();
    for (let offset = 0; offset < 100_000; offset += 10000) {
      if (offset) await delay(2000);
      const response = await fetch(`https://fuyao.aicubes.cn/api/meta/tickers/list?asset_type=a-share&limit=10000&offset=${offset}`, {
        headers: { "X-api-key": process.env.FUYAO_API_KEY! }, signal: AbortSignal.timeout(20_000)
      });
      if (response.status === 429) {
        const retry = response.headers.get("retry-after") ?? "60";
        const wait = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        retryAfter = Date.now() + Math.max(60_000, Number.isFinite(wait) ? wait : 60_000);
      }
      if (!response.ok) throw new Error("股票名称索引暂不可用");
      const body = await response.json();
      if (body.code !== 0) throw new Error("股票名称索引暂不可用");
      const page = rows.parse(body.data?.item);
      for (const item of page) items.set(item.ticker, { code: item.ticker, name: item.name });
      if (page.length < 10000) {
        if (!items.size) throw new Error("股票名称索引为空");
        cached = { expires: Date.now() + 24 * 3600_000, items: [...items.values()] };
        return cached.items;
      }
    }
    throw new Error("股票名称索引分页异常");
  })();
  try { return await pending; }
  catch { retryAfter = Math.max(retryAfter, Date.now() + 60_000); throw new Error("股票名称索引暂不可用"); }
  finally { pending = undefined; }
}
