"""pindou 应用入口：静态前端 + AI 接口（密钥与模型调用只在服务端）。"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .api import router
from .ark import AiError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)


@app.get("/healthz")
def healthz():
    """平台健康检查（portal 直连本机端口探测）。"""
    return {"ok": True, "app": config.APP_ID}


@app.middleware("http")
async def headers_mw(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    return resp


@app.exception_handler(AiError)
async def ai_error_handler(request: Request, exc: AiError):
    status = {"input": 400, "quota": 429, "busy": 429, "config": 503, "auth": 502,
              "network": 502, "upstream": 502, "parse": 502}.get(exc.kind, 500)
    return JSONResponse({"error": {"kind": exc.kind, "message": exc.message}}, status_code=status)


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return JSONResponse({"error": {"kind": "http", "message": exc.detail}},
                        status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": {"kind": "input", "message": "请求参数不合法（描述过长或缺失）"}}, status_code=400)


_frontend = config.frontend_dir()
if _frontend.is_dir():
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="static")
