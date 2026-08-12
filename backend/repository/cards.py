from contextlib import closing

from .. import database
from .normalizers import clean_update_data


def row_to_card(row):
    """把角色卡数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["relationships"] = database.json_loads(data.get("relationships"), {})
    data["directives"] = database.json_loads(data.get("directives"), [])
    data["initial_state"] = database.json_loads(data.get("initial_state"), {})
    data["character_attributes"] = database.json_loads(
        data.get("character_attributes"), {}
    )
    return data


def list_cards(q="", page=1, page_size=20):
    """按名称、人设或性格搜索角色卡。"""
    where = ""
    params = []
    if q:
        where = "WHERE name LIKE ? OR persona LIKE ? OR personality LIKE ?"
        like = f"%{q}%"
        params = [like, like, like]
    total = database.fetch_one(f"SELECT COUNT(*) AS total FROM cards {where}", params)[
        "total"
    ]
    rows = database.fetch_all(
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
    return row_to_card(database.fetch_one("SELECT * FROM cards WHERE id = ?", (card_id,)))


def create_card(data):
    """新增角色卡。"""
    now = database.now_str()
    card_id = database.execute(
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
            database.json_dumps(data.get("relationships", {})),
            database.json_dumps(data.get("directives", [])),
            database.json_dumps(data.get("initial_state", {})),
            database.json_dumps(data.get("character_attributes", {})),
            data.get("source", "local"),
            now,
            now,
        ),
    )
    return get_card(card_id)


def update_card(card_id, data):
    """更新角色卡，只更新传入字段。"""
    fields = clean_update_data(data)
    if not fields:
        return get_card(card_id)
    assignments = []
    params = []
    for key in ("name", "persona", "personality", "speaking_style", "source"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(fields[key])
    for key in ("relationships", "directives", "initial_state", "character_attributes"):
        if key in fields:
            assignments.append(f"{key} = ?")
            params.append(database.json_dumps(fields[key]))
    if not assignments:
        return get_card(card_id)
    assignments.append("updated_at = ?")
    params.append(database.now_str())
    params.append(card_id)
    database.execute(f"UPDATE cards SET {', '.join(assignments)} WHERE id = ?", params)
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
    return database.fetch_all(_card_reference_query(), (card_id, card_id))


def delete_card(card_id, *, connect_fn=database.connect):
    """删除未被剧本引用的角色卡。"""
    with closing(connect_fn()) as connection:
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
