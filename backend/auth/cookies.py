"""Response cookie helpers for auth and CSRF state."""

from __future__ import annotations

from datetime import datetime, timezone

from .types import IssuedSession

SESSION_COOKIE_NAME = "neko_session"
CSRF_COOKIE_NAME = "neko_csrf"


def _session_cookie_max_age(issued: IssuedSession) -> int:
    expires_at = datetime.fromisoformat(issued.absolute_expires_at.replace("Z", "+00:00"))
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))


def apply_auth_cookies(response, issued: IssuedSession, csrf_token: str, *, secure: bool) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        issued.token,
        max_age=_session_cookie_max_age(issued),
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
    response.set_cookie(CSRF_COOKIE_NAME, csrf_token, httponly=False, samesite="lax", secure=secure, path="/")
    set_no_store(response)


def clear_auth_cookies(response, *, secure: bool) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=secure, httponly=True, samesite="lax")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/", secure=secure, httponly=False, samesite="lax")
    set_no_store(response)


def set_no_store(response) -> None:
    response.headers["Cache-Control"] = "no-store"
