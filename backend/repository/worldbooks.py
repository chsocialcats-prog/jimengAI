from contextlib import closing

from .. import database
from ..api_models.shared import project_shared_resource
from .normalizers import clean_update_data


def row_to_entry(row, viewer_user_id=None):
    """把世界书条目数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["keywords"] = database.json_loads(data.get("keywords"), [])
    data["enabled"] = bool(data.get("enabled"))
    return project_shared_resource(data, viewer_user_id)


def row_to_worldbook(row, viewer_user_id=None):
    if row is None:
        return None
    data = project_shared_resource(row, viewer_user_id)
    data["referencing_works"] = [
        dict(work) for work in list_worldbook_references(data["id"])
    ]
    return data


def list_worldbooks(page=1, page_size=20, *, viewer_user_id=None):
    """分页读取世界书列表。"""
    total = database.fetch_one("SELECT COUNT(*) AS total FROM worldbooks")["total"]
    rows = database.fetch_all(
        "SELECT worldbooks.*, users.username AS owner_username FROM worldbooks "
        "LEFT JOIN users ON users.id = worldbooks.owner_user_id "
        "ORDER BY worldbooks.updated_at DESC, worldbooks.id DESC LIMIT ? OFFSET ?",
        (page_size, (page - 1) * page_size),
    )
    return {
        "items": [row_to_worldbook(row, viewer_user_id) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_worldbook(worldbook_id, *, viewer_user_id=None):
    """读取世界书详情并附带条目列表。"""
    row = database.fetch_one(
        "SELECT worldbooks.*, users.username AS owner_username FROM worldbooks "
        "LEFT JOIN users ON users.id = worldbooks.owner_user_id WHERE worldbooks.id = ?",
        (worldbook_id,),
    )
    if row is None:
        return None
    data = row_to_worldbook(row, viewer_user_id)
    entries = database.fetch_all(
        "SELECT * FROM worldbook_entries WHERE worldbook_id = ? "
        "ORDER BY priority DESC, id ASC",
        (worldbook_id,),
    )
    data["entries"] = [row_to_entry({**entry, "owner_user_id": data.get("owner_user_id"), "owner_username": data.get("owner_username")}, viewer_user_id) for entry in entries]
    return data


def create_worldbook(data, *, owner_user_id):
    """新增世界书。"""
    now = database.now_str()
    worldbook_id = database.execute(
        "INSERT INTO worldbooks (owner_user_id, title, description, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (owner_user_id, data.get("title", ""), data.get("description", ""), now, now),
    )
    return get_worldbook(worldbook_id, viewer_user_id=owner_user_id)


def update_worldbook(worldbook_id, data, *, owner_user_id):
    """更新世界书。"""
    fields = clean_update_data(data)
    if fields:
        assignments = []
        params = []
        for key in ("title", "description"):
            if key in fields:
                assignments.append(f"{key} = ?")
                params.append(fields[key])
        if assignments:
            assignments.append("updated_at = ?")
            params.append(database.now_str())
            params.extend([worldbook_id, owner_user_id])
            database.execute(
                f"UPDATE worldbooks SET {', '.join(assignments)} WHERE id = ? AND owner_user_id = ?", params
            )
    return get_worldbook(worldbook_id, viewer_user_id=owner_user_id)


class WorldbookReferenceConflict(Exception):
    def __init__(self, works):
        self.works = works
        super().__init__("世界书正在被作品引用")


def list_worldbook_references(worldbook_id):
    return database.fetch_all(
        "SELECT id, title FROM works WHERE worldbook_id = ? ORDER BY updated_at DESC, id DESC",
        (worldbook_id,),
    )


def delete_worldbook(worldbook_id, *, owner_user_id, connect_fn=database.connect):
    """删除世界书，条目通过外键级联删除。"""
    with closing(connect_fn()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT owner_user_id FROM worldbooks WHERE id = ?", (worldbook_id,)).fetchone()
        if row is None:
            connection.rollback()
            return "not_found"
        if row["owner_user_id"] != owner_user_id:
            connection.rollback()
            return "forbidden"
        references = [dict(row) for row in connection.execute(
            "SELECT id, title FROM works WHERE worldbook_id = ? ORDER BY updated_at DESC, id DESC", (worldbook_id,)
        ).fetchall()]
        if references:
            connection.rollback()
            raise WorldbookReferenceConflict(references)
        connection.execute("DELETE FROM worldbooks WHERE id = ? AND owner_user_id = ?", (worldbook_id, owner_user_id))
        connection.commit()


def list_worldbook_entries(worldbook_id, page=1, page_size=20, *, viewer_user_id=None):
    """分页读取世界书条目。"""
    params = [worldbook_id]
    total = database.fetch_one(
        "SELECT COUNT(*) AS total FROM worldbook_entries WHERE worldbook_id = ?", params
    )["total"]
    rows = database.fetch_all(
        "SELECT worldbook_entries.*, worldbooks.owner_user_id, users.username AS owner_username "
        "FROM worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id "
        "LEFT JOIN users ON users.id = worldbooks.owner_user_id "
        "WHERE worldbook_entries.worldbook_id = ? "
        "ORDER BY worldbook_entries.priority DESC, worldbook_entries.id ASC LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return {
        "items": [row_to_entry(row, viewer_user_id) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def get_worldbook_entry(entry_id, *, viewer_user_id=None):
    """按主键读取世界书条目。"""
    return row_to_entry(
        database.fetch_one(
            "SELECT worldbook_entries.*, worldbooks.owner_user_id, users.username AS owner_username "
            "FROM worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id "
            "LEFT JOIN users ON users.id = worldbooks.owner_user_id WHERE worldbook_entries.id = ?", (entry_id,)
        ), viewer_user_id
    )


def _entry_storage_values(data, now=None):
    now = now or database.now_str()
    return (
        data.get("title", ""), database.json_dumps(data.get("keywords", [])),
        data.get("content", ""), int(data.get("priority", 0)),
        int(bool(data.get("enabled", True))), now,
    )


def _insert_worldbook_entry_in_connection(connection, worldbook_id, data, *, now=None):
    values = _entry_storage_values(data, now)
    return connection.execute(
        "INSERT INTO worldbook_entries (worldbook_id, title, keywords, content, priority, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (worldbook_id, *values, values[-1]),
    ).lastrowid


def _update_worldbook_entry_in_connection(
    connection, entry_id, data, *, now=None, worldbook_id=None
):
    now = now or database.now_str()
    fields = clean_update_data(data)
    values = _entry_storage_values(fields, now)
    if worldbook_id is not None:
        connection.execute(
            "UPDATE worldbook_entries SET title = ?, keywords = ?, content = ?, priority = ?, enabled = ?, updated_at = ? WHERE id = ? AND worldbook_id = ?",
            (*values, entry_id, worldbook_id),
        )
        return True

    assignments = []
    params = []
    for key, index in (("title", 0), ("content", 2), ("priority", 3),
                       ("keywords", 1), ("enabled", 4)):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(_entry_storage_values(fields, now)[index])
    if not assignments:
        return False
    assignments.append("updated_at = ?")
    params.extend([now, entry_id])
    connection.execute(
        f"UPDATE worldbook_entries SET {', '.join(assignments)} WHERE id = ?",
        params,
    )
    return True


def create_worldbook_entry(worldbook_id, data, *, owner_user_id):
    """新增世界书条目。"""
    with closing(database.connect()) as connection:
        owned = connection.execute("SELECT id FROM worldbooks WHERE id = ? AND owner_user_id = ?", (worldbook_id, owner_user_id)).fetchone()
        if owned is None:
            connection.rollback()
            return None
        entry_id = _insert_worldbook_entry_in_connection(connection, worldbook_id, data)
        connection.commit()
    return get_worldbook_entry(entry_id, viewer_user_id=owner_user_id)


def update_worldbook_entry(entry_id, data, *, owner_user_id):
    """更新世界书条目。"""
    with closing(database.connect()) as connection:
        owned = connection.execute(
            "SELECT worldbook_entries.worldbook_id FROM worldbook_entries JOIN worldbooks ON worldbooks.id = worldbook_entries.worldbook_id WHERE worldbook_entries.id = ? AND worldbooks.owner_user_id = ?", (entry_id, owner_user_id)
        ).fetchone()
        if owned is None:
            connection.rollback()
            return None
        if _update_worldbook_entry_in_connection(connection, entry_id, data):
            connection.commit()
    return get_worldbook_entry(entry_id, viewer_user_id=owner_user_id)


def delete_worldbook_entry(entry_id, *, owner_user_id):
    """删除世界书条目。"""
    database.execute(
        "DELETE FROM worldbook_entries WHERE id = ? AND worldbook_id IN (SELECT id FROM worldbooks WHERE owner_user_id = ?)",
        (entry_id, owner_user_id),
    )
