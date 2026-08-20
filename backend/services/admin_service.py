"""Station-master operations over account and audit data.

The service deliberately returns public account fields only.  Password hashes,
session token hashes, and encrypted provider secrets never cross this boundary.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .. import database
from ..auth.passwords import hash_password, validate_password
from ..auth.types import ROLE_STATION_MASTER


class AdminServiceError(ValueError):
    status_code = 400
    code = "admin_operation_failed"
    message = "站长操作失败"

    def __init__(self, message=None):
        super().__init__(message or self.message)
        self.message = message or self.message


class AdminUserNotFound(AdminServiceError):
    status_code = 404
    code = "user_not_found"
    message = "用户不存在"


class AdminSelfActionForbidden(AdminServiceError):
    status_code = 409
    code = "self_action_forbidden"
    message = "不能对当前站长账户执行此操作"


class LastStationMasterError(AdminServiceError):
    status_code = 409
    code = "last_station_master"
    message = "不能让系统失去最后一个站长"


class StationMasterExists(AdminServiceError):
    status_code = 409
    code = "station_master_exists"
    message = "系统已经存在站长"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@contextmanager
def _connection_scope(source):
    if isinstance(source, sqlite3.Connection):
        yield source
        return
    connection = source()
    try:
        yield connection
    finally:
        connection.close()


def record_admin_audit(
    connection: sqlite3.Connection,
    *,
    actor_user_id=None,
    target_user_id=None,
    action: str,
    target_type: str,
    target_id="",
    summary=None,
    result="success",
    request_ip="",
):
    """Write a redacted audit event inside the caller's transaction."""
    safe_summary = summary if isinstance(summary, dict) else {}
    connection.execute(
        """
        INSERT INTO admin_audit_logs (
            actor_user_id, target_user_id, action, target_type, target_id,
            summary_json, result, request_ip, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            actor_user_id,
            target_user_id,
            action,
            target_type,
            str(target_id or ""),
            database.json_dumps(safe_summary),
            result,
            str(request_ip or "")[:128],
            _now(),
        ),
    )


def _public_user(row, ai_info=None):
    if row is None:
        return None
    keys = row.keys()
    return {
        "id": row["id"],
        "username": row["username"],
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "is_active": bool(row["is_active"]),
        "role": row["role"] if "role" in keys and row["role"] else "user",
        "last_seen_at": row["last_seen_at"] if "last_seen_at" in keys else None,
        "counts": {
            "cards": int(row["card_count"] or 0) if "card_count" in keys else 0,
            "worldbooks": int(row["worldbook_count"] or 0) if "worldbook_count" in keys else 0,
            "works": int(row["work_count"] or 0) if "work_count" in keys else 0,
            "conversations": int(row["conversation_count"] or 0) if "conversation_count" in keys else 0,
        },
        "ai": ai_info or {
            "api_key_set": bool(row["api_key_set"]) if "api_key_set" in keys else False,
            "provider_count": int(row["provider_count"] or 0) if "provider_count" in keys else 0,
            "active_provider_count": int(row["active_provider_count"] or 0) if "active_provider_count" in keys else 0,
            "providers": [],
            "legacy": None,
        },
    }


class AdminService:
    def __init__(self, connection_or_factory):
        self.connection_or_factory = connection_or_factory

    @staticmethod
    def _ai_info(connection, user_id, row):
        providers = connection.execute(
            """
            SELECT provider_id, display_name, base_url, protocol, model,
                   models_json, timeout_seconds, is_active, api_key_ciphertext
            FROM user_ai_providers
            WHERE user_id = ?
            ORDER BY is_active DESC, provider_id ASC
            """,
            (user_id,),
        ).fetchall()
        safe_providers = []
        for provider in providers:
            models = database.json_loads(provider["models_json"], [])
            safe_providers.append(
                {
                    "provider_id": provider["provider_id"],
                    "display_name": provider["display_name"],
                    "base_url": provider["base_url"],
                    "protocol": provider["protocol"],
                    "model": provider["model"],
                    "models": models if isinstance(models, list) else [],
                    "timeout_seconds": provider["timeout_seconds"],
                    "is_active": bool(provider["is_active"]),
                    "configured": bool(str(provider["api_key_ciphertext"] or "").strip()),
                }
            )
        legacy = connection.execute(
            "SELECT deepseek_config FROM user_ai_settings WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        legacy_config = database.json_loads(legacy["deepseek_config"], {}) if legacy else {}
        legacy_info = None
        if isinstance(legacy_config, dict) and any(
            key in legacy_config for key in ("base_url", "model", "timeout_seconds")
        ):
            legacy_info = {
                "provider_id": "deepseek",
                "display_name": "DeepSeek",
                "base_url": legacy_config.get("base_url", ""),
                "protocol": "openai-completions",
                "model": legacy_config.get("model", ""),
                "timeout_seconds": legacy_config.get("timeout_seconds"),
                "configured": bool(row["api_key_set"]) if "api_key_set" in row.keys() else False,
            }
        return {
            "api_key_set": bool(row["api_key_set"]) if "api_key_set" in row.keys() else False,
            "provider_count": int(row["provider_count"] or 0) if "provider_count" in row.keys() else 0,
            "active_provider_count": int(row["active_provider_count"] or 0) if "active_provider_count" in row.keys() else 0,
            "providers": safe_providers,
            "legacy": legacy_info,
        }

    @staticmethod
    def _user_query(where="", params=()):
        return (
            """
            SELECT users.*,
                   MAX(CASE WHEN auth_sessions.revoked_at IS NULL THEN auth_sessions.last_seen_at END) AS last_seen_at,
                   (SELECT COUNT(*) FROM cards WHERE cards.owner_user_id = users.id) AS card_count,
                   (SELECT COUNT(*) FROM worldbooks WHERE worldbooks.owner_user_id = users.id) AS worldbook_count,
                   (SELECT COUNT(*) FROM works WHERE works.owner_user_id = users.id) AS work_count,
                   (SELECT COUNT(*) FROM conversations WHERE conversations.user_id = users.id) AS conversation_count,
                   (
                       EXISTS(
                           SELECT 1 FROM user_ai_settings
                           WHERE user_ai_settings.user_id = users.id
                             AND TRIM(COALESCE(user_ai_settings.api_key_ciphertext, '')) <> ''
                       )
                       OR EXISTS(
                           SELECT 1 FROM user_ai_providers
                           WHERE user_ai_providers.user_id = users.id
                             AND TRIM(COALESCE(user_ai_providers.api_key_ciphertext, '')) <> ''
                       )
                   ) AS api_key_set,
                   (SELECT COUNT(*) FROM user_ai_providers WHERE user_ai_providers.user_id = users.id) AS provider_count,
                   (SELECT COUNT(*) FROM user_ai_providers
                      WHERE user_ai_providers.user_id = users.id AND user_ai_providers.is_active = 1
                   ) AS active_provider_count
            FROM users
            LEFT JOIN auth_sessions ON auth_sessions.user_id = users.id
            """
            + (f" WHERE {where} " if where else " ")
            + " GROUP BY users.id "
        ), list(params)

    def list_users(self, *, query="", status="all", page=1, page_size=20):
        page = max(1, int(page or 1))
        page_size = min(100, max(1, int(page_size or 20)))
        filters = []
        params = []
        if query and str(query).strip():
            value = str(query).strip()
            filters.append("(users.username LIKE ? OR CAST(users.id AS TEXT) = ?)")
            params.extend([f"%{value}%", value])
        if status == "active":
            filters.append("users.is_active = 1")
        elif status in {"disabled", "inactive"}:
            filters.append("users.is_active = 0")
        where = " AND ".join(filters)
        query_sql, query_params = self._user_query(where, params)
        with _connection_scope(self.connection_or_factory) as connection:
            total = connection.execute(
                f"SELECT COUNT(*) AS total FROM users{(' WHERE ' + where) if where else ''}",
                params,
            ).fetchone()["total"]
            rows = connection.execute(
                query_sql
                + " ORDER BY users.created_at DESC, users.id DESC LIMIT ? OFFSET ?",
                query_params + [page_size, (page - 1) * page_size],
            ).fetchall()
            ai_info = {row["id"]: self._ai_info(connection, row["id"], row) for row in rows}
        return {
            "items": [_public_user(row, ai_info[row["id"]]) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def get_user(self, user_id):
        query_sql, params = self._user_query("users.id = ?", [user_id])
        with _connection_scope(self.connection_or_factory) as connection:
            row = connection.execute(query_sql, params).fetchone()
            ai_info = self._ai_info(connection, user_id, row) if row is not None else None
        if row is None:
            raise AdminUserNotFound()
        return _public_user(row, ai_info)

    def overview(self):
        with _connection_scope(self.connection_or_factory) as connection:
            users = connection.execute(
                "SELECT COUNT(*) AS total, SUM(is_active = 1) AS active, SUM(is_active = 0) AS disabled, "
                "SUM(role = 'station_master') AS station_masters FROM users"
            ).fetchone()
            resources = {}
            for key, table in (
                ("cards", "cards"),
                ("worldbooks", "worldbooks"),
                ("worldbook_entries", "worldbook_entries"),
                ("works", "works"),
                ("conversations", "conversations"),
                ("messages", "messages"),
                ("snapshots", "snapshots"),
                ("states", "states"),
            ):
                resources[key] = connection.execute(f"SELECT COUNT(*) AS total FROM {table}").fetchone()["total"]
            recent = connection.execute(
                """
                SELECT admin_audit_logs.id, admin_audit_logs.action,
                       admin_audit_logs.target_type, admin_audit_logs.target_id,
                       admin_audit_logs.summary_json, admin_audit_logs.result,
                       admin_audit_logs.request_ip,
                       admin_audit_logs.created_at, actor.username AS actor_username,
                       target.username AS target_username
                FROM admin_audit_logs
                LEFT JOIN users AS actor ON actor.id = admin_audit_logs.actor_user_id
                LEFT JOIN users AS target ON target.id = admin_audit_logs.target_user_id
                ORDER BY admin_audit_logs.created_at DESC, admin_audit_logs.id DESC
                LIMIT 8
                """
            ).fetchall()
        return {
            "users": {
                "total": int(users["total"] or 0),
                "active": int(users["active"] or 0),
                "disabled": int(users["disabled"] or 0),
                "station_masters": int(users["station_masters"] or 0),
            },
            "resources": resources,
            "recent_audits": [_audit_row(row) for row in recent],
        }

    def _target(self, connection, user_id):
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AdminUserNotFound()
        return row

    @staticmethod
    def _check_target(actor, target, *, allow_station=False):
        if target["role"] == ROLE_STATION_MASTER and not allow_station:
            raise LastStationMasterError()
        if actor.id == target["id"] and not allow_station:
            raise AdminSelfActionForbidden()

    def set_user_active(self, actor, user_id, active, *, request_ip=""):
        active = bool(active)
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                target = self._target(connection, user_id)
                self._check_target(actor, target)
                now = _now()
                connection.execute(
                    "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
                    (int(active), now, user_id),
                )
                if not active:
                    connection.execute(
                        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                        (now, user_id),
                    )
                record_admin_audit(
                    connection,
                    actor_user_id=actor.id,
                    target_user_id=user_id,
                    action="activate_user" if active else "suspend_user",
                    target_type="user",
                    target_id=user_id,
                    summary={"is_active": active},
                    request_ip=request_ip,
                )
                connection.commit()
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise
        return self.get_user(user_id)

    def reset_password(self, actor, user_id, new_password, *, request_ip=""):
        validate_password(new_password)
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                target = self._target(connection, user_id)
                self._check_target(actor, target)
                now = _now()
                connection.execute(
                    "UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?",
                    (hash_password(new_password), now, now, user_id),
                )
                connection.execute(
                    "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                    (now, user_id),
                )
                record_admin_audit(
                    connection,
                    actor_user_id=actor.id,
                    target_user_id=user_id,
                    action="reset_password",
                    target_type="user",
                    target_id=user_id,
                    summary={"sessions_revoked": True},
                    request_ip=request_ip,
                )
                connection.commit()
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise
        return self.get_user(user_id)

    def clear_ai_settings(self, actor, user_id, *, request_ip=""):
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                target = self._target(connection, user_id)
                if actor.id == target["id"]:
                    raise AdminSelfActionForbidden()
                now = _now()
                connection.execute(
                    "UPDATE user_ai_settings SET api_key_ciphertext = '', updated_at = ? WHERE user_id = ?",
                    (now, user_id),
                )
                connection.execute(
                    "UPDATE user_ai_providers SET api_key_ciphertext = '', updated_at = ? WHERE user_id = ?",
                    (now, user_id),
                )
                record_admin_audit(
                    connection,
                    actor_user_id=actor.id,
                    target_user_id=user_id,
                    action="clear_ai_secrets",
                    target_type="user_ai_settings",
                    target_id=user_id,
                    summary={"api_keys_cleared": True},
                    request_ip=request_ip,
                )
                connection.commit()
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise
        return self.get_user(user_id)

    def list_audit_logs(self, *, page=1, page_size=30, action="", target_user_id=None):
        page = max(1, int(page or 1))
        page_size = min(100, max(1, int(page_size or 30)))
        filters = []
        params = []
        if action:
            filters.append("admin_audit_logs.action = ?")
            params.append(action)
        if target_user_id is not None:
            filters.append("admin_audit_logs.target_user_id = ?")
            params.append(target_user_id)
        where = " AND ".join(filters)
        where_sql = f" WHERE {where}" if where else ""
        base = """
            FROM admin_audit_logs
            LEFT JOIN users AS actor ON actor.id = admin_audit_logs.actor_user_id
            LEFT JOIN users AS target ON target.id = admin_audit_logs.target_user_id
        """
        with _connection_scope(self.connection_or_factory) as connection:
            total = connection.execute(
                f"SELECT COUNT(*) AS total {base}{where_sql}", params
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT admin_audit_logs.id, admin_audit_logs.action,
                       admin_audit_logs.target_type, admin_audit_logs.target_id,
                       admin_audit_logs.summary_json, admin_audit_logs.result,
                       admin_audit_logs.request_ip, admin_audit_logs.created_at,
                       actor.username AS actor_username,
                       target.username AS target_username
                {base}
                {where_sql}
                ORDER BY admin_audit_logs.created_at DESC, admin_audit_logs.id DESC
                LIMIT ? OFFSET ?
                """,
                params + [page_size, (page - 1) * page_size],
            ).fetchall()
        return {
            "items": [_audit_row(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


def _audit_row(row):
    try:
        summary = json.loads(row["summary_json"] or "{}")
    except (TypeError, ValueError):
        summary = {}
    return {
        "id": row["id"],
        "actor_username": row["actor_username"] or "系统初始化",
        "target_username": row["target_username"] or "",
        "action": row["action"],
        "target_type": row["target_type"],
        "target_id": row["target_id"],
        "summary": summary if isinstance(summary, dict) else {},
        "result": row["result"],
        "request_ip": row["request_ip"],
        "created_at": row["created_at"],
    }
