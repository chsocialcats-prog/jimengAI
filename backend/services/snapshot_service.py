# -*- coding: utf-8 -*-
"""存档服务：手动存档、自动存档与读档。"""

from .. import repositories


def list_snapshots(conversation_id):
    """读取会话全部存档。"""
    return repositories.list_snapshots(conversation_id)


def create_manual_snapshot(
    conversation_id,
    name="手动存档",
    note="",
    branch_label="",
):
    """创建手动存档。"""
    return repositories.create_snapshot(
        conversation_id,
        name=name or "手动存档",
        note=note,
        branch_label=branch_label,
        autosave=False,
    )


def autosave(conversation_id, note=""):
    """创建或更新本会话的自动存档。"""
    return repositories.create_snapshot(
        conversation_id,
        name="自动存档",
        note=note or "自动存档",
        autosave=True,
    )


def restore_snapshot(conversation_id, snapshot_id):
    """恢复指定存档的状态、消息和记忆。"""
    return repositories.restore_snapshot(conversation_id, snapshot_id)


def delete_snapshot(conversation_id, snapshot_id):
    """删除指定存档。"""
    repositories.delete_snapshot(snapshot_id, conversation_id)
