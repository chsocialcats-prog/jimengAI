# -*- coding: utf-8 -*-
"""Tests for per-conversation online reply-length presets."""

import unittest

from backend.services.reply_length import (
    append_reply_length_instruction,
    resolve_reply_length,
)


class ReplyLengthPresetTests(unittest.TestCase):
    def test_resolves_all_reply_length_presets(self):
        self.assertEqual(
            resolve_reply_length({"reply_length": "short"}, 777)["max_tokens"],
            1024,
        )
        self.assertEqual(
            resolve_reply_length({"reply_length": "standard"}, 777)["max_tokens"],
            2048,
        )
        self.assertEqual(
            resolve_reply_length({"reply_length": "detailed"}, 777)["max_tokens"],
            4096,
        )
        self.assertEqual(
            resolve_reply_length({"reply_length": "long"}, 777)["max_tokens"],
            8192,
        )

    def test_invalid_or_missing_reply_length_uses_global_fallback(self):
        self.assertEqual(
            resolve_reply_length({}, 777),
            {"key": None, "max_tokens": 777, "instruction": ""},
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


if __name__ == "__main__":
    unittest.main()
