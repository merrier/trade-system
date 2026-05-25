#!/usr/bin/env python3
import argparse
import contextlib
import importlib
import importlib.util
import io
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Optional


MAIN_PREFIXES = ("000", "001", "002", "600", "601", "603", "605")


def market_from_code(code: str) -> str:
    if code.startswith("300"):
        return "gem"
    if code.startswith("688"):
        return "star"
    if code.startswith(("8", "4")):
        return "bse"
    return "main"


def is_main_board(code: str) -> bool:
    return code.startswith(MAIN_PREFIXES)


def number(value: Any, default: float = 0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def integer(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


def yyyymmdd(value: datetime) -> str:
    return value.strftime("%Y%m%d")


def envelope(provider: str, command: str, data: Any, warnings: Optional[list[str]] = None, status: str = "success") -> dict:
    return {
        "provider": provider,
        "command": command,
        "status": status,
        "data": data,
        "warnings": warnings or [],
        "dataAsOf": datetime.now().isoformat(),
    }


def sample_dataset(trade_date: str) -> dict:
    return {
        "tradeDate": trade_date,
        "dataAsOf": datetime.now().isoformat(),
        "source": "sample",
        "warnings": ["当前展示的是内置样例数据，不代表真实市场。"],
        "stocks": [
            {
                "code": "603000",
                "name": "人民网",
                "market": "main",
                "industry": "传媒",
                "concepts": ["AI应用", "数据要素"],
                "pctChange": 10,
                "turnoverAmount": 1180000000,
                "turnoverRate": 12.4,
                "volumeRatio": 2.8,
                "close": 38.8,
                "ma5": 35.2,
                "listedDays": 3000,
                "mainNetInflow": 126000000,
            }
        ],
        "limitUps": [
            {
                "tradeDate": trade_date,
                "code": "603000",
                "name": "人民网",
                "market": "main",
                "industry": "传媒",
                "concepts": ["AI应用", "数据要素"],
                "consecutive": 3,
                "firstLimitTime": "09:43:12",
                "lastLimitTime": "13:18:09",
                "openCount": 1,
                "sealedAmount": 620000000,
                "turnoverRate": 12.4,
                "pctChange": 10,
            }
        ],
        "dragonTiger": [],
        "sectors": [
            {
                "tradeDate": trade_date,
                "name": "AI应用",
                "type": "concept",
                "pctChange": 5.8,
                "inflowAmount": 14200000000,
                "outflowAmount": 9600000000,
                "netInflow": 4600000000,
                "companyCount": 78,
                "limitUpCount": 9,
                "leaderCode": "603000",
                "leaderName": "人民网",
                "leaderPctChange": 10,
                "heatScore": 96,
                "trend": [1.1, 2.3, 3.8, 5.8],
            }
        ],
    }


def akshare_dataset(trade_date: str, mode: str) -> tuple[dict, list[str]]:
    import akshare as ak

    warnings: list[str] = []
    if mode == "intraday":
        spot_df = ak.stock_zh_a_spot_em()
        stocks = normalize_spot_rows(spot_df, provider="akshare")
        limit_ups: list[dict] = []
    else:
        limit_df = ak.stock_zt_pool_em(date=trade_date)
        stocks, limit_ups = normalize_limit_rows(limit_df, trade_date)

    try:
        sector_df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
    except Exception as exc:
        sector_df = None
        warnings.append(f"行业资金流接口不可用，已用涨停池行业聚合兜底：{type(exc).__name__}")
    try:
        concept_df = ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="概念资金流")
    except Exception as exc:
        concept_df = None
        warnings.append(f"概念资金流接口不可用，已用涨停池行业聚合兜底：{type(exc).__name__}")

    sectors = normalize_sector_rows(trade_date, [("industry", sector_df), ("concept", concept_df)])
    if not sectors:
        sectors = derive_sectors_from_limit_ups(trade_date, stocks, limit_ups)

    return (
        {
            "tradeDate": trade_date,
            "dataAsOf": datetime.now().isoformat(),
            "source": "akshare" if not warnings else "akshare_partial",
            "warnings": warnings,
            "stocks": stocks,
            "limitUps": limit_ups,
            "dragonTiger": [],
            "sectors": sectors,
        },
        warnings,
    )


def efinance_dataset(trade_date: str) -> tuple[dict, list[str]]:
    import efinance as ef

    quotes = ef.stock.get_realtime_quotes()
    stocks = normalize_spot_rows(quotes, provider="efinance")
    sectors = derive_sectors_from_stocks(trade_date, stocks)
    return (
        {
            "tradeDate": trade_date,
            "dataAsOf": datetime.now().isoformat(),
            "source": "efinance",
            "warnings": ["efinance 兜底源不提供完整涨停梯队，连板与龙虎榜字段为空。"],
            "stocks": stocks,
            "limitUps": derive_limit_ups_from_stocks(trade_date, stocks),
            "dragonTiger": [],
            "sectors": sectors,
        },
        [],
    )


def easyquotation_dataset(trade_date: str) -> tuple[dict, list[str]]:
    import easyquotation

    quotation = easyquotation.use(os.environ.get("EASYQUOTATION_SOURCE", "sina"))
    snapshot = quotation.market_snapshot(prefix=True)
    stocks = normalize_easyquotation_snapshot(snapshot)
    sectors = derive_sectors_from_stocks(trade_date, stocks)
    warnings = ["easyquotation 兜底源不提供行业、完整涨停梯队和龙虎榜；涨停池按涨跌幅近似派生。"]
    return (
        {
            "tradeDate": trade_date,
            "dataAsOf": datetime.now().isoformat(),
            "source": "easyquotation",
            "warnings": warnings,
            "stocks": stocks,
            "limitUps": derive_limit_ups_from_stocks(trade_date, stocks),
            "dragonTiger": [],
            "sectors": sectors,
        },
        warnings,
    )


def normalize_easyquotation_snapshot(snapshot: dict) -> list[dict]:
    stocks: list[dict] = []
    for raw_code, row in snapshot.items():
        code = normalize_stock_code(raw_code)
        if not code or not is_main_board(code):
            continue
        now = number(row.get("now", row.get("price", 0)))
        name = str(row.get("name", code) or code)
        is_suspended = now <= 0
        prev_close = number(row.get("close", 0))
        pct_change = ((now - prev_close) / prev_close * 100) if prev_close else 0
        amount = number(row.get("volume", row.get("amount", 0)))
        turnover = number(row.get("turnover", row.get("turnoverVolume", 0)))
        stocks.append(
            {
                "code": code,
                "name": name,
                "market": market_from_code(code),
                "industry": "",
                "concepts": [],
                "pctChange": pct_change,
                "turnoverAmount": amount,
                "turnoverRate": 0,
                "volumeRatio": 1,
                "close": now,
                "open": number(row.get("open", 0)),
                "high": number(row.get("high", 0)),
                "low": number(row.get("low", 0)),
                "volume": turnover,
                "ma5": None,
                "listedDays": 999,
                "mainNetInflow": 0,
                "isST": "ST" in name.upper(),
                "isSuspended": is_suspended,
            }
        )
    if not stocks:
        raise RuntimeError("easyquotation returned no main-board stocks")
    return stocks


def normalize_stock_code(raw_code: Any) -> str:
    code = str(raw_code).strip().lower().replace(".", "")
    if code.startswith("sh"):
        stripped = code[2:8]
        return stripped if stripped.startswith(("600", "601", "603", "605")) else ""
    if code.startswith("sz"):
        stripped = code[2:8]
        return stripped if stripped.startswith(("000", "001", "002")) else ""
    if code.startswith("bj"):
        return ""
    digits = "".join(char for char in code if char.isdigit())
    return digits[:6] if len(digits) >= 6 else code


def normalize_spot_rows(df: Any, provider: str) -> list[dict]:
    stocks: list[dict] = []
    for _, row in df.iterrows():
        code = str(row.get("代码", row.get("股票代码", row.get("code", "")))).strip()
        if not code or not is_main_board(code):
            continue
        name = str(row.get("名称", row.get("股票名称", row.get("name", "")))).strip()
        industry = str(row.get("所属行业", row.get("行业", "")) or "")
        amount = number(row.get("成交额", row.get("成交金额", row.get("amount", 0))))
        stocks.append(
            {
                "code": code,
                "name": name,
                "market": market_from_code(code),
                "industry": industry,
                "concepts": [],
                "pctChange": number(row.get("涨跌幅", row.get("涨跌幅(%)", row.get("changepercent", 0)))),
                "turnoverAmount": amount,
                "turnoverRate": number(row.get("换手率", row.get("换手率(%)", 0))),
                "volumeRatio": number(row.get("量比", 1), 1),
                "close": number(row.get("最新价", row.get("收盘", row.get("close", 0)))),
                "open": number(row.get("今开", row.get("开盘", row.get("open", 0)))),
                "high": number(row.get("最高", row.get("high", 0))),
                "low": number(row.get("最低", row.get("low", 0))),
                "volume": number(row.get("成交量", row.get("volume", 0))),
                "ma5": None,
                "listedDays": 999,
                "mainNetInflow": number(row.get("主力净流入", 0)),
            }
        )
    if not stocks:
        raise RuntimeError(f"{provider} returned no main-board stocks")
    return stocks


def normalize_limit_rows(df: Any, trade_date: str) -> tuple[list[dict], list[dict]]:
    stocks: list[dict] = []
    limit_ups: list[dict] = []
    for _, row in df.head(300).iterrows():
        code = str(row.get("代码", "")).strip()
        if not code or not is_main_board(code):
            continue
        name = str(row.get("名称", "")).strip()
        industry = str(row.get("所属行业", "") or "")
        stock = {
            "code": code,
            "name": name,
            "market": market_from_code(code),
            "industry": industry,
            "concepts": [],
            "pctChange": number(row.get("涨跌幅", 10), 10),
            "turnoverAmount": number(row.get("成交额", 0)),
            "turnoverRate": number(row.get("换手率", 0)),
            "volumeRatio": number(row.get("量比", 1), 1),
            "close": number(row.get("最新价", 0)),
            "open": number(row.get("今开", row.get("开盘", 0))),
            "high": number(row.get("最高", 0)),
            "low": number(row.get("最低", 0)),
            "volume": number(row.get("成交量", 0)),
            "ma5": None,
            "listedDays": 999,
            "mainNetInflow": 0,
        }
        stocks.append(stock)
        limit_ups.append(
            {
                "tradeDate": trade_date,
                "code": code,
                "name": name,
                "market": market_from_code(code),
                "industry": industry,
                "concepts": [],
                "consecutive": integer(row.get("连板数", row.get("几天几板", 1)), 1),
                "firstLimitTime": str(row.get("首次封板时间", "") or ""),
                "lastLimitTime": str(row.get("最后封板时间", "") or ""),
                "openCount": integer(row.get("炸板次数", 0), 0),
                "sealedAmount": number(row.get("封板资金", 0)),
                "turnoverRate": number(row.get("换手率", 0)),
                "pctChange": number(row.get("涨跌幅", 10), 10),
            }
        )
    if not stocks:
        raise RuntimeError("AKShare limit-up pool returned no main-board stocks")
    return stocks, limit_ups


def normalize_sector_rows(trade_date: str, frames: list[tuple[str, Any]]) -> list[dict]:
    sectors: list[dict] = []
    for sector_type, df in frames:
        if df is None:
            continue
        for _, row in df.head(120).iterrows():
            sectors.append(
                {
                    "tradeDate": trade_date,
                    "name": str(row.get("名称", row.get("行业", ""))),
                    "type": sector_type,
                    "pctChange": number(row.get("涨跌幅", row.get("今日涨跌幅", 0))),
                    "inflowAmount": number(row.get("流入资金", 0)) * 100000000,
                    "outflowAmount": number(row.get("流出资金", 0)) * 100000000,
                    "netInflow": number(row.get("净额", row.get("净流入", 0))) * 100000000,
                    "companyCount": integer(row.get("公司家数", 0)),
                    "limitUpCount": 0,
                    "leaderCode": None,
                    "leaderName": str(row.get("领涨股", "") or ""),
                    "leaderPctChange": number(row.get("领涨股-涨跌幅", 0)),
                    "heatScore": 0,
                    "trend": [],
                }
            )
    return sectors


def derive_limit_ups_from_stocks(trade_date: str, stocks: list[dict]) -> list[dict]:
    limit_ups = []
    for stock in stocks:
        if stock.get("pctChange", 0) < 9.8:
            continue
        limit_ups.append(
            {
                "tradeDate": trade_date,
                "code": stock["code"],
                "name": stock["name"],
                "market": stock["market"],
                "industry": stock.get("industry"),
                "concepts": stock.get("concepts", []),
                "consecutive": 1,
                "firstLimitTime": "",
                "lastLimitTime": "",
                "openCount": 0,
                "sealedAmount": 0,
                "turnoverRate": stock.get("turnoverRate", 0),
                "pctChange": stock.get("pctChange", 0),
            }
        )
    return limit_ups


def derive_sectors_from_stocks(trade_date: str, stocks: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for stock in stocks:
        grouped[stock.get("industry") or "未分类"].append(stock)
    sectors = []
    for industry, items in grouped.items():
        leader = sorted(items, key=lambda row: row.get("pctChange", 0), reverse=True)[0]
        sectors.append(
            {
                "tradeDate": trade_date,
                "name": industry,
                "type": "industry",
                "pctChange": sum(number(item.get("pctChange", 0)) for item in items) / max(1, len(items)),
                "inflowAmount": 0,
                "outflowAmount": 0,
                "netInflow": sum(number(item.get("turnoverAmount", 0)) for item in items),
                "companyCount": len(items),
                "limitUpCount": len([item for item in items if item.get("pctChange", 0) >= 9.8]),
                "leaderCode": leader.get("code"),
                "leaderName": leader.get("name"),
                "leaderPctChange": leader.get("pctChange", 0),
                "heatScore": 0,
                "trend": [],
            }
        )
    return sectors


def derive_sectors_from_limit_ups(trade_date: str, stocks: list, limit_ups: list) -> list:
    grouped = defaultdict(list)
    stocks_by_code = {item["code"]: item for item in stocks}
    for item in limit_ups:
        grouped[item.get("industry") or "未分类"].append(item)

    sectors = []
    for industry, items in grouped.items():
        leader = sorted(items, key=lambda row: (row.get("consecutive", 0), row.get("sealedAmount", 0)), reverse=True)[0]
        related_stocks = [stocks_by_code.get(item["code"], {}) for item in items]
        turnover = sum(number(stock.get("turnoverAmount", 0)) for stock in related_stocks)
        pct_change = sum(number(item.get("pctChange", 0)) for item in items) / max(1, len(items))
        sectors.append(
            {
                "tradeDate": trade_date,
                "name": industry,
                "type": "industry",
                "pctChange": pct_change,
                "inflowAmount": 0,
                "outflowAmount": 0,
                "netInflow": turnover,
                "companyCount": len(items),
                "limitUpCount": len(items),
                "leaderCode": leader.get("code"),
                "leaderName": leader.get("name"),
                "leaderPctChange": number(leader.get("pctChange", 0)),
                "heatScore": 0,
                "trend": [],
            }
        )
    return sectors


def daily_bars(provider: str, trade_date: str, days: int) -> list[dict]:
    if provider == "tushare":
        return tushare_daily_bars(trade_date, days)
    if provider == "efinance":
        return efinance_daily_bars(trade_date, days)
    if provider == "akshare":
        return akshare_daily_bars(trade_date, days)
    if provider == "baostock":
        return baostock_daily_bars(trade_date, days)
    if provider == "ashare":
        return ashare_daily_bars(trade_date, days)
    raise RuntimeError(f"{provider} does not implement daily-bars")


def minute_bars(provider: str, trade_date: str, count: int, frequency: str, codes: list[str]) -> list[dict]:
    if provider == "ashare":
        return ashare_minute_bars(trade_date, count, frequency, codes)
    raise RuntimeError(f"{provider} does not implement minute-bars")


def efinance_daily_bars(trade_date: str, days: int) -> list[dict]:
    import efinance as ef

    start = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=max(45, days * 2))).strftime("%Y%m%d")
    quotes = ef.stock.get_realtime_quotes()
    codes = []
    names: dict[str, str] = {}
    for _, row in quotes.iterrows():
        code = str(row.get("股票代码", row.get("代码", ""))).strip()
        if not code or not is_main_board(code):
            continue
        codes.append(code)
        names[code] = str(row.get("股票名称", row.get("名称", code)) or code)

    chunk_size = max(1, integer(__import__("os").environ.get("EFINANCE_HISTORY_CHUNK_SIZE"), 80))
    bars: list[dict] = []
    for offset in range(0, len(codes), chunk_size):
        chunk = codes[offset : offset + chunk_size]
        history = ef.stock.get_quote_history(
            chunk,
            beg=start,
            end=trade_date,
            klt=101,
            fqt=1,
            suppress_error=True,
        )
        frames = history.values() if isinstance(history, dict) else [history]
        for df in frames:
            if df is None or getattr(df, "empty", True):
                continue
            for _, row in df.iterrows():
                code = str(row.get("股票代码", "")).strip()
                if not code or not is_main_board(code):
                    continue
                date_text = str(row.get("日期", "")).replace("-", "")
                if not date_text or date_text > trade_date:
                    continue
                bars.append(
                    {
                        "tradeDate": date_text,
                        "code": code,
                        "name": str(row.get("股票名称", names.get(code, code)) or names.get(code, code)),
                        "market": market_from_code(code),
                        "open": number(row.get("开盘", 0)),
                        "high": number(row.get("最高", 0)),
                        "low": number(row.get("最低", 0)),
                        "close": number(row.get("收盘", 0)),
                        "volume": number(row.get("成交量", 0)),
                        "amount": number(row.get("成交额", 0)),
                        "pctChange": number(row.get("涨跌幅", 0)),
                        "turnoverRate": number(row.get("换手率", 0)),
                        "provider": "efinance",
                    }
                )
    if not bars:
        raise RuntimeError("efinance returned no daily bars")
    return bars


