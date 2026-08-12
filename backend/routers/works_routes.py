# -*- coding: utf-8 -*-
"""作品 CRUD 接口。"""

from fastapi import APIRouter, HTTPException, Query

from .. import repositories
from ..schemas import WorkBundleCreate, WorkBundleUpdate, WorkCreate, WorkUpdate

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


def _validate_work_title(data, *, required=False):
    title = data.get("title")
    if (required and title is None) or (title is not None and not title.strip()):
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "作品标题不能为空"},
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
    _validate_work_title(data, required=True)
    _validate_references(data)
    return repositories.create_work(data)


@router.post("/bundle", status_code=201, summary="事务化创建作品与世界书")
def create_work_bundle(payload: WorkBundleCreate):
    work_data = payload.work.model_dump(exclude_none=True)
    worldbook_data = payload.worldbook.model_dump()
    _validate_work_title(work_data, required=True)
    work_data.pop("worldbook_id", None)
    _validate_references(work_data)
    try:
        return repositories.save_work_bundle(work_data, worldbook_data)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": str(exc)},
        )


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
    _validate_work_title(data)
    _validate_references(data, for_update=True)
    return repositories.update_work(work_id, data)


@router.put("/{work_id}/bundle", summary="事务化更新作品与世界书")
def update_work_bundle(work_id: int, payload: WorkBundleUpdate):
    _get_work_or_404(work_id)
    work_data = payload.work.model_dump(exclude_unset=True)
    worldbook_data = payload.worldbook.model_dump()
    _validate_work_title(work_data)
    work_data.pop("worldbook_id", None)
    _validate_references(work_data, for_update=True)
    try:
        result = repositories.save_work_bundle(work_data, worldbook_data, work_id=work_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": str(exc)},
        )
    if result is None:
        return _get_work_or_404(work_id)
    return result


@router.delete("/{work_id}", status_code=204, summary="删除作品")
def delete_work(work_id: int):
    _get_work_or_404(work_id)
    repositories.delete_work(work_id)
