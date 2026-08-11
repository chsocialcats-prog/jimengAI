# -*- coding: utf-8 -*-
"""Tests for per-conversation online reply-length presets."""

import unittest

from backend.services.reply_length import (
    append_reply_length_instruction,
    resolve_reply_length,
)


class ReplyLengthPresetTests(unittest.TestCase):
    def test_resolves_all_reply_length_presets(self):
        expected = {
            "short": (1024, 300, 500),
            "standard": (2048, 600, 1000),
            "detailed": (4096, 1000, 1800),
            "long": (8192, 2000, 3500),
        }
        for key, (max_tokens, min_characters, max_characters) in expected.items():
            settings = resolve_reply_length({"reply_length": key}, 777)
            self.assertEqual(settings["max_tokens"], max_tokens)
            self.assertEqual(settings["min_characters"], min_characters)
            self.assertEqual(settings["max_characters"], max_characters)

    def test_invalid_or_missing_reply_length_uses_global_fallback(self):
        self.assertEqual(
            resolve_reply_length({}, 777),
            {
                "key": None,
                "max_tokens": 777,
                "min_characters": 0,
                "max_characters": 0,
                "instruction": "",
            },
        )
        self.assertEqual(
            resolve_reply_length({"reply_length": "unknown"}, 777)["max_tokens"],
            777,
        )

    def test_length_instruction_is_added_only_to_the_system_message(self):
        messages = [
            {"role": "system", "content": "base rules"},
            {"role": "user", "content": "look around"},
        ]

        updated = append_reply_length_instruction(messages, "long")

        self.assertIn("2000", updated[0]["content"])
        self.assertEqual(updated[1], messages[1])
        self.assertEqual(messages[0]["content"], "base rules")

    def test_detailed_preset_has_a_minimum_visible_character_target(self):
        settings = resolve_reply_length({"reply_length": "detailed"}, 777)

        self.assertEqual(settings["min_characters"], 1000)
        self.assertEqual(settings["max_characters"], 1800)
        self.assertIn("1000", settings["instruction"])
        self.assertIn("不得少于", settings["instruction"])

if __name__ == "__main__":
    unittest.main()