def tushare_daily_bars(trade_date: str, days: int) -> list[dict]:
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("TUSHARE_TOKEN is not configured")

    import tushare as ts

    pro = ts.pro_api(token)
    start = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=max(45, days * 2))).strftime("%Y%m%d")
    try:
        calendar = pro.trade_cal(exchange="", start_date=start, end_date=trade_date, is_open="1", fields="cal_date,is_open")
    except Exception:
        calendar = None
    if calendar is not None and not getattr(calendar, "empty", True):
        trade_dates = sorted(str(row.get("cal_date", "")).strip() for _, row in calendar.iterrows() if str(row.get("cal_date", "")).strip())
        trade_dates = trade_dates[-days:] or recent_weekday_dates(trade_date, days)
    else:
        trade_dates = recent_weekday_dates(trade_date, days)

    names = tushare_code_names(pro)
    bars: list[dict] = []
    for day in trade_dates:
        df = pro.daily(
            trade_date=day,
            fields="ts_code,trade_date,open,high,low,close,pct_chg,vol,amount",
        )
        if df is None or getattr(df, "empty", True):
            continue
        turnover_rates = tushare_turnover_rates(pro, day)
        for _, row in df.iterrows():
            ts_code = str(row.get("ts_code", "")).strip()
            code = ts_code.split(".")[0]
            if not code or not is_main_board(code):
                continue
            bars.append(
                {
                    "tradeDate": str(row.get("trade_date", day)).strip(),
                    "code": code,
                    "name": names.get(code, code),
                    "market": market_from_code(code),
                    "open": number(row.get("open", 0)),
                    "high": number(row.get("high", 0)),
                    "low": number(row.get("low", 0)),
                    "close": number(row.get("close", 0)),
                    "volume": number(row.get("vol", 0)) * 100,
                    "amount": number(row.get("amount", 0)) * 1000,
                    "pctChange": number(row.get("pct_chg", 0)),
                    "turnoverRate": turnover_rates.get(ts_code, 0),
                    "provider": "tushare",
                }
            )
    if not bars:
        raise RuntimeError("Tushare returned no daily bars")
    return bars


