import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


class StartupRecoveryTests(unittest.TestCase):
    def test_environment_legacy_key_emits_value_free_warning(self):
        from backend.auth.legacy_config import warn_if_environment_legacy_key

        with tempfile.TemporaryDirectory() as tempdir:
            config_path = Path(tempdir) / "config.json"
            config_path.write_text(json.dumps({"deepseek": {"api_key": ""}}), encoding="utf-8")
            with self.assertLogs("backend.auth.legacy_config", level="WARNING") as captured:
                warn_if_environment_legacy_key(config_path=config_path, environ={"DEEPSEEK_API_KEY": "fixture-env-key"})
            self.assertEqual(len(captured.records), 1)
            self.assertNotIn("fixture-env-key", captured.output[0])

    def test_pending_cleanup_preserves_plaintext_copy_without_keyring(self):
        from backend.auth.account_migration import AccountMigrationService

        with tempfile.TemporaryDirectory() as tempdir:
            config_path = Path(tempdir) / "config.json"
            original = {"deepseek": {"api_key": "fixture-key"}, "keep": {"x": 1}}
            config_path.write_text(json.dumps(original), encoding="utf-8")
            connection = sqlite3.connect(":memory:")
            connection.row_factory = sqlite3.Row
            connection.executescript(
                """
                CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
                INSERT INTO app_meta VALUES ('account_migration_state', 'needs_secret_cleanup', 'now');
                """
            )
            try:
                service = AccountMigrationService(connection, None, config_path=config_path, environ={})
                self.assertFalse(service.resume_cleanup())
                self.assertEqual(json.loads(config_path.read_text(encoding="utf-8")), original)
                self.assertEqual(
                    connection.execute("SELECT value FROM app_meta WHERE key='account_migration_state'").fetchone()[0],
                    "needs_secret_cleanup",
                )
            finally:
                connection.close()

    def test_pending_cleanup_finishes_without_creating_or_reassigning_data(self):
        from backend.auth.account_migration import AccountMigrationService
        from backend.auth.keyring import AuthKeyring

        with tempfile.TemporaryDirectory() as tempdir:
            config_path = Path(tempdir) / "config.json"
            config_path.write_text(json.dumps({"deepseek": {"api_key": "fixture-key"}}), encoding="utf-8")
            connection = sqlite3.connect(":memory:")
            connection.row_factory = sqlite3.Row
            connection.executescript(
                """
                CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, username_key TEXT, password_hash TEXT, is_active INTEGER, password_changed_at TEXT, created_at TEXT, updated_at TEXT);
                INSERT INTO users VALUES (7, 'Alice', 'alice', 'hash', 1, 'now', 'now', 'now');
                CREATE TABLE user_ai_settings (user_id INTEGER PRIMARY KEY, deepseek_config TEXT, generation_config TEXT, api_key_ciphertext TEXT, updated_at TEXT);
                CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); INSERT INTO app_meta VALUES ('account_migration_state', 'needs_secret_cleanup', 'now');
                CREATE TABLE cards (id INTEGER PRIMARY KEY, owner_user_id INTEGER); INSERT INTO cards VALUES (1, 7);
                CREATE TABLE worldbooks (id INTEGER PRIMARY KEY, owner_user_id INTEGER); CREATE TABLE works (id INTEGER PRIMARY KEY, owner_user_id INTEGER); CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER);
                """
            )
            service = AccountMigrationService(connection, AuthKeyring.load(Path(tempdir) / "keys.json"), config_path=config_path, environ={})
            self.assertTrue(service.resume_cleanup())
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT owner_user_id FROM cards").fetchone()[0], 7)
            self.assertEqual(connection.execute("SELECT value FROM app_meta WHERE key='account_migration_state'").fetchone()[0], "complete")
