# -*- coding: utf-8 -*-
"""冒险快捷指令：/掷骰、/状态、/背包、/存档、/帮助 等，英文别名仍兼容。"""

from . import snapshot_service, state_service

COMMAND_ALIASES = {
    "status": "status",
    "状态": "status",
    "inventory": "inventory",
    "背包": "inventory",
    "save": "save",
    "存档": "save",
    "autosave": "autosave",
    "自动存档": "autosave",
    "load": "load",
    "读档": "load",
    "help": "help",
    "帮助": "help",
}


def parse_command(content):
    """识别以 / 开头的快捷指令，返回指令名和参数。"""
    stripped = (content or "").strip()
    if not stripped.startswith("/"):
        return None
    parts = stripped.split(maxsplit=1)
    name = parts[0].lstrip("/").lower()
    argument = parts[1] if len(parts) > 1 else ""
    return name, argument


def _format_state(state):
    """把状态字典格式化成对话内可读文本。"""
    lines = ["当前状态："]
    attributes = state.get("attributes") or {}
    items = state.get("items") or []
    relations = state.get("relations") or {}
    quests = state.get("quests") or []
    flags = state.get("flags") or []
    lines.append(
        "属性：" + ("、".join(f"{key}={value}" for key, value in attributes.items()) or "无")
    )
    lines.append("物品：" + ("、".join(str(item) for item in items) or "无"))
    lines.append(f"金钱：{state.get('money', 0)}")
    lines.append(
        "关系："
        + ("、".join(f"{key}={value}" for key, value in relations.items()) or "无")
    )
    lines.append(
        "任务："
        + ("、".join(_quest_text(quest) for quest in quests) or "无")
    )
    lines.append("状态标记：" + ("、".join(str(flag) for flag in flags) or "无"))
    return "\n".join(lines)


def _quest_text(quest):
    """任务显示为 标题（状态）。"""
    if isinstance(quest, dict):
        title = quest.get("title", "")
        status = quest.get("status", "")
        return f"{title}（{status}）" if status else title
    return str(quest)


def handle_command(conversation_id, content):
    """执行快捷指令，返回要写入消息的文本和元数据；非指令返回 None。"""
    parsed = parse_command(content)
    if parsed is None:
        return None
    name, argument = parsed
    name = COMMAND_ALIASES.get(name, name)

    if name == "help":
        text = (
            "可用指令：\n"
            "/状态（/status）；/背包（/inventory）；"
            "/存档 存档名（/save）；/自动存档（/autosave）；"
            "/读档 存档ID（/load）；/帮助（/help）"
        )
        return {"content": text, "metadata": {"kind": "command", "command": name}}

    if name == "status":
        state = state_service.get_state(conversation_id)
        return {
            "content": _format_state(state),
            "metadata": {"kind": "command", "command": name},
        }

    if name == "inventory":
        state = state_service.get_state(conversation_id)
        items = state.get("items") or []
        text = (
            "背包："
            + ("、".join(str(item) for item in items) or "空")
            + f"\n金钱：{state.get('money', 0)}"
        )
        return {"content": text, "metadata": {"kind": "command", "command": name}}

    if name == "save":
        snapshot_name = argument.strip() or "手动存档"
        snapshot = snapshot_service.create_manual_snapshot(
            conversation_id,
            name=snapshot_name,
            note="对话内手动存档",
        )
        text = f"已创建存档 #{snapshot['id']}：{snapshot['name']}"
        return {
            "content": text,
            "metadata": {"kind": "command", "command": name, "snapshot_id": snapshot["id"]},
        }

    if name == "autosave":
        snapshot = snapshot_service.autosave(conversation_id)
        text = f"已更新自动存档 #{snapshot['id']}"
        return {
            "content": text,
            "metadata": {"kind": "command", "command": name, "snapshot_id": snapshot["id"]},
        }

    if name == "load":
        try:
            snapshot_id = int(argument.strip())
        except ValueError as exc:
            raise ValueError("读档指令格式：/load 存档ID") from exc
        state = snapshot_service.restore_snapshot(conversation_id, snapshot_id)
        if state is None:
            raise ValueError("存档不存在或不属于当前会话")
        text = f"已读档 #{snapshot_id}，状态与对话历史已恢复。"
        return {
            "content": text,
            "metadata": {"kind": "command", "command": name, "snapshot_id": snapshot_id},
        }

    text = (
        f"未知指令 /{name}。输入 /帮助 或 /help 查看可用指令。"
    )
    return {"content": text, "metadata": {"kind": "command", "command": name}}
