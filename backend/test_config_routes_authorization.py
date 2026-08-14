# -*- coding: utf-8 -*-
"""Authentication and ephemeral preview contracts for personal settings routes."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth.types import PublicUser
from backend.routers.settings_routes import router


class _AuthService:
    def __init__(self):
        self.user = PublicUser(7, "alice", "now")

    def authenticate(self, token):
        return SimpleNamespace(user=self.user, session_id=3) if token == "session" else None


class ConfigRouteAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.service = Mock()
        self.service.public_for_user.return_value = {
            "app": {"host": "127.0.0.1"},
            "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
            "generation": {},
            "api_key_set": True,
            "api_key_unreadable": False,
        }
        self.service.resolve_for_user.return_value = SimpleNamespace(
            base_url="https://api.deepseek.com", model="saved-model", api_key="test-token-saved", ai_enabled=True, api_key_unreadable=False,
        )
        self.service.preview_config.return_value = SimpleNamespace(
            base_url="https://api.deepseek.com", model="saved-model", api_key="test-token-preview", ai_enabled=True, api_key_unreadable=False,
        )
        app = FastAPI()
        app.state.auth_service = _AuthService()
        app.state.user_ai_settings_service = self.service
        app.include_router(router)
        self.client = TestClient(app)

    def test_config_and_model_routes_require_a_logged_in_user(self):
        for method, path in (("get", "/api/config"), ("get", "/api/models"), ("post", "/api/models/preview")):
            with self.subTest(path=path):
                response = getattr(self.client, method)(path, json={}) if method == "post" else getattr(self.client, method)(path)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["detail"]["code"], "authentication_required")

    def test_preview_uses_ephemeral_key_without_writing_user_settings(self):
        with __import__("unittest.mock").mock.patch("backend.routers.settings_routes.discover_models", return_value={"items": []}) as discover:
            response = self.client.post(
                "/api/models/preview",
                cookies={"neko_session": "session"},
                json={"base_url": "https://api.deepseek.com", "api_key": "test-token-preview"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(discover.call_args.args[0].api_key, "test-token-preview")
        self.service.update_for_user.assert_not_called()

    def test_config_rejects_machine_level_app_fields(self):
        response = self.client.put(
            "/api/config",
            cookies={"neko_session": "session"},
            json={"app": {"host": "attacker.example"}},
        )
        self.assertEqual(response.status_code, 422)
        self.service.update_for_user.assert_not_called()
