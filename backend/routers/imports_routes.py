# -*- coding: utf-8 -*-
"""Text and SillyTavern character-card import endpoints."""

from fastapi import APIRouter, Depends, Request

from ..repository import work_bundles
from ..auth.dependencies import require_user
from ..schemas import CardTextImport
from ..services.card_importer import parse_card_text
from ..services.image_uploads import ImageUploadError, MAX_IMAGE_BYTES, store_image
from ..services.sillytavern import (
    SillyTavernFormatError,
    is_png,
    parse_card_document,
    parse_worldbook_document,
    read_card_document,
    read_worldbook_document,
)
from ._error_helpers import _raise_validation_error

router = APIRouter(prefix="/api/imports", tags=["导入"])


@router.post("/card-text", status_code=201, summary="导入文本角色卡")
def import_card_text(payload: CardTextImport, user=Depends(require_user)):
    """把粘贴的文本卡解析并创建为作品、角色卡和世界书。"""
    if not payload.text.strip():
        _raise_validation_error("导入内容不能为空")
    parsed = parse_card_text(payload.text)
    return work_bundles.save_import_bundle(
        parsed["card"],
        parsed["worldbook"],
        parsed["worldbook_entries"],
        parsed["work"],
        owner_user_id=user.id,
    )


async def _read_interchange_body(request: Request) -> bytes:
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            _raise_validation_error("SillyTavern 导入文件不能超过 5MB")
        chunks.append(chunk)
    if not chunks:
        _raise_validation_error("导入文件不能为空")
    return b"".join(chunks)


@router.post("/sillytavern-card", status_code=201, summary="导入 SillyTavern V3 角色卡")
async def import_sillytavern_card(request: Request, user=Depends(require_user)):
    """Import a V3 JSON/PNG card and create a ready-to-play work for it."""
    raw = await _read_interchange_body(request)
    try:
        document, avatar_png = read_card_document(raw)
        parsed = parse_card_document(document)
        avatar_url = ""
        if avatar_png is not None:
            avatar_url = store_image(avatar_png, user_id=user.id)
        result = work_bundles.save_sillytavern_card_bundle(
            parsed["card"],
            parsed["worldbook"],
            parsed["work"],
            owner_user_id=user.id,
            avatar_url=avatar_url,
        )
    except (SillyTavernFormatError, ImageUploadError, ValueError) as exc:
        _raise_validation_error(str(exc))
    return {**result, "warnings": parsed["warnings"]}


@router.post("/sillytavern-worldbook", status_code=201, summary="导入 SillyTavern 世界书")
async def import_sillytavern_worldbook(request: Request, user=Depends(require_user)):
    """Import a standalone worldbook JSON or the embedded book from a V3 PNG card."""
    raw = await _read_interchange_body(request)
    try:
        if is_png(raw):
            document, _ = read_card_document(raw)
            source = document["data"].get("character_book")
            if not isinstance(source, dict):
                raise SillyTavernFormatError("该角色卡没有内嵌世界书")
        else:
            source = read_worldbook_document(raw)
        parsed = parse_worldbook_document(source)
        worldbook = work_bundles.save_sillytavern_worldbook(
            parsed, owner_user_id=user.id
        )
    except (SillyTavernFormatError, ValueError) as exc:
        _raise_validation_error(str(exc))
    return {"worldbook": worldbook, "warnings": parsed["warnings"]}
