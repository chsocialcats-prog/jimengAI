# -*- coding: utf-8 -*-
"""作品 CRUD 接口。"""

from fastapi import APIRouter, Depends, HTTPException, Query

from ..repository import cards as card_repository
from ..repository import work_bundles, works
from ..repository import worldbooks as worldbook_repository
from ..auth.dependencies import optional_user, require_user
from ..schemas import WorkBundleCreate, WorkBundleUpdate, WorkCreate, WorkUpdate
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_error,
    _raise_validation_from_value_error,
)

router = APIRouter(prefix="/api/works", tags=["作品"])


def _get_work_or_404(work_id, viewer=None):
    work = works.get_work(work_id, viewer_user_id=viewer.id if viewer else None)
    if work is None:
        _raise_not_found("作品不存在")
    return work


def _validate_references(data, *, for_update=False):
    try:
        card_ids = works.normalize_card_ids(data, for_update=for_update)
    except (TypeError, ValueError) as exc:
        _raise_validation_from_value_error(exc, chain=False)
    if card_ids is not None:
        data["card_ids"] = card_ids
        for card_id in card_ids:
            if card_repository.get_card(card_id) is None:
                _raise_validation_error("角色卡不存在")
    if (
        data.get("worldbook_id") is not None
        and worldbook_repository.get_worldbook(data["worldbook_id"]) is None
    ):
        _raise_validation_error("世界书不存在")


def _validate_work_title(data, *, required=False):
    title = data.get("title")
    if (required and title is None) or (title is not None and not title.strip()):
        _raise_validation_error("作品标题不能为空")


@router.get("", summary="作品列表")
def list_works(
    q: str = "",
    tag: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    viewer=Depends(optional_user),
):
    """支持标题搜索与标签过滤。"""
    return works.list_works(q=q, tag=tag, page=page, page_size=page_size, viewer_user_id=viewer.id if viewer else None)


@router.post("", status_code=201, summary="创建作品")
def create_work(payload: WorkCreate, user=Depends(require_user)):
    data = payload.model_dump(exclude_none=True)
    _validate_work_title(data, required=True)
    _validate_references(data)
    return works.create_work(data, owner_user_id=user.id)


@router.post("/bundle", status_code=201, summary="事务化创建作品与世界书")
def create_work_bundle(payload: WorkBundleCreate, user=Depends(require_user)):
    work_data = payload.work.model_dump(exclude_none=True)
    worldbook_data = payload.worldbook.model_dump()
    _validate_work_title(work_data, required=True)
    work_data.pop("worldbook_id", None)
    _validate_references(work_data)
    try:
        return work_bundles.save_work_bundle(work_data, worldbook_data, owner_user_id=user.id)
    except ValueError as exc:
        _raise_validation_from_value_error(exc, chain=False)


@router.get("/{work_id}", summary="作品详情")
def get_work(work_id: int, viewer=Depends(optional_user)):
    return _get_work_or_404(work_id, viewer)


@router.put("/{work_id}", summary="更新作品")
def update_work(work_id: int, payload: WorkUpdate, user=Depends(require_user)):
    work = _get_work_or_404(work_id, user)
    if not work["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该作品"})
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    _validate_work_title(data)
    _validate_references(data, for_update=True)
    return works.update_work(work_id, data, owner_user_id=user.id)


@router.put("/{work_id}/bundle", summary="事务化更新作品与世界书")
def update_work_bundle(work_id: int, payload: WorkBundleUpdate, user=Depends(require_user)):
    work = _get_work_or_404(work_id, user)
    if not work["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该作品"})
    work_data = payload.work.model_dump(exclude_unset=True)
    worldbook_data = payload.worldbook.model_dump()
    _validate_work_title(work_data)
    work_data.pop("worldbook_id", None)
    _validate_references(work_data, for_update=True)
    try:
        result = work_bundles.save_work_bundle(work_data, worldbook_data, work_id=work_id, owner_user_id=user.id)
    except work_bundles.BundleOwnershipError:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该世界书"})
    except ValueError as exc:
        _raise_validation_from_value_error(exc, chain=False)
    if result is None:
        return _get_work_or_404(work_id, user)
    return result


@router.delete("/{work_id}", status_code=204, summary="删除作品")
def delete_work(work_id: int, user=Depends(require_user)):
    work = _get_work_or_404(work_id, user)
    if not work["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权删除该作品"})
    works.delete_work(work_id, owner_user_id=user.id)
