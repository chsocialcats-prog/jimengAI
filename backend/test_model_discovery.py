# -*- coding: utf-8 -*-
"""Offline contract tests for OpenAI-compatible model discovery."""

import io
import json
import unittest
import urllib.error
from unittest.mock import patch

from fastapi import HTTPException

from backend.ai import deepseek_client
from backend.routers import settings_routes
from backend.schemas import ModelDiscoveryPreview


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
    def test_discovery_explains_invalid_api_key(self):
        config = {
            "deepseek": {
                "base_url": "https://models.example/v1",
                "api_key": "invalid-key",
                "timeout_seconds": 12,
            }
        }
        response = io.BytesIO(b'{"error":{"message":"invalid key"}}')
        http_error = urllib.error.HTTPError(
            "https://models.example/v1/models", 401, "Unauthorized", {}, response
        )

        with patch.object(
            deepseek_client.urllib.request, "urlopen", side_effect=http_error
        ):
            with self.assertRaisesRegex(
                deepseek_client.DeepSeekError,
                "API Key 无效或没有读取模型列表的权限（HTTP 401）",
            ):
                deepseek_client.discover_models(config)
        http_error.close()

    def test_discovers_filters_and_sorts_models(self):
        config = {
            "deepseek": {
                "base_url": "https://models.example/v1/",
                "api_key": "secret-key",
                "timeout_seconds": 12,
            }
        }
        response = _Response(
            {
                "data": [
                    {"id": "zeta", "owned_by": "vendor"},
                    {"id": "  ", "owned_by": "ignored"},
                    {"id": "alpha"},
                    {"id": 42, "owned_by": "ignored"},
                ]
            }
        )

        with patch.object(deepseek_client.urllib.request, "urlopen", return_value=response) as urlopen:
            result = deepseek_client.discover_models(config)

        self.assertEqual(
            result,
            {
                "items": [
                    {"id": "alpha", "owned_by": None},
                    {"id": "zeta", "owned_by": "vendor"},
                ]
            },
        )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://models.example/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret-key")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 12.0)

    def test_models_endpoint_uses_saved_config(self):
        config = {
            "deepseek": {
                "base_url": "https://models.example/v1",
                "api_key": "saved-key",
            }
        }
        response = _Response({"data": [{"id": "model-b"}, {"id": "model-a"}]})

        with (
            patch.object(settings_routes, "load_config", return_value=config),
            patch.object(deepseek_client.urllib.request, "urlopen", return_value=response),
        ):
            result = settings_routes.read_models()

        self.assertEqual(
            result,
            {
                "items": [
                    {"id": "model-a", "owned_by": None},
                    {"id": "model-b", "owned_by": None},
                ]
            },
        )

    def test_models_endpoint_maps_missing_key_to_standard_api_error(self):
        with patch.object(settings_routes, "load_config", return_value={"deepseek": {"api_key": ""}}), patch.object(
            deepseek_client.urllib.request, "urlopen"
        ) as urlopen:
            with self.assertRaises(HTTPException) as captured:
                settings_routes.read_models()

        self.assertEqual(captured.exception.status_code, 502)
        self.assertEqual(
            captured.exception.detail,
            {"code": "api_error", "message": "DeepSeek API Key 未配置"},
        )
        urlopen.assert_not_called()

    def test_preview_models_uses_unsaved_form_credentials(self):
        saved_config = {
            "deepseek": {
                "base_url": "https://saved.example/v1",
                "api_key": "saved-key",
                "timeout_seconds": 60,
            }
        }
        response = _Response({"data": [{"id": "temporary-model"}]})
        with (
            patch.object(settings_routes, "load_config", return_value=saved_config),
            patch.object(deepseek_client.urllib.request, "urlopen", return_value=response) as urlopen,
        ):
            result = settings_routes.preview_models(
                ModelDiscoveryPreview(
                    base_url="https://typed.example/v1",
                    api_key="typed-key",
                    timeout_seconds=12,
                )
            )

        self.assertEqual(result["items"], [{"id": "temporary-model", "owned_by": None}])
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://typed.example/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer typed-key")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 12.0)

    def test_preview_models_returns_a_safe_actionable_error(self):
        with (
            patch.object(settings_routes, "load_config", return_value={"deepseek": {}}),
            patch.object(
                settings_routes,
                "discover_models",
                side_effect=deepseek_client.DeepSeekError(
                    "API Key 无效或没有读取模型列表的权限（HTTP 401）"
                ),
            ),
        ):
            with self.assertRaises(HTTPException) as captured:
                settings_routes.preview_models(
                    ModelDiscoveryPreview(
                        base_url="https://api.deepseek.com",
                        api_key="invalid-key",
                    )
                )

        self.assertEqual(captured.exception.status_code, 502)
        self.assertEqual(
            captured.exception.detail,
            {
                "code": "api_error",
                "message": "API Key 无效或没有读取模型列表的权限（HTTP 401）",
            },
        )


if __name__ == "__main__":
    unittest.main()
