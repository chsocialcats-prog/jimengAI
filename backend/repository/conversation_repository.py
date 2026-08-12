from contextlib import closing

from .. import database
from .cards import get_card, row_to_card
from .normalizers import normalize_state, validate_onboarding
from .works import get_work
from .worldbooks import get_worldbook


_EMPTY_CARD_SNAPSHOT_MARKER = {"_conversation_card_snapshots_authoritative": True}


class ConversationRecord(dict):
    """Conversation mapping with non-serialized snapshot provenance."""


def row_to_conversation(row):
    """把会话数据库行转为接口字典。"""
    if row is None:
        return None
    data = ConversationRecord(row)
    data["current_state"] = database.json_loads(data.get("current_state"), {})
    card_snapshot = database.json_loads(data.get("card_snapshot"), {})
    data._card_snapshots_authoritative = card_snapshot == _EMPTY_CARD_SNAPSHOT_MARKER
    data["card_snapshot"] = {} if data._card_snapshots_authoritative else card_snapshot
    card_snapshots = database.json_loads(data.get("card_snapshots"), [])
    data["card_snapshots"] = card_snapshots if isinstance(card_snapshots, list) else []
    data["onboarding_config"] = database.json_loads(data.get("onboarding_config"), {})
    data["onboarding_answers"] = database.json_loads(data.get("onboarding_answers"), {})
    data["persona_corrections"] = database.json_loads(data.get("persona_corrections"), [])
    data["memory_corrections"] = database.json_loads(data.get("memory_corrections"), [])
    return data


def get_conversation(conversation_id):
    """按主键读取冒险会话。"""
    return row_to_conversation(
        database.fetch_one("SELECT * FROM conversations WHERE id = ?", (conversation_id,))
    )


def get_conversation_card(conversation):
    cards = get_conversation_cards(conversation)
    return cards[0] if cards else None


def _json_safe_copy(value, default):
    copied = database.json_loads(database.json_dumps(value), default)
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
    total = database.fetch_one(
        f"SELECT COUNT(*) AS total FROM conversations {where}", params
    )["total"]
    rows = database.fetch_all(
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
        card = row_to_card(
            connection.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        )
        if card is not None:
            cards.append(card)
    return card_ids, cards


def create_conversation(work_id, title, *, connect_fn=database.connect):
    """根据作品创建会话，并初始化状态、开场消息和记忆摘要。"""
    onboarding_status = "pending"
    now = database.now_str()
    with closing(connect_fn()) as connection:
        connection.execute("BEGIN IMMEDIATE")
        work_row = connection.execute("SELECT * FROM works WHERE id = ?", (work_id,)).fetchone()
        if work_row is None:
            connection.rollback()
            return None
        work = dict(work_row)
        player_attributes = database.json_loads(work.get("player_attributes"), {})
        work["player_attributes"] = (
            player_attributes if isinstance(player_attributes, dict) else {}
        )
        onboarding_raw = database.json_loads(work.get("onboarding"), {})
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
                database.json_dumps(initial_state),
                database.json_dumps(card_snapshot), database.json_dumps(card_snapshots),
                onboarding_status, database.json_dumps(onboarding), database.json_dumps({}),
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
                database.json_dumps(initial_state["attributes"]),
                database.json_dumps(initial_state["items"]),
                initial_state["money"],
                database.json_dumps(initial_state["relations"]),
                database.json_dumps(initial_state["quests"]),
                database.json_dumps(initial_state["flags"]),
                database.json_dumps(initial_state["characters"]),
                database.json_dumps(initial_state["logs"]),
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
                    database.json_dumps({"kind": "opening", "formatted": True}),
                    now,
                ),
            )
            connection.execute(
                "UPDATE conversations SET last_message_at = ? WHERE id = ?",
                (now, conversation_id),
            )
        connection.commit()
    return get_conversation(conversation_id)


def create_conversation_branch(
    source_conversation_id, title, branch_label="", *, connect_fn=database.connect
):
    """Create a branch with its source's frozen cards and current player state."""
    source = get_conversation(source_conversation_id)
    if source is None:
        return None
    state = normalize_state(get_state(source_conversation_id, connect_fn=connect_fn))
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
    now = database.now_str()
    with closing(connect_fn()) as connection:
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
                "active", database.json_dumps(state), database.json_dumps(card_snapshot),
                database.json_dumps(card_snapshots), source_conversation_id, branch_label,
                source.get("onboarding_status", "completed"),
                database.json_dumps(source.get("onboarding_config") or {}),
                database.json_dumps(source.get("onboarding_answers") or {}),
                database.json_dumps(source.get("persona_corrections") or []),
                database.json_dumps(source.get("memory_corrections") or []), now, now,
            ),
        )
        conversation_id = cursor.lastrowid
        _save_state_row_in_connection(connection, conversation_id, state, now)
        connection.execute(
            "INSERT INTO memory_summaries (conversation_id, summary, updated_at) VALUES (?, '', ?)",
            (conversation_id, now),
        )
        connection.commit()
    return get_conversation(conversation_id)


