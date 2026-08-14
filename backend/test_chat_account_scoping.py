# -*- coding: utf-8 -*-
"""Account-scoped chat, AI snapshot, and context contracts."""

import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.auth.types import AuthContext, ConversationAccess, PublicUser
from backend.routers import chat_routes
from backend.schemas import ChatRequest
from backend.services import context_service
from backend.services.user_ai_settings import EffectiveAIConfig


def _auth(user_id=7):
    return AuthContext(
        user=PublicUser(user_id, f"user-{user_id}", "2026-01-01T00:00:00+00:00"),
        session_id=user_id,
    )


def _access(user_id=7, conversation_id=9):
    auth = _auth(user_id)
    return ConversationAccess(
        auth=auth,
        conversation={
            "id": conversation_id,
            "onboarding_status": "completed",
        },
    )


def _effective(*, unreadable=False):
    return EffectiveAIConfig(
        base_url="https://api.example.test",
        model="model-a",
        api_key="" if unreadable else "secret",
        generation={
            "max_tokens": 32,
            "context_window_tokens": 32768,
            "compression_trigger_ratio": 0.75,
            "compression_keep_recent_messages": 2,
            "compression_summary_max_tokens": 256,
        },
        timeout_seconds=30,
        ai_enabled=not unreadable,
        api_key_unreadable=unreadable,
    )


class ChatAccountScopingTests(unittest.TestCase):
    def test_foreign_chat_is_rejected_before_claim_or_stream_side_effects(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        auth = _auth(2)

        with patch.object(
            chat_routes,
            "_get_conversation_or_404",
            side_effect=HTTPException(
                status_code=404,
                detail={"code": "not_found", "message": "不存在"},
            ),
        ), patch.object(chat_routes, "_claim_chat_activity") as claim, patch.object(
            chat_routes, "_stream_chat"
        ) as stream:
            with self.assertRaises(HTTPException) as captured:
                chat_routes.chat(
                    9,
                    ChatRequest(content="越权消息"),
                    request,
                    auth=auth,
                )

        self.assertEqual(captured.exception.status_code, 404)
        claim.assert_not_called()
        stream.assert_not_called()

    def test_foreign_stop_is_rejected_before_stop_event_creation(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        auth = _auth(2)
        with patch.object(
            chat_routes,
            "_get_conversation_or_404",
            side_effect=HTTPException(
                status_code=404,
                detail={"code": "not_found", "message": "不存在"},
            ),
        ), patch.object(chat_routes, "_get_stop_event") as get_event:
            with self.assertRaises(HTTPException) as captured:
                chat_routes.stop_chat(9, request, auth=auth)

        self.assertEqual(captured.exception.status_code, 404)
        get_event.assert_not_called()

    def test_chat_freezes_one_owner_ai_config_and_policy_before_streaming(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        access = _access(7, 9)
        effective = _effective()
        policy = SimpleNamespace(validate_base_url=lambda value: value)

        class Service:
            request_policy = policy

            def __init__(self):
                self.calls = []

            def resolve_for_user(self, user_id):
                self.calls.append(user_id)
                return effective

        service = Service()
        request.app.state.user_ai_settings_service = service
        stop_event = threading.Event()

        with patch.object(chat_routes, "_get_conversation_or_404", return_value=access), patch.object(
            chat_routes, "_claim_chat_activity", return_value=True
        ), patch.object(chat_routes, "_get_stop_event", return_value=stop_event), patch.object(
            chat_routes, "_stream_with_activity_release", return_value=iter(())
        ) as stream:
            response = chat_routes.chat(
                9,
                ChatRequest(content="继续"),
                request,
                auth=access.auth,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(service.calls, [7])
        self.assertIs(stream.call_args.args[1], access)
        self.assertIs(stream.call_args.args[5], effective)
        self.assertIs(stream.call_args.args[6], policy)

    def test_unreadable_api_key_fails_before_claiming_or_streaming(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))
        access = _access()

        class Service:
            request_policy = object()

            def resolve_for_user(self, _user_id):
                return _effective(unreadable=True)

        request.app.state.user_ai_settings_service = Service()
        with patch.object(chat_routes, "_get_conversation_or_404", return_value=access), patch.object(
            chat_routes, "_claim_chat_activity"
        ) as claim:
            with self.assertRaises(HTTPException) as captured:
                chat_routes.chat(
                    9,
                    ChatRequest(content="继续"),
                    request,
                    auth=access.auth,
                )

        self.assertEqual(captured.exception.status_code, 503)
        self.assertEqual(captured.exception.detail["code"], "api_key_unreadable")
        claim.assert_not_called()


class ContextAccountScopingTests(unittest.TestCase):
    def test_context_uses_conversation_access_and_effective_config(self):
        access = _access()
        config = _effective()
        with patch.object(
            context_service.adventure_engine,
            "build_messages",
            return_value=[{"role": "system", "content": "prompt"}],
        ) as build_messages, patch.object(
            context_service, "estimate_messages_tokens", return_value=10
        ):
            inspection = context_service.inspect_context(access, config)

        self.assertFalse(inspection.needs_compression)
        build_messages.assert_called_once_with(access, recent_count=2)

    def test_context_compression_passes_effective_config_and_policy_to_client(self):
        access = _access()
        config = _effective()
        policy = object()
        inspection = context_service.ContextInspection(
            messages=[{"role": "system", "content": "large"}],
            prompt_tokens=100,
            trigger_limit=60,
            needs_compression=True,
        )
        fake_client = SimpleNamespace(
            stream_chat=lambda _messages, max_tokens=None: iter(
                [{"type": "delta", "content": "summary"}]
            )
        )
        with patch.object(
            context_service.repositories,
            "get_memory_summary_record",
            return_value={"summary": "", "covered_until_sequence": -1},
        ), patch.object(
            context_service.repositories,
            "get_messages",
            return_value=[
                {"sequence": 0, "role": "user", "content": "old"},
                {"sequence": 1, "role": "user", "content": "recent"},
                {"sequence": 2, "role": "assistant", "content": "latest"},
            ],
        ), patch.object(
            context_service.repositories, "save_memory_summary"
        ), patch.object(
            context_service, "create_client", return_value=fake_client
        ) as create_client, patch.object(
            context_service.adventure_engine,
            "build_messages",
            return_value=[{"role": "system", "content": "compressed"}],
        ), patch.object(
            context_service, "estimate_messages_tokens", return_value=20
        ):
            context_service.prepare_context(
                access,
                config,
                request_policy=policy,
                inspection=inspection,
            )

        create_client.assert_called_once_with(config, policy)


if __name__ == "__main__":
    unittest.main()