def recent_weekday_dates(trade_date: str, days: int) -> list[str]:
    current = datetime.strptime(trade_date, "%Y%m%d")
    dates: list[str] = []
    for offset in range(0, max(45, days * 3)):
        day = current - timedelta(days=offset)
        if day.weekday() < 5:
            dates.append(yyyymmdd(day))
        if len(dates) >= days:
            break
    return sorted(dates)


def tushare_code_names(pro: Any) -> dict[str, str]:
    try:
        df = pro.stock_basic(exchange="", list_status="L", fields="ts_code,symbol,name")
    except Exception:
        return {}
    if df is None or getattr(df, "empty", True):
        return {}
    names: dict[str, str] = {}
    for _, row in df.iterrows():
        code = str(row.get("symbol", "")).strip()
        if code and is_main_board(code):
            names[code] = str(row.get("name", code) or code)
    return names


def tushare_turnover_rates(pro: Any, trade_date: str) -> dict[str, float]:
    try:
        df = pro.daily_basic(trade_date=trade_date, fields="ts_code,turnover_rate")
    except Exception:
        return {}
    if df is None or getattr(df, "empty", True):
        return {}
    return {str(row.get("ts_code", "")).strip(): number(row.get("turnover_rate", 0)) for _, row in df.iterrows()}


