# -*- coding: utf-8 -*-
"""Idempotent account-schema migration with legacy SQLite compatibility."""

from __future__ import annotations

import sqlite3


ACCOUNT_SCHEMA_VERSION = 8
ACCOUNT_MIGRATION_STATE_KEY = "account_migration_state"
_VALID_MIGRATION_STATES = {"unclaimed", "needs_secret_cleanup", "complete"}


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone() is not None


def _ensure_column(
    connection: sqlite3.Connection, table_name: str, column_name: str, ddl: str
) -> None:
    if not _table_exists(connection, table_name):
        return
    columns = {
        row[1] for row in connection.execute(f"PRAGMA table_info({table_name})")
    }
    if column_name not in columns:
        connection.execute(ddl)


def _create_account_tables(connection: sqlite3.Connection) -> None:
    """Create account tables without committing the caller's transaction."""
    statements = (
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            username_key TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            role TEXT NOT NULL DEFAULT 'user',
            password_changed_at TEXT NOT NULL,
            avatar_url TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_key ON users(username_key)",
        """
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            absolute_expires_at TEXT NOT NULL,
            revoked_at TEXT
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)",
        """
        CREATE TABLE IF NOT EXISTS user_ai_settings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            deepseek_config TEXT NOT NULL DEFAULT '{}',
            generation_config TEXT NOT NULL DEFAULT '{}',
            api_key_ciphertext TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_ai_providers (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            provider_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            protocol TEXT NOT NULL DEFAULT 'openai-completions',
            model TEXT NOT NULL,
            models_json TEXT NOT NULL DEFAULT '[]',
            timeout_seconds INTEGER NOT NULL DEFAULT 60,
            is_active INTEGER NOT NULL DEFAULT 0,
            api_key_ciphertext TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, provider_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_user_ai_providers_user_active ON user_ai_providers(user_id, is_active)",
        """
        CREATE TABLE IF NOT EXISTS daily_checkins (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            checkin_date TEXT NOT NULL,
            checked_in_at TEXT NOT NULL,
            fortune_json TEXT NOT NULL DEFAULT '',
            streak_days INTEGER NOT NULL DEFAULT 0,
            points_awarded INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (user_id, checkin_date)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date DESC)",
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL DEFAULT '',
            summary_json TEXT NOT NULL DEFAULT '{}',
            result TEXT NOT NULL DEFAULT 'success',
            request_ip TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_logs(created_at DESC, id DESC)",
        "CREATE INDEX IF NOT EXISTS idx_admin_audit_target_user ON admin_audit_logs(target_user_id, created_at DESC)",
    )
    for statement in statements:
        connection.execute(statement)


def _add_admin_columns(connection: sqlite3.Connection) -> None:
    _ensure_column(
        connection,
        "users",
        "role",
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
    )
    connection.execute(
        "UPDATE users SET role = 'user' WHERE role IS NULL OR role NOT IN ('user', 'station_master')"
    )
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_single_station_master "
        "ON users(role) WHERE role = 'station_master'"
    )


def _add_legacy_ownership_columns(connection: sqlite3.Connection) -> None:
    _ensure_column(
        connection,
        "cards",
        "owner_user_id",
        "ALTER TABLE cards ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT",
    )
    _ensure_column(
        connection,
        "worldbooks",
        "owner_user_id",
        "ALTER TABLE worldbooks ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT",
    )
    _ensure_column(
        connection,
        "works",
        "owner_user_id",
        "ALTER TABLE works ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT",
    )
    _ensure_column(
        connection,
        "conversations",
        "user_id",
        "ALTER TABLE conversations ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT",
    )
    for table_name, column_name in (
        ("cards", "owner_user_id"),
        ("worldbooks", "owner_user_id"),
        ("works", "owner_user_id"),
        ("conversations", "user_id"),
    ):
        if _table_exists(connection, table_name):
            connection.execute(
                f"CREATE INDEX IF NOT EXISTS idx_{table_name}_{column_name} "
                f"ON {table_name}({column_name})"
            )


def _add_user_profile_columns(connection: sqlite3.Connection) -> None:
    _ensure_column(
        connection,
        "users",
        "avatar_url",
        "ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''",
    )


def _add_daily_checkin_columns(connection: sqlite3.Connection) -> None:
    """Extend legacy check-ins without replacing the existing account history."""
    _ensure_column(
        connection,
        "daily_checkins",
        "fortune_json",
        "ALTER TABLE daily_checkins ADD COLUMN fortune_json TEXT NOT NULL DEFAULT ''",
    )
    _ensure_column(
        connection,
        "daily_checkins",
        "streak_days",
        "ALTER TABLE daily_checkins ADD COLUMN streak_days INTEGER NOT NULL DEFAULT 0",
    )
    _ensure_column(
        connection,
        "daily_checkins",
        "points_awarded",
        "ALTER TABLE daily_checkins ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 1",
    )


def _ensure_migration_state(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT value FROM app_meta WHERE key = ?", (ACCOUNT_MIGRATION_STATE_KEY,)
    ).fetchone()
    if row is None:
        connection.execute(
            "INSERT INTO app_meta (key, value) VALUES (?, ?)",
            (ACCOUNT_MIGRATION_STATE_KEY, "unclaimed"),
        )
    elif row[0] not in _VALID_MIGRATION_STATES:
        raise RuntimeError("invalid account migration state")


def migrate_account_schema(connection: sqlite3.Connection) -> None:
    """Create account tables and upgrade legacy ownership columns safely.

    New account tables use their full constraints. Existing application tables
    receive nullable ownership columns because SQLite cannot add a non-null
    column to populated legacy tables without a destructive table rebuild.
    """
    connection.execute("PRAGMA foreign_keys = ON")
    _create_account_tables(connection)
    _add_user_profile_columns(connection)
    _add_admin_columns(connection)
    _add_daily_checkin_columns(connection)
    _add_legacy_ownership_columns(connection)
    _ensure_migration_state(connection)
    current_version = connection.execute("PRAGMA user_version").fetchone()[0]
    if current_version < ACCOUNT_SCHEMA_VERSION:
        connection.execute(f"PRAGMA user_version = {ACCOUNT_SCHEMA_VERSION}")
