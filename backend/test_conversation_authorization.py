# -*- coding: utf-8 -*-
"""Two-account conversation ownership integration tests."""

from contextlib import closing
import unittest

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend import database
from backend.auth.types import AuthContext, PublicUser
from backend.repository import conversation_repository
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class ConversationAuthorizationTests(IsolatedDatabaseTestCase):
    def setUp(self):
        super().setUp()
        with closing(database.connect()) as connection:
            self.owner = create_test_user(connection, "owner")
            self.other = create_test_user(connection, "other")
            work_id = connection.execute(
                "INSERT INTO works (owner_user_id, title) VALUES (?, ?)",
                (self.owner["id"], "public work"),
            ).lastrowid
            connection.commit()
        self.conversation = conversation_repository.create_conversation(
            work_id, "owner story", self.owner["id"]
        )

    def _access(self):
        return conversation_repository.require_conversation_owner(
            self.conversation["id"],
            AuthContext(
                user=PublicUser(
                    id=self.owner["id"],
                    username=self.owner["username"],
                    created_at=self.owner["created_at"],
                ),
                session_id=1,
            ),
        )

    def test_other_user_cannot_read_or_mutate_owner_conversation(self):
        conversation_id = self.conversation["id"]

        self.assertIsNone(
            conversation_repository.get_conversation(conversation_id, self.other["id"])
        )
        self.assertEqual(
            conversation_repository.get_messages(conversation_id, self.other["id"]), []
        )
        self.assertIsNone(
            conversation_repository.update_conversation(
                conversation_id, self.other["id"], {"title": "stolen"}
            )
        )
        self.assertIsNotNone(
            conversation_repository.get_conversation(conversation_id, self.owner["id"])
        )

    def test_archive_status_is_scoped_to_the_owner(self):
        conversation_id = self.conversation["id"]

        self.assertIsNone(
            conversation_repository.set_conversation_status(
                conversation_id, self.other["id"], "archived"
            )
        )
        archived = conversation_repository.set_conversation_status(
            conversation_id, self.owner["id"], "archived"
        )
        self.assertEqual(archived["status"], "archived")
        restored = conversation_repository.set_conversation_status(
            conversation_id, self.owner["id"], "active"
        )
        self.assertEqual(restored["status"], "active")

    def test_branch_copies_private_head_for_current_owner_only(self):
        conversation_id = self.conversation["id"]
        conversation_repository.create_message(
            conversation_id, self.owner["id"], "user", "private turn"
        )
        conversation_repository.save_state(
            conversation_id, self.owner["id"], {"money": 7}
        )
        conversation_repository.save_memory_summary(
            conversation_id, self.owner["id"], "private memory", 1
        )
        branch = conversation_repository.create_conversation_branch(
            conversation_id, self.owner["id"], "branch", "choice"
        )

        self.assertEqual(branch["user_id"], self.owner["id"])
        self.assertEqual(branch["parent_conversation_id"], conversation_id)
        self.assertEqual(
            conversation_repository.get_messages(branch["id"], self.owner["id"])[-1]["content"],
            "private turn",
        )
        self.assertEqual(
            conversation_repository.get_state(branch["id"], self.owner["id"])["money"], 7)
        self.assertEqual(
            conversation_repository.get_memory_summary(branch["id"], self.owner["id"]),
            "private memory",
        )

    def test_state_roll_and_command_services_require_owner_access(self):
        from backend.services import commands, roll_service, state_service

        access = self._access()
        self.assertEqual(
            state_service.update_state(access, {"money": 11})["money"], 11
        )
        message = roll_service.record_roll(access, dice="1d2")
        self.assertEqual(message["conversation_id"], self.conversation["id"])
        command = commands.handle_command(access, "/status")
        self.assertIn("当前状态", command["content"])

    def test_anonymous_private_routes_return_authentication_required(self):
        from backend.routers.conversations_routes import router

        app = FastAPI()

        @app.exception_handler(HTTPException)
        async def errors(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

        class AnonymousAuth:
            @staticmethod
            def authenticate(token):
                return None

        app.state.auth_service = AnonymousAuth()
        app.include_router(router)
        client = TestClient(app)
        try:
            for method, path, kwargs in (
                ("get", "/api/conversations", {}),
                ("get", f"/api/conversations/{self.conversation['id']}", {}),
                ("post", "/api/conversations", {"json": {"work_id": 1}}),
                ("post", f"/api/conversations/{self.conversation['id']}/onboarding", {"json": {}}),
            ):
                response = getattr(client, method)(path, **kwargs)
                self.assertEqual(
                    (response.status_code, response.json()["error"]["code"]),
                    (401, "authentication_required"),
                )
        finally:
            client.close()


if __name__ == "__main__":
    unittest.main()
