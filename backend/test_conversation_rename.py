# -*- coding: utf-8 -*-
"""API coverage for renaming an existing conversation."""

import asyncio
import json
import unittest
from backend import database, repositories
from backend.main import app
from backend.auth.dependencies import require_auth
from backend.test_helpers import IsolatedDatabaseTestCase


class ConversationRenameTests(IsolatedDatabaseTestCase):
    """Removing the rename route or its title validation breaks these API contracts."""

    def setUp(self):
        super().setUp()
        app.dependency_overrides[require_auth] = lambda: self.test_auth
        app.user_middleware.clear()
        app.middleware_stack = None
        work = repositories.create_work({"title": "Rename test work"}, owner_user_id=self.test_user.id)
        self.conversation = repositories.create_conversation(work["id"], "Before rename", user_id=self.test_user.id)

    def tearDown(self):
        app.dependency_overrides.clear()
        super().tearDown()

    def test_rename_returns_the_updated_conversation(self):
        status_code, body = self.request(
            "PUT",
            f"/api/conversations/{self.conversation['id']}",
            {"title": "After rename"},
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(body["id"], self.conversation["id"])
        self.assertEqual(body["title"], "After rename")

    def test_rename_missing_conversation_returns_standard_not_found(self):
        status_code, body = self.request(
            "PUT", "/api/conversations/999999", {"title": "Missing"}
        )

        self.assertEqual(status_code, 404)
        self.assertEqual(
            body,
            {"error": {"code": "not_found", "message": "冒险会话不存在"}},
        )

    def test_rename_blank_title_returns_standard_validation_error(self):
        status_code, body = self.request(
            "PUT",
            f"/api/conversations/{self.conversation['id']}",
            {"title": ""},
        )

        self.assertEqual(status_code, 422)
        self.assertEqual(
            body,
            {"error": {"code": "validation_error", "message": "请求参数校验失败"}},
        )

    def test_state_uses_frozen_card_snapshot_after_live_card_is_edited(self):
        card = repositories.create_card({
            "name": "Frozen hero",
            "persona": "original persona",
            "character_attributes": {"mood": 50},
        }, owner_user_id=self.test_user.id)
        work = repositories.create_work({
            "title": "Snapshot state work",
            "card_ids": [card["id"]],
        }, owner_user_id=self.test_user.id)
        conversation = repositories.create_conversation(work["id"], "Frozen state", user_id=self.test_user.id)
        repositories.save_state(conversation["id"], {"characters": {}}, user_id=self.test_user.id)
        repositories.update_card(card["id"], {"character_attributes": {"mood": 99}}, owner_user_id=self.test_user.id)

        status_code, body = self.request(
            "GET", f"/api/conversations/{conversation['id']}/state", None
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(body["characters"]["Frozen hero"]["attributes"]["mood"], 50)

    def test_memory_summary_returns_the_current_conversation_record(self):
        repositories.save_memory_summary(
            self.conversation["id"], "旧城区的门已打开。", 6, user_id=self.test_user.id
        )

        status_code, body = self.request(
            "GET", f"/api/conversations/{self.conversation['id']}/memory-summary", None
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(body["summary"], "旧城区的门已打开。")
        self.assertEqual(body["covered_until_sequence"], 6)
        self.assertIn("updated_at", body)

    def test_memory_summary_missing_conversation_returns_standard_not_found(self):
        status_code, body = self.request("GET", "/api/conversations/999999/memory-summary", None)

        self.assertEqual(status_code, 404)
        self.assertEqual(
            body,
            {"error": {"code": "not_found", "message": "冒险会话不存在"}},
        )

    def request(self, method, path, payload):
        """Invoke the ASGI app without a third-party HTTP test client."""
        raw_body = json.dumps(payload).encode("utf-8")
        messages = []
        sent_request = False

        async def receive():
            nonlocal sent_request
            if sent_request:
                return {"type": "http.disconnect"}
            sent_request = True
            return {"type": "http.request", "body": raw_body}

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(raw_body)).encode("ascii")),
            ],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "root_path": "",
        }
        asyncio.run(app(scope, receive, send))
        start = next(message for message in messages if message["type"] == "http.response.start")
        raw_response = b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
        return start["status"], json.loads(raw_response)


if __name__ == "__main__":
    unittest.main()
