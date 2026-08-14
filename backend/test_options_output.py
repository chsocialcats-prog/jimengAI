# -*- coding: utf-8 -*-
"""Structured and fallback option output contracts."""

import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.types import AuthContext, ConversationAccess, PublicUser
from backend.routers import chat_routes
from backend.services import adventure_engine
from backend.services import context_service
from backend.services.user_ai_settings import EffectiveAIConfig


class OptionOutputTests(unittest.TestCase):
    def test_stream_filter_extracts_structured_options_without_leaking_tag(self):
        output_filter = adventure_engine.StructuredOutputFilter()

        visible = output_filter.feed(
            "你站在门前。<options>[\"观察门锁\", \"敲门\", \"离开\"]</options>"
        )
        tail, state_delta, judge_block, options = output_filter.finish()

        self.assertEqual(visible + tail, "你站在门前。")
        self.assertIsNone(state_delta)
        self.assertIsNone(judge_block)
        self.assertEqual(options, ["观察门锁", "敲门", "离开"])

    def test_prompt_requires_structured_options_block(self):
        prompt = adventure_engine.build_system_prompt(
            None,
            None,
            None,
            [],
            {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []},
            "",
        )

        self.assertIn("<options>[\"选项一\",\"选项二\"]</options>", prompt)
        self.assertIn("不要在剧情正文中重复列出选项", prompt)
        self.assertNotIn("每次回复末尾都用“选项：”", prompt)

    def test_fallback_options_are_always_two_to_four_actions(self):
        options = adventure_engine.default_turn_options("你来到一扇紧闭的门前。", "继续观察")

        self.assertGreaterEqual(len(options), 2)
        self.assertLessEqual(len(options), 4)
        self.assertTrue(all(isinstance(option, str) and option for option in options))

    def test_legacy_visible_options_are_extracted_before_fallback(self):
        narrative = (
            "你站在门前。\n"
            "选项：\n"
            "- 观察门锁\n"
            "- 敲门\n"
            "- 离开\n"
            "【状态变化】\n"
            "心情 +1"
        )

        self.assertEqual(
            adventure_engine.parse_visible_options(narrative),
            ["观察门锁", "敲门", "离开"],
        )

    def test_bare_bullets_are_extracted_before_fallback(self):
        narrative = (
            "她注视着你，只等着你给出自己的选择。\n\n"
            "- 问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？\n"
            "- 决定签下保密契约，跟她进入东区禁书区\n"
            "- 先问她：你有没有亲眼见过实际存在的那本笔记？\n"
            "- 微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”\n\n"
            "【状态变化】\n"
            "- 塞西莉亚·好感度 +2"
        )

        self.assertEqual(
            adventure_engine.parse_visible_options(narrative),
            [
                "问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？",
                "决定签下保密契约，跟她进入东区禁书区",
                "先问她：你有没有亲眼见过实际存在的那本笔记？",
                "微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”",
            ],
        )

    def test_missing_model_options_are_recovered_before_generic_fallback(self):
        class Client:
            def __init__(self):
                self.calls = []

            def stream_chat(self, messages, max_tokens=None):
                self.calls.append({"messages": messages, "max_tokens": max_tokens})
                if len(self.calls) == 1:
                    yield {"type": "delta", "content": "她停在门口，等你回应。"}
                else:
                    yield {
                        "type": "delta",
                        "content": '<options>["询问她的计划","看看手里的信","先离开"]</options>',
                    }
                yield {"type": "finish", "finish_reason": "stop"}

        client = Client()
        access = ConversationAccess(
            AuthContext(PublicUser(1, "options-user", "2026-01-01T00:00:00+00:00"), 1),
            {"id": 77, "owner_user_id": 1},
        )
        effective_config = EffectiveAIConfig(
            base_url="https://api.deepseek.com",
            model="test-model",
            api_key="test-key",
            generation={"max_tokens": 2048},
            timeout_seconds=60,
            ai_enabled=True,
        )
        inspection = SimpleNamespace(needs_compression=False)
        prepared = SimpleNamespace(
            messages=[
                {"role": "system", "content": "rules"},
                {"role": "user", "content": "继续剧情"},
            ],
            prompt_tokens_after=10,
            compressed=False,
            method=None,
        )
        state = {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []}
        with patch.object(
            context_service, "inspect_context", return_value=inspection
        ), patch.object(
            context_service, "prepare_context", return_value=prepared
        ), patch.object(
            chat_routes, "create_client", return_value=client
        ), patch.object(
            chat_routes.conversation_repository, "create_message", return_value={"id": 77}
        ), patch.object(
            chat_routes.conversation_repository, "update_message"
        ) as update_message, patch.object(
            chat_routes.conversation_repository,
            "get_message",
            return_value={"metadata": {"status": "done"}},
        ), patch.object(
            chat_routes.snapshot_service, "autosave"
        ), patch.object(
            chat_routes, "_state_event", return_value={}
        ), patch.object(
            chat_routes.state_service, "get_state", return_value=state
        ), patch.object(
            chat_routes.state_service, "apply_state_delta"
        ), patch.object(
            chat_routes.adventure_engine,
            "default_turn_options",
            return_value=["默认选项"],
        ) as default_options, patch.object(
            chat_routes.adventure_engine,
            "default_turn_state_delta",
            return_value=None,
        ):
            events = list(
                chat_routes._stream_ai_reply(
                    access, threading.Event(), {}, effective_config, None
                )
            )

        metadata = update_message.call_args.kwargs["metadata"]
        self.assertEqual(
            metadata["options"],
            ["询问她的计划", "看看手里的信", "先离开"],
        )
        self.assertEqual(len(client.calls), 2)
        default_options.assert_not_called()
        done_events = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: done")
        ]
        self.assertEqual(done_events[0]["options"], metadata["options"])


if __name__ == "__main__":
    unittest.main()
