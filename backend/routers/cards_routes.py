# -*- coding: utf-8 -*-
"""角色卡 CRUD 接口。"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repository import cards as card_repository
from ..auth.dependencies import optional_user, require_user
from ..schemas import CardCreate, CardUpdate
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
