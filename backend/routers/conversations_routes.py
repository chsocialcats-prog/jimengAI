# -*- coding: utf-8 -*-
"""Private adventure routes, authenticated and scoped by conversation owner."""

from fastapi import APIRouter, Depends, Query

from ..api_models.adventure import ConversationBranchCreate
from ..auth.dependencies import require_auth, require_conversation_owner
from ..auth.types import AuthContext
from ..repository import conversation_repository, snapshot_repository
from ..schemas import (
    ConversationCorrection,
    ConversationCreate,
    ConversationUpdate,
    OnboardingComplete,
    RollRequest,
    SnapshotCreate,
    StateUpdate,
)
from ..services import roll_service, snapshot_service, state_service
from ._error_helpers import (
    _raise_no_update_fields,
    _raise_not_found,
    _raise_validation_from_value_error,
)

router = APIRouter(prefix="/api/conversations", tags=["冒险会话"])


def _access_or_404(conversation_id, auth):
    access = require_conversation_owner(conversation_id, auth, conversation_repository)
    if access is None:
        _raise_not_found("冒险会话不存在")
    return access


@router.get("")
def list_conversations(
    work_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    auth: AuthContext = Depends(require_auth),
):
    return conversation_repository.list_conversations(
        auth.user.id, work_id=work_id, page=page, page_size=page_size
    )


@router.delete("")
def delete_all_conversations(auth: AuthContext = Depends(require_auth)):
    deleted = conversation_repository.delete_all_conversations(auth.user.id)
    return {"deleted": deleted}


@router.post("", status_code=201)
def create_conversation(payload: ConversationCreate, auth: AuthContext = Depends(require_auth)):
    conversation = conversation_repository.create_conversation(
        payload.work_id, payload.title, auth.user.id
    )
    if conversation is None:
        _raise_not_found("作品不存在")
    return conversation


@router.get("/{conversation_id}")
def get_conversation(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    return _access_or_404(conversation_id, auth).conversation


@router.put("/{conversation_id}")
def update_conversation(
    conversation_id: int,
    payload: ConversationUpdate,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    return conversation_repository.update_conversation(
        conversation_id, access.auth.user.id, payload.model_dump()
    )


@router.post("/{conversation_id}/onboarding")
def complete_onboarding(
    conversation_id: int,
    payload: OnboardingComplete,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    try:
        return conversation_repository.complete_conversation_onboarding(
            conversation_id, access.auth.user.id, payload.answers
        )
    except ValueError as exc:
        _raise_validation_from_value_error(exc)


@router.post("/{conversation_id}/corrections")
def add_correction(
    conversation_id: int,
    payload: ConversationCorrection,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    try:
        return conversation_repository.add_conversation_correction(
            conversation_id, access.auth.user.id, payload.kind, payload.content
        )
    except ValueError as exc:
        _raise_validation_from_value_error(exc)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    access = _access_or_404(conversation_id, auth)
    conversation_repository.delete_conversation(conversation_id, access.auth.user.id)


@router.post("/{conversation_id}/archive")
def archive_conversation(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    access = _access_or_404(conversation_id, auth)
    return conversation_repository.set_conversation_status(
        conversation_id, access.auth.user.id, "archived"
    )


@router.post("/{conversation_id}/restore")
def restore_conversation(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    access = _access_or_404(conversation_id, auth)
    return conversation_repository.set_conversation_status(
        conversation_id, access.auth.user.id, "active"
    )


@router.get("/{conversation_id}/messages")
def get_messages(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    access = _access_or_404(conversation_id, auth)
    return conversation_repository.get_messages(conversation_id, access.auth.user.id)


@router.get("/{conversation_id}/state")
def get_state(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    return state_service.get_state(_access_or_404(conversation_id, auth))


@router.put("/{conversation_id}/state")
def update_state(
    conversation_id: int,
    payload: StateUpdate,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        _raise_no_update_fields()
    return state_service.update_state(access, data)


@router.post("/{conversation_id}/roll")
def roll(
    conversation_id: int,
    payload: RollRequest,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    try:
        message = roll_service.record_roll(
            access,
            dice=payload.dice,
            target=payload.target,
            attribute=payload.attribute,
            reason=payload.reason,
        )
    except ValueError as exc:
        _raise_validation_from_value_error(exc)
    return {"message": message, "state": state_service.get_state(access)}


@router.get("/{conversation_id}/snapshots")
def list_snapshots(conversation_id: int, auth: AuthContext = Depends(require_auth)):
    items = snapshot_service.list_snapshots(_access_or_404(conversation_id, auth))
    return {"items": items, "total": len(items), "page": 1, "page_size": len(items) or 1}


@router.post("/{conversation_id}/snapshots", status_code=201)
def create_snapshot(
    conversation_id: int,
    payload: SnapshotCreate,
    auth: AuthContext = Depends(require_auth),
):
    return snapshot_service.create_manual_snapshot(
        _access_or_404(conversation_id, auth),
        name=payload.name,
        note=payload.note,
        branch_label=payload.branch_label,
    )


@router.post("/{conversation_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(
    conversation_id: int,
    snapshot_id: int,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    state = snapshot_service.restore_snapshot(access, snapshot_id)
    if state is None:
        _raise_not_found("存档不存在")
    return {
        "status": "restored",
        "conversation_id": conversation_id,
        "snapshot_id": snapshot_id,
        "state": state,
        "conversation": conversation_repository.get_conversation(conversation_id, access.auth.user.id),
        "messages": conversation_repository.get_messages(conversation_id, access.auth.user.id),
    }


@router.delete("/{conversation_id}/snapshots/{snapshot_id}", status_code=204)
def delete_snapshot(
    conversation_id: int,
    snapshot_id: int,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    if snapshot_repository.get_snapshot(snapshot_id, access.auth.user.id, conversation_id) is None:
        _raise_not_found("存档不存在")
    snapshot_service.delete_snapshot(access, snapshot_id)


@router.post("/{conversation_id}/branches", status_code=201)
def create_branch(
    conversation_id: int,
    payload: ConversationBranchCreate,
    auth: AuthContext = Depends(require_auth),
):
    access = _access_or_404(conversation_id, auth)
    branch = conversation_repository.create_conversation_branch(
        conversation_id,
        access.auth.user.id,
        payload.title,
        payload.branch_label,
        payload.snapshot_id,
    )
    if branch is None:
        _raise_not_found("存档不存在")
    return branch
