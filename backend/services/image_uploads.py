"""Validated local image storage for user-owned visual assets."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from ..config import DATA_DIR

MAX_IMAGE_BYTES = 5 * 1024 * 1024
UPLOAD_DIR = DATA_DIR / "uploads"


class ImageUploadError(ValueError):
    """Raised when an uploaded image cannot be stored safely."""


def image_extension(data: bytes) -> str:
    """Identify an allowed raster image from its binary signature."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    raise ImageUploadError("仅支持 PNG、JPEG、WebP 或 GIF 图片")


def store_image(data: bytes, *, user_id: int, upload_dir: Path = UPLOAD_DIR) -> str:
    """Persist one validated image and return its same-origin public URL."""
    if not data:
        raise ImageUploadError("图片文件不能为空")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageUploadError("图片文件不能超过 5MB")

    extension = image_extension(data)
    user_dir = Path(upload_dir) / str(int(user_id))
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{extension}"
    target = user_dir / filename
    temporary = user_dir / f".{uuid.uuid4().hex}.upload"
    try:
        with temporary.open("xb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return f"/uploads/{int(user_id)}/{filename}"
