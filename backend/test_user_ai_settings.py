# -*- coding: utf-8 -*-
"""Per-user encrypted AI settings contracts."""

import sqlite3
import unittest
from datetime import datetime, timezone

from cryptography.fernet import Fernet

from backend.auth.keyring import AuthKeyring
from backend.migrations.account_schema import migrate_account_schema
from backend.repository.user_ai_settings import UserAISettingsRepository
from backend.services.user_ai_settings import UserAISettingsService


def _connection():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            username_key TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            is_active INTEGER NOT NULL,
            password_changed_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    migrate_account_schema(connection)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    connection.executemany(
        """INSERT INTO users (id, username, username_key, password_hash, is_active,
           password_changed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'hash', 1, ?, ?, ?)""",
        ((1, "alice", "alice", now, now, now), (2, "bob", "bob", now, now, now)),
    )
    connection.commit()
    return connection


class UserAISettingsTests(unittest.TestCase):
    def setUp(self):
        self.connection = _connection()
        self.keyring = AuthKeyring([Fernet.generate_key()])
        self.repository = UserAISettingsRepository(self.connection)
        self.service = UserAISettingsService(
            self.repository,
            self.keyring,
            app_config={"app": {"host": "127.0.0.1", "port": 8000}},
        )

    def tearDown(self):
        self.connection.close()

    def test_two_users_keep_configs_and_encrypted_keys_isolated(self):
        self.service.update_for_user(
            1,
            {"deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "alice-model", "api_key": "test-token-alice"}},
        )
        self.service.update_for_user(
            2,
            {"deepseek": {"base_url": "https://api.deepseek.com/v1", "model": "bob-model", "api_key": "test-token-bob"}},
        )

        alice = self.service.resolve_for_user(1)
        bob = self.service.resolve_for_user(2)
        rows = self.connection.execute(
            "SELECT user_id, api_key_ciphertext FROM user_ai_settings ORDER BY user_id"
        ).fetchall()

        self.assertEqual(alice.model, "alice-model")
        self.assertEqual(alice.api_key, "test-token-alice")
        self.assertEqual(bob.model, "bob-model")
        self.assertEqual(bob.api_key, "test-token-bob")
        self.assertNotIn("test-token-alice", rows[0]["api_key_ciphertext"])
        self.assertNotIn("test-token-bob", rows[1]["api_key_ciphertext"])

    def test_masking_replace_and_explicit_clear_never_return_key_material(self):
        self.service.update_for_user(
            1,
            {"deepseek": {"base_url": "https://api.deepseek.com", "model": "first", "api_key": "test-token-original"}},
        )
        retained = self.service.update_for_user(1, {"deepseek": {"model": "renamed", "api_key": ""}})
        replaced = self.service.update_for_user(1, {"deepseek": {"api_key": "test-token-replaced"}})
        cleared = self.service.update_for_user(1, {"deepseek": {"clear_api_key": True}})

        self.assertTrue(retained["api_key_set"])
        self.assertNotIn("api_key", retained["deepseek"])
        self.assertTrue(replaced["api_key_set"])
        self.assertFalse(cleared["api_key_set"])
        self.assertFalse(self.service.resolve_for_user(1).ai_enabled)

    def test_existing_ciphertext_with_unavailable_master_key_is_reported_not_mocked(self):
        self.service.update_for_user(1, {"deepseek": {"api_key": "test-token-old"}})
        unavailable = UserAISettingsService(self.repository, None, app_config={"app": {}})

        projection = unavailable.public_for_user(1)
        effective = unavailable.resolve_for_user(1)

        self.assertTrue(projection["api_key_set"])
        self.assertTrue(projection["api_key_unreadable"])
        self.assertTrue(effective.api_key_unreadable)
        self.assertFalse(effective.ai_enabled)

    def test_new_key_and_clear_flag_are_rejected_together(self):
        with self.assertRaisesRegex(ValueError, "clear_api_key"):
            self.service.update_for_user(
                1,
                {"deepseek": {"api_key": "test-token-new", "clear_api_key": True}},
            )

