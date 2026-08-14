# -*- coding: utf-8 -*-
"""Regression coverage for one-active-stream-per-conversation."""

import asyncio
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.main import http_exception_handler
from backend.routers import chat_routes
from backend.schemas import ChatRequest
from backend.auth.types import AuthContext, ConversationAccess, PublicUser
from backend.services.user_ai_settings import EffectiveAIConfig


class ChatExclusivityTests(unittest.TestCase):
    """The chat route must reject a second request before it starts streaming."""

    def test_concurrent_chat_for_same_conversation_returns_conflict(self):
        """Removing the active-stream claim would let the second POST return 200."""
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))

        def short_stream(*_args, **_kwargs):
            yield "event: delta\ndata: {\"content\": \"first\"}\n\n"
            yield "event: done\ndata: {}\n\n"

        access = ConversationAccess(AuthContext(PublicUser(1, "chat-user", "2026-01-01T00:00:00+00:00"), 1), {"id": 7, "owner_user_id": 1})
        config = EffectiveAIConfig("https://api.deepseek.com", "test-model", "", {}, 60, False)
        with patch.object(chat_routes, "_get_conversation_or_404", side_effect=lambda conversation_id, _auth: ConversationAccess(
            access.auth, {"id": conversation_id, "owner_user_id": 1}
        )), patch.object(
            chat_routes, "_resolve_generation_config", return_value=(config, None)
        ), patch.object(
            chat_routes, "_stream_chat", side_effect=short_stream
        ):
            first_response = chat_routes.chat(7, ChatRequest(content="first"), request)
            with self.assertRaises(HTTPException) as captured:
                chat_routes.chat(7, ChatRequest(content="second"), request)
            other_conversation_response = chat_routes.chat(8, ChatRequest(content="other"), request)
            asyncio.run(_consume_body(first_response))
            resumed_response = chat_routes.chat(7, ChatRequest(content="resumed"), request)

        error_response = asyncio.run(http_exception_handler(request, captured.exception))

        self.assertEqual(error_response.status_code, 409)
        self.assertEqual(
            json.loads(error_response.body),
            {"error": {"code": "conflict", "message": "该会话正在生成回复"}},
        )
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(other_conversation_response.status_code, 200)
        self.assertEqual(resumed_response.status_code, 200)

    def test_error_or_cancelled_stream_releases_conversation(self):
        """A failed or cancelled stream must not leave its conversation locked."""
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))

        def error_stream(*_args, **_kwargs):
            raise RuntimeError("stream failed")
            yield  # pragma: no cover - keeps this a generator function

        access = ConversationAccess(AuthContext(PublicUser(1, "chat-user", "2026-01-01T00:00:00+00:00"), 1), {"id": 7, "owner_user_id": 1})
        config = EffectiveAIConfig("https://api.deepseek.com", "test-model", "", {}, 60, False)
        with patch.object(chat_routes, "_get_conversation_or_404", return_value=access), patch.object(
            chat_routes, "_resolve_generation_config", return_value=(config, None)
        ), patch.object(
            chat_routes, "_stream_chat", side_effect=error_stream
        ):
            failed_response = chat_routes.chat(7, ChatRequest(content="fail"), request)
            with self.assertRaisesRegex(RuntimeError, "stream failed"):
                asyncio.run(_consume_body(failed_response))
            self.assertEqual(
                chat_routes.chat(7, ChatRequest(content="retry"), request).status_code,
                200,
            )

        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))

        def endless_stream(*_args, **_kwargs):
            yield "event: delta\ndata: {\"content\": \"first\"}\n\n"
            yield "event: delta\ndata: {\"content\": \"second\"}\n\n"

        with patch.object(chat_routes, "_get_conversation_or_404", return_value=access), patch.object(
            chat_routes, "_resolve_generation_config", return_value=(config, None)
        ), patch.object(
            chat_routes, "_stream_chat", side_effect=endless_stream
        ):
            cancelled_response = chat_routes.chat(7, ChatRequest(content="cancel"), request)
            asyncio.run(_read_once_then_cancel(cancelled_response))
            self.assertEqual(
                chat_routes.chat(7, ChatRequest(content="after cancel"), request).status_code,
                200,
            )


async def _consume_body(response):
    """Consume a StreamingResponse as Starlette does after sending its headers."""
    async for _chunk in response.body_iterator:
        pass


async def _read_once_then_cancel(response):
    """Model a client that disconnects immediately after the first SSE frame."""
    await response.body_iterator.__anext__()
    await response.body_iterator.aclose()


if __name__ == "__main__":
    unittest.main()
