# -*- coding: utf-8 -*-
"""Per-conversation reply-length presets for online AI narration."""


DEFAULT_REPLY_LENGTH = "detailed"

REPLY_LENGTH_PRESETS = {
    "short": {
        "max_tokens": 1024,
        "label": "简短",
        "instruction": (
            "本轮剧情回复以约 300-500 个中文字符为目标，快速推进事件，"
            "保留必要的环境、动作、对话和结果。"
        ),
    },
    "standard": {
        "max_tokens": 2048,
        "label": "标准",
        "instruction": (
            "本轮剧情回复以约 600-1000 个中文字符为目标，平衡环境描写、"
            "角色动作、对话和剧情结果，避免重复。"
        ),
    },
    "detailed": {
        "max_tokens": 4096,
        "label": "详细",
        "instruction": (
            "本轮剧情回复以约 1000-1800 个中文字符为目标，完整展开环境、"
            "感官细节、角色动作、对话、情绪和剧情结果，避免无意义重复。"
        ),
    },
    "long": {
        "max_tokens": 8192,
        "label": "超长",
        "instruction": (
            "本轮剧情回复以约 2000-3500 个中文字符为目标，充分展开场景、"
            "感官细节、角色动作、对话、情绪变化、因果结果和后续悬念，避免无意义重复。"
        ),
    },
}


def resolve_reply_length(metadata, fallback_max_tokens):
    """Resolve a client-selected preset without rejecting legacy requests."""
    metadata = metadata if isinstance(metadata, dict) else {}
    key = metadata.get("reply_length")
    preset = REPLY_LENGTH_PRESETS.get(key)
    if preset is None:
        return {
            "key": None,
            "max_tokens": int(fallback_max_tokens),
            "instruction": "",
        }
    return {
        "key": key,
        "max_tokens": int(preset["max_tokens"]),
        "instruction": preset["instruction"],
    }


def append_reply_length_instruction(messages, reply_length):
    """Return copied messages with a length preference on the system prompt."""
    preset = REPLY_LENGTH_PRESETS.get(reply_length)
    copied = [dict(message) for message in messages]
    if preset is None:
        return copied

    for index, message in enumerate(copied):
        if message.get("role") != "system":
            continue
        content = str(message.get("content", ""))
        copied[index] = {
            **message,
            "content": f"{content}\n\n回复长度偏好：{preset['instruction']}",
        }
        break
    return copied
