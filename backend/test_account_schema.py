# -*- coding: utf-8 -*-
"""Tests for the account-schema migration skeleton."""

import importlib
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend import config as config_module
from backend import database as database_module
from backend.migrations.account_schema import migrate_account_schema


class AccountSchemaMigrationTests(unittest.TestCase):
    def test_migration_is_idempotent_on_legacy_database(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "legacy.db"
            with closing(sqlite3.connect(db_path)) as connection:
                connection.executescript(
                    """
                    PRAGMA foreign_keys = OFF;
                    CREATE TABLE cards (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00',
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE worldbooks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00',
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE works (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        card_id INTEGER,
                        worldbook_id INTEGER,
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00',
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        work_id INTEGER,
                        card_id INTEGER,
                        worldbook_id INTEGER,
                        title TEXT NOT NULL DEFAULT '旧会话',
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00',
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        sequence INTEGER NOT NULL DEFAULT 0,
                        metadata TEXT NOT NULL DEFAULT '{}',
                        token_count INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
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
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE snapshots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL,
                        name TEXT NOT NULL DEFAULT '手动存档',
                        state TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    CREATE TABLE memory_summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL UNIQUE,
                        summary TEXT NOT NULL DEFAULT '',
                        updated_at TEXT NOT NULL DEFAULT '2026-08-13T00:00:00'
                    );
                    INSERT INTO cards (name) VALUES ('旧卡牌');
                    INSERT INTO worldbooks (title) VALUES ('旧世界书');
                    INSERT INTO works (title, card_id, worldbook_id) VALUES (1, 1, 1);
                    INSERT INTO conversations (work_id, card_id, worldbook_id, title) VALUES (1, 1, 1, '旧会话');
                    INSERT INTO messages (conversation_id, role, content) VALUES (1, 'assistant', 'hello');
                    INSERT INTO states (conversation_id) VALUES (1);
                    INSERT INTO snapshots (conversation_id) VALUES (1);
                    INSERT INTO memory_summaries (conversation_id) VALUES (1);
                    """
                )
                connection.commit()

            with closing(sqlite3.connect(db_path)) as connection:
                migrate_account_schema(connection)
                first_version = connection.execute("PRAGMA user_version").fetchone()[0]
                schema_snapshot = {
                    "users": self._table_columns(connection, "users"),
                    "auth_sessions": self._table_columns(connection, "auth_sessions"),
                    "user_ai_settings": self._table_columns(connection, "user_ai_settings"),
                    "app_meta": self._table_columns(connection, "app_meta"),
                    "cards": self._table_columns(connection, "cards"),
                    "worldbooks": self._table_columns(connection, "worldbooks"),
                    "works": self._table_columns(connection, "works"),
                    "conversations": self._table_columns(connection, "conversations"),
                }
                migrate_account_schema(connection)
                second_version = connection.execute("PRAGMA user_version").fetchone()[0]

                self.assertGreater(first_version, 0)
                self.assertEqual(first_version, second_version)
                self.assertEqual(
                    schema_snapshot["users"],
                    [
                        "id",
                        "username",
                        "username_key",
                        "password_hash",
                        "is_active",
                        "role",
                        "password_changed_at",
                        "avatar_url",
                        "created_at",
                        "updated_at",
                    ],
                )
                self.assertEqual(
                    schema_snapshot["auth_sessions"],
                    [
                        "id",
                        "user_id",
                        "token_hash",
                        "created_at",
                        "last_seen_at",
                        "absolute_expires_at",
                        "revoked_at",
                    ],
                )
                self.assertEqual(
                    schema_snapshot["user_ai_settings"],
                    [
                        "user_id",
                        "deepseek_config",
                        "generation_config",
                        "api_key_ciphertext",
                        "updated_at",
                    ],
                )
                self.assertEqual(
                    schema_snapshot["app_meta"], ["key", "value", "updated_at"]
                )
                self.assertIn("owner_user_id", schema_snapshot["cards"])
                self.assertIn("owner_user_id", schema_snapshot["worldbooks"])
                self.assertIn("owner_user_id", schema_snapshot["works"])
                self.assertIn("user_id", schema_snapshot["conversations"])
                self._assert_child_tables_remain_conversation_scoped(connection)
                self.assertTrue(
                    self._has_unique_index_on(connection, "users", "username_key")
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM app_meta WHERE key = ?",
                        ("account_migration_state",),
                    ).fetchone()[0],
                    "unclaimed",
                )

    def test_migration_rolls_back_with_the_callers_outer_transaction(self):
        """Protect against schema helpers that implicitly commit BEGIN IMMEDIATE."""
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("BEGIN IMMEDIATE")
            migrate_account_schema(connection)
            connection.rollback()

            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            self.assertFalse(
                {"users", "auth_sessions", "user_ai_settings", "app_meta"} & tables
            )

    def test_fresh_database_ownership_columns_are_required_and_indexed(self):
        """Protect the fresh-schema contract while legacy ALTERs remain nullable."""
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "fresh.db"
            with patch.object(database_module, "DB_PATH", db_path):
                database_module.init_db()

            with closing(sqlite3.connect(db_path)) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                ownership_columns = (
                    ("cards", "owner_user_id"),
                    ("worldbooks", "owner_user_id"),
                    ("works", "owner_user_id"),
                    ("conversations", "user_id"),
                )
                for table_name, column_name in ownership_columns:
                    column = self._table_column(connection, table_name, column_name)
                    self.assertEqual(column[3], 1, f"{table_name}.{column_name}")
                    self.assertTrue(
                        self._has_foreign_key(
                            connection,
                            table_name,
                            column_name,
                            "users",
                            "RESTRICT",
                        ),
                        f"{table_name}.{column_name}",
                    )
                    self.assertTrue(
                        self._has_index_on(connection, table_name, column_name),
                        f"{table_name}.{column_name}",
                    )

                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute("INSERT INTO cards (name) VALUES ('fresh')")
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(
                        "INSERT INTO cards (name, owner_user_id) VALUES ('fresh', 1)"
                    )
                self._assert_child_tables_remain_conversation_scoped(connection)

    def test_neko_data_dir_changes_database_and_master_key_paths_on_import(self):
        with tempfile.TemporaryDirectory() as directory:
            custom_data_dir = Path(directory) / "nested" / "runtime-data"
            try:
                with patch.dict(os.environ, {"NEKO_DATA_DIR": str(custom_data_dir)}):
                    reloaded_config = importlib.reload(config_module)
                    reloaded_database = importlib.reload(database_module)

                    self.assertEqual(reloaded_config.DATA_DIR, custom_data_dir)
                    self.assertEqual(
                        reloaded_config.AUTH_KEY_PATH, custom_data_dir / "auth_keys.json"
                    )
                    self.assertEqual(reloaded_database.DB_PATH, custom_data_dir / "app.db")
            finally:
                importlib.reload(config_module)
                importlib.reload(database_module)

    def _table_columns(self, connection, table_name):
        rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        return [row[1] for row in rows]

    def _table_column(self, connection, table_name, column_name):
        for row in connection.execute(f"PRAGMA table_info({table_name})"):
            if row[1] == column_name:
                return row
        self.fail(f"missing column: {table_name}.{column_name}")

    def _has_unique_index_on(self, connection, table_name, column_name):
        rows = connection.execute(f"PRAGMA index_list({table_name})").fetchall()
        for row in rows:
            if not row[2]:
                continue
            index_name = row[1]
            index_columns = [
                index_row[2]
                for index_row in connection.execute(f"PRAGMA index_info({index_name})")
            ]
            if index_columns == [column_name]:
                return True
        return False

    def _has_index_on(self, connection, table_name, column_name):
        rows = connection.execute(f"PRAGMA index_list({table_name})").fetchall()
        for row in rows:
            index_name = row[1]
            index_columns = [
                index_row[2]
                for index_row in connection.execute(f"PRAGMA index_info({index_name})")
            ]
            if index_columns == [column_name]:
                return True
        return False

    def _has_foreign_key(
        self, connection, table_name, column_name, referenced_table, on_delete
    ):
        rows = connection.execute(f"PRAGMA foreign_key_list({table_name})").fetchall()
        return any(
            row[3] == column_name
            and row[2] == referenced_table
            and row[6] == on_delete
            for row in rows
        )

    def _assert_child_tables_remain_conversation_scoped(self, connection):
        child_tables = ("messages", "states", "snapshots", "memory_summaries")
        for table_name in child_tables:
            columns = self._table_columns(connection, table_name)
            self.assertIn("conversation_id", columns, table_name)
            self.assertNotIn("user_id", columns, table_name)


if __name__ == "__main__":
    unittest.main()
