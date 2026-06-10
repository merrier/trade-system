#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path
import re
import time
from typing import Any

import requests
from bs4 import BeautifulSoup


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an offline A-share sector map from board constituents.")
    parser.add_argument("--output-dir", default="data/sector-map")
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--max-concepts", type=int, default=0, help="Debug limit; 0 means all concepts")
    parser.add_argument("--trade-date", default=datetime.now().strftime("%Y%m%d"))
    args = parser.parse_args()

    result = build_sector_map(args.trade_date, args.delay, args.max_concepts)
    if not result["records"]:
        raise RuntimeError("; ".join(result["warnings"]) or "sector map returned no records")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    dated_path = output_dir / f"main-board-sector-map-{args.trade_date}.json"
    latest_path = output_dir / "latest.json"
    payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    dated_path.write_text(payload, encoding="utf-8")
    latest_path.write_text(payload, encoding="utf-8")
    print(json.dumps({
        "tradeDate": result["tradeDate"],
        "records": len(result["records"]),
        "industryBoards": result["stats"]["industryBoards"],
        "conceptBoards": result["stats"]["conceptBoards"],
        "rawPath": str(dated_path),
        "warnings": result["warnings"],
    }, ensure_ascii=False, indent=2))


def build_sector_map(trade_date: str, delay: float, max_concepts: int) -> dict[str, Any]:
    import akshare as ak

    records: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    stats = {
        "industryBoards": 0,
        "conceptBoards": 0,
        "industryFailures": 0,
        "conceptFailures": 0,
    }

    try:
        industry_boards = ak.stock_board_industry_name_em()
        for board in rows(industry_boards):
            board_name = text(board.get("板块名称") or board.get("名称") or board.get("name"))
            if not board_name:
                continue
            try:
                time.sleep(delay)
                constituents = ak.stock_board_industry_cons_em(symbol=board_name)
                stats["industryBoards"] += 1
                for item in rows(constituents):
                    code = normalize_code(item.get("代码") or item.get("股票代码"))
                    name = text(item.get("名称") or item.get("股票简称"))
                    if not is_main_board(code):
                        continue
                    record = records.setdefault(code, {"code": code, "name": name or code, "industry": "", "concepts": []})
                    if name:
                        record["name"] = name
                    record["industry"] = board_name
            except Exception as exc:  # noqa: BLE001
                stats["industryFailures"] += 1
                warnings.append(f"行业板块 {board_name} 成分抓取失败：{type(exc).__name__}: {str(exc)[:160]}")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"行业板块列表抓取失败：{type(exc).__name__}: {str(exc)[:240]}")
        try:
            fetch_ths_boards(ak, "industry", records, stats, warnings, delay, max_concepts)
        except Exception as fallback_exc:  # noqa: BLE001
            warnings.append(f"同花顺行业板块兜底失败：{type(fallback_exc).__name__}: {str(fallback_exc)[:240]}")

    try:
        concept_boards = ak.stock_board_concept_name_em()
        concept_rows = rows(concept_boards)
        if max_concepts > 0:
            concept_rows = concept_rows[:max_concepts]
        for board in concept_rows:
            board_name = text(board.get("板块名称") or board.get("名称") or board.get("name"))
            if not board_name:
                continue
            try:
                time.sleep(delay)
                constituents = ak.stock_board_concept_cons_em(symbol=board_name)
                stats["conceptBoards"] += 1
                for item in rows(constituents):
                    code = normalize_code(item.get("代码") or item.get("股票代码"))
                    name = text(item.get("名称") or item.get("股票简称"))
                    if not is_main_board(code):
                        continue
                    record = records.setdefault(code, {"code": code, "name": name or code, "industry": "", "concepts": []})
                    if name:
                        record["name"] = name
                    if board_name not in record["concepts"]:
                        record["concepts"].append(board_name)
            except Exception as exc:  # noqa: BLE001
                stats["conceptFailures"] += 1
                warnings.append(f"概念板块 {board_name} 成分抓取失败：{type(exc).__name__}: {str(exc)[:160]}")
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"概念板块列表抓取失败：{type(exc).__name__}: {str(exc)[:240]}")
        try:
            fetch_ths_boards(ak, "concept", records, stats, warnings, delay, max_concepts)
        except Exception as fallback_exc:  # noqa: BLE001
            warnings.append(f"同花顺概念板块兜底失败：{type(fallback_exc).__name__}: {str(fallback_exc)[:240]}")

    return {
        "source": "akshare-eastmoney-board-constituents",
        "tradeDate": trade_date,
        "fetchedAt": datetime.now().isoformat(),
        "stats": stats,
        "records": sorted(records.values(), key=lambda item: item["code"]),
        "warnings": warnings[:200],
    }


