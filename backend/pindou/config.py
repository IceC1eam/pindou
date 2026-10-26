"""运行环境与 AI 设置。

密钥只走环境变量 ARK_API_KEY（服务器上由 systemd 的 EnvironmentFile 注入，见 scripts/deploy.sh secret），
不进仓库、不落在应用数据目录。模型型号等可选覆盖放在 $APP_DATA/ai.json。
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

APP_ID = "pindou"

# 两档模型：每档 = 文本模型（理解需求、组装提示词）+ 图像模型（出图/改图）。型号以方舟控制台为准，可在 ai.json 覆盖。
PRESETS = {
    "fast": {"label": "速度优先", "text_model": "deepseek-v4-1-flash-261017",
             "image_model": "doubao-seedream-5-0-flash-260915"},
    "pro": {"label": "精度优先", "text_model": "doubao-seed-2-1-pro-260915",
            "image_model": "doubao-seedream-5-0-pro-260628"},
}
DEFAULTS = {
    "base_url": "https://ark.cn-beijing.volces.com/api/v3",
    "daily_limit": 40,              # 每天最多出图次数（出图才计费，提示词组装不计）
    "default_preset": "fast",
}
MODEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")


def data_dir() -> Path:
    """应用私有数据目录（APP_DATA，平台为每个应用单独创建，权限 700）。"""
    d = Path(os.environ.get("APP_DATA", "./data")).resolve()
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    return d


def frontend_dir() -> Path:
    default = Path(__file__).resolve().parents[2] / "public"
    return Path(os.environ.get("APP_FRONTEND", default))


def settings() -> dict:
    s = dict(DEFAULTS)
    s["presets"] = {k: dict(v) for k, v in PRESETS.items()}
    try:
        raw = json.loads((data_dir() / "ai.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    for k in ("base_url", "daily_limit", "default_preset"):
        if isinstance(raw.get(k), type(DEFAULTS[k])) and raw[k] != "":
            s[k] = raw[k]
    over = raw.get("presets") if isinstance(raw.get("presets"), dict) else {}
    for pid, o in over.items():
        if pid in s["presets"] and isinstance(o, dict):
            for k in ("text_model", "image_model"):
                if isinstance(o.get(k), str) and MODEL_RE.fullmatch(o[k].strip()):
                    s["presets"][pid][k] = o[k].strip()
    if s["default_preset"] not in s["presets"]:
        s["default_preset"] = DEFAULTS["default_preset"]
    host = urlsplit(s["base_url"]).hostname or ""
    if not s["base_url"].startswith("https://") or not (host == "volces.com" or host.endswith(".volces.com")):
        s["base_url"] = DEFAULTS["base_url"]   # 密钥只会发往火山引擎，配置写错也不会外泄
    s["daily_limit"] = max(0, min(int(s["daily_limit"]), 1000))
    return s


def preset(name: str | None = None) -> dict:
    """返回某一档的 {id, label, text_model, image_model}；名称无效则用默认档。"""
    st = settings()
    pid = name if name in st["presets"] else st["default_preset"]
    return {"id": pid, **st["presets"][pid]}


def api_key() -> str | None:
    return os.environ.get("ARK_API_KEY", "").strip() or None
