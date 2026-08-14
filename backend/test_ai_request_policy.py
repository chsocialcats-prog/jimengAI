# -*- coding: utf-8 -*-
"""Outbound model endpoint policy contracts."""

import socket
import unittest
import urllib.error
from types import SimpleNamespace
from unittest.mock import patch

from backend.ai import deepseek_client
from backend.ai.request_policy import AIRequestPolicy, AIRequestPolicyError
from backend.routers import settings_routes
from backend.services.user_ai_settings import EffectiveAIConfig


class AIRequestPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = AIRequestPolicy(
            allowed_origins=("https://api.deepseek.com", "http://models.lan:11434"),
            https_only=False,
            resolver=lambda host, port: ["8.8.8.8"] if host == "api.deepseek.com" else ["192.168.1.15"],
            allowed_private_networks=("192.168.1.0/24",),
        )

    def test_validates_exact_origin_and_normalizes_the_base_url(self):
        target = self.policy.validate_base_url("HTTPS://API.DEEPSEEK.COM:443/v1/")
        self.assertEqual(target.base_url, "https://api.deepseek.com/v1")
        self.assertEqual(target.origin, "https://api.deepseek.com")

    def test_rejects_credentials_query_fragment_and_unapproved_origin(self):
        for url in (
            "https://user:pass@api.deepseek.com/v1",
            "https://api.deepseek.com/v1?via=proxy",
            "https://api.deepseek.com/v1#fragment",
            "https://unapproved.example/v1",
        ):
            with self.subTest(url=url):
                with self.assertRaises(AIRequestPolicyError) as captured:
                    self.policy.validate_base_url(url)
                self.assertEqual(captured.exception.code, "ai_origin_not_allowed")

    def test_blocks_loopback_dns_result_even_for_an_allowed_origin(self):
        policy = AIRequestPolicy(
            allowed_origins=("https://api.deepseek.com",),
            resolver=lambda host, port: ["127.0.0.1"],
        )
        with self.assertRaises(AIRequestPolicyError):
            policy.validate_base_url("https://api.deepseek.com/v1")

    def test_blocks_redirects_and_never_allows_cross_origin_authorization(self):
        target = self.policy.validate_base_url("https://api.deepseek.com/v1")
        self.assertFalse(self.policy.allow_redirect(target, "https://api.deepseek.com/next"))
        self.assertFalse(self.policy.allow_redirect(target, "https://other.example/next"))

    def test_model_discovery_disables_redirects_when_policy_is_present(self):
        config = EffectiveAIConfig(
            "https://api.deepseek.com/v1", "model", "test-token", {}, 5, True
        )
        with patch.object(deepseek_client.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = urllib.error.HTTPError(
                "https://api.deepseek.com/v1/models", 302, "Found", {}, None
            )
            with self.assertRaises(deepseek_client.DeepSeekError):
                deepseek_client.discover_models(config, self.policy)
        opener.assert_called()

    def test_client_rechecks_dns_inside_urllib_connection_before_sending_credentials(self):
        resolutions = iter((["8.8.8.8"], ["127.0.0.1"]))
        policy = AIRequestPolicy(
            allowed_origins=("http://api.deepseek.com",),
            resolver=lambda host, port: next(resolutions),
        )
        config = EffectiveAIConfig(
            "http://api.deepseek.com/v1", "model", "test-token-rebinding", {}, 5, True
        )

        with patch("socket.create_connection") as connect:
            with self.assertRaises(AIRequestPolicyError) as captured:
                deepseek_client.discover_models(config, policy)

        self.assertNotIn("test-token-rebinding", str(captured.exception))
        connect.assert_not_called()

    def test_route_policy_applies_runtime_origins_and_explicit_private_lan_allowlist(self):
        runtime = SimpleNamespace(
            ai_allowed_origins=("http://models.lan:11434",),
            ai_https_only=False,
        )
        with patch.dict(
            "os.environ",
            {
                "NEKO_AI_ALLOWED_PRIVATE_NETWORKS": "192.168.1.0/24",
                "NEKO_AI_ALLOWED_PRIVATE_ORIGINS": "http://models.lan:11434",
            },
            clear=False,
        ):
            policy = settings_routes._request_policy(
                runtime,
                resolver=lambda host, port: ["192.168.1.15"],
            )

        approved = policy.validate_base_url("http://models.lan:11434/v1")
        self.assertEqual(approved.base_url, "http://models.lan:11434/v1")
