#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any


MAIN_PREFIXES = ("000", "001", "002", "600", "601", "603", "605")
thread_state = threading.local()


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch recent main-board daily bars from mootdx.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--max-codes", type=int, default=0)
    parser.add_argument("--universe-file", default="")
    parser.add_argument("--delay-ms", type=int, default=0)
    args = parser.parse_args()

    started = datetime.now().isoformat()
    warnings: list[str] = []

    try:
      ensure_mootdx_config()
      universe = read_universe(Path(args.universe_file) if args.universe_file else latest_universe_file())
      if args.max_codes > 0:
          universe = universe[: args.max_codes]
      if not universe:
          raise RuntimeError("No main-board stock universe found. Run iwencai main-board ingest first.")

      bars: list[dict[str, Any]] = []
      failures: list[str] = []
      concurrency = max(1, args.concurrency)

      with ThreadPoolExecutor(max_workers=concurrency) as executor:
          futures = {
              executor.submit(fetch_one_stock, stock, args.days, args.delay_ms): stock
              for stock in universe
          }
          for future in as_completed(futures):
              stock = futures[future]
              try:
                  bars.extend(future.result())
              except Exception as exc:
                  failures.append(f"{stock['code']} {stock['name']}: {type(exc).__name__}: {exc}")

      if failures:
          warnings.append(f"mootdx failed for {len(failures)} stocks; first failures: {'; '.join(failures[:8])}")
      if not bars:
          raise RuntimeError("mootdx returned no daily bars")

      bars.sort(key=lambda item: (item["tradeDate"], item["code"]))
      trade_dates = sorted({item["tradeDate"] for item in bars})
      envelope = {
          "provider": "mootdx",
          "command": "main-daily-bars",
          "status": "partial" if failures else "success",
          "data": {
              "tradeDate": trade_dates[-1] if trade_dates else None,
              "startedAt": started,
              "finishedAt": datetime.now().isoformat(),
              "universeCount": len(universe),
              "failedCount": len(failures),
              "bars": bars,
          },
          "warnings": warnings,
          "dataAsOf": datetime.now().isoformat(),
      }
      print(json.dumps(envelope, ensure_ascii=False))
      return 0
    except Exception as exc:
      print(json.dumps({"error": str(exc), "type": type(exc).__name__}, ensure_ascii=False), file=sys.stderr)
      return 1


def latest_universe_file() -> Path:
    root = Path.cwd()
    candidates = sorted((root / "data" / "iwencai").glob("main-board-*.json"))
    if not candidates:
        raise RuntimeError("No data/iwencai/main-board-*.json universe file found.")
    return candidates[-1]


def read_universe(file_path: Path) -> list[dict[str, str]]:
    payload = json.loads(file_path.read_text("utf-8"))
    rows = payload.get("rows", payload if isinstance(payload, list) else [])
    by_code: dict[str, dict[str, str]] = {}
    for row in rows:
        code = normalize_code(row.get("股票代码") or row.get("code") or "")
        name = str(row.get("股票简称") or row.get("name") or code).strip()
        if code and is_main_board(code):
            by_code[code] = {"code": code, "name": name}
    return sorted(by_code.values(), key=lambda item: item["code"])


def fetch_one_stock(stock: dict[str, str], days: int, delay_ms: int) -> list[dict[str, Any]]:
    if delay_ms > 0:
        time.sleep(delay_ms / 1000)
    client = get_client()
    data = client.bars(symbol=stock["code"], frequency=9, offset=days)
    if data is None or len(data) == 0:
        raise RuntimeError("empty bars")

    rows: list[dict[str, Any]] = []
    records = data.to_dict(orient="records") if hasattr(data, "to_dict") else []
    previous_close = 0.0
    for record in records:
        trade_date = normalize_trade_date(record)
        close = number(record.get("close"))
        pct_change = ((close - previous_close) / previous_close * 100) if previous_close > 0 and close > 0 else 0.0
        rows.append({
            "tradeDate": trade_date,
            "code": stock["code"],
            "name": stock["name"],
            "market": "main",
            "open": number(record.get("open")),
            "high": number(record.get("high")),
            "low": number(record.get("low")),
            "close": close,
            "volume": number(record.get("volume", record.get("vol"))),
            "amount": number(record.get("amount")),
            "pctChange": pct_change,
            "turnoverRate": 0,
            "provider": "mootdx",
        })
        if close > 0:
            previous_close = close
    return rows


def get_client():
    client = getattr(thread_state, "client", None)
    if client is not None:
        return client
    from mootdx.quotes import Quotes

    client = Quotes.factory(market="std", multithread=True, heartbeat=False)
    thread_state.client = client
    return client


def ensure_mootdx_config() -> None:
    config_file = Path.home() / ".mootdx" / "config.json"
    if config_file.exists():
        return
    subprocess.run([sys.executable, "-m", "mootdx", "bestip"], check=True)


def normalize_trade_date(record: dict[str, Any]) -> str:
    value = record.get("datetime")
    if value:
        text = str(value)
        return text[:10].replace("-", "")
    year = int(number(record.get("year")))
    month = int(number(record.get("month")))
    day = int(number(record.get("day")))
    if year and month and day:
        return f"{year:04d}{month:02d}{day:02d}"
    raise RuntimeError(f"missing trade date in record: {record}")


def normalize_code(value: Any) -> str:
    code = str(value).strip().upper()
    if "." in code:
        code = code.split(".")[0]
    if code.startswith(("SH", "SZ", "BJ")):
        code = code[2:]
    return code[:6] if len(code) >= 6 else ""


def is_main_board(code: str) -> bool:
    return code.startswith(MAIN_PREFIXES)


def number(value: Any) -> float:
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except Exception:
        return 0.0


if __name__ == "__main__":
    raise SystemExit(main())
