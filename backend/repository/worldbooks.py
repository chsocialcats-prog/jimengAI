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


def create_worldbook_entry(worldbook_id, data):
    """新增世界书条目。"""
    now = database.now_str()
    entry_id = database.execute(
        """
        INSERT INTO worldbook_entries (
            worldbook_id, title, keywords, content, priority, enabled,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            worldbook_id,
            data.get("title", ""),
            database.json_dumps(data.get("keywords", [])),
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
    fields = clean_update_data(data)
    assignments = []
    params = []
    for key in ("title", "content", "priority"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    if "keywords" in fields:
        assignments.append("keywords = ?")
        params.append(database.json_dumps(fields["keywords"]))
    if "enabled" in fields:
        assignments.append("enabled = ?")
        params.append(int(bool(fields["enabled"])))
    if assignments:
        assignments.append("updated_at = ?")
        params.append(database.now_str())
        params.append(entry_id)
        database.execute(
            f"UPDATE worldbook_entries SET {', '.join(assignments)} WHERE id = ?", params
        )
    return get_worldbook_entry(entry_id)


def delete_worldbook_entry(entry_id):
    """删除世界书条目。"""
    database.execute("DELETE FROM worldbook_entries WHERE id = ?", (entry_id,))