def ashare_daily_bars(trade_date: str, days: int) -> list[dict]:
    get_price = load_ashare_get_price()
    names = ashare_code_universe(trade_date, days)
    if not names:
        raise RuntimeError("Ashare has no code universe")

    bars: list[dict] = []
    end_date = datetime.strptime(trade_date, "%Y%m%d").strftime("%Y-%m-%d")
    for code, name in sorted(names.items()):
        try:
            df = get_price(ashare_symbol(code), frequency="1d", count=max(days + 5, 35), end_date=end_date)
        except Exception:
            continue
        if df is None or getattr(df, "empty", True):
            continue
        previous_close = 0.0
        rows = list(df.iterrows())
        first_output_index = max(0, len(rows) - days)
        for row_index, (index, row) in enumerate(rows):
            date_text = str(getattr(index, "date", lambda: index)()).replace("-", "")
            if len(date_text) >= 10:
                date_text = date_text[:10].replace("-", "")
            if not date_text or date_text > trade_date:
                continue
            close = number(row.get("close", 0))
            volume = number(row.get("volume", 0))
            pct_change = ((close - previous_close) / previous_close * 100) if previous_close else 0
            previous_close = close or previous_close
            if row_index < first_output_index:
                continue
            bars.append(
                {
                    "tradeDate": date_text,
                    "code": code,
                    "name": name,
                    "market": market_from_code(code),
                    "open": number(row.get("open", 0)),
                    "high": number(row.get("high", 0)),
                    "low": number(row.get("low", 0)),
                    "close": close,
                    "volume": volume,
                    "amount": volume * close,
                    "pctChange": pct_change,
                    "turnoverRate": 0,
                    "provider": "ashare",
                }
            )
    if not bars:
        raise RuntimeError("Ashare returned no daily bars")
    return bars


