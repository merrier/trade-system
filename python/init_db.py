#!/usr/bin/env python3
import os
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "trade-system.db"


SCHEMA = """
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS "Stock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "industry" TEXT,
  "concepts" TEXT,
  "isST" BOOLEAN NOT NULL DEFAULT false,
  "isSuspended" BOOLEAN NOT NULL DEFAULT false,
  "listedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "TradingDay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'closed',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "LimitUpRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "industry" TEXT,
  "concepts" TEXT,
  "consecutive" INTEGER NOT NULL DEFAULT 1,
  "firstLimitTime" TEXT,
  "lastLimitTime" TEXT,
  "openCount" INTEGER NOT NULL DEFAULT 0,
  "sealedAmount" REAL NOT NULL DEFAULT 0,
  "turnoverRate" REAL NOT NULL DEFAULT 0,
  "pctChange" REAL NOT NULL DEFAULT 10,
  "strengthScore" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "LimitUpRecord_tradeDate_code_key" ON "LimitUpRecord"("tradeDate", "code");
CREATE INDEX IF NOT EXISTS "LimitUpRecord_tradeDate_consecutive_idx" ON "LimitUpRecord"("tradeDate", "consecutive");

CREATE TABLE IF NOT EXISTS "DragonTigerRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reason" TEXT,
  "buyAmount" REAL NOT NULL DEFAULT 0,
  "sellAmount" REAL NOT NULL DEFAULT 0,
  "netAmount" REAL NOT NULL DEFAULT 0,
  "seats" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "DragonTigerRecord_tradeDate_code_key" ON "DragonTigerRecord"("tradeDate", "code");
CREATE INDEX IF NOT EXISTS "DragonTigerRecord_tradeDate_netAmount_idx" ON "DragonTigerRecord"("tradeDate", "netAmount");

CREATE TABLE IF NOT EXISTS "SectorRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "pctChange" REAL NOT NULL DEFAULT 0,
  "inflowAmount" REAL NOT NULL DEFAULT 0,
  "outflowAmount" REAL NOT NULL DEFAULT 0,
  "netInflow" REAL NOT NULL DEFAULT 0,
  "companyCount" INTEGER NOT NULL DEFAULT 0,
  "limitUpCount" INTEGER NOT NULL DEFAULT 0,
  "leaderCode" TEXT,
  "leaderName" TEXT,
  "leaderPctChange" REAL NOT NULL DEFAULT 0,
  "heatScore" REAL NOT NULL DEFAULT 0,
  "trend" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SectorRecord_tradeDate_name_type_key" ON "SectorRecord"("tradeDate", "name", "type");
CREATE INDEX IF NOT EXISTS "SectorRecord_tradeDate_heatScore_idx" ON "SectorRecord"("tradeDate", "heatScore");

CREATE TABLE IF NOT EXISTS "DailyBarRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "open" REAL NOT NULL DEFAULT 0,
  "high" REAL NOT NULL DEFAULT 0,
  "low" REAL NOT NULL DEFAULT 0,
  "close" REAL NOT NULL DEFAULT 0,
  "volume" REAL NOT NULL DEFAULT 0,
  "amount" REAL NOT NULL DEFAULT 0,
  "pctChange" REAL NOT NULL DEFAULT 0,
  "turnoverRate" REAL NOT NULL DEFAULT 0,
  "provider" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyBarRecord_tradeDate_code_key" ON "DailyBarRecord"("tradeDate", "code");
CREATE INDEX IF NOT EXISTS "DailyBarRecord_code_tradeDate_idx" ON "DailyBarRecord"("code", "tradeDate");
CREATE INDEX IF NOT EXISTS "DailyBarRecord_tradeDate_market_idx" ON "DailyBarRecord"("tradeDate", "market");

CREATE TABLE IF NOT EXISTS "DataProviderRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL,
  "finishedAt" DATETIME NOT NULL,
  "warnings" TEXT NOT NULL,
  "error" TEXT,
  "rowCount" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DataProviderRun_command_provider_createdAt_idx" ON "DataProviderRun"("command", "provider", "createdAt");

CREATE TABLE IF NOT EXISTS "ReportRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "tradeDate" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "warnings" TEXT NOT NULL,
  "dataAsOf" DATETIME NOT NULL,
  "analysis" TEXT NOT NULL,
  "pushMessage" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ReportRun_kind_tradeDate_createdAt_idx" ON "ReportRun"("kind", "tradeDate", "createdAt");

CREATE TABLE IF NOT EXISTS "ReportArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReportRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ReportArtifact_kind_createdAt_idx" ON "ReportArtifact"("kind", "createdAt");

CREATE TABLE IF NOT EXISTS "Strategy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "dsl" TEXT NOT NULL,
  "markets" TEXT NOT NULL,
  "style" TEXT NOT NULL DEFAULT 'short_term',
  "compileWarnings" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "RecommendationRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeDate" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "strategyId" TEXT,
  "prompt" TEXT,
  "dataAsOf" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Recommendation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "tradeDate" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "score" REAL NOT NULL,
  "confidence" REAL NOT NULL,
  "reasons" TEXT NOT NULL,
  "risks" TEXT NOT NULL,
  "factors" TEXT NOT NULL,
  "dataAsOf" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Recommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RecommendationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Recommendation_tradeDate_mode_rank_idx" ON "Recommendation"("tradeDate", "mode", "rank");
CREATE INDEX IF NOT EXISTS "Recommendation_runId_rank_idx" ON "Recommendation"("runId", "rank");

CREATE TABLE IF NOT EXISTS "WatchlistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "thesis" TEXT NOT NULL,
  "conditionPrompt" TEXT NOT NULL,
  "conditionDsl" TEXT NOT NULL,
  "markets" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "WatchlistTrigger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "watchlistItemId" TEXT NOT NULL,
  "tradeDate" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "score" REAL NOT NULL,
  "reasons" TEXT NOT NULL,
  "risks" TEXT NOT NULL,
  "dataAsOf" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WatchlistTrigger_watchlistItemId_fkey" FOREIGN KEY ("watchlistItemId") REFERENCES "WatchlistItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WatchlistTrigger_tradeDate_priority_idx" ON "WatchlistTrigger"("tradeDate", "priority");
"""


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    try:
        connection.executescript(SCHEMA)
        connection.commit()
    finally:
        connection.close()
    print(f"SQLite database initialized at {DB_PATH}")


if __name__ == "__main__":
    main()
