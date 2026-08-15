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
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .auth.account_migration import AccountMigrationService
from .auth.http_security import AuthSecurityMiddleware
from .auth.keyring import AuthKeyring
from .auth.rate_limit import AuthRateLimiter
from .auth.runtime_settings import RuntimeSettings
from .auth.service import AuthService
from .auth.sessions import SessionService
from .auth.errors import SecretKeyUnavailable
from .auth.legacy_config import warn_if_environment_legacy_key
from .config import AUTH_KEY_PATH, CONFIG_PATH
from .database import connect, init_db
from .routers import (
    cards_routes,
    assistant_routes,
    chat_routes,
    conversations_routes,
    daily_checkin_routes,
    imports_routes,
    settings_routes,
    auth_routes,
    uploads_routes,
    works_routes,
    worldbooks_routes,
)
from .services.image_uploads import UPLOAD_DIR

PROJECT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_SOURCE_DIR = PROJECT_DIR / "frontend"
NEXT_FRONTEND_DIR = FRONTEND_SOURCE_DIR / "out"
# The Next UI is statically exported into frontend/out. Falling back to the
# source directory preserves a clear startup failure page if the export is absent.
FRONTEND_DIR = (
    NEXT_FRONTEND_DIR
    if (NEXT_FRONTEND_DIR / "index.html").is_file()
    else FRONTEND_SOURCE_DIR
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动时自动创建数据库。"""
    database_path = init_db()
    app.state.database_path = str(database_path)
    try:
        keyring = AuthKeyring.load(AUTH_KEY_PATH)
    except SecretKeyUnavailable:
        keyring = None
        logger.warning("认证主密钥不可用；认证写操作暂时停用。")
    with connect() as connection:
        AccountMigrationService(connection, keyring).resume_cleanup()
        SessionService(connection).startup_cleanup()
    warn_if_environment_legacy_key(config_path=CONFIG_PATH, environ=os.environ)
    app.state.runtime_settings = RuntimeSettings.from_environ()
    app.state.auth_service = AuthService(connect, keyring, rate_limiter=AuthRateLimiter())
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
        headers=exc.headers,
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
    }


for router in (
    auth_routes.router,
    settings_routes.router,
    daily_checkin_routes.router,
    assistant_routes.router,
    uploads_routes.router,
    cards_routes.router,
    imports_routes.router,
    worldbooks_routes.router,
    works_routes.router,
    conversations_routes.router,
    chat_routes.router,
):
    app.include_router(router)


app.add_middleware(AuthSecurityMiddleware)


UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
