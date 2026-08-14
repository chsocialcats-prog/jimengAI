# -*- coding: utf-8 -*-
"""Reference protection contracts for shared cards and worldbooks."""

import unittest

from backend.repository import cards, works, worldbooks
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user
from backend import database
from contextlib import closing


class SharedLibraryReferenceTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.alice = create_test_user(connection, "alice")
            self.bob = create_test_user(connection, "bob")
            connection.commit()

    def test_non_owner_cannot_probe_references_before_owner_check(self):
        card = cards.create_card({"name": "Bob 卡"}, owner_user_id=self.bob["id"])
        work = works.create_work(
            {"title": "Bob 作品", "card_id": card["id"]}, owner_user_id=self.bob["id"]
        )

        result = cards.delete_card(card["id"], owner_user_id=self.alice["id"])

        self.assertEqual(result, "forbidden")
        self.assertEqual(works.get_work(work["id"])["title"], "Bob 作品")

    def test_reference_summaries_are_id_title_only_and_stably_ordered(self):
        card = cards.create_card({"name": "卡"}, owner_user_id=self.alice["id"])
        first = works.create_work({"title": "先", "card_id": card["id"]}, owner_user_id=self.alice["id"])
        second = works.create_work({"title": "后", "card_ids": [card["id"]]}, owner_user_id=self.alice["id"])

        with self.assertRaises(cards.CardReferenceConflict) as caught:
            cards.delete_card(card["id"], owner_user_id=self.alice["id"])

        self.assertEqual(
            sorted(caught.exception.works, key=lambda item: item["id"]),
            [{"id": first["id"], "title": "先"}, {"id": second["id"], "title": "后"}],
        )

    def test_worldbook_reference_is_protected_without_deleting_the_work(self):
        worldbook = worldbooks.create_worldbook({"title": "书"}, owner_user_id=self.alice["id"])
        work = works.create_work(
            {"title": "引用", "worldbook_id": worldbook["id"]}, owner_user_id=self.alice["id"]
        )

        with self.assertRaises(worldbooks.WorldbookReferenceConflict):
            worldbooks.delete_worldbook(worldbook["id"], owner_user_id=self.alice["id"])

        self.assertEqual(works.get_work(work["id"])["worldbook_id"], worldbook["id"])


    def test_card_and_worldbook_reads_and_updates_include_safe_referencing_work_summaries(self):
        card = cards.create_card({"name": "Card"}, owner_user_id=self.alice["id"])
        worldbook = worldbooks.create_worldbook({"title": "Worldbook"}, owner_user_id=self.alice["id"])
        card_work = works.create_work(
            {"title": "Card work", "card_id": card["id"]}, owner_user_id=self.alice["id"]
        )
        worldbook_work = works.create_work(
            {"title": "Worldbook work", "worldbook_id": worldbook["id"]},
            owner_user_id=self.alice["id"],
        )

        expected_card_summary = [{"id": card_work["id"], "title": "Card work"}]
        expected_worldbook_summary = [
            {"id": worldbook_work["id"], "title": "Worldbook work"}
        ]

        self.assertEqual(
            cards.get_card(card["id"])["referencing_works"], expected_card_summary
        )
        self.assertEqual(
            cards.list_cards()["items"][0]["referencing_works"], expected_card_summary
        )
        self.assertEqual(
            cards.update_card(
                card["id"], {"persona": "Updated"}, owner_user_id=self.alice["id"]
            )["referencing_works"],
            expected_card_summary,
        )
        self.assertEqual(
            worldbooks.get_worldbook(worldbook["id"])["referencing_works"],
            expected_worldbook_summary,
        )
        self.assertEqual(
            worldbooks.list_worldbooks()["items"][0]["referencing_works"],
            expected_worldbook_summary,
        )
        self.assertEqual(
            worldbooks.update_worldbook(
                worldbook["id"], {"description": "Updated"}, owner_user_id=self.alice["id"]
            )["referencing_works"],
            expected_worldbook_summary,
        )


if __name__ == "__main__":
    unittest.main()
