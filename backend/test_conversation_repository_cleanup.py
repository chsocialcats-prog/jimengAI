# -*- coding: utf-8 -*-
import unittest
from contextlib import closing
from unittest.mock import patch

from backend import database, repositories
from backend.repository import conversation_repository
from backend.test_helpers import IsolatedDatabaseTestCase


class ConversationRepositoryCleanupTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        work = repositories.create_work({"title": "清理测试", "opening": "开场"}, owner_user_id=self.test_user.id)
        self.conversation = repositories.create_conversation(work["id"], "测试会话", user_id=self.test_user.id)

    def tearDown(self):
        super().tearDown()

    def _insert_state(self, conversation_id, money):
        with closing(database.connect()) as connection:
            connection.execute(
                """
                INSERT INTO states (
                    conversation_id, attributes, items, money, relations,
                    quests, flags, characters, logs, updated_at
                ) VALUES (?, '{}', '[]', ?, '{}', '[]', '[]', '{}', '[]', ?)
                """,
                (conversation_id, money, "race"),
            )
            connection.commit()

    def _delete_state(self, conversation_id):
        with closing(database.connect()) as connection:
            connection.execute(
                "DELETE FROM states WHERE conversation_id = ?", (conversation_id,)
            )
            connection.commit()

    def _insert_memory_summary(self, conversation_id, summary, covered_until_sequence):
        with closing(database.connect()) as connection:
            connection.execute(
                """
                INSERT INTO memory_summaries (
                    conversation_id, summary, covered_until_sequence, updated_at
                ) VALUES (?, ?, ?, ?)
                """,
                (conversation_id, summary, covered_until_sequence, "race"),
            )
            connection.commit()

    def _delete_memory_summary(self, conversation_id):
        with closing(database.connect()) as connection:
            connection.execute(
                "DELETE FROM memory_summaries WHERE conversation_id = ?",
                (conversation_id,),
            )
            connection.commit()

    def test_save_state_handles_row_created_after_initial_read(self):
        conversation_id = self.conversation["id"]
        self._delete_state(conversation_id)
        real_fetch_one = database.fetch_one
        injected = False

        def fetch_one(query, params=()):
            nonlocal injected
            if not injected and query == "SELECT id FROM states WHERE conversation_id = ?":
                self._insert_state(conversation_id, 7)
                injected = True
                return None
            return real_fetch_one(query, params)

        with patch.object(database, "fetch_one", side_effect=fetch_one):
            saved = conversation_repository.save_state(
                conversation_id, self.test_user.id, {"money": 42}, connect_fn=database.connect
            )

        self.assertEqual(saved["money"], 42)
        self.assertEqual(
            repositories.get_conversation(conversation_id, self.test_user.id)["current_state"]["money"],
            42,
        )

    def test_save_memory_summary_handles_row_created_after_initial_read(self):
        conversation_id = self.conversation["id"]
        self._delete_memory_summary(conversation_id)
        real_fetch_one = database.fetch_one
        injected = False

        def fetch_one(query, params=()):
            nonlocal injected
            if not injected and query == (
                "SELECT id FROM memory_summaries WHERE conversation_id = ?"
            ):
                self._insert_memory_summary(conversation_id, "old", 2)
                injected = True
                return None
            return real_fetch_one(query, params)

        with patch.object(database, "fetch_one", side_effect=fetch_one):
            conversation_repository.save_memory_summary(
                conversation_id,
                self.test_user.id,
                "new",
                covered_until_sequence=8,
                connect_fn=database.connect,
            )

        self.assertEqual(
            repositories.get_memory_summary_record(conversation_id, self.test_user.id)["summary"],
            "new",
        )
        self.assertEqual(
            repositories.get_memory_summary_record(conversation_id, self.test_user.id)[
                "covered_until_sequence"
            ],
            8,
        )


if __name__ == "__main__":
    unittest.main()
