# -*- coding: utf-8 -*-
"""世界书与条目 CRUD 接口。"""

from fastapi import APIRouter, Query

from .. import repositories
from ..schemas import (
    WorldbookCreate,
    WorldbookEntryCreate,
    WorldbookEntryUpdate,
    WorldbookUpdate,
)
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_error,
)

router = APIRouter(prefix="/api/worldbooks", tags=["世界书"])


def _get_worldbook_or_404(worldbook_id):
    worldbook = repositories.get_worldbook(worldbook_id)
    if worldbook is None:
        _raise_not_found("世界书不存在")
    return worldbook


def _get_entry_or_404(entry_id, worldbook_id):
    entry = repositories.get_worldbook_entry(entry_id)
    if entry is None or entry["worldbook_id"] != worldbook_id:
        _raise_not_found("世界书条目不存在")
    return entry


@router.get("", summary="世界书列表")
def list_worldbooks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    return repositories.list_worldbooks(page=page, page_size=page_size)


@router.post("", status_code=201, summary="创建世界书")
def create_worldbook(payload: WorldbookCreate):
    data = payload.model_dump()
    if not data.get("title", "").strip():
        _raise_validation_error("世界书标题不能为空")
    return repositories.create_worldbook(data)


@router.get("/{worldbook_id}", summary="世界书详情")
def get_worldbook(worldbook_id: int):
    return _get_worldbook_or_404(worldbook_id)


@router.put("/{worldbook_id}", summary="更新世界书")
def update_worldbook(worldbook_id: int, payload: WorldbookUpdate):
    _get_worldbook_or_404(worldbook_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("title") is not None and not data["title"].strip():
        _raise_validation_error("世界书标题不能为空")
    return repositories.update_worldbook(worldbook_id, data)


@router.delete("/{worldbook_id}", status_code=204, summary="删除世界书")
def delete_worldbook(worldbook_id: int):
    _get_worldbook_or_404(worldbook_id)
    repositories.delete_worldbook(worldbook_id)


@router.get("/{worldbook_id}/entries", summary="世界书条目列表")
def list_entries(
    worldbook_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    _get_worldbook_or_404(worldbook_id)
    return repositories.list_worldbook_entries(
        worldbook_id, page=page, page_size=page_size
    )


@router.post(
    "/{worldbook_id}/entries",
    status_code=201,
    summary="新增世界书条目",
)
def create_entry(worldbook_id: int, payload: WorldbookEntryCreate):
    _get_worldbook_or_404(worldbook_id)
    data = payload.model_dump()
    if not data.get("title", "").strip():
        _raise_validation_error("条目标题不能为空")
    return repositories.create_worldbook_entry(worldbook_id, data)


@router.put(
    "/{worldbook_id}/entries/{entry_id}",
    summary="更新世界书条目",
)
def update_entry(
    worldbook_id: int,
    entry_id: int,
    payload: WorldbookEntryUpdate,
):
    _get_entry_or_404(entry_id, worldbook_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    if data.get("title") is not None and not data["title"].strip():
        _raise_validation_error("条目标题不能为空")
    return repositories.update_worldbook_entry(entry_id, data)


@router.delete(
    "/{worldbook_id}/entries/{entry_id}",
    status_code=204,
    summary="删除世界书条目",
)
def delete_entry(worldbook_id: int, entry_id: int):
    _get_entry_or_404(entry_id, worldbook_id)
    repositories.delete_worldbook_entry(entry_id)