def rows(df: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in df.to_dict("records")]


def fetch_ths_boards(ak: Any, board_type: str, records: dict[str, dict[str, Any]], stats: dict[str, int], warnings: list[str], delay: float, max_concepts: int) -> None:
    if board_type == "industry":
        boards = fetch_ths_board_rows(lambda: ak.stock_board_industry_name_ths())
        path = "thshy"
        stat_key = "industryBoards"
        fail_key = "industryFailures"
    else:
        boards = fetch_ths_board_rows(lambda: ak.stock_board_concept_name_ths())
        if max_concepts > 0:
            boards = boards[:max_concepts]
        path = "gn"
        stat_key = "conceptBoards"
        fail_key = "conceptFailures"

    for board in boards:
        name = text(board.get("name") or board.get("板块名称") or board.get("名称"))
        code = text(board.get("code") or board.get("板块代码"))
        if not name or not code:
            continue
        try:
            time.sleep(delay)
            constituents = fetch_ths_constituents(path, code)
            stats[stat_key] += 1
            for item in constituents:
                stock_code = normalize_code(item["code"])
                if not is_main_board(stock_code):
                    continue
                record = records.setdefault(stock_code, {"code": stock_code, "name": item["name"] or stock_code, "industry": "", "concepts": []})
                if item["name"]:
                    record["name"] = item["name"]
                if board_type == "industry":
                    record["industry"] = name
                elif name not in record["concepts"]:
                    record["concepts"].append(name)
        except Exception as exc:  # noqa: BLE001
            stats[fail_key] += 1
            warnings.append(f"同花顺{board_type}板块 {name} 成分抓取失败：{type(exc).__name__}: {str(exc)[:160]}")


def fetch_ths_board_rows(fetcher: Any) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            return rows(fetcher())
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1 + attempt)
    raise last_error or RuntimeError("同花顺板块列表抓取失败")


def fetch_ths_constituents(path: str, code: str) -> list[dict[str, str]]:
    headers = {"User-Agent": "Mozilla/5.0", "Referer": f"http://q.10jqka.com.cn/{path}/detail/code/{code}/"}
    first_url = f"http://q.10jqka.com.cn/{path}/detail/code/{code}/"
    first_text = requests.get(first_url, headers=headers, timeout=15).text
    total_pages = page_count(first_text)
    items = parse_ths_constituents(first_text)
    for page in range(2, total_pages + 1):
        url = f"http://q.10jqka.com.cn/{path}/detail/code/{code}/page/{page}/ajax/1/"
        text_body = requests.get(url, headers=headers, timeout=15).text
        items.extend(parse_ths_constituents(text_body))
    return items


def parse_ths_constituents(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", attrs={"class": re.compile(r"\bm-table\b")})
    if table is None:
        return []
    items: list[dict[str, str]] = []
    for row in table.find_all("tr"):
        cells = [cell.get_text(strip=True) for cell in row.find_all("td")]
        if len(cells) < 3:
            continue
        code = normalize_code(cells[1])
        name = cells[2]
        if code:
            items.append({"code": code, "name": name})
    return items


def page_count(html: str) -> int:
    match = re.search(r'page_info">\s*\d+/(\d+)\s*<', html)
    return int(match.group(1)) if match else 1


def normalize_code(value: Any) -> str:
    code = str(value or "").strip().upper().replace(".SZ", "").replace(".SH", "")
    if code.startswith(("SZ", "SH")):
        code = code[2:]
    return code[:6] if len(code) >= 6 and code[:6].isdigit() else ""


def is_main_board(code: str) -> bool:
    return code.startswith(("000", "001", "002", "600", "601", "603", "605"))


def text(value: Any) -> str:
    return str(value or "").strip()


if __name__ == "__main__":
    main()
