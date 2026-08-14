import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse


def make_connection():
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
            username_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, is_active INTEGER NOT NULL,
            password_changed_at TEXT NOT NULL, avatar_url TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE auth_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
            absolute_expires_at TEXT NOT NULL, revoked_at TEXT);
        CREATE TABLE user_ai_settings (user_id INTEGER PRIMARY KEY, deepseek_config TEXT NOT NULL,
            generation_config TEXT NOT NULL, api_key_ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
        INSERT INTO app_meta (key, value) VALUES ('account_migration_state', 'complete');
        CREATE TABLE cards (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
        CREATE TABLE worldbooks (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
        CREATE TABLE works (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
        CREATE TABLE conversations (id INTEGER PRIMARY KEY, user_id INTEGER);
        """
    )
    return connection


class AuthRouteTests(unittest.TestCase):
    def setUp(self):
        from backend.auth.keyring import AuthKeyring
        from backend.auth.rate_limit import AuthRateLimiter
        from backend.auth.http_security import AuthSecurityMiddleware
        from backend.auth.service import AuthService
        from backend.auth.runtime_settings import RuntimeSettings
        from backend.routers.auth_routes import router

        self.connection = make_connection()
        self.tempdir = tempfile.TemporaryDirectory()
        config_path = Path(self.tempdir.name) / "config.json"
        config_path.write_text('{"deepseek":{"api_key":""}}', encoding="utf-8")
        app = FastAPI()
        @app.exception_handler(HTTPException)
        async def error_handler(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
        app.state.auth_service = AuthService(
            self.connection,
            AuthKeyring.load(Path(self.tempdir.name) / "auth_keys.json"),
            rate_limiter=AuthRateLimiter(),
            config_path=config_path,
        )
        app.state.runtime_settings = RuntimeSettings.from_environ({"NEKO_PUBLIC_ORIGIN": "http://testserver"})
        app.add_middleware(AuthSecurityMiddleware)
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.connection.close()
        self.tempdir.cleanup()

    def csrf(self):
        response = self.client.get("/api/auth/csrf")
        self.assertEqual(response.status_code, 200)
        return response.json()["csrf_token"]

    def test_register_me_password_rotation_and_logout(self):
        token = self.csrf()
        registered = self.client.post(
            "/api/auth/register", json={"username": "Alice", "password": "correct horse battery"},
            headers={"X-CSRF-Token": token, "Origin": "http://testserver"},
        )
        self.assertEqual(registered.status_code, 201)
        self.assertTrue(registered.json()["authenticated"])
        old_session = self.client.cookies.get("neko_session")
        self.assertIn("HttpOnly", "\n".join(registered.headers.get_list("set-cookie")))
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["username"], "Alice")

        changed = self.client.put(
            "/api/auth/password", json={"current_password": "correct horse battery", "new_password": "new correct password"},
            headers={"X-CSRF-Token": self.client.cookies.get("neko_csrf"), "Origin": "http://testserver"},
        )
        self.assertEqual(changed.status_code, 200)
        self.assertNotEqual(old_session, self.client.cookies.get("neko_session"))
        logged_out = self.client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": self.client.cookies.get("neko_csrf"), "Origin": "http://testserver"}
        )
        self.assertEqual(logged_out.status_code, 204)

    def test_login_failures_are_unified_and_registration_duplicate_is_conflict(self):
        token = self.csrf()
        self.client.post("/api/auth/register", json={"username": "Alice", "password": "correct horse battery"}, headers={"X-CSRF-Token": token, "Origin": "http://testserver"})
        self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.client.cookies.get("neko_csrf"), "Origin": "http://testserver"})
        duplicate = self.client.post("/api/auth/register", json={"username": "alice", "password": "correct horse battery"}, headers={"X-CSRF-Token": self.csrf(), "Origin": "http://testserver"})
        self.assertEqual((duplicate.status_code, duplicate.json()["error"]["code"]), (409, "username_taken"))
        bad = self.client.post("/api/auth/login", json={"username": "alice", "password": "wrong wrong wrong"}, headers={"X-CSRF-Token": self.client.cookies.get("neko_csrf"), "Origin": "http://testserver"})
        self.assertEqual((bad.status_code, bad.json()["error"]["code"]), (401, "invalid_credentials"))

    def test_unsafe_requests_require_origin_and_csrf(self):
        forbidden = self.client.post("/api/auth/login", json={"username": "missing", "password": "correct horse battery"})
        self.assertEqual((forbidden.status_code, forbidden.json()["error"]["code"]), (403, "csrf_failed"))

    def test_profile_avatar_is_persisted_and_returned_by_the_session(self):
        registered = self.client.post(
            "/api/auth/register",
            json={"username": "Alice", "password": "correct horse battery"},
            headers={"X-CSRF-Token": self.csrf(), "Origin": "http://testserver"},
        )
        self.assertEqual(registered.status_code, 201)
        avatar_url = "/uploads/1/avatar.png"
        updated = self.client.put(
            "/api/auth/profile",
            json={"avatar_url": avatar_url},
            headers={"X-CSRF-Token": self.client.cookies.get("neko_csrf"), "Origin": "http://testserver"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["user"]["avatar_url"], avatar_url)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["avatar_url"], avatar_url)

    def test_security_rejection_clears_invalid_session_and_is_not_cacheable(self):
        token = self.csrf()
        registered = self.client.post(
            "/api/auth/register",
            json={"username": "Alice", "password": "correct horse battery"},
            headers={"X-CSRF-Token": token, "Origin": "http://testserver"},
        )
        self.assertEqual(registered.status_code, 201)
        self.client.cookies.set("neko_session", "stale-session", path="/")
        rejected = self.client.post(
            "/api/auth/login",
            json={"username": "missing", "password": "correct horse battery"},
            headers={
                "X-CSRF-Token": self.client.cookies.get("neko_csrf"),
                "Origin": "http://evil.test",
            },
        )
        self.assertEqual((rejected.status_code, rejected.json()["error"]["code"]), (403, "csrf_failed"))
        self.assertEqual(rejected.headers.get("cache-control"), "no-store")
        self.assertIn("neko_session=", "\n".join(rejected.headers.get_list("set-cookie")))

    def test_unavailable_keyring_keeps_me_readable_and_blocks_auth_writes(self):
        from backend.auth.http_security import AuthSecurityMiddleware
        from backend.auth.service import AuthService

        app = FastAPI()
        @app.exception_handler(HTTPException)
        async def error_handler(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
        app.state.auth_service = AuthService(
            self.connection,
            None,
            rate_limiter=self.client.app.state.auth_service.rate_limiter,
            config_path=Path(self.tempdir.name) / "config.json",
        )
        app.state.runtime_settings = self.client.app.state.runtime_settings
        app.add_middleware(AuthSecurityMiddleware)
        app.include_router(__import__("backend.routers.auth_routes", fromlist=["router"]).router)
        unavailable = TestClient(app)
        try:
            self.assertEqual(unavailable.get("/api/auth/me").status_code, 200)
            csrf = unavailable.get("/api/auth/csrf")
            self.assertEqual((csrf.status_code, csrf.json()["error"]["code"]), (503, "secret_key_unavailable"))
            blocked = unavailable.post(
                "/api/auth/login",
                json={"username": "alice", "password": "correct horse battery"},
                headers={"Origin": "http://testserver"},
            )
            self.assertEqual((blocked.status_code, blocked.json()["error"]["code"]), (503, "secret_key_unavailable"))
        finally:
            unavailable.close()

    def test_registration_validation_uses_the_standard_error_shape(self):
        response = self.client.post(
            "/api/auth/register", json={"username": "x", "password": "short"},
            headers={"X-CSRF-Token": self.csrf(), "Origin": "http://testserver"},
        )
        self.assertEqual((response.status_code, response.json()["error"]["code"]), (422, "validation_error"))
