# -*- coding: utf-8 -*-
"""Owner-scoped, atomic work-bundle persistence contracts."""

from contextlib import closing
import unittest

from backend import database
from backend.repository import cards, work_bundles, works, worldbooks
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class WorkBundleAuthorizationTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.alice = create_test_user(connection, "alice")
            self.bob = create_test_user(connection, "bob")
            connection.commit()

    def test_bundle_create_assigns_every_new_resource_to_authenticated_owner(self):
        card = cards.create_card({"name": "Bob 卡"}, owner_user_id=self.bob["id"])

        result = work_bundles.save_work_bundle(
            {"title": "Alice 作品", "card_ids": [card["id"]]},
            {"title": "Alice 新书", "entries": [{"title": "规则"}]},
            owner_user_id=self.alice["id"],
        )

        self.assertEqual(result["work"]["owner_user_id"], self.alice["id"])
        self.assertEqual(result["worldbook"]["owner_user_id"], self.alice["id"])
        self.assertEqual(result["work"]["cards"][0]["owner_user_id"], self.bob["id"])

    def test_bundle_update_cannot_modify_another_users_linked_worldbook(self):
        worldbook = worldbooks.create_worldbook({"title": "Bob 的书"}, owner_user_id=self.bob["id"])
        work = works.create_work(
            {"title": "Alice 的作品", "worldbook_id": worldbook["id"]}, owner_user_id=self.alice["id"]
        )

        with self.assertRaises(work_bundles.BundleOwnershipError):
            work_bundles.save_work_bundle(
                {"title": "不应更新"}, {"title": "越权修改", "entries": []},
                work_id=work["id"], owner_user_id=self.alice["id"],
            )

        self.assertEqual(worldbooks.get_worldbook(worldbook["id"])["title"], "Bob 的书")
        self.assertEqual(works.get_work(work["id"])["title"], "Alice 的作品")

    def test_bundle_validation_rolls_back_new_worldbook_when_card_reference_is_missing(self):
        before = worldbooks.list_worldbooks()["total"]

        with self.assertRaisesRegex(ValueError, "角色卡不存在"):
            work_bundles.save_work_bundle(
                {"title": "不会创建", "card_ids": [999999]},
                {"title": "不会保留", "entries": [{"title": "规则"}]},
                owner_user_id=self.alice["id"],
            )

        self.assertEqual(worldbooks.list_worldbooks()["total"], before)

    def test_import_bundle_rolls_back_card_and_worldbook_when_work_is_invalid(self):
        before_cards = cards.list_cards()["total"]
        before_worldbooks = worldbooks.list_worldbooks()["total"]

        with self.assertRaisesRegex(ValueError, "角色卡不存在"):
            work_bundles.save_import_bundle(
                {"name": "导入卡"}, {"title": "导入书"}, [],
                {"title": "无效作品", "card_ids": [999999]},
                owner_user_id=self.alice["id"],
            )

        self.assertEqual(cards.list_cards()["total"], before_cards)
        self.assertEqual(worldbooks.list_worldbooks()["total"], before_worldbooks)


if __name__ == "__main__":
    unittest.main()
