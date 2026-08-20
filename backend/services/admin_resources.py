"""Cross-account resource operations for the station-master console."""

from __future__ import annotations

import json

from .. import database
from .admin_service import AdminServiceError, _connection_scope, _now, record_admin_audit


RESOURCE_KINDS = ("card", "worldbook", "worldbook_entry", "work", "conversation", "message", "snapshot", "state")


class ResourceNotFound(AdminServiceError):
    status_code = 404
    code = "resource_not_found"
    message = "资源不存在"


class InvalidResourceKind(AdminServiceError):
    status_code = 422
    code = "invalid_resource_kind"
    message = "不支持的资源类型"


class ResourceReferenced(AdminServiceError):
    status_code = 409
    code = "resource_referenced"
    message = "资源仍被其他内容引用"


def _json(value, default):
    parsed = database.json_loads(value, default)
    return parsed if isinstance(parsed, type(default)) else default


def _preview(value, length=180):
    text = str(value or "").strip().replace("\r", " ").replace("\n", " ")
    return text if len(text) <= length else text[: length - 1] + "…"


def _validate_kind(kind):
    if kind not in RESOURCE_KINDS:
        raise InvalidResourceKind()


def _resource_owner(connection, kind, resource_id):
    _validate_kind(kind)
    queries = {
        "card": "SELECT id, owner_user_id FROM cards WHERE id = ?",
        "worldbook": "SELECT id, owner_user_id FROM worldbooks WHERE id = ?",
        "worldbook_entry": "SELECT worldbook_entries.id, worldbooks.owner_user_id FROM worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id WHERE worldbook_entries.id = ?",
        "work": "SELECT id, owner_user_id FROM works WHERE id = ?",
        "conversation": "SELECT id, user_id AS owner_user_id FROM conversations WHERE id = ?",
        "message": "SELECT messages.id, conversations.user_id AS owner_user_id FROM messages JOIN conversations ON conversations.id = messages.conversation_id WHERE messages.id = ?",
        "snapshot": "SELECT snapshots.id, conversations.user_id AS owner_user_id FROM snapshots JOIN conversations ON conversations.id = snapshots.conversation_id WHERE snapshots.id = ?",
        "state": "SELECT states.id, conversations.user_id AS owner_user_id FROM states JOIN conversations ON conversations.id = states.conversation_id WHERE states.id = ?",
    }
    row = connection.execute(queries[kind], (resource_id,)).fetchone()
    if row is None:
        raise ResourceNotFound()
    return row


def _list_spec(kind):
    specs = {
        "card": {
            "select": "cards.id, cards.owner_user_id, users.username AS owner_username, cards.name AS label, cards.persona AS description, cards.updated_at, cards.created_at",
            "from": "cards LEFT JOIN users ON users.id = cards.owner_user_id",
            "search": "(cards.name LIKE ? OR cards.persona LIKE ? OR cards.personality LIKE ?)",
            "order": "cards.updated_at DESC, cards.id DESC",
        },
        "worldbook": {
            "select": "worldbooks.id, worldbooks.owner_user_id, users.username AS owner_username, worldbooks.title AS label, worldbooks.description, worldbooks.updated_at, worldbooks.created_at, (SELECT COUNT(*) FROM worldbook_entries WHERE worldbook_entries.worldbook_id = worldbooks.id) AS entry_count",
            "from": "worldbooks LEFT JOIN users ON users.id = worldbooks.owner_user_id",
            "search": "(worldbooks.title LIKE ? OR worldbooks.description LIKE ?)",
            "order": "worldbooks.updated_at DESC, worldbooks.id DESC",
        },
        "worldbook_entry": {
            "select": "worldbook_entries.id, worldbooks.owner_user_id, users.username AS owner_username, worldbook_entries.title AS label, worldbook_entries.content AS description, worldbook_entries.updated_at, worldbook_entries.created_at, worldbook_entries.worldbook_id",
            "from": "worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id LEFT JOIN users ON users.id = worldbooks.owner_user_id",
            "search": "(worldbook_entries.title LIKE ? OR worldbook_entries.content LIKE ?)",
            "order": "worldbook_entries.updated_at DESC, worldbook_entries.id DESC",
        },
        "work": {
            "select": "works.id, works.owner_user_id, users.username AS owner_username, works.title AS label, works.description, works.updated_at, works.created_at",
            "from": "works LEFT JOIN users ON users.id = works.owner_user_id",
            "search": "(works.title LIKE ? OR works.description LIKE ?)",
            "order": "works.updated_at DESC, works.id DESC",
        },
        "conversation": {
            "select": "conversations.id, conversations.user_id AS owner_user_id, users.username AS owner_username, conversations.title AS label, conversations.status, conversations.updated_at, conversations.created_at, conversations.last_message_at",
            "from": "conversations LEFT JOIN users ON users.id = conversations.user_id",
            "search": "conversations.title LIKE ?",
            "order": "conversations.updated_at DESC, conversations.id DESC",
        },
        "message": {
            "select": "messages.id, conversations.user_id AS owner_user_id, users.username AS owner_username, messages.conversation_id, messages.role, messages.content AS label, messages.sequence, messages.created_at, messages.created_at AS updated_at",
            "from": "messages JOIN conversations ON conversations.id = messages.conversation_id LEFT JOIN users ON users.id = conversations.user_id",
            "search": "messages.content LIKE ?",
            "order": "messages.created_at DESC, messages.id DESC",
        },
        "snapshot": {
            "select": "snapshots.id, conversations.user_id AS owner_user_id, users.username AS owner_username, snapshots.conversation_id, snapshots.name AS label, snapshots.note AS description, snapshots.created_at, snapshots.created_at AS updated_at",
            "from": "snapshots JOIN conversations ON conversations.id = snapshots.conversation_id LEFT JOIN users ON users.id = conversations.user_id",
            "search": "(snapshots.name LIKE ? OR snapshots.note LIKE ?)",
            "order": "snapshots.created_at DESC, snapshots.id DESC",
        },
        "state": {
            "select": "states.id, conversations.user_id AS owner_user_id, users.username AS owner_username, states.conversation_id, conversations.title AS label, states.attributes AS description, states.updated_at, states.updated_at AS created_at",
            "from": "states JOIN conversations ON conversations.id = states.conversation_id LEFT JOIN users ON users.id = conversations.user_id",
            "search": "(conversations.title LIKE ? OR states.attributes LIKE ? OR states.items LIKE ? OR states.logs LIKE ?)",
            "order": "states.updated_at DESC, states.id DESC",
        },
    }
    return specs[kind]


