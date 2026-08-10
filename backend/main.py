# -*- coding: utf-8 -*-
"""FastAPI 入口。

W2+W3 提供：
- 自动初始化 SQLite
- 配置读写、作品/角色卡/世界书 CRUD
- 冒险会话、状态、骰子判定、存档读档
- DeepSeek 流式对话，无 Key 时自动使用 mock 模式
- 前端静态页面挂载
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import has_api_key
from .database import init_db
from .routers import (
    cards_routes,
    chat_routes,
    conversations_routes,
    imports_routes,
    settings_routes,
    works_routes,
    worldbooks_routes,
)

FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动时自动创建数据库。"""
    database_path = init_db()
    app.state.database_path = str(database_path)
    app.state.stop_events = {}
    yield


app = FastAPI(
    title="AI 对话冒险平台",
    description="个人自用纯文字 AI 对话冒险本地服务",
    version="0.2.0",
    lifespan=lifespan,
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """把业务错误统一为契约中的 error 结构。"""
    detail = exc.detail
    if not isinstance(detail, dict):
        detail = {"code": "error", "message": str(detail)}
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
):
    """请求体校验失败时返回统一错误结构。"""
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "请求参数校验失败",
            }
        },
    )


@app.get("/api/health", summary="健康检查")
def health_check():
    """返回服务、数据库和 AI 接入状态。"""
    database_ready = Path(app.state.database_path).exists()
    return {
        "status": "ok",
        "service": "ai-adventure",
        "database": "initialized" if database_ready else "missing",
        "ai_enabled": has_api_key(),
    }


for router in (
    settings_routes.router,
    cards_routes.router,
    imports_routes.router,
    worldbooks_routes.router,
    works_routes.router,
    conversations_routes.router,
    chat_routes.router,
):
    app.include_router(router)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
