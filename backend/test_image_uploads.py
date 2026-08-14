import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from backend.auth.dependencies import require_user
from backend.auth.types import PublicUser
from backend.routers.uploads_routes import router
from backend.services.image_uploads import (
    ImageUploadError,
    MAX_IMAGE_BYTES,
    image_extension,
    store_image,
)


class ImageUploadStorageTests(unittest.TestCase):
    def test_recognizes_allowed_raster_signatures(self):
        self.assertEqual(image_extension(b"\x89PNG\r\n\x1a\nimage"), "png")
        self.assertEqual(image_extension(b"\xff\xd8\xffimage"), "jpg")
        self.assertEqual(image_extension(b"GIF89aimage"), "gif")
        self.assertEqual(image_extension(b"RIFF\x00\x00\x00\x00WEBPimage"), "webp")

    def test_rejects_invalid_and_oversized_images(self):
        with self.assertRaises(ImageUploadError):
            image_extension(b"<svg></svg>")
        with self.assertRaisesRegex(ImageUploadError, "5MB"):
            store_image(b"\x89PNG\r\n\x1a\n" + b"x" * MAX_IMAGE_BYTES, user_id=7)

    def test_stores_under_the_owner_directory_with_a_public_url(self):
        image = b"\x89PNG\r\n\x1a\nimage"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            url = store_image(image, user_id=7, upload_dir=root)
            self.assertRegex(url, r"^/uploads/7/[0-9a-f]{32}\.png$")
            stored = root / url.removeprefix("/uploads/")
            self.assertEqual(stored.read_bytes(), image)


class ImageUploadRouteTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()

        @app.exception_handler(HTTPException)
        async def errors(request: Request, exc: HTTPException):
            return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

        app.include_router(router)
        app.dependency_overrides[require_user] = lambda: PublicUser(7, "alice", "now")
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_route_passes_the_image_body_and_authenticated_owner_to_storage(self):
        image = b"\x89PNG\r\n\x1a\nimage"
        with patch("backend.routers.uploads_routes.store_image", return_value="/uploads/7/image.png") as store:
            response = self.client.post("/api/uploads/images", content=image, headers={"Content-Type": "image/png"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"url": "/uploads/7/image.png"})
        store.assert_called_once_with(image, user_id=7)


if __name__ == "__main__":
    unittest.main()
