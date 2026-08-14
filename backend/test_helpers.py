import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend import database
from backend.test_support.accounts import create_test_user
from backend.auth.types import AuthContext, ConversationAccess


class IsolatedDatabaseTestCase(unittest.TestCase):
    initialize_database = True

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        if self.initialize_database:
            database.init_db()
            with closing(database.connect()) as connection:
                self.test_account = create_test_user(connection)
                connection.commit()
            self.test_user = create_public_test_user(self.test_account)
            self.test_auth = AuthContext(self.test_user, session_id=1)
            self.owner_user_id = self.test_user.id
        else:
            self.test_account = None
            self.test_user = None
            self.test_auth = None
            self.owner_user_id = None

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def access_for(self, conversation):
        return conversation_access(conversation, self.test_user)


def create_public_test_user(account):
    """Return the explicit user object expected by direct route tests."""
    from backend.auth.types import PublicUser

    return PublicUser(account["id"], account["username"], account["created_at"])


def conversation_access(conversation, user):
    """Build an explicit scoped access object for service-layer tests."""
    return ConversationAccess(
        auth=AuthContext(user, session_id=1),
        conversation=conversation,
    )
