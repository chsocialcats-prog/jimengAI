# -*- coding: utf-8 -*-
import unittest
import sqlite3
from backend import database, repositories
from backend.schemas import WorkCreate
from backend.services import adventure_engine
from backend.test_helpers import IsolatedDatabaseTestCase


class ReplyTemplateTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()

    def tearDown(self):
        super().tearDown()

    def test_work_schema_accepts_multiple_reply_templates(self):
        payload = WorkCreate(
            title="模板作品",
            reply_templates=[
                {"id": "narrative", "name": "叙事", "content": "使用小说式正文。"}
            ],
            active_reply_template_id="narrative",
        )
        data = payload.model_dump()
        self.assertEqual(data["reply_templates"][0]["id"], "narrative")
        self.assertEqual(data["active_reply_template_id"], "narrative")

    def test_schema_payload_with_missing_template_fields_reaches_repository_normalization(self):
        payload = WorkCreate(
            title="模板作品",
            reply_templates=[
                {"content": "body"},
                {"id": "valid", "name": "有效", "content": "keep"},
                {},
            ],
        )

        templates = repositories.validate_reply_templates(
            payload.model_dump()["reply_templates"]
        )

        self.assertEqual(
            templates,
            [
                {"id": "template-1", "name": "未命名模板", "content": "body"},
                {"id": "valid", "name": "有效", "content": "keep"},
            ],
        )

    def test_work_round_trip_preserves_multiple_templates_and_active_id(self):
        work = repositories.create_work(
            {
                "title": "模板作品",
                "reply_templates": [
                    {"id": "narrative", "name": "叙事", "content": "使用小说式正文。"},
                    {"id": "compact", "name": "简洁", "content": "只回复三段。"},
                ],
                "active_reply_template_id": "compact",
            }, owner_user_id=self.test_user.id
        )
        self.assertEqual(
            [item["id"] for item in work["reply_templates"]], ["narrative", "compact"]
        )
        self.assertEqual(work["active_reply_template_id"], "compact")

    def test_work_update_round_trip_preserves_two_templates_and_active_id(self):
        work = repositories.create_work({"title": "模板作品"}, owner_user_id=self.test_user.id)

        updated = repositories.update_work(
            work["id"],
            {
                "reply_templates": [
                    {"id": "narrative", "name": "叙事", "content": "小说式正文。"},
                    {"id": "compact", "name": "简洁", "content": "只回复三段。"},
                ],
                "active_reply_template_id": "compact",
            }, owner_user_id=self.test_user.id,
        )

        self.assertEqual(
            updated["reply_templates"],
            [
                {"id": "narrative", "name": "叙事", "content": "小说式正文。"},
                {"id": "compact", "name": "简洁", "content": "只回复三段。"},
            ],
        )
        self.assertEqual(updated["active_reply_template_id"], "compact")

    def test_duplicate_template_ids_are_normalized(self):
        templates = repositories.validate_reply_templates(
            [
                {"id": "same", "name": "第一个", "content": "one"},
                {"id": "same", "name": "第二个", "content": "two"},
            ]
        )

        self.assertEqual(
            templates,
            [
                {"id": "same", "name": "第一个", "content": "one"},
                {"id": "template-1", "name": "第二个", "content": "two"},
            ],
        )

    def test_invalid_active_id_is_cleared_and_empty_items_are_ignored(self):
        work = repositories.create_work(
            {
                "title": "模板作品",
                "reply_templates": [
                    {"id": "usable", "name": "可用", "content": "保留。"},
                    {"id": "", "name": "", "content": ""},
                ],
                "active_reply_template_id": "missing",
            }, owner_user_id=self.test_user.id
        )
        self.assertEqual(len(work["reply_templates"]), 1)
        self.assertEqual(work["active_reply_template_id"], "")

    def test_template_update_for_missing_work_returns_none(self):
        template = {"id": "narrative", "name": "叙事", "content": "使用小说式正文。"}
        payloads = (
            {"reply_templates": [template]},
            {"active_reply_template_id": "narrative"},
            {"reply_templates": [template], "active_reply_template_id": "narrative"},
        )

        for payload in payloads:
            with self.subTest(payload=payload):
                self.assertIsNone(repositories.update_work(999999, payload, owner_user_id=self.test_user.id))

    def test_legacy_works_table_receives_empty_reply_template_defaults(self):
        self.db_path.unlink()
        connection = sqlite3.connect(self.db_path)
        try:
            connection.execute(
                """
                CREATE TABLE works (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    card_id INTEGER,
                    player_attributes TEXT NOT NULL DEFAULT '{}',
                    worldbook_id INTEGER,
                    opening TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '[]',
                    onboarding TEXT NOT NULL DEFAULT '{}',
                    cover_url TEXT NOT NULL DEFAULT '',
                    is_archive INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                )
                """
            )
            connection.execute(
                "INSERT INTO works (title, created_at, updated_at) VALUES (?, ?, ?)",
                ("旧作品", "2026-08-10T00:00:00", "2026-08-10T00:00:00"),
            )
            connection.commit()
        finally:
            connection.close()

        database.init_db()

        work = repositories.get_work(1)
        self.assertEqual(work["reply_templates"], [])
        self.assertEqual(work["active_reply_template_id"], "")


