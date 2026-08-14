# -*- coding: utf-8 -*-
"""存档服务：手动存档、自动存档与读档。"""

from ..repository import snapshot_repository


def list_snapshots(access):
    """读取会话全部存档。"""
    return snapshot_repository.list_snapshots(access.conversation["id"], access.auth.user.id)


def create_manual_snapshot(
    access,
    name="手动存档",
    note="",
    branch_label="",
):
    """创建手动存档。"""
    return snapshot_repository.create_snapshot(
        access.conversation["id"], access.auth.user.id,
        name=name or "手动存档",
        note=note,
        branch_label=branch_label,
        autosave=False,
    )


def autosave(access, note=""):
    """创建或更新本会话的自动存档。"""
    return snapshot_repository.create_snapshot(
        access.conversation["id"], access.auth.user.id,
        name="自动存档",
        note=note or "自动存档",
        autosave=True,
    )


def restore_snapshot(access, snapshot_id):
    """恢复指定存档的状态、消息和记忆。"""
    return snapshot_repository.restore_snapshot(
        access.conversation["id"], snapshot_id, access.auth.user.id
    )


def delete_snapshot(access, snapshot_id):
    """删除指定存档。"""
    snapshot_repository.delete_snapshot(
        snapshot_id, access.auth.user.id, access.conversation["id"]
    )
