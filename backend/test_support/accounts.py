# -*- coding: utf-8 -*-
"""Pure account fixtures for tests; these helpers never read app config."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def create_test_user(connection, username="test-user", password_hash="test-password-hash"):
    """Insert and return a deterministic, active test user."""
    now = _utc_now()
    cursor = connection.execute(
        """
        INSERT INTO users (
            username, username_key, password_hash, is_active,
            password_changed_at, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?)
        """,
        (username, username.casefold(), password_hash, now, now, now),
    )
    return {
        "id": cursor.lastrowid,
        "username": username,
        "username_key": username.casefold(),
        "created_at": now,
    }


def issue_test_session(connection, user_id, token="test-session-token", expires_in_days=30):
    """Insert and return a deterministic server-side test session."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires_at = (now + timedelta(days=expires_in_days)).isoformat()
    now_text = now.isoformat()
    cursor = connection.execute(
        """
        INSERT INTO auth_sessions (
            user_id, token_hash, created_at, last_seen_at, absolute_expires_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, hashlib.sha256(token.encode("utf-8")).hexdigest(), now_text, now_text, expires_at),
    )
    return {
        "id": cursor.lastrowid,
        "token": token,
        "absolute_expires_at": expires_at,
    }


def csrf_headers(token="test-csrf-token"):
    """Return the request headers used by CSRF-protected test requests."""
    return {"X-CSRF-Token": token}
