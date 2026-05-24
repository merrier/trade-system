#!/usr/bin/env python3
"""Append a Hermes Weixin inbound event to this project's JSONL inbox."""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _string_or_none(value):
    if value is None:
        return None
    return str(value)


def _normalize(payload: dict) -> dict:
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    media = payload.get("media") if isinstance(payload.get("media"), list) else []
    return {
        "platform": "weixin",
        "receivedAt": str(payload.get("receivedAt") or _now_iso()),
        "messageId": _string_or_none(payload.get("messageId")),
        "messageType": str(payload.get("messageType") or "text"),
        "text": str(payload.get("text") or ""),
        "source": {
            "chatId": str(source.get("chatId") or source.get("chat_id") or ""),
            "chatName": _string_or_none(source.get("chatName") or source.get("chat_name")),
            "chatType": str(source.get("chatType") or source.get("chat_type") or "dm"),
            "userId": _string_or_none(source.get("userId") or source.get("user_id")),
            "userName": _string_or_none(source.get("userName") or source.get("user_name")),
            "threadId": _string_or_none(source.get("threadId") or source.get("thread_id")),
        },
        "media": [
            {
                "path": str(item.get("path") or item.get("url") or ""),
                "type": _string_or_none(item.get("type")),
            }
            for item in media
            if isinstance(item, dict) and (item.get("path") or item.get("url"))
        ],
        "rawMessageKeys": [
            str(item)
            for item in payload.get("rawMessageKeys", [])
            if isinstance(item, str)
        ],
    }


def _inbox_path() -> Path:
    configured = os.environ.get("TRADE_SYSTEM_INBOX_DIR", "").strip()
    inbox_dir = Path(configured).expanduser() if configured else PROJECT_ROOT / "data" / "inbox"
    return inbox_dir.resolve() / "weixin.jsonl"


def _append_jsonl(message: dict) -> Path:
    path = _inbox_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    return path


def _post_http(message: dict) -> None:
    url = os.environ.get("TRADE_SYSTEM_INBOX_HTTP_URL", "").strip()
    if not url:
        return
    data = json.dumps(message, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            response.read()
    except (urllib.error.URLError, TimeoutError):
        # File append is the durable path; HTTP fan-out is best effort.
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-path", action="store_true", help="print the JSONL path after appending")
    args = parser.parse_args()

    payload = json.loads(sys.stdin.read() or "{}")
    if not isinstance(payload, dict):
        raise SystemExit("payload must be a JSON object")
    message = _normalize(payload)
    path = _append_jsonl(message)
    _post_http(message)
    if args.print_path:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
