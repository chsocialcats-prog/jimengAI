"""Account orchestration over the frozen auth primitives."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .account_migration import AccountMigrationService
from .errors import SecretKeyUnavailable
from .passwords import hash_password, normalize_username, validate_password, verify_password_or_dummy
from .sessions import SessionService
from .types import PublicUser, ROLE_USER


class InvalidCredentials(Exception):
    code = "invalid_credentials"
    message = "用户名或密码错误"


class UsernameTaken(Exception):
    code = "username_taken"
    message = "用户名已被使用"


@contextmanager
def _connection_scope(source):
    if not isinstance(source, sqlite3.Connection) and callable(source):
        connection = source()
        try:
            yield connection
        finally:
            connection.close()
    else:
        yield source


class AuthService:
    def __init__(self, connection_or_factory, keyring, *, rate_limiter, config_path=None, environ=None):
        self.connection_or_factory = connection_or_factory
        self.keyring = keyring
        self.rate_limiter = rate_limiter
        self.config_path = config_path
        self.environ = environ

    def _migration(self, connection):
        kwargs = {"environ": self.environ}
        if self.config_path is not None:
            kwargs["config_path"] = self.config_path
        return AccountMigrationService(connection, self.keyring, **kwargs)

    def migration_state(self) -> str:
        with _connection_scope(self.connection_or_factory) as connection:
            row = connection.execute("SELECT value FROM app_meta WHERE key = 'account_migration_state'").fetchone()
            return row[0] if row else "unclaimed"

    def authenticate(self, token):
        with _connection_scope(self.connection_or_factory) as connection:
            return SessionService(connection).authenticate(token)

    @staticmethod
    def _public_user(row):
        keys = row.keys()
        return PublicUser(
            row["id"],
            row["username"],
            row["created_at"],
            row["avatar_url"] if "avatar_url" in keys else "",
            row["role"] if "role" in keys and row["role"] else ROLE_USER,
        )

    def issue(self, user_id):
        if self.keyring is None:
            raise SecretKeyUnavailable()
        with _connection_scope(self.connection_or_factory) as connection:
            return SessionService(connection).issue(user_id)

    def register(self, username, password, client_ip):
        if self.keyring is None:
            raise SecretKeyUnavailable()
        limit = self.rate_limiter.record_registration_attempt(client_ip)
        if not limit.allowed:
            return None, limit
        display, key = normalize_username(username)
        password_hash = hash_password(password)
        with _connection_scope(self.connection_or_factory) as connection:
            try:
                claimed = self._migration(connection).claim_for_first_user(display, key, password_hash)
            except sqlite3.IntegrityError as exc:
                raise UsernameTaken() from exc
            issued = SessionService(connection).issue(claimed.user.id)
            return (claimed, issued), None

    def login(self, username, password, client_ip):
        if self.keyring is None:
            raise SecretKeyUnavailable()
        try:
            _, key = normalize_username(username)
        except Exception:
            key = str(username).casefold()
        with _connection_scope(self.connection_or_factory) as connection:
            row = connection.execute("SELECT id, password_hash FROM users WHERE username_key = ? AND is_active = 1", (key,)).fetchone()
            if row is None or not verify_password_or_dummy(password, row["password_hash"] if row else None):
                limit = self.rate_limiter.record_login_failure(client_ip, username)
                if not limit.allowed:
                    return None, limit
                raise InvalidCredentials()
            self.rate_limiter.record_login_success(client_ip, username)
            user_row = connection.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
            user = self._public_user(user_row)
            return (user, SessionService(connection).issue(row["id"])), None

    def change_password(self, auth, current_password, new_password):
        if self.keyring is None:
            raise SecretKeyUnavailable()
        validate_password(new_password)
        with _connection_scope(self.connection_or_factory) as connection:
            row = connection.execute("SELECT password_hash FROM users WHERE id = ? AND is_active = 1", (auth.user.id,)).fetchone()
            if row is None or not verify_password_or_dummy(current_password, row["password_hash"] if row else None):
                raise InvalidCredentials()
            now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            connection.execute("UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?", (hash_password(new_password), now, now, auth.user.id))
            connection.commit()
            sessions = SessionService(connection)
            sessions.revoke_all_for_user(auth.user.id)
            return sessions.issue(auth.user.id)

    def logout(self, token):
        if token:
            with _connection_scope(self.connection_or_factory) as connection:
                SessionService(connection).revoke_current(token)

    def update_avatar(self, auth, avatar_url):
        """Update the signed-in user's public avatar URL."""
        with _connection_scope(self.connection_or_factory) as connection:
            now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            connection.execute(
                "UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?",
                (avatar_url.strip(), now, auth.user.id),
            )
            connection.commit()
        return PublicUser(
            auth.user.id,
            auth.user.username,
            auth.user.created_at,
            avatar_url.strip(),
            auth.user.role,
        )
