"""Persistence boundary for one user's encrypted AI settings."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def _connection_scope(source):
    if not isinstance(source, sqlite3.Connection) and callable(source):
        connection = source()
        try:
            yield connection
        finally:
            connection.close()
    else:
        yield source


class UserAISettingsRepository:
    def __init__(self, connection_or_factory):
        self.connection_or_factory = connection_or_factory

    def get(self, user_id: int) -> dict | None:
        with _connection_scope(self.connection_or_factory) as connection:
            row = connection.execute(
                "SELECT user_id, deepseek_config, generation_config, api_key_ciphertext "
                "FROM user_ai_settings WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if row is None:
                return None
            return {
                "user_id": row["user_id"],
                "deepseek_config": self._json(row["deepseek_config"]),
                "generation_config": self._json(row["generation_config"]),
                "api_key_ciphertext": row["api_key_ciphertext"] or "",
            }

    def save(self, user_id: int, *, deepseek_config: dict, generation_config: dict, api_key_ciphertext: str) -> None:
        with _connection_scope(self.connection_or_factory) as connection:
            connection.execute(
                """INSERT INTO user_ai_settings (
                    user_id, deepseek_config, generation_config, api_key_ciphertext, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    deepseek_config = excluded.deepseek_config,
                    generation_config = excluded.generation_config,
                    api_key_ciphertext = excluded.api_key_ciphertext,
                    updated_at = excluded.updated_at""",
                (
                    user_id,
                    json.dumps(deepseek_config, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(generation_config, ensure_ascii=False, separators=(",", ":")),
                    api_key_ciphertext,
                    _now(),
                ),
            )
            connection.commit()

    def replace_ciphertext(self, user_id: int, ciphertext: str) -> None:
        with _connection_scope(self.connection_or_factory) as connection:
            connection.execute(
                "UPDATE user_ai_settings SET api_key_ciphertext = ?, updated_at = ? WHERE user_id = ?",
                (ciphertext, _now(), user_id),
            )
            connection.commit()

    @staticmethod
    def _json(value) -> dict:
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