def ashare_minute_bars(trade_date: str, count: int, frequency: str, codes: list[str]) -> list[dict]:
    if frequency not in ("1m", "5m", "15m", "30m", "60m"):
        raise RuntimeError(f"Ashare unsupported minute frequency: {frequency}")

    get_price = load_ashare_get_price()
    names = resolve_minute_code_names(trade_date, codes)
    if not names:
        raise RuntimeError("Ashare minute-bars requires codes or a recent limit-up universe")

    max_codes = max(1, integer(os.environ.get("ASHARE_MINUTE_MAX_CODES"), 80))
    max_count = max(1, integer(os.environ.get("ASHARE_MINUTE_MAX_COUNT"), 120))
    count = min(max(1, count), max_count)
    end_date = datetime.strptime(trade_date, "%Y%m%d").strftime("%Y-%m-%d")
    bars: list[dict] = []
    for code, name in sorted(names.items())[:max_codes]:
        try:
            df = get_price(ashare_symbol(code), frequency=frequency, count=count, end_date=end_date)
        except Exception:
            continue
        if df is None or getattr(df, "empty", True):
            continue
        rows = list(df.iterrows())[-count:]
        for index, row in rows:
            trade_time, bar_date = ashare_trade_time(index, trade_date)
            if bar_date > trade_date:
                continue
            close = number(row.get("close", 0))
            volume = number(row.get("volume", 0))
            bars.append(
                {
                    "tradeDate": bar_date,
                    "tradeTime": trade_time,
                    "code": code,
                    "name": name,
                    "market": market_from_code(code),
                    "open": number(row.get("open", 0)),
                    "high": number(row.get("high", 0)),
                    "low": number(row.get("low", 0)),
                    "close": close,
                    "volume": volume,
                    "amount": volume * close,
                    "frequency": frequency,
                    "provider": "ashare",
                }
            )
    if not bars:
        raise RuntimeError("Ashare returned no minute bars")
    return bars


