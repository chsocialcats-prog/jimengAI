import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


class AccountClaimMigrationTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.config_path = Path(self.tempdir.name) / "config.json"
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_active INTEGER NOT NULL, password_changed_at TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE user_ai_settings (user_id INTEGER PRIMARY KEY, deepseek_config TEXT NOT NULL, generation_config TEXT NOT NULL, api_key_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
            INSERT INTO app_meta (key, value) VALUES ('account_migration_state', 'unclaimed');
            CREATE TABLE cards (id INTEGER PRIMARY KEY, owner_user_id INTEGER); INSERT INTO cards VALUES (1, NULL);
            CREATE TABLE worldbooks (id INTEGER PRIMARY KEY, owner_user_id INTEGER); INSERT INTO worldbooks VALUES (1, NULL);
            CREATE TABLE works (id INTEGER PRIMARY KEY, owner_user_id INTEGER); INSERT INTO works VALUES (1, NULL);
            CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER); INSERT INTO conversations VALUES (1, NULL);
            """
        )

    def tearDown(self):
        self.connection.close()
        self.tempdir.cleanup()

    def test_claim_assigns_legacy_data_encrypts_key_and_cleans_only_config_secret(self):
        from backend.auth.account_migration import AccountMigrationService
        from backend.auth.keyring import AuthKeyring
        from backend.auth.types import DEFAULT_ACCOUNT_AVATAR_URL

        self.config_path.write_text(json.dumps({"deepseek": {"api_key": "fixture-key", "model": "legacy"}, "generation": {"temperature": 0.4}, "keep": {"x": 1}}), encoding="utf-8")
        service = AccountMigrationService(self.connection, AuthKeyring.load(Path(self.tempdir.name) / "keys.json"), config_path=self.config_path, environ={})
        result = service.claim_for_first_user("Alice", "alice", "password-hash")
        self.assertTrue(result.legacy_data_claimed)
        self.assertEqual(result.user.avatar_url, DEFAULT_ACCOUNT_AVATAR_URL)
        self.assertEqual(self.connection.execute("SELECT avatar_url FROM users WHERE id = ?", (result.user.id,)).fetchone()[0], DEFAULT_ACCOUNT_AVATAR_URL)
        self.assertEqual(self.connection.execute("SELECT value FROM app_meta WHERE key='account_migration_state'").fetchone()[0], "complete")
        self.assertTrue(all(self.connection.execute(f"SELECT owner_user_id FROM {table}").fetchone()[0] == result.user.id for table in ("cards", "worldbooks", "works")))
        self.assertEqual(self.connection.execute("SELECT user_id FROM conversations").fetchone()[0], result.user.id)
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8"))["deepseek"]["api_key"], "")
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8"))["keep"], {"x": 1})

    def test_resume_cleanup_is_idempotent_and_environment_only_key_needs_no_file_cleanup(self):
        from backend.auth.account_migration import AccountMigrationService
        from backend.auth.keyring import AuthKeyring

        self.config_path.write_text(json.dumps({"deepseek": {"api_key": ""}}), encoding="utf-8")
        service = AccountMigrationService(self.connection, AuthKeyring.load(Path(self.tempdir.name) / "keys.json"), config_path=self.config_path, environ={"DEEPSEEK_API_KEY": "fixture-env-key"})
        result = service.claim_for_first_user("Alice", "alice", "password-hash")
        self.assertTrue(result.legacy_data_claimed)
        self.assertFalse(service.resume_cleanup())
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