def update_conversation(conversation_id, data):
    """更新会话标题。"""
    database.execute(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        (data["title"], database.now_str(), conversation_id),
    )
    return get_conversation(conversation_id)


def complete_conversation_onboarding(
    conversation_id, answers, *, connect_fn=database.connect
):
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
    database.execute("UPDATE conversations SET onboarding_status = 'completed', onboarding_answers = ?, updated_at = ? WHERE id = ?", (database.json_dumps(accepted), database.now_str(), conversation_id))
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
    create_message(conversation_id, "assistant", "\n".join(item for item in lines if item is not None), metadata={"kind": "onboarding_confirmed"}, connect_fn=connect_fn)
    return get_conversation(conversation_id)


def add_conversation_correction(conversation_id, kind, content):
    if kind not in ("persona", "memory"): raise ValueError("修正类型无效")
    content = str(content or "").strip()
    if not content: raise ValueError("修正内容不能为空")
    conversation = get_conversation(conversation_id)
    if conversation is None: return None
    field = "persona_corrections" if kind == "persona" else "memory_corrections"
    entries = list(conversation.get(field) or []) + [{"content": content, "created_at": database.now_str()}]
    database.execute(f"UPDATE conversations SET {field} = ?, updated_at = ? WHERE id = ?", (database.json_dumps(entries[-50:]), database.now_str(), conversation_id))
    return get_conversation(conversation_id)


def delete_conversation(conversation_id):
    """删除会话及其消息、状态、存档和记忆。"""
    database.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))


def row_to_message(row):
    """把消息数据库行转为接口字典。"""
    if row is None:
        return None
    data = dict(row)
    data["metadata"] = database.json_loads(data.get("metadata"), {})
    data["token_count"] = int(data.get("token_count") or 0)
    return data


def get_message(message_id):
    """按主键读取消息。"""
    return row_to_message(
        database.fetch_one("SELECT * FROM messages WHERE id = ?", (message_id,))
    )


def _get_messages_in_connection(connection, conversation_id):
    rows = connection.execute(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC",
        (conversation_id,),
    ).fetchall()
    return [row_to_message(row) for row in rows]


def get_messages(conversation_id, limit=None):
    """读取会话消息，默认按 sequence 升序；limit 表示只取最近 N 条。"""
    rows = database.fetch_all(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC",
        (conversation_id,),
    )
    messages = [row_to_message(row) for row in rows]
    if limit is not None and len(messages) > limit:
        return messages[-limit:]
    return messages


def create_message(
    conversation_id, role, content, metadata=None, token_count=0, *,
    connect_fn=database.connect,
):
    """新增消息，sequence 自动递增，并刷新会话时间。"""
    now = database.now_str()
    with closing(connect_fn()) as connection:
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
                database.json_dumps(metadata or {}),
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
        params.append(database.json_dumps(metadata))
    if token_count is not None:
        assignments.append("token_count = ?")
        params.append(int(token_count))
    if assignments:
        params.append(message_id)
        database.execute(
            f"UPDATE messages SET {', '.join(assignments)} WHERE id = ?",
            params,
        )
    return get_message(message_id)


def _replace_messages_in_connection(connection, conversation_id, messages, now):
    connection.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
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
                database.json_dumps(message.get("metadata", {})),
                int(message.get("token_count", 0)),
                message.get("created_at", now),
            ),
        )


def replace_messages(conversation_id, messages, *, connect_fn=database.connect):
    """读档时用快照里的消息整体替换当前消息。"""
    now = database.now_str()
    with closing(connect_fn()) as connection:
        _replace_messages_in_connection(connection, conversation_id, messages, now)
        connection.commit()


def _state_from_row(row, conversation_id=None):
    if row is None:
        return None
    data = {
        "attributes": database.json_loads(row["attributes"], {}),
        "items": database.json_loads(row["items"], []),
        "money": row["money"],
        "relations": database.json_loads(row["relations"], {}),
        "quests": database.json_loads(row["quests"], []),
        "flags": database.json_loads(row["flags"], []),
        "characters": database.json_loads(row["characters"], {}),
        "logs": database.json_loads(row["logs"], []),
    }
    if conversation_id is not None:
        data = {
            "conversation_id": conversation_id,
            **data,
            "updated_at": row["updated_at"],
        }
    return data