class ReplyTemplatePromptTests(unittest.TestCase):
    def build_prompt(self, reply_templates, active_reply_template_id):
        return adventure_engine.build_system_prompt(
            {
                "title": "模板作品",
                "reply_templates": reply_templates,
                "active_reply_template_id": active_reply_template_id,
            },
            None,
            None,
            [],
            {"attributes": {}, "items": [], "money": 0, "relations": {}, "quests": [], "flags": []},
            "",
        )

    def test_prompt_contains_only_the_active_template(self):
        prompt = self.build_prompt(
            [
                {"id": "active", "name": "叙事", "content": "active-template-marker"},
                {"id": "other", "name": "简洁", "content": "inactive-template-marker"},
            ],
            "active",
        )
        self.assertIn("active-template-marker", prompt)
        self.assertNotIn("inactive-template-marker", prompt)

    def test_template_is_delimited_and_followed_by_hard_contract_reminder(self):
        prompt = self.build_prompt(
            [
                {"id": "active", "name": "叙事", "content": "active-template-marker"},
                {"id": "other", "name": "简洁", "content": "inactive-template-marker"},
            ],
            "active",
        )

        self.assertIn("<reply_template>", prompt)
        self.assertIn("</reply_template>", prompt)
        self.assertIn("模板优先级低于系统规则、角色卡、世界书", prompt)
        self.assertIn("<state_delta>、<judge>、<options> 合约仍必须遵守", prompt)
        self.assertLess(
            prompt.index("active-template-marker"),
            prompt.index("<state_delta>、<judge>、<options> 合约仍必须遵守"),
        )
        self.assertNotIn("inactive-template-marker", prompt)

    def test_prompt_without_active_template_has_no_template_section(self):
        prompt = self.build_prompt([], "")
        self.assertNotIn("回复模板（当前）", prompt)

    def test_prompt_with_whitespace_only_active_id_has_no_template_section(self):
        prompt = self.build_prompt(
            [{"id": " ", "name": "空白", "content": "whitespace-template-marker"}],
            " ",
        )
        self.assertNotIn("回复模板（当前）", prompt)
        self.assertNotIn("whitespace-template-marker", prompt)

    def test_prompt_with_malformed_template_entries_has_no_template_section(self):
        prompt = self.build_prompt(
            [None, "not-a-template", {"id": "active"}, {"id": "active", "content": None}],
            "active",
        )
        self.assertNotIn("回复模板（当前）", prompt)

    def test_prompt_with_unmatched_active_id_has_no_template_section(self):
        prompt = self.build_prompt(
            [{"id": "other", "name": "其他", "content": "unmatched-template-marker"}],
            "active",
        )
        self.assertNotIn("回复模板（当前）", prompt)
        self.assertNotIn("unmatched-template-marker", prompt)

    def test_prompt_with_blank_content_template_has_no_template_section(self):
        prompt = self.build_prompt(
            [{"id": "active", "name": "空内容", "content": "   "}],
            "active",
        )
        self.assertNotIn("回复模板（当前）", prompt)


if __name__ == "__main__":
    unittest.main()
