# -*- coding: utf-8 -*-
"""Structured and fallback option output contracts."""

import unittest

from backend.services import adventure_engine


class OptionOutputTests(unittest.TestCase):
    def test_stream_filter_extracts_structured_options_without_leaking_tag(self):
        output_filter = adventure_engine.StructuredOutputFilter()

        visible = output_filter.feed(
            "你站在门前。<options>[\"观察门锁\", \"敲门\", \"离开\"]</options>"
        )
        tail, state_delta, judge_block, options = output_filter.finish()

        self.assertEqual(visible + tail, "你站在门前。")
        self.assertIsNone(state_delta)
        self.assertIsNone(judge_block)
        self.assertEqual(options, ["观察门锁", "敲门", "离开"])

    def test_prompt_requires_structured_options_block(self):
        prompt = adventure_engine.build_system_prompt(
            None,
            None,
            None,
            [],
            {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []},
            "",
        )

        self.assertIn("<options>[\"选项一\",\"选项二\"]</options>", prompt)

    def test_fallback_options_are_always_two_to_four_actions(self):
        options = adventure_engine.default_turn_options("你来到一扇紧闭的门前。", "继续观察")

        self.assertGreaterEqual(len(options), 2)
        self.assertLessEqual(len(options), 4)
        self.assertTrue(all(isinstance(option, str) and option for option in options))

    def test_legacy_visible_options_are_extracted_before_fallback(self):
        narrative = (
            "你站在门前。\n"
            "选项：\n"
            "- 观察门锁\n"
            "- 敲门\n"
            "- 离开\n"
            "【状态变化】\n"
            "心情 +1"
        )

        self.assertEqual(
            adventure_engine.parse_visible_options(narrative),
            ["观察门锁", "敲门", "离开"],
        )

    def test_bare_bullets_are_extracted_before_fallback(self):
        narrative = (
            "她注视着你，只等着你给出自己的选择。\n\n"
            "- 问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？\n"
            "- 决定签下保密契约，跟她进入东区禁书区\n"
            "- 先问她：你有没有亲眼见过实际存在的那本笔记？\n"
            "- 微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”\n\n"
            "【状态变化】\n"
            "- 塞西莉亚·好感度 +2"
        )

        self.assertEqual(
            adventure_engine.parse_visible_options(narrative),
            [
                "问塞西莉亚：那本笔记究竟记录了怎样的内容，为什么必须被封锁？",
                "决定签下保密契约，跟她进入东区禁书区",
                "先问她：你有没有亲眼见过实际存在的那本笔记？",
                "微笑承认自己梦里还见到过某种仪式，问她是否听说过“复苏教团”",
            ],
        )


if __name__ == "__main__":
    unittest.main()
