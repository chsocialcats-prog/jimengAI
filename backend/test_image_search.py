import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.routers import cards_routes
from backend.schemas import CardImageSearch
from backend.services.image_search import (
    ImageSearchError,
    SearchImageFetchError,
    build_character_query,
    fetch_search_thumbnail,
    search_character_images,
)
from backend.test_helpers import IsolatedDatabaseTestCase


class _Response:
    def __init__(self, body):
        self.body = body

    def read(self, _size):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class ImageSearchServiceTests(unittest.TestCase):
    def test_query_uses_only_the_cleaned_character_name(self):
        query = build_character_query("  草薙素子  ")

        self.assertEqual(query, "草薙素子")

    def test_parses_secure_candidates_and_omits_invalid_or_duplicate_urls(self):
        response = b'''{
          "output": [{
            "type": "web_search_image_call",
            "output": "[{\\"title\\": \\"Major Kusanagi\\", \\"url\\": \\"https://cdn.example/major.png\\"}, {\\"title\\": \\"Duplicate\\", \\"url\\": \\"https://cdn.example/major.png\\"}, {\\"title\\": \\"Insecure\\", \\"url\\": \\"http://cdn.example/insecure.png\\"}]"
          }]
        }'''

        with patch.dict("os.environ", {"DASHSCOPE_API_KEY": "test-key", "DASHSCOPE_WORKSPACE_ID": "workspace-a"}, clear=True), patch("backend.services.image_search.urllib.request.urlopen", return_value=_Response(response)) as open_url:
            result = search_character_images("草薙素子")

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["image_url"], "https://cdn.example/major.png")
        self.assertEqual(result["items"][0]["source"], "cdn.example")
        requested_url = open_url.call_args.args[0].full_url
        self.assertEqual(requested_url, "https://workspace-a.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses")
        request_body = open_url.call_args.args[0].data.decode("utf-8")
        self.assertIn('"web_search_image"', request_body)
        self.assertIn("草薙素子", request_body)

    def test_search_requires_model_studio_credentials(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ImageSearchError, "DASHSCOPE_API_KEY"):
                search_character_images("草薙素子")

    def test_thumbnail_fetch_only_allows_bing_thumbnail_hosts_and_validates_image_bytes(self):
        image = b"\x89PNG\r\n\x1a\nimage"
        opener = unittest.mock.MagicMock()
        opener.open.return_value = _Response(image)

        with patch("backend.services.image_search.urllib.request.build_opener", return_value=opener):
            data, extension = fetch_search_thumbnail("https://ts2.mm.bing.net/th?id=OIP.example")

        self.assertEqual(data, image)
        self.assertEqual(extension, "png")
        with self.assertRaises(SearchImageFetchError):
            fetch_search_thumbnail("https://example.com/image.png")


class ImageSearchRouteTests(IsolatedDatabaseTestCase):
    def test_authenticated_search_returns_candidates(self):
        payload = CardImageSearch(name="草薙素子")
        response = {"query": "草薙素子", "items": [{"image_url": "https://example.com/major.png"}]}

        with patch("backend.routers.cards_routes.search_character_images", return_value=response) as search:
            self.assertEqual(cards_routes.search_card_images(payload, user=self.test_user), response)

        search.assert_called_once_with("草薙素子")

    def test_search_provider_failure_is_a_clear_gateway_error(self):
        with patch("backend.routers.cards_routes.search_character_images", side_effect=ImageSearchError("暂不可用")):
            with self.assertRaises(HTTPException) as context:
                cards_routes.search_card_images(CardImageSearch(name="草薙素子"), user=self.test_user)

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(context.exception.detail["code"], "image_search_unavailable")

    def test_bulk_fill_updates_only_avatarless_owned_cards(self):
        cards = [
            {"id": 3, "name": "草薙素子"},
            {"id": 4, "name": "巴特"},
        ]
        with patch.object(cards_routes.card_repository, "list_owned_cards_without_avatar", return_value=cards), patch.object(cards_routes, "search_character_images", side_effect=[
            {"items": [{"image_url": "https://images.example/major.jpg"}]},
            {"items": []},
        ]), patch.object(cards_routes.card_repository, "update_card") as update_card:
            result = cards_routes.fill_missing_card_images(user=self.test_user)

        self.assertEqual(result["updated"], [{"id": 3, "name": "草薙素子", "image_url": "https://images.example/major.jpg"}])
        self.assertEqual(result["failed"], [{"id": 4, "name": "巴特", "error": "没有找到可用图片"}])
        update_card.assert_called_once_with(3, {"avatar_url": "https://images.example/major.jpg"}, owner_user_id=self.test_user.id)


if __name__ == "__main__":
    unittest.main()
