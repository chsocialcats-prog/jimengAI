from contextlib import closing

from .. import database
from .normalizers import clean_update_data


def row_to_entry(row):
    """把世界书条目数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["keywords"] = database.json_loads(data.get("keywords"), [])
    data["enabled"] = bool(data.get("enabled"))
    return data


def list_worldbooks(page=1, page_size=20):
    """分页读取世界书列表。"""
    total = database.fetch_one("SELECT COUNT(*) AS total FROM worldbooks")["total"]
    rows = database.fetch_all(
        "SELECT * FROM worldbooks ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
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
    row = database.fetch_one("SELECT * FROM worldbooks WHERE id = ?", (worldbook_id,))
    if row is None:
        return None
    data = dict(row)
    entries = database.fetch_all(
        "SELECT * FROM worldbook_entries WHERE worldbook_id = ? "
        "ORDER BY priority DESC, id ASC",
        (worldbook_id,),
    )
    data["entries"] = [row_to_entry(entry) for entry in entries]
    return data


def create_worldbook(data):
    """新增世界书。"""
    now = database.now_str()
    worldbook_id = database.execute(
        "INSERT INTO worldbooks (title, description, created_at, updated_at) "
        "VALUES (?, ?, ?, ?)",
        (data.get("title", ""), data.get("description", ""), now, now),
    )
    return get_worldbook(worldbook_id)


def update_worldbook(worldbook_id, data):
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
            params.append(worldbook_id)
            database.execute(
                f"UPDATE worldbooks SET {', '.join(assignments)} WHERE id = ?", params
            )
    return get_worldbook(worldbook_id)


def delete_worldbook(worldbook_id):
    """删除世界书，条目通过外键级联删除。"""
    database.execute("DELETE FROM worldbooks WHERE id = ?", (worldbook_id,))


def list_worldbook_entries(worldbook_id, page=1, page_size=20):
    """分页读取世界书条目。"""
    params = [worldbook_id]
    total = database.fetch_one(
        "SELECT COUNT(*) AS total FROM worldbook_entries WHERE worldbook_id = ?", params
    )["total"]
    rows = database.fetch_all(
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
        database.fetch_one("SELECT * FROM worldbook_entries WHERE id = ?", (entry_id,))
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


def create_worldbook_entry(worldbook_id, data):
    """新增世界书条目。"""
    with closing(database.connect()) as connection:
        entry_id = _insert_worldbook_entry_in_connection(connection, worldbook_id, data)
        connection.commit()
    return get_worldbook_entry(entry_id)


def update_worldbook_entry(entry_id, data):
    """更新世界书条目。"""
    with closing(database.connect()) as connection:
        if _update_worldbook_entry_in_connection(connection, entry_id, data):
            connection.commit()
    return get_worldbook_entry(entry_id)


def delete_worldbook_entry(entry_id):
    """删除世界书条目。"""
    database.execute("DELETE FROM worldbook_entries WHERE id = ?", (entry_id,))
