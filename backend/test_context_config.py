# -*- coding: utf-8 -*-
"""Tests for context-compression config defaults, normalization, and schema bounds."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from backend import config as config_module
from backend.schemas import ConfigUpdate


class ContextCompressionConfigTests(unittest.TestCase):
    def test_load_config_adds_context_compression_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "generation": {
                            "temperature": 0.25,
                            "max_tokens": 777,
                            "reasoning_effort": "high",
                        }
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(config_module, "CONFIG_PATH", path):
                loaded = config_module.load_config()

        self.assertEqual(loaded["generation"]["temperature"], 0.25)
        self.assertEqual(loaded["generation"]["max_tokens"], 777)
        self.assertEqual(loaded["generation"]["reasoning_effort"], "high")
        self.assertEqual(loaded["generation"]["context_window_tokens"], 32768)
        self.assertEqual(loaded["generation"]["compression_trigger_ratio"], 0.75)
        self.assertEqual(loaded["generation"]["compression_keep_recent_messages"], 8)
        self.assertEqual(loaded["generation"]["compression_summary_max_tokens"], 1200)

    def test_invalid_generation_values_fall_back_to_safe_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "generation": {
                            "temperature": 0.4,
                            "max_tokens": 512,
                            "reasoning_effort": "max",
                            "context_window_tokens": 1024,
                            "compression_trigger_ratio": 0.99,
                            "compression_keep_recent_messages": 1,
                            "compression_summary_max_tokens": 99999,
                        }
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(config_module, "CONFIG_PATH", path):
                loaded = config_module.load_config()
                updated = config_module.update_config(
                    {
                        "generation": {
                            "context_window_tokens": 131073,
                            "compression_trigger_ratio": 0.25,
                            "compression_keep_recent_messages": 64,
                            "compression_summary_max_tokens": 128,
                        }
                    }
                )
                saved = json.loads(path.read_text(encoding="utf-8"))

        expected = {
            "context_window_tokens": 32768,
            "compression_trigger_ratio": 0.75,
            "compression_keep_recent_messages": 8,
            "compression_summary_max_tokens": 1200,
        }
        self.assertEqual(
            {key: loaded["generation"][key] for key in expected},
            expected,
        )
        self.assertEqual(
            {key: updated["generation"][key] for key in expected},
            expected,
        )
        self.assertEqual(
            {key: saved["generation"][key] for key in expected},
            expected,
        )
        self.assertEqual(saved["generation"]["reasoning_effort"], "max")
        self.assertEqual(saved["generation"]["temperature"], 0.4)
        self.assertEqual(saved["generation"]["max_tokens"], 512)

    def test_public_config_redacts_api_key_and_normalizes_partial_generation(self):
        public = config_module.public_config(
            {
                "deepseek": {
                    "base_url": "https://api.example",
                    "model": "deepseek-chat",
                    "api_key": "secret-value",
                    "timeout_seconds": 30,
                },
                "generation": {
                    "temperature": 0.9,
                    "compression_keep_recent_messages": 12,
                },
            }
        )

        self.assertNotIn("api_key", public["deepseek"])
        self.assertTrue(public["deepseek"]["api_key_set"])
        self.assertEqual(public["generation"]["temperature"], 0.9)
        self.assertEqual(public["generation"]["max_tokens"], 2048)
        self.assertEqual(public["generation"]["reasoning_effort"], "off")
        self.assertEqual(public["generation"]["context_window_tokens"], 32768)
        self.assertEqual(public["generation"]["compression_trigger_ratio"], 0.75)
        self.assertEqual(public["generation"]["compression_keep_recent_messages"], 12)
        self.assertEqual(public["generation"]["compression_summary_max_tokens"], 1200)


class GenerationUpdateSchemaTests(unittest.TestCase):
    def test_config_update_generation_accepts_existing_and_new_fields(self):
        payload = ConfigUpdate(
            generation={
                "temperature": 0.3,
                "max_tokens": 600,
                "reasoning_effort": "high",
                "context_window_tokens": 65536,
                "compression_trigger_ratio": 0.8,
                "compression_keep_recent_messages": 10,
                "compression_summary_max_tokens": 1500,
            }
        )

        self.assertEqual(payload.generation.temperature, 0.3)
        self.assertEqual(payload.generation.max_tokens, 600)
        self.assertEqual(payload.generation.reasoning_effort, "high")
        self.assertEqual(payload.generation.context_window_tokens, 65536)
        self.assertEqual(payload.generation.compression_trigger_ratio, 0.8)
        self.assertEqual(payload.generation.compression_keep_recent_messages, 10)
        self.assertEqual(payload.generation.compression_summary_max_tokens, 1500)

    def test_config_update_generation_rejects_out_of_bounds_context_compression_fields(self):
        with self.assertRaises(ValidationError):
            ConfigUpdate(
                generation={
                    "context_window_tokens": 2047,
                    "compression_trigger_ratio": 0.49,
                    "compression_keep_recent_messages": 1,
                    "compression_summary_max_tokens": 255,
                }
            )


if __name__ == "__main__":
    unittest.main()
