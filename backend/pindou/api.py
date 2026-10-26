"""AI 接口：状态、提示词组装、出图/改图。

访问控制不在本应用：登录、CSRF 由平台网关负责（见仓库 docs/ARCHITECTURE.md）。
"""
from __future__ import annotations

import base64
import logging
import threading
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import ark, config, quota
from .ark import AiError

log = logging.getLogger("pindou.api")
router = APIRouter(prefix="/api/ai")
_slots = threading.BoundedSemaphore(2)      # 同时最多 2 个出图请求，避免一次点很多下烧额度


Preset = Literal["fast", "pro"] | None      # 速度优先 / 精度优先；缺省用 ai.json 的 default_preset


class PlanIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    mode: Literal["generate", "edit"]
    preset: Preset = None


class ImageIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=1500)
    mode: Literal["generate", "edit"]
    preset: Preset = None
    ratio: str = Field(default="1:1", max_length=8)
    image: str | None = Field(default=None, max_length=9_000_000)   # edit 时：data URL


@router.get("/status")
def status():
    st = config.settings()
    return {"enabled": config.api_key() is not None, "remaining": quota.remaining(), "limit": st["daily_limit"],
            "default_preset": st["default_preset"],
            "presets": [{"id": k, "label": v["label"]} for k, v in st["presets"].items()]}


@router.post("/plan")
def make_plan(body: PlanIn):
    """理解用户需求并组装提示词。文本模型不可用时降级为默认模板，不阻塞出图；密钥/配置问题照实报错。"""
    text = body.text.strip()
    if not text:
        raise AiError("input", "请先描述你想要的内容")
    try:
        return ark.plan(text, body.mode, body.preset)
    except AiError as e:
        if e.kind in ("config", "auth"):
            raise
        log.warning("plan fallback: %s %s", e.kind, e.message)
        return ark.fallback_plan(text, body.mode)


@router.post("/image")
def make_image(body: ImageIn):
    source = None
    ratio = body.ratio if body.ratio in ark.SIZES else "1:1"
    if body.mode == "edit":
        if not body.image:
            raise AiError("input", "修改图片需要提供当前图片")
        source = ark.prepare_source(body.image)
        ratio = ark.source_ratio(source)      # 改图时输出比例跟随原图
    if config.api_key() is None:
        raise AiError("config", "AI 功能尚未配置密钥")
    if not _slots.acquire(blocking=False):
        raise AiError("busy", "正在处理其他出图请求，请稍后再试")
    try:
        if not quota.take():
            raise AiError("quota", "今天的 AI 出图次数已用完，明天再来")
        try:
            png, w, h = ark.draw(body.prompt.strip(), ratio, source, body.preset)
        except AiError:
            quota.refund()          # 没出图就不扣次数
            raise
    finally:
        _slots.release()
    log.info("image ok mode=%s preset=%s %dx%d", body.mode, config.preset(body.preset)["id"], w, h)
    return {"image": "data:image/png;base64," + base64.b64encode(png).decode(), "width": w, "height": h,
            "remaining": quota.remaining()}
