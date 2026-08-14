# -*- coding: utf-8 -*-
"""Tests for forwarding a selected reply length through the chat stream."""

import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.auth.types import AuthContext, ConversationAccess, PublicUser
from backend.routers import chat_routes
from backend.services.user_ai_settings import EffectiveAIConfig


class RecordingClient:
    def __init__(self):
        self.calls = []

    def stream_chat(self, messages, max_tokens=None):
        self.calls.append({"messages": messages, "max_tokens": max_tokens})
        yield {"type": "delta", "content": "继续"}
        yield {"type": "finish", "finish_reason": "stop"}


class ChatReplyLengthTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "deepseek": {"api_key": "test-key", "model": "test-model"},
            "generation": {"max_tokens": 777},
        }
        self.client = RecordingClient()
        self.stop_event = threading.Event()
        self.access = ConversationAccess(
            AuthContext(PublicUser(1, "chat-user", "2026-01-01T00:00:00+00:00"), 1),
            {"id": 7, "owner_user_id": 1},
        )
        self.effective_config = EffectiveAIConfig(
            base_url="https://api.deepseek.com",
            model="test-model",
            api_key="test-key",
            generation={"max_tokens": 777},
            timeout_seconds=60,
            ai_enabled=True,
        )
        self.inspection = SimpleNamespace(
            needs_compression=False,
            messages=[{"role": "system", "content": "base rules"}],
            prompt_tokens=5,
            trigger_limit=1000,
        )
        self.prepared = SimpleNamespace(
            messages=[
                {"role": "system", "content": "base rules"},
                {"role": "user", "content": "look around"},
            ],
            prompt_tokens_after=5,
            compressed=False,
            method=None,
        )
        self.patches = [
            patch.object(
                chat_routes.context_service,
                "inspect_context",
                return_value=self.inspection,
            ),
            patch.object(
                chat_routes.context_service,
                "prepare_context",
                return_value=self.prepared,
            ),
            patch.object(
                chat_routes.conversation_repository,
                "create_message",
                return_value={"id": 12},
            ),
            patch.object(
                chat_routes.conversation_repository,
                "update_message",
            ),
            patch.object(
                chat_routes.conversation_repository,
                "get_message",
                return_value={"metadata": {"status": "done"}},
            ),
            patch.object(chat_routes, "create_client", return_value=self.client),
            patch.object(chat_routes.snapshot_service, "autosave"),
            patch.object(chat_routes, "_state_event", return_value={}),
            patch.object(
                chat_routes,
                "_recover_missing_options",
                return_value=[],
            ),
            patch.object(
                chat_routes.adventure_engine,
                "parse_visible_options",
                return_value=[],
            ),
            patch.object(
                chat_routes.adventure_engine,
                "default_turn_options",
                return_value=[],
            ),
            patch.object(
                chat_routes.adventure_engine,
                "parse_visible_state_delta",
                return_value=None,
            ),
            patch.object(
                chat_routes.adventure_engine,
                "default_turn_state_delta",
                return_value=None,
            ),
            patch.object(
                chat_routes.state_service,
                "get_state",
                return_value={},
            ),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()

    def test_selected_reply_length_is_forwarded_and_added_to_prompt(self):
        list(
            chat_routes._stream_ai_reply(
                self.access,
                self.stop_event,
                {"reply_length": "long"},
                self.effective_config,
            )
        )

        self.assertEqual(self.client.calls[0]["max_tokens"], 8192)
        self.assertIn("2000", self.client.calls[0]["messages"][0]["content"])

    def test_legacy_chat_metadata_keeps_default_client_budget(self):
        list(chat_routes._stream_ai_reply(self.access, self.stop_event, {}, self.effective_config))

        self.assertIsNone(self.client.calls[0]["max_tokens"])

    def test_short_detailed_reply_gets_one_continuation_request(self):
        class ShortThenLongClient:
            def __init__(self):
                self.calls = []

            def stream_chat(self, messages, max_tokens=None):
                self.calls.append({"messages": messages, "max_tokens": max_tokens})
                if len(self.calls) == 1:
                    yield {"type": "delta", "content": "短回复"}
                else:
                    yield {"type": "delta", "content": "补" * 1000}
                yield {"type": "finish", "finish_reason": "stop"}

        client = ShortThenLongClient()
        with patch.object(chat_routes, "create_client", return_value=client):
            events = list(
                chat_routes._stream_ai_reply(
                    self.access,
                    self.stop_event,
                    {"reply_length": "detailed"},
                    self.effective_config,
                )
            )

        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[1]["messages"][-2]["role"], "assistant")
        self.assertEqual(client.calls[1]["messages"][-2]["content"], "短回复")
        continuation_prompt = client.calls[1]["messages"][-1]["content"]
        self.assertIn("从上一句自然接续", continuation_prompt)
        self.assertIn("不要引入新的判定、状态变化或选项", continuation_prompt)
        deltas = [
            json.loads(event.split("data: ", 1)[1])["content"]
            for event in events
            if event.startswith("event: delta")
        ]
        self.assertGreaterEqual(sum(len(delta) for delta in deltas), 1000)

    def test_short_reply_stops_after_two_continuation_attempts(self):
        class AlwaysShortClient:
            def __init__(self):
                self.calls = []

            def stream_chat(self, messages, max_tokens=None):
                self.calls.append({"messages": messages, "max_tokens": max_tokens})
                yield {"type": "delta", "content": "短"}
                yield {"type": "finish", "finish_reason": "stop"}

        client = AlwaysShortClient()
        with patch.object(chat_routes, "create_client", return_value=client):
            list(
                chat_routes._stream_ai_reply(
                    self.access,
                    self.stop_event,
                    {"reply_length": "detailed"},
                    self.effective_config,
                )
            )

        self.assertEqual(len(client.calls), 3)
        self.assertTrue(all(call["max_tokens"] == 4096 for call in client.calls))

    def test_non_continuable_finish_reason_does_not_retry(self):
        class FilteredClient:
            def __init__(self):
                self.calls = 0

            def stream_chat(self, messages, max_tokens=None):
                self.calls += 1
                yield {"type": "delta", "content": "短回复"}
                yield {"type": "finish", "finish_reason": "content_filter"}

        client = FilteredClient()
        with patch.object(chat_routes, "create_client", return_value=client):
            list(
                chat_routes._stream_ai_reply(
                    self.access,
                    self.stop_event,
                    {"reply_length": "detailed"},
                    self.effective_config,
                )
            )

        self.assertEqual(client.calls, 1)

    def test_continuation_failure_preserves_completed_reply(self):
        class FailingContinuationClient:
            def __init__(self):
                self.calls = 0

            def stream_chat(self, messages, max_tokens=None):
                self.calls += 1
                if self.calls == 1:
                    yield {"type": "delta", "content": "可用的首段"}
                    yield {"type": "finish", "finish_reason": "stop"}
                    return
                raise chat_routes.DeepSeekError("continuation failed")

        client = FailingContinuationClient()
        with patch.object(
            chat_routes, "create_client", return_value=client
        ), patch.object(
            chat_routes.conversation_repository, "update_message"
        ) as update_message:
            events = list(
                chat_routes._stream_ai_reply(
                    self.access,
                    self.stop_event,
                    {"reply_length": "detailed"},
                    self.effective_config,
                )
            )

        metadata = update_message.call_args.kwargs["metadata"]
        self.assertEqual(client.calls, 2)
        self.assertEqual(metadata["status"], "done")
        self.assertTrue(metadata["continuation_failed"])
        self.assertIn("event: done", "".join(events))
        self.assertNotIn("event: error", "".join(events))

    def test_user_stop_prevents_continuation(self):
        stop_event = threading.Event()

        class StoppedClient:
            def __init__(self):
                self.calls = 0

            def stream_chat(self, messages, max_tokens=None):
                self.calls += 1
                yield {"type": "delta", "content": "已经生成的内容"}
                stop_event.set()
                yield {"type": "finish", "finish_reason": "stop"}

        client = StoppedClient()
        with patch.object(chat_routes, "create_client", return_value=client):
            events = list(
                chat_routes._stream_ai_reply(
                    self.access,
                    stop_event,
                    {"reply_length": "detailed"},
                    self.effective_config,
                )
            )

        self.assertEqual(client.calls, 1)
        self.assertIn("（回复已停止）", "".join(events))

    def test_stream_chat_passes_client_metadata_to_ai_reply(self):
        metadata = {"reply_length": "short"}
        with patch.object(
            chat_routes.conversation_repository,
            "create_message",
            return_value={"id": 20},
        ), patch.object(
            chat_routes.commands,
            "parse_command",
            return_value=None,
        ), patch.object(
            chat_routes,
            "_stream_ai_reply",
            return_value=iter(()),
        ) as ai_reply:
            list(
                chat_routes._stream_chat(
                    self.access,
                    "look around",
                    metadata,
                    self.stop_event,
                    self.effective_config,
                    None,
                )
            )

        ai_reply.assert_called_once_with(
            self.access, self.stop_event, metadata, self.effective_config, None
        )


if __name__ == "__main__":
    unittest.main()
