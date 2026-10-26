"""每日出图次数上限（按北京时间自然日），计数落在 $APP_DATA/quota.json。"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone

from . import config

_lock = threading.Lock()
CHINA = timezone(timedelta(hours=8))


def _today() -> str:
    return datetime.now(CHINA).date().isoformat()


def _load() -> dict:
    try:
        d = json.loads((config.data_dir() / "quota.json").read_text(encoding="utf-8"))
        if d.get("day") == _today() and isinstance(d.get("used"), int):
            return d
    except (OSError, ValueError, AttributeError):
        pass
    return {"day": _today(), "used": 0}


def _save(d: dict):
    path = config.data_dir() / "quota.json"
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, path)


def remaining() -> int:
    with _lock:
        return max(0, config.settings()["daily_limit"] - _load()["used"])


def take() -> bool:
    """占用一次额度；已用完返回 False。"""
    with _lock:
        d = _load()
        if d["used"] >= config.settings()["daily_limit"]:
            return False
        d["used"] += 1
        _save(d)
        return True


def refund():
    with _lock:
        d = _load()
        d["used"] = max(0, d["used"] - 1)
        _save(d)
