# -*- coding: utf-8 -*-
import unittest
from contextlib import closing
from backend import database, repositories
from backend.repository.works import (
    _insert_work_in_connection,
    _update_work_in_connection,
)
from backend.test_helpers import IsolatedDatabaseTestCase


class WorkBundleTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        self.card = repositories.create_card({"name": "角色", "persona": "设定"})

    def tearDown(self):
        super().tearDown()

    def test_connection_aware_work_writes_share_normalization_on_one_transaction(self):
        with closing(database.connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            work_id = _insert_work_in_connection(
                connection,
                {
                    "title": "shared write",
                    "card_ids": [self.card["id"]],
                    "tags": ["tag"],
                    "onboarding": {"enabled": True, "fields": []},
                    "reply_templates": [{"id": "main", "content": "body"}],
                    "active_reply_template_id": "main",
                },
                now="2026-08-12T00:00:00",
            )
            _update_work_in_connection(
                connection,
                work_id,
                {
                    "player_attributes": {"stamina": 4},
                    "active_reply_template_id": "main",
                    "card_ids": [],
                },
                now="2026-08-12T00:01:00",
            )
            connection.commit()

        work = repositories.get_work(work_id)
        self.assertEqual(work["card_ids"], [])
        self.assertEqual(work["player_attributes"], {"stamina": 4})
        self.assertEqual(work["tags"], ["tag"])
        self.assertEqual(work["onboarding"]["enabled"], True)
        self.assertEqual(work["reply_templates"], [{"id": "main", "name": "未命名模板", "content": "body"}])
        self.assertEqual(work["active_reply_template_id"], "main")

    def test_bundle_create_persists_work_worldbook_entries_and_card_order(self):
        result = repositories.save_work_bundle(
            {
                "title": "完整作品",
                "opening": "开场",
                "card_ids": [self.card["id"]],
                "player_attributes": {"体力": 10},
            },
            {
                "title": "世界",
                "description": "说明",
                "entries": [
                    {"title": "规则", "keywords": ["规则"], "content": "内容", "priority": 2, "enabled": True}
                ],
            },
        )

        self.assertEqual(result["work"]["worldbook_id"], result["worldbook"]["id"])
        self.assertEqual(result["work"]["card_ids"], [self.card["id"]])
        self.assertEqual(result["work"]["player_attributes"], {"体力": 10})
        self.assertEqual([entry["title"] for entry in result["worldbook"]["entries"]], ["规则"])

    def test_bundle_update_replaces_entries_and_rolls_back_all_changes_on_failure(self):
        created = repositories.save_work_bundle(
            {"title": "旧作品", "card_ids": [self.card["id"]]},
            {
                "title": "旧世界",
                "description": "旧说明",
                "entries": [
                    {"title": "保留", "keywords": [], "content": "旧", "priority": 0, "enabled": True},
                    {"title": "删除", "keywords": [], "content": "旧", "priority": 0, "enabled": True},
                ],
            },
        )
        work_id = created["work"]["id"]
        worldbook_id = created["worldbook"]["id"]
        kept_id = created["worldbook"]["entries"][0]["id"]

        updated = repositories.save_work_bundle(
            {"title": "新作品", "card_ids": [self.card["id"]]},
            {
                "title": "新世界",
                "description": "新说明",
                "entries": [
                    {"id": kept_id, "title": "已更新", "keywords": ["新"], "content": "新", "priority": 1, "enabled": True},
                    {"title": "新增", "keywords": [], "content": "新增", "priority": 0, "enabled": True},
                ],
            },
            work_id=work_id,
        )
        self.assertEqual(updated["work"]["title"], "新作品")
        self.assertEqual({entry["title"] for entry in updated["worldbook"]["entries"]}, {"已更新", "新增"})

        with self.assertRaisesRegex(ValueError, "角色卡不存在"):
            repositories.save_work_bundle(
                {"title": "不应保存", "card_ids": [999999]},
                {"title": "不应保存", "description": "失败", "entries": []},
                work_id=work_id,
            )
        self.assertEqual(repositories.get_work(work_id)["title"], "新作品")
        worldbook = repositories.get_worldbook(worldbook_id)
        self.assertEqual(worldbook["title"], "新世界")
        self.assertEqual({entry["title"] for entry in worldbook["entries"]}, {"已更新", "新增"})


if __name__ == "__main__":
    unittest.main()
