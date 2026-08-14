from contextlib import closing

from .. import database
from .cards import row_to_card
from .works import (
    _insert_work_in_connection,
    _update_work_in_connection,
    get_work,
)
from .worldbooks import (
    _insert_worldbook_entry_in_connection,
    _update_worldbook_entry_in_connection,
    get_worldbook,
)


class BundleOwnershipError(Exception):
    """A bundle update attempted to mutate a worldbook owned by another user."""


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
        if entry.get("id") is None:
            _insert_worldbook_entry_in_connection(
                connection, worldbook_id, entry, now=now
            )
        else:
            _update_worldbook_entry_in_connection(
                connection, entry["id"], entry, now=now, worldbook_id=worldbook_id
            )

    omitted_ids = existing_ids - set(supplied_ids)
    if omitted_ids:
        placeholders = ", ".join("?" for _ in omitted_ids)
        connection.execute(
            f"DELETE FROM worldbook_entries WHERE worldbook_id = ? AND id IN ({placeholders})",
            (worldbook_id, *sorted(omitted_ids)),
        )


def save_work_bundle(
    work_data, worldbook_data, work_id=None, *, owner_user_id, connect_fn=database.connect
):
    """在同一事务中保存作品、世界书、条目和角色卡顺序。"""
    work_data = dict(work_data)
    worldbook_data = dict(worldbook_data)
    entries = [dict(entry) for entry in worldbook_data.pop("entries", [])]
    now = database.now_str()

    with closing(connect_fn()) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            if work_id is None:
                worldbook_id = connection.execute(
                    "INSERT INTO worldbooks (owner_user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (
                        owner_user_id, worldbook_data.get("title", ""),
                        worldbook_data.get("description", ""),
                        now,
                        now,
                    ),
                ).lastrowid
                _save_bundle_entries(connection, worldbook_id, entries, now)

                work_id = _insert_work_in_connection(
                    connection, work_data, owner_user_id=owner_user_id, now=now, worldbook_id=worldbook_id
                )
            else:
                current_row = connection.execute(
                    "SELECT * FROM works WHERE id = ? AND owner_user_id = ?", (work_id, owner_user_id)
                ).fetchone()
                if current_row is None:
                    connection.rollback()
                    return None
                worldbook_id = current_row["worldbook_id"]
                if worldbook_id is None:
                    worldbook_id = connection.execute(
                        "INSERT INTO worldbooks (owner_user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (
                            owner_user_id, worldbook_data.get("title", ""),
                            worldbook_data.get("description", ""),
                            now,
                            now,
                        ),
                    ).lastrowid
                else:
                    worldbook_row = connection.execute(
                        "SELECT owner_user_id FROM worldbooks WHERE id = ?", (worldbook_id,)
                    ).fetchone()
                    if worldbook_row is None:
                        raise ValueError("作品关联的世界书不存在")
                    if worldbook_row["owner_user_id"] != owner_user_id:
                        raise BundleOwnershipError("无权通过作品组合修改该世界书")
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

                _update_work_in_connection(
                    connection,
                    work_id,
                    work_data,
                    owner_user_id=owner_user_id,
                    now=now,
                    current_row=current_row,
                    extra_fields={"worldbook_id": worldbook_id},
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {
        "work": get_work(work_id, viewer_user_id=owner_user_id),
        "worldbook": get_worldbook(worldbook_id, viewer_user_id=owner_user_id),
    }


def save_import_bundle(
    card_data, worldbook_data, entries, work_data, *, owner_user_id,
    connect_fn=database.connect,
):
    """Persist every imported shared resource in one ownership-scoped transaction."""
    now = database.now_str()
    with closing(connect_fn()) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            card_id = connection.execute(
                """
                INSERT INTO cards (
                    owner_user_id, name, persona, personality, speaking_style,
                    relationships, directives, initial_state, character_attributes, source,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    owner_user_id, card_data.get("name", ""), card_data.get("persona", ""),
                    card_data.get("personality", ""), card_data.get("speaking_style", ""),
                    database.json_dumps(card_data.get("relationships", {})),
                    database.json_dumps(card_data.get("directives", [])),
                    database.json_dumps(card_data.get("initial_state", {})),
                    database.json_dumps(card_data.get("character_attributes", {})),
                    card_data.get("source", "text-import"), now, now,
                ),
            ).lastrowid
            worldbook_id = connection.execute(
                "INSERT INTO worldbooks (owner_user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (owner_user_id, worldbook_data.get("title", ""), worldbook_data.get("description", ""), now, now),
            ).lastrowid
            for entry in entries:
                _insert_worldbook_entry_in_connection(connection, worldbook_id, entry, now=now)
            work_id = _insert_work_in_connection(
                connection,
                {**work_data, "card_id": card_id},
                owner_user_id=owner_user_id,
                worldbook_id=worldbook_id,
                now=now,
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {
        "card": row_to_card(
            database.fetch_one(
                "SELECT cards.*, users.username AS owner_username FROM cards "
                "LEFT JOIN users ON users.id = cards.owner_user_id WHERE cards.id = ?", (card_id,)
            ), owner_user_id,
        ),
        "worldbook": get_worldbook(worldbook_id, viewer_user_id=owner_user_id),
        "work": get_work(work_id, viewer_user_id=owner_user_id),
    }
