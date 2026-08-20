import sqlite3
import tempfile
import unittest
from contextlib import closing
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend import database
from backend.auth.dependencies import require_station_master
from backend.auth.sessions import SessionService
from backend.auth.types import AuthContext, PublicUser
from backend.test_support.accounts import create_test_user, issue_test_session


class AdminSystemTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "DB_PATH", Path(self.tempdir.name) / "test.db")
        self.db_patch.start()
        database.init_db()
        with closing(database.connect()) as connection:
            self.alice = create_test_user(connection, "alice")
            self.bob = create_test_user(connection, "bob")
            connection.execute("UPDATE users SET role = 'station_master' WHERE id = ?", (self.alice["id"],))
            connection.execute(
                "INSERT INTO user_ai_settings (user_id, api_key_ciphertext, updated_at) VALUES (?, ?, ?)",
                (self.bob["id"], "ciphertext-must-not-leak", "now"),
            )
            connection.execute(
                """
                INSERT INTO user_ai_providers (
                    user_id, provider_id, display_name, base_url, protocol, model,
                    models_json, timeout_seconds, is_active, api_key_ciphertext, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (self.bob["id"], "test-provider", "测试 Provider", "https://provider.example/v1", "openai-completions", "test-model", '["test-model"]', 60, 1, "provider-ciphertext-must-not-leak", "now", "now"),
            )
            issue_test_session(connection, self.bob["id"], token="bob-session")
            connection.commit()
        self.station_user = PublicUser(self.alice["id"], "alice", self.alice["created_at"], role="station_master")

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_migration_adds_normal_user_role_and_audit_table(self):
        with closing(database.connect()) as connection:
            role = connection.execute("SELECT role FROM users WHERE id = ?", (self.bob["id"],)).fetchone()[0]
            audit_table = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_logs'"
            ).fetchone()

        self.assertEqual(role, "user")
        self.assertIsNotNone(audit_table)

    def test_station_master_guard_rejects_regular_user(self):
        request = SimpleNamespace(
            state=SimpleNamespace(
                auth=AuthContext(PublicUser(2, "bob", "now", role="user"), session_id=1)
            )
        )

        with self.assertRaises(HTTPException) as raised:
            require_station_master(request)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.detail["code"], "station_master_required")

    def test_admin_http_route_rejects_regular_session(self):
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        bob = self.bob

        class AuthStub:
            def authenticate(self, token):
                if token == "regular-session":
                    return AuthContext(
                        PublicUser(bob["id"], "bob", bob["created_at"], role="user"),
                        session_id=2,
                    )
                return None

        app = FastAPI()
        app.state.auth_service = AuthStub()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        response = TestClient(app).get(
            "/api/admin/overview", cookies={"neko_session": "regular-session"}
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "station_master_required")

    def test_station_can_list_users_without_secret_fields_and_suspend_user(self):
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        listed = client.get("/api/admin/users")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual({item["username"] for item in listed.json()["items"]}, {"alice", "bob"})
        serialized = listed.text
        self.assertNotIn("password_hash", serialized)
        self.assertNotIn("ciphertext-must-not-leak", serialized)
        bob_view = next(item for item in listed.json()["items"] if item["username"] == "bob")
        self.assertEqual(bob_view["ai"]["providers"][0]["model"], "test-model")
        self.assertNotIn("provider-ciphertext-must-not-leak", serialized)

        suspended = client.post(f"/api/admin/users/{self.bob['id']}/suspend")
        self.assertEqual(suspended.status_code, 200)
        self.assertFalse(suspended.json()["user"]["is_active"])

        with closing(database.connect()) as connection:
            self.assertIsNone(SessionService(connection).authenticate("bob-session"))
            audit = connection.execute(
                "SELECT action, target_user_id, summary_json FROM admin_audit_logs ORDER BY id DESC LIMIT 1"
            ).fetchone()
        self.assertEqual((audit["action"], audit["target_user_id"]), ("suspend_user", self.bob["id"]))
        self.assertNotIn("ciphertext", audit["summary_json"])

    def test_station_can_read_overview_and_reset_password_without_returning_secret(self):
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        overview = client.get("/api/admin/overview")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.json()["users"]["total"], 2)
        self.assertEqual(overview.headers.get("cache-control"), "no-store")

        reset = client.post(
            f"/api/admin/users/{self.bob['id']}/reset-password",
            json={"new_password": "new temporary password"},
        )
        self.assertEqual(reset.status_code, 200)
        self.assertNotIn("password", reset.text)
        with closing(database.connect()) as connection:
            self.assertIsNone(SessionService(connection).authenticate("bob-session"))

    def test_overview_includes_request_ip_for_recent_audits(self):
        from backend.services.admin_service import AdminService, record_admin_audit

        with closing(database.connect()) as connection:
            record_admin_audit(
                connection,
                actor_user_id=self.alice["id"],
                target_user_id=self.bob["id"],
                action="test_audit",
                target_type="user",
                target_id=self.bob["id"],
                request_ip="test-client",
            )
            connection.commit()
            overview = AdminService(connection).overview()

        self.assertEqual(overview["recent_audits"][0]["request_ip"], "test-client")

    def test_station_can_clear_ai_secrets_without_receiving_the_ciphertext(self):
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        response = TestClient(app).post(f"/api/admin/users/{self.bob['id']}/ai/clear-secrets")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("ciphertext", response.text)
        with closing(database.connect()) as connection:
            value = connection.execute(
                "SELECT api_key_ciphertext FROM user_ai_settings WHERE user_id = ?",
                (self.bob["id"],),
            ).fetchone()[0]
        self.assertEqual(value, "")

    def _seed_bob_resources(self):
        with closing(database.connect()) as connection:
            card_id = connection.execute(
                "INSERT INTO cards (owner_user_id, name, persona, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (self.bob["id"], "Bob 角色", "旧人设", "now", "now"),
            ).lastrowid
            worldbook_id = connection.execute(
                "INSERT INTO worldbooks (owner_user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (self.bob["id"], "Bob 世界", "旧世界", "now", "now"),
            ).lastrowid
            connection.execute(
                "INSERT INTO worldbook_entries (worldbook_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (worldbook_id, "规则", "旧规则", "now", "now"),
            )
            work_id = connection.execute(
                "INSERT INTO works (owner_user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (self.bob["id"], "Bob 作品", "旧简介", "now", "now"),
            ).lastrowid
            connection.execute(
                "INSERT INTO work_cards (work_id, card_id, position) VALUES (?, ?, 0)",
                (work_id, card_id),
            )
            conversation_id = connection.execute(
                "INSERT INTO conversations (user_id, work_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (self.bob["id"], work_id, "Bob 会话", "now", "now"),
            ).lastrowid
            connection.execute(
                "INSERT INTO states (conversation_id, attributes) VALUES (?, ?)",
                (conversation_id, '{"hp": 10}'),
            )
            message_id = connection.execute(
                "INSERT INTO messages (conversation_id, role, content, sequence) VALUES (?, 'user', '旧消息', 0)",
                (conversation_id,),
            ).lastrowid
            snapshot_id = connection.execute(
                "INSERT INTO snapshots (conversation_id, name, state, messages) VALUES (?, ?, ?, ?)",
                (conversation_id, "旧存档", '{"hp": 10}', '[]'),
            ).lastrowid
            connection.commit()
        return card_id, worldbook_id, work_id, conversation_id, message_id, snapshot_id

    def test_station_can_manage_cross_account_resources_without_reassigning_owner(self):
        card_id, _worldbook_id, _work_id, _conversation_id, _message_id, _snapshot_id = self._seed_bob_resources()
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        listed = client.get("/api/admin/resources?kind=card")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"][0]["owner_username"], "bob")

        detail = client.get(f"/api/admin/resources/card/{card_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["resource"]["persona"], "旧人设")

        updated = client.patch(
            f"/api/admin/resources/card/{card_id}",
            json={"name": "Bob 角色（修订）", "persona": "新设定"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["resource"]["owner_user_id"], self.bob["id"])
        self.assertEqual(updated.json()["resource"]["name"], "Bob 角色（修订）")

    def test_station_can_read_conversation_messages_and_delete_it_with_children(self):
        _card_id, _worldbook_id, _work_id, conversation_id, message_id, snapshot_id = self._seed_bob_resources()
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        detail = client.get(f"/api/admin/resources/conversation/{conversation_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["resource"]["messages"][0]["id"], message_id)

        deleted = client.delete(f"/api/admin/resources/conversation/{conversation_id}")
        self.assertEqual(deleted.status_code, 204)
        with closing(database.connect()) as connection:
            self.assertIsNone(connection.execute("SELECT id FROM messages WHERE id = ?", (message_id,)).fetchone())
            self.assertIsNone(connection.execute("SELECT id FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone())

    def test_station_can_export_worldbook_and_reject_delete_of_referenced_card(self):
        card_id, worldbook_id, _work_id, _conversation_id, _message_id, _snapshot_id = self._seed_bob_resources()
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        exported = client.get(f"/api/admin/resources/worldbook/{worldbook_id}/export")
        self.assertEqual(exported.status_code, 200)
        self.assertIn('attachment; filename="admin-worldbook-', exported.headers.get("content-disposition", ""))
        self.assertEqual(exported.json()["entries"][0]["content"], "旧规则")

        blocked = client.delete(f"/api/admin/resources/card/{card_id}")
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["detail"]["code"], "resource_referenced")

    def test_station_can_manage_worldbook_entries_as_separate_resources(self):
        _card_id, worldbook_id, _work_id, _conversation_id, _message_id, _snapshot_id = self._seed_bob_resources()
        with closing(database.connect()) as connection:
            entry_id = connection.execute(
                "SELECT id FROM worldbook_entries WHERE worldbook_id = ?", (worldbook_id,)
            ).fetchone()[0]
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        listed = client.get("/api/admin/resources?kind=worldbook_entry")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"][0]["owner_username"], "bob")
        updated = client.patch(
            f"/api/admin/resources/worldbook_entry/{entry_id}",
            json={"content": "新规则"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["resource"]["content"], "新规则")
        self.assertEqual(client.delete(f"/api/admin/resources/worldbook_entry/{entry_id}").status_code, 204)

    def test_station_can_manage_live_state_as_separate_resource(self):
        _card_id, _worldbook_id, _work_id, conversation_id, _message_id, _snapshot_id = self._seed_bob_resources()
        with closing(database.connect()) as connection:
            state_id = connection.execute(
                "SELECT id FROM states WHERE conversation_id = ?", (conversation_id,)
            ).fetchone()[0]
        from backend.routers.admin_routes import router
        from backend.services.admin_service import AdminService

        app = FastAPI()
        app.state.admin_service = AdminService(database.connect)
        app.include_router(router)
        app.dependency_overrides[require_station_master] = lambda: self.station_user
        client = TestClient(app)

        listed = client.get("/api/admin/resources?kind=state")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"][0]["owner_username"], "bob")
        updated = client.patch(
            f"/api/admin/resources/state/{state_id}",
            json={"attributes": {"hp": 12}, "money": 88},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["resource"]["attributes"], {"hp": 12})
        self.assertEqual(client.delete(f"/api/admin/resources/state/{state_id}").status_code, 204)

    def test_station_cannot_suspend_last_station_master(self):
        from backend.services.admin_service import AdminService

        with closing(database.connect()) as connection:
            service = AdminService(connection)
            with self.assertRaises(ValueError) as raised:
                service.set_user_active(self.station_user, self.alice["id"], False, request_ip="test")
        self.assertEqual(raised.exception.code, "last_station_master")

    def test_promote_command_is_idempotent_and_rejects_second_station(self):
        from backend.admin_cli import promote_station_master, StationMasterExists

        with closing(database.connect()) as connection:
            connection.execute("UPDATE users SET role = 'user' WHERE id = ?", (self.alice["id"],))
            connection.commit()
            promoted = promote_station_master(connection, "bob")
            self.assertEqual(promoted["username"], "bob")
            self.assertNotIn("password_hash", promoted)
            self.assertEqual(connection.execute("SELECT role FROM users WHERE id = ?", (self.bob["id"],)).fetchone()[0], "station_master")
            with self.assertRaises(StationMasterExists):
                promote_station_master(connection, "alice")


if __name__ == "__main__":
    unittest.main()
