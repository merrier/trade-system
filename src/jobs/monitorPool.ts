import { readMonitorPool, setMonitorPoolItemActive, upsertMonitorPoolItem } from "../core/monitorPool.js";
import type { Market } from "../shared/types.js";

const command = process.argv[2] ?? "list";
const args = parseArgs(process.argv.slice(3));

if (command === "add") {
  const code = requiredArg(args, "code");
  const item = await upsertMonitorPoolItem({
    code,
    name: args.name,
    market: normalizeMarket(args.market),
    thesis: args.thesis ?? args.note
  });
  console.log(JSON.stringify({ action: "add", item }, null, 2));
} else if (command === "remove" || command === "disable") {
  const item = await setMonitorPoolItemActive(requiredArg(args, "code"), false);
  console.log(JSON.stringify({ action: "disable", item }, null, 2));
} else if (command === "enable") {
  const item = await setMonitorPoolItemActive(requiredArg(args, "code"), true);
  console.log(JSON.stringify({ action: "enable", item }, null, 2));
} else if (command === "list") {
  const pool = await readMonitorPool();
  console.log(JSON.stringify(pool, null, 2));
} else {
  throw new Error(`未知命令：${command}。可用命令：add/list/enable/disable/remove`);
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values) {
    const match = value.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function requiredArg(args: Record<string, string>, key: string): string {
  const value = args[key]?.trim();
  if (!value) throw new Error(`缺少参数 --${key}=...`);
  return value;
}

function normalizeMarket(value: string | undefined): Market | undefined {
  if (value === "main" || value === "gem" || value === "star" || value === "bse") return value;
  return undefined;
}
