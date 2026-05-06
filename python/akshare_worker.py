#!/usr/bin/env python3
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime


def market_from_code(code: str) -> str:
    if code.startswith("300"):
        return "gem"
    if code.startswith("688"):
        return "star"
    if code.startswith(("8", "4")):
        return "bse"
    return "main"


def sample_dataset(trade_date: str) -> dict:
    from pathlib import Path

    # Keep the Python fallback compact; the TypeScript fallback has richer data.
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


def try_akshare(trade_date: str) -> dict:
    import akshare as ak

    warnings = []
    # AKShare public endpoints occasionally change column names; normalize only the
    # fields the application needs. Keep partial real data instead of silently
    # falling back to stale sample data when a noncritical endpoint fails.
    limit_df = ak.stock_zt_pool_em(date=trade_date)
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

    stocks = []
    limit_ups = []
    for _, row in limit_df.head(120).iterrows():
        code = str(row.get("代码", ""))
        name = str(row.get("名称", ""))
        market = market_from_code(code)
        concepts = []
        industry = str(row.get("所属行业", "") or "")
        stock = {
            "code": code,
            "name": name,
            "market": market,
            "industry": industry,
            "concepts": concepts,
            "pctChange": float(row.get("涨跌幅", 10) or 10),
            "turnoverAmount": float(row.get("成交额", 0) or 0),
            "turnoverRate": float(row.get("换手率", 0) or 0),
            "volumeRatio": float(row.get("量比", 1) or 1),
            "close": float(row.get("最新价", 0) or 0),
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
                "market": market,
                "industry": industry,
                "concepts": concepts,
                "consecutive": int(row.get("连板数", row.get("几天几板", 1)) or 1),
                "firstLimitTime": str(row.get("首次封板时间", "") or ""),
                "lastLimitTime": str(row.get("最后封板时间", "") or ""),
                "openCount": int(row.get("炸板次数", 0) or 0),
                "sealedAmount": float(row.get("封板资金", 0) or 0),
                "turnoverRate": float(row.get("换手率", 0) or 0),
                "pctChange": float(row.get("涨跌幅", 10) or 10),
            }
        )

    sectors = []
    for sector_type, df in [("industry", sector_df), ("concept", concept_df)]:
        if df is None:
            continue
        for _, row in df.head(80).iterrows():
            sectors.append(
                {
                    "tradeDate": trade_date,
                    "name": str(row.get("名称", row.get("行业", ""))),
                    "type": sector_type,
                    "pctChange": float(row.get("涨跌幅", row.get("今日涨跌幅", 0)) or 0),
                    "inflowAmount": float(row.get("流入资金", 0) or 0) * 100000000,
                    "outflowAmount": float(row.get("流出资金", 0) or 0) * 100000000,
                    "netInflow": float(row.get("净额", row.get("净流入", 0)) or 0) * 100000000,
                    "companyCount": int(row.get("公司家数", 0) or 0),
                    "limitUpCount": 0,
                    "leaderCode": None,
                    "leaderName": str(row.get("领涨股", "") or ""),
                    "leaderPctChange": float(row.get("领涨股-涨跌幅", 0) or 0),
                    "heatScore": 0,
                    "trend": [],
                }
            )

    if not sectors:
        sectors = derive_sectors_from_limit_ups(trade_date, stocks, limit_ups)

    return {
        "tradeDate": trade_date,
        "dataAsOf": datetime.now().isoformat(),
        "source": "akshare" if not warnings else "akshare_partial",
        "warnings": warnings,
        "stocks": stocks,
        "limitUps": limit_ups,
        "dragonTiger": [],
        "sectors": sectors,
    }


def derive_sectors_from_limit_ups(trade_date: str, stocks: list, limit_ups: list) -> list:
    grouped = defaultdict(list)
    stocks_by_code = {item["code"]: item for item in stocks}
    for item in limit_ups:
        grouped[item.get("industry") or "未分类"].append(item)

    sectors = []
    for industry, items in grouped.items():
        leader = sorted(items, key=lambda row: (row.get("consecutive", 0), row.get("sealedAmount", 0)), reverse=True)[0]
        related_stocks = [stocks_by_code.get(item["code"], {}) for item in items]
        turnover = sum(float(stock.get("turnoverAmount", 0) or 0) for stock in related_stocks)
        pct_change = sum(float(item.get("pctChange", 0) or 0) for item in items) / max(1, len(items))
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
                "leaderPctChange": float(leader.get("pctChange", 0) or 0),
                "heatScore": 0,
                "trend": [],
            }
        )
    return sectors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="post_close")
    parser.add_argument("--trade-date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--allow-sample", action="store_true")
    args = parser.parse_args()

    try:
        dataset = try_akshare(args.trade_date)
    except Exception as exc:
        if not args.allow_sample:
            print(json.dumps({"error": f"AKShare 数据获取失败：{type(exc).__name__}: {exc}"}, ensure_ascii=False), file=sys.stderr)
            raise
        dataset = sample_dataset(args.trade_date)

    print(json.dumps(dataset, ensure_ascii=False))


if __name__ == "__main__":
    main()
