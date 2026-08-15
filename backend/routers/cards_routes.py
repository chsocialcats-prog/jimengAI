# -*- coding: utf-8 -*-
"""角色卡 CRUD 接口。"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repository import cards as card_repository
from ..auth.dependencies import optional_user, require_user
from ..schemas import CardCreate, CardImageSearch, CardUpdate
from ..services.image_search import ImageSearchError, search_character_images
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_error,
)

router = APIRouter(prefix="/api/cards", tags=["角色卡"])


def _get_card_or_404(card_id, viewer=None):
    card = card_repository.get_card(card_id, viewer_user_id=viewer.id if viewer else None)
    if card is None:
        _raise_not_found("角色卡不存在")
    return card


@router.get("", summary="角色卡列表")
def list_cards(
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    viewer=Depends(optional_user),
):
    """按名称、人设或性格搜索角色卡。"""
    return card_repository.list_cards(q=q, page=page, page_size=page_size, viewer_user_id=viewer.id if viewer else None)


@router.post("", status_code=201, summary="创建角色卡")
def create_card(payload: CardCreate, user=Depends(require_user)):
    data = payload.model_dump()
    if not data.get("name", "").strip():
        _raise_validation_error("角色名不能为空")
    return card_repository.create_card(data, owner_user_id=user.id)


@router.post("/image-candidates", summary="搜索角色卡在线候选图")
def search_card_images(payload: CardImageSearch, user=Depends(require_user)):
    """Search Model Studio's web-image tool without exposing its credentials."""
    try:
        return search_character_images(payload.name)
    except ImageSearchError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "image_search_unavailable", "message": str(exc)},
        ) from exc


@router.post("/fill-missing-images", summary="为未配图角色卡批量补图")
def fill_missing_card_images(user=Depends(require_user)):
    """Apply the first safe Model Studio result to each avatarless owned card."""
    updated = []
    failed = []
    for card in card_repository.list_owned_cards_without_avatar(user.id):
        try:
            result = search_character_images(card["name"])
        except ImageSearchError as exc:
            failed.append({"id": card["id"], "name": card["name"], "error": str(exc)})
            continue
        items = result.get("items")
        if not isinstance(items, list) or not items or not isinstance(items[0], dict):
            failed.append({"id": card["id"], "name": card["name"], "error": "没有找到可用图片"})
            continue
        image_url = items[0].get("image_url")
        if not isinstance(image_url, str) or not image_url:
            failed.append({"id": card["id"], "name": card["name"], "error": "图片地址无效"})
            continue
        card_repository.update_card(card["id"], {"avatar_url": image_url}, owner_user_id=user.id)
        updated.append({"id": card["id"], "name": card["name"], "image_url": image_url})
    return {"updated": updated, "failed": failed}


@router.get("/{card_id}", summary="角色卡详情")
def get_card(card_id: int, viewer=Depends(optional_user)):
    return _get_card_or_404(card_id, viewer)


@router.put("/{card_id}", summary="更新角色卡")
def update_card(card_id: int, payload: CardUpdate, user=Depends(require_user)):
    card = _get_card_or_404(card_id, user)
    if not card["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该角色卡"})
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("name") is not None and not data["name"].strip():
        _raise_validation_error("角色名不能为空")
    return card_repository.update_card(card_id, data, owner_user_id=user.id)


@router.delete("/{card_id}", status_code=204, summary="删除角色卡")
def delete_card(card_id: int, user=Depends(require_user)):
    card = _get_card_or_404(card_id, user)
    if not card["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权删除该角色卡"})
    try:
        card_repository.delete_card(card_id, owner_user_id=user.id)
    except card_repository.CardReferenceConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "resource_in_use",
                "message": "角色卡正在被剧本引用",
                "works": exc.works,
            },
        )