def _list_item(kind, row):
    data = dict(row)
    data["kind"] = kind
    data["preview"] = _preview(data.get("description") or data.get("label"))
    if kind == "message":
        data["preview"] = _preview(data.get("label"))
    if kind == "worldbook":
        data["entry_count"] = int(data.get("entry_count") or 0)
    return data


def _row_with_owner(connection, table, resource_id):
    return connection.execute(
        f"SELECT {table}.*, users.username AS owner_username FROM {table} "
        f"LEFT JOIN users ON users.id = {table}.owner_user_id WHERE {table}.id = ?",
        (resource_id,),
    ).fetchone()


def _detail(connection, kind, resource_id):
    owner = _resource_owner(connection, kind, resource_id)
    owner_user_id = owner["owner_user_id"]
    if kind == "card":
        row = _row_with_owner(connection, "cards", resource_id)
        data = dict(row)
        for key, default in (("relationships", {}), ("directives", []), ("initial_state", {}), ("character_attributes", {}), ("interop_data", {})):
            data[key] = _json(data.get(key), default)
    elif kind == "worldbook":
        row = _row_with_owner(connection, "worldbooks", resource_id)
        data = dict(row)
        data["interop_data"] = _json(data.get("interop_data"), {})
        entries = connection.execute(
            "SELECT * FROM worldbook_entries WHERE worldbook_id = ? ORDER BY parent_entry_id IS NOT NULL, parent_entry_id, sort_order, id",
            (resource_id,),
        ).fetchall()
        data["entries"] = []
        for entry in entries:
            item = dict(entry)
            item["keywords"] = _json(item.get("keywords"), [])
            item["interop_data"] = _json(item.get("interop_data"), {})
            item["enabled"] = bool(item.get("enabled"))
            item["constant"] = bool(item.pop("constant_injection", 0))
            data["entries"].append(item)
    elif kind == "worldbook_entry":
        row = connection.execute(
            "SELECT worldbook_entries.*, worldbooks.owner_user_id, users.username AS owner_username "
            "FROM worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id "
            "LEFT JOIN users ON users.id = worldbooks.owner_user_id WHERE worldbook_entries.id = ?",
            (resource_id,),
        ).fetchone()
        data = dict(row)
        data["keywords"] = _json(data.get("keywords"), [])
        data["interop_data"] = _json(data.get("interop_data"), {})
        data["enabled"] = bool(data.get("enabled"))
        data["constant"] = bool(data.pop("constant_injection", 0))
    elif kind == "work":
        row = _row_with_owner(connection, "works", resource_id)
        data = dict(row)
        for key, default in (("tags", []), ("onboarding", {}), ("reply_templates", []), ("player_attributes", {})):
            data[key] = _json(data.get(key), default)
        data["is_archive"] = bool(data.get("is_archive"))
        data["card_ids"] = [item["card_id"] for item in connection.execute("SELECT card_id FROM work_cards WHERE work_id = ? ORDER BY position", (resource_id,)).fetchall()]
    elif kind == "conversation":
        row = connection.execute(
            "SELECT conversations.*, users.username AS owner_username FROM conversations LEFT JOIN users ON users.id = conversations.user_id WHERE conversations.id = ?",
            (resource_id,),
        ).fetchone()
        data = dict(row)
        for key, default in (("current_state", {}), ("card_snapshot", {}), ("card_snapshots", []), ("onboarding_config", {}), ("onboarding_answers", {}), ("persona_corrections", []), ("memory_corrections", []), ("pending_options", [])):
            data[key] = _json(data.get(key), default)
        state = connection.execute("SELECT * FROM states WHERE conversation_id = ?", (resource_id,)).fetchone()
        data["state"] = dict(state) if state else None
        if data["state"]:
            for key, default in (("attributes", {}), ("items", []), ("relations", {}), ("quests", []), ("flags", []), ("characters", {}), ("logs", [])):
                data["state"][key] = _json(data["state"].get(key), default)
        messages = connection.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence, id", (resource_id,)).fetchall()
        data["messages"] = []
        for message in messages:
            item = dict(message)
            item["metadata"] = _json(item.get("metadata"), {})
            data["messages"].append(item)
        snapshots = connection.execute("SELECT * FROM snapshots WHERE conversation_id = ? ORDER BY created_at DESC, id DESC", (resource_id,)).fetchall()
        data["snapshots"] = []
        for snapshot in snapshots:
            item = dict(snapshot)
            item["state"] = _json(item.get("state"), {})
            item["messages"] = _json(item.get("messages"), [])
            data["snapshots"].append(item)
    elif kind == "message":
        row = connection.execute(
            "SELECT messages.*, conversations.user_id AS owner_user_id, conversations.title AS conversation_title, users.username AS owner_username FROM messages JOIN conversations ON conversations.id = messages.conversation_id LEFT JOIN users ON users.id = conversations.user_id WHERE messages.id = ?",
            (resource_id,),
        ).fetchone()
        data = dict(row)
        data["metadata"] = _json(data.get("metadata"), {})
    elif kind == "state":
        row = connection.execute(
            "SELECT states.*, conversations.user_id AS owner_user_id, conversations.title AS conversation_title, users.username AS owner_username "
            "FROM states JOIN conversations ON conversations.id = states.conversation_id LEFT JOIN users ON users.id = conversations.user_id WHERE states.id = ?",
            (resource_id,),
        ).fetchone()
        data = dict(row)
        for key, default in (("attributes", {}), ("items", []), ("relations", {}), ("quests", []), ("flags", []), ("characters", {}), ("logs", [])):
            data[key] = _json(data.get(key), default)
    else:
        row = connection.execute(
            "SELECT snapshots.*, conversations.user_id AS owner_user_id, conversations.title AS conversation_title, users.username AS owner_username FROM snapshots JOIN conversations ON conversations.id = snapshots.conversation_id LEFT JOIN users ON users.id = conversations.user_id WHERE snapshots.id = ?",
            (resource_id,),
        ).fetchone()
        data = dict(row)
        data["state"] = _json(data.get("state"), {})
        data["messages"] = _json(data.get("messages"), [])
    data["kind"] = kind
    data["owner_user_id"] = owner_user_id
    return data


