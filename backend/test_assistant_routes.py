# -*- coding: utf-8 -*-
"""Account-scoped web assistant route contracts."""

from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.auth.types import AuthContext, PublicUser
from backend.routers import assistant_routes
from backend.schemas import AssistantChatRequest, MaterialDraftRequest
from backend.services.user_ai_settings import EffectiveAIConfig


def _auth():
    return AuthContext(PublicUser(7, "alice", "2026-01-01T00:00:00+00:00"), session_id=3)


def _config(*, unreadable=False):
    return EffectiveAIConfig(
        base_url="https://api.example.test",
        model="model-a",
        api_key="" if unreadable else "secret",
        generation={"max_tokens": 256},
        timeout_seconds=30,
        ai_enabled=not unreadable,
        api_key_unreadable=unreadable,
    )


class AssistantRouteTests(unittest.TestCase):
    def _request(self, config):
        service = SimpleNamespace(
            request_policy=SimpleNamespace(validate_base_url=lambda value: value),
            resolve_for_user=lambda user_id: config,
        )
        return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(user_ai_settings_service=service)))

    def test_assistant_uses_only_user_and_assistant_history(self):
        payload = AssistantChatRequest(messages=[
            {"role": "assistant", "content": "前情"},
            {"role": "user", "content": "帮我整理一下设定"},
        ])
        client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": "可以，从人物动机开始。"},
            {"type": "finish"},
        ])))
        context = {"mode": "read_only", "page": "/work?work=5", "current": {"kind": "work", "title": "测试作品"}, "owned": {}}

        with patch.object(assistant_routes, "create_client", return_value=client) as create_client, patch.object(assistant_routes, "build_read_only_context", return_value=context):
            response = assistant_routes.chat_with_assistant(payload, self._request(_config()), auth=_auth())

        self.assertEqual(response["message"], "可以，从人物动机开始。")
        sent_messages = client.stream_chat.call_args.args[0]
        self.assertEqual(sent_messages[0]["role"], "system")
        self.assertIn("绝不能修改", sent_messages[0]["content"])
        self.assertIn("测试作品", sent_messages[0]["content"])
        self.assertEqual([message["role"] for message in sent_messages[1:]], ["assistant", "user"])

    def test_system_prompt_sets_story_coauthoring_mode(self):
        prompt = assistant_routes._system_prompt({"mode": "read_only", "page": "/"})

        self.assertIn("故事共同创作者", prompt)
        self.assertIn("<inputs>", prompt)
        self.assertIn("角色 {{user}}", prompt)
        self.assertIn("绝不能修改", prompt)

    def test_unreadable_key_is_rejected_before_creating_client(self):
        payload = AssistantChatRequest(messages=[{"role": "user", "content": "你好"}])

        with patch.object(assistant_routes, "create_client") as create_client:
            with self.assertRaises(HTTPException) as captured:
                assistant_routes.chat_with_assistant(payload, self._request(_config(unreadable=True)), auth=_auth())

        self.assertEqual(captured.exception.status_code, 503)
        create_client.assert_not_called()

    def test_missing_key_returns_an_assistant_specific_local_reply(self):
        config = _config()
        config = EffectiveAIConfig(
            base_url=config.base_url,
            model=config.model,
            api_key="",
            generation=config.generation,
            timeout_seconds=config.timeout_seconds,
            ai_enabled=False,
        )
        payload = AssistantChatRequest(messages=[{"role": "user", "content": "想写一个雨夜开场"}])

        context = {
            "mode": "read_only", "page": "/", "current": {"kind": "page"},
            "catalog": {"work_count": 4, "role_card_count": 3, "worldbook_count": 2},
            "owned": {"works": [], "role_cards": [], "worldbooks": [], "conversations": []},
        }
        with patch.object(assistant_routes, "create_client") as create_client, patch.object(assistant_routes, "build_read_only_context", return_value=context):
            response = assistant_routes.chat_with_assistant(payload, self._request(config), auth=_auth())

        self.assertTrue(response["mock"])
        self.assertIn("雨夜开场", response["message"])
        self.assertIn("只读", response["message"])
        create_client.assert_not_called()

    def test_platform_work_count_comes_from_read_only_context_without_model(self):
        payload = AssistantChatRequest(messages=[{"role": "user", "content": "平台上一共有多少个剧本？"}])
        context = {
            "mode": "read_only", "page": "/", "current": {"kind": "page"},
            "catalog": {"work_count": 12, "role_card_count": 3, "worldbook_count": 2},
            "owned": {"works": [], "role_cards": [], "worldbooks": [], "conversations": []},
        }

        with patch.object(assistant_routes, "create_client") as create_client, patch.object(assistant_routes, "build_read_only_context", return_value=context):
            response = assistant_routes.chat_with_assistant(payload, self._request(_config()), auth=_auth())

        self.assertFalse(response["mock"])
        self.assertEqual(response["message"], "我已读取当前站内资料（只读）：平台目前共有12 部作品。")
        create_client.assert_not_called()

    def test_requires_latest_message_to_be_from_user(self):
        payload = AssistantChatRequest(messages=[{"role": "assistant", "content": "前情"}])

        with self.assertRaises(HTTPException) as captured:
            assistant_routes._normalize_messages(payload)

        self.assertEqual(captured.exception.status_code, 422)

    def test_material_draft_uses_dedicated_prompt_and_accepts_fenced_character_json(self):
        payload = MaterialDraftRequest(kind="character", text="顾遥是海港档案员")
        client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": "```json\n{"},
            {"type": "delta", "content": '"name":"顾遥","persona":"海港档案员","personality":"谨慎","speaking_style":"短句","directives":["不替玩家决定"],"character_attributes":{"好感度":0},"relationships":{"玩家":"初识"}}\n```'},
        ])))

        with patch.object(assistant_routes, "create_client", return_value=client), patch.object(assistant_routes, "build_read_only_context") as build_context:
            response = assistant_routes.generate_material_draft(payload, self._request(_config()), auth=_auth())

        self.assertEqual(response["kind"], "character")
        self.assertEqual(response["draft"]["name"], "顾遥")
        self.assertEqual(response["draft"]["directives"], ["不替玩家决定"])
        build_context.assert_not_called()
        sent_messages = client.stream_chat.call_args.args[0]
        self.assertEqual([message["role"] for message in sent_messages], ["system", "user"])
        self.assertIn("角色卡草稿", sent_messages[0]["content"])
        self.assertNotIn("站内只读资料快照", sent_messages[0]["content"])
        self.assertIn("<source_material>", sent_messages[1]["content"])

    def test_material_draft_accepts_worldbook_entries(self):
        payload = MaterialDraftRequest(kind="worldbook", text="雾港的夜航规则")
        client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": '{"title":"雾港","description":"海港城市","entries":[{"title":"夜航","keywords":["夜航","船票"],"content":"夜间出航需要蓝色船票。","priority":10,"enabled":true,"constant":false}]}'},
        ])))

        with patch.object(assistant_routes, "create_client", return_value=client):
            response = assistant_routes.generate_material_draft(payload, self._request(_config()), auth=_auth())

        self.assertEqual(response["draft"]["entries"][0]["keywords"], ["夜航", "船票"])
        self.assertEqual(response["draft"]["entries"][0]["priority"], 10)

    def test_material_draft_rejects_invalid_or_empty_worldbook_output(self):
        payload = MaterialDraftRequest(kind="worldbook", text="雾港")
        invalid_client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": "这不是 JSON"},
        ])))
        empty_client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": '{"title":"雾港","description":"","entries":[]}'},
        ])))

        with patch.object(assistant_routes, "create_client", return_value=invalid_client):
            with self.assertRaises(HTTPException) as invalid:
                assistant_routes.generate_material_draft(payload, self._request(_config()), auth=_auth())
        with patch.object(assistant_routes, "create_client", return_value=empty_client):
            with self.assertRaises(HTTPException) as empty:
                assistant_routes.generate_material_draft(payload, self._request(_config()), auth=_auth())

        self.assertEqual((invalid.exception.status_code, invalid.exception.detail["code"]), (502, "invalid_material_response"))
        self.assertEqual((empty.exception.status_code, empty.exception.detail["code"]), (502, "invalid_material_response"))

    def test_material_draft_rejects_character_without_a_name(self):
        payload = MaterialDraftRequest(kind="character", text="没有名字的角色资料")
        client = SimpleNamespace(stream_chat=MagicMock(return_value=iter([
            {"type": "delta", "content": '{"name":"","persona":"资料","personality":"","speaking_style":"","directives":[],"character_attributes":{},"relationships":{}}'},
        ])))

        with patch.object(assistant_routes, "create_client", return_value=client):
            with self.assertRaises(HTTPException) as captured:
                assistant_routes.generate_material_draft(payload, self._request(_config()), auth=_auth())

        self.assertEqual((captured.exception.status_code, captured.exception.detail["code"]), (502, "invalid_material_response"))

    def test_material_draft_requires_a_configured_real_model(self):
        config = _config()
        disabled = EffectiveAIConfig(
            base_url=config.base_url,
            model=config.model,
            api_key="",
            generation=config.generation,
            timeout_seconds=config.timeout_seconds,
            ai_enabled=False,
        )
        payload = MaterialDraftRequest(kind="character", text="角色资料")

        with patch.object(assistant_routes, "create_client") as create_client:
            with self.assertRaises(HTTPException) as captured:
                assistant_routes.generate_material_draft(payload, self._request(disabled), auth=_auth())

        self.assertEqual((captured.exception.status_code, captured.exception.detail["code"]), (503, "ai_not_configured"))
        create_client.assert_not_called()

    def test_material_draft_rejects_unreadable_key_before_creating_client(self):
        payload = MaterialDraftRequest(kind="character", text="角色资料")

        with patch.object(assistant_routes, "create_client") as create_client:
            with self.assertRaises(HTTPException) as captured:
                assistant_routes.generate_material_draft(payload, self._request(_config(unreadable=True)), auth=_auth())

        self.assertEqual(captured.exception.status_code, 503)
        self.assertEqual(captured.exception.detail["code"], "api_key_unreadable")
        create_client.assert_not_called()

    def test_material_draft_route_requires_authentication(self):
        app = FastAPI()
        app.include_router(assistant_routes.router)
        with TestClient(app) as client:
            response = client.post("/api/assistant/material-drafts", json={"kind": "character", "text": "角色资料"})

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
