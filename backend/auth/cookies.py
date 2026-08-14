"""Response cookie helpers for auth and CSRF state."""

from __future__ import annotations

from .types import IssuedSession

SESSION_COOKIE_NAME = "neko_session"
CSRF_COOKIE_NAME = "neko_csrf"


def apply_auth_cookies(response, issued: IssuedSession, csrf_token: str, *, secure: bool) -> None:
    response.set_cookie(SESSION_COOKIE_NAME, issued.token, httponly=True, samesite="lax", secure=secure, path="/")
    response.set_cookie(CSRF_COOKIE_NAME, csrf_token, httponly=False, samesite="lax", secure=secure, path="/")
    set_no_store(response)


def clear_auth_cookies(response, *, secure: bool) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=secure, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", secure=secure, httponly=False, samesite="lax")
    set_no_store(response)


def set_no_store(response) -> None:
    response.headers["Cache-Control"] = "no-store"
