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


if __name__ == "__main__":
    unittest.main()
