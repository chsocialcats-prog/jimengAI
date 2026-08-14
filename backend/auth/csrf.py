"""Signed double-submit CSRF tokens with optional session binding."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

_LIFETIME = timedelta(minutes=30)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_csrf_token(signing_keys, *, session_id: int | None = None, purpose: str | None = None, now: datetime | None = None) -> str:
    current = now or _now()
    payload = {"v": 1, "n": _b64(secrets.token_bytes(32)), "iat": int(current.timestamp()), "p": purpose or ("session" if session_id is not None else "anonymous"), "sid": session_id}
    encoded = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64(hmac.new(bytes(signing_keys[0]), encoded.encode("ascii"), hashlib.sha256).digest())
    return encoded + "." + signature


def verify_csrf(cookie_token: str | None, header_token: str | None, signing_keys, *, session_id: int | None = None, purpose: str | None = None, now: datetime | None = None) -> bool:
    if not isinstance(cookie_token, str) or not isinstance(header_token, str) or not hmac.compare_digest(cookie_token, header_token):
        return False
    try:
        encoded, signature = header_token.split(".", 1)
        if not any(hmac.compare_digest(_b64(hmac.new(bytes(key), encoded.encode("ascii"), hashlib.sha256).digest()), signature) for key in signing_keys):
            return False
        payload = json.loads(_unb64(encoded))
        issued_at = datetime.fromtimestamp(payload["iat"], timezone.utc)
        expected_purpose = purpose or ("session" if session_id is not None else "anonymous")
        current = now or _now()
        return (
            payload.get("v") == 1
            and payload.get("p") == expected_purpose
            and payload.get("sid") == session_id
            and issued_at <= current
            and current - issued_at <= _LIFETIME
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
        return False


def is_unsafe_method(method: str) -> bool:
    return method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
