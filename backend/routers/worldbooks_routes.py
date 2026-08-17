# -*- coding: utf-8 -*-
"""世界书与条目 CRUD 接口。"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..repository import worldbooks as worldbook_repository
from ..auth.dependencies import optional_user, require_user
from ..schemas import (
    WorldbookCreate,
    WorldbookEntryCreate,
    WorldbookEntryUpdate,
    WorldbookUpdate,
)
from ..services.sillytavern import export_worldbook_document
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_error,
)

router = APIRouter(prefix="/api/worldbooks", tags=["世界书"])


def _get_worldbook_or_404(worldbook_id, viewer=None):
    worldbook = worldbook_repository.get_worldbook(worldbook_id, viewer_user_id=viewer.id if viewer else None)
    if worldbook is None:
        _raise_not_found("世界书不存在")
    return worldbook


def _get_entry_or_404(entry_id, worldbook_id, viewer=None):
    entry = worldbook_repository.get_worldbook_entry(entry_id, viewer_user_id=viewer.id if viewer else None)
    if entry is None or entry["worldbook_id"] != worldbook_id:
        _raise_not_found("世界书条目不存在")
    return entry


@router.get("", summary="世界书列表")
def list_worldbooks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    viewer=Depends(optional_user),
):
    return worldbook_repository.list_worldbooks(page=page, page_size=page_size, viewer_user_id=viewer.id if viewer else None)


@router.post("", status_code=201, summary="创建世界书")
def create_worldbook(payload: WorldbookCreate, user=Depends(require_user)):
    data = payload.model_dump()
    if not data.get("title", "").strip():
        _raise_validation_error("世界书标题不能为空")
    return worldbook_repository.create_worldbook(data, owner_user_id=user.id)


@router.get("/{worldbook_id}/exports/sillytavern", summary="导出 SillyTavern 世界书")
def export_sillytavern_worldbook(worldbook_id: int, user=Depends(require_user)):
    worldbook = _get_worldbook_or_404(worldbook_id, user)
    if not worldbook["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权导出该世界书"})
    document = export_worldbook_document(worldbook)
    return Response(
        content=json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8"),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=worldbook.json"},
    )


@router.get("/{worldbook_id}", summary="世界书详情")
def get_worldbook(worldbook_id: int, viewer=Depends(optional_user)):
    return _get_worldbook_or_404(worldbook_id, viewer)


@router.put("/{worldbook_id}", summary="更新世界书")
def update_worldbook(worldbook_id: int, payload: WorldbookUpdate, user=Depends(require_user)):
    worldbook = _get_worldbook_or_404(worldbook_id, user)
    if not worldbook["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该世界书"})
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("title") is not None and not data["title"].strip():
        _raise_validation_error("世界书标题不能为空")
    return worldbook_repository.update_worldbook(worldbook_id, data, owner_user_id=user.id)


@router.delete("/{worldbook_id}", status_code=204, summary="删除世界书")
def delete_worldbook(worldbook_id: int, user=Depends(require_user)):
    worldbook = _get_worldbook_or_404(worldbook_id, user)
    if not worldbook["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权删除该世界书"})
    try:
        worldbook_repository.delete_worldbook(worldbook_id, owner_user_id=user.id)
    except worldbook_repository.WorldbookReferenceConflict as exc:
        raise HTTPException(409, {"code": "resource_in_use", "message": "世界书正在被作品引用", "works": exc.works})


@router.get("/{worldbook_id}/entries", summary="世界书条目列表")
def list_entries(
    worldbook_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    viewer=Depends(optional_user),
):
    _get_worldbook_or_404(worldbook_id, viewer)
    return worldbook_repository.list_worldbook_entries(
        worldbook_id, page=page, page_size=page_size, viewer_user_id=viewer.id if viewer else None
    )


@router.post(
    "/{worldbook_id}/entries",
    status_code=201,
    summary="新增世界书条目",
)
def create_entry(worldbook_id: int, payload: WorldbookEntryCreate, user=Depends(require_user)):
    worldbook = _get_worldbook_or_404(worldbook_id, user)
    if not worldbook["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该世界书"})
    data = payload.model_dump()
    if not data.get("title", "").strip():
        _raise_validation_error("条目标题不能为空")
    if data.get("parent_entry_id") is not None:
        _get_entry_or_404(data["parent_entry_id"], worldbook_id, user)
    return worldbook_repository.create_worldbook_entry(worldbook_id, data, owner_user_id=user.id)


@router.put(
    "/{worldbook_id}/entries/{entry_id}",
    summary="更新世界书条目",
)
def update_entry(
    worldbook_id: int,
    entry_id: int,
    payload: WorldbookEntryUpdate, user=Depends(require_user),
):
    entry = _get_entry_or_404(entry_id, worldbook_id, user)
    if not entry["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权修改该世界书"})
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("title") is not None and not data["title"].strip():
        _raise_validation_error("条目标题不能为空")
    parent_entry_id = data.get("parent_entry_id")
    if parent_entry_id is not None:
        if parent_entry_id == entry_id:
            _raise_validation_error("条目不能作为自己的父条目")
        _get_entry_or_404(parent_entry_id, worldbook_id, user)
    return worldbook_repository.update_worldbook_entry(entry_id, data, owner_user_id=user.id)


@router.delete(
    "/{worldbook_id}/entries/{entry_id}",
    status_code=204,
    summary="删除世界书条目",
)
def delete_entry(worldbook_id: int, entry_id: int, user=Depends(require_user)):
    entry = _get_entry_or_404(entry_id, worldbook_id, user)
    if not entry["can_edit"]:
        raise HTTPException(403, {"code": "forbidden", "message": "无权删除该世界书"})
    worldbook_repository.delete_worldbook_entry(entry_id, owner_user_id=user.id)
