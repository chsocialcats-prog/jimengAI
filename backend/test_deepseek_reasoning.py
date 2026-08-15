# -*- coding: utf-8 -*-
"""Contract tests for DeepSeek reasoning-effort request payloads."""

import json
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config as config_module
from backend.ai import deepseek_client


class _StreamingResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def __iter__(self):
        return iter([b"data: [DONE]\\n"])


def _client_config(reasoning_effort):
    return {
        "deepseek": {
            "base_url": "https://api.example/v1",
            "model": "deepseek-reasoner",
            "api_key": "test-key",
            "timeout_seconds": 10,
        },
        "generation": {
            "temperature": 0.35,
            "max_tokens": 512,
            "reasoning_effort": reasoning_effort,
        },
    }


def _captured_payload(reasoning_effort):
    captured = []

    def capture_request(request, timeout):
        captured.append(json.loads(request.data.decode("utf-8")))
        return _StreamingResponse()

    client = deepseek_client.DeepSeekClient(_client_config(reasoning_effort))
    with patch.object(deepseek_client.urllib.request, "urlopen", side_effect=capture_request):
        list(client._stream_once([{"role": "user", "content": "hello"}], False))

    return captured[0]


class DeepSeekReasoningPayloadTests(unittest.TestCase):
    def test_stream_chat_without_override_uses_configured_max_tokens(self):
        captured = []

        def capture_request(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return _StreamingResponse()

        client = deepseek_client.DeepSeekClient(_client_config("off"))
        with patch.object(
            deepseek_client.urllib.request,
            "urlopen",
            side_effect=capture_request,
        ):
            list(client.stream_chat([{"role": "user", "content": "normal"}]))

        self.assertEqual(captured[0]["max_tokens"], 512)

    def test_per_request_max_tokens_override_is_forwarded(self):
        captured = []

        def capture_request(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return _StreamingResponse()

        client = deepseek_client.DeepSeekClient(_client_config("off"))
        with patch.object(
            deepseek_client.urllib.request,
            "urlopen",
            side_effect=capture_request,
        ):
            list(client._stream_once(
                [{"role": "user", "content": "summary"}],
                False,
                max_tokens=1200,
            ))

        self.assertEqual(captured[0]["max_tokens"], 1200)

    def test_stream_chat_retry_preserves_override_max_tokens(self):
        captured = []

        def capture_request(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            if len(captured) == 1:
                raise deepseek_client.urllib.error.HTTPError(
                    request.full_url,
                    400,
                    "bad request",
                    hdrs=None,
                    fp=io.BytesIO(b'{"error":{"message":"usage unsupported"}}'),
                )
            return _StreamingResponse()

        client = deepseek_client.DeepSeekClient(_client_config("off"))
        with patch.object(
            deepseek_client.urllib.request,
            "urlopen",
            side_effect=capture_request,
        ):
            list(client.stream_chat(
                [{"role": "user", "content": "summary"}],
                max_tokens=1200,
            ))

        self.assertEqual([payload["max_tokens"] for payload in captured], [1200, 1200])

    def test_high_reasoning_enables_thinking_and_omits_temperature(self):
        payload = _captured_payload("high")

        self.assertEqual(payload["thinking"], {"type": "enabled"})
        self.assertEqual(payload["reasoning_effort"], "high")
        self.assertNotIn("temperature", payload)

    def test_max_reasoning_enables_thinking_and_omits_temperature(self):
        payload = _captured_payload("max")

        self.assertEqual(payload["thinking"], {"type": "enabled"})
        self.assertEqual(payload["reasoning_effort"], "max")
        self.assertNotIn("temperature", payload)

    def test_off_reasoning_retains_temperature_without_thinking_fields(self):
        payload = _captured_payload("off")

        self.assertEqual(payload["temperature"], 0.35)
        self.assertNotIn("thinking", payload)
        self.assertNotIn("reasoning_effort", payload)

    def test_invalid_reasoning_retains_temperature_without_thinking_fields(self):
        payload = _captured_payload("unexpected")

        self.assertEqual(payload["temperature"], 0.35)
        self.assertNotIn("thinking", payload)
        self.assertNotIn("reasoning_effort", payload)

    def test_openai_compatible_provider_uses_portable_generation_fields(self):
        config = _client_config("high")
        config["deepseek"]["provider_id"] = "openai"
        captured = []

        def capture_request(request, timeout):
            captured.append(json.loads(request.data.decode("utf-8")))
            return _StreamingResponse()

        client = deepseek_client.DeepSeekClient(config)
        with patch.object(deepseek_client.urllib.request, "urlopen", side_effect=capture_request):
            list(client._stream_once([{"role": "user", "content": "hello"}], False))

        self.assertEqual(captured[0]["temperature"], 0.35)
        self.assertNotIn("thinking", captured[0])
        self.assertNotIn("reasoning_effort", captured[0])

    def test_config_merge_public_config_and_update_preserve_reasoning_effort(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "deepseek": {"api_key": "private-key"},
                        "generation": {"temperature": 0.2},
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(config_module, "CONFIG_PATH", path):
                loaded = config_module.load_config()
                public = config_module.public_config(loaded)
                updated = config_module.update_config({"generation": {"max_tokens": 99}})

            saved = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(loaded["generation"]["reasoning_effort"], "high")
        self.assertEqual(public["generation"]["reasoning_effort"], "high")
        self.assertNotIn("api_key", public["deepseek"])
        self.assertEqual(updated["generation"]["reasoning_effort"], "high")
        self.assertEqual(saved["generation"]["reasoning_effort"], "high")


if __name__ == "__main__":
    unittest.main()
