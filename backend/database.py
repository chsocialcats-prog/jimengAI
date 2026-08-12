# -*- coding: utf-8 -*-
"""SQLite 初始化、连接与通用查询工具。

数据库文件统一放在项目根目录的 data/app.db。
"""

import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from .config import PROJECT_ROOT

DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "app.db"

SCHEMA = """
-- 角色卡：人设、说话方式、关系、固定设定和初始状态
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    persona TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    speaking_style TEXT NOT NULL DEFAULT '',
    relationships TEXT NOT NULL DEFAULT '{}',
    directives TEXT NOT NULL DEFAULT '[]',
    initial_state TEXT NOT NULL DEFAULT '{}',
    character_attributes TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 世界书：一组按关键词触发注入的设定条目
CREATE TABLE IF NOT EXISTS worldbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS worldbook_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worldbook_id INTEGER NOT NULL
        REFERENCES worldbooks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    content TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 作品：角色卡、世界书与开场剧情的组合
CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    player_attributes TEXT NOT NULL DEFAULT '{}',
    worldbook_id INTEGER REFERENCES worldbooks(id) ON DELETE SET NULL,
    opening TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    onboarding TEXT NOT NULL DEFAULT '{}',
    cover_url TEXT NOT NULL DEFAULT '',
    reply_templates TEXT NOT NULL DEFAULT '[]',
    active_reply_template_id TEXT NOT NULL DEFAULT '',
    is_archive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS work_cards (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    PRIMARY KEY (work_id, card_id),
    UNIQUE (work_id, position)
);

-- 冒险会话：一次游玩记录，当前状态和分支信息放在这里
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    worldbook_id INTEGER REFERENCES worldbooks(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '新的冒险',
    status TEXT NOT NULL DEFAULT 'active',
    current_state TEXT NOT NULL DEFAULT '{}',
    card_snapshot TEXT NOT NULL DEFAULT '{}',
    card_snapshots TEXT NOT NULL DEFAULT '[]',
    parent_conversation_id INTEGER
        REFERENCES conversations(id) ON DELETE SET NULL,
    branch_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_message_at TEXT,
    onboarding_status TEXT NOT NULL DEFAULT 'completed',
    onboarding_config TEXT NOT NULL DEFAULT '{}',
    onboarding_answers TEXT NOT NULL DEFAULT '{}'
    ,persona_corrections TEXT NOT NULL DEFAULT '[]'
    ,memory_corrections TEXT NOT NULL DEFAULT '[]'
);

-- 消息：角色、玩家和系统产生的文本
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    token_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 存档：完整状态与分支节点信息
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL
        REFERENCES conversations(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '手动存档',
    state TEXT NOT NULL DEFAULT '{}',
    messages TEXT NOT NULL DEFAULT '[]',
    memory_summary TEXT NOT NULL DEFAULT '',
    memory_summary_covered_until_sequence INTEGER NOT NULL DEFAULT -1,
    persona_corrections TEXT,
    memory_corrections TEXT,
    branch_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 实时状态：属性、物品、金钱、关系、任务和日志
CREATE TABLE IF NOT EXISTS states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL UNIQUE
        REFERENCES conversations(id) ON DELETE CASCADE,
    attributes TEXT NOT NULL DEFAULT '{}',
    items TEXT NOT NULL DEFAULT '[]',
    money REAL NOT NULL DEFAULT 0,
    relations TEXT NOT NULL DEFAULT '{}',
    quests TEXT NOT NULL DEFAULT '[]',
    flags TEXT NOT NULL DEFAULT '[]',
    characters TEXT NOT NULL DEFAULT '{}',
    logs TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 记忆摘要：旧对话压缩后的长期记忆
CREATE TABLE IF NOT EXISTS memory_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL UNIQUE
        REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    covered_until_sequence INTEGER NOT NULL DEFAULT -1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_worldbook_entries_worldbook
    ON worldbook_entries(worldbook_id);
CREATE INDEX IF NOT EXISTS idx_works_card ON works(card_id);
CREATE INDEX IF NOT EXISTS idx_works_worldbook ON works(worldbook_id);
CREATE INDEX IF NOT EXISTS idx_work_cards_work_position
    ON work_cards(work_id, position);
CREATE INDEX IF NOT EXISTS idx_conversations_work
    ON conversations(work_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sequence
    ON messages(conversation_id, sequence);
CREATE INDEX IF NOT EXISTS idx_snapshots_conversation
    ON snapshots(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_states_conversation
    ON states(conversation_id);
"""


