import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet


class KeyringTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.key_path = Path(self.tempdir.name) / "auth_keys.json"
        self.old_keys = os.environ.pop("NEKO_AUTH_KEYS", None)

    def tearDown(self):
        if self.old_keys is not None:
            os.environ["NEKO_AUTH_KEYS"] = self.old_keys
        self.tempdir.cleanup()

    def test_missing_local_key_file_is_created_and_round_trips(self):
        from backend.auth.keyring import AuthKeyring

        keyring = AuthKeyring.load(self.key_path)
        self.assertEqual(json.loads(self.key_path.read_text(encoding="utf-8"))["version"], 1)
        self.assertEqual(keyring.decrypt(keyring.encrypt("secret")), "secret")

    def test_environment_keys_rotate_old_ciphertext(self):
        from backend.auth.keyring import AuthKeyring

        old_key, new_key = Fernet.generate_key(), Fernet.generate_key()
        old_ciphertext = Fernet(old_key).encrypt(b"secret").decode("ascii")
        os.environ["NEKO_AUTH_KEYS"] = new_key.decode("ascii") + "," + old_key.decode("ascii")
        keyring = AuthKeyring.load(self.key_path)

        self.assertEqual(keyring.decrypt(old_ciphertext), "secret")
        self.assertNotEqual(keyring.rotate(old_ciphertext), old_ciphertext)
        self.assertEqual(keyring.decrypt(keyring.rotate(old_ciphertext)), "secret")
        self.assertEqual(len(keyring.csrf_signing_keys()), 2)

    def test_malformed_configured_key_returns_safe_error(self):
        from backend.auth.errors import SecretKeyUnavailable
        from backend.auth.keyring import AuthKeyring

        os.environ["NEKO_AUTH_KEYS"] = "not-a-fernet-key"
        with self.assertRaises(SecretKeyUnavailable) as raised:
            AuthKeyring.load(self.key_path)
        self.assertEqual(raised.exception.code, "secret_key_unavailable")
        self.assertNotIn("not-a-fernet-key", str(raised.exception))

    def test_non_ascii_configured_key_returns_safe_error(self):
        from backend.auth.errors import SecretKeyUnavailable
        from backend.auth.keyring import AuthKeyring

        os.environ["NEKO_AUTH_KEYS"] = "密钥"
        with self.assertRaises(SecretKeyUnavailable):
            AuthKeyring.load(self.key_path)

    def test_local_initialization_does_not_overwrite_competing_key_file_publication(self):
        from backend.auth.keyring import AuthKeyring

        competing_payload = json.dumps({"version": 1, "keys": [Fernet.generate_key().decode("ascii")]})
        original_replace = os.replace
        original_link = os.link

        def publish_competitor_then_replace(source, target):
            Path(target).write_text(competing_payload, encoding="utf-8")
            return original_replace(source, target)

        def publish_competitor_then_link(source, target):
            Path(target).write_text(competing_payload, encoding="utf-8")
            return original_link(source, target)

        with patch("backend.auth.keyring.os.replace", side_effect=publish_competitor_then_replace), patch(
            "backend.auth.keyring.os.link", side_effect=publish_competitor_then_link
        ):
            AuthKeyring.load(self.key_path)

        self.assertEqual(self.key_path.read_text(encoding="utf-8"), competing_payload)
