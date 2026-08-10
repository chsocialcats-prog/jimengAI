# -*- coding: utf-8 -*-
"""会话开局引导的持久化与上下文回归测试。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import database, repositories
from backend.services import adventure_engine


class OnboardingTests(unittest.TestCase):
    """移除引导配置快照或校验时，这些会话级行为必须失败。"""

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()
        self.work = repositories.create_work({"title": "测试剧本", "opening": "开场"})

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_create_conversation_snapshots_work_onboarding(self):
        config = {
            "enabled": True,
            "intro": "补全开局",
            "allow_freeform": True,
            "fields": [{"key": "player_role", "label": "身份", "type": "text", "required": True}],
        }
        work = repositories.update_work(self.work["id"], {"onboarding": config})
        conversation = repositories.create_conversation(work["id"], "测试")
        self.assertEqual(conversation["onboarding_status"], "pending")
        self.assertEqual(conversation["onboarding_config"]["fields"][0]["key"], "player_role")
        self.assertEqual(conversation["onboarding_config"]["fields"][0]["placeholder"], "")

    def test_rejects_duplicate_or_invalid_onboarding_field_keys(self):
        with self.assertRaisesRegex(ValueError, "key"):
            repositories.validate_onboarding({"fields": [
                {"key": "bad key", "label": "A", "type": "text"},
                {"key": "bad key", "label": "B", "type": "text"},
            ]})

    def test_completion_persists_answers_and_injects_context(self):
        work = repositories.update_work(self.work["id"], {"onboarding": {"enabled": True, "fields": [
            {"key": "player_role", "label": "身份", "type": "text", "required": True}
        ]}})
        conversation = repositories.create_conversation(work["id"], "测试")
        with self.assertRaisesRegex(ValueError, "player_role"):
            repositories.complete_conversation_onboarding(conversation["id"], {})
        completed = repositories.complete_conversation_onboarding(conversation["id"], {"player_role": "哲"})
        self.assertEqual(completed["onboarding_status"], "completed")
        self.assertEqual(completed["onboarding_answers"]["player_role"], "哲")
        self.assertIn("哲", adventure_engine.build_messages(completed["id"])[0]["content"])


if __name__ == "__main__":
    unittest.main()
