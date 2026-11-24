"""Collect and audit raw A-share daily bars. Never write the adjusted strategy cache."""
import argparse
import json
import os
import shutil
import subprocess
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import requests

BASE = "https://fuyao.aicubes.cn"
PRICES = ["open_price", "high_price", "low_price", "close_price", "volume", "turnover"]
KEY = ["thscode", "date_ms"]


def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf8")
    temp.replace(file)


def stamp(date):
    return int(pd.Timestamp(date, tz="Asia/Shanghai").timestamp() * 1000)


class Client:
    def __init__(self):
        self.session = requests.Session()
        self.next_at = 0
        self.calls = 0

    def get(self, url, params=None, fuyao=True):
        key = os.environ.get("FUYAO_API_KEY")
        if fuyao and not key:
            raise RuntimeError("缺少 FUYAO_API_KEY")
        for attempt in range(4):
            time.sleep(max(0, self.next_at - time.time()))
            self.calls += 1
            try:
                response = self.session.get(url, params=params, headers={"X-api-key": key} if fuyao else {}, timeout=60)
            except requests.RequestException:
                if attempt == 3:
                    raise RuntimeError("数据源连接失败，3次重试后停止") from None
                self.next_at = time.time() + 2 * 2 ** attempt
                continue
            finally:
                self.next_at = max(self.next_at, time.time() + 2)
            try:
                body = response.json() if response.status_code != 429 else {}
            except ValueError:
                raise RuntimeError(f"数据源响应非JSON，HTTP {response.status_code}") from None
            if response.status_code == 429 or (fuyao and body.get("code") == 4001):
                if attempt == 3:
                    raise RuntimeError("持续限流，停止本轮并保留进度")
                header = response.headers.get("Retry-After", "0")
                try:
                    wait = float(header) if header.isdigit() else parsedate_to_datetime(header).timestamp() - time.time()
                except (ValueError, TypeError):
                    wait = 0
                self.next_at = time.time() + max(60 * 2 ** attempt, wait)
                continue
            if not response.ok or (fuyao and body.get("code") != 0):
                raise RuntimeError(f"数据源请求失败，HTTP {response.status_code}，code={body.get('code')}")
            return body
        raise RuntimeError("数据源请求失败")

    def api(self, endpoint, params=None):
        return self.get(BASE + endpoint, params)["data"]

    def dump(self, kind, root):
        data = self.api(f"/api/dump/market-dumps/{kind}/download-url")
        # Signed URLs and credentials must never appear in logs or metadata.
        file = root / f"{kind}.parquet"
        temp = file.with_suffix(".parquet.tmp")
        time.sleep(max(0, self.next_at - time.time()))
        try:
            with self.session.get(data["presigned_url"], stream=True, timeout=60) as response:
                if not response.ok:
                    raise RuntimeError(f"批量文件下载失败 HTTP {response.status_code}")
                with temp.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
            pq.read_schema(temp)
            temp.replace(file)
        except requests.RequestException:
            raise RuntimeError("批量文件下载中断，保留原文件") from None
        finally:
            self.next_at = time.time() + 2
        return file


def read_window(file, dates):
    frame = pq.read_table(file, filters=[("date_ms", ">=", stamp(dates[0])), ("date_ms", "<=", stamp(dates[-1]))]).to_pandas()
    if frame.duplicated(KEY).any():
        raise ValueError("同一批数据包含重复股票日期")
    if not frame.empty:
        if not frame.date_ms.isin([stamp(date) for date in dates]).all():
            raise ValueError("日线含非交易日或非北京时间零点记录")
        if not ((frame.currency == "CNY") & (frame.interval == "1d") & (frame.adjusted == "none")).all():
            raise ValueError("批量日线单位或复权口径不符")
        if not np.isfinite(frame[PRICES].to_numpy(dtype=float)).all():
            raise ValueError("日线缺少有效OHLC/成交量额")
        valid = ((frame.low_price > 0) & (frame.volume > 0) & (frame.turnover > 0) &
                 (frame.high_price >= frame[["open_price", "close_price", "low_price"]].max(axis=1)) &
                 (frame.low_price <= frame[["open_price", "close_price"]].min(axis=1)))
        if not valid.all():
            raise ValueError("日线OHLC/成交量额校验失败")
    return frame


