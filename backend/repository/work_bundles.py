from contextlib import closing

from .. import database
from .works import (
    _insert_work_in_connection,
    _update_work_in_connection,
    get_work,
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

                work_id = _insert_work_in_connection(
                    connection, work_data, now=now, worldbook_id=worldbook_id
                )
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

                _update_work_in_connection(
                    connection,
                    work_id,
                    work_data,
                    now=now,
                    current_row=current_row,
                    extra_fields={"worldbook_id": worldbook_id},
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"work": get_work(work_id), "worldbook": get_worldbook(worldbook_id)}
