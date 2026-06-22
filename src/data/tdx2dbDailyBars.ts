import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DailyBar } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_VIEW = "v_stock_qfq";
const ALLOWED_VIEWS = new Set(["v_stock_bfq", "v_stock_qfq", "v_stock_hfq"]);

export interface Tdx2dbDailyBarRow {
  tradeDate?: string;
  date?: string;
  code?: string;
  symbol?: string;
  name?: string;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
  amount?: unknown;
  pctChange?: unknown;
  change_pct?: unknown;
  turnoverRate?: unknown;
  turnover?: unknown;
}

export interface Tdx2dbFetchOptions {
  dbPath: string;
  days: number;
  view?: string;
  duckdbBin?: string;
  timeoutMs?: number;
}

export async function fetchTdx2dbDailyBars(options: Tdx2dbFetchOptions): Promise<DailyBar[]> {
  const query = buildTdx2dbDailyBarsQuery(options);
  const { stdout } = await execFileAsync(options.duckdbBin ?? "duckdb", [options.dbPath, "-json", "-c", query], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs ?? 300_000
  });
  return normalizeTdx2dbDailyBars(parseDuckdbJson(stdout));
}

export function buildTdx2dbDailyBarsQuery(options: Pick<Tdx2dbFetchOptions, "days" | "view">): string {
  const view = normalizeViewName(options.view);
  const days = Math.max(1, Math.floor(options.days || 1));
  return `
WITH selected_dates AS (
  SELECT DISTINCT date
  FROM ${view}
  ORDER BY date DESC
  LIMIT ${days}
)
SELECT
  strftime(d.date, '%Y%m%d') AS tradeDate,
  regexp_replace(d.symbol, '^(sh|sz|bj)', '') AS code,
  COALESCE(n.name, regexp_replace(d.symbol, '^(sh|sz|bj)', '')) AS name,
  d.open AS open,
  d.high AS high,
  d.low AS low,
  d.close AS close,
  d.volume AS volume,
  d.amount AS amount,
  COALESCE(d.change_pct, CASE WHEN d.preclose > 0 THEN (d.close - d.preclose) / d.preclose * 100 ELSE 0 END) AS pctChange,
  COALESCE(d.turnover, 0) AS turnoverRate
FROM ${view} d
LEFT JOIN raw_symbol_name n ON d.symbol = n.symbol
WHERE d.date IN (SELECT date FROM selected_dates)
  AND (${mainBoardSymbolPredicate("d.symbol")})
ORDER BY d.date, d.symbol
`.trim();
}

export function normalizeTdx2dbDailyBars(rows: Tdx2dbDailyBarRow[]): DailyBar[] {
  return rows
    .map(toDailyBar)
    .filter((bar): bar is DailyBar => Boolean(bar))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.code.localeCompare(b.code));
}

function toDailyBar(row: Tdx2dbDailyBarRow): DailyBar | null {
  const code = normalizeCode(row.code || row.symbol || "");
  if (!isMainBoardCode(code)) return null;
  const tradeDate = normalizeTradeDate(row.tradeDate || row.date || "");
  if (!tradeDate) return null;
  return {
    tradeDate,
    code,
    name: String(row.name || code),
    market: "main",
    open: numberValue(row.open),
    high: numberValue(row.high),
    low: numberValue(row.low),
    close: numberValue(row.close),
    volume: numberValue(row.volume),
    amount: numberValue(row.amount),
    pctChange: numberValue(row.pctChange ?? row.change_pct),
    turnoverRate: numberValue(row.turnoverRate ?? row.turnover),
    provider: "tdx2db"
  };
}

function parseDuckdbJson(stdout: string): Tdx2dbDailyBarRow[] {
  const text = stdout.trim();
  if (!text) return [];
  const jsonStart = text.search(/[\[{]/);
  if (jsonStart < 0) return [];
  const parsed = JSON.parse(text.slice(jsonStart));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeViewName(view = DEFAULT_VIEW): string {
  if (!ALLOWED_VIEWS.has(view)) {
    throw new Error(`不支持的 tdx2db 视图：${view}`);
  }
  return view;
}

function mainBoardSymbolPredicate(symbolColumn: string): string {
  return [
    `${symbolColumn} LIKE 'sz000%'`,
    `${symbolColumn} LIKE 'sz001%'`,
    `${symbolColumn} LIKE 'sz002%'`,
    `${symbolColumn} LIKE 'sh600%'`,
    `${symbolColumn} LIKE 'sh601%'`,
    `${symbolColumn} LIKE 'sh603%'`,
    `${symbolColumn} LIKE 'sh605%'`
  ].join(" OR ");
}

function normalizeCode(value: string): string {
  return value.trim().toLowerCase().replace(/^(sh|sz|bj)/, "").replace(/\.(sh|sz|bj)$/i, "");
}

function normalizeTradeDate(value: string): string {
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) return text;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : "";
}

function isMainBoardCode(code: string): boolean {
  return /^(000|001|002|600|601|603|605)/.test(code);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
