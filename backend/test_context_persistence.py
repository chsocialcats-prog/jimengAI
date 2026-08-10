# -*- coding: utf-8 -*-
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from backend import database, repositories


class ContextPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()
        self.work = repositories.create_work({"title": "测试剧本", "opening": "开场"})
        self.conversation = repositories.create_conversation(self.work["id"], "测试会话")

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_summary_round_trip_preserves_coverage_and_compatibility(self):
        repositories.save_memory_summary(self.conversation["id"], "old events", 4)

        record = repositories.get_memory_summary_record(self.conversation["id"])

        self.assertEqual(record["summary"], "old events")
        self.assertEqual(record["covered_until_sequence"], 4)
        self.assertTrue(record["updated_at"])
        self.assertEqual(repositories.get_memory_summary(self.conversation["id"]), "old events")

    def test_fresh_conversation_has_empty_summary_and_default_boundary(self):
        with closing(database.connect()) as connection:
            connection.execute(
                "DELETE FROM memory_summaries WHERE conversation_id = ?",
                (self.conversation["id"],),
            )
            connection.commit()
        record = repositories.get_memory_summary_record(self.conversation["id"])

        self.assertEqual(record["summary"], "")
        self.assertEqual(record["covered_until_sequence"], -1)
        self.assertIsNone(record["updated_at"])
        self.assertEqual(repositories.get_memory_summary(self.conversation["id"]), "")

    def test_init_db_migrates_legacy_summary_and_snapshot_columns_without_data_loss(self):
        conversation_id = self.conversation["id"]
        with closing(database.connect()) as connection:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("DROP INDEX IF EXISTS idx_snapshots_conversation")
            connection.execute("DROP TABLE snapshots")
            connection.execute("DROP TABLE memory_summaries")
            connection.execute(
                """
                CREATE TABLE snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    name TEXT NOT NULL DEFAULT 'manual',
                    state TEXT NOT NULL DEFAULT '{}',
                    messages TEXT NOT NULL DEFAULT '[]',
                    memory_summary TEXT NOT NULL DEFAULT '',
                    branch_label TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE memory_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL UNIQUE,
                    summary TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
                )
                """
            )
            connection.execute(
                "INSERT INTO memory_summaries (conversation_id, summary) VALUES (?, ?)",
                (conversation_id, "legacy memory"),
            )
            connection.execute(
                """
                INSERT INTO snapshots (
                    conversation_id, name, state, messages, memory_summary
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (conversation_id, "legacy", "{}", "[]", "legacy memory"),
            )
            connection.commit()

        database.init_db()

        record = repositories.get_memory_summary_record(conversation_id)
        snapshot = repositories.get_snapshot(1, include_private=True)
        self.assertEqual(record["summary"], "legacy memory")
        self.assertEqual(record["covered_until_sequence"], -1)
        self.assertEqual(snapshot["memory_summary"], "legacy memory")
        self.assertEqual(snapshot["memory_summary_covered_until_sequence"], -1)

    def test_private_snapshot_captures_boundary_and_public_results_hide_private_data(self):
        conversation_id = self.conversation["id"]
        repositories.create_message(conversation_id, "user", "private message")
        repositories.save_memory_summary(conversation_id, "manual summary", 3)
        manual = repositories.create_snapshot(conversation_id, name="manual")

        private_manual = repositories.get_snapshot(manual["id"], include_private=True)
        self.assertIn("private message", [message["content"] for message in private_manual["messages"]])
        self.assertEqual(private_manual["memory_summary"], "manual summary")
        self.assertEqual(private_manual["memory_summary_covered_until_sequence"], 3)

        repositories.save_memory_summary(conversation_id, "autosave one", 4)
        first_auto = repositories.create_snapshot(conversation_id, autosave=True)
        repositories.save_memory_summary(conversation_id, "autosave two", 8)
        second_auto = repositories.create_snapshot(conversation_id, autosave=True)
        private_auto = repositories.get_snapshot(second_auto["id"], include_private=True)
        self.assertEqual(second_auto["id"], first_auto["id"])
        self.assertEqual(private_auto["memory_summary"], "autosave two")
        self.assertEqual(private_auto["memory_summary_covered_until_sequence"], 8)

        public_items = repositories.list_snapshots(conversation_id)
        public_get = repositories.get_snapshot(manual["id"])
        for public_snapshot in public_items + [public_get]:
            self.assertNotIn("messages", public_snapshot)
            self.assertNotIn("memory_summary", public_snapshot)
            self.assertNotIn("memory_summary_covered_until_sequence", public_snapshot)

    def test_restore_restores_messages_state_summary_and_boundary(self):
        conversation_id = self.conversation["id"]
        repositories.save_state(conversation_id, {"money": 10, "flags": ["before"]})
        repositories.create_message(conversation_id, "user", "before message")
        repositories.save_memory_summary(conversation_id, "before summary", 2)
        messages_at_snapshot = repositories.get_messages(conversation_id)
        snapshot = repositories.create_snapshot(conversation_id, name="branch")

        repositories.save_state(conversation_id, {"money": 99, "flags": ["after"]})
        repositories.create_message(conversation_id, "assistant", "after message")
        repositories.save_memory_summary(conversation_id, "after summary", 7)
        repositories.restore_snapshot(conversation_id, snapshot["id"])

        self.assertEqual(repositories.get_state(conversation_id)["money"], 10)
        restored_messages = repositories.get_messages(conversation_id)
        self.assertEqual(
            [(message["role"], message["content"]) for message in restored_messages],
            [(message["role"], message["content"]) for message in messages_at_snapshot],
        )
        record = repositories.get_memory_summary_record(conversation_id)
        self.assertEqual(record["summary"], "before summary")
        self.assertEqual(record["covered_until_sequence"], 2)

    def test_restore_failure_rolls_back_state_messages_and_summary_atomically(self):
        conversation_id = self.conversation["id"]
        repositories.save_state(conversation_id, {"money": 10, "flags": ["current"]})
        repositories.create_message(conversation_id, "user", "current message")
        repositories.save_memory_summary(conversation_id, "current summary", 7)
        snapshot = repositories.create_snapshot(conversation_id, name="branch")
        repositories.save_state(conversation_id, {"money": 20, "flags": ["changed"]})
        repositories.create_message(conversation_id, "assistant", "changed message")
        repositories.save_memory_summary(conversation_id, "changed summary", 9)
        current_messages = repositories.get_messages(conversation_id)

        real_connection = database.connect()
        original_execute = real_connection.execute

        def fail_on_conversation_update(sql, parameters=()):
            if "UPDATE conversations SET current_state" in sql:
                raise RuntimeError("forced restore failure")
            return original_execute(sql, parameters)

        failing_connection = Mock(wraps=real_connection)
        failing_connection.execute.side_effect = fail_on_conversation_update
        with patch.object(repositories, "connect", return_value=failing_connection):
            with self.assertRaisesRegex(RuntimeError, "forced restore failure"):
                repositories.restore_snapshot(conversation_id, snapshot["id"])

        self.assertEqual(repositories.get_state(conversation_id)["money"], 20)
        self.assertEqual(repositories.get_messages(conversation_id), current_messages)
        record = repositories.get_memory_summary_record(conversation_id)
        self.assertEqual(record["summary"], "changed summary")
        self.assertEqual(record["covered_until_sequence"], 9)

    def test_snapshot_restore_restores_summary_and_coverage_boundary(self):
        conversation_id = self.conversation["id"]
        repositories.save_memory_summary(conversation_id, "before branch", 2)
        snapshot = repositories.create_snapshot(conversation_id, name="branch")

        repositories.save_memory_summary(conversation_id, "after branch", 7)
        repositories.restore_snapshot(conversation_id, snapshot["id"])

        record = repositories.get_memory_summary_record(conversation_id)
        self.assertEqual(record["summary"], "before branch")
        self.assertEqual(record["covered_until_sequence"], 2)

        public_snapshot = repositories.get_snapshot(snapshot["id"])
        self.assertNotIn("messages", public_snapshot)
        self.assertNotIn("memory_summary", public_snapshot)
        self.assertNotIn("memory_summary_covered_until_sequence", public_snapshot)


if __name__ == "__main__":
    unittest.main()