def merge_raw(previous, incoming):
    # Replace only matching raw keys; adjusted data is never accepted here.
    return pd.concat([previous, incoming], ignore_index=True).drop_duplicates(KEY, keep="last").sort_values(KEY).reset_index(drop=True)


def audit(frame, catalog, dates, listings, suspensions, pending):
    required = set(dates)
    available = {}
    for code, group in frame.groupby("thscode"):
        available[code] = set(pd.to_datetime(group.date_ms, unit="ms", utc=True).dt.tz_convert("Asia/Shanghai").dt.strftime("%Y%m%d"))
    result = {"startDate": dates[0], "endDate": dates[-1], "total": len(catalog), "complete30": 0,
              "records": len(frame), "explained": [], "missing": [], "ready": False,
              "provider": "fuyao", "adjustment": "none", "volumeUnit": "shares", "amountUnit": "CNY"}
    for stock in catalog:
        code = stock["thscode"]
        missing = sorted(required - available.get(code, set()))
        if not missing:
            result["complete30"] += 1
        listing = (stock.get("list_date") or listings.get(code) or "").replace("-", "")
        for date in missing:
            reason = None
            if listing and date < listing:
                reason = "上市前"
            elif code in pending and not available.get(code):
                reason = "尚未上市"
            else:
                for item in suspensions.get(date, []):
                    start = (item.get("SUSPEND_START_TIME") or "").replace("-", "")[:8]
                    end = (item.get("SUSPEND_END_TIME") or "99991231").replace("-", "")[:8]
                    if (item.get("SECUCODE") == code and item.get("SUSPEND_EXPIRE") in ("连续停牌", "停牌一天")
                            and start and start <= date <= end):
                        reason = "全天停牌"
                        break
            result["explained" if reason else "missing"].append({"code": code, "date": date, "reason": reason or "无依据的缺日"})
    result["ready"] = not result["missing"]
    result["explainedStocks"] = len({row["code"] for row in result["explained"]})
    result["missingStocks"] = len({row["code"] for row in result["missing"]})
    return result


