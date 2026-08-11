# -*- coding: utf-8 -*-
"""SQLite 业务数据访问层。

统一封装角色卡、世界书、作品、会话、消息、状态、记忆和存档的读写，
所有接口路由只依赖这里的函数，避免 SQL 散落在控制器中。
"""

from collections.abc import Mapping
from contextlib import closing
import re

from .database import (
    connect,
    execute,
    fetch_all,
    fetch_one,
    json_dumps,
    json_loads,
    now_str,
)


def _clean_update_data(data):
    """过滤 None 值，避免接口误把未传字段写成 NULL。"""
    return {key: value for key, value in data.items() if value is not None}

def validate_onboarding(config):
    config = config or {}
    if not isinstance(config, dict): raise ValueError("onboarding 必须是对象")
    fields, keys, result = config.get("fields") or [], set(), []
    if not isinstance(fields, list): raise ValueError("fields 必须是列表")
    for field in fields:
        key = str(field.get("key", "")).strip() if isinstance(field, dict) else ""
        if not re.fullmatch(r"[A-Za-z0-9_]+", key) or key in keys: raise ValueError("field key 必须唯一且仅含字母、数字和下划线")
        field_type = field.get("type", "text")
        if field_type not in ("text", "textarea", "select"): raise ValueError("field type 无效")
        options = [str(x).strip() for x in field.get("options", []) if str(x).strip()]
        if field_type == "select" and not options: raise ValueError("select field 必须包含 options")
        default = str(field.get("default", ""))
        if field_type == "select" and default and default not in options: raise ValueError("select default 必须在 options 中")
        keys.add(key); result.append({"key":key,"label":str(field.get("label",key)).strip() or key,"type":field_type,"required":bool(field.get("required",False)),"placeholder":str(field.get("placeholder","")),"default":default, **({"options":options} if field_type == "select" else {})})
    return {"enabled":bool(config.get("enabled",False)),"intro":str(config.get("intro","")),"allow_freeform":bool(config.get("allow_freeform",False)),"fields":result}


def validate_reply_templates(raw):
    """Normalize reply templates into non-empty, uniquely identified mappings."""
    if not isinstance(raw, list):
        return []

    templates = []
    used_ids = set()
    generated_id = 1

    def next_generated_id():
        nonlocal generated_id
        while f"template-{generated_id}" in used_ids:
            generated_id += 1
        template_id = f"template-{generated_id}"
        generated_id += 1
        return template_id

    for item in raw:
        if not isinstance(item, Mapping):
            continue
        template_id = "" if item.get("id") is None else str(item.get("id")).strip()
        name = "" if item.get("name") is None else str(item.get("name")).strip()
        content = "" if item.get("content") is None else str(item.get("content"))
        if not name and not content.strip():
            continue
        if not template_id or template_id in used_ids:
            template_id = next_generated_id()
        used_ids.add(template_id)
        templates.append({"id": template_id, "name": name or "未命名模板", "content": content})
    return templates


def _normalize_active_reply_template_id(raw, templates):
    active_id = "" if raw is None else str(raw).strip()
    return active_id if active_id in {item["id"] for item in templates} else ""


def normalize_state(raw=None):
    """把任意初始状态统一成引擎使用的完整状态结构。"""
    raw = raw or {}
    characters = {}
    for name, profile in (raw.get("characters") or {}).items():
        if not isinstance(profile, dict):
            continue
        characters[str(name)] = {
            "attributes": dict(profile.get("attributes") or {}),
            "flags": list(profile.get("flags") or []),
        }
    return {
        "attributes": dict(raw.get("attributes") or {}),
        "items": list(raw.get("items") or []),
        "money": raw.get("money", 0),
        "relations": dict(raw.get("relations") or {}),
        "quests": list(raw.get("quests") or []),
        "flags": list(raw.get("flags") or []),
        "characters": characters,
        "logs": list(raw.get("logs") or []),
    }


# ---------- 角色卡 ----------


def row_to_card(row):
    """把角色卡数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["relationships"] = json_loads(data.get("relationships"), {})
    data["directives"] = json_loads(data.get("directives"), [])
    data["initial_state"] = json_loads(data.get("initial_state"), {})
    data["character_attributes"] = json_loads(data.get("character_attributes"), {})
    return data


def list_cards(q="", page=1, page_size=20):
    """按名称、人设或性格搜索角色卡。"""
    where = ""
    params = []
    if q:
        where = "WHERE name LIKE ? OR persona LIKE ? OR personality LIKE ?"
        like = f"%{q}%"
        params = [like, like, like]
    total = fetch_one(f"SELECT COUNT(*) AS total FROM cards {where}", params)["total"]
    rows = fetch_all(
        f"SELECT * FROM cards {where} ORDER BY updated_at DESC, id DESC "
        "LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return {
        "items": [row_to_card(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_card(card_id):
    """按主键读取角色卡。"""
    return row_to_card(fetch_one("SELECT * FROM cards WHERE id = ?", (card_id,)))


def create_card(data):
    """新增角色卡。"""
    now = now_str()
    card_id = execute(
        """
        INSERT INTO cards (
            name, persona, personality, speaking_style,
            relationships, directives, initial_state, character_attributes, source,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data.get("name", ""),
            data.get("persona", ""),
            data.get("personality", ""),
            data.get("speaking_style", ""),
            json_dumps(data.get("relationships", {})),
            json_dumps(data.get("directives", [])),
            json_dumps(data.get("initial_state", {})),
            json_dumps(data.get("character_attributes", {})),
            data.get("source", "local"),
            now,
            now,
        ),
    )
    return get_card(card_id)


