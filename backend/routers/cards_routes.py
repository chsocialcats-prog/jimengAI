# -*- coding: utf-8 -*-
"""角色卡 CRUD 接口。"""

from fastapi import APIRouter, HTTPException, Query

from .. import repositories
from ..schemas import CardCreate, CardUpdate
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_error,
)

router = APIRouter(prefix="/api/cards", tags=["角色卡"])


def _get_card_or_404(card_id):
    card = repositories.get_card(card_id)
    if card is None:
        _raise_not_found("角色卡不存在")
    return card


@router.get("", summary="角色卡列表")
def list_cards(
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """按名称、人设或性格搜索角色卡。"""
    return repositories.list_cards(q=q, page=page, page_size=page_size)


@router.post("", status_code=201, summary="创建角色卡")
def create_card(payload: CardCreate):
    data = payload.model_dump()
    if not data.get("name", "").strip():
        _raise_validation_error("角色名不能为空")
    return repositories.create_card(data)


@router.get("/{card_id}", summary="角色卡详情")
def get_card(card_id: int):
    return _get_card_or_404(card_id)


@router.put("/{card_id}", summary="更新角色卡")
def update_card(card_id: int, payload: CardUpdate):
    _get_card_or_404(card_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("name") is not None and not data["name"].strip():
        _raise_validation_error("角色名不能为空")
    return repositories.update_card(card_id, data)


@router.delete("/{card_id}", status_code=204, summary="删除角色卡")
def delete_card(card_id: int):
    _get_card_or_404(card_id)
    try:
        repositories.delete_card(card_id)
    except repositories.CardReferenceConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "conflict",
                "message": "角色卡正在被剧本引用",
                "works": exc.works,
            },
        )
