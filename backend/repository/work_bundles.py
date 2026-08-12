from contextlib import closing

from .. import database
from .normalizers import (
    clean_update_data,
    normalize_active_reply_template_id,
    validate_onboarding,
    validate_reply_templates,
)
from .works import (
    get_work,
    normalize_card_ids,
    normalize_player_attributes,
    replace_work_cards,
    validate_card_ids,
)
from .worldbooks import get_worldbook


def _save_bundle_entries(connection, worldbook_id, entries, now):
    existing_rows = connection.execute(
        "SELECT id FROM worldbook_entries WHERE worldbook_id = ?", (worldbook_id,)
    ).fetchall()
    existing_ids = {row["id"] for row in existing_rows}
    supplied_ids = []
    for entry in entries:
        entry_id = entry.get("id")
        if entry_id is None:
            continue
        if entry_id in supplied_ids:
            raise ValueError("世界书条目不能重复")
        if entry_id not in existing_ids:
            raise ValueError("世界书条目不存在或不属于当前世界书")
        supplied_ids.append(entry_id)

    for entry in entries:
        values = (
            entry.get("title", ""),
            database.json_dumps(entry.get("keywords", [])),
            entry.get("content", ""),
            int(entry.get("priority", 0)),
            int(bool(entry.get("enabled", True))),
            now,
        )
        if entry.get("id") is None:
            connection.execute(
                """
                INSERT INTO worldbook_entries (
                    worldbook_id, title, keywords, content, priority, enabled,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (worldbook_id, *values[:-1], now, now),
            )
        else:
            connection.execute(
                """
                UPDATE worldbook_entries
                SET title = ?, keywords = ?, content = ?, priority = ?, enabled = ?, updated_at = ?
                WHERE id = ? AND worldbook_id = ?
                """,
                (*values, entry["id"], worldbook_id),
            )

    omitted_ids = existing_ids - set(supplied_ids)
    if omitted_ids:
        placeholders = ", ".join("?" for _ in omitted_ids)
        connection.execute(
            f"DELETE FROM worldbook_entries WHERE worldbook_id = ? AND id IN ({placeholders})",
            (worldbook_id, *sorted(omitted_ids)),
        )


def save_work_bundle(
    work_data, worldbook_data, work_id=None, *, connect_fn=database.connect
):
    """在同一事务中保存作品、世界书、条目和角色卡顺序。"""
    work_data = dict(work_data)
    worldbook_data = dict(worldbook_data)
    entries = [dict(entry) for entry in worldbook_data.pop("entries", [])]
    card_ids = normalize_card_ids(work_data, for_update=work_id is not None)
    player_attributes = normalize_player_attributes(
        work_data, for_update=work_id is not None
    )
    now = database.now_str()

    with closing(connect_fn()) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            if work_id is None:
                worldbook_id = connection.execute(
                    "INSERT INTO worldbooks (title, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (
                        worldbook_data.get("title", ""),
                        worldbook_data.get("description", ""),
                        now,
                        now,
                    ),
                ).lastrowid
                _save_bundle_entries(connection, worldbook_id, entries, now)

                card_ids = card_ids or []
                validate_card_ids(connection, card_ids)
                reply_templates = validate_reply_templates(
                    work_data.get("reply_templates", [])
                )
                active_reply_template_id = normalize_active_reply_template_id(
                    work_data.get("active_reply_template_id"), reply_templates
                )
                work_id = connection.execute(
                    """
                    INSERT INTO works (
                        title, description, card_id, player_attributes, worldbook_id, opening,
                        tags, onboarding, cover_url, reply_templates, active_reply_template_id,
                        is_archive, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        work_data.get("title", ""), work_data.get("description", ""), None,
                        database.json_dumps(player_attributes or {}), worldbook_id,
                        work_data.get("opening", ""), database.json_dumps(work_data.get("tags", [])),
                        database.json_dumps(validate_onboarding(work_data.get("onboarding", {}))),
                        work_data.get("cover_url", ""), database.json_dumps(reply_templates),
                        active_reply_template_id, int(bool(work_data.get("is_archive", False))),
                        now, now,
                    ),
                ).lastrowid
                replace_work_cards(connection, work_id, card_ids)
            else:
                current_row = connection.execute(
                    "SELECT * FROM works WHERE id = ?", (work_id,)
                ).fetchone()
                if current_row is None:
                    connection.rollback()
                    return None
                worldbook_id = current_row["worldbook_id"]
                if worldbook_id is None:
                    worldbook_id = connection.execute(
                        "INSERT INTO worldbooks (title, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                        (
                            worldbook_data.get("title", ""),
                            worldbook_data.get("description", ""),
                            now,
                            now,
                        ),
                    ).lastrowid
                else:
                    exists = connection.execute(
                        "SELECT id FROM worldbooks WHERE id = ?", (worldbook_id,)
                    ).fetchone()
                    if exists is None:
                        raise ValueError("作品关联的世界书不存在")
                    connection.execute(
                        "UPDATE worldbooks SET title = ?, description = ?, updated_at = ? WHERE id = ?",
                        (
                            worldbook_data.get("title", ""),
                            worldbook_data.get("description", ""),
                            now,
                            worldbook_id,
                        ),
                    )
                _save_bundle_entries(connection, worldbook_id, entries, now)

                fields = clean_update_data(work_data)
                fields.pop("card_id", None)
                fields.pop("card_ids", None)
                fields.pop("player_attributes", None)
                current_templates = validate_reply_templates(
                    database.json_loads(current_row["reply_templates"], [])
                )
                reply_templates = (
                    validate_reply_templates(fields["reply_templates"])
                    if "reply_templates" in fields
                    else current_templates
                )
                active_reply_template_id = normalize_active_reply_template_id(
                    fields.get(
                        "active_reply_template_id",
                        current_row["active_reply_template_id"],
                    ),
                    reply_templates,
                )
                assignments = ["worldbook_id = ?"]
                params = [worldbook_id]
                for key in ("title", "description", "opening", "cover_url"):
                    if key in fields:
                        assignments.append(f"{key} = ?")
                        params.append(fields[key])
                if "tags" in fields:
                    assignments.append("tags = ?")
                    params.append(database.json_dumps(fields["tags"]))
                if "onboarding" in fields:
                    assignments.append("onboarding = ?")
                    params.append(
                        database.json_dumps(validate_onboarding(fields["onboarding"]))
                    )
                if "reply_templates" in fields or "active_reply_template_id" in fields:
                    assignments.extend(
                        ["reply_templates = ?", "active_reply_template_id = ?"]
                    )
                    params.extend(
                        [database.json_dumps(reply_templates), active_reply_template_id]
                    )
                if "is_archive" in fields:
                    assignments.append("is_archive = ?")
                    params.append(int(bool(fields["is_archive"])))
                if player_attributes is not None:
                    assignments.append("player_attributes = ?")
                    params.append(database.json_dumps(player_attributes))
                assignments.append("updated_at = ?")
                params.extend([now, work_id])
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
    return {"work": get_work(work_id), "worldbook": get_worldbook(worldbook_id)}
