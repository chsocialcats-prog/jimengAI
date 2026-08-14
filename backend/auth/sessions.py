"""SQLite-backed opaque session management."""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Callable

from .types import AuthContext, IssuedSession, PublicUser

_IDLE_TIMEOUT = timedelta(days=7)
_ABSOLUTE_TIMEOUT = timedelta(days=30)
_REFRESH_INTERVAL = timedelta(minutes=5)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class SessionService:
    def __init__(self, connection: sqlite3.Connection, clock: Callable[[], datetime] = _utc_now):
        self.connection = connection
        self.clock = clock

    def issue(self, user_id: int) -> IssuedSession:
        now = self.clock()
        token = secrets.token_urlsafe(32)
        expires = now + _ABSOLUTE_TIMEOUT
        cursor = self.connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, _hash_token(token), _iso(now), _iso(now), _iso(expires)),
        )
        self.connection.commit()
        return IssuedSession(cursor.lastrowid, token, _iso(expires))

    def authenticate(self, token: str | None) -> AuthContext | None:
        if not isinstance(token, str) or not token:
            return None
        row = self.connection.execute(
            """SELECT auth_sessions.*, users.username, users.created_at AS user_created_at, users.is_active
               FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
               WHERE auth_sessions.token_hash = ?""",
            (_hash_token(token),),
        ).fetchone()
        if row is None or not row["is_active"] or row["revoked_at"] is not None:
            return None
        now = self.clock()
        try:
            expired = (
                now - _parse(row["last_seen_at"]) > _IDLE_TIMEOUT
                or now - _parse(row["created_at"]) >= _ABSOLUTE_TIMEOUT
                or now >= _parse(row["absolute_expires_at"])
            )
        except (TypeError, ValueError):
            expired = True
        if expired:
            self.connection.execute("DELETE FROM auth_sessions WHERE id = ?", (row["id"],))
            self.connection.commit()
            return None
        if now - _parse(row["last_seen_at"]) >= _REFRESH_INTERVAL:
            self.connection.execute("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?", (_iso(now), row["id"]))
            self.connection.commit()
        return AuthContext(PublicUser(row["user_id"], row["username"], row["user_created_at"]), row["id"])

    def revoke_current(self, token: str) -> None:
        self.connection.execute("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", (_iso(self.clock()), _hash_token(token)))
        self.connection.commit()

    def revoke_all_for_user(self, user_id: int) -> None:
        self.connection.execute("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (_iso(self.clock()), user_id))
        self.connection.commit()

    def cleanup_expired(self) -> int:
        now = self.clock()
        rows = self.connection.execute("SELECT id, created_at, last_seen_at, absolute_expires_at FROM auth_sessions").fetchall()
        expired = []
        for row in rows:
            try:
                if (
                    now - _parse(row["last_seen_at"]) > _IDLE_TIMEOUT
                    or now - _parse(row["created_at"]) >= _ABSOLUTE_TIMEOUT
                    or now >= _parse(row["absolute_expires_at"])
                ):
                    expired.append(row["id"])
            except (TypeError, ValueError):
                expired.append(row["id"])
        if expired:
            self.connection.executemany("DELETE FROM auth_sessions WHERE id = ?", ((item,) for item in expired))
            self.connection.commit()
        return len(expired)

    startup_cleanup = cleanup_expired