def collect(root, dates, run_date):
    root.mkdir(parents=True, exist_ok=True)
    atomic_json(root / "coverage.json", {"runDate": run_date, "startDate": dates[0], "endDate": dates[-1], "ready": False, "status": "collecting"})
    client = Client()
    catalog = []
    for offset in range(0, 100000, 10000):
        page = client.api("/api/meta/tickers/list", {"asset_type": "a-share", "limit": 10000, "offset": offset})
        catalog.extend(page["item"])
        if len(page["item"]) < 10000:
            break
    else:
        raise RuntimeError("代码表分页异常")
    if not catalog or len({s["thscode"] for s in catalog}) != len(catalog):
        raise RuntimeError("代码表为空或含重复代码")
    atomic_json(root / f"catalog-{run_date}.json", {"item": catalog, "timestamp": page.get("timestamp")})

    file = root / "a-share-daily-unadjusted.parquet"
    full = root / "daily-k.parquet"
    if not full.exists():
        legacy = Path("dist-web/data/fuyao/daily-k-full.parquet")
        if legacy.exists(): full = legacy
    progress = root / "raw-progress.parquet"
    frame = read_window(file, dates) if file.exists() else read_window(full, dates) if full.exists() else pd.DataFrame()
    if progress.exists():
        frame = merge_raw(frame, read_window(progress, dates))
    oldest = int(frame.date_ms.min()) if not frame.empty else None
    latest = int(frame.date_ms.max()) if not frame.empty else None
    download = "reused"
    if oldest is None or oldest > stamp(dates[0]) or latest < stamp(dates[-10]):
        download = "daily-k"
        frame = read_window(client.dump(download, root), dates)
    elif latest < stamp(dates[-1]):
        download = "daily-k-10d"
        frame = merge_raw(frame, read_window(client.dump(download, root), dates))
    frame = frame[frame.thscode.isin({s["thscode"] for s in catalog})].reset_index(drop=True)
    if frame.empty or int(frame.date_ms.max()) < stamp(dates[-1]):
        raise RuntimeError("上游批量日线尚未更新到截止日，禁止把过期数据标记成功")

    # Preserve validated raw progress even when evidence or remaining gaps fail.
    frame.to_parquet(progress.with_suffix(".parquet.tmp"), index=False)
    progress.with_suffix(".parquet.tmp").replace(progress)
    listings_file = root / f"listings-{run_date}.json"
    if not listings_file.exists():
        cli = Path(os.environ.get("IWENCAI_SKILL_CLI", "~/.codex/skills/hithink-market-query/scripts/cli.py")).expanduser()
        result = subprocess.run([os.environ.get("PYTHON_BIN", "python3"), str(cli), "--query", "A股股票，上市日期", "--limit", "10000"], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("问财上市日期查询失败")
        listing_data = json.loads(result.stdout)
        codes = {r.get("股票代码") for r in listing_data.get("datas", [])}
        if not listing_data.get("success") or not codes or None in codes or len(codes) != listing_data.get("code_count") or listing_data.get("has_more"):
            raise RuntimeError("问财上市日期名单不完整")
        atomic_json(listings_file, listing_data)
    listings = {r["股票代码"]: str(r.get("上市日期") or "") for r in json.loads(listings_file.read_text())["datas"]}
    initial = audit(frame, catalog, dates, listings, {}, set())
    suspensions = {}
    for date in sorted({r["date"] for r in initial["missing"]}):
        evidence = root / f"suspensions-{date}.json"
        if not evidence.exists():
            day = f"{date[:4]}-{date[4:6]}-{date[6:]}"
            body = client.get("https://datacenter-web.eastmoney.com/api/data/v1/get", {
                "reportName": "RPT_CUSTOM_SUSPEND_DATA_INTERFACE", "columns": "ALL", "pageSize": 500,
                "pageNumber": 1, "source": "WEB", "client": "WEB", "filter": f'(MARKET="全部")(DATETIME=\'{day}\')'
            }, fuyao=False)
            if not body.get("success") or not body.get("result") or body["result"]["pages"] > 1:
                raise RuntimeError(f"{date} 停牌证据不可用或需分页")
            atomic_json(evidence, body)
        suspensions[date] = json.loads(evidence.read_text())["result"]["data"]
    interim = audit(frame, catalog, dates, listings, suspensions, set())
    pending = set()
    unknown = {r["code"] for r in interim["missing"] if r["code"] not in listings}
    if unknown:
        for market in ("sh_sz", "bj"):
            for status in ("awaiting_listing", "upcoming", "subscribable"):
                evidence = root / f"ipo-{run_date}-{market}-{status}.json"
                if not evidence.exists():
                    data = client.api("/api/a-share/ipo/calendar-list", {"market": market, "status": status})
                    atomic_json(evidence, data)
                data = json.loads(evidence.read_text())
                pending.update(r["thscode"] for r in data["item"] if not r.get("listing_date") or r["listing_date"].replace("-", "") > dates[-1])
    report = audit(frame, catalog, dates, listings, suspensions, pending)
    report.update({"runDate": run_date, "fetchedAt": datetime.now().astimezone().isoformat(), "download": download, "requests": client.calls,
                   "evidenceSources": ["fuyao catalog/daily-k/ipo", "iwencai listing dates", "eastmoney daily suspensions"]})
    atomic_json(root / "coverage.json", report)
    print(json.dumps({k: v for k, v in report.items() if k not in ("explained", "missing")}, ensure_ascii=False), flush=True)
    if not report["ready"]:
        raise RuntimeError(f"全A股日线校验失败：{report['missingStocks']}只股票存在无依据缺日，保留原缓存及本轮进度")
    if file.exists():
        shutil.copyfile(file, file.with_suffix(".parquet.bak"))
    shutil.copyfile(progress, file.with_suffix(".parquet.tmp"))
    file.with_suffix(".parquet.tmp").replace(file)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dates", required=True)
    parser.add_argument("--run-date", required=True)
    parser.add_argument("--root", default="data/a-share")
    args = parser.parse_args()
    root = Path(args.root)
    try:
        collect(root, args.dates.split(","), args.run_date)
    except Exception as error:
        # Never leave a previous run's success as the current collection status.
        report = json.loads((root / "coverage.json").read_text()) if (root / "coverage.json").exists() else {}
        report.update({"ready": False, "status": "failed", "error": str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__})
        atomic_json(root / "coverage.json", report)
        raise SystemExit(report["error"]) from None
