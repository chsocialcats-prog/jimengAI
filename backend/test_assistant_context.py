"""Read-only context construction for the web assistant."""

from contextlib import closing
import json
from unittest.mock import patch

from backend import database
from backend.services import assistant_context
from backend.test_helpers import IsolatedDatabaseTestCase
from backend.test_support.accounts import create_test_user


class AssistantContextTests(IsolatedDatabaseTestCase):
    def _create_work(self, user_id: int, title: str, description: str) -> int:
        with closing(database.connect()) as connection:
            work_id = connection.execute(
                """INSERT INTO works (owner_user_id, title, description, tags, opening)
                VALUES (?, ?, ?, ?, ?)""",
                (user_id, title, description, '["测试"]', "这是开场剧情。"),
            ).lastrowid
            connection.commit()
        return work_id

    def test_context_is_account_scoped_and_uses_only_read_paths(self):
        own_work_id = self._create_work(self.test_user.id, "我的剧本", "当前账号的资料")
        with closing(database.connect()) as connection:
            other_user = create_test_user(connection, username="context-other")
            connection.commit()
        self._create_work(other_user["id"], "他人的私有剧本", "不应进入上下文")

        with patch.object(assistant_context.database, "execute", side_effect=AssertionError("只读上下文不能写入")):
            context = assistant_context.build_read_only_context(
                self.test_user.id,
                f"/work?work={own_work_id}",
            )

        rendered = json.dumps(context, ensure_ascii=False)
        self.assertEqual(context["mode"], "read_only")
        self.assertEqual(context["page"], f"/work?work={own_work_id}")
        self.assertEqual(context["current"]["kind"], "work")
        self.assertEqual(context["current"]["title"], "我的剧本")
        self.assertEqual(context["catalog"]["work_count"], 2)
        self.assertEqual([work["title"] for work in context["owned"]["works"]], ["我的剧本"])
        self.assertNotIn("他人的私有剧本", rendered)

    def test_foreign_conversation_and_external_page_path_do_not_become_focus(self):
        with closing(database.connect()) as connection:
            other_user = create_test_user(connection, username="conversation-other")
            conversation_id = connection.execute(
                "INSERT INTO conversations (user_id, title) VALUES (?, ?)",
                (other_user["id"], "他人的会话"),
            ).lastrowid
            connection.commit()

        foreign_context = assistant_context.build_read_only_context(
            self.test_user.id,
            f"/adventure?conversation={conversation_id}",
        )
        external_context = assistant_context.build_read_only_context(
            self.test_user.id,
            "https://example.test/work?work=1",
        )

        self.assertEqual(foreign_context["current"]["kind"], "page")
        self.assertEqual(external_context["page"], "/")