def update_card(card_id, data):
    """更新角色卡，只更新传入字段。"""
    fields = _clean_update_data(data)
    if not fields:
        return get_card(card_id)
    assignments = []
    params = []
    for key in (
        "name",
        "persona",
        "personality",
        "speaking_style",
        "source",
    ):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    for key in ("relationships", "directives", "initial_state", "character_attributes"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(json_dumps(fields[key]))
    if not assignments:
        return get_card(card_id)
    assignments.append("updated_at = ?")
    params.append(now_str())
    params.append(card_id)
    execute(f"UPDATE cards SET {', '.join(assignments)} WHERE id = ?", params)
    return get_card(card_id)


class CardReferenceConflict(Exception):
    def __init__(self, works):
        self.works = works
        super().__init__("角色卡正在被剧本引用")


def _card_reference_query():
    return (
        "SELECT id, title FROM works WHERE id IN ("
        "SELECT work_id FROM work_cards WHERE card_id = ? "
        "UNION SELECT id FROM works WHERE card_id = ?"
        ") ORDER BY updated_at DESC, id DESC"
    )


def list_card_references(card_id):
    return fetch_all(_card_reference_query(), (card_id, card_id))


def delete_card(card_id):
    """删除未被剧本引用的角色卡。"""
    with closing(connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        references = [
            dict(row)
            for row in connection.execute(
                _card_reference_query(), (card_id, card_id)
            ).fetchall()
        ]
        if references:
            connection.rollback()
            raise CardReferenceConflict(references)
        connection.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        connection.commit()


# ---------- 世界书 ----------


def row_to_entry(row):
    """把世界书条目数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["keywords"] = json_loads(data.get("keywords"), [])
    data["enabled"] = bool(data.get("enabled"))
    return data


def list_worldbooks(page=1, page_size=20):
    """分页读取世界书列表。"""
    total = fetch_one("SELECT COUNT(*) AS total FROM worldbooks")["total"]
    rows = fetch_all(
        "SELECT * FROM worldbooks ORDER BY updated_at DESC, id DESC "
        "LIMIT ? OFFSET ?",
        (page_size, (page - 1) * page_size),
    )
    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_worldbook(worldbook_id):
    """读取世界书详情并附带条目列表。"""
    row = fetch_one("SELECT * FROM worldbooks WHERE id = ?", (worldbook_id,))
    if row is None:
        return None
    data = dict(row)
    entries = fetch_all(
        "SELECT * FROM worldbook_entries WHERE worldbook_id = ? "
        "ORDER BY priority DESC, id ASC",
        (worldbook_id,),
    )
    data["entries"] = [row_to_entry(entry) for entry in entries]
    return data


def create_worldbook(data):
    """新增世界书。"""
    now = now_str()
    worldbook_id = execute(
        "INSERT INTO worldbooks (title, description, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (data.get("title", ""), data.get("description", ""), now, now),
    )
    return get_worldbook(worldbook_id)


def update_worldbook(worldbook_id, data):
    """更新世界书。"""
    fields = _clean_update_data(data)
    if fields:
        assignments = []
        params = []
        for key in ("title", "description"):
            if key in fields:
                assignments.append(f"{key} = ?")
                params.append(fields[key])
        if assignments:
            assignments.append("updated_at = ?")
            params.append(now_str())
            params.append(worldbook_id)
            execute(
                f"UPDATE worldbooks SET {', '.join(assignments)} WHERE id = ?",
                params,
            )
    return get_worldbook(worldbook_id)


def delete_worldbook(worldbook_id):
    """删除世界书，条目通过外键级联删除。"""
    execute("DELETE FROM worldbooks WHERE id = ?", (worldbook_id,))


def list_worldbook_entries(worldbook_id, page=1, page_size=20):
    """分页读取世界书条目。"""
    params = [worldbook_id]
    total = fetch_one(
        "SELECT COUNT(*) AS total FROM worldbook_entries WHERE worldbook_id = ?",
        params,
    )["total"]
    rows = fetch_all(
        "SELECT * FROM worldbook_entries WHERE worldbook_id = ? "
        "ORDER BY priority DESC, id ASC LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return {
        "items": [row_to_entry(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_worldbook_entry(entry_id):
    """按主键读取世界书条目。"""
    return row_to_entry(
        fetch_one("SELECT * FROM worldbook_entries WHERE id = ?", (entry_id,))
    )


def create_worldbook_entry(worldbook_id, data):
    """新增世界书条目。"""
    now = now_str()
    entry_id = execute(
        """
        INSERT INTO worldbook_entries (
            worldbook_id, title, keywords, content, priority, enabled,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            worldbook_id,
            data.get("title", ""),
            json_dumps(data.get("keywords", [])),
            data.get("content", ""),
            int(data.get("priority", 0)),
            int(bool(data.get("enabled", True))),
            now,
            now,
        ),
    )
    return get_worldbook_entry(entry_id)


def update_worldbook_entry(entry_id, data):
    """更新世界书条目。"""
    fields = _clean_update_data(data)
    assignments = []
    params = []
    for key in ("title", "content", "priority"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    if "keywords" in fields:
        assignments.append("keywords = ?")
        params.append(json_dumps(fields["keywords"]))
    if "enabled" in fields:
        assignments.append("enabled = ?")
        params.append(int(bool(fields["enabled"])))
    if assignments:
        assignments.append("updated_at = ?")
        params.append(now_str())
        params.append(entry_id)
        execute(
            f"UPDATE worldbook_entries SET {', '.join(assignments)} WHERE id = ?",
            params,
        )
    return get_worldbook_entry(entry_id)


def delete_worldbook_entry(entry_id):
    """删除世界书条目。"""
    execute("DELETE FROM worldbook_entries WHERE id = ?", (entry_id,))


# ---------- 作品 ----------


def normalize_card_ids(data, *, for_update=False):
    """Normalize legacy and multi-card input while preserving explicit clearing."""
    if "card_ids" in data:
        raw_ids = data["card_ids"] or []
    elif "card_id" in data:
        raw_ids = [] if data["card_id"] is None else [data["card_id"]]
    elif for_update:
        return None
    else:
        raw_ids = []
    if not isinstance(raw_ids, list):
        raise ValueError("角色卡列表必须是数组")
    card_ids = []
    for raw_card_id in raw_ids:
        card_id = int(raw_card_id)
        if card_id in card_ids:
            raise ValueError("角色卡不能重复引用")
        card_ids.append(card_id)
    return card_ids


def _normalize_player_attributes(data, *, for_update=False):
    if "player_attributes" not in data:
        return None if for_update else {}
    attributes = data["player_attributes"]
    if attributes is None:
        return None if for_update else {}
    if not isinstance(attributes, dict):
        raise ValueError("玩家属性必须是对象")
    return attributes


def _ordered_work_cards(work_id, legacy_card_id=None):
    rows = fetch_all(
        "SELECT card_id FROM work_cards WHERE work_id = ? ORDER BY position ASC", (work_id,)
    )
    card_ids = [row["card_id"] for row in rows]
    if not card_ids and legacy_card_id is not None:
        card_ids = [legacy_card_id]
    return card_ids, [card for card_id in card_ids if (card := get_card(card_id)) is not None]


def _validate_card_ids(connection, card_ids):
    if not card_ids:
        return
    placeholders = ", ".join("?" for _ in card_ids)
    rows = connection.execute(
        f"SELECT id FROM cards WHERE id IN ({placeholders})", card_ids
    ).fetchall()
    found_ids = {row["id"] for row in rows}
    if len(found_ids) != len(card_ids):
        raise ValueError("角色卡不存在")


def _replace_work_cards(connection, work_id, card_ids):
    _validate_card_ids(connection, card_ids)
    connection.execute("DELETE FROM work_cards WHERE work_id = ?", (work_id,))
    connection.executemany(
        "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, ?)",
        [(work_id, card_id, position) for position, card_id in enumerate(card_ids)],
    )
    connection.execute(
        "UPDATE works SET card_id = ? WHERE id = ?",
        (card_ids[0] if card_ids else None, work_id),
    )


def row_to_work(row):
    """把作品数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["tags"] = json_loads(data.get("tags"), [])
    data["onboarding"] = json_loads(data.get("onboarding"), {})
    data["reply_templates"] = validate_reply_templates(
        json_loads(data.get("reply_templates"), [])
    )
    data["active_reply_template_id"] = _normalize_active_reply_template_id(
        data.get("active_reply_template_id"), data["reply_templates"]
    )
    player_attributes = json_loads(data.get("player_attributes"), {})
    data["player_attributes"] = player_attributes if isinstance(player_attributes, dict) else {}
    data["card_ids"], data["cards"] = _ordered_work_cards(data["id"], data.get("card_id"))
    data["card_id"] = data["card_ids"][0] if data["card_ids"] else None
    data["card"] = data["cards"][0] if data["cards"] else None
    data["is_archive"] = bool(data.get("is_archive"))
    return data


def list_works(q="", tag="", page=1, page_size=20):
    """按标题、简介或标签搜索作品。"""
    where = []
    params = []
    if q:
        where.append("(title LIKE ? OR description LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])
    if tag:
        where.append("tags LIKE ?")
        params.append(f'%"{tag}"%')
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    total = fetch_one(f"SELECT COUNT(*) AS total FROM works {where_sql}", params)["total"]
    rows = fetch_all(
        f"SELECT * FROM works {where_sql} ORDER BY updated_at DESC, id DESC "
        "LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return {
        "items": [row_to_work(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_work(work_id):
    """按主键读取作品。"""
    return row_to_work(fetch_one("SELECT * FROM works WHERE id = ?", (work_id,)))


def create_work(data):
    """新增作品。"""
    now = now_str()
    card_ids = normalize_card_ids(data)
    player_attributes = _normalize_player_attributes(data)
    reply_templates = validate_reply_templates(data.get("reply_templates", []))
    active_reply_template_id = _normalize_active_reply_template_id(
        data.get("active_reply_template_id"), reply_templates
    )
    with closing(connect()) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            _validate_card_ids(connection, card_ids)
            work_id = connection.execute(
                """
                INSERT INTO works (
                    title, description, card_id, player_attributes, worldbook_id, opening, tags, onboarding,
                    cover_url, reply_templates, active_reply_template_id, is_archive, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data.get("title", ""), data.get("description", ""), None,
                    json_dumps(player_attributes), data.get("worldbook_id"), data.get("opening", ""),
                    json_dumps(data.get("tags", [])), json_dumps(validate_onboarding(data.get("onboarding", {}))),
                    data.get("cover_url", ""), json_dumps(reply_templates), active_reply_template_id,
                    int(bool(data.get("is_archive", False))), now, now,
                ),
            ).lastrowid
            _replace_work_cards(connection, work_id, card_ids)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return get_work(work_id)


def update_work(work_id, data):
    """更新作品。"""
    card_ids = normalize_card_ids(data, for_update=True)
    player_attributes = _normalize_player_attributes(data, for_update=True)
    fields = _clean_update_data(data)
    fields.pop("card_id", None)
    fields.pop("card_ids", None)
    fields.pop("player_attributes", None)
    if "reply_templates" in fields or "active_reply_template_id" in fields:
        current_work = get_work(work_id)
        if current_work is None:
            return None
        reply_templates = (
            validate_reply_templates(fields["reply_templates"])
            if "reply_templates" in fields
            else current_work["reply_templates"]
        )
        fields["reply_templates"] = reply_templates
        fields["active_reply_template_id"] = _normalize_active_reply_template_id(
            fields.get("active_reply_template_id", current_work["active_reply_template_id"]),
            reply_templates,
        )
    for key in ("worldbook_id",):
        if key in data:
            fields[key] = data[key]
    assignments = []
    params = []
    for key in ("title", "description", "worldbook_id", "opening", "cover_url"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    if "tags" in fields:
        assignments.append("tags = ?")
        params.append(json_dumps(fields["tags"]))
    if "onboarding" in fields:
        assignments.append("onboarding = ?")
        params.append(json_dumps(validate_onboarding(fields["onboarding"])))
    if "reply_templates" in fields:
        assignments.append("reply_templates = ?")
        params.append(json_dumps(fields["reply_templates"]))
    if "active_reply_template_id" in fields:
        assignments.append("active_reply_template_id = ?")
        params.append(fields["active_reply_template_id"])
    if "is_archive" in fields:
        assignments.append("is_archive = ?")
        params.append(int(bool(fields["is_archive"])))
    if player_attributes is not None:
        assignments.append("player_attributes = ?")
        params.append(json_dumps(player_attributes))
    if assignments or card_ids is not None:
        assignments.append("updated_at = ?")
        params.append(now_str())
        params.append(work_id)
        with closing(connect()) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                if card_ids is not None:
                    _validate_card_ids(connection, card_ids)
                connection.execute(f"UPDATE works SET {', '.join(assignments)} WHERE id = ?", params)
                if card_ids is not None:
                    _replace_work_cards(connection, work_id, card_ids)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
    return get_work(work_id)


def delete_work(work_id):
    """删除作品。"""
    execute("DELETE FROM works WHERE id = ?", (work_id,))


# ---------- 会话与消息 ----------


_EMPTY_CARD_SNAPSHOT_MARKER = {"_conversation_card_snapshots_authoritative": True}


class ConversationRecord(dict):
    """Conversation mapping with non-serialized snapshot provenance."""


def row_to_conversation(row):
    """把会话数据库行转为接口字典。"""
    if row is None:
        return None
    data = ConversationRecord(row)
    data["current_state"] = json_loads(data.get("current_state"), {})
    card_snapshot = json_loads(data.get("card_snapshot"), {})
    data._card_snapshots_authoritative = card_snapshot == _EMPTY_CARD_SNAPSHOT_MARKER
    data["card_snapshot"] = {} if data._card_snapshots_authoritative else card_snapshot
    card_snapshots = json_loads(data.get("card_snapshots"), [])
    data["card_snapshots"] = card_snapshots if isinstance(card_snapshots, list) else []
    data["onboarding_config"] = json_loads(data.get("onboarding_config"), {})
    data["onboarding_answers"] = json_loads(data.get("onboarding_answers"), {})
    data["persona_corrections"] = json_loads(data.get("persona_corrections"), [])
    data["memory_corrections"] = json_loads(data.get("memory_corrections"), [])
    return data


def get_conversation(conversation_id):
    """按主键读取冒险会话。"""
    return row_to_conversation(
        fetch_one("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    )


def get_conversation_card(conversation):
    cards = get_conversation_cards(conversation)
    return cards[0] if cards else None


def _json_safe_copy(value, default):
    copied = json_loads(json_dumps(value), default)
    return copied if isinstance(copied, type(default)) else default


def get_conversation_cards(conversation):
    """Return frozen conversation cards first, with legacy/live fallbacks."""
    if not conversation:
        return []
    snapshots = conversation.get("card_snapshots")
    if isinstance(snapshots, list) and snapshots:
        return _json_safe_copy(snapshots, [])
    if isinstance(snapshots, list) and getattr(
        conversation, "_card_snapshots_authoritative", False
    ):
        return []
    snapshot = conversation.get("card_snapshot") or {}
    if isinstance(snapshot, dict) and snapshot:
        return [_json_safe_copy(snapshot, {})]
    work_id = conversation.get("work_id")
    if work_id:
        work = get_work(work_id)
        if work and work.get("cards"):
            return _json_safe_copy(work["cards"], [])
    card_id = conversation.get("card_id")
    card = get_card(card_id) if card_id else None
    return [_json_safe_copy(card, {})] if card else []


def list_conversations(work_id=None, page=1, page_size=20):
    """分页读取会话，可按作品过滤。"""
    where = ""
    params = []
    if work_id is not None:
        where = "WHERE work_id = ?"
        params = [work_id]
    total = fetch_one(
        f"SELECT COUNT(*) AS total FROM conversations {where}", params
    )["total"]
    rows = fetch_all(
        f"SELECT * FROM conversations {where} "
        "ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return {
        "items": [row_to_conversation(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _initial_character_states(cards, player_state):
    """根据角色卡生成本次冒险中 AI 角色的独立初始状态。"""
    if isinstance(cards, dict):
        cards = [cards]
    characters = {}
    for card in cards or []:
        if not isinstance(card, dict) or not str(card.get("name") or "").strip():
            continue
        name = str(card["name"]).strip()
        configured = dict(card.get("character_attributes") or {})
        relation = (player_state.get("relations") or {}).get(name, 0)
        configured.setdefault("心情", 50)
        configured.setdefault("好感度", relation if isinstance(relation, (int, float)) else 0)
        characters[name] = {"attributes": configured, "flags": []}
    return characters


def _ordered_work_cards_in_connection(connection, work_id, legacy_card_id=None):
    rows = connection.execute(
        "SELECT card_id FROM work_cards WHERE work_id = ? ORDER BY position ASC", (work_id,)
    ).fetchall()
    card_ids = [row["card_id"] for row in rows]
    if not card_ids and legacy_card_id is not None:
        card_ids = [legacy_card_id]
    cards = []
    for card_id in card_ids:
        card = row_to_card(connection.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone())
        if card is not None:
            cards.append(card)
    return card_ids, cards


def create_conversation(work_id, title):
    """根据作品创建会话，并初始化状态、开场消息和记忆摘要。"""
    onboarding_status = "pending"
    now = now_str()
    with closing(connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        work_row = connection.execute("SELECT * FROM works WHERE id = ?", (work_id,)).fetchone()
        if work_row is None:
            connection.rollback()
            return None
        work = dict(work_row)
        player_attributes = json_loads(work.get("player_attributes"), {})
        work["player_attributes"] = (
            player_attributes if isinstance(player_attributes, dict) else {}
        )
        onboarding_raw = json_loads(work.get("onboarding"), {})
        work["onboarding"] = onboarding_raw if isinstance(onboarding_raw, dict) else {}
        card_ids, cards = _ordered_work_cards_in_connection(
            connection, work_id, work_row["card_id"]
        )
        card_snapshots = _json_safe_copy(cards, [])
        card = card_snapshots[0] if card_snapshots else None
        card_snapshot = card if card else _EMPTY_CARD_SNAPSHOT_MARKER
        initial_state = normalize_state({"attributes": work.get("player_attributes") or {}})
        initial_state["characters"] = _initial_character_states(card_snapshots, initial_state)
        onboarding = validate_onboarding(work.get("onboarding", {}))
        cursor = connection.execute(
            """
            INSERT INTO conversations (
                work_id, card_id, worldbook_id, title, status,
                current_state, card_snapshot, card_snapshots, onboarding_status, onboarding_config, onboarding_answers, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                work_id,
                card_ids[0] if card_ids else None,
                work.get("worldbook_id"),
                title,
                "active",
                json_dumps(initial_state),
                json_dumps(card_snapshot), json_dumps(card_snapshots),
                onboarding_status, json_dumps(onboarding), json_dumps({}),
                now,
                now,
            ),
        )
        conversation_id = cursor.lastrowid
        connection.execute(
            """
            INSERT INTO states (
                conversation_id, attributes, items, money, relations,
                quests, flags, characters, logs, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id,
                json_dumps(initial_state["attributes"]),
                json_dumps(initial_state["items"]),
                initial_state["money"],
                json_dumps(initial_state["relations"]),
                json_dumps(initial_state["quests"]),
                json_dumps(initial_state["flags"]),
                json_dumps(initial_state["characters"]),
                json_dumps(initial_state["logs"]),
                now,
            ),
        )
        connection.execute(
            "INSERT INTO memory_summaries (conversation_id, summary, updated_at) "
            "VALUES (?, '', ?)",
            (conversation_id, now),
        )
        opening_parts = ["🌟 本次冒险已开始", "", "🎬 场景与开场", work.get("opening") or "故事从这里开始。"]
        if card:
            opening_parts.extend(["", f"👤 主要角色：{card.get('name', '未命名角色')}"])
            if card.get("persona"):
                opening_parts.append(f"人设：{card['persona']}")
            if card.get("relationships"):
                opening_parts.append("关系：" + "；".join(f"{key}：{value}" for key, value in card["relationships"].items()))
        worldbook = get_worldbook(work["worldbook_id"]) if work.get("worldbook_id") else None
        if worldbook and worldbook.get("description"):
            opening_parts.extend(["", "📖 世界与记忆", worldbook["description"]])
        opening_content = "\n".join(opening_parts)
        if opening_content:
            connection.execute(
                """
                INSERT INTO messages (
                    conversation_id, role, content, sequence, metadata,
                    token_count, created_at
                ) VALUES (?, 'assistant', ?, 0, ?, 0, ?)
                """,
                (
                    conversation_id,
                    opening_content,
                    json_dumps({"kind": "opening", "formatted": True}),
                    now,
                ),
            )
            connection.execute(
                "UPDATE conversations SET last_message_at = ? WHERE id = ?",
                (now, conversation_id),
            )
        connection.commit()
    return get_conversation(conversation_id)


def create_conversation_branch(source_conversation_id, title, branch_label=""):
    """Create a branch with its source's frozen cards and current player state."""
    source = get_conversation(source_conversation_id)
    if source is None:
        return None
    state = normalize_state(get_state(source_conversation_id))
    card_snapshots = _json_safe_copy(get_conversation_cards(source), [])
    card_snapshot = (
        card_snapshots[0]
        if card_snapshots
        else _EMPTY_CARD_SNAPSHOT_MARKER
        if getattr(source, "_card_snapshots_authoritative", False)
        else {}
    )
    card_id = card_snapshot.get("id") if isinstance(card_snapshot, dict) else None
    if card_id is None:
        card_id = source.get("card_id")
    now = now_str()
    with closing(connect()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        cursor = connection.execute(
            """
            INSERT INTO conversations (
                work_id, card_id, worldbook_id, title, status, current_state,
                card_snapshot, card_snapshots, parent_conversation_id, branch_label,
                onboarding_status, onboarding_config, onboarding_answers,
                persona_corrections, memory_corrections, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source.get("work_id"), card_id, source.get("worldbook_id"), title,
                "active", json_dumps(state), json_dumps(card_snapshot),
                json_dumps(card_snapshots), source_conversation_id, branch_label,
                source.get("onboarding_status", "completed"),
                json_dumps(source.get("onboarding_config") or {}),
                json_dumps(source.get("onboarding_answers") or {}),
                json_dumps(source.get("persona_corrections") or []),
                json_dumps(source.get("memory_corrections") or []), now, now,
            ),
        )
        conversation_id = cursor.lastrowid
        connection.execute(
            """
            INSERT INTO states (
                conversation_id, attributes, items, money, relations,
                quests, flags, characters, logs, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id, json_dumps(state["attributes"]), json_dumps(state["items"]),
                state["money"], json_dumps(state["relations"]), json_dumps(state["quests"]),
                json_dumps(state["flags"]), json_dumps(state["characters"]),
                json_dumps(state["logs"]), now,
            ),
        )
        connection.execute(
            "INSERT INTO memory_summaries (conversation_id, summary, updated_at) VALUES (?, '', ?)",
            (conversation_id, now),
        )
        connection.commit()
    return get_conversation(conversation_id)


def update_conversation(conversation_id, data):
    """更新会话标题。"""
    execute(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        (data["title"], now_str(), conversation_id),
    )
    return get_conversation(conversation_id)


def complete_conversation_onboarding(conversation_id, answers):
    conversation = get_conversation(conversation_id)
    if conversation is None: return None
    accepted, config = {}, conversation["onboarding_config"]
    fields = config.get("fields", []) or [{"key": key, "required": False} for key in ("name", "age", "identity", "preference", "boundary")]
    for field in fields:
        key = field["key"]; value = str((answers or {}).get(key, "")).strip()
        if field.get("required") and not value: raise ValueError(f"缺少必填字段：{key}")
        if field.get("type") == "select" and value and value not in field.get("options", []): raise ValueError(f"字段选项无效：{key}")
        if value: accepted[key] = value
    if config.get("allow_freeform") and str((answers or {}).get("freeform", "")).strip(): accepted["freeform"] = str(answers["freeform"]).strip()
    for key, value in (answers or {}).items():
        value = str(value).strip()
        if key != "freeform" and value:
            accepted[str(key)[:80]] = value
    execute("UPDATE conversations SET onboarding_status = 'completed', onboarding_answers = ?, updated_at = ? WHERE id = ?", (json_dumps(accepted), now_str(), conversation_id))
    opening = get_messages(conversation_id, limit=1)
    work = get_work(conversation.get("work_id")) if conversation.get("work_id") else None
    card = get_conversation_card(conversation)
    worldbook = get_worldbook(conversation.get("worldbook_id")) if conversation.get("worldbook_id") else None
    lines = ["✨ 开局设定已确认", "", "🎬 场景", (work or {}).get("opening", "故事从这里开始。")]
    if card:
        lines += ["", f"👤 主要角色：{card.get('name', '未命名角色')}", card.get("persona", "")]
    if worldbook and worldbook.get("description"):
        lines += ["", "📖 世界与关键记忆", worldbook["description"]]
    if accepted:
        lines += ["", "🧭 本次会话设定"] + [f"- {key}：{value}" for key, value in accepted.items()]
    create_message(conversation_id, "assistant", "\n".join(item for item in lines if item is not None), metadata={"kind": "onboarding_confirmed"})
    return get_conversation(conversation_id)

def add_conversation_correction(conversation_id, kind, content):
    if kind not in ("persona", "memory"): raise ValueError("修正类型无效")
    content = str(content or "").strip()
    if not content: raise ValueError("修正内容不能为空")
    conversation = get_conversation(conversation_id)
    if conversation is None: return None
    field = "persona_corrections" if kind == "persona" else "memory_corrections"
    entries = list(conversation.get(field) or []) + [{"content": content, "created_at": now_str()}]
    execute(f"UPDATE conversations SET {field} = ?, updated_at = ? WHERE id = ?", (json_dumps(entries[-50:]), now_str(), conversation_id))
    return get_conversation(conversation_id)


def delete_conversation(conversation_id):
    """删除会话及其消息、状态、存档和记忆。"""
    execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))


def row_to_message(row):
    """把消息数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["metadata"] = json_loads(data.get("metadata"), {})
    data["token_count"] = int(data.get("token_count") or 0)
    return data


def get_message(message_id):
    """按主键读取消息。"""
    return row_to_message(
        fetch_one("SELECT * FROM messages WHERE id = ?", (message_id,))
    )


def get_messages(conversation_id, limit=None):
    """读取会话消息，默认按 sequence 升序；limit 表示只取最近 N 条。"""
    rows = fetch_all(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC",
        (conversation_id,),
    )
    messages = [row_to_message(row) for row in rows]
    if limit is not None and len(messages) > limit:
        return messages[-limit:]
    return messages


def create_message(conversation_id, role, content, metadata=None, token_count=0):
    """新增消息，sequence 自动递增，并刷新会话时间。"""
    now = now_str()
    with closing(connect()) as connection:
        # MAX(sequence) 与 INSERT 必须在同一个写事务内完成。否则两个流式请求
        # 可能读到相同的下一个序号；数据库唯一约束是额外的最后一道保护。
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT COALESCE(MAX(sequence), -1) + 1 AS next_seq "
            "FROM messages WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
        sequence = int(row["next_seq"])
        cursor = connection.execute(
            """
            INSERT INTO messages (
                conversation_id, role, content, sequence, metadata,
                token_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id,
                role,
                content,
                sequence,
                json_dumps(metadata or {}),
                int(token_count or 0),
                now,
            ),
        )
        connection.execute(
            "UPDATE conversations SET updated_at = ?, last_message_at = ? "
            "WHERE id = ?",
            (now, now, conversation_id),
        )
        connection.commit()
        message_id = cursor.lastrowid
    return get_message(message_id)


def update_message(message_id, content=None, metadata=None, token_count=None):
    """更新消息内容或元数据，用于流式回复完成后回填。"""
    assignments = []
    params = []
    if content is not None:
        assignments.append("content = ?")
        params.append(content)
    if metadata is not None:
        assignments.append("metadata = ?")
        params.append(json_dumps(metadata))
    if token_count is not None:
        assignments.append("token_count = ?")
        params.append(int(token_count))
    if assignments:
        params.append(message_id)
        execute(
            f"UPDATE messages SET {', '.join(assignments)} WHERE id = ?",
            params,
        )
    return get_message(message_id)


def replace_messages(conversation_id, messages):
    """读档时用快照里的消息整体替换当前消息。"""
    now = now_str()
    with closing(connect()) as connection:
        connection.execute(
            "DELETE FROM messages WHERE conversation_id = ?", (conversation_id,)
        )
        for sequence, message in enumerate(messages):
            connection.execute(
                """
                INSERT INTO messages (
                    conversation_id, role, content, sequence, metadata,
                    token_count, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    message.get("role", "assistant"),
                    message.get("content", ""),
                    sequence,
                    json_dumps(message.get("metadata", {})),
                    int(message.get("token_count", 0)),
                    message.get("created_at", now),
                ),
            )
        connection.commit()


# ---------- 状态 ----------


def get_state(conversation_id):
    """读取会话实时状态；缺失时创建默认状态。"""
    row = fetch_one("SELECT * FROM states WHERE conversation_id = ?", (conversation_id,))
    if row is None:
        default = normalize_state({})
        save_state(conversation_id, default)
        return get_state(conversation_id)
    data = {
        "conversation_id": conversation_id,
        "attributes": json_loads(row["attributes"], {}),
        "items": json_loads(row["items"], []),
        "money": row["money"],
        "relations": json_loads(row["relations"], {}),
        "quests": json_loads(row["quests"], []),
        "flags": json_loads(row["flags"], []),
        "characters": json_loads(row["characters"], {}),
        "logs": json_loads(row["logs"], []),
        "updated_at": row["updated_at"],
    }
    return data


def save_state(conversation_id, state):
    """保存实时状态，并同步到会话的 current_state 字段。"""
    normalized = normalize_state(state)
    now = now_str()
    existing = fetch_one(
        "SELECT id FROM states WHERE conversation_id = ?", (conversation_id,)
    )
    with closing(connect()) as connection:
        if existing:
            connection.execute(
                """
                UPDATE states SET attributes = ?, items = ?, money = ?,
                    relations = ?, quests = ?, flags = ?, characters = ?, logs = ?,
                    updated_at = ?
                WHERE conversation_id = ?
                """,
                (
                    json_dumps(normalized["attributes"]),
                    json_dumps(normalized["items"]),
                    normalized["money"],
                    json_dumps(normalized["relations"]),
                    json_dumps(normalized["quests"]),
                    json_dumps(normalized["flags"]),
                    json_dumps(normalized["characters"]),
                    json_dumps(normalized["logs"]),
                    now,
                    conversation_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO states (
                    conversation_id, attributes, items, money, relations,
                    quests, flags, characters, logs, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    json_dumps(normalized["attributes"]),
                    json_dumps(normalized["items"]),
                    normalized["money"],
                    json_dumps(normalized["relations"]),
                    json_dumps(normalized["quests"]),
                    json_dumps(normalized["flags"]),
                    json_dumps(normalized["characters"]),
                    json_dumps(normalized["logs"]),
                    now,
                ),
            )
        connection.execute(
            "UPDATE conversations SET current_state = ?, updated_at = ? WHERE id = ?",
            (json_dumps(normalized), now, conversation_id),
        )
        connection.commit()
    return get_state(conversation_id)


# ---------- 记忆摘要 ----------


def get_memory_summary_record(conversation_id):
    """读取会话长期记忆摘要。"""
    row = fetch_one(
        "SELECT summary, covered_until_sequence, updated_at "
        "FROM memory_summaries WHERE conversation_id = ?",
        (conversation_id,),
    )
    if row is None:
        return {"summary": "", "covered_until_sequence": -1, "updated_at": None}
    return {
        "summary": row["summary"],
        "covered_until_sequence": int(row["covered_until_sequence"]),
        "updated_at": row["updated_at"],
    }


def get_memory_summary(conversation_id):
    return get_memory_summary_record(conversation_id)["summary"]


def save_memory_summary(conversation_id, summary, covered_until_sequence=-1):
    """写入会话长期记忆摘要。"""
    now = now_str()
    existing = fetch_one(
        "SELECT id FROM memory_summaries WHERE conversation_id = ?",
        (conversation_id,),
    )
    with closing(connect()) as connection:
        if existing:
            connection.execute(
                "UPDATE memory_summaries SET summary = ?, covered_until_sequence = ?, updated_at = ? "
                "WHERE conversation_id = ?",
                (summary, int(covered_until_sequence), now, conversation_id),
            )
        else:
            connection.execute(
                "INSERT INTO memory_summaries "
                "(conversation_id, summary, covered_until_sequence, updated_at) VALUES (?, ?, ?, ?)",
                (conversation_id, summary, int(covered_until_sequence), now),
            )
        connection.commit()


# ---------- 存档 ----------


def row_to_snapshot(row, include_private=False):
    """把存档行转为接口字典，默认不返回内部消息快照。"""
    if row is None:
        return None
    data = dict(row)
    data["state"] = json_loads(data.get("state"), {})
    if include_private:
        data["messages"] = json_loads(data.get("messages"), [])
        data["memory_summary"] = data.get("memory_summary", "")
        data["memory_summary_covered_until_sequence"] = int(
            data.get("memory_summary_covered_until_sequence", -1)
        )
    else:
        data.pop("messages", None)
        data.pop("memory_summary", None)
        data.pop("memory_summary_covered_until_sequence", None)
    return data


def list_snapshots(conversation_id):
    """读取会话的全部存档，新存档在前。"""
    rows = fetch_all(
        "SELECT * FROM snapshots WHERE conversation_id = ? "
        "ORDER BY created_at DESC, id DESC",
        (conversation_id,),
    )
    return [row_to_snapshot(row) for row in rows]


def get_snapshot(snapshot_id, conversation_id=None, include_private=False):
    """按主键读取存档；指定会话时校验归属。"""
    if conversation_id is None:
        row = fetch_one("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,))
    else:
        row = fetch_one(
            "SELECT * FROM snapshots WHERE id = ? AND conversation_id = ?",
            (snapshot_id, conversation_id),
        )
    return row_to_snapshot(row, include_private=include_private)


def create_snapshot(
    conversation_id,
    name="手动存档",
    note="",
    branch_label="",
    autosave=False,
):
    """创建手动或自动存档，快照包含状态、消息和记忆摘要。"""
    now = now_str()
    with closing(connect()) as connection:
        # 快照中的状态、消息和记忆必须来自同一时刻，不能在读取过程中被流式
        # 写入或读档穿插修改。
        connection.execute("BEGIN IMMEDIATE")
        state_row = connection.execute(
            "SELECT * FROM states WHERE conversation_id = ?", (conversation_id,)
        ).fetchone()
        if state_row is None:
            state = normalize_state({})
        else:
            state = {
                "attributes": json_loads(state_row["attributes"], {}),
                "items": json_loads(state_row["items"], []),
                "money": state_row["money"],
                "relations": json_loads(state_row["relations"], {}),
                "quests": json_loads(state_row["quests"], []),
                "flags": json_loads(state_row["flags"], []),
                "characters": json_loads(state_row["characters"], {}),
                "logs": json_loads(state_row["logs"], []),
            }
        snapshot_state = normalize_state(state)
        message_rows = connection.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC",
            (conversation_id,),
        ).fetchall()
        messages = [row_to_message(row) for row in message_rows]
        summary_row = connection.execute(
            "SELECT summary, covered_until_sequence FROM memory_summaries WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
        summary = summary_row["summary"] if summary_row is not None else ""
        summary_covered_until_sequence = (
            int(summary_row["covered_until_sequence"]) if summary_row is not None else -1
        )

        if autosave:
            existing = connection.execute(
                "SELECT id FROM snapshots WHERE conversation_id = ? AND name = ? "
                "ORDER BY id DESC LIMIT 1",
                (conversation_id, "自动存档"),
            ).fetchone()
            if existing is not None:
                snapshot_id = existing["id"]
                connection.execute(
                    """
                    UPDATE snapshots SET state = ?, messages = ?,
                        memory_summary = ?, memory_summary_covered_until_sequence = ?,
                        branch_label = ?, note = ?,
                        created_at = ?
                    WHERE id = ?
                    """,
                    (
                        json_dumps(snapshot_state),
                        json_dumps(messages),
                        summary,
                        summary_covered_until_sequence,
                        branch_label,
                        note or "自动存档",
                        now,
                        snapshot_id,
                    ),
                )
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO snapshots (
                        conversation_id, name, state, messages, memory_summary,
                        memory_summary_covered_until_sequence, branch_label, note, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        conversation_id,
                        "自动存档",
                        json_dumps(snapshot_state),
                        json_dumps(messages),
                        summary,
                        summary_covered_until_sequence,
                        branch_label,
                        note or "自动存档",
                        now,
                    ),
                )
                snapshot_id = cursor.lastrowid
        else:
            cursor = connection.execute(
                """
                INSERT INTO snapshots (
                    conversation_id, name, state, messages, memory_summary,
                    memory_summary_covered_until_sequence, branch_label, note, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    name,
                    json_dumps(snapshot_state),
                    json_dumps(messages),
                    summary,
                    summary_covered_until_sequence,
                    branch_label,
                    note,
                    now,
                ),
            )
            snapshot_id = cursor.lastrowid
        connection.commit()
    return get_snapshot(snapshot_id)


def restore_snapshot(conversation_id, snapshot_id):
    """读档：恢复状态、消息与记忆摘要。"""
    now = now_str()
    with closing(connect()) as connection:
        # 删除旧消息、写入状态和摘要必须同生共死；异常时 SQLite 会回滚整个读档。
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM snapshots WHERE id = ? AND conversation_id = ?",
            (snapshot_id, conversation_id),
        ).fetchone()
        if row is None:
            connection.rollback()
            return None
        snapshot = row_to_snapshot(row, include_private=True)
        state = normalize_state(snapshot["state"])
        connection.execute(
            """
            INSERT INTO states (
                conversation_id, attributes, items, money, relations,
                quests, flags, characters, logs, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                attributes = excluded.attributes, items = excluded.items,
                money = excluded.money, relations = excluded.relations,
                quests = excluded.quests, flags = excluded.flags,
                characters = excluded.characters, logs = excluded.logs,
                updated_at = excluded.updated_at
            """,
            (
                conversation_id,
                json_dumps(state["attributes"]),
                json_dumps(state["items"]),
                state["money"],
                json_dumps(state["relations"]),
                json_dumps(state["quests"]),
                json_dumps(state["flags"]),
                json_dumps(state["characters"]),
                json_dumps(state["logs"]),
                now,
            ),
        )
        connection.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
        for sequence, message in enumerate(snapshot.get("messages", [])):
            connection.execute(
                """
                INSERT INTO messages (
                    conversation_id, role, content, sequence, metadata,
                    token_count, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    message.get("role", "assistant"),
                    message.get("content", ""),
                    sequence,
                    json_dumps(message.get("metadata", {})),
                    int(message.get("token_count", 0)),
                    message.get("created_at", now),
                ),
            )
        connection.execute(
            """
            INSERT INTO memory_summaries (
                conversation_id, summary, covered_until_sequence, updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                summary = excluded.summary,
                covered_until_sequence = excluded.covered_until_sequence,
                updated_at = excluded.updated_at
            """,
            (
                conversation_id,
                snapshot.get("memory_summary", ""),
                int(snapshot.get("memory_summary_covered_until_sequence", -1)),
                now,
            ),
        )
        connection.execute(
            """
            UPDATE conversations SET current_state = ?, status = 'active',
                branch_label = ?, updated_at = ?, last_message_at = ?
            WHERE id = ?
            """,
            (
                json_dumps(state),
                snapshot.get("branch_label", ""),
                now,
                now,
                conversation_id,
            ),
        )
        connection.commit()
    return get_state(conversation_id)


def delete_snapshot(snapshot_id, conversation_id=None):
    """删除存档；指定会话时校验归属。"""
    if conversation_id is None:
        execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))
    else:
        execute(
            "DELETE FROM snapshots WHERE id = ? AND conversation_id = ?",
            (snapshot_id, conversation_id),
        )
