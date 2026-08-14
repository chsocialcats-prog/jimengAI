# -*- coding: utf-8 -*-
"""Private conversation repository operations must always carry an owner scope."""

import inspect
import unittest

from backend.repository import conversation_repository, snapshot_repository


class PrivateRepositoryScopingTests(unittest.TestCase):
    def test_private_repository_entrypoints_require_explicit_user_scope(self):
        # Removing an owner argument from any listed method would re-open an
        # account boundary, even when individual callers currently behave.
        conversation_methods = (
            "get_conversation",
            "list_conversations",
            "update_conversation",
            "set_conversation_status",
            "delete_conversation",
            "get_messages",
            "create_message",
            "update_message",
            "get_state",
            "save_state",
            "get_memory_summary_record",
            "save_memory_summary",
            "complete_conversation_onboarding",
            "add_conversation_correction",
            "create_conversation_branch",
        )
        snapshot_methods = (
            "list_snapshots",
            "get_snapshot",
            "create_snapshot",
            "restore_snapshot",
            "delete_snapshot",
        )

        for module, names in (
            (conversation_repository, conversation_methods),
            (snapshot_repository, snapshot_methods),
        ):
            for name in names:
                parameter = inspect.signature(getattr(module, name)).parameters.get("user_id")
                self.assertIsNotNone(parameter, f"{module.__name__}.{name} lacks user_id")
                self.assertIs(parameter.default, inspect.Parameter.empty)


if __name__ == "__main__":
    unittest.main()
