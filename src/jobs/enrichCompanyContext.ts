import { execFile } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface Candidate {
  code: string;
  name: string;
}

interface CompanyContextRecord {
  code: string;
  name: string;
  tradeDate: string;
  source: "iwencai";
  limitUpReason?: string;
  industry?: string;
  sectors: string[];
  keywords: string[];
  competitors: string[];
  leaderEvidence?: string;
  uniquenessEvidence?: string;
  raw: Record<string, unknown>;
  fetchedAt: string;
}

const options = parseArgs(process.argv.slice(2));

const result = await enrichCompanyContext(options);
console.log(JSON.stringify(result, null, 2));

async function enrichCompanyContext(config: IngestOptions) {
  const tradeDate = config.tradeDate ?? latestDateFromLimitUps() ?? formatDate(new Date());
  const candidates = await loadCandidates(config);
  const cliPath = expandHome(config.cliPath ?? process.env.IWENCAI_SKILL_CLI ?? "~/.codex/skills/hithink-market-query/scripts/cli.py");
  const pythonBin = config.pythonBin ?? process.env.PYTHON_BIN ?? "python3";
  const warnings: string[] = [];
  const records: CompanyContextRecord[] = [];

  for (const candidate of candidates.slice(0, config.maxCodes)) {
    await sleep(config.delayMs);
    const row = await queryIwencaiContextRow(pythonBin, cliPath, candidate, warnings);
    if (!row) {
      warnings.push(`${candidate.code} ${candidate.name}: 未查询到公司画像上下文。`);
      continue;
    }
    const record = rowToContextRecord(row, candidate, tradeDate);
    if (record) records.push(record);
  }

  const output = {
    source: "iwencai",
    inspiredBy: "simonlin1212/a-stock-data F10/研报/题材/资金面能力清单",
    tradeDate,
    fetchedAt: new Date().toISOString(),
    targetCount: Math.min(candidates.length, config.maxCodes),
    records,
    warnings
  };
  const outputDir = path.join(process.cwd(), "data", "company-context");
  await fs.mkdir(outputDir, { recursive: true });
  const datedPath = path.join(outputDir, `company-context-${tradeDate}.json`);
  await Promise.all([
    fs.writeFile(datedPath, `${JSON.stringify(output, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8")
  ]);

  return {
    tradeDate,
    targetCount: output.targetCount,
    records: records.length,
    rawPath: datedPath,
    warnings
  };
}

async function loadCandidates(config: IngestOptions): Promise<Candidate[]> {
  if (config.codes.length) {
    return uniqueCandidates(config.codes.map((code) => ({ code: normalizeCode(code), name: normalizeCode(code) })));
  }

  const latest = await latestLimitUpSnapshot();
  const rows = latest?.rows ?? [];
  return uniqueCandidates(
    rows
      .map((row) => ({
        code: normalizeCode(text(row["股票代码"])),
        name: text(row["股票简称"])
      }))
      .filter((item) => item.code && item.name && !/(^\\*?ST|退$)/i.test(item.name))
  );
}

async function latestLimitUpSnapshot(): Promise<{ file: string; rows: Array<Record<string, unknown>> } | null> {
  const dir = path.join(process.cwd(), "data", "iwencai");
  try {
    const file = (await fs.readdir(dir)).filter((item) => /^limit-ups-\d{8}\.json$/.test(item)).sort().at(-1);
    if (!file) return null;
    const parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { rows?: Array<Record<string, unknown>> };
    return { file, rows: parsed.rows ?? [] };
  } catch {
    return null;
  }
}

function latestDateFromLimitUps(): string | null {
  try {
    const files = fsSync.readdirSync(path.join(process.cwd(), "data", "iwencai"));
    return files.filter((item) => /^limit-ups-\d{8}\.json$/.test(item)).sort().at(-1)?.match(/(\d{8})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function queryIwencaiContextRow(pythonBin: string, cliPath: string, candidate: Candidate, warnings: string[]): Promise<Record<string, unknown> | null> {
  const queries = [
    `${candidate.code} ${candidate.name} 所属同花顺行业 所属概念 主营业务`,
    `${candidate.code} ${candidate.name} 近5日涨停原因 涨停日期 所属概念`,
    `${candidate.code} ${candidate.name} 行业地位 行业排名 市占率 龙头 竞争对手 主营产品`
  ];
  const apiKeys = uniqueStrings([process.env.IWENCAI_API_KEY, process.env.IWENCAI_API_KEY_FALLBACK]);
  if (!apiKeys.length) {
    warnings.push("IWENCAI_API_KEY is not present in the current process environment.");
    return null;
  }

  const merged: Record<string, unknown> = {};
  for (const query of queries) {
    for (const apiKey of apiKeys) {
      try {
        const { stdout } = await execFileAsync(pythonBin, [cliPath, "--query", query, "--page", "1", "--limit", "3"], {
          env: { ...process.env, IWENCAI_API_KEY: apiKey },
          timeout: Number(process.env.IWENCAI_TIMEOUT_MS ?? 30_000),
          maxBuffer: 10 * 1024 * 1024
        });
        const jsonStart = stdout.indexOf("{");
        if (jsonStart < 0) continue;
        const parsed = JSON.parse(stdout.slice(jsonStart)) as { datas?: Array<Record<string, unknown>> };
        const row = parsed.datas?.find((item) => normalizeCode(text(item["股票代码"])) === candidate.code) ?? parsed.datas?.[0];
        if (row) Object.assign(merged, row);
        break;
      } catch (error) {
        warnings.push(`${candidate.code} ${candidate.name}: 问财上下文查询失败：${error instanceof Error ? sanitizeError(error.message) : String(error)}`);
      }
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function rowToContextRecord(row: Record<string, unknown>, candidate: Candidate, tradeDate: string): CompanyContextRecord | null {
  const code = normalizeCode(text(row["股票代码"])) || candidate.code;
  if (!code) return null;
  const reason = textValue(row, "涨停原因");
  const industryPath = arrayText(row["所属同花顺行业"]);
  const concepts = arrayText(row["所属概念"]);
  const keywords = splitReason(reason);
  const competitors = arrayText(row["竞争对手"]);
  return {
    code,
    name: text(row["股票简称"]) || candidate.name,
    tradeDate,
    source: "iwencai",
    limitUpReason: reason || undefined,
    industry: industryPath[0],
    sectors: uniqueStrings([...industryPath.slice(1), ...concepts, ...keywords]).slice(0, 30),
    keywords,
    competitors,
    leaderEvidence: leaderEvidenceFromRow(row),
    uniquenessEvidence: uniquenessEvidenceFromKeywords(keywords),
    raw: row,
    fetchedAt: new Date().toISOString()
  };
}

function leaderEvidenceFromRow(row: Record<string, unknown>): string | undefined {
  const directKeys = Object.keys(row).filter((key) => /龙头|行业地位|行业排名|市场地位|市占率|市占/.test(key));
  const direct = directKeys
    .map((key) => `${key}：${fieldSummary(row[key])}`)
    .filter((item) => !item.endsWith("："))
    .slice(0, 2)
    .join("；");
  if (direct) return direct;
  const competitors = arrayText(row["竞争对手"]);
  if (competitors.length) return `问财返回竞争对手：${competitors.slice(0, 3).join("、")}；未见直接龙头/市占率字段`;
  return undefined;
}

function uniquenessEvidenceFromKeywords(keywords: string[]): string | undefined {
  if (!keywords.length) return undefined;
  if (keywords.length >= 3) return `${keywords.slice(0, 3).join("+")} 复合题材，辨识度较高`;
  return `${keywords.join("+")} 题材，需结合同题材数量确认唯一性`;
}

function fieldSummary(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).slice(0, 3).join("、");
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return text(value);
}

function textValue(row: Record<string, unknown>, prefix: string): string {
  const direct = text(row[prefix]);
  if (direct) return direct;
  const matchedKey = Object.keys(row).find((key) => key === prefix || key.startsWith(`${prefix}[`));
  return text(matchedKey ? row[matchedKey] : undefined);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function splitReason(reason: string): string[] {
  return reason.split(/[+＋、,，/]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeCode(code: string): string {
  return code.replace(/\.(SZ|SH|BJ)$/i, "");
}

function uniqueCandidates(values: Candidate[]): Candidate[] {
  const byCode = new Map<string, Candidate>();
  for (const item of values) {
    if (item.code) byCode.set(item.code, item);
  }
  return [...byCode.values()];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function sanitizeError(message: string): string {
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").replace(/sk-proj-[A-Za-z0-9._-]+/g, "sk-proj-***");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date).replace(/\//g, "");
}

function expandHome(input: string): string {
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args: string[]): IngestOptions {
  const getValue = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    codes: (getValue("codes") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    maxCodes: Number(getValue("max-codes") ?? process.env.COMPANY_CONTEXT_MAX_CODES ?? 80),
    delayMs: Number(getValue("delay-ms") ?? 300),
    tradeDate: getValue("trade-date"),
    cliPath: getValue("cli-path"),
    pythonBin: getValue("python-bin")
  };
}

interface IngestOptions {
  codes: string[];
  maxCodes: number;
  delayMs: number;
  tradeDate?: string;
  cliPath?: string;
  pythonBin?: string;
}
