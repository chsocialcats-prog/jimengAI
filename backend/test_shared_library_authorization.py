# -*- coding: utf-8 -*-
"""Shared-library ownership contracts at the HTTP and repository boundaries."""

from contextlib import closing
import unittest

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend import database
from backend.auth.dependencies import optional_user, require_user
from backend.auth.types import PublicUser
from backend.repository import cards, work_bundles, works, worldbooks
from backend.routers import cards_routes, imports_routes, works_routes, worldbooks_routes
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class SharedLibraryAuthorizationTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.alice = create_test_user(connection, "alice")
            self.bob = create_test_user(connection, "bob")
            connection.commit()
        self.app = FastAPI()

        @self.app.exception_handler(HTTPException)
        async def error_handler(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

        for router in (
            cards_routes.router,
            worldbooks_routes.router,
            works_routes.router,
            imports_routes.router,
        ):
            self.app.include_router(router)
        self.client = TestClient(self.app)
        self.as_anonymous()

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def as_anonymous(self):
        self.app.dependency_overrides[optional_user] = lambda: None
        self.app.dependency_overrides[require_user] = lambda: (_ for _ in ()).throw(
            HTTPException(401, {"code": "authentication_required", "message": "需要登录"})
        )

    def as_user(self, user):
        public_user = PublicUser(user["id"], user["username"], user["created_at"])
        self.app.dependency_overrides[optional_user] = lambda: public_user
        self.app.dependency_overrides[require_user] = lambda: public_user

    def test_anonymous_can_read_public_cards_with_owner_projection_but_cannot_write(self):
        card = cards.create_card({"name": "公开角色"}, owner_user_id=self.alice["id"])

        listed = self.client.get("/api/cards")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            listed.json()["items"][0]["owner_username"], "alice"
        )
        self.assertFalse(listed.json()["items"][0]["can_edit"])
        self.assertFalse(self.client.get(f"/api/cards/{card['id']}").json()["can_edit"])

        denied = self.client.post("/api/cards", json={"name": "访客不能创建"})
        self.assertEqual((denied.status_code, denied.json()["error"]["code"]), (401, "authentication_required"))
        for path, payload in (
            ("/api/worldbooks", {"title": "访客不能创建"}),
            ("/api/works", {"title": "访客不能创建"}),
            ("/api/imports/card-text", {"text": "任意导入文本"}),
        ):
            response = self.client.post(path, json=payload)
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (401, "authentication_required"))

    def test_only_owner_can_edit_or_delete_and_client_owner_field_is_ignored(self):
        self.as_user(self.alice)
        created = self.client.post(
            "/api/cards", json={"name": "Alice 的卡", "owner_user_id": self.bob["id"]}
        )
        self.assertEqual(created.status_code, 201)
        card_id = created.json()["id"]
        self.assertTrue(created.json()["can_edit"])
        self.assertEqual(created.json()["owner_username"], "alice")

        self.as_user(self.bob)
        forbidden = self.client.put(f"/api/cards/{card_id}", json={"name": "越权"})
        self.assertEqual((forbidden.status_code, forbidden.json()["error"]["code"]), (403, "forbidden"))
        missing = self.client.put("/api/cards/99999", json={"name": "不存在"})
        self.assertEqual((missing.status_code, missing.json()["error"]["code"]), (404, "not_found"))

        self.as_user(self.alice)
        self.assertEqual(self.client.delete(f"/api/cards/{card_id}").status_code, 204)

    def test_worldbook_entries_inherit_parent_owner_and_legacy_rows_are_read_only(self):
        worldbook = worldbooks.create_worldbook({"title": "Alice 世界"}, owner_user_id=self.alice["id"])
        self.as_user(self.alice)
        entry = self.client.post(
            f"/api/worldbooks/{worldbook['id']}/entries", json={"title": "规则"}
        )
        self.assertEqual(entry.status_code, 201)

        self.as_user(self.bob)
        denied = self.client.put(
            f"/api/worldbooks/{worldbook['id']}/entries/{entry.json()['id']}",
            json={"title": "越权规则"},
        )
        self.assertEqual((denied.status_code, denied.json()["error"]["code"]), (403, "forbidden"))

        with closing(database.connect()) as connection:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute("DROP TABLE cards")
            connection.execute(
                """
                CREATE TABLE cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
                    name TEXT NOT NULL, persona TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
                    speaking_style TEXT NOT NULL DEFAULT '', relationships TEXT NOT NULL DEFAULT '{}',
                    directives TEXT NOT NULL DEFAULT '[]', initial_state TEXT NOT NULL DEFAULT '{}',
                    character_attributes TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'local',
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "INSERT INTO cards (owner_user_id, name, created_at, updated_at) VALUES (NULL, ?, ?, ?)",
                ("旧卡", database.now_str(), database.now_str()),
            )
            legacy_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
            connection.commit()
        legacy = self.client.get(f"/api/cards/{legacy_id}")
        self.assertEqual(legacy.status_code, 200)
        self.assertFalse(legacy.json()["can_edit"])
        self.assertEqual(self.client.delete(f"/api/cards/{legacy_id}").status_code, 403)

    def test_public_cross_owner_references_and_bundle_failure_are_atomic(self):
        card = cards.create_card({"name": "Bob 的卡"}, owner_user_id=self.bob["id"])
        worldbook = worldbooks.create_worldbook({"title": "Bob 世界"}, owner_user_id=self.bob["id"])
        self.as_user(self.alice)
        created = self.client.post(
            "/api/works",
            json={"title": "Alice 作品", "card_ids": [card["id"]], "worldbook_id": worldbook["id"]},
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["owner_username"], "alice")
        self.assertEqual(created.json()["cards"][0]["owner_username"], "bob")

        before = works.list_works()["total"]
        with self.assertRaisesRegex(ValueError, "角色卡不存在"):
            work_bundles.save_work_bundle(
                {"title": "不会保留", "card_ids": [99999]},
                {"title": "不会保留", "entries": []},
                owner_user_id=self.alice["id"],
            )
        self.assertEqual(works.list_works()["total"], before)

    def test_referenced_card_and_worldbook_return_safe_resource_in_use_details(self):
        card = cards.create_card({"name": "卡"}, owner_user_id=self.alice["id"])
        worldbook = worldbooks.create_worldbook({"title": "书"}, owner_user_id=self.alice["id"])
        work = works.create_work(
            {"title": "引用作品", "card_id": card["id"], "worldbook_id": worldbook["id"]},
            owner_user_id=self.alice["id"],
        )
        self.as_user(self.alice)
        card_conflict = self.client.delete(f"/api/cards/{card['id']}")
        worldbook_conflict = self.client.delete(f"/api/worldbooks/{worldbook['id']}")
        for response in (card_conflict, worldbook_conflict):
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (409, "resource_in_use"))
            self.assertEqual(response.json()["error"]["works"], [{"id": work["id"], "title": "引用作品"}])


if __name__ == "__main__":
    unittest.main()
