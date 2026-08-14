import hashlib
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, created_at TEXT, is_active INTEGER);
            CREATE TABLE auth_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL, revoked_at TEXT
            );
            INSERT INTO users VALUES (1, 'Neko', '2026-01-01T00:00:00+00:00', 1);
            """
        )
        self.now = datetime(2026, 8, 13, tzinfo=timezone.utc)

    def tearDown(self):
        self.connection.close()

    def service(self):
        from backend.auth.sessions import SessionService

        return SessionService(self.connection, clock=lambda: self.now)

    def test_issues_256_bit_token_and_persists_only_hash(self):
        issued = self.service().issue(1)
        row = self.connection.execute("SELECT token_hash FROM auth_sessions").fetchone()

        self.assertGreaterEqual(len(issued.token.encode("utf-8")), 43)
        self.assertEqual(row["token_hash"], hashlib.sha256(issued.token.encode()).hexdigest())
        self.assertNotEqual(row["token_hash"], issued.token)

    def test_authentication_enforces_idle_absolute_and_revocation(self):
        service = self.service()
        issued = service.issue(1)
        self.assertEqual(service.authenticate(issued.token).user.id, 1)
        self.now += timedelta(days=8)
        self.assertIsNone(service.authenticate(issued.token))
        self.now -= timedelta(days=8)
        service.revoke_current(issued.token)
        self.assertIsNone(service.authenticate(issued.token))

    def test_last_seen_refreshes_at_most_every_five_minutes(self):
        service = self.service()
        issued = service.issue(1)
        initial = self.connection.execute("SELECT last_seen_at FROM auth_sessions").fetchone()[0]
        self.now += timedelta(minutes=4)
        service.authenticate(issued.token)
        self.assertEqual(self.connection.execute("SELECT last_seen_at FROM auth_sessions").fetchone()[0], initial)
        self.now += timedelta(minutes=1, seconds=1)
        service.authenticate(issued.token)
        self.assertNotEqual(self.connection.execute("SELECT last_seen_at FROM auth_sessions").fetchone()[0], initial)

    def test_revoke_all_for_user_and_cleanup_expired_sessions(self):
        service = self.service()
        issued = service.issue(1)
        service.revoke_all_for_user(1)
        self.assertIsNone(service.authenticate(issued.token))
        self.connection.execute("UPDATE auth_sessions SET absolute_expires_at = ?", ((self.now - timedelta(days=1)).isoformat(),))
        self.connection.commit()
        self.assertEqual(service.cleanup_expired(), 1)

    def test_authentication_never_outlives_thirty_days_from_creation(self):
        service = self.service()
        issued = service.issue(1)
        self.connection.execute(
            "UPDATE auth_sessions SET absolute_expires_at = ?, last_seen_at = ? WHERE id = ?",
            ((self.now + timedelta(days=365)).isoformat(), (self.now + timedelta(days=31)).isoformat(), issued.session_id),
        )
        self.connection.commit()
        self.now += timedelta(days=31)
        self.assertIsNone(service.authenticate(issued.token))
