# -*- coding: utf-8 -*-
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend import database


# This is intentionally a pre-Task-1 schema: it has neither of the new
# columns nor the work_cards table.  Keeping the fixture independent from
# database.SCHEMA makes the migration test detect accidental new-schema setup.
LEGACY_SCHEMA = """
CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    relationships TEXT NOT NULL DEFAULT '{}',
    directives TEXT NOT NULL DEFAULT '[]',
    initial_state TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    worldbook_id INTEGER,
    opening TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER,
    card_id INTEGER,
    worldbook_id INTEGER,
    title TEXT NOT NULL DEFAULT 'legacy',
    status TEXT NOT NULL DEFAULT 'active',
    current_state TEXT NOT NULL DEFAULT '{}',
    card_snapshot TEXT NOT NULL DEFAULT '{}',
    parent_conversation_id INTEGER,
    branch_label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    last_message_at TEXT
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    token_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '{}',
    branch_label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL UNIQUE,
    attributes TEXT NOT NULL DEFAULT '{}',
    items TEXT NOT NULL DEFAULT '[]',
    money REAL NOT NULL DEFAULT 0,
    relations TEXT NOT NULL DEFAULT '{}',
    quests TEXT NOT NULL DEFAULT '[]',
    logs TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE memory_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL UNIQUE,
    summary TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);
"""


class MultiRoleCardMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def create_legacy_schema(self):
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.executescript(LEGACY_SCHEMA)

    def legacy_columns(self, table):
        with closing(sqlite3.connect(self.db_path)) as connection:
            return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}

    def test_init_db_migrates_a_real_legacy_schema_idempotently(self):
        self.create_legacy_schema()
        self.assertNotIn("player_attributes", self.legacy_columns("works"))
        self.assertNotIn("card_snapshots", self.legacy_columns("conversations"))
        with closing(sqlite3.connect(self.db_path)) as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_cards'"
                ).fetchone()
            )
            cards = [
                ("dict", {"attributes": {"charisma": 60}}),
                ("list", {"attributes": ["not", "an", "object"]}),
                ("string", {"attributes": "not-an-object"}),
                ("null", {"attributes": None}),
            ]
            card_ids = []
            for name, initial_state in cards:
                cursor = connection.execute(
                    "INSERT INTO cards (name, initial_state) VALUES (?, ?)",
                    (name, json.dumps(initial_state)),
                )
                card_ids.append(cursor.lastrowid)
            work_ids = []
            for name, card_id in zip(("dict work", "list work", "string work", "null work"), card_ids):
                cursor = connection.execute(
                    "INSERT INTO works (title, card_id) VALUES (?, ?)", (name, card_id)
                )
                work_ids.append(cursor.lastrowid)
            null_card_work_id = connection.execute(
                "INSERT INTO works (title, card_id) VALUES (?, NULL)", ("no card",)
            ).lastrowid
            legacy_snapshot = {"name": "legacy conversation card", "persona": "kept"}
            migrating_conversation_id = connection.execute(
                "INSERT INTO conversations (work_id, card_id, card_snapshot) VALUES (?, ?, ?)",
                (work_ids[0], card_ids[0], json.dumps(legacy_snapshot)),
            ).lastrowid
            empty_conversation_id = connection.execute(
                "INSERT INTO conversations (work_id, card_id) VALUES (?, ?)",
                (work_ids[1], None),
            ).lastrowid
            connection.commit()

        database.init_db()

        self.assertTrue({"player_attributes", "onboarding", "cover_url"} <= self.legacy_columns("works"))
        self.assertTrue({"card_snapshots", "onboarding_status"} <= self.legacy_columns("conversations"))
        self.assertEqual(
            database.fetch_all(
                "SELECT card_id, position FROM work_cards WHERE work_id = ?", (work_ids[0],)
            ),
            [{"card_id": card_ids[0], "position": 0}],
        )
        self.assertEqual(
            database.fetch_one(
                "SELECT COUNT(*) AS count FROM work_cards WHERE work_id = ?", (null_card_work_id,)
            )["count"],
            0,
        )
        expected_attributes = [{"charisma": 60}, {}, {}, {}]
        for work_id, expected in zip(work_ids, expected_attributes):
            value = database.fetch_one(
                "SELECT player_attributes FROM works WHERE id = ?", (work_id,)
            )["player_attributes"]
            self.assertEqual(database.json_loads(value), expected)
        self.assertEqual(
            database.json_loads(
                database.fetch_one(
                    "SELECT player_attributes FROM works WHERE id = ?", (null_card_work_id,)
                )["player_attributes"]
            ),
            {},
        )
        self.assertEqual(
            database.json_loads(
                database.fetch_one(
                    "SELECT card_snapshots FROM conversations WHERE id = ?",
                    (migrating_conversation_id,),
                )["card_snapshots"]
            ),
            [legacy_snapshot],
        )
        self.assertEqual(
            database.json_loads(
                database.fetch_one(
                    "SELECT card_snapshots FROM conversations WHERE id = ?", (empty_conversation_id,)
                )["card_snapshots"]
            ),
            [],
        )

        secondary_card_id = database.execute(
            "INSERT INTO cards (name, initial_state) VALUES (?, ?)",
            ("associated card", database.json_dumps({"attributes": {"wisdom": 12}})),
        )
        existing_work_id = database.execute(
            "INSERT INTO works (title, card_id) VALUES (?, ?)", ("existing association", card_ids[0])
        )
        database.execute(
            "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, ?)",
            (existing_work_id, secondary_card_id, 5),
        )
        preserved_snapshots = [{"name": "already valid"}]
        fallback_snapshot = {"name": "fallback"}
        database.execute(
            "UPDATE conversations SET card_snapshots = ?, card_snapshot = ? WHERE id = ?",
            (database.json_dumps(preserved_snapshots), database.json_dumps({"ignored": True}), migrating_conversation_id),
        )
        database.execute(
            "UPDATE conversations SET card_snapshots = ?, card_snapshot = ? WHERE id = ?",
            ("not-json", database.json_dumps(fallback_snapshot), empty_conversation_id),
        )
        null_snapshot_id = database.execute(
            "INSERT INTO conversations (work_id, card_id, card_snapshots, card_snapshot) VALUES (?, ?, ?, ?)",
            (work_ids[2], card_ids[2], "null", database.json_dumps("legacy scalar")),
        )
        object_snapshot_id = database.execute(
            "INSERT INTO conversations (work_id, card_id, card_snapshots, card_snapshot) VALUES (?, ?, ?, ?)",
            (work_ids[3], card_ids[3], "{}", database.json_dumps({"name": "object fallback"})),
        )
        scalar_snapshot_id = database.execute(
            "INSERT INTO conversations (work_id, card_id, card_snapshots, card_snapshot) VALUES (?, ?, ?, ?)",
            (work_ids[3], card_ids[3], "42", database.json_dumps({"name": "scalar fallback"})),
        )
        empty_array_snapshot_id = database.execute(
            "INSERT INTO conversations (work_id, card_id, card_snapshots) VALUES (?, ?, ?)",
            (work_ids[3], None, "[]"),
        )

        database.init_db()

        self.assertEqual(
            database.fetch_all(
                "SELECT card_id, position FROM work_cards WHERE work_id = ?", (existing_work_id,)
            ),
            [{"card_id": secondary_card_id, "position": 5}],
        )
        self.assertEqual(
            database.json_loads(
                database.fetch_one(
                    "SELECT player_attributes FROM works WHERE id = ?", (existing_work_id,)
                )["player_attributes"]
            ),
            {"wisdom": 12},
        )
        for conversation_id, expected in (
            (migrating_conversation_id, preserved_snapshots),
            (empty_conversation_id, [fallback_snapshot]),
            (null_snapshot_id, ["legacy scalar"]),
            (object_snapshot_id, [{"name": "object fallback"}]),
            (scalar_snapshot_id, [{"name": "scalar fallback"}]),
            (empty_array_snapshot_id, []),
        ):
            value = database.fetch_one(
                "SELECT card_snapshots FROM conversations WHERE id = ?", (conversation_id,)
            )["card_snapshots"]
            self.assertEqual(database.json_loads(value), expected)

        with closing(database.connect()) as connection:
            foreign_keys = {
                row["from"]: row["on_delete"]
                for row in connection.execute("PRAGMA foreign_key_list(work_cards)")
            }
            self.assertEqual(foreign_keys, {"work_id": "CASCADE", "card_id": "RESTRICT"})
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, ?)",
                    (existing_work_id, card_ids[0], 5),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, ?)",
                    (existing_work_id, secondary_card_id, 6),
                )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, ?)",
                    (999999, card_ids[0], 6),
                )

    def test_init_db_rolls_back_schema_changes_when_backfill_fails(self):
        self.create_legacy_schema()
        with closing(sqlite3.connect(self.db_path)) as connection:
            card_id = connection.execute(
                "INSERT INTO cards (name, initial_state) VALUES (?, ?)",
                ("failing card", json.dumps({"attributes": {"luck": 7}})),
            ).lastrowid
            connection.execute("INSERT INTO works (title, card_id) VALUES (?, ?)", ("failing work", card_id))
            connection.execute(
                """
                CREATE TRIGGER reject_player_attribute_backfill
                BEFORE UPDATE OF player_attributes ON works
                BEGIN
                    SELECT RAISE(ABORT, 'forced backfill failure');
                END;
                """
            )
            connection.commit()

        with self.assertRaisesRegex(sqlite3.IntegrityError, "forced backfill failure"):
            database.init_db()

        # init_db uses an explicit transaction around executescript schema work,
        # ALTER TABLE operations, and backfills; a failed backfill rolls all of it back.
        self.assertNotIn("player_attributes", self.legacy_columns("works"))
        self.assertNotIn("card_snapshots", self.legacy_columns("conversations"))
        with closing(sqlite3.connect(self.db_path)) as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_cards'"
                ).fetchone()
            )


if __name__ == "__main__":
    unittest.main()
