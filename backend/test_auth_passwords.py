import unittest


class PasswordTests(unittest.TestCase):
    def test_username_normalization_preserves_display_case(self):
        from backend.auth.passwords import normalize_username

        display, key = normalize_username("  Ｎeko_用户  ")
        self.assertEqual(display, "Neko_用户")
        self.assertEqual(key, "neko_用户")

    def test_username_rejects_reserved_and_disallowed_values(self):
        from backend.auth.errors import AuthValidationError
        from backend.auth.passwords import normalize_username

        with self.assertRaises(AuthValidationError):
            normalize_username("admin")
        with self.assertRaises(AuthValidationError):
            normalize_username("bad name")

    def test_password_is_argon2id_and_preserves_unicode_whitespace(self):
        from backend.auth.passwords import hash_password, validate_password, verify_password

        password = " 密码 123! ☃"
        validate_password(password)
        password_hash = hash_password(password)
        self.assertTrue(password_hash.startswith("$argon2id$"))
        self.assertTrue(verify_password(password, password_hash))
        self.assertFalse(verify_password(password.strip(), password_hash))

    def test_password_rejects_too_short_or_oversized_input(self):
        from backend.auth.errors import AuthValidationError
        from backend.auth.passwords import validate_password

        with self.assertRaises(AuthValidationError):
            validate_password("short")
        with self.assertRaises(AuthValidationError):
            validate_password("x" * 129)

    def test_dummy_verification_returns_false_without_exposing_missing_user(self):
        from backend.auth.passwords import verify_password_or_dummy

        self.assertFalse(verify_password_or_dummy("any password", None))