def resolve_minute_code_names(trade_date: str, codes: list[str]) -> dict[str, str]:
    code_names = load_code_names()
    names: dict[str, str] = {}
    for raw_code in codes:
        code = normalize_stock_code(raw_code)
        if code and is_main_board(code):
            names[code] = code_names.get(code, code)
    if names:
        return names
    return recent_limit_up_names(trade_date, 3)


def ashare_trade_time(index: Any, fallback_trade_date: str) -> tuple[str, str]:
    if hasattr(index, "to_pydatetime"):
        value = index.to_pydatetime()
        return value.strftime("%Y-%m-%d %H:%M:%S"), value.strftime("%Y%m%d")
    text = str(index)
    if len(text) >= 16:
        trade_time = text[:19] if len(text) >= 19 else f"{text[:16]}:00"
        return trade_time, text[:10].replace("-", "")
    return f"{fallback_trade_date[:4]}-{fallback_trade_date[4:6]}-{fallback_trade_date[6:]} 00:00:00", fallback_trade_date


def load_ashare_get_price() -> Any:
    module_path = os.environ.get("ASHARE_MODULE_PATH", "").strip()
    if module_path:
        spec = importlib.util.spec_from_file_location("Ashare", module_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load Ashare module from {module_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.get_price
    return importlib.import_module("Ashare").get_price


def ashare_code_universe(trade_date: str, days: int) -> dict[str, str]:
    if os.environ.get("DAILY_BARS_LIMIT_UP_UNIVERSE", "").lower() == "true":
        names = recent_limit_up_names(trade_date, min(10, days))
        if names:
            return names

    try:
        import easyquotation

        snapshot = easyquotation.use(os.environ.get("EASYQUOTATION_SOURCE", "sina")).market_snapshot(prefix=True)
        names = {}
        for raw_code, row in snapshot.items():
            code = normalize_stock_code(raw_code)
            if code and is_main_board(code):
                names[code] = str(row.get("name", code) or code)
        if names:
            return names
    except Exception:
        pass

    return load_code_names()


def ashare_symbol(code: str) -> str:
    return f"sh{code}" if code.startswith(("600", "601", "603", "605")) else f"sz{code}"


def akshare_daily_bars(trade_date: str, days: int) -> list[dict]:
    import akshare as ak

    spot = ak.stock_zh_a_spot_em()
    bars: list[dict] = []
    for _, row in spot.iterrows():
        code = str(row.get("代码", "")).strip()
        if not code or not is_main_board(code):
            continue
        name = str(row.get("名称", "")).strip()
        bars.append(
            {
                "tradeDate": trade_date,
                "code": code,
                "name": name,
                "market": market_from_code(code),
                "open": number(row.get("今开", row.get("开盘", 0))),
                "high": number(row.get("最高", 0)),
                "low": number(row.get("最低", 0)),
                "close": number(row.get("最新价", row.get("收盘", 0))),
                "volume": number(row.get("成交量", 0)),
                "amount": number(row.get("成交额", 0)),
                "pctChange": number(row.get("涨跌幅", 0)),
                "turnoverRate": number(row.get("换手率", 0)),
                "provider": "akshare",
            }
        )
    if not bars:
        raise RuntimeError("AKShare returned no daily bars")
    return bars


def baostock_daily_bars(trade_date: str, days: int) -> list[dict]:
    import baostock as bs

    start = (datetime.strptime(trade_date, "%Y%m%d") - timedelta(days=max(45, days * 2))).strftime("%Y-%m-%d")
    end = datetime.strptime(trade_date, "%Y%m%d").strftime("%Y-%m-%d")
    with contextlib.redirect_stdout(io.StringIO()):
        lg = bs.login()
    if lg.error_code != "0":
        raise RuntimeError(lg.error_msg)
    bars: list[dict] = []
    try:
        codes, names = baostock_code_universe(bs, end, trade_date, days)
        for full_code in codes:
            code = full_code.split(".")[-1]
            rs = bs.query_history_k_data_plus(
                full_code,
                "date,code,open,high,low,close,volume,amount,pctChg,turn",
                start_date=start,
                end_date=end,
                frequency="d",
                adjustflag="3",
            )
            while rs.next():
                row = rs.get_row_data()
                bars.append(
                    {
                        "tradeDate": row[0].replace("-", ""),
                        "code": code,
                        "name": names.get(code, code),
                        "market": market_from_code(code),
                        "open": number(row[2]),
                        "high": number(row[3]),
                        "low": number(row[4]),
                        "close": number(row[5]),
                        "volume": number(row[6]),
                        "amount": number(row[7]),
                        "pctChange": number(row[8]),
                        "turnoverRate": number(row[9]),
                        "provider": "baostock",
                    }
                )
    finally:
        with contextlib.redirect_stdout(io.StringIO()):
            bs.logout()
    if not bars:
        raise RuntimeError("BaoStock returned no daily bars")
    return bars


def baostock_code_universe(bs: Any, end: str, trade_date: str, days: int) -> tuple[list[str], dict[str, str]]:
    if os.environ.get("DAILY_BARS_LIMIT_UP_UNIVERSE", "").lower() == "true":
        names = recent_limit_up_names(trade_date, min(10, days))
        if names:
            return [full_baostock_code(code) for code in sorted(names)], names

    rs = bs.query_all_stock(end)
    codes = []
    names = load_code_names()
    while rs.next():
        row = rs.get_row_data()
        code = row[0].split(".")[-1]
        if is_main_board(code):
            codes.append(row[0])
    return codes, names


def recent_limit_up_names(trade_date: str, trading_days: int) -> dict[str, str]:
    import akshare as ak

    names: dict[str, str] = {}
    current = datetime.strptime(trade_date, "%Y%m%d")
    seen_days = 0
    for offset in range(0, 24):
        day = yyyymmdd(current - timedelta(days=offset))
        try:
            df = ak.stock_zt_pool_em(date=day)
        except Exception:
            continue
        if df is None or getattr(df, "empty", True):
            continue
        seen_days += 1
        for _, row in df.iterrows():
            code = str(row.get("代码", "")).strip()
            if code and is_main_board(code):
                names[code] = str(row.get("名称", code) or code)
        if seen_days >= trading_days:
            break
    return names


def load_code_names() -> dict[str, str]:
    try:
        import akshare as ak

        df = ak.stock_info_a_code_name()
        return {
            str(row.get("code", "")).strip(): str(row.get("name", "") or row.get("code", ""))
            for _, row in df.iterrows()
            if is_main_board(str(row.get("code", "")).strip())
        }
    except Exception:
        return {}


def full_baostock_code(code: str) -> str:
    return f"sh.{code}" if code.startswith(("600", "601", "603", "605")) else f"sz.{code}"


def us_market_brief(provider: str) -> dict:
    if provider not in ("yfinance", "stooq", "alpha_vantage"):
        raise RuntimeError(f"{provider} does not implement us-market-brief")
    if provider == "yfinance":
        return yfinance_us_market_brief()
    raise RuntimeError(f"{provider} is configured as a later external fallback; no local implementation")


def yfinance_us_market_brief() -> dict:
    import yfinance as yf

    groups = {
        "indices": [("^DJI", "道琼斯"), ("^GSPC", "标普500"), ("^IXIC", "纳斯达克"), ("^RUT", "罗素2000")],
        "futures": [("ES=F", "标普期货"), ("NQ=F", "纳指期货"), ("YM=F", "道指期货"), ("CL=F", "WTI原油"), ("GC=F", "COMEX黄金")],
        "sectors": [("XLK", "科技"), ("XLF", "金融"), ("XLE", "能源"), ("XLI", "工业"), ("XLY", "可选消费"), ("XLV", "医疗")],
        "currencies": [("CNH=X", "离岸人民币"), ("DX-Y.NYB", "美元指数")],
        "commodities": [("HG=F", "铜"), ("SI=F", "白银")],
    }
    brief: dict[str, Any] = {"asOf": datetime.now().isoformat(), "previousSession": "", "indices": [], "futures": [], "sectors": [], "currencies": [], "commodities": []}
    for key, symbols in groups.items():
        for symbol, name in symbols:
            hist = yf.Ticker(symbol).history(period="5d", interval="1d")
            if hist.empty:
                continue
            last = hist.iloc[-1]
            prev = hist.iloc[-2] if len(hist) > 1 else last
            close = number(last.get("Close", 0))
            prev_close = number(prev.get("Close", close), close)
            pct = ((close - prev_close) / prev_close * 100) if prev_close else 0
            if not brief["previousSession"]:
                brief["previousSession"] = str(hist.index[-1].date()).replace("-", "")
            brief[key].append({"symbol": symbol, "name": name, "close" if key == "indices" else "price": close, "pctChange": pct})
    if not brief["indices"]:
        raise RuntimeError("yfinance returned no US indices")
    return brief


def run_command(command: str, provider: str, trade_date: str, mode: str, days: int, count: int, frequency: str, codes: list[str], allow_sample: bool) -> dict:
    if command in ("intraday-snapshot", "limit-up-ladder", "sector-flow"):
        if provider == "akshare":
            dataset, warnings = akshare_dataset(trade_date, "intraday" if command == "intraday-snapshot" else mode)
        elif provider == "efinance":
            dataset, warnings = efinance_dataset(trade_date)
        elif provider == "easyquotation" and command == "intraday-snapshot":
            dataset, warnings = easyquotation_dataset(trade_date)
        elif provider == "sample" and allow_sample:
            dataset, warnings = sample_dataset(trade_date), ["使用样例数据。"]
        else:
            raise RuntimeError(f"{provider} does not implement {command}")
        return envelope(provider, command, dataset, warnings)
    if command == "daily-bars":
        return envelope(provider, command, daily_bars(provider, trade_date, days))
    if command == "minute-bars":
        return envelope(provider, command, minute_bars(provider, trade_date, count, frequency, codes))
    if command == "us-market-brief":
        return envelope(provider, command, us_market_brief(provider))
    raise RuntimeError(f"unknown command: {command}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", default=None)
    parser.add_argument("--provider", default="akshare")
    parser.add_argument("--mode", default="post_close")
    parser.add_argument("--trade-date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--count", type=int, default=60)
    parser.add_argument("--frequency", default="5m")
    parser.add_argument("--codes", default="")
    parser.add_argument("--allow-sample", action="store_true")
    args = parser.parse_args()
    command = args.command or ("intraday-snapshot" if args.mode == "intraday" else "limit-up-ladder")
    codes = [item.strip() for item in args.codes.split(",") if item.strip()]

    try:
        result = run_command(command, args.provider, args.trade_date, args.mode, args.days, args.count, args.frequency, codes, args.allow_sample)
    except Exception as exc:
        print(json.dumps({"provider": args.provider, "command": command, "status": "failed", "error": f"{type(exc).__name__}: {exc}", "warnings": []}, ensure_ascii=False), file=sys.stderr)
        raise

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
