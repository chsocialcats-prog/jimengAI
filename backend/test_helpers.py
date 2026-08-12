import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import database


class IsolatedDatabaseTestCase(unittest.TestCase):
    initialize_database = True

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "test.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()
        if self.initialize_database:
            database.init_db()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()
