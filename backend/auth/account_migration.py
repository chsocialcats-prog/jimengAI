"""First-account claim of legacy data and recoverable secret cleanup."""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from backend.config import CONFIG_PATH, clear_legacy_config_api_key

from .legacy_config import load_legacy_config
from .types import DEFAULT_ACCOUNT_AVATAR_URL, PublicUser

_STATE_KEY = "account_migration_state"


class MigrationPending(Exception):
    code = "migration_pending"
    message = "旧配置密钥清理尚未完成"


@dataclass(frozen=True)
class ClaimResult:
    user: PublicUser
    legacy_data_claimed: bool


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class AccountMigrationService:
    def __init__(self, connection: sqlite3.Connection, keyring, *, config_path: Path = CONFIG_PATH, environ=None):
        self.connection = connection
        self.keyring = keyring
        self.config_path = Path(config_path)
        self.environ = os.environ if environ is None else environ

    def _state(self) -> str:
        row = self.connection.execute("SELECT value FROM app_meta WHERE key = ?", (_STATE_KEY,)).fetchone()
        return row[0] if row is not None else "unclaimed"

    def claim_for_first_user(self, username: str, username_key: str, password_hash: str) -> ClaimResult:
        legacy = load_legacy_config(config_path=self.config_path, environ=self.environ)
        ciphertext = self.keyring.encrypt(legacy.api_key) if legacy.api_key else ""
        now = _now()
        claimed = False
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            state = self._state()
            if state == "needs_secret_cleanup":
                raise MigrationPending()
            if state not in {"unclaimed", "complete"}:
                raise MigrationPending()
            cursor = self.connection.execute(
                """INSERT INTO users (username, username_key, password_hash, is_active, avatar_url,
                   password_changed_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)""",
                (username, username_key, password_hash, DEFAULT_ACCOUNT_AVATAR_URL, now, now, now),
            )
            user = PublicUser(cursor.lastrowid, username, now, DEFAULT_ACCOUNT_AVATAR_URL)
            if state == "unclaimed":
                for table, owner_column in (("cards", "owner_user_id"), ("worldbooks", "owner_user_id"), ("works", "owner_user_id"), ("conversations", "user_id")):
                    self.connection.execute(f"UPDATE {table} SET {owner_column} = ? WHERE {owner_column} IS NULL", (user.id,))
                deepseek_config = dict(legacy.deepseek)
                deepseek_config.pop("api_key", None)
                self.connection.execute(
                    """INSERT INTO user_ai_settings (user_id, deepseek_config, generation_config,
                       api_key_ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)""",
                    (user.id, json.dumps(deepseek_config, ensure_ascii=False), json.dumps(legacy.generation, ensure_ascii=False), ciphertext, now),
                )
                next_state = "needs_secret_cleanup" if legacy.config_file_has_plaintext_key else "complete"
                self.connection.execute("UPDATE app_meta SET value = ?, updated_at = ? WHERE key = ?", (next_state, now, _STATE_KEY))
                claimed = True
            self.connection.commit()
        except Exception:
            if self.connection.in_transaction:
                self.connection.rollback()
            raise
        if legacy.config_file_has_plaintext_key:
            if not self.resume_cleanup():
                raise MigrationPending()
        return ClaimResult(user, claimed)

    def resume_cleanup(self) -> bool:
        if self.keyring is None:
            return False
        if self._state() != "needs_secret_cleanup":
            return False
        try:
            clear_legacy_config_api_key(config_path=self.config_path)
        except OSError:
            return False
        self.connection.execute("UPDATE app_meta SET value = ?, updated_at = ? WHERE key = ? AND value = ?", ("complete", _now(), _STATE_KEY, "needs_secret_cleanup"))
        self.connection.commit()
        return True