class AdminResourceService:
    def __init__(self, connection_or_factory):
        self.connection_or_factory = connection_or_factory

    def list_resources(self, *, kind, query="", owner_user_id=None, page=1, page_size=20):
        _validate_kind(kind)
        spec = _list_spec(kind)
        page = max(1, int(page or 1))
        page_size = min(100, max(1, int(page_size or 20)))
        filters = []
        params = []
        if query and str(query).strip():
            value = f"%{str(query).strip()}%"
            search_count = spec["search"].count("?")
            filters.append(spec["search"])
            params.extend([value] * search_count)
        if owner_user_id is not None:
            filters.append("owner_user_id = ?")
            params.append(owner_user_id)
        where = f" WHERE {' AND '.join(filters)}" if filters else ""
        base = f"SELECT {spec['select']} FROM {spec['from']}{where}"
        with _connection_scope(self.connection_or_factory) as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM ({base}) AS resources", params).fetchone()["total"]
            rows = connection.execute(
                f"{base} ORDER BY {spec['order']} LIMIT ? OFFSET ?",
                params + [page_size, (page - 1) * page_size],
            ).fetchall()
        return {"items": [_list_item(kind, row) for row in rows], "total": total, "page": page, "page_size": page_size}

    def get_resource(self, kind, resource_id):
        _validate_kind(kind)
        with _connection_scope(self.connection_or_factory) as connection:
            return _detail(connection, kind, resource_id)

    def update_resource(self, actor, kind, resource_id, payload, *, request_ip=""):
        _validate_kind(kind)
        if not isinstance(payload, dict):
            raise AdminServiceError("资源更新内容无效")
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                owner = _resource_owner(connection, kind, resource_id)
                fields = self._update_in_connection(connection, kind, resource_id, payload)
                if not fields:
                    connection.rollback()
                    return _detail(connection, kind, resource_id)
                record_admin_audit(
                    connection,
                    actor_user_id=actor.id,
                    target_user_id=owner["owner_user_id"],
                    action="update_resource",
                    target_type=kind,
                    target_id=resource_id,
                    summary={"fields": fields},
                    request_ip=request_ip,
                )
                connection.commit()
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise
        return self.get_resource(kind, resource_id)

    @staticmethod
    def _update_in_connection(connection, kind, resource_id, payload):
        allowed = {
            "card": ("name", "avatar_url", "persona", "personality", "speaking_style", "source", "relationships", "directives", "initial_state", "character_attributes", "interop_data"),
            "worldbook": ("title", "description", "interop_data"),
            "worldbook_entry": ("title", "keywords", "content", "priority", "enabled", "constant", "parent_entry_id", "sort_order", "interop_data"),
            "work": ("title", "description", "opening", "cover_url", "tags", "onboarding", "reply_templates", "active_reply_template_id", "player_attributes", "is_archive"),
            "conversation": ("title", "status", "current_state", "onboarding_answers", "pending_options"),
            "message": ("content", "metadata", "token_count"),
            "snapshot": ("name", "note", "branch_label", "state", "messages", "memory_summary", "pending_options"),
            "state": ("attributes", "items", "money", "relations", "quests", "flags", "characters", "logs"),
        }[kind]
        assignments = []
        params = []
        for key in allowed:
            if key not in payload:
                continue
            value = payload[key]
            if key in {"relationships", "initial_state", "character_attributes", "interop_data", "tags", "onboarding", "reply_templates", "player_attributes", "current_state", "onboarding_answers", "pending_options", "metadata", "state", "messages", "directives", "keywords", "attributes", "items", "relations", "quests", "flags", "characters", "logs"}:
                value = database.json_dumps(value)
            if key in {"is_archive", "enabled", "constant"}:
                value = int(bool(value))
            column = "constant_injection" if key == "constant" else key
            assignments.append(f"{column} = ?")
            params.append(value)
        if not assignments:
            return []
        table = {"card": "cards", "worldbook": "worldbooks", "worldbook_entry": "worldbook_entries", "work": "works", "conversation": "conversations", "message": "messages", "snapshot": "snapshots", "state": "states"}[kind]
        id_column = "id"
        assignments.append("updated_at = ?") if kind not in {"message", "snapshot"} else None
        if kind in {"message", "snapshot"}:
            assignments.append("created_at = created_at")
        params.append(_now()) if kind not in {"message", "snapshot"} else None
        params.append(resource_id)
        connection.execute(f"UPDATE {table} SET {', '.join(assignments)} WHERE {id_column} = ?", params)
        return [key for key in allowed if key in payload]

    def delete_resource(self, actor, kind, resource_id, *, request_ip=""):
        _validate_kind(kind)
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                owner = _resource_owner(connection, kind, resource_id)
                if kind == "card":
                    references = connection.execute(
                        "SELECT 1 FROM work_cards WHERE card_id = ? UNION SELECT 1 FROM works WHERE card_id = ? LIMIT 1",
                        (resource_id, resource_id),
                    ).fetchone()
                    if references:
                        raise ResourceReferenced("角色卡仍被作品引用")
                if kind == "worldbook":
                    references = connection.execute("SELECT 1 FROM works WHERE worldbook_id = ? LIMIT 1", (resource_id,)).fetchone()
                    if references:
                        raise ResourceReferenced("世界书仍被作品引用")
                table = {"card": "cards", "worldbook": "worldbooks", "worldbook_entry": "worldbook_entries", "work": "works", "conversation": "conversations", "message": "messages", "snapshot": "snapshots", "state": "states"}[kind]
                connection.execute(f"DELETE FROM {table} WHERE id = ?", (resource_id,))
                record_admin_audit(
                    connection,
                    actor_user_id=actor.id,
                    target_user_id=owner["owner_user_id"],
                    action="delete_resource",
                    target_type=kind,
                    target_id=resource_id,
                    summary={"kind": kind},
                    request_ip=request_ip,
                )
                connection.commit()
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise

    def export_resource(self, kind, resource_id):
        return self.get_resource(kind, resource_id)
