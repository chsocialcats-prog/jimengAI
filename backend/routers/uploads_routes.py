"""Authenticated upload endpoints for local raster images."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..auth.dependencies import require_user
from ..services.image_uploads import ImageUploadError, MAX_IMAGE_BYTES, store_image

router = APIRouter(prefix="/api/uploads", tags=["上传"])


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
