# -*- coding: utf-8 -*-
"""冒险引擎世界书匹配的回归测试。"""

import unittest
import threading
from types import SimpleNamespace
from unittest.mock import patch

from backend.services import adventure_engine
from backend.services import context_service
from backend.services.adventure_engine import match_worldbook_entries
from backend.routers import chat_routes
from backend.auth.types import AuthContext, ConversationAccess, PublicUser
from backend.services.user_ai_settings import EffectiveAIConfig


class WorldbookMatchingTests(unittest.TestCase):
    def test_matches_case_insensitively_and_ranks_deterministically(self):
        worldbook = {
            "entries": [
                {"id": 4, "priority": 10, "keywords": ["gate"], "enabled": True},
                {"id": 2, "priority": 10, "keywords": ["gate", "iron gate"], "enabled": True},
                {"id": 3, "priority": 10, "keywords": ["iron gate"], "enabled": True},
                {"id": 1, "priority": 20, "keywords": ["gate"], "enabled": True},
                {"id": 5, "priority": 99, "keywords": ["gate"], "enabled": False},
                {"id": 6, "priority": 99, "keywords": ["", None, 42], "enabled": True},
            ]
        }

        hits = match_worldbook_entries(worldbook, "The IRON GATE opens")

        self.assertEqual([entry["id"] for entry in hits], [1, 2, 3, 4])


class StateInstructionTests(unittest.TestCase):
    def test_prompt_requires_structured_delta_for_explicit_state_changes(self):
        prompt = adventure_engine.build_system_prompt(
            None,
            None,
            None,
            [],
            {"attributes": {"心情": 65}, "items": [], "money": 0,
             "relations": {}, "quests": [], "flags": []},
            "",
        )

        self.assertIn("玩家明确要求修改数值、物品、任务、关系或状态时，必须输出", prompt)
        self.assertIn('"attributes":{"心情":"+5"}', prompt)
        self.assertIn("不要在剧情正文中重复列出选项", prompt)
        self.assertIn("除纯说明、查询或玩家明确要求不改变状态外，每次有效互动都必须", prompt)


