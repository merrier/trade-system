import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

import pandas as pd

spec = importlib.util.spec_from_file_location("collector", Path(__file__).parents[1] / "python/a_share_daily.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def row(date, code="600000.SH", close=10):
    return {"thscode": code, "date_ms": collector.stamp(date), "currency": "CNY", "interval": "1d", "adjusted": "none",
            "open_price": 10, "high_price": 12, "low_price": 9, "close_price": close, "volume": 1000, "turnover": 10000}


class DailyCollectionTests(unittest.TestCase):
    def test_incremental_and_idempotent_merge(self):
        old = pd.DataFrame([row("20261119"), row("20261120")])
        incoming = pd.DataFrame([row("20261120", close=11), row("20261123")])
        merged = collector.merge_raw(old, incoming)
        self.assertEqual(len(merged), 3)
        self.assertEqual(merged.iloc[1].close_price, 11)
        pd.testing.assert_frame_equal(merged, collector.merge_raw(merged, incoming))

    def test_unexplained_gaps_fail_but_listing_and_full_day_suspension_are_evidence(self):
        dates = ["20261119", "20261120", "20261123"]
        frame = pd.DataFrame([row("20261123")])
        stocks = [{"thscode": "600000.SH", "list_date": None}]
        self.assertFalse(collector.audit(frame, stocks, dates, {}, {}, set())["ready"])
        suspension = {"20261120": [{"SECUCODE": "600000.SH", "SUSPEND_START_TIME": "2026-11-20 09:30:00", "SUSPEND_END_TIME": None, "SUSPEND_EXPIRE": "停牌一天"}]}
        report = collector.audit(frame, stocks, dates, {"600000.SH": "20261120"}, suspension, set())
        self.assertTrue(report["ready"])
        self.assertEqual(report["records"], 1)  # No padding or invented candles.
        suspension["20261120"][0]["SUSPEND_EXPIRE"] = "盘中停牌"
        self.assertFalse(collector.audit(frame, stocks, dates, {"600000.SH": "20261120"}, suspension, set())["ready"])

    def test_pending_ipo_does_not_hide_missing_history_for_an_already_traded_stock(self):
        report = collector.audit(pd.DataFrame([row("20261123")]), [{"thscode": "600000.SH"}], ["20261120", "20261123"], {}, {}, {"600000.SH"})
        self.assertFalse(report["ready"])

    def test_rejects_duplicates_adjusted_data_invalid_ohlc_and_wrong_session(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "bars.parquet"
            for rows, dates in [([row("20261123")] * 2, ["20261123"]),
                                ([dict(row("20261123"), adjusted="forward")], ["20261123"]),
                                ([dict(row("20261123"), volume=0)], ["20261123"]),
                                ([dict(row("20261123"), close_price=15)], ["20261123"]),
                                ([row("20261121")], ["20261120", "20261123"])]:
                pd.DataFrame(rows).to_parquet(file)
                with self.assertRaises(ValueError): collector.read_window(file, dates)

    def test_limited_retry_respects_http_and_business_rate_limit(self):
        for status, code in [(429, None), (200, 4001)]:
            client = collector.Client()
            client.session.get = Mock(return_value=Mock(status_code=status, ok=status == 200, headers={"Retry-After": "120"}, json=lambda: {"code": code}))
            with patch.dict("os.environ", {"FUYAO_API_KEY": "test"}), patch.object(collector.time, "time", return_value=0), patch.object(collector.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "持续限流"): client.api("/test")
                self.assertEqual(client.session.get.call_count, 4)
                self.assertEqual([call.args[0] for call in sleep.call_args_list], [0, 120, 120, 240])


if __name__ == "__main__": unittest.main()
