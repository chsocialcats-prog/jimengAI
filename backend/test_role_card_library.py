import unittest
from contextlib import closing
from unittest.mock import patch

from fastapi import HTTPException

from backend import database, repositories
from backend.routers import cards_routes, works_routes
from backend.schemas import WorkUpdate
from backend.services import adventure_engine
from backend.test_helpers import IsolatedDatabaseTestCase


class RoleCardLibraryTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

    def create_card(self):
        return repositories.create_card({"name": "测试角色"})

    def test_lists_referencing_works_by_latest_update(self):
        card = self.create_card()
        work = repositories.create_work({"title": "引用剧本", "card_id": card["id"]})

        self.assertEqual(
            repositories.list_card_references(card["id"]),
            [{"id": work["id"], "title": "引用剧本"}],
        )

    def test_delete_card_rejects_referenced_card_and_preserves_it(self):
        card = self.create_card()
        work = repositories.create_work({"title": "引用剧本", "card_id": card["id"]})

        with self.assertRaises(repositories.CardReferenceConflict) as context:
            repositories.delete_card(card["id"])

        self.assertEqual(context.exception.works, [{"id": work["id"], "title": "引用剧本"}])
        self.assertIsNotNone(repositories.get_card(card["id"]))

    def test_delete_card_removes_unreferenced_card(self):
        card = self.create_card()

        repositories.delete_card(card["id"])

        self.assertIsNone(repositories.get_card(card["id"]))

    def test_delete_checks_references_and_deletes_in_one_write_transaction(self):
        card = self.create_card()
        connection = database.connect()
        statements = []

        class RecordingConnection:
            def execute(self, query, params=()):
                statements.append(query)
                return connection.execute(query, params)

            def commit(self):
                return connection.commit()

            def rollback(self):
                return connection.rollback()

            def close(self):
                return connection.close()

        try:
            with patch.object(repositories, "connect", return_value=RecordingConnection()):
                repositories.delete_card(card["id"])
        finally:
            connection.close()

        self.assertEqual(statements[:1], ["BEGIN IMMEDIATE"])
        reference_queries = [
            index
            for index, query in enumerate(statements)
            if "FROM works WHERE card_id = ?" in query
        ]
        delete_index = statements.index("DELETE FROM cards WHERE id = ?")
        self.assertEqual(len(reference_queries), 1)
        self.assertLess(reference_queries[0], delete_index)

    def test_router_returns_conflict_for_referenced_card(self):
        card = self.create_card()
        work = repositories.create_work({"title": "引用剧本", "card_id": card["id"]})

        with self.assertRaises(HTTPException) as context:
            cards_routes.delete_card(card["id"])

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail["code"], "conflict")
        self.assertIn(
            {"id": work["id"], "title": "引用剧本"},
            context.exception.detail["works"],
        )

    def test_work_route_clears_an_explicit_card_reference(self):
        card = self.create_card()
        work = repositories.create_work({"title": "引用剧本", "card_id": card["id"]})

        updated = works_routes.update_work(work["id"], WorkUpdate(card_id=None))

        self.assertIsNone(updated["card_id"])


class CardSnapshotTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

    def create_work_with_card(self, persona, **card_data):
        card = repositories.create_card(
            {"name": "快照角色", "persona": persona, **card_data}
        )
        work = repositories.create_work(
            {"title": "快照剧本", "card_id": card["id"]}
        )
        return card, work

    def test_new_conversation_copies_card_persona_into_snapshot(self):
        _, work = self.create_work_with_card("创建时人设")

        conversation = repositories.create_conversation(work["id"], "首次会话")

        self.assertEqual(
            (conversation.get("card_snapshot") or {}).get("persona"),
            "创建时人设",
        )

    def test_build_messages_uses_old_snapshot_after_card_changes(self):
        card, work = self.create_work_with_card("旧人设")
        old_conversation = repositories.create_conversation(work["id"], "旧会话")
        repositories.update_card(card["id"], {"persona": "新人设"})
        new_conversation = repositories.create_conversation(work["id"], "新会话")

        old_system_prompt = adventure_engine.build_messages(old_conversation["id"])[0]["content"]
        new_system_prompt = adventure_engine.build_messages(new_conversation["id"])[0]["content"]

        self.assertIn("旧人设", old_system_prompt)
        self.assertNotIn("新人设", old_system_prompt)
        self.assertIn("新人设", new_system_prompt)
        self.assertNotIn("旧人设", new_system_prompt)

    def test_snapshot_remains_authoritative_after_work_is_cleared_and_card_deleted(self):
        card, work = self.create_work_with_card("已固定人设")
        conversation = repositories.create_conversation(work["id"], "保留快照的会话")

        works_routes.update_work(work["id"], WorkUpdate(card_id=None))
        repositories.delete_card(card["id"])
        resolved_card = repositories.get_conversation_card(
            repositories.get_conversation(conversation["id"])
        )

        self.assertEqual(resolved_card["persona"], "已固定人设")

    def test_init_db_backfills_empty_snapshot_without_overwriting_pinned_snapshot(self):
        card, work = self.create_work_with_card(
            "当前人设",
            relationships={"朋友": "信任"},
            directives=["保持冷静"],
            initial_state={"attributes": {"心情": 5}},
            character_attributes={"好感度": 10},
        )
        empty_conversation = repositories.create_conversation(work["id"], "待迁移会话")
        pinned_conversation = repositories.create_conversation(work["id"], "固定会话")
        with closing(database.connect()) as connection:
            columns = [row[1] for row in connection.execute("PRAGMA table_info(conversations)")]
            if "card_snapshot" not in columns:
                connection.execute(
                    "ALTER TABLE conversations ADD COLUMN card_snapshot TEXT NOT NULL DEFAULT '{}'"
                )
            connection.execute(
                "UPDATE conversations SET card_snapshot = '{}' WHERE id = ?",
                (empty_conversation["id"],),
            )
            connection.execute(
                "UPDATE conversations SET card_snapshot = ? WHERE id = ?",
                (database.json_dumps({"persona": "固定人设"}), pinned_conversation["id"]),
            )
            connection.commit()

        database.init_db()

        self.assertEqual(
            repositories.get_conversation(empty_conversation["id"])["card_snapshot"],
            card,
        )
        self.assertEqual(
            repositories.get_conversation(pinned_conversation["id"])["card_snapshot"],
            {"persona": "固定人设"},
        )


if __name__ == "__main__":
    unittest.main()
