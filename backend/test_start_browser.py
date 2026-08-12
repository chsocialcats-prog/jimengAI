import unittest
from unittest.mock import patch

import start


class StartBrowserTests(unittest.TestCase):
    def test_open_browser_requests_a_new_browser_tab(self):
        with patch("start.time.sleep"), patch("start.webbrowser.open") as open_browser:
            start.open_browser("http://127.0.0.1:8000", 0)

        open_browser.assert_called_once_with("http://127.0.0.1:8000", new=2)


if __name__ == "__main__":
    unittest.main()
