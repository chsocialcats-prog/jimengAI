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

    def replace_provider_ciphertext(self, user_id: int, provider_id: str, ciphertext: str) -> None:
        with _connection_scope(self.connection_or_factory) as connection:
            connection.execute(
                """UPDATE user_ai_providers
                   SET api_key_ciphertext = ?, updated_at = ?
                   WHERE user_id = ? AND provider_id = ?""",
                (ciphertext, _now(), user_id, provider_id),
            )
            connection.commit()

    def list_providers(self, user_id: int) -> list[dict]:
        with _connection_scope(self.connection_or_factory) as connection:
            rows = connection.execute(
                """SELECT provider_id, display_name, base_url, protocol, model,
                   models_json, timeout_seconds, is_active, api_key_ciphertext,
                   created_at, updated_at
                   FROM user_ai_providers WHERE user_id = ?
                   ORDER BY is_active DESC, created_at ASC, provider_id ASC""",
                (user_id,),
            ).fetchall()
            return [
                {
                    "provider_id": row["provider_id"],
                    "display_name": row["display_name"],
                    "base_url": row["base_url"],
                    "protocol": row["protocol"],
                    "model": row["model"],
                    "models": self._list_json(row["models_json"]),
                    "timeout_seconds": row["timeout_seconds"],
                    "is_active": bool(row["is_active"]),
                    "api_key_ciphertext": row["api_key_ciphertext"] or "",
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
                for row in rows
            ]

    def save_provider(self, user_id: int, provider: dict) -> None:
        now = _now()
        with _connection_scope(self.connection_or_factory) as connection:
            if provider.get("is_active"):
                connection.execute(
                    "UPDATE user_ai_providers SET is_active = 0, updated_at = ? WHERE user_id = ?",
                    (now, user_id),
                )
            connection.execute(
                """INSERT INTO user_ai_providers (
                    user_id, provider_id, display_name, base_url, protocol, model,
                    models_json, timeout_seconds, is_active, api_key_ciphertext,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, provider_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    base_url = excluded.base_url,
                    protocol = excluded.protocol,
                    model = excluded.model,
                    models_json = excluded.models_json,
                    timeout_seconds = excluded.timeout_seconds,
                    is_active = excluded.is_active,
                    api_key_ciphertext = excluded.api_key_ciphertext,
                    updated_at = excluded.updated_at""",
                (
                    user_id,
                    provider["provider_id"],
                    provider["display_name"],
                    provider["base_url"],
                    provider["protocol"],
                    provider["model"],
                    json.dumps(provider.get("models", []), ensure_ascii=False, separators=(",", ":")),
                    provider["timeout_seconds"],
                    int(bool(provider.get("is_active"))),
                    provider.get("api_key_ciphertext", ""),
                    provider.get("created_at") or now,
                    now,
                ),
            )
            connection.commit()

    def delete_provider(self, user_id: int, provider_id: str) -> None:
        with _connection_scope(self.connection_or_factory) as connection:
            connection.execute(
                "DELETE FROM user_ai_providers WHERE user_id = ? AND provider_id = ?",
                (user_id, provider_id),
            )
            connection.commit()

    @staticmethod
    def _list_json(value) -> list[str]:
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return []
        return [item for item in parsed if isinstance(item, str)] if isinstance(parsed, list) else []

    @staticmethod
    def _json(value) -> dict:
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
