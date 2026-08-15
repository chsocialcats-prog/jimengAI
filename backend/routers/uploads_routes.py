"""Authenticated upload endpoints for local raster images."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response

from ..auth.dependencies import require_user
from ..schemas import SearchImageFetch
from ..services.image_search import (
    ImageSearchError,
    SearchImageFetchError,
    fetch_search_thumbnail,
)
from ..services.image_uploads import ImageUploadError, MAX_IMAGE_BYTES, store_image

router = APIRouter(prefix="/api/uploads", tags=["上传"])

IMAGE_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
}


async def _read_image_body(request: Request) -> bytes:
    """Read a request incrementally so oversized uploads are rejected early."""
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise ImageUploadError("图片文件不能超过 5MB")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/images", status_code=status.HTTP_201_CREATED, summary="上传图片")
async def upload_image(request: Request, user=Depends(require_user)):
    """Store a raster image and return a stable local URL for resource records."""
    try:
        url = store_image(await _read_image_body(request), user_id=user.id)
    except ImageUploadError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_image", "message": str(exc)},
        ) from exc
    return {"url": url}


@router.post("/search-image", summary="读取在线候选图以便裁剪")
def load_search_image(payload: SearchImageFetch, user=Depends(require_user)):
    """Return one allowlisted thumbnail so the browser can crop it locally."""
    try:
        data, extension = fetch_search_thumbnail(payload.url)
    except SearchImageFetchError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_search_image", "message": str(exc)},
        ) from exc
    except ImageSearchError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "search_image_unavailable", "message": str(exc)},
        ) from exc
    return Response(content=data, media_type=IMAGE_MEDIA_TYPES[extension])
