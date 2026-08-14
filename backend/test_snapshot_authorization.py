# -*- coding: utf-8 -*-
"""Snapshot reads and restores must be scoped through their conversation owner."""

from contextlib import closing
import unittest

from backend import database
from backend.repository import conversation_repository, snapshot_repository
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class SnapshotAuthorizationTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.owner = create_test_user(connection, "snapshot-owner")
            self.other = create_test_user(connection, "snapshot-other")
            work_id = connection.execute(
                "INSERT INTO works (owner_user_id, title) VALUES (?, ?)",
                (self.owner["id"], "public work"),
            ).lastrowid
            connection.commit()
        self.conversation = conversation_repository.create_conversation(
            work_id, "owner story", self.owner["id"]
        )
        self.snapshot = snapshot_repository.create_snapshot(
            self.conversation["id"], self.owner["id"], name="owner save"
        )

    def test_snapshot_id_does_not_disclose_or_restore_another_users_save(self):
        conversation_id = self.conversation["id"]
        snapshot_id = self.snapshot["id"]

        self.assertEqual(snapshot_repository.list_snapshots(conversation_id, self.other["id"]), [])
        self.assertIsNone(snapshot_repository.get_snapshot(snapshot_id, self.other["id"]))
        self.assertIsNone(
            snapshot_repository.restore_snapshot(
                conversation_id, snapshot_id, self.other["id"]
            )
        )
        snapshot_repository.delete_snapshot(snapshot_id, self.other["id"])
        self.assertIsNotNone(snapshot_repository.get_snapshot(snapshot_id, self.owner["id"]))


if __name__ == "__main__":
    unittest.main()
