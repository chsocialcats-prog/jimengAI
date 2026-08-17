import json
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import repositories
from backend.auth.dependencies import require_user
from backend.repository import work_bundles
from backend.routers import cards_routes, imports_routes, worldbooks_routes
from backend.services import adventure_engine
from backend.services.sillytavern import (
    TRANSPARENT_PNG,
    embed_card_document_in_png,
    export_card_document,
    export_worldbook_document,
    extract_card_document_from_png,
    parse_card_document,
)
from backend.test_helpers import IsolatedDatabaseTestCase


def sample_card():
    return {
        "spec": "chara_card_v3",
        "spec_version": "3.0",
        "data": {
            "name": "Nika",
            "description": "An archivist.",
            "personality": "Calm and exact.",
            "scenario": "A locked library at dusk.",
            "first_mes": "The archive opens.",
            "mes_example": "<START>\n{{char}}: Welcome.",
            "system_prompt": "Keep every answer grounded in the archive.",
            "post_history_instructions": "End with one concrete choice.",
            "tags": ["mystery", "library"],
            "extensions": {"unknown_card_option": True},
            "character_book": {
                "name": "Archive Lore",
                "entries": [
                    {
                        "id": 9,
                        "keys": ["archive"],
                        "secondary_keys": ["sealed"],
                        "comment": "Archive rule",
                        "content": "Never remove an original document.",
                        "constant": True,
                        "insertion_order": 30,
                        "enabled": True,
                        "extensions": {"probability": 45},
                        "children": [
                            {
                                "id": 10,
                                "keys": ["vault"],
                                "comment": "Vault rule",
                                "content": "The vault needs two keys.",
                                "enabled": True,
                                "insertion_order": 31,
                            }
                        ],
                    }
                ],
            },
        },
    }


class SillyTavernCodecTests(unittest.TestCase):
    def test_v3_png_round_trip_preserves_card_document(self):
        document = sample_card()

        png = embed_card_document_in_png(TRANSPARENT_PNG, document)

        self.assertEqual(extract_card_document_from_png(png), document)

    def test_card_mapping_preserves_advanced_worldbook_fields(self):
        parsed = parse_card_document(sample_card())

        self.assertEqual(parsed["card"]["name"], "Nika")
        self.assertEqual(parsed["work"]["opening"], "The archive opens.")
        root = parsed["worldbook"]["entries"][0]
        self.assertTrue(root["constant"])
        self.assertEqual(root["children"][0]["title"], "Vault rule")
        self.assertIn("二级关键词", parsed["warnings"])
        self.assertIn("高级扩展规则", parsed["warnings"])


class SillyTavernPersistenceTests(IsolatedDatabaseTestCase):
    def _import_card(self):
        parsed = parse_card_document(sample_card())
        return work_bundles.save_sillytavern_card_bundle(
            parsed["card"],
            parsed["worldbook"],
            parsed["work"],
            owner_user_id=self.test_user.id,
        )

    def test_import_persists_entry_tree_and_prompt_fields(self):
        result = self._import_card()
        worldbook = repositories.get_worldbook(result["worldbook"]["id"], viewer_user_id=self.test_user.id)

        self.assertEqual(len(worldbook["entries"]), 2)
        root, child = worldbook["entries"]
        self.assertTrue(root["constant"])
        self.assertEqual(child["parent_entry_id"], root["id"])
        self.assertIn("secondary_keys", root["interop_data"]["source"])

        conversation = repositories.create_conversation(
            result["work"]["id"], "Imported session", user_id=self.test_user.id
        )
        prompt = adventure_engine.build_messages(self.access_for(conversation))[0]["content"]

        self.assertIn("A locked library at dusk.", prompt)
        self.assertIn("Keep every answer grounded", prompt)
        self.assertIn("End with one concrete choice", prompt)

    def test_constant_entry_matches_without_keyword(self):
        result = self._import_card()
        worldbook = repositories.get_worldbook(result["worldbook"]["id"], viewer_user_id=self.test_user.id)

        titles = [entry["title"] for entry in adventure_engine.match_worldbook_entries(worldbook, "quiet room")]

        self.assertEqual(titles, ["Archive rule"])

    def test_exports_preserve_unknown_fields_and_embed_png(self):
        result = self._import_card()
        card = repositories.get_card(result["card"]["id"], viewer_user_id=self.test_user.id)
        worldbook = repositories.get_worldbook(result["worldbook"]["id"], viewer_user_id=self.test_user.id)

        card_document = export_card_document(card, worldbook)
        book_document = export_worldbook_document(worldbook)
        png_response = cards_routes.export_sillytavern_card(
            card["id"], format="png", user=self.test_user
        )
        worldbook_response = worldbooks_routes.export_sillytavern_worldbook(
            worldbook["id"], user=self.test_user
        )

        self.assertTrue(card_document["data"]["extensions"]["unknown_card_option"])
        self.assertEqual(card_document["data"]["character_book"]["entries"][0]["children"][0]["content"], "The vault needs two keys.")
        self.assertEqual(book_document["entries"]["0"]["extensions"]["probability"], 45)
        self.assertEqual(extract_card_document_from_png(png_response.body)["spec"], "chara_card_v3")
        self.assertEqual(json.loads(worldbook_response.body)["name"], "Archive Lore")

    def test_import_routes_accept_raw_v3_json(self):
        app = FastAPI()
        app.include_router(imports_routes.router)
        app.dependency_overrides[require_user] = lambda: self.test_user
        with TestClient(app) as client:
            card_response = client.post(
                "/api/imports/sillytavern-card",
                content=json.dumps(sample_card()).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            worldbook_response = client.post(
                "/api/imports/sillytavern-worldbook",
                content=json.dumps({"name": "Standalone", "entries": {}}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )

        self.assertEqual(card_response.status_code, 201)
        self.assertEqual(card_response.json()["card"]["name"], "Nika")
        self.assertEqual(worldbook_response.status_code, 201)
        self.assertEqual(worldbook_response.json()["worldbook"]["title"], "Standalone")


if __name__ == "__main__":
    unittest.main()
