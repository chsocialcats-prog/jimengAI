# -*- coding: utf-8 -*-
"""作品 CRUD 接口。"""

from fastapi import APIRouter, HTTPException, Query

from .. import repositories
from ..schemas import WorkCreate, WorkUpdate

router = APIRouter(prefix="/api/works", tags=["作品"])


def _get_work_or_404(work_id):
    work = repositories.get_work(work_id)
    if work is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "作品不存在"},
        )
    return work


def _validate_references(data, *, for_update=False):
    try:
        card_ids = repositories.normalize_card_ids(data, for_update=for_update)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": str(exc)},
        )
    if card_ids is not None:
        data["card_ids"] = card_ids
        for card_id in card_ids:
            if repositories.get_card(card_id) is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "validation_error", "message": "角色卡不存在"},
                )
    if (
        data.get("worldbook_id") is not None
        and repositories.get_worldbook(data["worldbook_id"]) is None
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "世界书不存在"},
        )


@router.get("", summary="作品列表")
def list_works(
    q: str = "",
    tag: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """支持标题搜索与标签过滤。"""
    return repositories.list_works(q=q, tag=tag, page=page, page_size=page_size)


@router.post("", status_code=201, summary="创建作品")
def create_work(payload: WorkCreate):
    data = payload.model_dump(exclude_none=True)
    if not data.get("title", "").strip():
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "作品标题不能为空"},
        )
    _validate_references(data)
    return repositories.create_work(data)


@router.get("/{work_id}", summary="作品详情")
def get_work(work_id: int):
    return _get_work_or_404(work_id)


@router.put("/{work_id}", summary="更新作品")
def update_work(work_id: int, payload: WorkUpdate):
    _get_work_or_404(work_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "没有可更新的字段"},
        )
    if data.get("title") is not None and not data["title"].strip():
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "作品标题不能为空"},
        )
    _validate_references(data, for_update=True)
    return repositories.update_work(work_id, data)


@router.delete("/{work_id}", status_code=204, summary="删除作品")
def delete_work(work_id: int):
    _get_work_or_404(work_id)
    repositories.delete_work(work_id)
