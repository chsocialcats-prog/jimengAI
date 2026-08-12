from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend import database, repositories
from backend.repository import snapshot_repository


class SnapshotRepositoryCleanupTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(
            database, "DB_PATH", Path(self.tempdir.name) / "test.db"
        )
        self.db_patch.start()
        database.init_db()
        work = repositories.create_work({"title": "test work", "opening": "opening"})
        self.conversation = repositories.create_conversation(work["id"], "test conversation")

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_manual_and_new_autosave_share_the_snapshot_insert_primitive(self):
        with patch.object(
            snapshot_repository,
            "_insert_snapshot",
            wraps=snapshot_repository._insert_snapshot,
        ) as insert_snapshot:
            manual = repositories.create_snapshot(
                self.conversation["id"],
                name="manual",
                note="manual note",
                branch_label="manual branch",
            )
            autosave = repositories.create_snapshot(
                self.conversation["id"],
                autosave=True,
                note="autosave note",
                branch_label="autosave branch",
            )

        self.assertEqual(insert_snapshot.call_count, 2)
        self.assertEqual(
            [call.args[1][1] for call in insert_snapshot.call_args_list],
            ["manual", "自动存档"],
        )
        self.assertNotEqual(manual["id"], autosave["id"])

    def test_insert_paths_preserve_complete_private_snapshot_values(self):
        conversation_id = self.conversation["id"]
        repositories.save_state(conversation_id, {"money": 42, "items": ["key"]})
        repositories.create_message(conversation_id, "user", "snapshot message")
        repositories.save_memory_summary(conversation_id, "long-term memory", 7)
        repositories.add_conversation_correction(conversation_id, "persona", "persona correction")
        repositories.add_conversation_correction(conversation_id, "memory", "memory correction")

        manual = repositories.create_snapshot(
            conversation_id, name="complete manual", note="manual note", branch_label="branch"
        )
        autosave = repositories.create_snapshot(
            conversation_id,
            autosave=True,
            note="autosave note",
            branch_label="autosave branch",
        )

        for snapshot in (manual, autosave):
            private = repositories.get_snapshot(snapshot["id"], include_private=True)
            self.assertEqual(private["state"]["money"], 42)
            self.assertEqual(private["state"]["items"], ["key"])
            self.assertEqual(private["messages"][-1]["content"], "snapshot message")
            self.assertEqual(private["memory_summary"], "long-term memory")
            self.assertEqual(private["memory_summary_covered_until_sequence"], 7)
            self.assertEqual(private["persona_corrections"][0]["content"], "persona correction")
            self.assertEqual(private["memory_corrections"][0]["content"], "memory correction")

    def test_insert_paths_preserve_empty_corrections(self):
        conversation_id = self.conversation["id"]
        manual = repositories.create_snapshot(conversation_id, name="empty manual")
        autosave = repositories.create_snapshot(conversation_id, autosave=True)

        for snapshot in (manual, autosave):
            private = repositories.get_snapshot(snapshot["id"], include_private=True)
            self.assertEqual(private["persona_corrections"], [])
            self.assertEqual(private["memory_corrections"], [])

        with closing(database.connect()) as connection:
            rows = connection.execute(
                "SELECT persona_corrections, memory_corrections FROM snapshots "
                "WHERE id IN (?, ?)",
                (manual["id"], autosave["id"]),
            ).fetchall()
        self.assertEqual([(row[0], row[1]) for row in rows], [("[]", "[]"), ("[]", "[]")])

    def test_insert_primitive_preserves_empty_and_null_corrections(self):
        def values(name, persona_corrections, memory_corrections):
            return (
                self.conversation["id"],
                name,
                "{}",
                "[]",
                "",
                -1,
                persona_corrections,
                memory_corrections,
                "",
                "",
                database.now_str(),
            )

        with closing(database.connect()) as connection:
            empty_id = snapshot_repository._insert_snapshot(
                connection, values("empty", "[]", "[]")
            )
            null_id = snapshot_repository._insert_snapshot(
                connection, values("null", None, None)
            )
            connection.commit()

        with closing(database.connect()) as connection:
            rows = connection.execute(
                "SELECT name, persona_corrections, memory_corrections FROM snapshots "
                "WHERE id IN (?, ?) ORDER BY id",
                (empty_id, null_id),
            ).fetchall()
        self.assertEqual(
            [tuple(row) for row in rows],
            [("empty", "[]", "[]"), ("null", None, None)],
        )

    def test_snapshot_insert_failure_rolls_back_the_transaction(self):
        connection = database.connect()
        real_execute = connection.execute

        def fail_on_snapshot_insert(sql, parameters=()):
            if "INSERT INTO snapshots" in sql:
                raise RuntimeError("forced snapshot insert failure")
            return real_execute(sql, parameters)

        failing_connection = Mock(wraps=connection)
        failing_connection.execute.side_effect = fail_on_snapshot_insert
        try:
            with self.assertRaisesRegex(RuntimeError, "forced snapshot insert failure"):
                snapshot_repository.create_snapshot(
                    self.conversation["id"],
                    name="failed",
                    connect_fn=lambda: failing_connection,
                )
        finally:
            if not failing_connection.close.called:
                failing_connection.close()

        with closing(database.connect()) as check:
            count = check.execute(
                "SELECT COUNT(*) FROM snapshots WHERE conversation_id = ?",
                (self.conversation["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
