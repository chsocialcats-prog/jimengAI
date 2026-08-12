# -*- coding: utf-8 -*-
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend import database, repositories


class SnapshotCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()
        work = repositories.create_work({"title": "测试剧本", "opening": "开场"})
        self.conversation = repositories.create_conversation(work["id"], "测试会话")

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_snapshot_restores_corrections_and_hides_them_from_public_results(self):
        conversation_id = self.conversation["id"]
        repositories.add_conversation_correction(conversation_id, "persona", "原人设")
        repositories.add_conversation_correction(conversation_id, "memory", "原记忆")
        snapshot = repositories.create_snapshot(conversation_id, name="修正快照")

        repositories.add_conversation_correction(conversation_id, "persona", "新人设")
        repositories.add_conversation_correction(conversation_id, "memory", "新记忆")
        repositories.restore_snapshot(conversation_id, snapshot["id"])

        restored = repositories.get_conversation(conversation_id)
        self.assertEqual([item["content"] for item in restored["persona_corrections"]], ["原人设"])
        self.assertEqual([item["content"] for item in restored["memory_corrections"]], ["原记忆"])

        private_snapshot = repositories.get_snapshot(snapshot["id"], include_private=True)
        self.assertEqual(private_snapshot["persona_corrections"][0]["content"], "原人设")
        self.assertEqual(private_snapshot["memory_corrections"][0]["content"], "原记忆")
        self.assertNotIn("persona_corrections", repositories.get_snapshot(snapshot["id"]))
        self.assertNotIn("memory_corrections", repositories.get_snapshot(snapshot["id"]))

    def test_new_empty_snapshot_clears_corrections_but_legacy_snapshot_preserves_them(self):
        conversation_id = self.conversation["id"]
        empty_snapshot = repositories.create_snapshot(conversation_id, name="空修正")
        repositories.add_conversation_correction(conversation_id, "persona", "稍后添加")
        repositories.restore_snapshot(conversation_id, empty_snapshot["id"])
        self.assertEqual(repositories.get_conversation(conversation_id)["persona_corrections"], [])

        repositories.add_conversation_correction(conversation_id, "persona", "当前修正")
        with closing(database.connect()) as connection:
            connection.execute(
                "UPDATE snapshots SET persona_corrections = NULL, memory_corrections = NULL WHERE id = ?",
                (empty_snapshot["id"],),
            )
            connection.commit()
        repositories.restore_snapshot(conversation_id, empty_snapshot["id"])
        self.assertEqual(
            [item["content"] for item in repositories.get_conversation(conversation_id)["persona_corrections"]],
            ["当前修正"],
        )

    def test_init_db_adds_nullable_correction_columns_to_legacy_snapshots(self):
        conversation_id = self.conversation["id"]
        with closing(database.connect()) as connection:
            connection.execute("DROP INDEX IF EXISTS idx_snapshots_conversation")
            connection.execute("DROP TABLE snapshots")
            connection.execute(
                """
                CREATE TABLE snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    name TEXT NOT NULL DEFAULT '手动存档',
                    state TEXT NOT NULL DEFAULT '{}',
                    messages TEXT NOT NULL DEFAULT '[]',
                    memory_summary TEXT NOT NULL DEFAULT '',
                    memory_summary_covered_until_sequence INTEGER NOT NULL DEFAULT -1,
                    branch_label TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
                )
                """
            )
            connection.execute(
                "INSERT INTO snapshots (conversation_id, name, state) VALUES (?, ?, ?)",
                (conversation_id, "旧存档", '{"money": 7}'),
            )
            connection.commit()

        database.init_db()

        snapshot = repositories.get_snapshot(1, include_private=True)
        self.assertEqual(snapshot["name"], "旧存档")
        self.assertEqual(snapshot["state"]["money"], 7)
        self.assertIsNone(snapshot["persona_corrections"])
        self.assertIsNone(snapshot["memory_corrections"])


if __name__ == "__main__":
    unittest.main()
