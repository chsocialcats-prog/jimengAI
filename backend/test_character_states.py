# -*- coding: utf-8 -*-
import unittest

from backend import repositories
from backend.services import state_service


class CharacterStateTests(unittest.TestCase):
    def test_normalize_state_preserves_character_attributes_and_flags(self):
        state = repositories.normalize_state({
            "characters": {
                "周予宁": {"attributes": {"心情": 50, "好感度": 5}, "flags": ["放松"]}
            }
        })

        self.assertEqual(state["characters"]["周予宁"]["attributes"]["心情"], 50)
        self.assertEqual(state["characters"]["周予宁"]["flags"], ["放松"])

    def test_character_delta_updates_only_the_named_character(self):
        current = repositories.normalize_state({
            "attributes": {"心情": 65},
            "characters": {
                "周予宁": {"attributes": {"心情": 50, "好感度": 5}, "flags": []}
            },
        })

        updated, changed = state_service.merge_state(current, {
            "characters": {
                "周予宁": {"attributes": {"心情": "+5", "好感度": "+2"}, "flags": {"add": ["放松"]}}
            }
        })

        self.assertEqual(updated["attributes"]["心情"], 65)
        self.assertEqual(updated["characters"]["周予宁"]["attributes"], {"心情": 55.0, "好感度": 7.0})
        self.assertEqual(updated["characters"]["周予宁"]["flags"], ["放松"])
        self.assertIn("characters", changed)

    def test_merge_state_filters_unknown_and_non_numeric_attributes_with_schema(self):
        current = repositories.normalize_state({
            "attributes": {"学业": 60, "说明": "学生"},
            "characters": {
                "温执": {"attributes": {"心情": 50}, "flags": []},
            },
        })
        schema = {
            "attributes": {"学业": 60, "说明": "学生"},
            "characters": {"温执": {"心情": 50}},
        }

        updated, changed = state_service.merge_state(
            current,
            {
                "attributes": {"学业": "+5", "体力": "+10", "说明": "+1"},
                "characters": {
                    "温执": {"attributes": {"心情": "-2", "魅力": "+3"}},
                    "陌生角色": {"attributes": {"心情": "+9"}},
                },
                "money": "+10",
            },
            attribute_schema=schema,
        )

        self.assertEqual(updated["attributes"], {"学业": 65.0, "说明": "学生"})
        self.assertEqual(updated["characters"]["温执"]["attributes"], {"心情": 48.0})
        self.assertNotIn("陌生角色", updated["characters"])
        self.assertEqual(updated["money"], 10.0)
        self.assertEqual(changed, {"attributes", "characters", "money"})

    def test_merge_state_with_empty_schema_does_not_create_default_attribute(self):
        current = repositories.normalize_state({"attributes": {}, "characters": {}})

        updated, changed = state_service.merge_state(
            current,
            {"attributes": {"心情": "+1"}},
            attribute_schema={"attributes": {}, "characters": {}},
        )

        self.assertEqual(updated["attributes"], {})
        self.assertEqual(changed, set())

    def test_merge_state_without_schema_only_updates_existing_numeric_attributes(self):
        current = repositories.normalize_state({
            "attributes": {"心情": 60, "说明": "学生"},
            "characters": {
                "温执": {"attributes": {"好感": 5, "称呼": "同学"}, "flags": []},
            },
        })

        updated, changed = state_service.merge_state(
            current,
            {
                "attributes": {"心情": 70, "说明": 123, "体力": "+10"},
                "characters": {
                    "温执": {"attributes": {"好感": "+2", "称呼": "+1", "魅力": "+3"}},
                    "陌生角色": {"attributes": {"心情": "+9"}},
                },
            },
        )

        self.assertEqual(updated["attributes"], {"心情": 70, "说明": "学生"})
        self.assertEqual(updated["characters"]["温执"]["attributes"], {"好感": 7.0, "称呼": "同学"})
        self.assertNotIn("陌生角色", updated["characters"])
        self.assertEqual(changed, {"attributes", "characters"})


if __name__ == "__main__":
    unittest.main()
