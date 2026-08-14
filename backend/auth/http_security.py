"""Application-wide optional auth, CSRF, origin and migration write gate."""

from __future__ import annotations

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .cookies import clear_auth_cookies, set_no_store
from .csrf import is_unsafe_method, verify_csrf
from .dependencies import optional_auth
from .origin import OriginPolicy


class AuthSecurityMiddleware(BaseHTTPMiddleware):
    @staticmethod
    def _reject(request, settings, status_code, code, message):
        response = JSONResponse(
            status_code=status_code,
            content={"error": {"code": code, "message": message}},
            headers={"Cache-Control": "no-store"},
        )
        if getattr(request.state, "invalid_session", False):
            clear_auth_cookies(response, secure=settings.cookie_secure)
        return response

    async def dispatch(self, request, call_next):
        auth = optional_auth(request)
        settings = request.app.state.runtime_settings
        if is_unsafe_method(request.method):
            if request.app.state.auth_service.migration_state() == "needs_secret_cleanup":
                return self._reject(request, settings, 503, "migration_pending", "旧配置密钥清理尚未完成")
            if getattr(request.app.state.auth_service, "keyring", None) is None:
                return self._reject(request, settings, 503, "secret_key_unavailable", "加密主密钥不可用")
            origin = settings.public_origin or str(request.base_url).rstrip("/")
            policy = OriginPolicy(origin)
            if not policy.is_allowed(method=request.method, origin=request.headers.get("origin"), referer=request.headers.get("referer"), sec_fetch_site=request.headers.get("sec-fetch-site")):
                return self._reject(request, settings, 403, "csrf_failed", "请求安全校验失败")
            if not verify_csrf(request.cookies.get("neko_csrf"), request.headers.get("x-csrf-token"), request.app.state.auth_service.keyring.csrf_signing_keys(), session_id=auth.session_id if auth else None):
                return self._reject(request, settings, 403, "csrf_failed", "请求安全校验失败")
        response = await call_next(request)
        if getattr(request.state, "invalid_session", False):
            clear_auth_cookies(response, secure=settings.cookie_secure)
        if auth is not None:
            set_no_store(response)
        return response
