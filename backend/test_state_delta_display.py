# -*- coding: utf-8 -*-
import unittest

from backend.services import state_service


class StateDeltaDisplayTests(unittest.TestCase):
    def test_formats_player_facing_summary_for_relative_changes(self):
        summary = state_service.format_state_delta_for_player({
            "attributes": {"心情": "+5", "体力": "-2"},
            "money": "+10",
            "items": {"add": ["旧钥匙"], "remove": ["破损地图"]},
            "flags": {"add": ["轻伤"], "remove": ["淋湿"]},
        })

        self.assertEqual(
            summary,
            "\n\n【状态变化】\n"
            "- 心情 +5\n"
            "- 体力 -2\n"
            "- 金钱 +10\n"
            "- 获得：旧钥匙\n"
            "- 失去：破损地图\n"
            "- 新增状态：轻伤\n"
            "- 移除状态：淋湿",
        )


if __name__ == "__main__":
    unittest.main()