class VisibleStateDeltaFallbackTests(unittest.TestCase):
    def setUp(self):
        self.access = ConversationAccess(
            AuthContext(PublicUser(1, "stream-user", "2026-01-01T00:00:00+00:00"), 1),
            {"id": 99, "owner_user_id": 1},
        )
        self.effective_config = EffectiveAIConfig(
            base_url="https://api.deepseek.com",
            model="test-model",
            api_key="key",
            generation={"max_tokens": 2048},
            timeout_seconds=60,
            ai_enabled=True,
        )
        self.recover_options = patch.object(
            chat_routes,
            "_recover_missing_options",
            return_value=None,
        )
        self.recover_options.start()

    def tearDown(self):
        self.recover_options.stop()

    def test_stream_ai_reply_emits_context_events_for_compression(self):
        class ReplyClient:
            def __init__(self):
                self.messages = None

            def stream_chat(self, _messages):
                self.messages = _messages
                yield {"type": "delta", "content": "最新回复"}
                yield {
                    "type": "usage",
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                }

        prepared = context_service.PreparedContext(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens_before=100,
            prompt_tokens_after=20,
            compressed=True,
            method="ai",
            covered_until_sequence=4,
        )
        inspection = context_service.ContextInspection(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens=100,
            trigger_limit=100,
            needs_compression=True,
        )
        state = {
            "attributes": {}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        client = ReplyClient()
        with patch.object(
            context_service,
            "inspect_context",
            return_value=inspection,
        ), patch.object(
            context_service,
            "prepare_context",
            return_value=prepared,
        ), patch.object(chat_routes, "create_client", return_value=client), \
             patch.object(chat_routes.conversation_repository, "create_message", return_value={"id": 19}), \
             patch.object(chat_routes.conversation_repository, "update_message") as update_message, \
             patch.object(chat_routes.conversation_repository, "get_message", return_value={"metadata": {"status": "done"}}), \
             patch.object(chat_routes.state_service, "get_state", return_value=state), \
             patch.object(chat_routes.state_service, "apply_state_delta"), \
             patch.object(chat_routes.snapshot_service, "autosave"):
            events = list(chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None))

        stream = "".join(events)
        self.assertEqual(client.messages, prepared.messages)
        self.assertIn('event: context\ndata: {"status": "compressing"}', stream)
        self.assertIn('"status": "compressed"', stream)
        self.assertIn('"before_tokens": 100', stream)
        self.assertIn('"after_tokens": 20', stream)
        self.assertIn('"method": "ai"', stream)
        self.assertIn('"prompt_tokens": 0', stream)
        self.assertLess(
            stream.index('"status": "compressing"'),
            stream.index('"status": "compressed"'),
        )
        self.assertLess(stream.index('"status": "compressed"'), stream.index("event: meta"))
        self.assertLess(stream.index("event: meta"), stream.index("event: delta"))
        self.assertEqual(
            update_message.call_args.kwargs["metadata"]["usage"],
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        )

    def test_stream_ai_reply_emits_no_context_event_without_compression(self):
        class ReplyClient:
            def stream_chat(self, _messages):
                yield {"type": "delta", "content": "最新回复"}

        inspection = context_service.ContextInspection(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens=20,
            trigger_limit=100,
            needs_compression=False,
        )
        prepared = context_service.PreparedContext(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens_before=20,
            prompt_tokens_after=20,
            compressed=False,
            method=None,
            covered_until_sequence=-1,
        )
        state = {
            "attributes": {}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        with patch.object(
            context_service, "inspect_context", return_value=inspection
        ) as inspect_context, patch.object(
            context_service, "prepare_context", return_value=prepared
        ) as prepare_context, patch.object(
            chat_routes, "create_client", return_value=ReplyClient()
        ), patch.object(chat_routes.conversation_repository, "create_message", return_value={"id": 20}), \
             patch.object(chat_routes.conversation_repository, "update_message"), \
             patch.object(chat_routes.conversation_repository, "get_message", return_value={"metadata": {"status": "done"}}), \
             patch.object(chat_routes.state_service, "get_state", return_value=state), \
             patch.object(chat_routes.state_service, "apply_state_delta"), \
             patch.object(chat_routes.snapshot_service, "autosave"):
            stream = "".join(chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None))

        inspect_context.assert_called_once()
        prepare_context.assert_called_once_with(self.access, self.effective_config, request_policy=None, inspection=inspection)
        self.assertNotIn("event: context", stream)

    def test_stream_ai_reply_does_not_leave_context_status_open_without_archive_work(self):
        class ReplyClient:
            def stream_chat(self, _messages):
                yield {"type": "delta", "content": "reply"}

        inspection = context_service.ContextInspection(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens=120,
            trigger_limit=100,
            needs_compression=True,
        )
        prepared = context_service.PreparedContext(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens_before=120,
            prompt_tokens_after=120,
            compressed=False,
            method=None,
            covered_until_sequence=12,
        )
        state = {
            "attributes": {}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        with patch.object(
            context_service,
            "inspect_context",
            return_value=inspection,
        ), patch.object(
            context_service,
            "prepare_context",
            return_value=prepared,
        ), patch.object(
            chat_routes,
            "create_client",
            return_value=ReplyClient(),
        ), patch.object(
            chat_routes.conversation_repository,
            "create_message",
            return_value={"id": 21},
        ), patch.object(
            chat_routes.conversation_repository,
            "update_message",
        ), patch.object(
            chat_routes.conversation_repository,
            "get_message",
            return_value={"metadata": {"status": "done"}},
        ), patch.object(
            chat_routes.state_service,
            "get_state",
            return_value=state,
        ), patch.object(
            chat_routes.state_service,
            "apply_state_delta",
        ), patch.object(
            chat_routes.snapshot_service,
            "autosave",
        ):
            stream = "".join(chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None))

        self.assertIn('event: context\ndata: {"status": "compressing"}', stream)
        self.assertIn('"status": "fallback"', stream)
        self.assertIn('"before_tokens": 120', stream)
        self.assertIn('"after_tokens": 120', stream)
        self.assertIn('"method": "local"', stream)
        self.assertLess(
            stream.index('"status": "compressing"'),
            stream.index('"status": "fallback"'),
        )
        self.assertLess(stream.index('"status": "fallback"'), stream.index("event: meta"))

    def test_stream_ai_reply_yields_compressing_before_context_preparation(self):
        class ReplyClient:
            def stream_chat(self, _messages):
                yield {"type": "delta", "content": "reply"}

        inspection = context_service.ContextInspection(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens=120,
            trigger_limit=100,
            needs_compression=True,
        )
        prepared = context_service.PreparedContext(
            messages=[{"role": "user", "content": "latest"}],
            prompt_tokens_before=120,
            prompt_tokens_after=20,
            compressed=True,
            method="local",
            covered_until_sequence=12,
        )
        state = {
            "attributes": {}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        preparation_calls = []

        def prepare(*args, **kwargs):
            preparation_calls.append(True)
            return prepared

        with patch.object(
            context_service, "inspect_context", return_value=inspection
        ), patch.object(
            context_service, "prepare_context", side_effect=prepare
        ), patch.object(
            chat_routes, "create_client", return_value=ReplyClient()
        ), patch.object(
            chat_routes.conversation_repository, "create_message", return_value={"id": 22}
        ), patch.object(
            chat_routes.conversation_repository, "update_message"
        ), patch.object(
            chat_routes.conversation_repository, "get_message", return_value={"metadata": {"status": "done"}}
        ), patch.object(
            chat_routes.state_service, "get_state", return_value=state
        ), patch.object(
            chat_routes.state_service, "apply_state_delta"
        ), patch.object(
            chat_routes.snapshot_service, "autosave"
        ):
            stream = chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None)
            first_event = next(stream)
            self.assertIn('event: context\ndata: {"status": "compressing"}', first_event)
            self.assertFalse(preparation_calls)
            remaining = "".join(stream)

        self.assertTrue(preparation_calls)
        self.assertIn('"status": "fallback"', remaining)

    def test_parses_strict_visible_state_change_block_when_tag_is_missing(self):
        delta = adventure_engine.parse_visible_state_delta(
            "剧情继续推进。\n\n"
            "【状态变化】\n"
            "- 心情 +5\n"
            "- 金钱 → 120\n"
            "- 南条凛（26岁）·心情 → 100\n"
            "- 南条凛（26岁）·好感度 +5"
        )

        self.assertEqual(
            delta,
            {
                "attributes": {"心情": "+5"},
                "money": 120,
                "characters": {
                    "南条凛（26岁）": {
                        "attributes": {"心情": 100, "好感度": "+5"}
                    }
                },
            },
        )

    def test_ignores_non_numeric_visible_state_lines(self):
        delta = adventure_engine.parse_visible_state_delta(
            "【状态变化】\n- 获得：旧硬币\n- 新增状态：轻伤"
        )

        self.assertIsNone(delta)

    def test_stream_applies_visible_numeric_delta_without_repeating_notice(self):
        class VisibleOnlyClient:
            def stream_chat(self, _messages):
                yield {
                    "type": "delta",
                    "content": "剧情继续。\n\n【状态变化】\n- 心情 +5",
                }

        state = {
            "attributes": {"心情": 55}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
        }
        with patch.object(chat_routes.adventure_engine, "build_messages", return_value=[]), \
             patch.object(chat_routes, "create_client", return_value=VisibleOnlyClient()), \
             patch.object(chat_routes.conversation_repository, "create_message", return_value={"id": 17}), \
             patch.object(chat_routes.conversation_repository, "update_message"), \
             patch.object(chat_routes.conversation_repository, "get_message", return_value={"metadata": {"status": "done"}}), \
             patch.object(chat_routes.state_service, "get_state", return_value=state), \
             patch.object(chat_routes.state_service, "apply_state_delta") as apply_delta, \
             patch.object(chat_routes.state_service, "format_state_delta_for_player") as format_notice, \
             patch.object(
                 context_service,
                 "inspect_context",
                 return_value=context_service.ContextInspection(
                     messages=[], prompt_tokens=0, trigger_limit=100, needs_compression=False
                 ),
             ), patch.object(
                 context_service,
                 "prepare_context",
                 return_value=context_service.PreparedContext(
                     messages=[], prompt_tokens_before=0, prompt_tokens_after=0,
                     compressed=False, method=None, covered_until_sequence=-1,
                 ),
             ), \
             patch.object(chat_routes.snapshot_service, "autosave"):
            events = list(chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None))

        apply_delta.assert_called_once_with(
            self.access, {"attributes": {"心情": "+5"}}, source="test-model"
        )
        format_notice.assert_not_called()
        self.assertEqual("".join(events).count("【状态变化】"), 1)

    def test_generates_a_small_character_delta_when_model_omits_one(self):
        delta = adventure_engine.default_turn_state_delta(
            {
                "attributes": {"心情": 50},
                "characters": {
                    "塞西莉亚": {
                        "attributes": {"心情": 50, "好感度": 0}, "flags": []
                    }
                },
            },
            "我愿意和你一起去。",
        )

        self.assertEqual(
            delta,
            {"characters": {"塞西莉亚": {"attributes": {"好感度": "+1"}}}},
        )

    def test_generates_a_negative_delta_for_hostile_interaction(self):
        delta = adventure_engine.default_turn_state_delta(
            {
                "attributes": {"心情": 50},
                "characters": {
                    "塞西莉亚": {
                        "attributes": {"心情": 50, "好感度": 0}, "flags": []
                    }
                },
            },
            "我威胁你，立刻滚开。",
        )

        self.assertEqual(
            delta,
            {"characters": {"塞西莉亚": {"attributes": {"好感度": "-1"}}}},
        )

    def test_stream_appends_an_automatic_notice_when_model_omits_delta(self):
        class NarrativeOnlyClient:
            def stream_chat(self, _messages):
                yield {"type": "delta", "content": "她点了点头。"}

        state = {
            "attributes": {"心情": 55}, "items": [], "money": 0,
            "relations": {}, "quests": [], "flags": [],
            "characters": {"塞西莉亚": {"attributes": {"好感度": 0}, "flags": []}},
        }
        with patch.object(chat_routes.adventure_engine, "build_messages", return_value=[
            {"role": "user", "content": "我愿意和你一起去。"}
        ]), patch.object(chat_routes, "create_client", return_value=NarrativeOnlyClient()), \
             patch.object(chat_routes.conversation_repository, "create_message", return_value={"id": 18}), \
             patch.object(chat_routes.conversation_repository, "update_message"), \
             patch.object(chat_routes.conversation_repository, "get_message", return_value={"metadata": {"status": "done"}}), \
             patch.object(chat_routes.state_service, "get_state", return_value=state), \
             patch.object(chat_routes.state_service, "apply_state_delta") as apply_delta, \
             patch.object(
                 context_service,
                 "inspect_context",
                 return_value=context_service.ContextInspection(
                     messages=[{"role": "user", "content": "latest"}],
                     prompt_tokens=0, trigger_limit=100, needs_compression=False,
                 ),
             ), patch.object(
                 context_service,
                 "prepare_context",
                 return_value=context_service.PreparedContext(
                     messages=[{"role": "user", "content": "latest"}],
                     prompt_tokens_before=0, prompt_tokens_after=0,
                     compressed=False, method=None, covered_until_sequence=-1,
                 ),
             ), \
             patch.object(chat_routes.snapshot_service, "autosave"):
            events = list(chat_routes._stream_ai_reply(self.access, threading.Event(), {}, self.effective_config, None))

        apply_delta.assert_called_once_with(
            self.access,
            {"characters": {"塞西莉亚": {"attributes": {"好感度": "+1"}}}},
            source="test-model",
        )
        self.assertIn("【状态变化】", "".join(events))


