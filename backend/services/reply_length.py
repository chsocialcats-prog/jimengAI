# -*- coding: utf-8 -*-
"""Per-conversation reply-length presets for online AI narration."""


DEFAULT_REPLY_LENGTH = "detailed"

REPLY_LENGTH_PRESETS = {
    "short": {
        "max_tokens": 1024,
        "min_characters": 300,
        "max_characters": 500,
        "minimum_instruction": "本轮回复的可见正文不得少于 300 个中文字符，未达到最低字数前不要结束。",
        "label": "简短",
        "instruction": (
            "本轮剧情回复以约 300-500 个中文字符为目标，快速推进事件，"
            "保留必要的环境、动作、对话和结果。"
        ),
    },
    "standard": {
        "max_tokens": 2048,
        "min_characters": 600,
        "max_characters": 1000,
        "minimum_instruction": "本轮回复的可见正文不得少于 600 个中文字符，未达到最低字数前不要结束。",
        "label": "标准",
        "instruction": (
            "本轮剧情回复以约 600-1000 个中文字符为目标，平衡环境描写、"
            "角色动作、对话和剧情结果，避免重复。"
        ),
    },
    "detailed": {
        "max_tokens": 4096,
        "min_characters": 1000,
        "max_characters": 1800,
        "minimum_instruction": "本轮回复的可见正文不得少于 1000 个中文字符，尽量控制在 1800 个以内；未达到最低字数前不要结束，请继续补充必要的环境、感官、动作、对话和结果。",
        "label": "详细",
        "instruction": (
            "本轮剧情回复以约 1000-1800 个中文字符为目标，完整展开环境、"
            "感官细节、角色动作、对话、情绪和剧情结果，避免无意义重复。"
        ),
    },
    "long": {
        "max_tokens": 8192,
        "min_characters": 2000,
        "max_characters": 3500,
        "minimum_instruction": "本轮回复的可见正文不得少于 2000 个中文字符，尽量控制在 3500 个以内；未达到最低字数前不要结束，请继续补充完整的场景、动作、对话、情绪、因果和后续悬念。",
        "label": "超长",
        "instruction": (
            "本轮剧情回复以约 2000-3500 个中文字符为目标，充分展开场景、"
            "感官细节、角色动作、对话、情绪变化、因果结果和后续悬念，避免无意义重复。"
        ),
    },
}


def count_reply_characters(text):
    """Count visible reply characters while ignoring whitespace."""
    return sum(1 for char in str(text or "") if not char.isspace())


def _full_instruction(preset):
    return " ".join(
        part
        for part in (preset.get("instruction", ""), preset.get("minimum_instruction", ""))
        if part
    )


def resolve_reply_length(metadata, fallback_max_tokens):
    """Resolve a client-selected preset without rejecting legacy requests."""
    metadata = metadata if isinstance(metadata, dict) else {}
    key = metadata.get("reply_length")
    preset = REPLY_LENGTH_PRESETS.get(key)
    if preset is None:
        return {
            "key": None,
            "max_tokens": int(fallback_max_tokens),
            "min_characters": 0,
            "max_characters": 0,
            "instruction": "",
        }
    return {
        "key": key,
        "max_tokens": int(preset["max_tokens"]),
        "min_characters": int(preset["min_characters"]),
        "max_characters": int(preset["max_characters"]),
        "instruction": _full_instruction(preset),
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
            "content": f"{content}\n\n回复长度偏好：{_full_instruction(preset)}",
        }
        break
    return copied
