# -*- coding: utf-8 -*-
"""双账号跨层冒烟：共享内容可读，冒险数据和 AI 设置严格隔离。"""

from contextlib import closing
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet

from backend import database, repositories
from backend.auth.dependencies import optional_user, require_user
from backend.auth.keyring import AuthKeyring
from backend.auth.types import AuthContext, PublicUser
from backend.repository import conversation_repository, snapshot_repository
from backend.routers import cards_routes, chat_routes, works_routes
from backend.services.user_ai_settings import UserAISettingsService
from backend.repository.user_ai_settings import UserAISettingsRepository
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class AccountSystemSmokeTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.alice = create_test_user(connection, "alice")
            self.bob = create_test_user(connection, "bob")
            connection.commit()
        self.alice_user = PublicUser(self.alice["id"], "alice", self.alice["created_at"])
        self.bob_user = PublicUser(self.bob["id"], "bob", self.bob["created_at"])
        self.alice_auth = AuthContext(self.alice_user, 101)
        self.bob_auth = AuthContext(self.bob_user, 202)
        self.card = repositories.create_card(
            {"name": "共享角色", "persona": "公开设定"},
            owner_user_id=self.alice["id"],
        )
        self.work = repositories.create_work(
            {"title": "共享作品", "card_id": self.card["id"]},
            owner_user_id=self.alice["id"],
        )
        self.alice_conversation = repositories.create_conversation(
            self.work["id"], "Alice 私人会话", user_id=self.alice["id"]
        )
        repositories.create_message(
            self.alice_conversation["id"], "user", "Alice 私人消息", user_id=self.alice["id"]
        )
        self.alice_snapshot = repositories.create_snapshot(
            self.alice_conversation["id"], name="Alice 私人存档", user_id=self.alice["id"]
        )

    def _library_client(self, user):
        app = FastAPI()

        @app.exception_handler(HTTPException)
        async def errors(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

        app.include_router(cards_routes.router)
        app.include_router(works_routes.router)
        app.dependency_overrides[optional_user] = lambda: user
        app.dependency_overrides[require_user] = lambda: user
        return TestClient(app)

    def test_bob_reads_public_library_but_cannot_write_alice_resource(self):
        with self._library_client(self.bob_user) as client:
            listed = client.get("/api/cards")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json()["items"][0]["owner_username"], "alice")
            self.assertFalse(listed.json()["items"][0]["can_edit"])

            denied = client.put(
                f"/api/cards/{self.card['id']}", json={"name": "越权修改"}
            )
            self.assertEqual((denied.status_code, denied.json()["error"]["code"]), (403, "forbidden"))

    def test_private_conversation_messages_and_snapshot_are_invisible_to_bob(self):
        conversation_id = self.alice_conversation["id"]
        snapshot_id = self.alice_snapshot["id"]
        self.assertIsNone(repositories.get_conversation(conversation_id, self.bob["id"]))
        self.assertEqual(repositories.get_messages(conversation_id, self.bob["id"]), [])
        self.assertIsNone(snapshot_repository.get_snapshot(snapshot_id, self.bob["id"]))
        self.assertEqual(snapshot_repository.list_snapshots(conversation_id, self.bob["id"]), [])
        self.assertIsNotNone(repositories.get_conversation(conversation_id, self.alice["id"]))

    def test_chat_and_stop_require_the_conversation_owner(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        request.app.state.user_ai_settings_service = SimpleNamespace(
            request_policy=None,
            resolve_for_user=lambda user_id: SimpleNamespace(
                api_key_unreadable=False,
                api_key="",
                ai_enabled=False,
                base_url="https://api.example.test",
                model="mock",
                generation={"max_tokens": 32},
            ),
        )
        with patch.object(chat_routes, "_get_conversation_or_404", side_effect=HTTPException(404, {"code": "not_found", "message": "不存在"})):
            with self.assertRaises(HTTPException) as chat_error:
                chat_routes.chat(
                    self.alice_conversation["id"],
                    SimpleNamespace(content="越权聊天", metadata={}),
                    request,
                    auth=self.bob_auth,
                )
            with self.assertRaises(HTTPException) as stop_error:
                chat_routes.stop_chat(
                    self.alice_conversation["id"], request, auth=self.bob_auth
                )
        self.assertEqual(chat_error.exception.status_code, 404)
        self.assertEqual(stop_error.exception.status_code, 404)

    def test_ai_settings_are_owner_scoped_and_public_projection_never_contains_key(self):
        keyring = AuthKeyring([Fernet.generate_key()])
        service = UserAISettingsService(
            UserAISettingsRepository(database.connect), keyring,
            app_config={"app": {"host": "127.0.0.1"}},
        )
        try:
            alice_view = service.update_for_user(
                self.alice["id"],
                {"deepseek": {"model": "alice-model", "api_key": "smoke-alice-key"}},
            )
            bob_view = service.update_for_user(
                self.bob["id"],
                {"deepseek": {"model": "bob-model", "api_key": "smoke-bob-key"}},
            )
            self.assertNotIn("api_key", alice_view["deepseek"])
            self.assertNotIn("api_key", bob_view["deepseek"])
            self.assertEqual(service.resolve_for_user(self.alice["id"]).model, "alice-model")
            self.assertEqual(service.resolve_for_user(self.bob["id"]).model, "bob-model")
            self.assertNotEqual(
                service.resolve_for_user(self.alice["id"]).api_key,
                service.resolve_for_user(self.bob["id"]).api_key,
            )
        finally:
            # The repository factory owns each connection opened by the service.
            pass


if __name__ == "__main__":
    unittest.main()
