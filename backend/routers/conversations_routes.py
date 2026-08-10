# -*- coding: utf-8 -*-
"""冒险会话、状态、存档与显式判定接口。"""

from fastapi import APIRouter, HTTPException, Query

from .. import repositories
from ..schemas import (
    ConversationCreate,
    ConversationUpdate,
    OnboardingComplete,
    ConversationCorrection,
    RollRequest,
    SnapshotCreate,
    StateUpdate,
)
from ..services import roll_service, snapshot_service, state_service

router = APIRouter(prefix="/api/conversations", tags=["冒险会话"])


def _get_conversation_or_404(conversation_id):
    conversation = repositories.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "冒险会话不存在"},
        )
    return conversation


@router.get("", summary="会话列表")
def list_conversations(
    work_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    return repositories.list_conversations(
        work_id=work_id, page=page, page_size=page_size
    )


@router.post("", status_code=201, summary="创建会话")
def create_conversation(payload: ConversationCreate):
    conversation = repositories.create_conversation(
        payload.work_id, payload.title
    )
    if conversation is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "作品不存在"},
        )
    return conversation


@router.get("/{conversation_id}", summary="会话详情")
def get_conversation(conversation_id: int):
    return _get_conversation_or_404(conversation_id)


@router.put("/{conversation_id}", summary="更新会话")
def update_conversation(conversation_id: int, payload: ConversationUpdate):
    _get_conversation_or_404(conversation_id)
    return repositories.update_conversation(conversation_id, payload.model_dump())


@router.post("/{conversation_id}/onboarding", summary="完成开局引导")
def complete_onboarding(conversation_id: int, payload: OnboardingComplete):
    _get_conversation_or_404(conversation_id)
    try:
        return repositories.complete_conversation_onboarding(conversation_id, payload.answers)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(exc)}) from exc

@router.post("/{conversation_id}/corrections", summary="保存会话修正")
def add_correction(conversation_id: int, payload: ConversationCorrection):
    _get_conversation_or_404(conversation_id)
    try:
        return repositories.add_conversation_correction(conversation_id, payload.kind, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(exc)}) from exc


@router.delete("/{conversation_id}", status_code=204, summary="删除会话")
def delete_conversation(conversation_id: int):
    _get_conversation_or_404(conversation_id)
    repositories.delete_conversation(conversation_id)


@router.get("/{conversation_id}/messages", summary="读取对话历史")
def get_messages(conversation_id: int):
    _get_conversation_or_404(conversation_id)
    return repositories.get_messages(conversation_id)


@router.get("/{conversation_id}/state", summary="查询实时状态")
def get_state(conversation_id: int):
    _get_conversation_or_404(conversation_id)
    return state_service.get_state(conversation_id)


@router.put("/{conversation_id}/state", summary="更新实时状态")
def update_state(conversation_id: int, payload: StateUpdate):
    _get_conversation_or_404(conversation_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": "没有可更新的字段"},
        )
    return state_service.update_state(conversation_id, data)


@router.post("/{conversation_id}/roll", summary="显式骰子判定")
def roll(conversation_id: int, payload: RollRequest):
    _get_conversation_or_404(conversation_id)
    try:
        message = roll_service.record_roll(
            conversation_id,
            dice=payload.dice,
            target=payload.target,
            attribute=payload.attribute,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "validation_error", "message": str(exc)},
        ) from exc
    return {
        "message": message,
        "state": state_service.get_state(conversation_id),
    }


@router.get("/{conversation_id}/snapshots", summary="存档列表")
def list_snapshots(conversation_id: int):
    _get_conversation_or_404(conversation_id)
    items = snapshot_service.list_snapshots(conversation_id)
    return {
        "items": items,
        "total": len(items),
        "page": 1,
        "page_size": len(items) or 1,
    }


@router.post(
    "/{conversation_id}/snapshots",
    status_code=201,
    summary="创建手动存档",
)
def create_snapshot(conversation_id: int, payload: SnapshotCreate):
    _get_conversation_or_404(conversation_id)
    return snapshot_service.create_manual_snapshot(
        conversation_id,
        name=payload.name,
        note=payload.note,
        branch_label=payload.branch_label,
    )


@router.post(
    "/{conversation_id}/snapshots/{snapshot_id}/restore",
    summary="读档",
)
def restore_snapshot(conversation_id: int, snapshot_id: int):
    _get_conversation_or_404(conversation_id)
    state = snapshot_service.restore_snapshot(conversation_id, snapshot_id)
    if state is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "存档不存在"},
        )
    return {
        "status": "restored",
        "conversation_id": conversation_id,
        "snapshot_id": snapshot_id,
        "state": state,
    }


@router.delete(
    "/{conversation_id}/snapshots/{snapshot_id}",
    status_code=204,
    summary="删除存档",
)
def delete_snapshot(conversation_id: int, snapshot_id: int):
    _get_conversation_or_404(conversation_id)
    if repositories.get_snapshot(snapshot_id, conversation_id) is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "存档不存在"},
        )
    snapshot_service.delete_snapshot(conversation_id, snapshot_id)