def _get_state_in_connection(connection, conversation_id):
    row = connection.execute(
        "SELECT * FROM states WHERE conversation_id = ?", (conversation_id,)
    ).fetchone()
    return _state_from_row(row, conversation_id)


def get_state(conversation_id, *, connect_fn=database.connect):
    """读取会话实时状态；缺失时创建默认状态。"""
    row = database.fetch_one("SELECT * FROM states WHERE conversation_id = ?", (conversation_id,))
    if row is None:
        default = normalize_state({})
        save_state(conversation_id, default, connect_fn=connect_fn)
        return get_state(conversation_id, connect_fn=connect_fn)
    return _state_from_row(row, conversation_id)


def _save_state_row_in_connection(connection, conversation_id, normalized, now):
    connection.execute(
        """
        INSERT INTO states (
            conversation_id, attributes, items, money, relations,
            quests, flags, characters, logs, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            conversation_id,
            database.json_dumps(normalized["attributes"]),
            database.json_dumps(normalized["items"]),
            normalized["money"],
            database.json_dumps(normalized["relations"]),
            database.json_dumps(normalized["quests"]),
            database.json_dumps(normalized["flags"]),
            database.json_dumps(normalized["characters"]),
            database.json_dumps(normalized["logs"]),
            now,
        ),
    )


def _save_state_in_connection(
    connection, conversation_id, state, now, *, sync_conversation=True
):
    normalized = normalize_state(state)
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
            database.json_dumps(normalized["attributes"]),
            database.json_dumps(normalized["items"]),
            normalized["money"],
            database.json_dumps(normalized["relations"]),
            database.json_dumps(normalized["quests"]),
            database.json_dumps(normalized["flags"]),
            database.json_dumps(normalized["characters"]),
            database.json_dumps(normalized["logs"]),
            now,
        ),
    )
    if sync_conversation:
        connection.execute(
            "UPDATE conversations SET current_state = ?, updated_at = ? WHERE id = ?",
            (database.json_dumps(normalized), now, conversation_id),
        )
    return normalized


def save_state(conversation_id, state, *, connect_fn=database.connect):
    """保存实时状态，并同步到会话的 current_state 字段。"""
    normalized = normalize_state(state)
    now = database.now_str()
    existing = database.fetch_one(
        "SELECT id FROM states WHERE conversation_id = ?", (conversation_id,)
    )
    with closing(connect_fn()) as connection:
        if existing:
            connection.execute(
                """
                UPDATE states SET attributes = ?, items = ?, money = ?,
                    relations = ?, quests = ?, flags = ?, characters = ?, logs = ?,
                    updated_at = ?
                WHERE conversation_id = ?
                """,
                (
                    database.json_dumps(normalized["attributes"]),
                    database.json_dumps(normalized["items"]),
                    normalized["money"],
                    database.json_dumps(normalized["relations"]),
                    database.json_dumps(normalized["quests"]),
                    database.json_dumps(normalized["flags"]),
                    database.json_dumps(normalized["characters"]),
                    database.json_dumps(normalized["logs"]),
                    now,
                    conversation_id,
                ),
            )
        else:
            _save_state_row_in_connection(connection, conversation_id, normalized, now)
        connection.execute(
            "UPDATE conversations SET current_state = ?, updated_at = ? WHERE id = ?",
            (database.json_dumps(normalized), now, conversation_id),
        )
        connection.commit()
    return get_state(conversation_id, connect_fn=connect_fn)


def _get_memory_summary_record_in_connection(connection, conversation_id):
    row = connection.execute(
        "SELECT summary, covered_until_sequence, updated_at "
        "FROM memory_summaries WHERE conversation_id = ?",
        (conversation_id,),
    ).fetchone()
    if row is None:
        return {"summary": "", "covered_until_sequence": -1, "updated_at": None}
    return {
        "summary": row["summary"],
        "covered_until_sequence": int(row["covered_until_sequence"]),
        "updated_at": row["updated_at"],
    }


def get_memory_summary_record(conversation_id):
    """读取会话长期记忆摘要。"""
    row = database.fetch_one(
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


def _save_memory_summary_in_connection(
    connection, conversation_id, summary, covered_until_sequence, now
):
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
        (conversation_id, summary, int(covered_until_sequence), now),
    )


def save_memory_summary(
    conversation_id, summary, covered_until_sequence=-1, *,
    connect_fn=database.connect,
):
    """写入会话长期记忆摘要。"""
    now = database.now_str()
    existing = database.fetch_one(
        "SELECT id FROM memory_summaries WHERE conversation_id = ?",
        (conversation_id,),
    )
    with closing(connect_fn()) as connection:
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
