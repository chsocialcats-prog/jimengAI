# -*- coding: utf-8 -*-
import json
import sqlite3
import unittest
from contextlib import closing

from fastapi import HTTPException
from pydantic import ValidationError

from backend import database, repositories
from backend.routers import works_routes
from backend.schemas import WorkCreate, WorkUpdate
from backend.services import adventure_engine
from backend.test_helpers import IsolatedDatabaseTestCase


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


class MultiRoleCardMigrationTests(IsolatedDatabaseTestCase):
    initialize_database = False

    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

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
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            ("", work_ids[0]),
        )
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            (database.json_dumps(["not", "an", "object"]), work_ids[1]),
        )
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            (database.json_dumps("not-an-object"), work_ids[2]),
        )
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            ("not-json", work_ids[3]),
        )
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            (database.json_dumps(["no", "card"]), null_card_work_id),
        )
        database.execute(
            "UPDATE works SET player_attributes = ? WHERE id = ?",
            (database.json_dumps({"pinned": 1}), existing_work_id),
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
            {"pinned": 1},
        )
        for work_id, expected in (
            (work_ids[0], {"charisma": 60}),
            (work_ids[1], {}),
            (work_ids[2], {}),
            (work_ids[3], {}),
            (null_card_work_id, {}),
        ):
            value = database.fetch_one(
                "SELECT player_attributes FROM works WHERE id = ?", (work_id,)
            )["player_attributes"]
            self.assertEqual(database.json_loads(value), expected)
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
class MultiRoleCardWorkApiTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

    def create_card(self, name):
        return repositories.create_card({"name": name}, owner_user_id=self.test_user.id)

    def test_create_and_list_preserve_ordered_cards_and_player_attributes(self):
        first = self.create_card("第一张")
        second = self.create_card("第二张")
        created = works_routes.create_work(
            WorkCreate(title="多卡剧本", card_ids=[second["id"], first["id"]], player_attributes={"体力": 80}),
            user=self.test_user,
        )

        self.assertEqual(created["card_ids"], [second["id"], first["id"]])
        self.assertEqual([card["id"] for card in created["cards"]], [second["id"], first["id"]])
        self.assertEqual(created["card_id"], second["id"])
        self.assertEqual(created["card"]["id"], second["id"])
        self.assertEqual(created["player_attributes"], {"体力": 80})
        self.assertEqual(
            works_routes.list_works(page=1, page_size=20, viewer=self.test_user)["items"][0]["card_ids"],
            [second["id"], first["id"]],
        )

    def test_cards_can_be_reused_by_different_works(self):
        card = self.create_card("可复用")
        first_work = works_routes.create_work(WorkCreate(title="剧本一", card_ids=[card["id"]]), user=self.test_user)
        second_work = works_routes.create_work(WorkCreate(title="剧本二", card_ids=[card["id"]]), user=self.test_user)

        self.assertEqual(first_work["card_ids"], [card["id"]])
        self.assertEqual(second_work["card_ids"], [card["id"]])

    def test_update_retains_omitted_attributes_and_clears_explicit_values(self):
        first = self.create_card("第一张")
        second = self.create_card("第二张")
        work = works_routes.create_work(
            WorkCreate(title="待更新", card_ids=[first["id"], second["id"]], player_attributes={"体力": 80}), user=self.test_user
        )

        retained = works_routes.update_work(work["id"], WorkUpdate(title="只改标题"), user=self.test_user)
        cleared_cards = works_routes.update_work(work["id"], WorkUpdate(card_ids=[], player_attributes={}), user=self.test_user)

        self.assertEqual(retained["card_ids"], [first["id"], second["id"]])
        self.assertEqual(retained["player_attributes"], {"体力": 80})
        self.assertEqual(cleared_cards["card_ids"], [])
        self.assertIsNone(cleared_cards["card_id"])
        self.assertIsNone(cleared_cards["card"])
        self.assertEqual(cleared_cards["cards"], [])
        self.assertEqual(cleared_cards["player_attributes"], {})

    def test_legacy_card_id_remains_compatible_and_explicit_null_clears_list(self):
        card = self.create_card("旧接口")
        work = works_routes.create_work(WorkCreate(title="旧剧本", card_id=card["id"]), user=self.test_user)
        cleared = works_routes.update_work(work["id"], WorkUpdate(card_id=None), user=self.test_user)

        self.assertEqual(work["card_ids"], [card["id"]])
        self.assertEqual(work["card"]["id"], card["id"])
        self.assertEqual(cleared["card_ids"], [])
        self.assertIsNone(cleared["card_id"])

    def test_missing_or_duplicate_card_ids_are_rejected_without_partial_update(self):
        first = self.create_card("第一张")
        second = self.create_card("第二张")
        work = works_routes.create_work(WorkCreate(title="原始标题", card_ids=[first["id"]]), user=self.test_user)

        with self.assertRaises(HTTPException) as missing:
            works_routes.update_work(work["id"], WorkUpdate(title="不应写入", card_ids=[second["id"], 999999]), user=self.test_user)
        with self.assertRaises(HTTPException) as duplicate:
            works_routes.create_work(WorkCreate(title="重复", card_ids=[first["id"], first["id"]]), user=self.test_user)

        self.assertEqual(missing.exception.status_code, 422)
        self.assertEqual(missing.exception.detail["code"], "validation_error")
        self.assertEqual(duplicate.exception.status_code, 422)
        self.assertEqual(repositories.get_work(work["id"])["title"], "原始标题")
        self.assertEqual(repositories.get_work(work["id"])["card_ids"], [first["id"]])

    def test_invalid_player_attributes_are_rejected_as_a_non_object(self):
        with self.assertRaises(ValidationError):
            WorkCreate(title="无效属性", player_attributes=["体力", 80])

    def test_legacy_work_without_association_rows_reads_as_one_card_list(self):
        card = self.create_card("遗留卡")
        work_id = database.execute(
            "INSERT INTO works (owner_user_id, title, card_id) VALUES (?, ?, ?)",
            (self.test_user.id, "遗留剧本", card["id"]),
        )

        work = repositories.get_work(work_id)

        self.assertEqual(work["card_ids"], [card["id"]])
        self.assertEqual(work["cards"][0]["id"], card["id"])
        self.assertEqual(work["card_id"], card["id"])

    def test_deleting_any_position_reference_is_atomic(self):
        first = self.create_card("首卡")
        second = self.create_card("后卡")
        work = works_routes.create_work(WorkCreate(title="受保护", card_ids=[first["id"], second["id"]]), user=self.test_user)

        with self.assertRaises(repositories.CardReferenceConflict) as conflict:
            repositories.delete_card(second["id"], owner_user_id=self.test_user.id)

        self.assertEqual(conflict.exception.works, [{"id": work["id"], "title": "受保护"}])
        self.assertIsNotNone(repositories.get_card(second["id"]))
        self.assertEqual(repositories.get_work(work["id"])["card_ids"], [first["id"], second["id"]])


class MultiRoleCardConversationTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

    def create_card(self, name, persona):
        return repositories.create_card({
            "name": name,
            "persona": persona,
            "personality": f"{name} personality",
            "speaking_style": f"{name} speaking style",
            "relationships": {"player": f"{name} relationship"},
            "directives": [f"{name} directive"],
            "initial_state": {"attributes": {"legacy": 1}},
            "character_attributes": {"mood": 50},
        }, owner_user_id=self.test_user.id)

    def test_new_conversation_snapshots_all_cards_in_order_and_uses_work_attributes(self):
        first = self.create_card("first card", "first frozen persona")
        second = self.create_card("second card", "second frozen persona")
        work = repositories.create_work({
            "title": "multi-card work",
            "card_ids": [first["id"], second["id"]],
            "player_attributes": {"stamina": 80},
        }, owner_user_id=self.test_user.id)

        conversation = repositories.create_conversation(work["id"], "snapshot session", user_id=self.test_user.id)

        self.assertEqual(
            [card["name"] for card in conversation["card_snapshots"]],
            ["first card", "second card"],
        )
        self.assertEqual(conversation["card_snapshot"]["name"], "first card")
        self.assertEqual(conversation["card_id"], first["id"])
        self.assertEqual(repositories.get_state(conversation["id"], user_id=self.test_user.id)["attributes"], {"stamina": 80})
        self.assertEqual(conversation["current_state"]["attributes"], {"stamina": 80})

        repositories.update_card(first["id"], {"persona": "edited live persona"}, owner_user_id=self.test_user.id)
        self.assertEqual(
            repositories.get_conversation_cards(conversation)[0]["persona"],
            "first frozen persona",
        )

    def test_snapshot_authority_survives_live_card_changes_and_new_sessions_use_current_order(self):
        first = self.create_card("first card", "first frozen persona")
        second = self.create_card("second card", "second frozen persona")
        work = repositories.create_work({
            "title": "multi-card work",
            "card_ids": [first["id"], second["id"]],
            "player_attributes": {"stamina": 80},
        }, owner_user_id=self.test_user.id)
        old_conversation = repositories.create_conversation(work["id"], "old session", user_id=self.test_user.id)

        repositories.update_card(first["id"], {"persona": "first current persona"}, owner_user_id=self.test_user.id)
        repositories.update_card(second["id"], {"persona": "second current persona"}, owner_user_id=self.test_user.id)
        repositories.update_work(work["id"], {
            "card_ids": [second["id"], first["id"]],
            "player_attributes": {"stamina": 99},
        }, owner_user_id=self.test_user.id)
        new_conversation = repositories.create_conversation(work["id"], "new session", user_id=self.test_user.id)

        old_prompt = adventure_engine.build_messages(self.access_for(old_conversation))[0]["content"]
        new_prompt = adventure_engine.build_messages(self.access_for(new_conversation))[0]["content"]
        self.assertLess(old_prompt.index("first frozen persona"), old_prompt.index("second frozen persona"))
        self.assertNotIn("first current persona", old_prompt)
        self.assertLess(new_prompt.index("second current persona"), new_prompt.index("first current persona"))
        self.assertIn("second current persona", new_prompt)
        self.assertEqual(repositories.get_state(new_conversation["id"], user_id=self.test_user.id)["attributes"], {"stamina": 99})

        repositories.update_work(work["id"], {"card_ids": []}, owner_user_id=self.test_user.id)
        repositories.delete_card(first["id"], owner_user_id=self.test_user.id)
        repositories.delete_card(second["id"], owner_user_id=self.test_user.id)
        self.assertIn("first frozen persona", adventure_engine.build_messages(self.access_for(old_conversation))[0]["content"])
        self.assertIn("second frozen persona", adventure_engine.build_messages(self.access_for(old_conversation))[0]["content"])

    def test_empty_work_creates_compatible_no_card_conversation(self):
        work = repositories.create_work({"title": "no-card work", "player_attributes": {"luck": 7}}, owner_user_id=self.test_user.id)

        conversation = repositories.create_conversation(work["id"], "no-card session", user_id=self.test_user.id)

        self.assertEqual(conversation["card_snapshots"], [])
        self.assertEqual(conversation["card_snapshot"], {})
        self.assertIsNone(conversation["card_id"])
        self.assertEqual(repositories.get_state(conversation["id"], user_id=self.test_user.id)["attributes"], {"luck": 7})
        self.assertEqual(repositories.get_conversation_cards(conversation), [])
        self.assertNotIn("角色卡：", adventure_engine.build_messages(self.access_for(conversation))[0]["content"])

        later_card = self.create_card("later card", "must not leak into this session")
        repositories.update_work(work["id"], {"card_ids": [later_card["id"]]}, owner_user_id=self.test_user.id)
        reloaded = repositories.get_conversation(conversation["id"], self.test_user.id)

        self.assertEqual(reloaded["card_snapshots"], [])
        self.assertEqual(reloaded["card_snapshot"], {})
        self.assertEqual(repositories.get_conversation_cards(reloaded), [])
        self.assertIsNone(repositories.get_conversation_card(reloaded))
        self.assertNotIn("must not leak into this session", adventure_engine.build_messages(self.access_for(conversation))[0]["content"])

    def test_no_card_snapshot_stays_empty_after_restart_and_cleans_marker_array(self):
        work = repositories.create_work({"title": "restart-safe no-card work"}, owner_user_id=self.test_user.id)
        conversation = repositories.create_conversation(work["id"], "restart-safe no-card session", user_id=self.test_user.id)

        database.init_db()

        reloaded = repositories.get_conversation(conversation["id"], self.test_user.id)
        self.assertEqual(reloaded["card_snapshots"], [])
        self.assertEqual(repositories.get_conversation_cards(reloaded), [])

        database.execute(
            "UPDATE conversations SET card_snapshots = ? WHERE id = ?",
            (database.json_dumps([{"_conversation_card_snapshots_authoritative": True}]), conversation["id"]),
        )
        database.init_db()

        cleaned = repositories.get_conversation(conversation["id"], self.test_user.id)
        self.assertEqual(cleaned["card_snapshots"], [])
        self.assertEqual(repositories.get_conversation_cards(cleaned), [])

    def test_legacy_empty_snapshots_still_fall_back_to_live_work_cards(self):
        card = self.create_card("legacy card", "live legacy persona")
        work = repositories.create_work({
            "title": "legacy fallback work",
            "card_ids": [card["id"]],
        }, owner_user_id=self.test_user.id)
        conversation = repositories.create_conversation(work["id"], "legacy session", user_id=self.test_user.id)
        database.execute(
            "UPDATE conversations SET card_snapshot = ?, card_snapshots = ? WHERE id = ?",
            (database.json_dumps({}), database.json_dumps([]), conversation["id"]),
        )

        reloaded = repositories.get_conversation(conversation["id"], self.test_user.id)

        self.assertEqual(
            [item["name"] for item in repositories.get_conversation_cards(reloaded)],
            ["legacy card"],
        )

    def test_branch_copies_frozen_cards_and_current_player_attributes(self):
        first = self.create_card("first card", "first frozen persona")
        second = self.create_card("second card", "second frozen persona")
        work = repositories.create_work({
            "title": "branch work",
            "card_ids": [first["id"], second["id"]],
            "player_attributes": {"stamina": 80},
        }, owner_user_id=self.test_user.id)
        original = repositories.create_conversation(work["id"], "original", user_id=self.test_user.id)
        repositories.save_state(original["id"], {"attributes": {"stamina": 66}}, user_id=self.test_user.id)

        branch = repositories.create_conversation_branch(original["id"], "branch", "alternate", user_id=self.test_user.id)

        self.assertEqual(branch["parent_conversation_id"], original["id"])
        self.assertEqual(branch["card_snapshots"], original["card_snapshots"])
        self.assertEqual(repositories.get_state(branch["id"], user_id=self.test_user.id)["attributes"], {"stamina": 66})
        repositories.update_card(first["id"], {"persona": "changed after branch"}, owner_user_id=self.test_user.id)
        self.assertIn("first frozen persona", adventure_engine.build_messages(self.access_for(branch))[0]["content"])


if __name__ == "__main__":
    unittest.main()
