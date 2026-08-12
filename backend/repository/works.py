from contextlib import closing

from .. import database
from .cards import get_card
from .normalizers import (
    clean_update_data,
    normalize_active_reply_template_id,
    validate_onboarding,
    validate_reply_templates,
)


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


def normalize_player_attributes(data, *, for_update=False):
    if "player_attributes" not in data:
        return None if for_update else {}
    attributes = data["player_attributes"]
    if attributes is None:
        return None if for_update else {}
    if not isinstance(attributes, dict):
        raise ValueError("玩家属性必须是对象")
    return attributes


def ordered_work_cards(work_id, legacy_card_id=None):
    rows = database.fetch_all(
        "SELECT card_id FROM work_cards WHERE work_id = ? ORDER BY position ASC",
        (work_id,),
    )
    card_ids = [row["card_id"] for row in rows]
    if not card_ids and legacy_card_id is not None:
        card_ids = [legacy_card_id]
    return card_ids, [
        card for card_id in card_ids if (card := get_card(card_id)) is not None
    ]


def validate_card_ids(connection, card_ids):
    if not card_ids:
        return
    placeholders = ", ".join("?" for _ in card_ids)
    rows = connection.execute(
        f"SELECT id FROM cards WHERE id IN ({placeholders})", card_ids
    ).fetchall()
    found_ids = {row["id"] for row in rows}
    if len(found_ids) != len(card_ids):
        raise ValueError("角色卡不存在")


def replace_work_cards(connection, work_id, card_ids):
    validate_card_ids(connection, card_ids)
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
    data["tags"] = database.json_loads(data.get("tags"), [])
    data["onboarding"] = database.json_loads(data.get("onboarding"), {})
    data["reply_templates"] = validate_reply_templates(
        database.json_loads(data.get("reply_templates"), [])
    )
    data["active_reply_template_id"] = normalize_active_reply_template_id(
        data.get("active_reply_template_id"), data["reply_templates"]
    )
    player_attributes = database.json_loads(data.get("player_attributes"), {})
    data["player_attributes"] = (
        player_attributes if isinstance(player_attributes, dict) else {}
    )
    data["card_ids"], data["cards"] = ordered_work_cards(
        data["id"], data.get("card_id")
    )
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
    total = database.fetch_one(
        f"SELECT COUNT(*) AS total FROM works {where_sql}", params
    )["total"]
    rows = database.fetch_all(
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
    return row_to_work(database.fetch_one("SELECT * FROM works WHERE id = ?", (work_id,)))


def create_work(data, *, connect_fn=database.connect):
    """新增作品。"""
    now = database.now_str()
    card_ids = normalize_card_ids(data)
    player_attributes = normalize_player_attributes(data)
    reply_templates = validate_reply_templates(data.get("reply_templates", []))
    active_reply_template_id = normalize_active_reply_template_id(
        data.get("active_reply_template_id"), reply_templates
    )
    with closing(connect_fn()) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            validate_card_ids(connection, card_ids)
            work_id = connection.execute(
                """
                INSERT INTO works (
                    title, description, card_id, player_attributes, worldbook_id, opening, tags, onboarding,
                    cover_url, reply_templates, active_reply_template_id, is_archive, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data.get("title", ""), data.get("description", ""), None,
                    database.json_dumps(player_attributes), data.get("worldbook_id"), data.get("opening", ""),
                    database.json_dumps(data.get("tags", [])),
                    database.json_dumps(validate_onboarding(data.get("onboarding", {}))),
                    data.get("cover_url", ""), database.json_dumps(reply_templates),
                    active_reply_template_id, int(bool(data.get("is_archive", False))), now, now,
                ),
            ).lastrowid
            replace_work_cards(connection, work_id, card_ids)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return get_work(work_id)


def update_work(work_id, data, *, connect_fn=database.connect):
    """更新作品。"""
    card_ids = normalize_card_ids(data, for_update=True)
    player_attributes = normalize_player_attributes(data, for_update=True)
    fields = clean_update_data(data)
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
        fields["active_reply_template_id"] = normalize_active_reply_template_id(
            fields.get(
                "active_reply_template_id", current_work["active_reply_template_id"]
            ),
            reply_templates,
        )
    if "worldbook_id" in data:
        fields["worldbook_id"] = data["worldbook_id"]
    assignments = []
    params = []
    for key in ("title", "description", "worldbook_id", "opening", "cover_url"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    if "tags" in fields:
        assignments.append("tags = ?")
        params.append(database.json_dumps(fields["tags"]))
    if "onboarding" in fields:
        assignments.append("onboarding = ?")
        params.append(database.json_dumps(validate_onboarding(fields["onboarding"])))
    if "reply_templates" in fields:
        assignments.append("reply_templates = ?")
        params.append(database.json_dumps(fields["reply_templates"]))
    if "active_reply_template_id" in fields:
        assignments.append("active_reply_template_id = ?")
        params.append(fields["active_reply_template_id"])
    if "is_archive" in fields:
        assignments.append("is_archive = ?")
        params.append(int(bool(fields["is_archive"])))
    if player_attributes is not None:
        assignments.append("player_attributes = ?")
        params.append(database.json_dumps(player_attributes))
    if assignments or card_ids is not None:
        assignments.append("updated_at = ?")
        params.append(database.now_str())
        params.append(work_id)
        with closing(connect_fn()) as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                if card_ids is not None:
                    validate_card_ids(connection, card_ids)
                connection.execute(
                    f"UPDATE works SET {', '.join(assignments)} WHERE id = ?", params
                )
                if card_ids is not None:
                    replace_work_cards(connection, work_id, card_ids)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
    return get_work(work_id)


def delete_work(work_id):
    """删除作品。"""
    database.execute("DELETE FROM works WHERE id = ?", (work_id,))
