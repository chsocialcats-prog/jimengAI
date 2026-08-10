import unittest

from backend.schemas import WorkCreate, WorkUpdate


class WorkCoverTests(unittest.TestCase):
    def test_work_models_accept_cover_url(self):
        self.assertEqual(WorkCreate(title="封面测试", cover_url="/uploads/cover.png").cover_url, "/uploads/cover.png")
        self.assertEqual(WorkUpdate(cover_url="https://example.com/cover.jpg").cover_url, "https://example.com/cover.jpg")


if __name__ == "__main__":
    unittest.main()
