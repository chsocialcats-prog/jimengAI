from contextlib import closing

from .. import database
from .conversation_repository import (
    _get_memory_summary_record_in_connection,
    _get_messages_in_connection,
    _get_state_in_connection,
    _replace_messages_in_connection,
    _save_memory_summary_in_connection,
    _save_state_in_connection,
    get_state,
)
from .normalizers import normalize_state


def row_to_snapshot(row, include_private=False):
    """把存档行转为接口字典，默认不返回内部消息快照。"""
    if row is None:
        return None
    data = dict(row)
    data["state"] = database.json_loads(data.get("state"), {})
    if include_private:
        data["messages"] = database.json_loads(data.get("messages"), [])
        data["memory_summary"] = data.get("memory_summary", "")
        data["memory_summary_covered_until_sequence"] = int(
            data.get("memory_summary_covered_until_sequence", -1)
        )
        data["persona_corrections"] = (
            None
            if data.get("persona_corrections") is None
            else database.json_loads(data.get("persona_corrections"), [])
        )
        data["memory_corrections"] = (
            None
            if data.get("memory_corrections") is None
            else database.json_loads(data.get("memory_corrections"), [])
        )
    else:
        data.pop("messages", None)
        data.pop("memory_summary", None)
        data.pop("memory_summary_covered_until_sequence", None)
        data.pop("persona_corrections", None)
        data.pop("memory_corrections", None)
    return data


def list_snapshots(conversation_id, user_id):
    """读取会话的全部存档，新存档在前。"""
    rows = database.fetch_all(
        "SELECT snapshots.* FROM snapshots JOIN conversations "
        "ON conversations.id = snapshots.conversation_id "
        "WHERE snapshots.conversation_id = ? AND conversations.user_id = ? "
        "ORDER BY snapshots.created_at DESC, snapshots.id DESC",
        (conversation_id, user_id),
    )
    return [row_to_snapshot(row) for row in rows]


def get_snapshot(snapshot_id, user_id, conversation_id=None, include_private=False):
    """按主键读取存档；指定会话时校验归属。"""
    where = "snapshots.id = ? AND conversations.user_id = ?"
    params = [snapshot_id, user_id]
    if conversation_id is not None:
        where += " AND snapshots.conversation_id = ?"
        params.append(conversation_id)
    row = database.fetch_one(
        "SELECT snapshots.* FROM snapshots JOIN conversations "
        "ON conversations.id = snapshots.conversation_id WHERE " + where,
        params,
    )
    return row_to_snapshot(row, include_private=include_private)


def _insert_snapshot(connection, values):
    return connection.execute(
        """
        INSERT INTO snapshots (
            conversation_id, name, state, messages, memory_summary,
            memory_summary_covered_until_sequence, persona_corrections,
            memory_corrections, branch_label, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        values,
    ).lastrowid


def create_snapshot(
    conversation_id, user_id,
    name="手动存档",
    note="",
    branch_label="",
    autosave=False,
    *,
    connect_fn=database.connect,
):
    """创建手动或自动存档，快照包含完整的会话时间点数据。"""
    now = database.now_str()
    with closing(connect_fn()) as connection:
        # 快照中的状态、消息和记忆必须来自同一时刻，不能在读取过程中被流式
        # 写入或读档穿插修改。
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM conversations WHERE id = ? AND user_id = ?",
            (conversation_id, user_id),
        ).fetchone() is None:
            connection.rollback()
            return None
        state_record = _get_state_in_connection(connection, conversation_id)
        snapshot_state = normalize_state(state_record or {})
        messages = _get_messages_in_connection(connection, conversation_id)
        memory_record = _get_memory_summary_record_in_connection(
            connection, conversation_id
        )
        conversation_row = connection.execute(
            "SELECT persona_corrections, memory_corrections FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        persona_corrections = (
            conversation_row["persona_corrections"] if conversation_row is not None else "[]"
        )
        memory_corrections = (
            conversation_row["memory_corrections"] if conversation_row is not None else "[]"
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
                        persona_corrections = ?, memory_corrections = ?,
                        branch_label = ?, note = ?,
                        created_at = ?
                    WHERE id = ?
                    """,
                    (
                        database.json_dumps(snapshot_state),
                        database.json_dumps(messages),
                        memory_record["summary"],
                        memory_record["covered_until_sequence"],
                        persona_corrections,
                        memory_corrections,
                        branch_label,
                        note or "自动存档",
                        now,
                        snapshot_id,
                    ),
                )
            else:
                snapshot_id = _insert_snapshot(
                    connection,
                    (
                        conversation_id,
                        "自动存档",
                        database.json_dumps(snapshot_state),
                        database.json_dumps(messages),
                        memory_record["summary"],
                        memory_record["covered_until_sequence"],
                        persona_corrections,
                        memory_corrections,
                        branch_label,
                        note or "自动存档",
                        now,
                    ),
                )
        else:
            snapshot_id = _insert_snapshot(
                connection,
                (
                    conversation_id,
                    name,
                    database.json_dumps(snapshot_state),
                    database.json_dumps(messages),
                    memory_record["summary"],
                    memory_record["covered_until_sequence"],
                    persona_corrections,
                    memory_corrections,
                    branch_label,
                    note,
                    now,
                ),
            )
        connection.commit()
    return get_snapshot(snapshot_id, user_id)


def restore_snapshot(
    conversation_id, snapshot_id, user_id, *, connect_fn=database.connect
):
    """读档：恢复状态、消息、记忆摘要与会话修正。"""
    now = database.now_str()
    with closing(connect_fn()) as connection:
        # 删除旧消息、写入状态和摘要必须同生共死；异常时 SQLite 会回滚整个读档。
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT snapshots.* FROM snapshots JOIN conversations "
            "ON conversations.id = snapshots.conversation_id "
            "WHERE snapshots.id = ? AND snapshots.conversation_id = ? "
            "AND conversations.user_id = ?",
            (snapshot_id, conversation_id, user_id),
        ).fetchone()
        if row is None:
            connection.rollback()
            return None
        snapshot = row_to_snapshot(row, include_private=True)
        state = _save_state_in_connection(
            connection,
            conversation_id,
            snapshot["state"],
            now,
            sync_conversation=False,
        )
        _replace_messages_in_connection(
            connection, conversation_id, snapshot.get("messages", []), now
        )
        _save_memory_summary_in_connection(
            connection,
            conversation_id,
            snapshot.get("memory_summary", ""),
            snapshot.get("memory_summary_covered_until_sequence", -1),
            now,
        )
        connection.execute(
            """
            UPDATE conversations SET current_state = ?, status = 'active',
                persona_corrections = COALESCE(?, persona_corrections),
                memory_corrections = COALESCE(?, memory_corrections),
                branch_label = ?, updated_at = ?, last_message_at = ?
            WHERE id = ?
            """,
            (
                database.json_dumps(state),
                None if snapshot.get("persona_corrections") is None else database.json_dumps(snapshot["persona_corrections"]),
                None if snapshot.get("memory_corrections") is None else database.json_dumps(snapshot["memory_corrections"]),
                snapshot.get("branch_label", ""),
                now,
                now,
                conversation_id,
            ),
        )
        connection.commit()
    return get_state(conversation_id, user_id, connect_fn=connect_fn)


def delete_snapshot(snapshot_id, user_id, conversation_id=None):
    """删除存档；指定会话时校验归属。"""
    where = "id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)"
    params = [snapshot_id, user_id]
    if conversation_id is not None:
        where += " AND conversation_id = ?"
        params.append(conversation_id)
    database.execute("DELETE FROM snapshots WHERE " + where, params)
