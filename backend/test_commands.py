import unittest

from backend.services import commands


class CommandTests(unittest.TestCase):
    def test_manual_dice_commands_are_not_available(self):
        for command in ("/roll 1d20", "/掷骰 1d20", "/判定 1d20 12"):
            result = commands.handle_command(1, command)
            self.assertIn("未知指令", result["content"])


if __name__ == "__main__":
    unittest.main()