def now_str():
    """返回本地时间的 ISO 8601 字符串。"""
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def json_dumps(value):
    """将 Python 对象转为紧凑 JSON 文本，保留中文。"""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value, default=None):
    """安全解析 JSON 文本；解析失败时返回默认值。"""
    if value in (None, ""):
        return default if default is not None else {}
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else {}


def fetch_one(query, params=()):
    """执行查询并返回单行字典；无结果时返回 None。"""
    with closing(connect()) as connection:
        row = connection.execute(query, params).fetchone()
        return dict(row) if row is not None else None


def fetch_all(query, params=()):
    """执行查询并返回字典列表。"""
    with closing(connect()) as connection:
        return [dict(row) for row in connection.execute(query, params).fetchall()]


def execute(query, params=()):
    """执行写操作并提交事务，返回 lastrowid。"""
    with closing(connect()) as connection:
        cursor = connection.execute(query, params)
        connection.commit()
        return cursor.lastrowid


def _ensure_column(connection, table, column, ddl):
    """旧数据库缺列时自动补列，避免重复建表覆盖已有数据。"""
    columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
    if column not in columns:
        connection.execute(ddl)


def connect():
    """创建 SQLite 连接，并启用并发访问所需的安全设置。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    # WAL 允许读操作与一个写操作并行；busy_timeout 让短暂的写锁竞争等待，
    # 而不是立刻向 API 返回 "database is locked"。FULL 优先保证断电后的完整性。
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = FULL")
    return connection


def _normalize_message_sequences(connection):
    """为旧库中的消息重排顺序，为唯一约束迁移做好准备。"""
    has_duplicates = connection.execute(
        "SELECT 1 FROM messages GROUP BY conversation_id, sequence "
        "HAVING COUNT(*) > 1 LIMIT 1"
    ).fetchone()
    if has_duplicates is None:
        return
    rows = connection.execute(
        "SELECT id, conversation_id FROM messages "
        "ORDER BY conversation_id ASC, sequence ASC, id ASC"
    ).fetchall()
    current_conversation_id = None
    sequence = 0
    for row in rows:
        if row["conversation_id"] != current_conversation_id:
            current_conversation_id = row["conversation_id"]
            sequence = 0
        connection.execute(
            "UPDATE messages SET sequence = ? WHERE id = ?",
            (sequence, row["id"]),
        )
        sequence += 1


def _backfill_conversation_card_snapshots(connection):
    """为缺少角色卡快照的历史会话保存当前角色卡内容。"""
    rows = connection.execute(
        """
        SELECT conversations.id AS conversation_id, cards.*
        FROM conversations
        JOIN cards ON cards.id = conversations.card_id
        WHERE conversations.card_id IS NOT NULL
          AND (
              conversations.card_snapshot IS NULL
              OR TRIM(conversations.card_snapshot) IN ('', '{}')
          )
        """
    ).fetchall()
    for row in rows:
        card = dict(row)
        conversation_id = card.pop("conversation_id")
        for column, default in (
            ("relationships", {}),
            ("directives", []),
            ("initial_state", {}),
            ("character_attributes", {}),
        ):
            card[column] = json_loads(card[column], default)
        connection.execute(
            """
            UPDATE conversations
            SET card_snapshot = ?
            WHERE id = ?
              AND card_id IS NOT NULL
              AND (
                  card_snapshot IS NULL
                  OR TRIM(card_snapshot) IN ('', '{}')
              )
            """,
            (json_dumps(card), conversation_id),
        )


def _backfill_work_cards(connection):
    """将旧 works.card_id 迁移为第一个有序角色卡关联。"""
    connection.execute(
        """
        INSERT OR IGNORE INTO work_cards (work_id, card_id, position)
        SELECT works.id, works.card_id, 0
        FROM works
        WHERE works.card_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM work_cards
              WHERE work_cards.work_id = works.id
          )
        """
    )


def _backfill_work_player_attributes(connection):
    """从每个旧剧本的首张角色卡复制玩家初始属性。"""
    rows = connection.execute(
        """
        SELECT works.id AS work_id, works.player_attributes, cards.initial_state
        FROM works
        LEFT JOIN work_cards
          ON work_cards.work_id = works.id
         AND work_cards.position = (
             SELECT MIN(first_card.position)
             FROM work_cards AS first_card
             WHERE first_card.work_id = works.id
         )
        LEFT JOIN cards ON cards.id = work_cards.card_id
        """
    ).fetchall()
    for row in rows:
        raw_attributes = row["player_attributes"]
        if raw_attributes is None or str(raw_attributes).strip() in ("", "{}"):
            initial_state = json_loads(row["initial_state"], {})
            attributes = (
                initial_state.get("attributes", {})
                if isinstance(initial_state, dict)
                else {}
            )
            if not isinstance(attributes, dict):
                attributes = {}
        elif isinstance(json_loads(raw_attributes, None), dict):
            continue
        else:
            attributes = {}

        normalized_attributes = json_dumps(attributes)
        if raw_attributes == normalized_attributes:
            continue
        connection.execute(
            """
            UPDATE works
            SET player_attributes = ?
            WHERE id = ?
            """,
            (normalized_attributes, row["work_id"]),
        )


def _backfill_conversation_card_snapshot_arrays(connection):
    """将旧的单角色会话快照包装成多角色快照数组。"""
    empty_snapshot_marker = {"_conversation_card_snapshots_authoritative": True}
    rows = connection.execute(
        """
        SELECT id, card_snapshot, card_snapshots
        FROM conversations
        """
    ).fetchall()
    for row in rows:
        try:
            card_snapshots = json.loads(row["card_snapshots"])
        except (json.JSONDecodeError, TypeError):
            card_snapshots = None
        if isinstance(card_snapshots, list):
            cleaned_snapshots = [
                snapshot
                for snapshot in card_snapshots
                if snapshot != empty_snapshot_marker
            ]
            if cleaned_snapshots != card_snapshots:
                connection.execute(
                    "UPDATE conversations SET card_snapshots = ? WHERE id = ?",
                    (json_dumps(cleaned_snapshots), row["id"]),
                )
                continue
        if isinstance(card_snapshots, list) and card_snapshots:
            continue

        raw_card_snapshot = row["card_snapshot"]
        if raw_card_snapshot is None or not str(raw_card_snapshot).strip():
            card_snapshots = []
        else:
            try:
                card_snapshot = json.loads(raw_card_snapshot)
            except (json.JSONDecodeError, TypeError):
                card_snapshot = raw_card_snapshot
            if card_snapshot in (None, {}, [], "") or card_snapshot == empty_snapshot_marker:
                card_snapshots = []
            else:
                card_snapshots = [card_snapshot]
        connection.execute(
            """
            UPDATE conversations
            SET card_snapshots = ?
            WHERE id = ?
            """,
            (json_dumps(card_snapshots), row["id"]),
        )


def init_db():
    """初始化数据库目录、基础表与索引。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as connection:
        try:
            # executescript() commits a pending transaction before its script.
            # Starting the transaction in that script keeps schema DDL, ALTERs,
            # and backfills in one rollback boundary.
            connection.executescript("BEGIN IMMEDIATE;\n" + SCHEMA)
            # 早期版本仅有普通索引，可能已经写入了重复 sequence；先无损重排，
            # 再加唯一约束，避免迁移失败或以后发生并发顺序冲突。
            _normalize_message_sequences(connection)
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_messages_conversation_sequence "
                "ON messages(conversation_id, sequence)"
            )
            _ensure_column(
                connection,
                "states",
                "flags",
                "ALTER TABLE states ADD COLUMN flags TEXT NOT NULL DEFAULT '[]'",
            )
            _ensure_column(
                connection,
                "states",
                "characters",
                "ALTER TABLE states ADD COLUMN characters TEXT NOT NULL DEFAULT '{}'",
            )
            _ensure_column(
                connection,
                "cards",
                "character_attributes",
                "ALTER TABLE cards ADD COLUMN character_attributes TEXT NOT NULL DEFAULT '{}'",
            )
            _ensure_column(
                connection,
                "works",
                "player_attributes",
                "ALTER TABLE works ADD COLUMN player_attributes TEXT NOT NULL DEFAULT '{}'",
            )
            _ensure_column(connection, "works", "onboarding", "ALTER TABLE works ADD COLUMN onboarding TEXT NOT NULL DEFAULT '{}'")
            _ensure_column(connection, "works", "cover_url", "ALTER TABLE works ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''")
            _ensure_column(connection, "works", "reply_templates", "ALTER TABLE works ADD COLUMN reply_templates TEXT NOT NULL DEFAULT '[]'")
            _ensure_column(connection, "works", "active_reply_template_id", "ALTER TABLE works ADD COLUMN active_reply_template_id TEXT NOT NULL DEFAULT ''")
            _ensure_column(connection, "conversations", "onboarding_status", "ALTER TABLE conversations ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'completed'")
            _ensure_column(connection, "conversations", "onboarding_config", "ALTER TABLE conversations ADD COLUMN onboarding_config TEXT NOT NULL DEFAULT '{}'")
            _ensure_column(connection, "conversations", "onboarding_answers", "ALTER TABLE conversations ADD COLUMN onboarding_answers TEXT NOT NULL DEFAULT '{}'")
            _ensure_column(connection, "conversations", "persona_corrections", "ALTER TABLE conversations ADD COLUMN persona_corrections TEXT NOT NULL DEFAULT '[]'")
            _ensure_column(connection, "conversations", "memory_corrections", "ALTER TABLE conversations ADD COLUMN memory_corrections TEXT NOT NULL DEFAULT '[]'")
            _ensure_column(connection, "conversations", "card_snapshot", "ALTER TABLE conversations ADD COLUMN card_snapshot TEXT NOT NULL DEFAULT '{}'")
            _ensure_column(
                connection,
                "conversations",
                "card_snapshots",
                "ALTER TABLE conversations ADD COLUMN card_snapshots TEXT NOT NULL DEFAULT '[]'",
            )
            _backfill_work_cards(connection)
            _backfill_work_player_attributes(connection)
            _backfill_conversation_card_snapshots(connection)
            _backfill_conversation_card_snapshot_arrays(connection)
            _ensure_column(
                connection,
                "snapshots",
                "messages",
                "ALTER TABLE snapshots ADD COLUMN messages TEXT NOT NULL DEFAULT '[]'",
            )
            _ensure_column(
                connection,
                "snapshots",
                "memory_summary",
                "ALTER TABLE snapshots ADD COLUMN memory_summary TEXT NOT NULL DEFAULT ''",
            )
            _ensure_column(
                connection,
                "snapshots",
                "memory_summary_covered_until_sequence",
                "ALTER TABLE snapshots ADD COLUMN memory_summary_covered_until_sequence INTEGER NOT NULL DEFAULT -1",
            )
            _ensure_column(
                connection,
                "snapshots",
                "persona_corrections",
                "ALTER TABLE snapshots ADD COLUMN persona_corrections TEXT",
            )
            _ensure_column(
                connection,
                "snapshots",
                "memory_corrections",
                "ALTER TABLE snapshots ADD COLUMN memory_corrections TEXT",
            )
            _ensure_column(
                connection,
                "memory_summaries",
                "covered_until_sequence",
                "ALTER TABLE memory_summaries ADD COLUMN covered_until_sequence INTEGER NOT NULL DEFAULT -1",
            )
            connection.execute("PRAGMA user_version = 2")
            connection.commit()
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise
    return DB_PATH