class MemorySummaryTests(unittest.TestCase):
    def setUp(self):
        self.conversation = {
            "id": 7,
            "work_id": None,
            "card_id": None,
            "worldbook_id": None,
        }
        self.access = ConversationAccess(
            AuthContext(PublicUser(1, "test-user", "now"), 1),
            self.conversation,
        )
        self.state = {
            "attributes": {}, "items": [], "money": 0, "relations": {},
            "quests": [], "flags": [],
        }

    def test_build_messages_uses_saved_summary_without_writing(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(10)
        ]
        with patch.object(adventure_engine.repositories, "get_work", return_value=None), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
             patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
                 return_value={"summary": "saved summary", "covered_until_sequence": 1},
             ), \
             patch.object(adventure_engine.repositories, "save_memory_summary") as save_summary:
            messages = adventure_engine.build_messages(self.access, recent_count=8)

        system_prompt = messages[0]["content"]
        self.assertIn("saved summary", system_prompt)
        self.assertNotIn("message-0", messages[1]["content"])
        self.assertEqual(
            [message["content"] for message in messages[1:]],
            [f"message-{index}" for index in range(2, 10)],
        )
        save_summary.assert_not_called()

    def test_build_messages_allows_recent_count_above_default(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(12)
        ]
        with patch.object(adventure_engine.repositories, "get_work", return_value=None), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
             patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
                 return_value={"summary": "", "covered_until_sequence": -1},
             ), \
             patch.object(adventure_engine.repositories, "save_memory_summary") as save_summary:
            messages = adventure_engine.build_messages(self.access, recent_count=10)

        self.assertEqual(
            [message["content"] for message in messages[1:]],
            [f"message-{index}" for index in range(2, 12)],
        )
        save_summary.assert_not_called()

    def test_build_messages_excludes_messages_covered_by_saved_summary_boundary(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(12)
        ]
        with patch.object(adventure_engine.repositories, "get_work", return_value=None), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
             patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
                 return_value={"summary": "saved summary", "covered_until_sequence": 8},
             ):
            messages = adventure_engine.build_messages(self.access, recent_count=10)

        self.assertEqual(
            [message["content"] for message in messages[1:]],
            ["message-9", "message-10", "message-11"],
        )

    def test_build_messages_normalizes_explicit_nonpositive_recent_count_to_one(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(4)
        ]
        for recent_count in (0, -3):
            with self.subTest(recent_count=recent_count), \
                 patch.object(adventure_engine.repositories, "get_work", return_value=None), \
                 patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
                 patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
                 patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
                 patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
                 patch.object(
                     adventure_engine.repositories,
                     "get_memory_summary_record",
                     return_value={"summary": "", "covered_until_sequence": -1},
                 ):
                messages = adventure_engine.build_messages(
                    self.access, recent_count=recent_count
                )

            self.assertEqual(
                [message["content"] for message in messages[1:]],
                ["message-3"],
            )

    def test_build_messages_explicit_empty_summary_override_skips_persisted_read(self):
        history = [{"sequence": 0, "role": "user", "content": "message-0"}]
        with patch.object(adventure_engine.repositories, "get_work", return_value=None), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
             patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
             ) as get_summary:
            messages = adventure_engine.build_messages(self.access, summary_override="")

        self.assertNotIn("早期剧情记忆摘要：", messages[0]["content"])
        get_summary.assert_not_called()

    def test_build_messages_applies_explicit_boundary_with_empty_summary_override(self):
        history = [
            {
                "sequence": index,
                "role": "user" if index % 2 == 0 else "assistant",
                "content": f"message-{index}",
            }
            for index in range(12)
        ]
        with patch.object(adventure_engine.repositories, "get_work", return_value=None), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=None), \
             patch.object(adventure_engine.repositories, "get_state", return_value=self.state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
             ) as get_summary:
            messages = adventure_engine.build_messages(
                self.access,
                recent_count=10,
                summary_override="",
                summary_boundary_override=8,
            )

        self.assertEqual(
            [message["content"] for message in messages[1:]],
            ["message-9", "message-10", "message-11"],
        )
        get_summary.assert_not_called()

    def test_build_local_memory_summary_filters_archives_and_returns_boundary(self):
        messages = [
            {"sequence": 0, "role": "system", "content": "ignore system"},
            {"sequence": 1, "role": "user", "content": "u" * 130},
            {"sequence": 2, "role": "assistant", "content": "a2"},
            {"sequence": 3, "role": "tool", "content": "ignore tool"},
            {"sequence": 4, "role": "user", "content": "u4"},
            {"sequence": 5, "role": "assistant", "content": "a5"},
        ]

        summary, covered_until_sequence = adventure_engine.build_local_memory_summary(
            messages, keep_recent=2, max_chars=200
        )

        self.assertIn("玩家：" + "u" * 120 + "...", summary)
        self.assertIn("角色/旁白：a2", summary)
        self.assertNotIn("ignore system", summary)
        self.assertNotIn("ignore tool", summary)
        self.assertNotIn("u4", summary)
        self.assertNotIn("a5", summary)
        self.assertLessEqual(len(summary), 200)
        self.assertEqual(covered_until_sequence, 2)

    def test_build_local_memory_summary_archives_all_for_zero_and_negative_keep_recent(self):
        messages = [
            {"sequence": 1, "role": "user", "content": "first"},
            {"sequence": 2, "role": "assistant", "content": "second"},
            {"sequence": 3, "role": "user", "content": "third"},
        ]

        for keep_recent in (0, -2):
            with self.subTest(keep_recent=keep_recent):
                summary, covered_until_sequence = (
                    adventure_engine.build_local_memory_summary(
                        messages, keep_recent=keep_recent, max_chars=1000
                    )
                )

            self.assertIn("first", summary)
            self.assertIn("second", summary)
            self.assertIn("third", summary)
            self.assertEqual(covered_until_sequence, 3)

    def test_build_messages_preserves_prompt_sections(self):
        conversation = {
            **self.conversation,
            "work_id": 11,
            "card_id": 12,
            "worldbook_id": 13,
            "onboarding_status": "completed",
            "onboarding_answers": {"answer": "onboarding-marker"},
            "persona_corrections": [{"content": "persona-correction-marker"}],
            "memory_corrections": [{"content": "memory-correction-marker"}],
        }
        work = {"title": "work-marker", "description": "work-description-marker"}
        card = {"name": "card-marker", "persona": "persona-marker"}
        worldbook = {
            "description": "world-description-marker",
            "entries": [
                {
                    "id": 1,
                    "priority": 1,
                    "keywords": ["worldbook-match-marker"],
                    "title": "entry-title-marker",
                    "content": "entry-content-marker",
                    "enabled": True,
                }
            ],
        }
        state = {
            **self.state,
            "attributes": {"state-marker": 7},
        }
        history = [
            {
                "sequence": 0,
                "role": "user",
                "content": "worldbook-match-marker",
            },
            {"sequence": 1, "role": "assistant", "content": "reply-marker"},
        ]
        with patch.object(adventure_engine.repositories, "get_work", return_value=work), \
             patch.object(adventure_engine.repositories, "get_conversation_cards", return_value=[card]), \
             patch.object(adventure_engine.repositories, "get_worldbook", return_value=worldbook), \
             patch.object(adventure_engine.repositories, "get_state", return_value=state), \
             patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(
                 adventure_engine.repositories,
                 "get_memory_summary_record",
                 return_value={"summary": "", "covered_until_sequence": -1},
             ):
            messages = adventure_engine.build_messages(
                ConversationAccess(self.access.auth, conversation), recent_count=2
            )

        system_prompt = messages[0]["content"]
        for expected in (
            "entry-content-marker",
            "onboarding-marker",
            "persona-correction-marker",
            "memory-correction-marker",
            '"state-marker": 7',
            "persona-marker",
            "<state_delta>",
            "<options>",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, system_prompt)

    def test_short_history_clears_stale_summary(self):
        history = [{"sequence": 1, "role": "user", "content": "新分支的开场"}]
        with patch.object(adventure_engine.repositories, "get_messages", return_value=history), \
             patch.object(adventure_engine.repositories, "get_memory_summary", return_value="旧分支摘要"), \
             patch.object(adventure_engine.repositories, "save_memory_summary") as save_summary:
            summary = adventure_engine.update_memory_summary(self.access)

        self.assertEqual(summary, "")
        save_summary.assert_called_once_with(7, "", user_id=1)


if __name__ == "__main__":
    unittest.main()
