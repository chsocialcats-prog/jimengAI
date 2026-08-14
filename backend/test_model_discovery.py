# -*- coding: utf-8 -*-
"""Offline contracts for explicit OpenAI-compatible model discovery."""

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from backend.ai import deepseek_client
from backend.ai.request_policy import AIRequestPolicy, AIRequestPolicyError
from backend.services.user_ai_settings import EffectiveAIConfig


class _Response:
    def __init__(self, payload):
        self._body = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def read(self):
        return self._body.read()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class ModelDiscoveryTests(unittest.TestCase):
    def test_discovery_uses_only_the_explicit_effective_config(self):
        config = EffectiveAIConfig(
            "https://models.example/v1/", "model", "test-token", {}, 12, True
        )
        response = _Response({"data": [{"id": "zeta", "owned_by": "vendor"}, {"id": "alpha"}]})

        with patch.object(deepseek_client.urllib.request, "urlopen", return_value=response) as urlopen:
            result = deepseek_client.discover_models(config)

        self.assertEqual(result, {"items": [{"id": "alpha", "owned_by": None}, {"id": "zeta", "owned_by": "vendor"}]})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://models.example/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")

    def test_discovery_never_calls_network_without_an_explicit_key(self):
        config = EffectiveAIConfig("https://models.example/v1", "model", "", {}, 12, False)
        with patch.object(deepseek_client.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(deepseek_client.DeepSeekError):
                deepseek_client.discover_models(config)
        urlopen.assert_not_called()

    def test_discovery_rejects_a_url_before_network_when_request_policy_denies_it(self):
        config = EffectiveAIConfig("https://localhost/v1", "model", "test-token", {}, 12, True)
        policy = AIRequestPolicy(allowed_origins=("https://localhost",), resolver=lambda host, port: ["127.0.0.1"])
        with patch.object(deepseek_client.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(AIRequestPolicyError):
                deepseek_client.discover_models(config, policy)
        urlopen.assert_not_called()

    def test_upstream_http_error_is_reported_without_the_bearer_key(self):
        config = EffectiveAIConfig("https://models.example/v1", "model", "test-token-redacted", {}, 12, True)
        response = io.BytesIO(b'{"error":{"message":"invalid key"}}')
        error = urllib.error.HTTPError("https://models.example/v1/models", 401, "Unauthorized", {}, response)
        with patch.object(deepseek_client.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(deepseek_client.DeepSeekError) as captured:
                deepseek_client.discover_models(config)
        self.assertNotIn("test-token-redacted", str(captured.exception))
